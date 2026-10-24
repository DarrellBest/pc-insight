// Deterministic, code-drawn application icon. No downloaded image assets.
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs/promises');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true}});
 await win.loadURL('data:text/html,<html><body></body></html>');
 const data=await win.webContents.executeJavaScript(`(()=>{const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.fillStyle='#0c1720';x.beginPath();x.roundRect(0,0,256,256,58);x.fill();x.fillStyle='#74efbd';x.beginPath();x.roundRect(18,18,220,220,44);x.fill();x.strokeStyle='#103125';x.lineWidth=16;x.lineCap='round';x.lineJoin='round';x.beginPath();x.moveTo(80,181);x.lineTo(80,76);x.lineTo(129,76);x.bezierCurveTo(169,76,169,130,129,130);x.lineTo(80,130);x.stroke();x.lineWidth=15;x.beginPath();x.moveTo(180,141);x.lineTo(180,181);x.stroke();x.fillStyle='#103125';x.beginPath();x.arc(180,112,9,0,Math.PI*2);x.fill();return c.toDataURL('image/png');})()`);
 const png=nativeImage.createFromDataURL(data).toPNG();await fs.mkdir('build-resources',{recursive:true});await fs.writeFile('build-resources/icon.png',png);
 const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);await fs.writeFile('build-resources/icon.ico',Buffer.concat([header,png]));
 app.exit(0);
});
