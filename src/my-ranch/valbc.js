const fs=require('fs'); eval(fs.readFileSync('feed.js','utf8').replace('var FEED =','global.FEED ='));
const S=JSON.parse(fs.readFileSync('bcnrm_val.json','utf8'));
const F2C=f=>(f-32)*5/9; let worst=0;
const pct=(a,b)=>b===0?(Math.abs(a)<1e-6?0:100):(a/b-1)*100;
S.forEach(({case:c,b},i)=>{
  const env=c.adj?{tc:F2C(c.tc),tp:F2C(c.tp),lnt:F2C(c.lnt),ws:Math.min(32,c.ws/0.6214),hair:c.hair*2.54,hide:c.hide,coat:c.coat,pant:c.pant,rh:65}:null;
  const o={cowLb:c.lb,breed:c.breed,bcs:c.bcs,peakMilkLb:b.O49,activity:(c.act||0)/100,birthLb:b.N49};
  const p=FEED.cowParams(o,c.dim,c.dp,env);
  let lo=30,hi=99; for(let k=0;k<60;k++){const m=(lo+hi)/2; if(FEED.nemaOf(m)<b.K7) lo=m; else hi=m;} const t=(lo+hi)/2;
  const pred=FEED.needAt(p,t);                      // predicted DMI
  const act=FEED.needAt(Object.assign({},p,{dmiOverride:b.D20}),t);   // BCNRM's actual diet DMI (for cold stress)
  const mineNEm=p.nem+act.stress, bcNEm=b.D38;
  const rows={
    'NEm (+stress)':[mineNEm,bcNEm], 'NEl':[p.nel,b.D56], 'NEm preg (MEy*km)':[p.mey*act.km,b.D77*b.D34],
    'MP total':[p.mp,b.D41+b.D60+b.D80], 'DMI pred':[pred.dmi,b.D189]};
  let line=`#${i} ${c.breed} dim${c.dim} dp${c.dp} adj${c.adj}`;
  for(const [k,[m,x]] of Object.entries(rows)){ const d=pct(m,x); worst=Math.max(worst,Math.abs(d)); line+=` | ${k} ${m.toFixed(3)}/${x.toFixed(3)} (${d.toFixed(2)}%)`; }
  console.log(line);
});
console.log('WORST % diff vs BCNRM:',worst.toFixed(3));
