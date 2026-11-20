/* Retail Beef Sales: Sale Barn vs. Direct Sales. The model reproduces the Direct Beef Sell Live vs Direct spreadsheet. */
var DEFAULTS={heads:1,weight:1450,price:211,yield:0.625,marg:0.68,incl:0,qPrice:4.5,slaughter:0.23,cutwrap:1.37,qMkt:0.05,qHours:5,qCredit:1,qFreight:50,custFees:1.6,
dispatch:100,proc:1.6,further:0,pack:0.05,mkt:0.25,months:3,storage:0.09,cFreight:0,cHours:15,cCredit:3,freezer:35,lic:0,store:0,ship:0,over:0,other:0,
interest:7,qLabor:15,cLabor:30,roi:10};
var CUTS=[["Tenderloin",2,30,14.68,35.98],["Strip steak",4,14.99,12.62,26.42],["Top sirloin and other loin cuts",7.3,9,8.64,19.87],["Ribeye",8.1,16,15.66,28.89],["Chuck roasts, steaks, short ribs",12.7,8,8.19,12.84],["Round roasts and steaks",16.9,7.49,7.32,12.63],["Brisket",4.3,6,7.75,13.05],["Flank and skirt",2.2,10.89,12.99,19.36],["Ground beef and stew meat",42.5,6.49,5.77,10.78]];
function calc(v,cuts,extras){
  extras=extras||[];
  function ex(o,hot,mk){return extras.filter(function(e){return e.opt===o}).reduce(function(s,e){return s+(e.amount||0)*(e.unit==='head'?1:(e.unit==='carcass'?hot:mk))},0)}
  var W=v.weight,hot=W*v.yield,mk=hot*v.marg,value=v.price*W/100,r=v.interest/100,t=v.roi/100,incl=v.incl?1:0;
  var q={};
  q.rev=v.qPrice*hot; q.slaughter=incl*v.slaughter*hot; q.cutwrap=incl*v.cutwrap*hot; q.mkt=v.qMkt*hot;
  q.labor=v.qHours*v.qLabor; q.freight=v.qFreight;
  q.extra=ex('q',hot,mk); q.op=q.slaughter+q.cutwrap+q.mkt+q.labor+q.freight+q.extra;
  q.items=[['Slaughter, if included',q.slaughter],['Cut, wrap, freeze, if included',q.cutwrap],['Marketing',q.mkt],['Owner labor',q.labor],['Freight',q.freight],['Your own costs',q.extra]];
  q.total=q.op+value; q.interest=(q.total-q.labor)*r*v.qCredit/12; q.totalI=q.total+q.interest;
  q.net=q.rev-q.totalI; q.roi=q.net/q.totalI; q.be=q.totalI/hot; q.target=q.totalI*(1+t)/hot;
  q.custFees=(1-incl)*v.custFees*hot; q.custValue=(q.rev+q.custFees)/mk;
  var sh=0,sp=0; cuts.forEach(function(c){sh+=c.share;sp+=c.price*c.share;});
  var avg=sh>0?sp/sh:0;
  var c={avg:avg,shareTotal:sh};
  c.rev=avg*mk; c.dispatch=v.dispatch; c.proc=v.proc*hot; c.further=v.further; c.pack=v.pack*mk; c.mkt=v.mkt*mk;
  c.storage=v.storage*mk*v.months/12; c.freight=v.cFreight*mk; c.store=v.store*mk; c.ship=v.ship*mk; c.over=v.over*mk; c.other=v.other*mk;
  c.freezer=v.freezer; c.lic=v.lic; c.labor=v.cHours*v.cLabor;
  c.extra=ex('c',hot,mk); c.op=c.dispatch+c.proc+c.further+c.pack+c.mkt+c.storage+c.freight+c.store+c.ship+c.over+c.other+c.freezer+c.lic+c.labor+c.extra;
  c.items=[['Dispatch fee',c.dispatch],['Processing fee',c.proc],['Further processing',c.further],['Packaging and labeling',c.pack],['Marketing and promotion',c.mkt],['Storage',c.storage],['Freight',c.freight],['Store front and distribution',c.store],['Shipping',c.ship],['Operational overhead',c.over],['Other',c.other],['Freezer depreciation',c.freezer],['Licenses, permits, insurance',c.lic],['Labor',c.labor],['Your own costs',c.extra]];
  c.total=c.op+value; c.interest=(c.total-c.labor-c.freezer)*r*v.cCredit/12; c.totalI=c.total+c.interest;
  c.net=c.rev-c.totalI; c.roi=c.net/c.totalI; c.be=c.totalI/mk; c.target=c.totalI*(1+t)/mk;
  c.rows=cuts.map(function(x){
    var lb=mk*x.share/ (sh>0?sh:1), rev=lb*x.price;
    return {name:x.name,lb:lb,price:x.price,rev:rev,be:c.rev>0?x.price*c.totalI/c.rev:0,tg:c.rev>0?x.price*c.totalI*(1+t)/c.rev:0,only:lb>0?(c.totalI*(1+t)-(c.rev-rev))/lb:0};
  });
  var best=Math.max(q.net,c.net)<=0?"barn":(q.net>=c.net?"quarter":"cut");
  return {hot:hot,mk:mk,value:value,q:q,c:c,best:best,heads:v.heads};
}
if(typeof module!=="undefined")module.exports={calc:calc,DEFAULTS:DEFAULTS,CUTS:CUTS};

