#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');

// The harness uses the actual module's private classes, exposed only in this
// disposable test VM. No production API exposes authorization tokens.
async function runSuite(source, NativeURL, NativeBlob, crypto) {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const rejects = async (fn, fragment) => {
    try { await fn(); } catch (e) {
      check(String(e.message || e).includes(fragment), 'Wrong error: '+e.message+'; expected '+fragment);
      return;
    }
    throw Error('Expected rejection: '+fragment);
  };
  const env = {location:{protocol:'https:',hostname:'oolnokk.github.io'},crypto};
  let http = async () => { throw Error('Unexpected network request in fixture'); }; // Inject real adapter HTTP transport tests without live credentials.
  const instrumented = source.replace('  window.HobunjiBrowserDrive=Object.freeze({',
    '  window.__driveTest={Session,DriveDirectory,DriveFile,folderId,allowed};\n  window.HobunjiBrowserDrive=Object.freeze({');
  check(instrumented !== source,'test seam changed');
  new Function('window','globalThis','location','URL','Blob','crypto','fetch',instrumented)(env,env,env.location,NativeURL,NativeBlob,crypto,(...args)=>http(...args));
  const {Session,DriveDirectory,DriveFile,allowed,folderId} = env.__driveTest;
  check(folderId('https://drive.google.com/drive/folders/rootFolder123?usp=sharing')==='rootFolder123','folder link');
  await rejects(()=>folderId('https://not-drive.example/drive/folders/rootFolder123'),'Paste the Google Drive URL');
  check(!allowed('','../manifest.json')&&!allowed('','arbitrary.txt')&&!allowed('characters','x.png')&&allowed('patterns','motif.png'),'scope boundary');
  const root='rootFolder123', dir='characters1234', first='oldCharacter1234', name='farmer-id.json';
  function fixture() {
    const s=new Session(root,'Hobunji','12345-test.apps.googleusercontent.com');
    const rows=new Map();
    let seq=0; // Unique synthetic server IDs and version values.
    function row(id,n,parent,mime='application/json',size=3) {
      return {id,name:n,parents:parent?[parent]:[],mimeType:mime,size:String(size),modifiedTime:new Date(1000+seq++).toISOString(),version:'1',capabilities:{canAddChildren:true},trashed:false};
    }
    rows.set(root,row(root,'Hobunji',null,'application/vnd.google-apps.folder'));
    rows.set(dir,row(dir,'characters',root,'application/vnd.google-apps.folder'));
    rows.set(first,row(first,name,dir));
    s.auth={token:'memory-only',expires:Date.now()+60000};
    s.meta=async id=>{if(!rows.has(id))throw Error('missing ID');return {...rows.get(id)};};
    s.list=async (parent,n)=>[...rows.values()].filter(r=>!r.trashed&&r.parents.includes(parent)&&(n===undefined||r.name===n)).map(r=>({...r}));
    let failure=null; // Inject lost acknowledgements and competitor changes at publication boundaries.
    const patch = async (id,data)=>{
      const old=rows.get(id);
      check(!!old,'patch target exists');
      if (failure==='before-publish' && data.name===name && id!==first) { failure=null;throw Error('injected failure'); }
      const changed={...old,...data,version:String(Number(old.version)+1),modifiedTime:new Date(1000+seq++).toISOString()};
      rows.set(id,changed);
      if (failure==='lost-publish-ack' && data.name===name && id!==first) {failure=null;throw Error('lost ack');}
      if (failure==='lost-backup-ack' && data.name?.startsWith('.hobunji-previous-')) {failure=null;throw Error('lost backup ack');}
      return {...changed};
    };
    s.json=async (target,method,data)=>{
      const u=new NativeURL(target);
      const id=u.pathname.split('/').pop();
      if(method==='PATCH')return patch(id,data);
      if(method==='POST'){
        const created=row('createdFile'+(++seq),data.name,data.parents[0],data.mimeType);
        rows.set(created.id,created);return {...created};
      }
      throw Error('unexpected mocked request');
    };
    s.uploadBlob=async(parent,n,blob)=>{
      const made=row('uploadedFile'+(++seq),n,parent,blob.type,blob.size);
      rows.set(made.id,made);return {...made};
    };
    s.stage=async (parent,canonical,blob)=>{
      const pending=row('stagedFile'+(++seq),'.hobunji-pending-'+canonical+'-'+crypto.randomUUID(),parent,blob.type,blob.size);
      rows.set(pending.id,pending);
      if(failure==='external-during-stage'){failure=null;await patch(first,{size:'100'});}
      return {...pending};
    };
    return {s,rows,patch,setFailure(v){failure=v;},row};
  }
  const blob={size:5,type:'application/json'};
  {
    const {s,rows}=fixture();
    const handle=new DriveDirectory(s);
    const saved=env.HobunjiBrowserDrive.serializeHandle(handle);
    check(!JSON.stringify(saved).includes('memory-only'),'token never persisted');
    const restored=env.HobunjiBrowserDrive.restoreHandle(saved);
    check(await restored.queryPermission()==='prompt','reload requires authorization');
    await rejects(()=>s.publish('characters',name,blob),'Load from Folder');
    await s.beginLoad();await s.finishLoad();
    await s.publish('characters',name,blob);
    check((await s.child(dir,name)).id!==first,'new revision published');
    check(rows.get(first).name.startsWith('.hobunji-previous-'),'previous revision retained');
    await s.remove('','hobunji-save.json'); // Core routinely removes absent legacy file.
    check(await s.assertUnchanged(),'missing legacy cleanup does not disarm writes');
  }
  {
    const {s,patch}=fixture();
    await s.beginLoad();await patch(first,{size:'4'});
    await rejects(()=>s.finishLoad(),'changed on another device');
    check(!s.writable,'unstable load cannot arm writes');
  }
  {
    const {s,patch}=fixture();await s.beginLoad();await s.finishLoad();
    await patch(first,{size:'4'});
    await rejects(()=>s.assertUnchanged(),'changed on another device');
    check(!s.writable,'external version blocks writes');
  }
  {
    const {s,setFailure}=fixture();await s.beginLoad();await s.finishLoad();
    setFailure('external-during-stage');
    await rejects(()=>s.publish('characters',name,blob),'changed on another device');
    check((await s.child(dir,name)).id===first,'competing edit preserved');
  }
  for(const failure of ['lost-publish-ack','lost-backup-ack','before-publish']){
    const {s,setFailure,rows}=fixture();await s.beginLoad();await s.finishLoad();
    setFailure(failure);
    if(failure==='lost-publish-ack'){
      await s.publish('characters',name,blob);
      check((await s.child(dir,name)).id!==first,'lost successful publication is confirmed');
    }else{
      await rejects(()=>s.publish('characters',name,blob),failure==='lost-backup-ack'?'lost backup ack':'injected failure');
      check((await s.child(dir,name)).id===first,'failed publication restored old canonical name');
      check([...rows.values()].some(r=>r.name.startsWith('.hobunji-pending-')),'complete staged copy retained');
    }
  }
  {
    const {s,rows,row}=fixture();await s.beginLoad();await s.finishLoad();
    rows.set('duplicateFile123',row('duplicateFile123',name,dir));
    await rejects(()=>s.assertUnchanged(),'changed on another device');
  }
  {
    const {s,rows,row}=fixture();
    rows.delete(first);
    const pending='.hobunji-pending-'+name+'-'+crypto.randomUUID();
    rows.set('pendingFile123',row('pendingFile123',pending,dir));
    await rejects(()=>s.beginLoad(),'interrupted Drive write');
  }
  {
    const {s}=fixture();await s.beginLoad();await s.finishLoad();
    s.auth.expires=Date.now()-1;
    check(await new DriveDirectory(s).queryPermission()==='prompt','expired token prompts explicit reconnect');
  }
  const marker='hobunji-write-in-progress.json';
  {
    const {s,rows}=fixture();
    await s.beginLoad();await s.finishLoad();await s.beginCommit();
    check((await s.child(root,marker))?.id===s.commitId,'marker is durable before first canonical write');
    await s.publish('characters',name,blob);
    await s.finishCommit();
    check(!(await s.child(root,marker)),'verified commit removes marker');
    check(await s.assertUnchanged(),'marker deletion is reflected in baseline');
  }
  {
    const {s,rows,setFailure}=fixture();
    await s.beginLoad();await s.finishLoad();await s.beginCommit();
    setFailure('before-publish');
    await rejects(()=>s.publish('characters',name,blob),'injected failure');
    check(!!(await s.child(root,marker)),'failed publication preserves marker');
    await rejects(()=>s.beginLoad(),'interrupted Drive save');
    check(!s.writable,'cannot accept mixed canonical revision');
    await s.beginLoad(true);await s.finishLoad();await s.beginCommit(true);
    await s.publish('characters',name,blob);await s.finishCommit();
    check(!(await s.child(root,marker)),'explicit verified recovery clears marker');
  }
  {
    const {s,patch}=fixture();
    await s.beginLoad();await s.finishLoad();await s.beginCommit();
    await patch(first,{size:'7'});
    await rejects(()=>s.finishCommit(),'changed on another device');
    check(!!(await s.child(root,marker)),'conflict during full commit preserves marker');
  }
  {
    const s=new Session(root,'Hobunji','12345-test.apps.googleusercontent.com');
    s.json=async()=>({incompleteSearch:true,files:[]});
    await rejects(()=>s.list(root),'Incomplete Google Drive listing');
  }
  {
    const {s}=fixture();
    await s.beginLoad();await s.finishLoad();
    s.invalidate();
    await rejects(()=>s.assertUnchanged(),'Load from Folder');
    check(!s.writable,'invalidated import cannot grant writes');
  }
  {
    const s=new Session(root,'Hobunji','12345-test.apps.googleusercontent.com');
    s.auth={token:'test-token',expires:Date.now()+60000};
    s.meta=async()=>({id:root,name:'Shared',mimeType:'application/vnd.google-apps.folder',driveId:'sharedDrive',capabilities:{canAddChildren:true}});
    await rejects(()=>s.verifyRoot(),'Shared drives are not supported');
    await rejects(()=>s.request('https://not-google.example/drive/v3/files'),'Rejected unexpected');
    await rejects(()=>s.request('https://www.googleapis.com.evil.example/drive/v3/files'),'Rejected unexpected');
  }
  {
    const s=new Session(root,'Hobunji','12345-test.apps.googleusercontent.com');
    s.auth={token:'test-token',expires:Date.now()+60000};
    const calls=[]; // Exercise the real request + multipart builder, not the fixture's mocked stage method.
    const payload=new NativeBlob(['{"id":"char"}'],{type:'application/json'});
    http=async(target,options)=>{
      calls.push({target,options});
      const u=new NativeURL(target);
      check(u.origin==='https://www.googleapis.com','requests only go to Google');
      const header=options.headers['Content-Type'];
      check(options.method==='POST' && header.startsWith('multipart/related; boundary='),'small file uses multipart');
      const body=await options.body.text();
      const meta=JSON.parse(body.split('\r\n\r\n')[1].split('\r\n--')[0]);
      check(meta.parents[0]===dir && meta.name.startsWith('.hobunji-pending-'+name+'-'),'staging metadata is scoped to selected directory');
      check(body.includes('{"id":"char"}'),'complete file bytes are uploaded');
      return {ok:true,status:200,json:async()=>({id:'realStage1234',name:meta.name,parents:[dir],size:String(payload.size),version:'1'})};
    };
    const result=await s.stage(dir,name,payload);
    check(result.id==='realStage1234'&&calls.length===1,'real multipart response validated');
    check(calls[0].options.headers.Authorization==='Bearer test-token'&&calls[0].options.redirect==='error'&&calls[0].options.credentials==='omit','token stays on authorized request, never a redirect or cookie');
  }
  {
    const s=new Session(root,'Hobunji','12345-test.apps.googleusercontent.com');
    s.auth={token:'test-token',expires:Date.now()+60000};
    const payload=new NativeBlob(['x'.repeat(5*1024*1024+1)],{type:'application/json'});
    let meta=null,calls=0; // A real >5 MiB body exercises the resumable path.
    http=async(target,options)=>{
      calls++;
      const u=new NativeURL(target);
      check(u.origin==='https://www.googleapis.com','resumable request origin');
      if(calls===1){
        check(options.method==='POST'&&options.headers['X-Upload-Content-Length']===String(payload.size),'resumable init length');
        meta=JSON.parse(options.body);
        return {ok:true,status:200,headers:{get:k=>k==='Location'?'https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture':null}};
      }
      check(options.method==='PUT'&&options.body===payload,'exact Blob sent to resumable session');
      return {ok:true,status:200,json:async()=>({id:'resumable1234',name:meta.name,parents:[dir],size:String(payload.size),version:'1'})};
    };
    check((await s.stage(dir,name,payload)).id==='resumable1234'&&calls===2,'real resumable request and response validated');
    http=async()=>({ok:true,status:200,headers:{get:()=> 'https://evil.example/upload/drive/v3/files?upload_id=fixture'}});
    await rejects(()=>s.stage(dir,name,payload),'Rejected unexpected Google Drive endpoint');
    http=async()=>({ok:true,status:200,headers:{get:()=>null}});
    await rejects(()=>s.stage(dir,name,payload),'did not expose the resumable upload URL');
  }
  {
    const s=new Session(root,'Hobunji','12345-test.apps.googleusercontent.com');
    s.auth={token:'test-token',expires:Date.now()+60000};s.writable=true;
    http=async()=>({ok:false,status:401});
    await rejects(()=>s.request('https://www.googleapis.com/drive/v3/files'),'authorization expired');
    check(!s.granted()&&!s.writable,'HTTP 401 invalidates authorization and writes');
    s.auth={token:'test-token',expires:Date.now()+60000};
    http=async()=>({ok:false,status:403});
    await rejects(()=>s.request('https://www.googleapis.com/drive/v3/files'),'HTTP 403');
    http=async()=>{throw Error('sensitive raw diagnostic');};
    await rejects(()=>s.request('https://www.googleapis.com/drive/v3/files'),'network request failed');
  }
  return 20;
}
if(require.main===module)runSuite(fs.readFileSync('docs/js/browser-drive-folder.js','utf8'),URL,Blob,webcrypto)
  .then(n=>console.log('browser Drive folder: '+n+' regression groups passed'))
  .catch(e=>{console.error(e);process.exitCode=1;});
module.exports=runSuite;
