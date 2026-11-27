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
  const instrumented = source.replace('  window.HobunjiBrowserDrive=Object.freeze({',
    '  window.__driveTest={Session,DriveDirectory,DriveFile,folderId,allowed};\n  window.HobunjiBrowserDrive=Object.freeze({');
  check(instrumented !== source,'test seam changed');
  new Function('window','globalThis','location','URL','Blob','crypto',instrumented)(env,env,env.location,NativeURL,NativeBlob,crypto);
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
  return 11;
}
if(require.main===module)runSuite(fs.readFileSync('docs/js/browser-drive-folder.js','utf8'),URL,Blob,webcrypto)
  .then(n=>console.log('browser Drive folder: '+n+' regression groups passed'))
  .catch(e=>{console.error(e);process.exitCode=1;});
module.exports=runSuite;
