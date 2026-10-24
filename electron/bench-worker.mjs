import {parentPort,workerData} from 'node:worker_threads';
import {randomBytes,createHash} from 'node:crypto';
import fs from 'node:fs';
const data=randomBytes(4*1024*1024);let start=performance.now(),bytes=0;
while(performance.now()-start<2500){createHash('sha256').update(data).digest();bytes+=data.length;}
const hash=bytes/1048576/((performance.now()-start)/1000);
const destination=Buffer.alloc(data.length);start=performance.now();bytes=0;
while(performance.now()-start<1500){data.copy(destination);bytes+=data.length;}
const memory=bytes/1048576/((performance.now()-start)/1000);
let fd;let disk;
try{fd=fs.openSync(workerData.path,'wx');start=performance.now();for(let i=0;i<16;i++)fs.writeSync(fd,data);fs.fsyncSync(fd);disk=64/((performance.now()-start)/1000);}
finally{if(fd!==undefined)fs.closeSync(fd);}
parentPort.postMessage({hash,memory,disk,at:new Date().toISOString(),drive:workerData.path.slice(0,3)});
