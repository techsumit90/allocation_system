global.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=v;}, removeItem(k){delete this._d[k];} };
const fs = require('fs');
eval(fs.readFileSync('data.js','utf8'));

const allocs = CNCStorage.defaultData().allocations;
const byMachine = {};
allocs.forEach(a => { (byMachine[a.machine] = byMachine[a.machine]||[]).push(a); });
let ok = true;
Object.entries(byMachine).forEach(([m, list]) => {
  list.sort((a,b) => timeToMinutes(a.startTime)-timeToMinutes(b.startTime));
  for(let i=1;i<list.length;i++){
    if(timeToMinutes(list[i].startTime) < timeToMinutes(list[i-1].endTime)){
      console.log('OVERLAP:', m, list[i-1].partNo, list[i-1].startTime+'-'+list[i-1].endTime, 'vs', list[i].partNo, list[i].startTime+'-'+list[i].endTime);
      ok = false;
    }
  }
});
if(ok) console.log('OK: No overlaps in default allocations');

const d = CNCStorage.defaultData();
console.log('futureAllotments:', d.futureAllotments ? d.futureAllotments.length+' records' : 'MISSING');
console.log('allocationHistory:', d.allocationHistory.length+' records (Stage 1:', d.allocationHistory.filter(r=>r.stage==='Stage 1').length, ', Stage 2:', d.allocationHistory.filter(r=>r.stage==='Stage 2').length+')');
console.log('version:', d.version);
