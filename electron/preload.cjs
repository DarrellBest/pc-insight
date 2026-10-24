const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pc', Object.freeze({
 scan:()=>ipcRenderer.invoke('scan'),
 record:(seconds,label)=>ipcRenderer.invoke('record',seconds,label),
 stop:()=>ipcRenderer.invoke('stop'),
 benchmark:()=>ipcRenderer.invoke('benchmark'),
 offers:()=>ipcRenderer.invoke('offers'),
 refreshPrices:()=>ipcRenderer.invoke('prices-refresh'),
 saveKey:key=>ipcRenderer.invoke('save-key',key),
 exportReport:()=>ipcRenderer.invoke('export'),
 openProduct:id=>ipcRenderer.invoke('open-product',id),
 onSample:callback=>{const listener=(_,data)=>callback(data);ipcRenderer.on('sample',listener);return()=>ipcRenderer.removeListener('sample',listener);}
}));
