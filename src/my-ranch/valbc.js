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
// NASEM 2016 Table 12-1: NEg (Mcal/d) for a medium-frame steer, SBW 300 kg at 0.6/0.8/1.0/1.3 kg/d; 500 kg at 1.3
{ const cells=[[300,0.6,2.28],[300,0.8,3.13],[300,1.0,4.00],[300,1.3,5.33],[500,1.3,7.81],[200,1.0,2.95]]; let w=0;
  cells.forEach(([sbw,adg,neg])=>{ const r=FEED.retainedEnergy(0.891*sbw,0.956*adg); w=Math.max(w,Math.abs(r/neg-1)*100); });
  console.log(`Table 12-1 NEg: worst ${w.toFixed(2)}% (rounding)`); if(w>1) worst=Math.max(worst,w); }
console.log('WORST % diff (all checks):',worst.toFixed(3));
// NASEM 2016 Table 20-1 (Angus steer, 550-kg finished SBW, SRW 478): NEm, MP maintenance, NEg and MP for gain at SBW >= 350 kg
{ let w=0; const T={350:{nem:6.2,mpm:307,neg:[1.5,3.2,5,6.8,8.7],mpg:[129,246,358,466,571]},400:{nem:6.9,mpm:340,neg:[1.6,3.5,5.5,7.5,9.6],mpg:[120,226,326,423,516]},
    450:{nem:7.5,mpm:371,neg:[1.8,3.8,6,8.2,10.5],mpg:[111,207,296,381,463]},500:{nem:8.1,mpm:402,neg:[1.9,4.1,6.5,8.9,11.3],mpg:[102,188,267,341,412]}};
  for(const [sbw,t] of Object.entries(T)){ const m=Math.pow(+sbw,0.75), eq=sbw*478/550;
    w=Math.max(w,Math.abs(m*0.077/t.nem-1)*100*(t.nem>=6?1:0),Math.abs(m*3.8/t.mpm-1)*100);
    [0.4,0.8,1.2,1.6,2.0].forEach((adg,k)=>{ const re=FEED.retainedEnergy(0.891*eq,0.956*adg), np=adg*(268-29.4*re/adg), mp=np/FEED.mpToNp(eq);
      if(t.neg[k]>=3) w=Math.max(w,Math.abs(re/t.neg[k]-1)*100); w=Math.max(w,Math.abs(mp/t.mpg[k]-1)*100); }); }
  console.log(`Table 20-1 steer (350-500 kg): worst ${w.toFixed(2)}% (book rounds to 0.1 Mcal / 1 g)`); if(w>2.5) worst=Math.max(worst,w); }
console.log('WORST % diff (all checks):',worst.toFixed(3));
// NASEM 2016 Table 20-5 (550-kg Angus cow, 8-kg peak): milk at the end of each month since calving, maintenance NEm and MP
{ const book=[6.7,8.0,7.2,5.8,4.3,3.1,2.2,1.5,1.0,0.7,0.4,0.3], o={cowLb:550/0.96*2.2046,breed:'angus',bcs:5,peakMilkLb:8*2.2046,activity:0}; let w=0;
  book.forEach((y,m)=>{ const v=FEED.cowParams(o,Math.round((m+1)*30.4),0,null).milk; if(y>=1) w=Math.max(w,Math.abs(v/y-1)*100); });
  const p=FEED.cowParams(o,30,0,null); w=Math.max(w,Math.abs(p.nem/10.5-1)*100,Math.abs(p.mbw*3.8/432-1)*100);
  console.log(`Table 20-5 cow milk curve + maintenance: worst ${w.toFixed(2)}%`); if(w>2) worst=Math.max(worst,w); }
console.log('WORST % diff (all checks):',worst.toFixed(3));
// NASEM 2016 Table 13-7: NEm for pregnancy (38.5-kg calf, km 0.576)
{ const T=[[130,0.327],[160,0.634],[190,1.166],[220,2.027],[250,3.333],[280,5.174]], o={cowLb:1200,breed:'angus',bcs:5,peakMilkLb:18,activity:0,birthLb:38.5*2.2046}; let w=0;
  T.forEach(([dp,ne])=>{ const v=FEED.cowParams(o,0,dp,null).mey*0.576; w=Math.max(w,Math.abs(v/ne-1)*100); });
  console.log(`Table 13-7 pregnancy NEm: worst ${w.toFixed(2)}%`); if(w>1) worst=Math.max(worst,w); }
console.log('WORST % diff (all checks):',worst.toFixed(3));
