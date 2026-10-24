import {app,BrowserWindow,ipcMain,dialog,shell,safeStorage} from 'electron';
import {spawn,execFile} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {catalog} from './catalog.mjs';
import {analyze} from './diagnosis.mjs';
import {refreshPrices,allowedUrl} from './prices.mjs';
let window,active=null,build=null,offers=[...catalog],sessions=[],benchmarks=[],apiKey='',priceBusy=false;
const smoke=process.argv.includes('--smoke-test');
const scripts=()=>app.isPackaged?path.join(process.resourcesPath,'Scripts'):path.join(app.getAppPath(),'Scripts');
const ps=()=>path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
function send(channel,data){if(window&&!window.isDestroyed())window.webContents.send(channel,data);}
function powershell(script,args=[],onLine) {
 return new Promise((resolve,reject)=>{
  const child=spawn(ps(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(scripts(),script),...args],{windowsHide:true});
  active={cancel:()=>child.kill()};let out='',err='',pending='',finished=false;
  const timer=setTimeout(()=>{child.kill();},160000);
  const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);active=null;error?reject(error):resolve(out);};
  child.stdout.on('data',chunk=>{out+=chunk;pending+=chunk;if(out.length>4_000_000){child.kill();finish(new Error('Diagnostic output exceeded its limit.'));return;}if(onLine){let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index).trim();pending=pending.slice(index+1);if(line)try{onLine(JSON.parse(line));}catch{child.kill();finish(new Error('Invalid diagnostic sample.'));}}}});
  child.stderr.on('data',chunk=>{err=(err+chunk).slice(-4000);});
  child.on('error',e=>finish(e));child.on('close',(code)=>finish(code===0?null:new Error(err||'Stopped. No incomplete session was used for recommendations.')));
 });
}
function nvidia(){return new Promise(resolve=>{
 execFile('nvidia-smi.exe',['--query-gpu=name,temperature.gpu,clocks_event_reasons.sw_thermal_slowdown','--format=csv,noheader,nounits'],{windowsHide:true,timeout:2000},(error,stdout)=>{
  if(error){resolve([]);return;}resolve(stdout.trim().split(/\r?\n/).map(row=>{const [name,temp,flag]=row.split(',').map(s=>s.trim());return{name,temperature:Number.isFinite(Number(temp))?Number(temp):null,thermalSlowdown:flag==='Active'?true:flag==='Not Active'?false:null};}));
 });});}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{
 if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Untrusted caller.');
 return fn(...args);
});}
app.whenReady().then(async()=>{
 try{apiKey=safeStorage.decryptString(await fs.readFile(path.join(app.getPath('userData'),'retailer-key.bin')));}catch{}
 window=new BrowserWindow({width:1440,height:1000,minWidth:1050,minHeight:720,title:'PC Insight',icon:path.join(__dirname,'icon.png'),backgroundColor:'#0a0e17',show:!smoke,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen:smoke,backgroundThrottling:!smoke}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
 window.webContents.session.setPermissionRequestHandler((_,__,callback)=>callback(false));
 handle('scan',async()=>{if(active)throw new Error('Finish the current task first.');build=JSON.parse(await powershell('Scan.ps1'));sessions=[];return build;});
 handle('record',async(seconds,label)=>{
  if(active)throw new Error('Another task is running.');if(![30,60,120].includes(seconds)||typeof label!=='string'||label.length>80)throw new Error('Invalid session settings.');
  const samples=[];let sensors=[];let sensorBusy=false;
  await powershell('Monitor.ps1',['-Seconds',String(seconds)],sample=>{
   sample.GpuSensors=sensors;samples.push(sample);send('sample',sample);
   if(!sensorBusy){sensorBusy=true;nvidia().then(value=>{sensors=value;}).finally(()=>{sensorBusy=false;});}
  });
  const session={id:randomUUID(),at:new Date().toISOString(),label:label||'Slow activity',seconds,samples,findings:analyze(samples,build)};
  sessions.unshift(session);sessions=sessions.slice(0,10);return session;
 });
 handle('stop',()=>{active?.cancel();return true;});
 handle('benchmark',async()=>{
  if(active)throw new Error('Finish the current task first.');
  const scratch=path.join(os.tmpdir(),`pc-insight-${randomUUID()}.tmp`);
  try{return await new Promise((resolve,reject)=>{
   const worker=new Worker(path.join(__dirname,'bench-worker.cjs'),{workerData:{path:scratch}});
   active={cancel:()=>worker.terminate()};let result;const timer=setTimeout(()=>worker.terminate(),30000);
   worker.on('message',data=>{result=data;});worker.on('error',reject);
   worker.on('exit',code=>{clearTimeout(timer);active=null;if(code!==0||!result)reject(new Error('Test stopped before completion.'));else{benchmarks.unshift(result);resolve(result);}});
  });}finally{active=null;await fs.rm(scratch,{force:true});}
 });
 handle('offers',()=>({offers,keyConfigured:!!apiKey}));
 handle('prices-refresh',async()=>{if(priceBusy)throw new Error('Price refresh already running.');priceBusy=true;try{offers=await refreshPrices(offers,apiKey);return offers;}finally{priceBusy=false;}});
 handle('save-key',async key=>{if(typeof key!=='string'||key.length>200||!/^[-\w]*$/.test(key))throw new Error('Invalid API key format.');const file=path.join(app.getPath('userData'),'retailer-key.bin');if(key){if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable.');await fs.writeFile(file,safeStorage.encryptString(key));}else await fs.rm(file,{force:true});apiKey=key;return !!key;});
 handle('open-product',async id=>{const offer=offers.find(p=>p.id===id);if(!offer||!allowedUrl(offer.url))throw new Error('Unsupported retailer link.');await shell.openExternal(offer.url);});
 handle('export',async()=>{const chosen=await dialog.showSaveDialog(window,{defaultPath:'pc-insight-report.json',filters:[{name:'JSON report',extensions:['json']}]});if(chosen.canceled)return false;await fs.writeFile(chosen.filePath,JSON.stringify({version:'0.2.0',build,sessions,benchmarks},null,2));return true;});
 await window.loadFile(path.join(__dirname,'index.html'));
 if(smoke){
  try{
   const dir=path.join(process.cwd(),'smoke-output');await fs.mkdir(dir,{recursive:true});
   await new Promise(r=>setTimeout(r,500));await fs.writeFile(path.join(dir,'welcome.png'),(await window.webContents.capturePage()).toPNG());
   const result=await window.webContents.executeJavaScript(`window.pc.scan().then(b=>{window.__setBuildForSmoke(b);return {cpu:b.Cpu.length,gpu:b.Gpu.length,rendered:document.getElementById('hardware').textContent.includes(b.Cpu[0].Name)};})`);
   if(!result.rendered)throw new Error('Hardware was not rendered.');
   await new Promise(r=>setTimeout(r,700));
   await fs.writeFile(path.join(dir,'dashboard.png'),(await window.webContents.capturePage()).toPNG());
   await window.webContents.executeJavaScript(`document.querySelector('[data-page="upgrades"]').click()`);
   await new Promise(r=>setTimeout(r,500));await fs.writeFile(path.join(dir,'upgrades.png'),(await window.webContents.capturePage()).toPNG());
   const capture=await window.webContents.executeJavaScript(`window.__smokeCapture()`);
   if(capture<5)throw new Error('Activity capture did not collect enough samples.');
   await new Promise(r=>setTimeout(r,500));await fs.writeFile(path.join(dir,'performance.png'),(await window.webContents.capturePage()).toPNG());
   const bench=await window.webContents.executeJavaScript(`window.pc.benchmark()`);if(!(bench.hash>0&&bench.memory>0&&bench.disk>0))throw new Error('Benchmark missing values.');
   console.log('SMOKE PASS',JSON.stringify({...result,samples:capture,benchmark:true}));app.exit(0);
  }catch(e){console.error(e);app.exit(1);}
 }
});
app.on('before-quit',()=>active?.cancel());app.on('window-all-closed',()=>app.quit());
