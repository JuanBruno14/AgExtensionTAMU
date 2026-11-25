/* New Technologies: Virtual Fence Collars (one-year view).
   The model follows the Beef_Cattle_Collars_Texas spreadsheet: cost per year uses the "average cost per year"
   line (towers spread over their life), savings are labor, trips and fence, and the result is savings plus any
   extra weaning income minus cost. Nothing here looks ahead more than one year. */
var DEFAULTS={cows:300,bulls:0,acres:5000,weaned:88,price:400,labor:18,
  vendor:"halter",collarPrice:0,fee:79,towerPrice:4500,towers:null,spare:5,collarLife:7,towerLife:10,
  hours:240,trips:80,tripCost:17.5,buildMiles:4,fenceCost:15600,fenceLife:30,maintMiles:8,maintPct:2,
  gain:0,hayDays:0,hayCost:1.5};
var ACRES_PER_TOWER=1500;
var VENDORS=[
  {id:"halter",name:"Halter, with towers",collarPrice:0,fee:79,towerPrice:4500,towers:true,yr1:false,
   price:"Collar included. $72–79 a year. Towers $4,500 each.",watch:"Most expensive per year, simplest"},
  {id:"halter-sat",name:"Halter, satellite (no towers)",collarPrice:0,fee:96,towerPrice:0,towers:false,yr1:false,
   price:"Collar included. About $96 a year. No towers.",watch:"No towers to build, higher yearly fee"},
  {id:"nofence",name:"Nofence",collarPrice:319,fee:40,towerPrice:0,towers:false,yr1:true,
   price:"Collar $289–349, first year included. $35–45 a year after. No towers.",watch:"Needs cell signal. Pay up front"},
  {id:"gallagher",name:"Gallagher eShepherd",collarPrice:275,fee:21,towerPrice:5500,towers:true,yr1:false,
   price:"Collar $250–300. $18–24 a year. Towers $5,000–6,000 each.",watch:"Pay up front"},
  {id:"herdmanager",name:"HerdManager",collarPrice:40,fee:20,towerPrice:11250,towers:true,yr1:false,
   price:"Collar $40. Battery $10 every 6 months ($20 a year). Towers $10,000–12,500 each.",watch:"Battery every 6 months: you gather each cow twice a year"}
];
function vendorById(id){for(var i=0;i<VENDORS.length;i++)if(VENDORS[i].id===id)return VENDORS[i];return VENDORS[0]}

function calc(v){
  var ven=vendorById(v.vendor);
  var collars=Math.ceil((v.cows+v.bulls)*(100+v.spare)/100-1e-9);
  var calves=Math.round(v.cows*v.weaned/100);
  var towersAuto=ven.towers?Math.ceil(v.acres/ACRES_PER_TOWER-1e-9):0;
  var towers=v.towers==null?towersAuto:v.towers;
  var cost={};
  cost.collars=v.collarLife>0?collars*v.collarPrice/v.collarLife:0;
  cost.fees=collars*v.fee;
  cost.towers=v.towerLife>0?towers*v.towerPrice/v.towerLife:0;
  cost.total=cost.collars+cost.fees+cost.towers;
  var cash1=collars*v.collarPrice+towers*v.towerPrice+(ven.yr1?0:collars*v.fee);
  var sav={};
  sav.labor=v.hours*v.labor;
  sav.trips=v.trips*v.tripCost;
  sav.maint=v.maintMiles*v.fenceCost*v.maintPct/100;
  sav.build=v.fenceLife>0?v.buildMiles*v.fenceCost/v.fenceLife:0;
  sav.total=sav.labor+sav.trips+sav.maint+sav.build;
  var unit=calves*v.price/100;                 // $ for each extra pound on every calf
  var wean=v.gain*unit;
  var hay=v.hayDays*v.cows*v.hayCost;
  var benefit=sav.total+wean+hay;
  var net=benefit-cost.total;
  var pays=net>=0;
  return {collars:collars,calves:calves,towers:towers,towersAuto:towersAuto,cost:cost,cash1:cash1,sav:sav,wean:wean,hay:hay,
    benefit:benefit,net:net,perCow:v.cows>0?net/v.cows:0,pays:pays,
    beFee:collars>0?v.fee+net/collars:0,
    beWeight:pays?0:(unit>0?v.gain-net/unit:0)};
}
if(typeof module!=="undefined")module.exports={calc:calc,DEFAULTS:DEFAULTS,VENDORS:VENDORS,vendorById:vendorById};

// Shared by both pages: the numbers live in this browser and travel from "Your numbers" to "Your results".
var STORE="back40Collars";
function loadState(){
  var v=JSON.parse(JSON.stringify(DEFAULTS));
  try{var sv=JSON.parse(localStorage.getItem(STORE)||"null");if(sv&&typeof sv==="object"){
    Object.keys(DEFAULTS).forEach(function(k){var x=sv[k];
      if(k==="vendor"){if(typeof x==="string"&&VENDORS.some(function(o){return o.id===x}))v.vendor=x}
      else if(k==="towers"){if(x===null||(typeof x==="number"&&isFinite(x)&&x>=0))v.towers=x==null?null:x}
      else if(typeof x==="number"&&isFinite(x)&&x>=0)v[k]=x})}}catch(e){}
  return v;
}
function saveState(v){try{localStorage.setItem(STORE,JSON.stringify(v))}catch(e){}}
function clearState(){try{localStorage.removeItem(STORE)}catch(e){}}
function fmt(x,d){d=d==null?0:d;var s=Math.abs(x).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});return(x<-0.0000001&&parseFloat(s.replace(/,/g,""))!==0?"\u2212":"")+"$"+s}
function sgn(x,d){return(x>0.005?"+":"")+fmt(x,d)}
function cl(x){return x>0.005?"pos":(x<-0.005?"neg":"")}
function lb(x){return x.toLocaleString("en-US",{maximumFractionDigits:1})}
function $(i){return document.getElementById(i)}

(function(){if(typeof document==="undefined")return;
var KEY='tamuDecisionAidsTheme',t=document.getElementById('themeToggle');if(!t)return;var s=null;try{s=localStorage.getItem(KEY)}catch(e){}
if(s==='light'||s==='dark')document.documentElement.setAttribute('data-theme',s);
function cur(){var a=document.documentElement.getAttribute('data-theme');if(a==='light'||a==='dark')return a;return(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}
function paint(){var d=cur()==='dark';t.textContent=d?'☀️':'🌙';t.setAttribute('aria-label',d?'Switch to light mode':'Switch to dark mode');t.title=t.getAttribute('aria-label')}
t.addEventListener('click',function(){var n=cur()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);try{localStorage.setItem(KEY,n)}catch(e){}paint()});paint()})();