(function(){
var $=function(i){return document.getElementById(i)};
var v=JSON.parse(JSON.stringify(DEFAULTS));
var cuts=CUTS.map(function(c){return{name:c[0],share:c[1],price:c[2],g:c[3],gf:c[4]}});
var extras=[];
var cuts0=JSON.parse(JSON.stringify(cuts));
var STORE="back40RetailBeefSales";
try{var sv=JSON.parse(localStorage.getItem(STORE)||"null");if(sv&&typeof sv==="object"){
if(sv.v)Object.keys(DEFAULTS).forEach(function(k){var x=sv.v[k];if(typeof x==="number"&&isFinite(x)&&x>=0)v[k]=x});
if(Array.isArray(sv.cuts)&&sv.cuts.length===cuts.length)sv.cuts.forEach(function(c,i){if(c&&isFinite(c.share)&&isFinite(c.price)&&c.share>=0&&c.price>=0){cuts[i].share=+c.share;cuts[i].price=+c.price}});
if(Array.isArray(sv.extras))sv.extras.slice(0,30).forEach(function(e){if(e&&typeof e.name==="string"&&isFinite(e.amount)&&e.amount>=0&&["head","carcass","sold"].indexOf(e.unit)>-1&&["q","c"].indexOf(e.opt)>-1)extras.push({name:e.name.slice(0,60),amount:+e.amount,unit:e.unit,opt:e.opt})})}}catch(e){}
function save(){try{localStorage.setItem(STORE,JSON.stringify({v:v,cuts:cuts.map(function(c){return{share:c.share,price:c.price}}),extras:extras}))}catch(e){}}
function fmt(x,d){d=d==null?0:d;var s=Math.abs(x).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});return(x<-0.0000001&&parseFloat(s.replace(/,/g,""))!==0?"−":"")+"$"+s}
function pct(x){var s=(Math.abs(x)*100).toFixed(1);return(x<0&&s!=="0.0"?"−":"")+s+"%"}
function cl(x){return x>0.005?"pos":(x<-0.005?"neg":"")}
var F={ // key,label,unit,assumption
heads:["Heads","head"],weight:["Average fed steer weight","lb",1],price:["Fed steer price at the sale barn","$/cwt"],
qPrice:["Price by the quarter","$/lb carcass",1],custFees:["Customer processing fees","$/lb carcass"],roi:["Target return over the sale barn","% of total cost"],
yield:["Hot carcass yield","of live wt"],marg:["Marketable beef","of hot carcass"],interest:["Interest rate","% per year"],qLabor:["Value of your labor","$/hour",1],cLabor:["Value of your labor","$/hour",1],
slaughter:["Slaughter, if included","$/lb carcass",1],cutwrap:["Cut, wrap, freeze, if included","$/lb carcass",1],qMkt:["Marketing","$/lb carcass",1],qHours:["Owner labor","hours/steer",1],qCredit:["Credit line outstanding","months",1],qFreight:["Freight","$/head"],
dispatch:["Dispatch fee","$/head"],proc:["Processing fee","$/lb hot"],further:["Further processing","$/steer",1],pack:["Packaging and labeling","$/lb sold",1],mkt:["Marketing and promotion","$/lb sold",1],months:["Months in storage","months",1],storage:["Storage cost","$/lb per year"],cFreight:["Freight","$/lb",1],cHours:["Labor","hours/steer",1],cCredit:["Credit line outstanding","months",1],freezer:["Freezer depreciation","$/head",1],lic:["Licenses, permits, insurance","$/head",1],store:["Store front and distribution","$/lb",1],ship:["Shipping","$/lb",1],over:["Operational overhead","$/lb",1],other:["Other","$/lb",1]};
var NOTES={price:"Update with the current market.",yield:"Where's the Beef?, Ch. 11 (0.625 in the halves/quarters formula).",marg:"Where's the Beef?, Ch. 11.",custFees:"Entered by the producer.",slaughter:"Where's the Beef? $0.19/lb (2022), adjusted to today.",cutwrap:"Where's the Beef? $1.15/lb (2022), adjusted to today.",proc:"Charged on hot carcass weight.",storage:"Where's the Beef?, Ch. 12: 16 ft\u00b3 per steer, $3.13/ft\u00b3 per year, 36 lb/ft\u00b3.",freezer:"$700 freezer, 10 years, two steers a year.",interest:"Livestock operating interest rate used in the 2026 enterprise budgets.",qLabor:"Setting up and delivering a quarter or half takes less skill than cutting. Many 2026 budgets use $15/hour.",cLabor:"Cutting every muscle and selling retail takes more skill than selling quarters, so it is valued higher. Set the value of your own time.",roi:"Incremental return you want over the sale barn. It sets the price to ask."};
var G={"g-steer":["heads","weight","price"],"g-q":["qPrice"],"g-fees":["custFees"],"g-goal":["roi"],"g-fin":["yield","marg","interest"],"g-cq":["slaughter","cutwrap","qMkt","qHours","qLabor","qCredit","qFreight"],"g-cc":["dispatch","proc","further","pack","mkt","months","storage","cFreight","cHours","cLabor","cCredit","freezer","lic","store","ship","over","other"]};
function build(){Object.keys(G).forEach(function(g){var h="";G[g].forEach(function(k){var f=F[k];
h+='<div class="f"><label for="i-'+k+'">'+f[0]+(f[2]?'<span class="a">Assumption</span>':'')+'</label><div class="row"><input id="i-'+k+'" data-k="'+k+'" inputmode="decimal" autocomplete="off"><span class="u">'+f[1]+'</span></div>'+(NOTES[k]?'<div class="hint">'+NOTES[k]+'</div>':'')+'</div>'});$(g).innerHTML=h});
var tb="";cuts.forEach(function(c,i){tb+='<tr><td>'+c.name+'</td><td><input data-c="'+i+'" data-f="share" aria-label="Share of '+c.name+'"></td><td><input data-c="'+i+'" data-f="price" aria-label="Price of '+c.name+'"></td><td class="pos2" id="c-pos'+i+'"></td><td class="tg" id="c-tg'+i+'"></td><td class="dt" id="c-lb'+i+'"></td><td class="dt mut">$'+c.g.toFixed(2)+'</td><td class="dt mut">$'+c.gf.toFixed(2)+'</td><td class="dt" id="c-be'+i+'"></td><td class="dt" id="c-on'+i+'"></td></tr>'});
tb+='<tr class="tot"><td>Whole steer</td><td id="c-sh"></td><td id="c-av"></td><td></td><td class="tg" id="c-tg"></td><td class="dt" id="c-lb"></td><td class="dt mut">$8.05</td><td class="dt mut">$14.90</td><td class="dt" id="c-be"></td><td class="dt"></td></tr>';
document.querySelector("#cuts tbody").innerHTML=tb}
function sync(){Object.keys(F).forEach(function(k){var e=$("i-"+k);if(e&&document.activeElement!==e)e.value=v[k]});
document.querySelectorAll("[data-c]").forEach(function(e){if(document.activeElement!==e)e.value=cuts[e.dataset.c][e.dataset.f]});
$("b0").setAttribute("aria-pressed",!v.incl);$("b1").setAttribute("aria-pressed",!!v.incl)}
function row(l,a,b,c){return"<tr"+(c?' class="'+c+'"':"")+"><td>"+l+"</td><td>"+a+"</td><td>"+b+"</td></tr>"}
function render(){
var r=calc(v,cuts,extras),q=r.q,c=r.c,H=v.heads>0?v.heads:1;
$("valueHead").innerHTML=fmt(r.value,2)+" <small>/ head</small>";$("avgPrice").innerHTML=fmt(c.avg,2)+" <small>/ lb sold</small>";
var vb=$("vbig"),vn=$("vnum"),vs=$("vsub"),bn=r.best==="quarter"?q.net:c.net;
if(r.best==="barn"){vb.textContent="Sell at the sale barn";vn.textContent=fmt(0);vs.textContent="neither direct option beats the barn"}
else{vb.textContent=r.best==="quarter"?"Sell by the quarter":"Sell by the cut";vn.textContent="+"+fmt(bn*H);vs.textContent="more than the sale barn"+(H>1?", "+fmt(bn)+" per head":", per head")}
function ab(a,b){var p=(a-b)/a;return pct(Math.abs(p))+(p>=0?" above":" below")}
var qw="By the quarter you need at least "+fmt(q.be,2)+" /lb carcass to tie the sale barn; you assumed "+fmt(v.qPrice,2)+" ("+ab(v.qPrice,q.be)+").";
var cw="By the cut you need an average of at least "+fmt(c.be,2)+" /lb sold; your cuts average "+fmt(c.avg,2)+" ("+ab(c.avg,c.be)+").";
$("vwhy").textContent=r.best==="quarter"?qw:(r.best==="cut"?cw:qw+" "+cw);
$("sbTxt").textContent=vb.textContent+(r.best==="barn"?"":" \u00b7 "+vn.textContent);$("sbSub").textContent=r.best==="barn"?"neither direct option beats the barn":vs.textContent;
$("vsmall").textContent="Verdict for "+H+(H===1?" head":" head, total");
function opt(t,s,x,tg,tu,cv,best){return'<div class="opt'+(best?" best":"")+'"><header><div><h3>'+t+'</h3><p>'+s+'</p></div><span class="tag">'+(best?"Best option":"Option")+'</span></header>'+
'<div class="stat"><div class="l">Net profit per head, above the sale barn</div><div class="v '+cl(x.net)+'">'+fmt(x.net)+'</div></div>'+
(H>1?'<div class="stat"><div class="l">Net profit, all '+H+' head</div><div class="v '+cl(x.net)+'">'+fmt(x.net*H)+'</div></div>':'')+
'<div class="stat"><div class="l">Break-even price (ties the sale barn)</div><div class="v">'+fmt(x.be,2)+'</div><div class="s">'+tu+'</div></div>'+
'<div class="stat"><div class="l">Price to ask for your target return</div><div class="v">'+fmt(tg,2)+'</div><div class="s">'+tu+'</div></div>'+
'<div class="mini"><span>Incremental return <b class="'+cl(x.net)+'">'+pct(x.roi)+'</b></span><span>Your customer pays <b>'+fmt(cv,2)+' /lb</b></span></div></div>'}
$("opts").innerHTML=opt("By the quarter or half","Customer buys a share of the carcass",q,q.target,"per lb carcass",q.custValue,r.best==="quarter")+opt("By the cut","You sell steaks, roasts and ground beef",c,c.target,"average, per lb sold",c.avg,r.best==="cut");
var mx=Math.max(q.rev,q.totalI,c.rev,c.totalI)||1;
function bar(l,rv,co){return'<div class="bar"><b>'+l+'</b><div class="bl"><span>Revenue</span><div><i class="rev" style="width:'+(rv/mx*100).toFixed(1)+'%"></i></div><span>'+fmt(rv)+'</span></div><div class="bl"><span>Total cost</span><div><i class="cost" style="width:'+(co/mx*100).toFixed(1)+'%"></i></div><span>'+fmt(co)+'</span></div></div>'}
$("bars").innerHTML=bar("By the quarter",q.rev,q.totalI)+bar("By the cut",c.rev,c.totalI)+'<p class="note">Total cost includes what the steer would have brought at the sale barn. A revenue bar longer than the cost bar means you beat the sale barn.</p>';
$("cost").innerHTML="<thead><tr><th>Per head</th><th>By the quarter</th><th>By the cut</th></tr></thead><tbody>"+row("Revenue",fmt(q.rev),fmt(c.rev))+row("Operating costs",fmt(q.op),fmt(c.op))+row("Value of the steer at the sale barn",fmt(r.value,2),fmt(r.value,2))+row("Interest",fmt(q.interest),fmt(c.interest))+row("Total cost with interest",fmt(q.totalI),fmt(c.totalI),"tot")+row("Net profit per head",fmt(q.net),fmt(c.net),"tot")+(H>1?row("Net profit, all "+H+" head",fmt(q.net*H),fmt(c.net*H),"tot"):"")+"</tbody>";
var sh=0,lbT=0;c.rows.forEach(function(x,i){$("c-lb"+i).textContent=x.lb.toFixed(1);$("c-be"+i).textContent="$"+x.be.toFixed(2);$("c-tg"+i).textContent="$"+x.tg.toFixed(2);$("c-on"+i).textContent="$"+x.only.toFixed(2);var cp=cuts[i],po=$("c-pos"+i);if(cp.price<cp.g){po.textContent="Below grocery price";po.className="pos2 lo"}else if(cp.price<=cp.gf){po.textContent="Between grocery and grass-fed";po.className="pos2"}else{po.textContent="Above grass-fed price";po.className="pos2 hi"}sh+=cuts[i].share;lbT+=x.lb});
$("c-sh").textContent=sh.toFixed(1)+"%";$("c-lb").textContent=lbT.toFixed(1);$("c-av").textContent="$"+c.avg.toFixed(2);$("c-be").textContent="$"+c.be.toFixed(2);$("c-tg").textContent="$"+c.target.toFixed(2);
$("shareWarn").hidden=Math.abs(sh-100)<0.05;
function itTable(id,title,info,items,op,tail){var h="<thead><tr><th>"+title+"</th><th>$ per head</th></tr></thead><tbody>";
info.forEach(function(i){h+='<tr><td class="info">'+i[0]+'</td><td class="info">'+i[1]+'</td></tr>'});
items.forEach(function(i){h+="<tr><td>"+i[0]+"</td><td>"+fmt(i[1],2)+"</td></tr>"});
h+='<tr class="tot"><td>Operating costs</td><td>'+fmt(op,2)+"</td></tr>"+(tail||"")+"</tbody>";$(id).innerHTML=h}
itTable("itq","By the quarter",[["Hot carcass weight",r.hot.toFixed(1)+" lb"],["Marketable beef",r.mk.toFixed(1)+" lb"]],q.items,q.op,'<tr><td class="info">Customer processing fees (paid by the customer)</td><td class="info">'+fmt(q.custFees,2)+"</td></tr>");
itTable("itc","By the cut",[["Hot carcass weight",r.hot.toFixed(1)+" lb"],["Marketable beef",r.mk.toFixed(1)+" lb"]],c.items,c.op);
save();
}
function num(s){var n=parseFloat(String(s).replace(/,/g,""));return isFinite(n)&&n>=0?n:0}
document.addEventListener("input",function(e){var t=e.target;
if(t.dataset.k){var k=t.dataset.k;v[k]=num(t.value);if(k==="weight"&&v[k]<1)v[k]=1}
else if(t.dataset.c){cuts[t.dataset.c][t.dataset.f]=num(t.value)}else if(t.dataset.x!=null){var ex=extras[t.dataset.x];ex[t.dataset.xf]=t.dataset.xf==="amount"?num(t.value):t.value}else return;render()});
function exRender(){var h="";extras.forEach(function(e,i){h+='<div class="xrow"><label class="note" for="xn'+i+'">Cost name</label><input id="xn'+i+'" data-x="'+i+'" data-xf="name" value="'+e.name.replace(/"/g,"&quot;")+'"><div class="two2"><div><label class="note" for="xa'+i+'">Amount</label><input id="xa'+i+'" inputmode="decimal" data-x="'+i+'" data-xf="amount" value="'+e.amount+'"></div><div><label class="note" for="xu'+i+'">Unit</label><select id="xu'+i+'" data-x="'+i+'" data-xf="unit"><option value="head"'+(e.unit==="head"?" selected":"")+'>$/head</option><option value="carcass"'+(e.unit==="carcass"?" selected":"")+'>$/lb carcass</option><option value="sold"'+(e.unit==="sold"?" selected":"")+'>$/lb sold</option></select></div></div><label class="note" for="xo'+i+'">Applies to</label><select id="xo'+i+'" data-x="'+i+'" data-xf="opt"><option value="q"'+(e.opt==="q"?" selected":"")+'>By the quarter or half</option><option value="c"'+(e.opt==="c"?" selected":"")+'>By the cut</option></select><button type="button" class="xdel" data-xdel="'+i+'">Remove this cost</button></div>'});
$("exList").innerHTML=h;$("exCount").textContent=extras.length+(extras.length===1?" item":" items")}
$("exAdd").onclick=function(){extras.push({name:"New cost",amount:0,unit:"head",opt:"q"});exRender();render()};
$("exList").addEventListener("click",function(e){var d=e.target.dataset.xdel;if(d!=null){extras.splice(+d,1);exRender();render()}});
$("cutsMore").onclick=function(){var t=$("cuts"),on=!t.classList.contains("show");t.classList.toggle("show",on);this.setAttribute("aria-expanded",on);this.textContent=on?"Hide the extra columns":"Show USDA prices, break-even and more"};
try{if("IntersectionObserver"in window){var vOut=false,fIn=false;function bar(){$("sumbar").classList.toggle("on",vOut&&!fIn)}
new IntersectionObserver(function(e){vOut=!e[0].isIntersecting;bar()}).observe(document.querySelector(".verdict"));
new IntersectionObserver(function(e){fIn=e[0].isIntersecting;bar()}).observe(document.querySelector("footer"))}}catch(e){}
$("b0").onclick=function(){v.incl=0;sync();render()};$("b1").onclick=function(){v.incl=1;sync();render()};
$("reset").onclick=function(){v=JSON.parse(JSON.stringify(DEFAULTS));cuts=JSON.parse(JSON.stringify(cuts0));extras=[];try{localStorage.removeItem(STORE)}catch(e){}exRender();sync();render()};
build();exRender();sync();render();
})();
(function(){var KEY='tamuDecisionAidsTheme',t=document.getElementById('themeToggle');if(!t)return;var s=null;try{s=localStorage.getItem(KEY)}catch(e){}
if(s==='light'||s==='dark')document.documentElement.setAttribute('data-theme',s);
function cur(){var a=document.documentElement.getAttribute('data-theme');if(a==='light'||a==='dark')return a;return(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}
function paint(){var d=cur()==='dark';t.textContent=d?'\u2600\uFE0F':'\uD83C\uDF19';t.setAttribute('aria-label',d?'Switch to light mode':'Switch to dark mode');t.title=t.getAttribute('aria-label')}
t.addEventListener('click',function(){var n=cur()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);try{localStorage.setItem(KEY,n)}catch(e){}paint()});paint()})();
