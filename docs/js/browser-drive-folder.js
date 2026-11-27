// Browser Google Drive folder transport. Canonical layout and save policy remain in LocalSaveFolder.
// No auth token or file contents are persisted by this adapter.
(() => {
  'use strict';
  if (window.HobunjiAndroidFiles || !['https:', 'http:'].includes(location.protocol)
      || (location.protocol === 'http:' && !['localhost','127.0.0.1'].includes(location.hostname))) return;
  const BASE = 'https://www.googleapis.com/drive/v3/files'; // Only this service handles metadata and media.
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'; // Resumable upload sessions must stay on this origin.
  const SCOPE = 'https://www.googleapis.com/auth/drive'; // Existing PC-authored child files need more than drive.file.
  const FOLDER = 'application/vnd.google-apps.folder'; // Reject shortcuts and Google-native documents.
  const FIELDS = 'id,name,mimeType,size,modifiedTime,version,parents,trashed,capabilities(canEdit,canAddChildren)'; // Version is the conflict authority.
  const DIRS = new Set(['characters','worlds','farm-layouts','patterns','recovery']); // Exact portable-save directories.
  const ROOT_FILES = new Set(['manifest.json','hobunji-save.json']); // No arbitrary Drive file access.
  const LIMIT = 512 * 1024 * 1024; // Maximum bytes held by a single browser writer.
  const PUBLIC_CLIENT = window.HobunjiBrowserDriveConfig?.clientId || ''; // Public OAuth Web client ID, never a secret.
  let gisPromise = null; // Load Google's script only after the player requests Drive.
  let dialogOpen = false; // Prevent competing OAuth/selection dialogs.
  let lastError = ''; // Visible via the existing folder status and debug surface.
  const validId = s => typeof s === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(s);
  const validClient = s => /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(s);
  const fail = (name, message) => Object.assign(new Error(message), {name});
  const missing = name => fail('NotFoundError', 'Drive save entry not found: ' + name);
  const conflict = () => fail('InvalidStateError', 'Drive folder changed on another device or a write was interrupted. Stop other devices, preserve local progress, then reconnect and Load from Folder or recover.');
  const hidden = name => name.startsWith('.hobunji-');
  function folderId(value) {
    const u = new URL(value.trim());
    const match = /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
    if (u.origin !== 'https://drive.google.com' || !match || !validId(match[1])) throw Error('Paste the Google Drive URL of the dedicated game save folder, not a file or Drive root.');
    return match[1];
  }
  function allowed(dir, name, directory = false) {
    if (typeof name !== 'string' || !name || name.length > 200 || /[/\\\x00-\x1f]/.test(name) || hidden(name)) return false;
    if (directory) return !dir && DIRS.has(name);
    return dir ? (DIRS.has(dir) && (dir === 'patterns' ? /\.png$/i : /\.json$/i).test(name)) : ROOT_FILES.has(name);
  }
  function url(base, params = {}) {
    const u = new URL(base);
    for (const [k,v] of Object.entries(params)) u.searchParams.set(k,v);
    return u.href;
  }
  function loadGIS() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!gisPromise) gisPromise = new Promise((resolve,reject) => {
      const script = document.createElement('script'); // User-initiated Google OAuth library.
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      const timer = setTimeout(() => { script.remove(); reject(Error('Google authorization script timed out.')); }, 15000);
      script.onload = () => { clearTimeout(timer); window.google?.accounts?.oauth2 ? resolve() : reject(Error('Google authorization library unavailable.')); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(Error('Could not load Google authorization.')); };
      document.head.appendChild(script);
    }).catch(error => { gisPromise = null; throw error; });
    return gisPromise;
  }
  function authorize(clientId) {
    return new Promise((resolve,reject) => {
      let done = false; // Ignore late callbacks after cancellation or timeout.
      const timer = setTimeout(() => finish(Error('Google authorization timed out.')), 120000);
      function finish(error, value) {
        if (done) return;
        done = true; clearTimeout(timer);
        error ? reject(error) : resolve(value);
      }
      try {
        const oauth = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId, scope: SCOPE, include_granted_scopes: false,
          callback(response) {
            if (response.error || !response.access_token || !String(response.scope || '').split(/\s+/).includes(SCOPE))
              return finish(Error('Google Drive permission was not granted.'));
            const seconds = Number(response.expires_in);
            if (!Number.isFinite(seconds) || seconds <= 30) return finish(Error('Google returned an invalid authorization lifetime.'));
            finish(null, {token: response.access_token, expires: Date.now() + (seconds - 30) * 1000});
          },
          error_callback() { finish(fail('AbortError','Google authorization was canceled or blocked.')); }
        });
        oauth.requestAccessToken({prompt:'consent'}); // Called synchronously from the explicit Connect button.
      } catch { finish(Error('Could not start Google authorization. Check the Web client ID and allowed origin.')); }
    });
  }

  class Session {
    constructor(id, name, clientId) {
      this.id = id; this.name = name; this.clientId = clientId;
      this.auth = null; // Memory-only bearer token for this selected root.
      this.baseline = null; // File IDs + Drive versions from the last explicitly accepted folder state.
      this.loadBaseline = null; // Candidate captured before an explicit load, not accepted until verified.
      this.writable = false; // Connect/reconnect never authorizes replacing an existing save.
      this.tail = Promise.resolve(); // Serializes mutations from the core and motif/checkpoint consumers.
    }
    granted() { return !!this.auth && Date.now() < this.auth.expires; }
    async request(target, method='GET', body, headers={}) {
      if (!this.granted()) throw fail('NotAllowedError','Google Drive authorization expired. Reconnect and load the folder before saving.');
      const u = new URL(target);
      if (u.origin !== 'https://www.googleapis.com' || !(/^\/(?:upload\/)?drive\/v3\/files(?:\/|$)/.test(u.pathname)))
        throw Error('Rejected unexpected Google Drive endpoint.');
      const token = this.auth.token; // Never sent to a redirect or another host.
      let response;
      try {
        response = await fetch(u.href,{method,body,headers:{...headers,Authorization:'Bearer '+token},credentials:'omit',redirect:'error',cache:'no-store'});
      } catch { throw Error('Google Drive network request failed. Reconnect if needed; no successful commit was assumed.'); }
      if (response.status === 401) {
        if (this.auth?.token === token) { this.auth = null; this.writable = false; }
        throw fail('NotAllowedError','Google Drive authorization expired. Reconnect and Load from Folder.');
      }
      if (!response.ok) throw fail('NetworkError','Google Drive request failed (HTTP '+response.status+'). Check folder access, connection and quota.');
      return response;
    }
    async json(target, method='GET', data) {
      return (await this.request(target,method,data === undefined ? undefined : JSON.stringify(data),data === undefined ? {} : {'Content-Type':'application/json'})).json();
    }
    async meta(id) { return this.json(url(BASE+'/'+encodeURIComponent(id),{fields:FIELDS})); }
    async verifyRoot() {
      const root = await this.meta(this.id);
      if (root.id !== this.id || root.trashed || root.mimeType !== FOLDER || !root.capabilities?.canAddChildren)
        throw Error('Choose a writable dedicated Google Drive folder.');
      this.name = root.name;
    }
    async list(parent, name) {
      if (!validId(parent)) throw Error('Invalid Drive parent.');
      const quote = s => s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const q = "'"+parent+"' in parents and trashed = false" + (name === undefined ? '' : " and name = '"+quote(name)+"'");
      const rows = []; // Only metadata is loaded during traversal.
      const seenPages = new Set();
      let pageToken;
      do {
        const p = {q,fields:'nextPageToken,files('+FIELDS+')',pageSize:'1000'};
        if (pageToken) p.pageToken = pageToken;
        const result = await this.json(url(BASE,p));
        if (!Array.isArray(result.files)) throw Error('Invalid Drive listing.');
        for (const row of result.files) {
          if (!validId(row.id) || !row.parents?.includes(parent) || row.trashed || typeof row.name !== 'string') throw Error('Invalid Drive child metadata.');
          rows.push(row);
        }
        pageToken = result.nextPageToken;
        if (pageToken && seenPages.has(pageToken)) throw Error('Repeated Google Drive listing page.');
        if (pageToken) seenPages.add(pageToken);
      } while(pageToken);
      return rows;
    }
    async child(parent,name) {
      const rows = await this.list(parent,name);
      if (rows.length > 1) throw conflict();
      if (rows.length && rows[0].name !== name) throw Error('Unexpected Drive filename.');
      return rows[0] || null;
    }
    async parent(dir) {
      await this.verifyRoot();
      if (!dir) return this.id;
      const row = await this.child(this.id,dir);
      if (!row) throw missing(dir);
      if (row.mimeType !== FOLDER) throw Error('Expected Drive save directory: '+dir);
      return row.id;
    }
    async tree() {
      await this.verifyRoot();
      const result = new Map(); // Canonical files and directory IDs, independent of hidden recovery versions.
      const root = await this.list(this.id);
      const put = (key,row) => {
        if (result.has(key)) throw conflict();
        if (!row.version) throw Error('Drive did not supply a file revision.');
        result.set(key,row);
      };
      for (const row of root) {
        if (DIRS.has(row.name)) {
          if (row.mimeType !== FOLDER) throw Error('Expected save directory '+row.name);
          put(row.name+'/',row);
          for (const child of await this.list(row.id)) {
            if (allowed(row.name,child.name)) { this.fileType(child); put(row.name+'/'+child.name,child); }
          }
        } else if (ROOT_FILES.has(row.name)) { this.fileType(row); put(row.name,row); }
        else if (!hidden(row.name)) throw Error('This is not a dedicated Hobunji save folder (unexpected entry: '+row.name+'). Choose the game folder, not its parent.');
      }
      return result;
    }
    fileType(row) {
      if (row.mimeType?.startsWith('application/vnd.google-apps.') || !Number.isFinite(Number(row.size)) || row.size == null) throw Error('Unsupported Drive save file: '+row.name);
    }
    stamp(row) { return row ? row.id + ':' + String(row.version) : ''; }
    equalTrees(a,b) {
      if (!a || !b || a.size !== b.size) return false;
      for (const [key,row] of a) {
        const other = b.get(key);
        // Creating/deleting children can change directory metadata without replacing its identity.
        if (key.endsWith('/') ? row.id !== other?.id : this.stamp(row) !== this.stamp(other)) return false;
      }
      return true;
    }
    async beginLoad() {
      await this.tail;
      this.writable = false;
      this.loadBaseline = await this.tree();
    }
    async finishLoad() {
      const now = await this.tree();
      if (!this.equalTrees(this.loadBaseline,now)) throw conflict();
      this.baseline = now; this.loadBaseline = null; this.writable = true;
    }
    async assertUnchanged(restore = false) {
      if (!this.writable && restore) { await this.beginLoad(); await this.finishLoad(); }
      if (!this.writable || !this.baseline) throw Error('Load from Folder before writing to Google Drive.');
      if (!this.equalTrees(this.baseline,await this.tree())) { this.writable = false; throw conflict(); }
      return true;
    }
    async expected(parent,dir,name) {
      if (!this.writable || !this.baseline) throw Error('Load from Folder before writing to Google Drive.');
      if (dir && this.baseline.get(dir+'/')?.id !== parent) throw conflict();
      const row = await this.child(parent,name);
      const key = dir ? dir+'/'+name : name;
      if (this.stamp(row) !== this.stamp(this.baseline.get(key))) { this.writable = false; throw conflict(); }
      return {row,key};
    }
    enqueue(operation) {
      const task = this.tail.then(operation);
      this.tail = task.catch(error => { this.writable = false; lastError = String(error.message || error); });
      return task;
    }
    async mkdir(name) {
      return this.enqueue(async () => {
        const old = await this.child(this.id,name);
        if (!this.writable || old || this.baseline?.has(name+'/')) throw conflict();
        const made = await this.json(url(BASE,{fields:FIELDS}),'POST',{name,parents:[this.id],mimeType:FOLDER});
        const current = await this.child(this.id,name);
        if (!current || made.id !== current.id || current.mimeType !== FOLDER) throw conflict();
        this.baseline.set(name+'/',current);
      });
    }
    async read(parent,name,expected) {
      const before = await this.child(parent,name);
      if (this.stamp(before) !== this.stamp(expected)) throw conflict();
      const blob = await (await this.request(url(BASE+'/'+encodeURIComponent(before.id),{alt:'media'}))).blob();
      const after = await this.child(parent,name);
      if (this.stamp(after) !== this.stamp(before) || blob.size !== Number(before.size)) throw conflict();
      return blob;
    }
    async stage(parent,name,blob) {
      const metadata = {name:'.hobunji-pending-'+crypto.randomUUID(),parents:[parent],mimeType:blob.type || 'application/octet-stream'};
      if (blob.size > LIMIT) throw Error('Save file exceeds the browser Drive size limit.');
      let result;
      if (blob.size <= 5*1024*1024) {
        const boundary = 'hobunji-'+crypto.randomUUID();
        const body = new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),'\r\n--'+boundary+'\r\nContent-Type: '+metadata.mimeType+'\r\n\r\n',blob,'\r\n--'+boundary+'--\r\n']);
        result = await (await this.request(url(UPLOAD,{uploadType:'multipart',fields:FIELDS}),'POST',body,{'Content-Type':'multipart/related; boundary='+boundary})).json();
      } else {
        const start = await this.request(url(UPLOAD,{uploadType:'resumable',fields:FIELDS}),'POST',JSON.stringify(metadata),{'Content-Type':'application/json','X-Upload-Content-Type':metadata.mimeType,'X-Upload-Content-Length':String(blob.size)});
        const session = start.headers.get('Location');
        if (!session) throw Error('Google did not expose the resumable upload URL to this browser.');
        result = await (await this.request(session,'PUT',blob,{'Content-Type':metadata.mimeType})).json();
      }
      if (!validId(result.id) || result.name !== metadata.name || !result.parents?.includes(parent) || Number(result.size) !== blob.size) throw Error('Google did not confirm complete staged save bytes.');
      return result;
    }
    async rename(parent,id,name) {
      const current = await this.meta(id);
      if (current.trashed || !current.parents?.includes(parent)) throw conflict();
      return this.json(url(BASE+'/'+encodeURIComponent(id),{fields:FIELDS}),'PATCH',{name});
    }
    async publish(dir,name,blob) {
      return this.enqueue(async () => {
        const parent = await this.parent(dir);
        const {row:old,key} = await this.expected(parent,dir,name);
        const draft = await this.stage(parent,name,blob);
        await this.expected(parent,dir,name); // A competing edit during upload must not be overwritten.
        let moved = false;
        try {
          if (old) {
            await this.rename(parent,old.id,'.hobunji-previous-'+name+'-'+crypto.randomUUID());
            moved = true;
          }
          if (await this.child(parent,name)) throw conflict();
          await this.rename(parent,draft.id,name);
          const committed = await this.child(parent,name);
          if (committed?.id !== draft.id) throw conflict();
          this.baseline.set(key,committed);
        } catch(error) {
          // A rename can succeed remotely while its response is lost. Never overwrite another publisher's canonical file.
          try {
            const current = await this.child(parent,name);
            if (current?.id === draft.id) { this.baseline.set(key,current); return; }
            if (old && !current) {
              const previous = await this.meta(old.id);
              if (previous.parents?.includes(parent) && previous.name.startsWith('.hobunji-previous-'+name+'-'))
                await this.rename(parent,old.id,name);
            }
          } catch { /* Both old and staged versions remain recoverable; fail closed. */ }
          throw error;
        }
        // Bounded cleanup only of exact Android/browser app-generated backup names. Never delete user files.
        if (moved) {
          try {
            const prefix = '.hobunji-previous-'+name+'-';
            const owned = (await this.list(parent)).filter(x=>x.name.startsWith(prefix) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x.name.slice(prefix.length)) && x.mimeType !== FOLDER);
            owned.sort((a,b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
            for (const row of owned.slice(3)) {
              const fresh = await this.meta(row.id);
              if (fresh.name === row.name && fresh.parents?.includes(parent) && this.stamp(fresh) === this.stamp(row))
                await this.json(url(BASE+'/'+row.id,{fields:'id,trashed'}),'PATCH',{trashed:true});
            }
          } catch { /* Retention failure does not invalidate a confirmed canonical save. */ }
        }
      });
    }
    async remove(dir,name) {
      return this.enqueue(async () => {
        const parent = await this.parent(dir);
        const {row,key} = await this.expected(parent,dir,name);
        if (!row) throw missing(name);
        await this.json(url(BASE+'/'+row.id,{fields:'id,trashed'}),'PATCH',{trashed:true});
        if (await this.child(parent,name)) throw conflict();
        this.baseline.delete(key);
      });
    }
  }
  class DriveFile {
    constructor(session,dir,name) { this.session=session; this.dir=dir; this.name=name; this.kind='file'; }
    async getFile() {
      const s=this.session, name=this.name, parent=await s.parent(this.dir);
      const row=await s.child(parent,name);
      if (!row) throw missing(name);
      s.fileType(row);
      if (Number(row.size)>LIMIT) throw Error('Drive save exceeds browser read limit.');
      return {name,size:Number(row.size),lastModified:Date.parse(row.modifiedTime),type:row.mimeType,
        async text(){return (await s.read(parent,name,row)).text();},
        async arrayBuffer(){return (await s.read(parent,name,row)).arrayBuffer();}
      };
    }
    async createWritable() {
      const s=this.session, dir=this.dir, name=this.name;
      let chunks=[], bytes=0, closed=false; // Only this file's bytes are retained, not a whole save.
      const mime = name.endsWith('.png')?'image/png':'application/json';
      return {
        async write(data) {
          if (closed) throw Error('Writer closed.');
          if (!(typeof data==='string'||data instanceof Blob||data instanceof ArrayBuffer||ArrayBuffer.isView(data))) throw TypeError('Unsupported file data.');
          const part=new Blob([data]); bytes+=part.size;
          if(bytes>LIMIT){closed=true;chunks=[];throw Error('Drive save exceeds browser write limit.');}
          chunks.push(part);
        },
        async close(){if(closed)throw Error('Writer closed.');closed=true;const blob=new Blob(chunks,{type:mime});chunks=[];await s.publish(dir,name,blob);},
        async abort(){closed=true;chunks=[];}
      };
    }
  }
  class DriveDirectory {
    constructor(session,dir='') { this.session=session;this.dir=dir;this.kind='directory';this.name=dir||session.name; }
    async queryPermission(){return this.session.granted()?'granted':'prompt';}
    async requestPermission(){
      if(this.session.granted())return 'granted';
      await select(this.session); this.name=this.session.name; return 'granted';
    }
    async beginDriveLoad(){return this.session.beginLoad();}
    async finishDriveLoad(){return this.session.finishLoad();}
    async assertDriveUnchanged(restore){return this.session.assertUnchanged(restore);}
    async getDirectoryHandle(name,options={}){
      if(!allowed(this.dir,name,true))throw TypeError('Invalid save directory.');
      const s=this.session;
      const row=await s.child(s.id,name);
      if(!row){if(!options.create)throw missing(name);await s.mkdir(name);}
      else if(row.mimeType!==FOLDER)throw Error('Expected Drive directory.');
      return new DriveDirectory(s,name);
    }
    async getFileHandle(name,options={}){
      if(!allowed(this.dir,name))throw TypeError('Invalid save filename.');
      if(!options.create){
        const row=await this.session.child(await this.session.parent(this.dir),name);
        if(!row)throw missing(name);
        this.session.fileType(row);
      }
      return new DriveFile(this.session,this.dir,name);
    }
    async removeEntry(name){if(!allowed(this.dir,name))throw TypeError('Invalid save filename.');return this.session.remove(this.dir,name);}
    async *entries(){
      const rows=await this.session.list(await this.session.parent(this.dir));
      const names=new Set();
      for(const row of rows){
        const directory=row.mimeType===FOLDER;
        if(!allowed(this.dir,row.name,directory))continue;
        if(names.has(row.name))throw conflict();
        names.add(row.name);
        if(!directory)this.session.fileType(row);
        yield [row.name,directory?new DriveDirectory(this.session,row.name):new DriveFile(this.session,this.dir,row.name)];
      }
    }
    async *values(){for await(const [,entry] of this.entries())yield entry;}
  }
  function select(existing=null) {
    if(dialogOpen)return Promise.reject(Error('Folder selection is already open.'));
    dialogOpen=true;
    return new Promise((resolve,reject)=>{
      const dialog=document.createElement('div'); // User-visible selector and diagnostics, including mobile.
      dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Google Drive save folder');
      dialog.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#000b;padding:16px';
      dialog.innerHTML='<div style="background:#20272a;color:#fff;padding:20px;border-radius:12px;max-width:480px;width:100%;max-height:90vh;overflow:auto;font:16px system-ui"><h2>Save folder</h2><p>Choose the same dedicated game folder as your other devices. Google requires Drive-wide permission to read files created on your PC; Hobunji only accesses this selected folder. Close other devices before saving.</p><label>Google Drive folder URL<input data-folder style="display:block;width:100%;box-sizing:border-box;margin:8px 0" type="url"></label><label>Public Google OAuth Web client ID<input data-client style="display:block;width:100%;box-sizing:border-box;margin:8px 0" autocomplete="off"></label><p data-status role="status"></p><div style="display:flex;gap:8px;flex-wrap:wrap"><button data-connect type="button" disabled>Connect Google Drive</button><button data-local type="button">Local folder</button><button data-cancel type="button">Cancel</button></div></div>';
      const folder=dialog.querySelector('[data-folder]'), client=dialog.querySelector('[data-client]'), status=dialog.querySelector('[data-status]'), connect=dialog.querySelector('[data-connect]'), local=dialog.querySelector('[data-local]'), cancel=dialog.querySelector('[data-cancel]');
      client.value=existing?.clientId||PUBLIC_CLIENT;
      if(existing){folder.value='https://drive.google.com/drive/folders/'+existing.id;folder.readOnly=true;client.readOnly=true;}
      local.hidden=!!existing||typeof window.showDirectoryPicker!=='function';
      let closed=false;
      function finish(error,value){if(closed)return;closed=true;dialog.remove();dialogOpen=false;error?reject(error):resolve(value);}
      cancel.onclick=()=>finish(fail('AbortError','Folder selection canceled.'));
      local.onclick=()=>{try{const picked=window.showDirectoryPicker({mode:'readwrite'});Promise.resolve(picked).then(h=>finish(null,h),e=>finish(e));}catch(e){finish(e);}};
      status.textContent='Loading Google authorization…';
      loadGIS().then(()=>{if(!closed){connect.disabled=false;status.textContent='Paste a folder link and public client ID. Connect does not write save files.';}},e=>{if(!closed)status.textContent=e.message;});
      connect.onclick=async()=>{
        let id,clientId;
        try{id=folderId(folder.value);clientId=client.value.trim();if(!validClient(clientId))throw Error('Enter the public OAuth Web client ID from Google Cloud, not a secret.');}
        catch(e){status.textContent=e.message;return;}
        connect.disabled=true;local.disabled=true;cancel.disabled=true;status.textContent='Authorizing Google Drive…';
        const session=existing||new Session(id,'Google Drive',clientId);
        try{
          session.auth=await authorize(clientId);session.writable=false;session.baseline=null;
          await session.verifyRoot();
          await session.tree(); // Validate dedicated folder and duplicate names before accepting selection.
          lastError='';finish(null,new DriveDirectory(session));
        }catch(e){session.auth=null;lastError=String(e.message||e);status.textContent=lastError;connect.disabled=false;local.disabled=false;cancel.disabled=false;}
      };
      document.body.appendChild(dialog);
    });
  }
  window.HobunjiBrowserDrive=Object.freeze({
    isSupported:()=>typeof indexedDB!=='undefined'&&typeof fetch==='function'&&!!crypto?.randomUUID,
    pickFolder:()=>select(),
    serializeHandle(value){return value instanceof DriveDirectory&&!value.dir?{__hobunjiBrowserDrive:{id:value.session.id,name:value.session.name,clientId:value.session.clientId}}:value;},
    restoreHandle(value){const t=value?.__hobunjiBrowserDrive;if(!t)return value;if(!validId(t.id)||!validClient(t.clientId)||typeof t.name!=='string')throw Error('Invalid remembered Drive folder.');return new DriveDirectory(new Session(t.id,t.name,t.clientId));},
    getDebug:()=>({lastError,dialogOpen,configured:!!PUBLIC_CLIENT})
  });
})();
