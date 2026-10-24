export const metrics = [
 ['Cpu','CPU',90], ['BusiestCore','Single core',95], ['Memory','RAM',90], ['Disk','Storage',90], ['Gpu','GPU',95]
];
export const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
export function analyze(samples, build) {
 const findings=[];
 for(const [key,category,threshold] of metrics) {
  const values=samples.map(s=>s[key]).filter(v=>typeof v==='number' && Number.isFinite(v));
  const fraction=values.filter(v=>v>=threshold).length/(values.length||1);
  if(values.length>=5 && values.length>=samples.length*.8 && fraction>=.5) findings.push({ category:category==='Single core'?'CPU':category, title:category==='Single core'?'One core is doing the heavy lifting':`${category} is under sustained pressure`, priority:fraction, confidence:'Medium · pressure detected', evidence:`${Math.round(fraction*100)}% of ${values.length} valid samples ≥ ${threshold}%. Mean ${mean(values).toFixed(1)}%.`, action:({CPU:'Compare the top processes. Close unneeded apps and repeat before considering a new CPU.','Single core':'An application thread may be the limit. Check app settings and workload-specific CPU benchmarks.',RAM:'Close unused apps and repeat. Memory pressure plus paging makes a capacity upgrade more compelling.',Storage:'Check copying, antivirus scans and paging first. Busy time alone does not prove a drive is slow.',GPU:'Lower rendering settings and repeat. A busy video or compute engine is not necessarily a gaming bottleneck.'})[category] });
 }
 for(const v of build?.Volumes||[]) if(v.Size>0 && v.FreeSpace/v.Size<.1) findings.push({category:'Configuration',title:`${v.DeviceID} is running out of breathing room`,priority:0,confidence:'High · free space measured',evidence:`${(v.FreeSpace/1e9).toFixed(1)} GB free (${Math.round(v.FreeSpace/v.Size*100)}%).`,action:'Free up space, then measure again. This may help without buying anything.'});
 const temps=samples.flatMap(s=>s.GpuSensors||[]).filter(s=>Number.isFinite(s.temperature));
 if(temps.some(s=>s.thermalSlowdown===true)) findings.push({category:'Thermal',title:'GPU thermal slowdown reported',priority:0,confidence:'High · driver-reported flag',evidence:'NVIDIA reported a thermal slowdown event during this session.',action:'Check airflow, dust and cooling before spending on performance parts.'});
 else findings.push({category:'Thermal',title:temps.length?'GPU temperature observed; CPU thermals unknown':'Cooling is still an open question',priority:0,confidence:'Incomplete sensor coverage',evidence:temps.length?`NVIDIA GPU peak ${Math.max(...temps.map(s=>s.temperature))}°C. This does not establish a safe threshold for every GPU.`:'No supported temperature sensor reported data. Missing data is not a clean bill of health.',action:'Check manufacturer temperature and throttling telemetry. The app cannot rule out CPU overheating.'});
 if(samples.length<5) findings.unshift({category:'Unknown',title:'Let’s collect a little more evidence',priority:0,confidence:'Not enough samples',evidence:'At least five valid samples are needed for a pressure finding.',action:'Record the activity that feels slow for 30–120 seconds.'});
 else if(!findings.some(f=>f.priority>0)) findings.unshift({category:'Unknown',title:'No sustained resource pressure found',priority:0,confidence:'Limited to this capture',evidence:'Available counters did not meet the sustained-pressure rules.',action:'Keep your upgrade budget for now. Try recording the exact moment that feels slow; network, drivers and app behavior may be involved.'});
 const missing=metrics.filter(([key])=>samples.length && samples.filter(s=>typeof s[key]==='number').length<samples.length*.8).map(([,name])=>name);
 if(missing.length) findings.push({category:'Unknown',title:'Some instruments are offline',priority:0,confidence:'Incomplete coverage',evidence:missing.join(', '),action:'Unavailable counters remain gaps in the charts, never zeroes.'});
 return findings;
}
export function assessPart(part,build) {
 if(!build) return { eligible:false, label:'Scan your PC first', reason:'Hardware compatibility has not been checked.' };
 if(build.System?.PCSystemType===2) return {eligible:false,label:'Desktop part · laptop detected',reason:'These desktop components are not recommended for a portable system.'};
 const ram=build.Ram||[];
 if(part.category==='RAM') {
  const capacity=ram.reduce((a,r)=>a+Number(r.Capacity||0),0)/1073741824;
  if(!ram.length || ram.some(r=>r.SMBIOSMemoryType!==part.ddr || r.FormFactor!==part.form)) return {eligible:false,label:'Memory type does not match',reason:'DDR generation and DIMM form factor must match every installed module.'};
  if(part.capacity<=capacity) return {eligible:false,label:'Not a capacity upgrade',reason:`You already have ${capacity} GB. This ${part.capacity} GB kit would not add capacity.`};
  const max=(build.MemoryArray||[]).reduce((a,r)=>a+Number(r.MaxCapacityEx||0),0)/1048576;
  if(max && part.capacity>max) return {eligible:false,label:'Exceeds reported memory limit',reason:`Firmware reports a ${max} GB maximum.`};
  return {eligible:true,label:'Memory type matches · QVL check needed',reason:`${capacity} → ${part.capacity} GB as a replacement kit. Confirm the exact board support list and module count.`};
 }
 if(part.category==='Storage') {
  const hdd=(build.PhysicalDisks||[]).some(d=>d.MediaType===3 || d.MediaType==='HDD');
  return {eligible:hdd,label:hdd?'HDD detected · slot check needed':'No HDD-to-SSD upgrade established',reason:hdd?'Confirm that the busy workload is on that HDD and an NVMe slot is available.':'An existing SSD may already meet your needs. No speed improvement is established.'};
 }
 if(part.category==='GPU') {
  const names=(build.Gpu||[]).map(g=>g.Name).join(' ');
  const older=/\b(?:GTX\s*(?:10[568]0|16[56]0)|RTX\s*(?:20[678]0|3060|4060))\b/i.test(names);
  const newer=/\bRTX\s*(?:30[789]0|40[789]0|50\d0)\b/i.test(names);
  return {eligible:older&&!newer,label:older&&!newer?'Possible GPU upgrade · fit unverified':'No verified step up from your GPU',reason:older&&!newer?'Older supported GPU detected. Verify game benchmarks, PSU, connectors and dimensions.':'We do not infer performance from generation number alone or recommend a downgrade.'};
 }
 return {eligible:false,label:'Compatibility unverified',reason:'An exact motherboard and BIOS support check is required.'};
}
export function rankOffers(offers,build,findings,budget,now=Date.now()) {
 return offers.map(o=>{
  const fit=assessPart(o,build); const age=now-Date.parse(o.observedAt); const fresh=Number.isFinite(age)&&age>=0&&age<=48*3600000;
  const pressure=Math.max(0,...findings.filter(f=>f.category===o.category).map(f=>f.priority));
  const affordable=Number.isFinite(o.price)&&o.price>0&&o.price<=budget;
  const recommended=fit.eligible&&fresh&&affordable&&pressure>0&&o.inStock!==false;
  return {...o,fit,fresh,pressure,affordable,recommended,score:recommended?pressure/o.price:0};
 }).sort((a,b)=>b.score-a.score || (a.price??Infinity)-(b.price??Infinity));
}
