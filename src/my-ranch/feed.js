  /* ================================================================ FEED CALENDAR ENGINE
   * Requirements: NRC Nutrient Requirements of Beef Cattle, 8th rev. ed. (NASEM 2016) equations.
   * TDN requirement is expressed the way extension tables do it: the lb of TDN at the diet energy
   * that exactly meets the day's NEm need at NRC-predicted intake.
   * Supply: pasture forage x harvest efficiency spread over the year with NRCS ecological-site growth
   * curves, at typical monthly TDN / CP values. Losses: USDA NAHMS. Climate: NOAA 1991-2020 normals.
   */
  var FEED = (function(){
    var LB = 2.2046;
    var MONTH_DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
    var MONTH_START = [0,31,59,90,120,151,181,212,243,273,304,334];
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    /* NRC 2016 Table 19-1 (breed maintenance multiplier, lactation maintenance factor, default peak milk kg) */
    /* BCNRM 2016 breed table: maintenance multiplier (be), lactation factor (l), peak milk kg, calf birth weight lb; hide per NRC (1 thin, 2 average, 3 thick) */
    var BREEDS = {
      angus:     {label:'Angus / British crossbred', be:1.00, l:1.2, pk:8.0,  cbw:68, hide:2},
      hereford:  {label:'Hereford',                  be:1.00, l:1.0, pk:7.0,  cbw:79, hide:3},
      charolais: {label:'Charolais',                 be:1.00, l:1.2, pk:9.0,  cbw:86, hide:2},
      limousin:  {label:'Limousin',                  be:1.00, l:1.2, pk:9.0,  cbw:82, hide:2},
      simmental: {label:'Simmental',                 be:1.20, l:1.0, pk:12.0, cbw:86, hide:2},
      gelbvieh:  {label:'Gelbvieh',                  be:1.00, l:1.0, pk:11.5, cbw:86, hide:2},
      brangus:   {label:'Brangus',                   be:0.95, l:1.2, pk:8.0,  cbw:73, hide:2},
      braford:   {label:'Braford / F1 Brahman cross',be:0.95, l:1.2, pk:7.0,  cbw:79, hide:2},
      santag:    {label:'Santa Gertrudis',           be:0.95, l:1.2, pk:8.0,  cbw:73, hide:2},
      brahman:   {label:'Brahman',                   be:0.90, l:1.2, pk:8.0,  cbw:68, hide:1},
      longhorn:  {label:'Longhorn',                  be:1.00, l:1.2, pk:5.0,  cbw:73, hide:2}
    };
    var MILK = {low:11, moderate:18, high:25};
    var MILK_FAT = 4.0, MILK_PROT = 3.8, MILK_SOLIDS = 8.3;
    var MILK_E = 0.092*MILK_FAT + 0.049*MILK_SOLIDS - 0.0569;

    /* USDA APHIS NAHMS Beef 2017, Part I, Table B.2.a: % of calves born by month (U.S.) */
    var NAHMS = [5.7,12.3,22.4,20.9,8.9,3.1,2.0,3.0,6.2,6.0,5.4,4.0];
    /* USDA APHIS NAHMS Beef 2007-08 mortality: 2.9% born dead + 3.5% died before weaning; weather caused
       22.6% of deaths under 3 weeks and 10.0% at 3 weeks or older; about 1/3 of live-born deaths happen at each age band. */
    /* Texas seasonal price indexes, % of the annual average (Davis, Sartwelle & Mintert, Texas A&M Extension RM2-7, 1999;
       Texas 500-600 lb feeder steers and San Angelo cutter cows, 1989-1998) */
    var SEASON_CALF = [100.54,102.79,104.35,104.82,103.23,102.03,101.59,99.49,96.09,94.93,94.14,96.01];
    var SEASON_CULL = [100.69,105.71,108.32,104.58,101.74,100.98,100.57,101.43,98.91,93.03,90.47,93.56];
    /* body energy (Mcal) at a condition score, NRC 2016 / BCNRM "current committee" method: EBW changes 7.11% per score */
    function bodyEnergy(sbwKg, bcsNow, bcs){
      var ebw5 = 0.851*sbwKg/(1 - 0.0711*(5 - bcsNow)), ebw = ebw5*(1 - 0.0711*(5 - bcs));
      return 9.4*ebw*0.037683*bcs + 5.7*ebw*(0.200886 - 0.0066762*bcs);
    }
    /* price in sale month m relative to the month the market price was entered (o.nowMonth) */
    function seasonIdx(o, tab, m){ if(o.seasonal === false || o.nowMonth == null) return 1; return tab[m]/tab[o.nowMonth]; }
    var LOSS_DEFAULT = 6.4;
    var WEATHER_SHARE = (3.5*(2/3*0.226 + 1/3*0.100))/6.4;   // share of all pre-weaning losses that is weather-related

    /* NRCS ecological-site growth curves + NOAA 1991-2020 normals for a representative station (°F) */
    var REGIONS = {
      hp: {label:'High Plains',                  curve:[0,3,5,8,23,25,12,5,10,5,3,1],  src:'TX0753 · High Lime 12-17" PZ (MLRA 77B)', station:'Amarillo',
           tmean:[38.6,41.8,49.8,57.5,66.8,76.1,79.6,78.1,70.9,59.2,47.4,38.8], tmin:[24.9,27.5,34.8,42.5,52.6,62.4,66.4,65.3,57.8,45.4,33.5,25.7]},
      rp: {label:'Rolling Plains',               curve:[0,1,5,15,25,20,5,5,15,8,1,0],  src:'TX2275 · Clay Loam 23-30" PZ (MLRA 78C)', station:'Abilene',
           tmean:[46.3,50.1,58.1,66.0,74.1,81.1,84.7,84.2,76.8,67.0,55.5,47.3], tmin:[33.7,37.4,45.3,52.8,61.9,69.5,73.1,72.4,65.0,54.7,43.3,35.2]},
      ep: {label:'Edwards Plateau & West Texas', curve:[3,5,5,9,13,13,11,9,12,11,5,4], src:'TX3254 · Clay Loam 14-19" PZ (MLRA 81A)', station:'San Angelo',
           tmean:[45.8,50.2,57.5,65.7,74.2,80.9,83.3,82.9,76.0,66.2,54.8,47.2], tmin:[31.5,36.0,43.2,51.0,60.8,68.6,70.6,70.4,63.7,52.7,41.4,33.5]},
      st: {label:'South Texas',                  curve:[2,2,5,10,18,15,5,9,15,9,5,5],  src:'TX4525 · Western Clay Loam (MLRA 83A)', station:'Laredo',
           tmean:[57.6,61.9,69.6,76.6,82.8,87.6,88.7,89.1,83.7,74.8,66.0,58.5], tmin:[46.8,51.7,58.3,64.9,71.5,76.2,77.1,77.4,73.1,65.8,55.6,48.0]},
      ce: {label:'Central & East Texas',         curve:[2,2,8,10,20,23,5,3,10,10,5,2], src:'TX5510 · Sandy Loam 29-33" PZ (MLRA 84B)', station:'Waco',
           tmean:[47.4,51.6,58.8,66.2,74.3,81.9,85.6,85.5,78.7,68.4,57.2,49.2], tmin:[35.8,40.1,47.4,54.6,63.3,71.1,74.4,73.9,66.7,56.2,45.6,37.9]}
    };
    var CURVES = {
      improved:   [0,0,2,8,20,25,20,13,8,4,0,0],
      smallgrain: [4,5,25,30,12,0,0,0,0,8,11,5],
      hay:        [0,0,2,8,20,25,20,13,8,4,0,0]
    };
    var QUALITY = {
      range:      [[48,4.5],[48,4.5],[50,6],[60,11],[62,12],[60,10],[56,8],[54,7],[55,7.5],[52,6],[50,5],[49,4.5]],
      improved:   [[45,6],[45,6],[47,7],[60,13],[60,13],[60,12],[56,10],[56,10],[55,10],[53,9],[50,8],[48,7]],
      smallgrain: [[72,24],[72,24],[72,24],[72,22],[62,14],[50,6],[50,6],[50,6],[50,6],[72,25],[72,25],[72,24]],
      hay:        [[45,6],[45,6],[47,7],[60,13],[60,13],[60,12],[56,10],[56,10],[55,10],[53,9],[50,8],[48,7]]
    };
    var ACTIVITY = {none:0, flat:0.10, rolling:0.20, rough:0.35, extensive:0.50};
    /* Protein sources (typical composition; price is what the producer pays) */
    var SOURCES = {
      cube20: {label:'20% range cubes',        cp:20, tdn:70},
      cube38: {label:'38% protein cubes',      cp:38, tdn:75},
      csm41:  {label:'41% cottonseed meal',    cp:41, tdn:75},
      wcs:    {label:'Whole cottonseed',       cp:23, tdn:90},
      alfalfa:{label:'Alfalfa hay',            cp:17, tdn:58},
      custom: {label:'Other (enter below)',    cp:null, tdn:null}
    };

    function nemaOf(tdn){ var me = tdn/100*4.409*0.82; return 1.37*me - 0.138*me*me + 0.0105*me*me*me - 1.12; }
    function negaOf(tdn){ var me = tdn/100*4.409*0.82; return 1.42*me - 0.174*me*me + 0.0122*me*me*me - 1.65; }
    var F2C = function(f){ return (f - 32)*5/9; };
    /* Monthly weather the NRC 2016 model (BCNRM) uses: previous and current temperature, lowest night temperature,
       wind, hair depth (0.5 in winter coat, 0.2 in summer), hide, hair-coat condition and panting. null = no adjustment. */
    function envFor(o, m){
      if(!o.weatherAdj) return null;
      var reg = REGIONS[o.region] || REGIONS.ce, br = BREEDS[o.breed] || BREEDS.angus;
      var hot = reg.tmean[m] >= 80;
      return {tc:F2C(reg.tmean[m]), tp:F2C(reg.tmean[(m + 11) % 12]), lnt:F2C(reg.tmin[m]),
              ws:Math.min(32, (o.windMph == null ? 10 : o.windMph)*1.609), hair:0.95 + 0.35*Math.cos(2*Math.PI*m/12),
              hide:br.hide || 2, coat:hot ? 1 : (o.coat || 1), pant:hot ? (o.heat || 1) : 1, rh:65};
    }
    /* Acclimatization to the previous month's temperature (a2, Mcal/kg^0.75) */
    function a2Of(env){ return env ? 0.0007*(20 - env.tp) : 0; }
    /* Effect of temperature on intake (BCNRM TEMP1 with night cooling) */
    function dmiTempFactor(env){
      if(!env) return 1;
      var t = env.tc;
      if(t > 20){
        var ws = env.ws, rh = env.rh;
        var ceti = 27.88 - 0.456*t + 0.010754*t*t - 0.4905*rh + 0.00088*rh*rh + 1.1507*ws/3.6 - 0.126447*ws/(3.6*3.6)
                 + 0.019876*t*rh - 0.046313*t*ws/3.6 + 0.4167*8;
        var dminc = (119.62 - 0.9708*ceti)/100;
        return env.lnt > 20 ? dminc : (1 - dminc)*0.75 + dminc;
      }
      if(t < -20) return 1.16;
      return 1.0433 - 0.0044*t + 0.0001*t*t;
    }
    /* Diet TDN (and intake) at which the animal just meets its needs, the way extension tables state it.
       p: nem (maintenance incl. activity), nemBase (without activity, for heat stress), nel, mey (pregnancy ME),
          mbw, milk (kg/d), dp (days pregnant), env, fbwKg, bcs */
    function stressCtx(p){
      var env = p.env, c = {tf:dmiTempFactor(env), ei:0, ti:0, sa:0};
      if(env){
        c.ei = Math.max(0, 6.1816 - 0.5575*env.ws + 0.0152*env.ws*env.ws + 5.298*env.hair - 0.4297*env.hair*env.hair - 0.1029*env.ws*env.hair)
             *[1, 0.8, 0.5, 0.2][env.coat - 1]*[0.8, 1, 1.2][env.hide - 1];
        c.ti = 5.25 + 0.75*p.bcs;
        c.sa = 0.09*Math.pow(p.fbwKg, 0.67);
      }
      return c;
    }
    /* Needs and supply (NEm-equivalent, Mcal/d) for a diet of t % TDN */
    function needAt(p, t, c){
      c = c || stressCtx(p);
      var env = p.env, me = t/100*4.409*0.82, nm = nemaOf(t), km = nm/me;
      var dmi = p.dmiOverride || p.mbw*((p.dp > 93 ? 0.04631 : 0.0384) + 0.04997*nm*nm)/(nm <= 1 ? 0.95 : nm)*c.tf + 0.2*p.milk;
      var stress = 0, cs = 0, lct = null;
      if(env){
        var he = dmi*me - (dmi - p.nem/nm)*nm, ins = c.ei + c.ti;
        lct = 39 - 0.85*ins*he/c.sa;
        if(lct > env.tc) cs = c.sa*(lct - env.tc)/ins*km;
        stress = cs > 0 ? cs : p.nemBase*(env.pant === 3 ? 0.18 : env.pant === 2 ? 0.07 : 0);
      }
      return {dmi:dmi, supply:nm*dmi, need:p.nem + stress + p.nel + p.mey*km + (p.extra || 0), stress:stress, cold:cs, lct:lct, km:km};
    }
    function solveTDN(p){
      var c = stressCtx(p), lo = 35, hi = 95;
      for(var i = 0; i < 50; i++){ var mid = (lo+hi)/2, r = needAt(p, mid, c); if(r.supply < r.need) lo = mid; else hi = mid; }
      var t = (lo+hi)/2, f = needAt(p, t, c);
      return {tdnPct:t, dmiKg:f.dmi, tdnLb:t/100*f.dmi*LB, stressNE:f.stress, coldNE:f.cold};
    }
    function milkKg(dim, peakLb){
      if(dim <= 0) return 0;
      var t = 8.5, k = 1/t, pk = peakLb/LB, a = 1/(pk*k*Math.E), n = dim/7;
      return n/(a*Math.exp(k*n));
    }
    function birthLb(o){ return (BREEDS[o.breed] || BREEDS.angus).cbw; }
    function cowParams(o, dim, preg, env, extra){
      var sbw = o.cowLb/LB*0.96, mbw = Math.pow(sbw, 0.75), br = BREEDS[o.breed] || BREEDS.angus;
      var comp = 0.8 + (o.bcs - 1)*0.05;
      var lact = dim > 0;
      var nemBase = mbw*(0.077*br.be*(lact ? br.l : 1)*comp + a2Of(env));
      var y = lact ? milkKg(dim, o.peakMilkLb) : 0;
      var mey = 0, mpp = 0;
      if(preg > 0){
        var cbw = (o.birthLb || birthLb(o))/LB, t = preg;
        var ney = cbw*(0.05855 - 0.0000996*t)*Math.exp(0.03233*t - 0.0000275*t*t)/1000;
        mey = ney/0.13;                                   // NEm for pregnancy = MEy x diet km (BCNRM), not a fixed 0.6
        mpp = cbw*(0.001669 - 0.00000211*t)*Math.exp(0.0278*t - 0.0000176*t*t)*6.25/0.65;
      }
      return {nem:nemBase*(1 + (o.activity||0)), nemBase:nemBase, nel:y*MILK_E, mey:mey, mbw:mbw, milk:y, dp:preg, env:env, extra:extra || 0,
              fbwKg:o.cowLb/LB, bcs:o.bcs, mp:mbw*3.8 + y*MILK_PROT/100/0.65*1000 + mpp, lact:lact};
    }
    function cowDay(o, dim, preg, env, extra){
      var p = cowParams(o, dim, preg, env, extra), s = solveTDN(p);
      return {tdnLb:s.tdnLb, cpLb:p.mp/0.67/1000*LB, milkKg:p.milk, lact:p.lact, dmiLb:s.dmiKg*LB, stressNE:s.stressNE, coldNE:s.coldNE};
    }
    function bullDay(o, env){
      var sbw = o.bullLb/LB*0.96, mbw = Math.pow(sbw, 0.75), br = BREEDS[o.breed] || BREEDS.angus;
      var nemBase = mbw*(0.077*br.be*1.15*(0.8 + (o.bcs - 1)*0.05) + a2Of(env));
      var s = solveTDN({nem:nemBase*(1 + (o.activity||0)), nemBase:nemBase, nel:0, mey:0, mbw:mbw, milk:0, dp:0, env:env, fbwKg:o.bullLb/LB, bcs:o.bcs});
      return {tdnLb:s.tdnLb, cpLb:mbw*3.8/0.67/1000*LB};
    }
    /* Growing calf at a given weight and gain; milk (kg/day) counted first. Returns what must come from feed. */
    function calfDay(o, bwLb, adgLb, milk, forTdn, env){
      var bwKg = bwLb/LB, adgKg = Math.max(0.01, adgLb/LB);
      var sbw = bwKg*0.96, mbw = Math.pow(sbw, 0.75), br = BREEDS[o.breed] || BREEDS.angus;
      var nem = mbw*(0.077*br.be + a2Of(env))*(1 + (o.activity||0)*0.5);
      var eqsbw = sbw*478/(o.cowLb/LB*0.96), eqebw = 0.891*eqsbw;
      var swg = adgKg*0.96, ewg = swg*0.96;
      var re = Math.pow(ewg/(12.341*Math.pow(eqebw, -0.6837)), 1/0.9116);
      var mpg = swg*(268 - 29.4*re/swg)/Math.max(0.492, 0.834 - 0.00114*eqsbw);
      var mp = mbw*3.8 + Math.max(0, mpg);
      var milkNE = milk*MILK_E*0.85, milkMP = milk*MILK_PROT/100*1000*0.85;
      var nemLeft = Math.max(0, nem - milkNE), extra = Math.max(0, milkNE - nem);
      var negLeft = Math.max(0, re - extra);
      var nm = nemaOf(forTdn), ng = Math.max(0.05, negaOf(forTdn));
      var dmKg = nemLeft/nm + negLeft/ng;
      var mpLeft = Math.max(0, mp - milkMP);
      return {tdnLb:dmKg*forTdn/100*LB, cpLb:mpLeft/0.67/1000*LB, dmLb:dmKg*LB};
    }
    /* Replacement heifers (BCNRM 2016 targets): 60% of mature shrunk weight at conception (65% Bos indicus),
       80% at first calving; conception at 450 days, first calf at 730 days. */
    var H_BREED = 450, H_CALVE = 730, H_CHECK = 510;
    function heiferTargets(o){
      var br = BREEDS[o.breed] || BREEDS.angus, msbw = o.cowLb/LB*0.96;
      return {msbw:msbw, preg:msbw*(br.hide === 1 ? 0.65 : 0.60), calve:msbw*0.80};
    }
    /* shrunk BW (kg, maternal) and target ADG (kg/d) at age a (days) */
    function heiferState(o, a, weanAge, weanLb){
      var T = heiferTargets(o), w0 = weanLb/LB*0.96;
      if(a < H_BREED){ var g1 = Math.max(0.1, (T.preg - w0)/Math.max(30, H_BREED - weanAge)); return {sbw:w0 + g1*(a - weanAge), adg:g1, dp:0}; }
      var g2 = Math.max(0, (T.calve - T.preg)/(H_CALVE - H_BREED));
      return {sbw:T.preg + g2*(a - H_BREED), adg:g2, dp:a - H_BREED};
    }
    function heiferDay(o, a, weanAge, weanLb, env){
      var st = heiferState(o, a, weanAge, weanLb), br = BREEDS[o.breed] || BREEDS.angus, T = heiferTargets(o);
      var cbw = (o.birthLb || birthLb(o))/LB, t = st.dp;
      var cw = t > 0 ? cbw*0.01828*Math.exp(0.02*t - 0.0000143*t*t) : 0;
      var adgPreg = t > 0 ? cbw*0.01828*(0.02 - 0.0000286*t)*Math.exp(0.02*t - 0.0000143*t*t) : 0;
      var sbw = st.sbw + cw, mbw = Math.pow(sbw, 0.75);
      var nemBase = mbw*(0.077*br.be + a2Of(env)), nem = nemBase*(1 + (o.activity || 0));
      var eqsbw = Math.max(1, (sbw - cw)*478/T.msbw), eqebw = 0.891*eqsbw;
      var swg = st.adg, ewg = swg*0.956;
      var re = swg > 0 ? 0.0635*Math.pow(eqebw, 0.75)*Math.pow(ewg, 1.097) : 0;
      var mey = 0, mpp = 0;
      if(t > 0){
        mey = cbw*(0.05855 - 0.0000996*t)*Math.exp(0.03233*t - 0.0000275*t*t)/1000/0.13;
        mpp = cbw*(0.001669 - 0.00000211*t)*Math.exp(0.0278*t - 0.0000176*t*t)*6.25/0.65;
      }
      var npg = swg > 0 ? swg*(268 - 29.4*re/swg) : 0;
      var mpg = npg/Math.max(0.28908, 0.834 - 0.00114*eqsbw);
      var mp = mbw*3.8 + Math.max(0, mpg) + mpp;
      var c = stressCtx({env:env, bcs:5, fbwKg:sbw/0.96});
      if(env && a <= 363) c.ti = 5.1875 + 0.3125*5;
      function at(tdn){
        var me = tdn/100*4.409*0.82, nm = nemaOf(tdn), ng = Math.max(0.05, negaOf(tdn)), km = nm/me;
        var dmi = sbw*(1.2425 + 1.9218*nm - 0.7259*nm*nm)/100*c.tf;
        var stress = 0;
        if(env){
          var he = dmi*me - (dmi - nem/nm)*nm, ins = c.ei + c.ti, lct = 39 - 0.85*ins*he/c.sa;
          stress = lct > env.tc ? c.sa*(lct - env.tc)/ins*km : nemBase*(env.pant === 3 ? 0.18 : env.pant === 2 ? 0.07 : 0);
        }
        return {dmi:dmi, need:(nem + stress)/nm + mey/me + re/ng};
      }
      var lo = 40, hi = 95;
      for(var i = 0; i < 50; i++){ var mid = (lo + hi)/2, r = at(mid); if(r.dmi < r.need) lo = mid; else hi = mid; }
      var tt = (lo + hi)/2, f = at(tt);
      return {tdnLb:tt/100*f.dmi*LB, cpLb:mp/0.67/1000*LB, dmLb:f.dmi*LB, bwLb:sbw/0.96*LB, tdnPct:tt};
    }
    /* Heifers kept per cow in the herd: replacements needed / heifer pregnancy rate */
    function heifersKeptPerCow(o){ return (o.replRate || 0) > 0 ? (o.replRate/100)/Math.max(0.3, (o.heiferPreg || 85)/100) : 0; }
    /* On a given day, heifers on hand per cow for cohort c, by age (weaning to first calving; opens sold at preg check) */
    function heiferAges(o, c, d){
      var out = [], kept = c.kept != null ? c.kept : heifersKeptPerCow(o)*c.share;
      if(!(kept > 0)) return out;
      for(var k = 0; k < 2; k++){
        var a = ((d - c.day + 365) % 365) + 365*k;
        if(a >= c.weanAge && a < H_CALVE) out.push({age:a, n:a < H_CHECK ? kept : kept*(o.heiferPreg || 85)/100});
      }
      return out;
    }
    /* Forage a nursing calf can eat, % of body weight (assumption: a step below the cow values; milk fills the rest) */
    function calfIntakePct(tdn){ return tdn < 52 ? 2.5 : tdn <= 59 ? 3.0 : 3.5; }
    /* Forage intake capacity, % of body weight (Mississippi State Extension, Table 1) */
    function intakePct(tdn, lactating){
      if(tdn < 52) return lactating ? 2.2 : 1.8;
      if(tdn <= 59) return lactating ? 2.5 : 2.2;
      return lactating ? 2.7 : 2.5;
    }
    function monthOfDay(d){ d = ((d % 365) + 365) % 365; for(var m = 11; m >= 0; m--) if(d >= MONTH_START[m]) return m; return 0; }
    function slideLookup(t, w){
      if(!t || !t.length) return 0;
      if(w <= t[0].w) return t[0].p;
      if(w >= t[t.length-1].w) return t[t.length-1].p;
      for(var i = 0; i < t.length - 1; i++){ var a = t[i], b = t[i+1]; if(w >= a.w && w <= b.w) return a.p + (b.p - a.p)*(w - a.w)/(b.w - a.w); }
      return t[t.length-1].p;
    }

    /* Climate-driven monthly risk indices */
    var REF_TMIN = [0,1,2,3,4,5,6,7,8,9,10,11].map(function(m){ var s = 0, n = 0; Object.keys(REGIONS).forEach(function(k){ s += REGIONS[k].tmin[m]; n++; }); return s/n; });
    function coldIdx(t){ return Math.max(0, 50 - t); }                      // °F that normal night lows fall below 50°F
    var REF_COLD = NAHMS.reduce(function(a, p, m){ return a + p/100*coldIdx(REF_TMIN[m]); }, 0);
    function weatherFactor(region, m){ return coldIdx((REGIONS[region] || REGIONS.ce).tmin[m])/REF_COLD; }
    function flyActivity(region, m){ var t = (REGIONS[region] || REGIONS.ce).tmean[m]; return Math.max(0, Math.min(1, (t - 59)/(77 - 59))); }  // screwworm: limited <59°F, ideal 77-86°F
    function hornFlyWindow(d){ var m = monthOfDay(d); return m >= 5 && m <= 8; }   // Jun-Sep (UNL: late May-early Sep, peak Jul-Aug)

    /* Calving cohorts, each with its own weaning age */
    function cohorts(o){
      var list = [];
      function season(startDoy, len, share, weanDoy){
        var n = Math.max(1, Math.min(9, Math.round(len/10)));
        for(var i = 0; i < n; i++) list.push({day:Math.round(startDoy + (len*(i + 0.5))/n) % 365, share:share/n, weanDoy:weanDoy});
      }
      if(o.calving === 'us'){
        NAHMS.forEach(function(p, m){ list.push({day:MONTH_START[m] + 15, share:p/100, weanDoy:null}); });
        var t = list.reduce(function(a, c){ return a + c.share; }, 0);
        list.forEach(function(c){ c.share /= t; });
      } else if(o.calving === 'two'){
        season(o.start1, o.len1, 1 - o.share2/100, o.weanDoy1);
        season(o.start2, o.len2, o.share2/100, o.weanDoy2);
      } else season(o.start1, o.len1, 1, o.weanDoy1);
      list.forEach(function(c){
        var age = (o.weanMode === 'date' && c.weanDoy != null) ? ((c.weanDoy - c.day + 365) % 365) : o.weanAge;
        c.weanAge = Math.max(60, Math.min(330, age));
        c.birthMonth = monthOfDay(c.day);
      });
      return list;
    }

    /* Everything that happens to the calves: survival, weights, sale income. */
    function calfOutcome(o, cs){
      var avgAge = cs.reduce(function(a, c){ return a + c.share*c.weanAge; }, 0);
      var refAge = o.refWeanAge || avgAge;
      var preAdg = Math.max(0.3, (o.weanLb - o.birthLb)/refAge);
      var base = o.calfLoss/100, ws = WEATHER_SHARE;
      var out = {preAdg:preAdg, avgAge:avgAge, born:0, weaned:0, kept:0, sold:0, opens:0, culls:0, deadWeather:0, deadNws:0, deadOther:0, stillLbs:0, soldLb:0, income:0, calfIncome:0, openIncome:0, cullIncome:0, nwsCalves:0, cohorts:[]};
      cs.forEach(function(c){
        var born = o.calvingRate/100*c.share;
        var wf = weatherFactor(o.region, c.birthMonth);
        var fly = flyActivity(o.region, c.birthMonth);
        var lOther = base*(1 - ws), lWeather = Math.min(0.5, base*ws*wf), lNws = o.nwsPresent ? o.nwsLoss/100*fly : 0;
        var surv = Math.max(0, 1 - lOther - lWeather - lNws);
        // horn flies: weight lost in proportion to nursing days inside the fly season
        var hfDays = 0; for(var k = 0; k < c.weanAge; k++) if(hornFlyWindow(c.day + k)) hfDays++;
        var wWean = (o.birthLb + preAdg*c.weanAge)*(1 - (o.hornFly || 0)/100*hfDays/Math.max(1, c.weanAge)) - (o.weanPenaltyLb || 0)*c.weanAge/Math.max(1, avgAge);
        var wSale = wWean + (o.postAdg || 0)*(o.weanPeriod || 0);
        var saleM = monthOfDay(c.day + c.weanAge + (o.weanPeriod || 0));
        var sIdx = seasonIdx(o, SEASON_CALF, saleM);
        var pS = slideLookup(o.steerSlide, wSale)*sIdx, pH = slideLookup(o.heiferSlide, wSale)*sIdx;
        var price = 0.5*pS + 0.5*pH;   // $/cwt, half steers, half heifers
        var weaned = born*surv;
        var kept = Math.min(weaned/2, heifersKeptPerCow(o)*c.share);
        var sold = weaned - kept;
        var calfInc = (weaned/2)*wSale/100*pS + (weaned/2 - kept)*wSale/100*pH;
        // open heifers sold at pregnancy check; cull cows sold at weaning
        var opens = kept*(1 - (o.heiferPreg || 85)/100), openLb = heiferState(o, H_CHECK, c.weanAge, wWean).sbw/0.96*LB;
        var openInc = opens*openLb/100*slideLookup(o.heiferSlide, openLb)*seasonIdx(o, SEASON_CALF, monthOfDay(c.day + H_CHECK));
        var culls = Math.max(0, ((o.replRate || 0) - (o.cowLoss || 0))/100)*c.share;
        var cullInc = culls*o.cowLb/100*(o.cullPrice || 0)*seasonIdx(o, SEASON_CULL, monthOfDay(c.day + c.weanAge));
        c.surv = surv; c.wWean = wWean; c.wSale = wSale; c.price = price; c.born = born; c.weaned = weaned; c.kept = kept; c.sold = sold; c.saleMonth = saleM;
        out.born += born; out.weaned += weaned; out.kept += kept; out.sold += sold; out.opens += opens; out.culls += culls;
        out.deadWeather += born*lWeather; out.deadNws += born*lNws; out.deadOther += born*lOther;
        out.soldLb += sold*wSale; out.calfIncome += calfInc; out.openIncome += openInc; out.cullIncome += cullInc;
        out.income += calfInc + openInc + cullInc;
        out.nwsCalves += o.nwsPresent ? born*fly : 0;
        out.cohorts.push(c);
      });
      out.avgSaleLb = out.sold > 0 ? out.soldLb/out.sold : 0;
      out.avgWeanLb = out.weaned > 0 ? cs.reduce(function(a, c){ return a + c.weaned*c.wWean; }, 0)/out.weaned : 0;
      out.avgPrice = out.soldLb > 0 ? out.calfIncome/(out.soldLb/100) : 0;
      return out;
    }

    /* Daily requirements, averaged by month. Values for calves are per cow in the herd. */
    function requirements(o, cs, co, forageTdnByMonth){
      var gest = 283, conceive = 365 - gest, CR = o.calvingRate/100;
      var envs = [], memo = {}, memo0 = {}, out = [];
      for(var m = 0; m < 12; m++){
        envs.push(envFor(o, m));
        var bull = bullDay(o, envs[m]), bull0 = envs[m] ? bullDay(o, null) : bull;
        out.push({cowTdn:0, cowCp:0, cowTdnNoWx:0, bcsTdn:0, lactFrac:0, calfTdn:0, calfCp:0, calfDm:0, calvesNursing:0,
          wcN:0, wcTdn:0, wcCp:0, wcCap:0, wcBw:0, hN:0, hTdn:0, hCp:0, hCap:0, hBw:0, bullTdn:bull.tdnLb, bullCp:bull.cpLb, bullTdnNoWx:bull0.tdnLb, days:MONTH_DAYS[m], env:envs[m]});
      }
      var env, hmemo = {};
      function cow(dim, preg, extra){ var k = m + '|' + dim + '|' + preg + '|' + (extra || 0); return memo[k] || (memo[k] = cowDay(o, dim, preg, env, extra)); }
      function heifer(age, weanAge, weanLb){ var k = m + '|' + age + '|' + weanAge + '|' + Math.round(weanLb); return hmemo[k] || (hmemo[k] = heiferDay(o, age, weanAge, weanLb, env)); }
      /* energy to put back body condition lost while nursing: from weaning to a month before the next calving */
      var sbwKg = o.cowLb/LB*0.96, bcsW = o.bcsWean || o.bcs;
      var gainE = bcsW < o.bcs ? bodyEnergy(sbwKg, o.bcs, o.bcs) - bodyEnergy(sbwKg, o.bcs, bcsW) : 0;
      function cow0(dim, preg){ if(!env) return cow(dim, preg); var k = dim + '|' + preg; return memo0[k] || (memo0[k] = cowDay(o, dim, preg, null)); }
      for(var d = 0; d < 365; d++){
        var m = monthOfDay(d), acc = out[m];
        env = envs[m];
        cs.forEach(function(c){
          var dsc = (d - c.day + 365) % 365, w = c.share;
          var nursing = dsc < c.weanAge;
          var inPeriod = !nursing && dsc < c.weanAge + (o.weanPeriod || 0);
          var preg = dsc >= conceive ? dsc - conceive : 0;
          var nurseFrac = CR*c.surv;                      // cows still raising a calf
          var a = cow(nursing ? dsc : 0, preg), b = cow(0, preg), e = cow(0, 0);
          if(gainE > 0 && !nursing && dsc < 335){
            var extra = Math.round(gainE/Math.max(30, 335 - c.weanAge)*1000)/1000, b2 = cow(0, preg, extra);
            acc.bcsTdn += w*CR*(b2.tdnLb - b.tdnLb);    // every cow that calved, calf weaned or lost
            b = {tdnLb:b2.tdnLb, cpLb:b.cpLb}; a = b;
          }
          acc.cowTdn += w*(nurseFrac*a.tdnLb + (CR - nurseFrac)*b.tdnLb + (1 - CR)*e.tdnLb);
          acc.cowTdnNoWx += w*(nurseFrac*cow0(nursing ? dsc : 0, preg).tdnLb + (CR - nurseFrac)*cow0(0, preg).tdnLb + (1 - CR)*cow0(0, 0).tdnLb);
          acc.cowCp  += w*(nurseFrac*a.cpLb  + (CR - nurseFrac)*b.cpLb  + (1 - CR)*e.cpLb);
          if(nursing){
            acc.lactFrac += w*nurseFrac;
            var bw = o.birthLb + co.preAdg*dsc;
            var k = calfDay(o, bw, co.preAdg, a.milkKg, forageTdnByMonth[m], env);
            // a nursing calf can only eat so much forage: little in the first month, rising to ~2% of body weight (less on poor grass)
            var capDm = bw/100*calfIntakePct(forageTdnByMonth[m])*Math.max(0, Math.min(1, (dsc - 21)/60));
            var dmEat = Math.min(k.dmLb, capDm);
            acc.calfTdn += w*nurseFrac*k.tdnLb; acc.calfCp += w*nurseFrac*k.cpLb; acc.calfDm += w*nurseFrac*dmEat;
            acc.calvesNursing += w*nurseFrac;
          } else if(inPeriod){
            var bw2 = c.wWean + (o.postAdg || 0)*(dsc - c.weanAge);
            var k2 = calfDay(o, bw2, o.postAdg || 0.5, 0, forageTdnByMonth[m], env);
            var n2 = c.weaned - (c.kept || 0);   // per cow in the herd (c.weaned already carries the cohort share)
            acc.wcN += n2; acc.wcTdn += n2*k2.tdnLb; acc.wcCp += n2*k2.cpLb; acc.wcBw += n2*bw2;
            acc.wcCap += n2*bw2/100*(intakePct(forageTdnByMonth[m], false) + 0.5);
          }
          heiferAges(o, c, d).forEach(function(h){
            var r = heifer(h.age, c.weanAge, c.wWean);
            acc.hN += h.n; acc.hTdn += h.n*r.tdnLb; acc.hCp += h.n*r.cpLb; acc.hBw += h.n*r.bwLb;
            acc.hCap += h.n*r.bwLb/100*(intakePct(forageTdnByMonth[m], false) + 0.5);
          });
        });
      }
      out.forEach(function(r){
        ['cowTdn','cowCp','cowTdnNoWx','bcsTdn','lactFrac','calfTdn','calfCp','calfDm','calvesNursing','wcN','wcTdn','wcCp','wcCap','wcBw','hN','hTdn','hCp','hCap','hBw'].forEach(function(k){ r[k] /= r.days; });
        r.wcBw = r.wcN > 0 ? r.wcBw/r.wcN : 0;
        r.hBw = r.hN > 0 ? r.hBw/r.hN : 0;
      });
      return out;
    }

    function curveFor(t, regionKey){ return t === 'range' ? (REGIONS[regionKey] || REGIONS.ce).curve : CURVES[t]; }
    /* One pasture's usable forage growth by month (lb) */
    function pastureGrowth(p, he, regionKey){
      var t = p.type === 'range' ? 'range' : p.type, curve = curveFor(t, regionKey), tot = curve.reduce(function(a, b){ return a + b; }, 0);
      return curve.map(function(x){ return (p.annualLb || 0)*he*x/tot; });
    }
    /* Pastures grouped by type; a pasture with a measured standing crop keeps its own entry so the measurement can reset its stock */
    function pastureSupply(pastures, he, regionKey){
      var byType = {}, own = [];
      pastures.forEach(function(p){
        if(!p.annualLb || !p.grazed) return;
        var t = p.type === 'range' ? 'range' : p.type;
        if(p.measured && p.measured.lbAc > 0 && p.measured.month != null){
          own.push({type:t, annual:p.annualLb*he, growth:pastureGrowth(p, he, regionKey), quality:QUALITY[t],
                    measured:{month:p.measured.month, lb:p.measured.lbAc*(p.forageAcres || 0)*he}, name:p.name});
          return;
        }
        byType[t] = (byType[t] || 0) + p.annualLb*he;
      });
      return Object.keys(byType).map(function(t){
        var curve = curveFor(t, regionKey), tot = curve.reduce(function(a, b){ return a + b; }, 0);
        return {type:t, annual:byType[t], growth:curve.map(function(p){ return byType[t]*p/tot; }), quality:QUALITY[t]};
      }).concat(own);
    }
    /* Returns a copy of the supply with some months' growth cut (drought / failed small grains) */
    function adjustSupply(supply, cutPct, fromMonth, months, which){
      return supply.map(function(g){
        var growth = g.growth.slice();
        if(which === 'all' || which === g.type){
          for(var i = 0; i < months; i++){ var m = (fromMonth + i) % 12; growth[m] *= (1 - cutPct/100); }
        }
        return {type:g.type, annual:g.annual, growth:growth, quality:g.quality, measured:g.measured, name:g.name};
      });
    }

    function balance(o, supply, feeds){
      var ftdn = [];
      for(var m = 0; m < 12; m++){
        var w = 0, s = 0;
        supply.forEach(function(g){ var a = g.growth[m] + g.annual/12; w += a; s += a*g.quality[m][0]; });
        ftdn.push(w > 0 ? s/w : QUALITY.range[m][0]);
      }
      var cs = cohorts(o), co = calfOutcome(o, cs);
      var req = requirements(o, cs, co, ftdn);
      var cows = o.cows*(1 - (o.cowLoss || 0)/200), bulls = o.bulls;
      var stock = supply.map(function(){ return 0; }), months = [];
      for(var pass = 0; pass < 2; pass++){
        months = [];
        for(var m = 0; m < 12; m++){
          var r = req[m], n = MONTH_DAYS[m];
          supply.forEach(function(g, i){ if(g.measured && g.measured.month === m) stock[i] = g.measured.lb; });
          var avail = supply.map(function(g, i){ return stock[i] + g.growth[m]; });
          var availTot = avail.reduce(function(a, b){ return a + b; }, 0);
          var dTdn = 0, dCp = 0;
          if(availTot > 0){ supply.forEach(function(g, i){ dTdn += avail[i]/availTot*g.quality[m][0]; dCp += avail[i]/availTot*g.quality[m][1]; }); }
          else { dTdn = QUALITY.range[m][0]; dCp = QUALITY.range[m][1]; }
          // Low-protein forage (<7% CP) limits intake; once a protein supplement covers the gap, cattle eat more of it
          // (AgriLife ANSC-PU-085, McCollum: 1.6% of body weight at 5% CP vs. 2.3% at 7-8% CP; supplements raised intake 36% on average).
          var lowCp = dCp < 7;
          var pctL = lowCp ? Math.max(intakePct(dTdn, true), 2.5) : intakePct(dTdn, true), pctD = lowCp ? Math.max(intakePct(dTdn, false), 2.3) : intakePct(dTdn, false);
          var cowCap = o.cowLb/100*(r.lactFrac*pctL + (1 - r.lactFrac)*pctD);
          var bullCap = o.bullLb/100*pctD;
          var demand = (cows*(cowCap + r.calfDm + r.wcCap + r.hCap) + bulls*bullCap)*n;
          var f = demand > 0 ? Math.min(1, availTot/demand) : 1;
          var eaten = demand*f;
          supply.forEach(function(g, i){ var take = availTot > 0 ? eaten*avail[i]/availTot : 0; stock[i] = Math.max(0, avail[i] - take); });
          // protOnly: supplement covers the protein gap only; the energy still missing comes from body reserves (mature cows and bulls)
          var feedFor = function(cap, rTdn, rCp, protOnly){
            var forage = cap*f, hay = cap*(1 - f);
            var tdn = forage*dTdn/100 + hay*feeds.hayTdn/100, cp = forage*dCp/100 + hay*feeds.hayCp/100;
            var eDef = Math.max(0, rTdn - tdn), pDef = Math.max(0, rCp - cp);
            var supP = pDef/(feeds.supCp/100), supE = eDef/(feeds.supTdn/100);
            var sup = protOnly ? supP : Math.max(supE, supP);
            var tdnIn = tdn + sup*feeds.supTdn/100;
            return {forage:forage, hay:hay, sup:sup, eDef:eDef, pDef:pDef, protDriven:supP >= supE,
                    eLeft:Math.max(0, rTdn - tdnIn), eSur:Math.max(0, tdnIn - rTdn)};
          };
          var protOnly = o.supMode === 'protein';
          var cw = feedFor(cowCap, r.cowTdn, r.cowCp, protOnly);
          var bl = feedFor(bullCap, r.bullTdn, r.bullCp, protOnly);
          var wcHead = r.wcN > 0 ? feedFor(r.wcCap/r.wcN, r.wcTdn/r.wcN, r.wcCp/r.wcN) : {forage:0, hay:0, sup:0};
          var hHead = r.hN > 0 ? feedFor(r.hCap/r.hN, r.hTdn/r.hN, r.hCp/r.hN) : {forage:0, hay:0, sup:0};
          var hHeads = cows*r.hN;
          var calfTdnSup = r.calfDm*f*dTdn/100, calfCpSup = r.calfDm*f*dCp/100;
          var wcHeads = cows*r.wcN;
          var hayLb = (cows*cw.hay + bulls*bl.hay + wcHeads*wcHead.hay + hHeads*hHead.hay)*n, supLb = (cows*cw.sup + bulls*bl.sup + wcHeads*wcHead.sup + hHeads*hHead.sup)*n;
          var weeks = n/7, trips = 0;
          if(hayLb > 1) trips = Math.max(trips, weeks*feeds.hayTrips);
          if(supLb > 1) trips = Math.max(trips, weeks*feeds.supTrips);
          var feedCost = hayLb/2000*feeds.hayPrice + supLb/2000*feeds.supPrice;
          var tripCost = trips*feeds.tripCost, distCost = (hayLb + supLb)/2000*feeds.distPerTon;
          months.push({
            m:m, name:MONTHS[m], days:n, dietTdn:dTdn, dietCp:dCp, pastureShare:f,
            forageAvailLb:availTot, forageDemandLb:demand, carryOutLb:stock.reduce(function(a, b){ return a + b; }, 0),
            req:{cow:{tdn:r.cowTdn, cp:r.cowCp, tdnNoWx:r.cowTdnNoWx}, bull:{tdn:r.bullTdn, cp:r.bullCp, tdnNoWx:r.bullTdnNoWx}, env:r.env,
                 calf:{tdn:r.calfTdn, cp:r.calfCp, dm:r.calfDm, nursing:r.calvesNursing},
                 weaned:{n:r.wcN, tdn:r.wcN > 0 ? r.wcTdn/r.wcN : 0, cp:r.wcN > 0 ? r.wcCp/r.wcN : 0, bw:r.wcBw},
                 heifer:{n:r.hN, tdn:r.hN > 0 ? r.hTdn/r.hN : 0, cp:r.hN > 0 ? r.hCp/r.hN : 0, bw:r.hBw}, bcsTdn:r.bcsTdn},
            herdReq:{tdn:cows*(r.cowTdn + r.calfTdn + r.wcTdn + r.hTdn) + bulls*r.bullTdn, cp:cows*(r.cowCp + r.calfCp + r.wcCp + r.hCp) + bulls*r.bullCp,
                     cowTdn:cows*r.cowTdn, bullTdn:bulls*r.bullTdn, calfTdn:cows*r.calfTdn, wcTdn:cows*r.wcTdn, hTdn:cows*r.hTdn,
                     cowCp:cows*r.cowCp, bullCp:bulls*r.bullCp, calfCp:cows*r.calfCp, wcCp:cows*r.wcCp, hCp:cows*r.hCp},
            pasture:{tdn:cows*(cw.forage*dTdn/100 + calfTdnSup) + bulls*bl.forage*dTdn/100 + wcHeads*wcHead.forage*dTdn/100 + hHeads*hHead.forage*dTdn/100,
                     cp:cows*(cw.forage*dCp/100 + calfCpSup) + bulls*bl.forage*dCp/100 + wcHeads*wcHead.forage*dCp/100 + hHeads*hHead.forage*dCp/100},
            cow:cw, bull:bl, wc:wcHead, wcHeads:wcHeads, heifer:hHead, heiferHeads:hHeads,
            calfShortTdn:Math.max(0, r.calfTdn - calfTdnSup), calfShortCp:Math.max(0, r.calfCp - calfCpSup),
            hayLb:hayLb, supLb:supLb, trips:trips, feedCost:feedCost, tripCost:tripCost, distCost:distCost,
            cost:feedCost + tripCost + distCost
          });
        }
      }
      // Nursing calves short of energy/protein (grass too poor, too little, or more than they can eat):
      // pounds of weaning weight lost, or creep feed needed to reach the planned weaning weight.
      var shT = 0, shP = 0;
      months.forEach(function(x){ shT += x.calfShortTdn*x.days; shP += x.calfShortCp*x.days; });
      var perCalfT = co.weaned > 0 ? shT/co.weaned : 0, perCalfP = co.weaned > 0 ? shP/co.weaned : 0;
      var midBw = (o.birthLb + o.weanLb)/2, ftAvg = 58;
      var m0c = calfDay(o, midBw, co.preAdg, 0, ftAvg, null), m1c = calfDay(o, midBw, co.preAdg + 0.2, 0, ftAvg, null);
      var mT = Math.max(0.5, (m1c.tdnLb - m0c.tdnLb)/0.2), mP = Math.max(0.05, (m1c.cpLb - m0c.cpLb)/0.2);
      var lbLost = Math.min(o.weanLb*0.4, perCalfT/mT);   // energy-limited (calves on milk + forage rarely lack protein the way a forage CP balance suggests)
      var creepPerCalf = lbLost*(o.creepConv || 8);   // lb of creep per lb of added gain: 5-10:1 when forage is short or poor (NDSU Extension)
      var calfStrat = o.calfShort === 'lighter' ? 'lighter' : 'creep';
      if(calfStrat === 'lighter' && lbLost > 0.5){
        co = calfOutcome(Object.assign({}, o, {weanPenaltyLb:lbLost}), cs);
      }
      var calfInfo = {strategy:calfStrat, lbLostPerCalf:lbLost, creepLbPerCalf:creepPerCalf, shortTdnPerCalf:perCalfT, shortCpPerCalf:perCalfP,
                      creepLb:calfStrat === 'creep' ? creepPerCalf*co.weaned*o.cows : 0};
      calfInfo.creepCost = calfInfo.creepLb/2000*(o.creepPrice || 0);
      // cow body condition through the year, starting at the calving-season month with the condition you set at calving.
      // Energy short of need (TDN lb/day) is drawn from body reserves (NE from tissue at 0.8, NRC 2016); surplus is stored at the diet's NEg efficiency.
      var sbwC = o.cowLb/LB*0.96, perBcs = bodyEnergy(sbwC, 5, 5) - bodyEnergy(sbwC, 5, 4);
      var calvM = cs.reduce(function(a, c){ a[c.birthMonth] = (a[c.birthMonth] || 0) + c.share; return a; }, []);
      var m0 = 0; calvM.forEach(function(v, m){ if(v > (calvM[m0] || 0)) m0 = m; });
      var bcsStart = +o.bcs || 5, b = bcsStart, bcsByMonth = [], lowB = b, lowM = m0;
      for(var k = 0; k < 12; k++){
        var mm = (m0 + k) % 12, x = months[mm], me = x.dietTdn/100*4.409*0.82, km = nemaOf(x.dietTdn)/me, kg = Math.max(0.05, negaOf(x.dietTdn))/me;
        var mcalDay = (x.cow.eSur*kg - x.cow.eLeft*km/0.8)*1.64;      // tissue energy, Mcal/day (1 lb TDN = 1.64 Mcal ME)
        var d = mcalDay*x.days/perBcs;
        d = Math.max(-1, Math.min(0.5, d));
        b = Math.max(1, Math.min(Math.max(bcsStart, 5), b + d));   // cows regain on good grass, but not past calving condition (5 if thinner)
        x.cowBcs = b; bcsByMonth[mm] = b;
        if(b < lowB){ lowB = b; lowM = mm; }
      }
      var bcsInfo = {mode:protOnly ? 'protein' : 'full', start:bcsStart, startMonth:m0, low:lowB, lowMonth:lowM, end:b, byMonth:bcsByMonth, mcalPerScore:perBcs};
      var tot = months.reduce(function(a, x){ a.hay += x.hayLb; a.sup += x.supLb; a.feed += x.feedCost; a.trips += x.trips; a.tripCost += x.tripCost; a.dist += x.distCost; a.cost += x.cost; return a; },
        {hay:0, sup:0, feed:0, trips:0, tripCost:0, dist:0, cost:0});
      var econ = {
        calvesSold:o.cows*co.sold, heifersKept:o.cows*co.kept, opensSold:o.cows*co.opens, cullsSold:o.cows*co.culls,
        calfIncome:o.cows*co.calfIncome, openIncome:o.cows*co.openIncome, cullIncome:o.cows*co.cullIncome, avgSaleLb:co.avgSaleLb, avgWeanLb:co.avgWeanLb, avgPrice:co.avgPrice,
        income:o.cows*co.income, feed:tot.feed, trips:tot.tripCost, dist:tot.dist,
        nwsCare:o.nwsPresent ? o.cows*co.nwsCalves*(o.nwsCost || 0) : 0, creep:calfInfo.creepCost, creepLb:calfInfo.creepLb,
        weanLbNoCreep:co.avgWeanLb - (calfStrat === 'creep' ? lbLost : 0), lbLostPerCalf:lbLost, creepLbPerCalf:creepPerCalf,
        deadWeather:o.cows*co.deadWeather, deadNws:o.cows*co.deadNws, deadOther:o.cows*co.deadOther,
        cowDeaths:o.cows*(o.cowLoss || 0)/100
      };
      econ.costs = econ.feed + econ.trips + econ.dist + econ.nwsCare + econ.creep;
      econ.net = econ.income - econ.costs;
      return {months:months, totals:tot, econ:econ, calves:co, forageTdn:ftdn, bcs:bcsInfo, calf:calfInfo};
    }

    function doy(mmdd){ var p = String(mmdd || '').split('-'); var mo = +p[0], da = +p[1]; if(!(mo >= 1 && mo <= 12 && da >= 1)) return 45; return MONTH_START[mo - 1] + Math.min(da, MONTH_DAYS[mo - 1]) - 1; }
    function regionFromMlra(mlra){
      if(!mlra) return null;
      var n = parseInt(mlra, 10);
      if(n === 77) return 'hp';
      if(n === 78) return 'rp';
      if(n === 81 || n === 82 || n === 42 || n === 70) return 'ep';
      if(n === 83) return 'st';
      if(n >= 60 && n <= 150) return 'ce';
      return null;
    }
    function regionFromLatLng(c){
      if(!c) return 'ce';
      if(c.lng < -101 && c.lat > 32) return 'hp';
      if(c.lat < 29.5 && c.lng < -97.2) return 'st';
      if(c.lng < -99 && c.lat < 32) return 'ep';
      if(c.lng < -97.8 && c.lat >= 32) return 'rp';
      return 'ce';
    }
    return {pastureGrowth:pastureGrowth, heiferDay:heiferDay, heiferState:heiferState, heifersKeptPerCow:heifersKeptPerCow, heiferAges:heiferAges, bodyEnergy:bodyEnergy, SEASON_CALF:SEASON_CALF, SEASON_CULL:SEASON_CULL, nemaOf:nemaOf, needAt:needAt, cowParams:cowParams, envFor:envFor, birthLb:birthLb, BREEDS:BREEDS, MILK:MILK, REGIONS:REGIONS, QUALITY:QUALITY, ACTIVITY:ACTIVITY, MONTHS:MONTHS, MONTH_DAYS:MONTH_DAYS, MONTH_START:MONTH_START,
            NAHMS:NAHMS, SOURCES:SOURCES, LOSS_DEFAULT:LOSS_DEFAULT, WEATHER_SHARE:WEATHER_SHARE,
            cowDay:cowDay, bullDay:bullDay, calfDay:calfDay, requirements:requirements, pastureSupply:pastureSupply, adjustSupply:adjustSupply, balance:balance,
            intakePct:intakePct, doy:doy, regionFromMlra:regionFromMlra, regionFromLatLng:regionFromLatLng, solveTDN:solveTDN, cohorts:cohorts, calfOutcome:calfOutcome,
            weatherFactor:weatherFactor, flyActivity:flyActivity, slideLookup:slideLookup, monthOfDay:monthOfDay};
  })();
