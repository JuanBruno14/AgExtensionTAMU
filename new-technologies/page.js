/* New Technologies: Virtual Fence Collars. One page, two tabs, like Retail Beef Sales:
   tab 1 holds the numbers, tab 2 the results. The summary bar keeps showing the live result while editing. */
(function(){
var v=loadState();
// key: [label, unit, assumption?, hint]
var F={
 cows:["Cows","head"],bulls:["Bulls","head"],acres:["Acres","acres"],weaned:["Calves weaned","% of cows"],
 price:["Calf price","$/cwt",0,"Tulia, TX auction, Oct. 2026: steers $430, heifers $376."],
 labor:["Cost of labor","$/hour",1,"Texas ranch hand $15.67/hour (US Dept. of Labor, 2026) plus payroll costs."],
 collarPrice:["Collar price","$/collar"],fee:["Yearly fee","$/collar per year"],
 towers:["Towers","towers",1,"Auto: about 1 per 1,500 acres. Type a number to change it."],towerPrice:["Price per tower","$/tower"],
 spare:["Spare collars","% extra",1,"About 5% more collars than cows and bulls."],collarLife:["Collar life","years",1],towerLife:["Tower life","years",1],
 hours:["Labor hours saved (checking, moving, gathering)","hours/year",1,"About 5 hours a week. University of Arizona Extension used only 80."],
 trips:["Truck or ATV trips saved","trips/year",1],tripCost:["Cost per trip","$/trip",1,"25 miles at $0.70 a mile."],
 buildMiles:["Miles of cross-fence you will NOT build","miles",1,"Count only fence you would really build."],
 fenceCost:["Cost to build fence","$/mile",1,"5-strand barbed wire in Texas, about $2.95 a foot."],
 fenceLife:["Fence life","years",1],maintMiles:["Miles of fence you stop maintaining","miles",1],
 maintPct:["Yearly fence upkeep","% of build cost",1,"Upkeep is about 2% of build cost per year."],
 gain:["Extra weaning weight per calf","lb/calf",1,"Not proven. One 2025 study found 9% LESS gain with collars. Leave at 0 unless you have your own results."],
 hayDays:["Days of hay you would skip","days/year",1,"Better rotation. Leave at 0 unless you expect it."],
 hayCost:["Hay cost avoided","$/cow per day",1,"25 lb of hay at $120 a ton."]
};
var G={"g-ranch":["cows","bulls","acres","weaned","price","labor"],
 "g-tech":["collarPrice","fee","towers","towerPrice"],
 "g-sav":["hours","trips","tripCost","buildMiles","maintMiles"],
 "g-fence":["fenceCost","fenceLife","maintPct"],
 "g-life":["spare","collarLife","towerLife"],
 "g-extra":["gain","hayDays","hayCost"]};
function build(){
  Object.keys(G).forEach(function(g){var h="";G[g].forEach(function(k){var f=F[k];
    h+='<div class="f"><label for="i-'+k+'">'+f[0]+(f[2]?'<span class="a">Assumption</span>':'')+'</label><div class="row"><input id="i-'+k+'" data-k="'+k+'" inputmode="decimal" autocomplete="off"><span class="u">'+f[1]+'</span></div>'+(f[3]?'<div class="hint">'+f[3]+'</div>':'')+'</div>'});
    $(g).innerHTML=h});
  $("vendor").innerHTML=VENDORS.map(function(o){return'<option value="'+o.id+'">'+o.name+'</option>'}).join("");
}
function sync(){
  var r=calc(v);
  Object.keys(F).forEach(function(k){var e=$("i-"+k);if(!e||document.activeElement===e)return;
    e.value=k==="towers"?(v.towers==null?r.towersAuto:v.towers):v[k]});
  if(document.activeElement!==$("vendor"))$("vendor").value=v.vendor;
  var o=vendorById(v.vendor);$("vprice").textContent=o.price+" "+o.watch+".";
}
function num(s){var n=parseFloat(String(s).replace(/,/g,""));return isFinite(n)&&n>=0?n:0}
document.addEventListener("input",function(e){var t=e.target;
  if(t.dataset.k){var k=t.dataset.k;if(k==="towers"&&String(t.value).trim()==="")v.towers=null;else v[k]=num(t.value);saveState(v);sync();render()}});
$("vendor").addEventListener("change",function(){var o=vendorById(this.value);
  v.vendor=o.id;v.collarPrice=o.collarPrice;v.fee=o.fee;v.towerPrice=o.towerPrice;v.towers=null;saveState(v);sync();render()});
$("reset").onclick=function(){v=JSON.parse(JSON.stringify(DEFAULTS));clearState();sync();render()};

function render(){
var r=calc(v),ven=vendorById(v.vendor),c=r.cost,s=r.sav;
var N=function(x){return x.toLocaleString("en-US")};
$("summary").innerHTML="<b>"+ven.name+"</b> &middot; "+N(v.cows)+" cows"+(v.bulls?", "+N(v.bulls)+" bulls":"")+" &middot; "+N(v.acres)+" acres &middot; calves at "+fmt(v.price)+"/cwt";
var big=r.pays?"Yes, it pays":"Not yet";
$("vbig").textContent=big;
$("vnum").textContent=sgn(r.net);
$("vsub").textContent="per year, "+sgn(r.perCow,2)+" per cow";
$("vsmall").textContent="Verdict for "+N(v.cows)+" cows on "+N(v.acres)+" acres";
var why="With "+ven.name+", collars cost "+fmt(c.total)+" a year and save "+fmt(r.benefit)+".";
if(r.pays){why+=" You could pay up to "+fmt(r.beFee,2)+" per collar per year and still break even."}
else{why+=" To break even, the yearly fee would have to be "+(r.beFee>0?fmt(r.beFee,2)+" per collar (you entered "+fmt(v.fee,2)+")":"below zero, so no fee would make it pay at these savings")+
  (r.beWeight>0?", or each calf would need to weigh "+lb(r.beWeight)+" lb more at weaning, which is not proven":"")+"."}
$("vwhy").textContent=why;
$("sbTxt").textContent=big+" \u00b7 "+sgn(r.net);$("sbSub").textContent="per year, "+sgn(r.perCow,2)+" per cow";

function stat(l,val,sub,cls){return'<div class="stat"><div class="l">'+l+'</div><div class="v '+(cls||"")+'">'+val+'</div><div class="s">'+sub+'</div></div>'}
$("opts").innerHTML=
 '<div class="opt"><header><div><h3>What it costs</h3><p>Per year</p></div><span class="tag">Cost</span></header>'+
  stat("Yearly cost",fmt(c.total),"Collars, fees and towers, spread over their life")+
  stat("Cash out in year 1",fmt(r.cash1),ven.yr1?"Collars and towers; the first-year fee is in the collar price":"Collars, towers and the first yearly fee")+
  '<div class="mini"><span>Collars <b>'+N(r.collars)+'</b></span><span>Towers <b>'+r.towers+'</b></span></div></div>'+
 '<div class="opt"><header><div><h3>What it saves</h3><p>Per year</p></div><span class="tag">Savings</span></header>'+
  stat("Labor, trips and fence",fmt(s.total),"Your own work and miles you stop driving or fixing","pos")+
  stat("Extra income (optional)",fmt(r.wean+r.hay),"Heavier calves and hay you skip. Both start at 0",r.wean+r.hay>0?"pos":"")+
  '<div class="mini"><span>Calves sold <b>'+N(r.calves)+'</b></span></div></div>'+
 '<div class="opt'+(r.pays?" best":"")+'"><header><div><h3>What would make it pay</h3><p>Break-even</p></div><span class="tag">'+(r.pays?"Pays":"Break-even")+'</span></header>'+
  stat("Highest yearly fee that still breaks even",r.beFee>0?fmt(r.beFee,2):"None","per collar. Use it when you negotiate a quote")+
  stat("Extra weaning weight needed",r.pays?"0 lb":lb(r.beWeight)+" lb","per calf, if nothing else changes. Not proven")+
  '<div class="mini"><span>Net per year <b class="'+cl(r.net)+'">'+sgn(r.net)+'</b></span></div></div>';

var mx=Math.max(r.benefit,c.total)||1;
function bar(l,val,cls){return'<div class="bl"><span>'+l+'</span><div><i class="'+cls+'" style="width:'+(val/mx*100).toFixed(1)+'%"></i></div><span>'+fmt(val)+'</span></div>'}
$("bars").innerHTML='<div class="bar"><b>One year</b>'+bar("Savings",r.benefit,"rev")+bar("Cost",c.total,"cost")+'</div>';

function row(l,a,b,k){return"<tr"+(k?' class="'+k+'"':"")+"><td>"+l+"</td><td>"+a+"</td><td>"+b+"</td></tr>"}
function pc(x){return r.cows>0?fmt(x/r.cows,2):"\u2013"}
var t="<thead><tr><th>Item</th><th>Per year</th><th>Per cow</th></tr></thead><tbody>";
t+=row("Collars ("+v.collarLife+"-year life)",fmt(c.collars),pc(c.collars));
t+=row("Yearly fees",fmt(c.fees),pc(c.fees));
t+=row("Towers ("+v.towerLife+"-year life)",fmt(c.towers),pc(c.towers));
t+=row("Total cost",fmt(c.total),pc(c.total),"base");
t+=row("Labor saved",fmt(s.labor),pc(s.labor));
t+=row("Trips saved",fmt(s.trips),pc(s.trips));
t+=row("Fence you stop maintaining",fmt(s.maint),pc(s.maint));
t+=row("Fence you do not build ("+v.fenceLife+"-year life)",fmt(s.build),pc(s.build));
t+=row("Hay you skip",fmt(r.hay),pc(r.hay));
t+=row("Extra weaning income",fmt(r.wean),pc(r.wean));
t+=row("Total savings",fmt(r.benefit),pc(r.benefit),"base");
t+=row("Net per year",'<span class="'+cl(r.net)+'">'+sgn(r.net)+'</span>','<span class="'+cl(r.net)+'">'+sgn(r.perCow,2)+'</span>',"tot");
$("lines").innerHTML=t+"</tbody>";

var vt="<thead><tr><th>Vendor</th><th>Yearly cost</th><th>Net per year</th><th>Per cow</th><th>Cash in year 1</th><th>Published price</th></tr></thead><tbody>";
VENDORS.forEach(function(o){
  var w=JSON.parse(JSON.stringify(v));w.vendor=o.id;w.collarPrice=o.collarPrice;w.fee=o.fee;w.towerPrice=o.towerPrice;w.towers=null;
  var x=calc(w);
  vt+='<tr'+(o.id===v.vendor?' class="base"':"")+'><td>'+o.name+(o.id===v.vendor?" (selected)":"")+'</td><td>'+fmt(x.cost.total)+'</td><td class="'+cl(x.net)+'">'+sgn(x.net)+'</td><td class="'+cl(x.net)+'">'+sgn(x.perCow,2)+'</td><td>'+fmt(x.cash1)+'</td><td class="pos2">'+o.price+" "+o.watch+".</td></tr>"});
$("vendors").innerHTML=vt+"</tbody>";

}
try{if("IntersectionObserver"in window){var vOut=false,fIn=false;function bar2(){$("sumbar").classList.toggle("on",vOut&&!fIn)}
  new IntersectionObserver(function(e){vOut=!e[0].isIntersecting;bar2()}).observe(document.querySelector(".verdict"));
  new IntersectionObserver(function(e){fIn=e[0].isIntersecting;bar2()}).observe(document.querySelector("footer"))}}catch(e){}

(function(){var t1=$("tab1"),t2=$("tab2"),p1=$("p1"),p2=$("p2");
function show(n,focus){var one=n===1;t1.setAttribute("aria-selected",one);t2.setAttribute("aria-selected",!one);t1.tabIndex=one?0:-1;t2.tabIndex=one?-1:0;p1.hidden=!one;p2.hidden=one;try{window.dispatchEvent(new Event("resize"))}catch(e){}if(focus)(one?t1:t2).focus();var bar=document.querySelector(".vf .tabs");try{var r=bar.getBoundingClientRect();if(r.top<0||r.top>window.innerHeight*0.5)bar.scrollIntoView({block:"start"})}catch(e){}}
t1.addEventListener("click",function(){show(1)});t2.addEventListener("click",function(){show(2)});
[t1,t2].forEach(function(b){b.addEventListener("keydown",function(e){if(e.key==="ArrowRight"||e.key==="ArrowLeft"||e.key==="Home"||e.key==="End"){e.preventDefault();show((e.key==="ArrowLeft"||e.key==="Home")?1:2,true)}})});
$("toRes").addEventListener("click",function(){show(2)});$("toNums").addEventListener("click",function(){show(1)});
$("toNums2").addEventListener("click",function(){show(1)});
})();
build();sync();render();
})();
