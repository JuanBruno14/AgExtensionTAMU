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
// Grazing intake factor (Eq. 19-97 to 19-99) vs. BCNRM Calc!D184, recalculated in LibreOffice (Imperial inputs: 2 ac/head, 30 days, 500/800/300 lb/ac)
[[560.431370770208,0.809371223777384,0.744311672515257],[896.690193232332,0.809371223777384,0.953373884542078],[336.258822462125,0.202342805944346,0.511968201379737]]
  .forEach(([fm,gu,x],i)=>{ const m=FEED.grazeFactor(fm,gu,30,480.95799691554,1.84276790612417), d=pct(m,x); worst=Math.max(worst,Math.abs(d));
    console.log(`GRAZE #${i} FM ${fm.toFixed(0)} kg/ha: ${m.toFixed(4)}/${x.toFixed(4)} (${d.toFixed(3)}%)`); });
console.log('WORST % diff vs BCNRM (incl. GRAZE):',worst.toFixed(3));
// NASEM 2016 Table 20-2 (growing bulls, maintenance) and Table 13-5 (Mcal to change one BCS)
{ const t=[[300,6.4,274],[500,9.4,402],[800,13.3,572]]; t.forEach(([sbw,nem,mp])=>{ const m=Math.pow(sbw,0.75), n=m*0.077*1.15, p=m*3.8;
    const d=Math.max(Math.abs(n/nem-1),Math.abs(p/mp-1))*100; console.log(`Table 20-2 bull ${sbw} kg: NEm ${n.toFixed(2)}/${nem}, MP ${p.toFixed(0)}/${mp} (${d.toFixed(2)}% rounding)`); if(d>1) worst=Math.max(worst,d); }); }
{ const sbw5=550, e=FEED.bodyEnergy(sbw5,5,5)-FEED.bodyEnergy(sbw5,5,4); console.log(`Table 13-5: 550 kg cow BCS 4->5 ${e.toFixed(0)} Mcal (book 228)`); if(Math.abs(e-228)>1.5) worst=Math.max(worst,100); }
console.log('WORST % diff (incl. book tables):',worst.toFixed(3));
