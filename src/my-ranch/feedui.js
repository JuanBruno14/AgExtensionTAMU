
  /* ------------------------------------------------------------------ feed calendar UI */
  var feedLast = null, feedKey = '', feedNutrient = 'tdn', decTab = 'calving', decTimer = null, decKey = '', calvSellTimer = null;

  /* Market price slides (same data and anchors as the Cow-Calf tools), rescaled to the shared market store */
  var STEER_SLIDE_BASE = [{w:397.0,p:629.0},{w:463.8,p:565.3},{w:516.4,p:530.0},{w:654.7,p:441.5},{w:762.3,p:437.9},{w:835.5,p:420.8},{w:962.3,p:392.1},{w:1140.0,p:318.2}];
  var HEIFER_SLIDE_BASE = [{w:337.0,p:554.1},{w:455.1,p:492.9},{w:531.3,p:460.0},{w:654.1,p:425.9},{w:765.6,p:395.8},{w:862.6,p:374.5},{w:922.0,p:321.6}];
  function cullPrice(mult){
    var v = 180;
    try{ var mp = JSON.parse(localStorage.getItem('tamuDecisionAidsMarketPrices') || 'null'); if(mp && +mp.mp_cullCowPrice > 0) v = +mp.mp_cullCowPrice; }catch(e){}
    return v*(mult || 1);
  }
  function slides(mult){
    var mp = {}; try{ mp = JSON.parse(localStorage.getItem('tamuDecisionAidsMarketPrices') || 'null') || {}; }catch(e){}
    var rs = (+mp.mp_steerPrice > 0 ? +mp.mp_steerPrice : 530)/530*(mult || 1), rh = (+mp.mp_heiferPrice > 0 ? +mp.mp_heiferPrice : 460)/460*(mult || 1);
    return {steer:STEER_SLIDE_BASE.map(function(p){ return {w:p.w, p:p.p*rs}; }), heifer:HEIFER_SLIDE_BASE.map(function(p){ return {w:p.w, p:p.p*rh}; })};
  }

  function bindHerdValues(){
    var h = state.herd;
    $('hd_cows').value = h.cows > 0 ? h.cows : '';
    $('hd_cowLb').value = h.cowLb;
    $('hd_bulls').value = h.bulls != null ? h.bulls : '';
    $('hd_bullLb').value = h.bullLb;
    renderHerdNote();
    bindFeedValues();
  }
  function renderHerdNote(){
    var h = state.herd, b = bullCount();
    $('hd_bullsHint').textContent = h.bulls != null ? 'Your number' : 'Auto: 1 per ' + cowsPerBull() + ' cows (' + b + ')';
    $('hd_bulls').placeholder = String(b);
    var a = herdAUParts();
    var row = function(lbl, calc, v){ return '<tr><td>' + lbl + '</td><td class="au-calc">' + calc + '</td><td class="num">' + fmt(v, 1) + '</td></tr>'; };
    var bc = bullCount();
    $('hd_auNote').innerHTML = h.cows > 0
      ? '<div class="au-box"><div class="au-title">How your herd adds up in animal units (AU)</div>' +
        '<table class="au-table"><tbody>' +
        row('Cows with calves up to 6 months', fmt(h.cows) + ' × ' + fmt(a.cowAue, 3) + ' AU', a.cows) +
        (a.bulls > 0 ? row('Bulls', bc + ' × ' + fmt(a.bullAue, 3) + ' AU', a.bulls) : '') +
        (a.calves > 0.05 ? row('Calves older than 6 months', 'year average', a.calves) : '') +
        (a.heifers > 0.05 ? row('Replacement heifers', 'year average', a.heifers) : '') +
        '</tbody><tfoot><tr><td>Total</td><td></td><td class="num">' + fmt(a.total, 1) + ' AU</td></tr></tfoot></table>' +
        '<div class="au-foot">1 AU = a 1,000 lb cow with her calf, eating 26 lb of forage a day. Other weights count by metabolic weight: AU = (weight ÷ 1,000 lb)<sup>0.75</sup> — a ' + fmt(h.cowLb) + ' lb cow = ' + fmt(a.cowAue, 2) + ' AU' + (a.bulls > 0 ? ', a ' + fmt(h.bullLb) + ' lb bull = ' + fmt(a.bullAue, 2) + ' AU' : '') + '. Calves and heifers count by their weight for the days they are on the ranch.</div></div>'
      : '<div class="au-box"><div class="au-foot" style="margin:0;">1 animal unit (AU) = a 1,000 lb cow with a calf up to 6 months (26 lb of forage a day). Heavier animals count by metabolic weight: a 1,200 lb cow = 1.15 AU. Enter your cows to see your herd’s total.</div></div>';
  }
  function mmddToDate(s){ return '2026-' + (s || '02-15'); }
  function dateToMmdd(v){ var m = String(v || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? m[1] + '-' + m[2] : null; }
  function mmddText(s){ var p = String(s).split('-'); return FEED.MONTHS[+p[0] - 1] + ' ' + (+p[1]); }
  function autoRegion(){
    var w = {};
    state.pastures.forEach(function(p){
      if(p.soil && p.soil.mlra){ var r = FEED.regionFromMlra(p.soil.mlra); if(r) w[r] = (w[r] || 0) + p.acres; }
    });
    var best = null, bw = 0; Object.keys(w).forEach(function(k){ if(w[k] > bw){ bw = w[k]; best = k; } });
    if(best) return {key:best, why:'from your soils (MLRA ' + mlraOf(best) + ')'};
    var c = ranchCenter();
    return {key:FEED.regionFromLatLng(c), why:c ? 'from the ranch location' : 'default until you draw pastures'};
  }
  function mlraOf(regKey){
    var out = null;
    state.pastures.forEach(function(p){ if(!out && p.soil && p.soil.mlra && FEED.regionFromMlra(p.soil.mlra) === regKey) out = p.soil.mlra; });
    return out || '';
  }
  function regionKey(){ return state.herd.region !== 'auto' && FEED.REGIONS[state.herd.region] ? state.herd.region : autoRegion().key; }
  function calvingText(){
    var h = state.herd;
    if(h.calving === 'us') return 'U.S. average spread (NAHMS 2017), weaned at ' + h.weanAge + ' days';
    if(h.calving === 'two') return (100 - h.share2) + '% from ' + mmddText(h.start1) + ' for ' + h.len1 + ' days (weaned ' + mmddText(h.wean1) + '), ' + h.share2 + '% from ' + mmddText(h.start2) + ' for ' + h.len2 + ' days (weaned ' + mmddText(h.wean2) + ')';
    return 'from ' + mmddText(h.start1) + ' for ' + h.len1 + ' days, weaned ' + mmddText(h.wean1);
  }

  function bindFeedValues(){
    var h = state.herd;
    document.querySelectorAll('[data-h]').forEach(function(el){ el.value = h[el.getAttribute('data-h')]; });
    document.querySelectorAll('[data-hs]').forEach(function(el){ if(el.options.length) el.value = String(h[el.getAttribute('data-hs')]); });
    document.querySelectorAll('[data-hd]').forEach(function(el){ el.value = mmddToDate(h[el.getAttribute('data-hd')]); });
    document.querySelectorAll('[data-dr]').forEach(function(el){ el.value = h.dr[el.getAttribute('data-dr')]; });
    document.querySelectorAll('[data-sl]').forEach(function(el){ el.value = (h.sell || {})[el.getAttribute('data-sl')]; });
    document.querySelectorAll('[data-drs]').forEach(function(el){ if(el.options.length) el.value = String(h.dr[el.getAttribute('data-drs')]); });
    if($('fc_source').options.length) $('fc_source').value = FEED.SOURCES[h.source] ? h.source : 'custom';
    syncFields();
  }
  function syncFields(){
    var h = state.herd, c = h.calving;
    document.querySelectorAll('.fc-season1').forEach(function(el){ el.hidden = c === 'us'; });
    document.querySelectorAll('.fc-season2').forEach(function(el){ el.hidden = c !== 'two'; });
    document.querySelectorAll('.fc-usonly').forEach(function(el){ el.hidden = c !== 'us'; });
    document.querySelector('.fc-usnote').hidden = c !== 'us';
    $('fc_start1Label').textContent = c === 'two' ? 'Spring calving starts' : 'Calving starts';
    $('fc_wean1Label').textContent = c === 'two' ? 'Spring calves weaned on' : 'Weaning date';
    document.querySelectorAll('.fc-nws').forEach(function(el){ el.hidden = h.nws !== 'yes'; });
    var s = FEED.SOURCES[h.source];
    $('fc_perLbCp').textContent = h.supCp > 0 ? '$' + fmt(h.supPrice/2000/(h.supCp/100), 2) + ' per lb of protein' : '';
    $('fc_supCp').readOnly = $('fc_supTdn').readOnly = !!(s && s.cp != null);
  }
  function wxDelta(x){ return x.req.cow.tdn - x.req.cow.tdnNoWx - (x.req.bcsTdn || 0); }
  function wxCell(x){
    if(!x.req.env) return '—';
    var d = wxDelta(x);
    return Math.abs(d) < 0.05 ? '0' : (d > 0 ? '+' : '−') + fmt(Math.abs(d), 1);
  }
  function wxNote(ms){
    if(!ms.length || !ms[0].req.env) return 'Weather adjustments are off: needs are for mild, dry weather.';
    var hi = ms.reduce(function(a, x){ return wxDelta(x) > wxDelta(a) ? x : a; }, ms[0]);
    var lo = ms.reduce(function(a, x){ return wxDelta(x) < wxDelta(a) ? x : a; }, ms[0]);
    var t = 'Weather = how much the month’s temperature, wind and heat change a cow’s TDN need (NRC 2016 model, lb/day).';
    if(wxDelta(hi) >= 0.05) t += ' Largest increase: ' + hi.name + ' (+' + fmt(wxDelta(hi), 1) + ' lb).';
    if(wxDelta(lo) <= -0.05) t += ' Cows used to warm weather need less in ' + lo.name + ' (−' + fmt(-wxDelta(lo), 1) + ' lb).';
    return t;
  }
  function renderRegionSelect(){
    var sel = $('fc_region'), a = autoRegion(), cur = state.herd.region;
    var html = '<option value="auto">Auto — ' + esc(FEED.REGIONS[a.key].label) + '</option>' +
      Object.keys(FEED.REGIONS).map(function(k){ return '<option value="' + k + '">' + esc(FEED.REGIONS[k].label) + '</option>'; }).join('');
    if(sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = FEED.REGIONS[cur] ? cur : 'auto';
    var k = regionKey(), R = FEED.REGIONS[k];
    $('fc_regionHint').textContent = (cur === 'auto' ? 'Picked ' + a.why + '. ' : '') + 'Growth curve: NRCS ' + R.src + '. Weather: ' + R.station + ' normals.';
  }

  /* ---- inputs to the engine */
  function feedOptions(over){
    var h = state.herd, sl = slides(over && over.priceMult);
    var o = {cows:h.cows, bulls:bullCount(), cowLb:h.cowLb, bullLb:h.bullLb, breed:h.breed, bcs:+h.bcs, peakMilkLb:FEED.MILK[h.milk] || 18,
      activity:FEED.ACTIVITY[h.activity] || 0, calving:h.calving, start1:FEED.doy(h.start1), len1:h.len1, start2:FEED.doy(h.start2), len2:h.len2, share2:h.share2,
      weanMode:h.calving === 'us' ? 'age' : 'date', weanAge:h.weanAge, weanDoy1:FEED.doy(h.wean1), weanDoy2:FEED.doy(h.wean2),
      weanLb:h.weanLb, birthLb:FEED.birthLb({breed:h.breed}), weanPeriod:h.weanPeriod, postAdg:h.postAdg,
      calvingRate:h.calvingRate, calfLoss:h.calfLoss, cowLoss:h.cowLoss, region:regionKey(),
      replRate:+h.replRate || 0, heiferPreg:+h.heiferPreg || 85, cullPrice:cullPrice(over && over.priceMult), bcsWean:+h.bcsWean || +h.bcs,
      seasonal:h.seasonal !== 'off', nowMonth:new Date().getMonth(),
      weatherAdj:h.weatherAdj !== 'off', windMph:h.windMph, coat:+h.coat || 1, heat:+h.heat || 1,
      nwsPresent:h.nws === 'yes', nwsLoss:h.nwsLoss, nwsCost:h.nwsCost, hornFly:+h.hornFly,
      supMode:h.supMode === 'full' ? 'full' : 'protein', mineralOz:h.mineralOz == null ? 4 : +h.mineralOz, mineralPrice:h.mineralPrice == null ? 0.45 : +h.mineralPrice, calfShort:h.calfShort === 'lighter' ? 'lighter' : 'creep', creepPrice:+h.creepPrice || 0, creepConv:+h.creepConv || 8,
      steerSlide:sl.steer, heiferSlide:sl.heifer};
    var ownCs = FEED.cohorts(o);
    o.refWeanAge = ownCs.reduce(function(a, c){ return a + c.share*c.weanAge; }, 0);
    o.ownWeather = FEED.weatherLoss(o, ownCs);   // weather share of your own loss rate, kept when other seasons are tried
    return Object.assign(o, over || {});
  }
  function feedsFor(over){
    var h = state.herd;
    return Object.assign({hayTdn:h.hayTdn, hayCp:h.hayCp, hayDm:+h.hayDm || 88, hayPrice:h.hayPrice, supTdn:h.supTdn, supCp:h.supCp, supPrice:h.supPrice,
      tripCost:h.tripCost, supTrips:+h.supTrips, hayTrips:+h.hayTrips, distPerTon:h.distPerTon}, over || {});
  }
  function supplyNow(mult){
    var past = state.pastures.map(function(p){ return {annualLb:annualLb(p), type:p.type, grazed:isGrazed(p), measured:p.measured || null, forageAcres:forageAcres(p), name:p.name}; });
    var reg = regionKey(), he = state.settings.harvestEff/100;
    var sup = FEED.pastureSupply(past, he, reg);
    var t = totals(), mc = state.settings.manualCap;
    if(mc > 0){
      var target = mc*state.settings.intakeLb*365;            // lb/yr available to graze at the stated capacity
      var have = sup.reduce(function(a, g){ return a + g.annual; }, 0);
      if(have > 0) sup.forEach(function(g){ var k = target/have; g.annual *= k; g.growth = g.growth.map(function(x){ return x*k; }); });
      else sup = FEED.pastureSupply([{annualLb:target/he, type:'range', grazed:true}], he, reg);
    }
    if(mult && mult !== 1) sup.forEach(function(g){ g.annual *= mult; g.growth = g.growth.map(function(x){ return x*mult; }); });
    return sup;
  }
  function runFeed(){
    var o = feedOptions(), f = feedsFor(), sup = supplyNow();
    var key = JSON.stringify([o, f, sup]);
    if(key === feedKey && feedLast) return feedLast;
    var res = FEED.balance(o, sup, f);
    res.hasSupply = sup.length > 0;
    feedKey = key; feedLast = res;
    return res;
  }


  /* ------------------------------------------------------------------ one-page year plan */
  function bestCalvingMonth(){
    var h = state.herd, len = h.calving === 'us' ? 60 : h.len1, base = feedOptions(), age = Math.round(base.refWeanAge), best = null;
    for(var m = 0; m < 12; m++){
      var r = netOf({calving:'one', start1:FEED.MONTH_START[m] + 14, len1:len, weanMode:'age', weanAge:age, refWeanAge:age});
      if(!best || r.econ.net > best.net) best = {m:m, net:r.econ.net};
    }
    return best;
  }
  function planSheetHtml(){
    var h = state.herd, t = totals(), a = herdAUParts(), res = runFeed(), ec = res.econ, tot = res.totals, ms = res.months;
    var today = new Date().toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'});
    var use = t.cap > 0 ? a.total/t.cap : null;
    var bestC = res.hasSupply ? bestCalvingMonth() : null;
    var hayM = [], supM = [];
    ms.forEach(function(x, m){ if(x.hayLb > 1) hayM.push(m); if(x.supLb > 1) supM.push(m); });
    var per = 'lb per cow per day';
    var rows = ms.map(function(x){
      return '<tr><td>' + x.name + '</td><td class="num">' + fmt(x.pastureShare*100) + '%</td><td class="num">' + fmt(x.req.cow.tdn, 1) + ' / ' + fmt(x.req.cow.cp, 2) + '</td>' +
        '<td class="num">' + (x.cow.hay > 0.05 ? fmt(x.cow.hay, 1) : '—') + '</td><td class="num">' + (x.cow.sup > 0.05 ? fmt(x.cow.sup, 1) : '—') + '</td>' +
        '<td class="num">' + (x.hayLb > 1 ? fmt(x.hayLb/2000, 1) : '—') + '</td><td class="num">' + (x.supLb > 1 ? fmt(x.supLb/2000, 1) : '—') + '</td><td class="num">' + (x.cost > 0.5 ? money(x.cost) : '—') + '</td></tr>';
    }).join('');
    var gp = grazingPlan(), gsvg = '';
    if(gp){ var tmp = document.createElement('div'); tmp.innerHTML = grazingPlanHtml(); var sv = tmp.querySelector('svg'); gsvg = sv ? sv.outerHTML : ''; }
    function kv(k, v){ return '<div class="ps-kv"><span>' + k + '</span><strong>' + v + '</strong></div>'; }
    return '<div class="ps-head"><div><div class="ps-kicker">Texas A&amp;M AgriLife Extension · My Ranch</div><h1>' + esc(state.name || 'My ranch') + ' — plan for the year</h1></div><div class="ps-date">' + today + '</div></div>' +
      '<div class="ps-grid">' +
        kv('Land', fmt(t.acres) + ' ac · ' + t.pastures + ' pasture' + (t.pastures === 1 ? '' : 's')) +
        kv('Carrying capacity', t.cap > 0 ? fmt(t.cap) + ' AU' + (t.lowCap != null ? ' (' + fmt(t.lowCap) + ' in a dry year)' : '') : '—') +
        kv('Planned herd', fmt(a.total) + ' AU' + (use != null ? ' · ' + fmt(use*100) + '% of capacity' : '')) +
        kv('Herd', fmt(h.cows) + ' cows, ' + bullCount() + ' bulls' + (ec.heifersKept > 0.05 ? ', keep ' + fmt(ec.heifersKept) + ' heifers' : '')) +
        kv("Calving", esc(calvingText())) +
        kv('Sell', fmt(ec.calvesSold) + ' calves × ' + fmt(ec.avgSaleLb) + ' lb' + (ec.cullsSold > 0.05 ? ' · ' + fmt(ec.cullsSold) + ' culls' : '')) +
      '</div>' +
      (res.hasSupply ? '<div class="ps-grid ps-money">' +
        kv('Hay to buy', tot.hay >= 100 ? fmt(tot.hay/2000, 1) + ' t · ' + money(tot.hay/2000*h.hayPrice) + ' · ' + monthList(hayM) : 'None') +
        kv('Supplement', tot.sup >= 100 ? fmt(tot.sup/2000, 1) + ' t · ' + money(tot.sup/2000*h.supPrice) + ' · ' + monthList(supM) : 'None') +
        kv('Cattle sales', money(ec.income)) +
        kv('Sales − feed', money(ec.net) + ' (' + money(ec.net/h.cows) + '/cow) · not profit') +
      '</div>' : '') +
      '<table class="ps-table"><thead><tr><th>Month</th><th class="num">Pasture covers</th><th class="num">Cow needs TDN / CP</th><th class="num">Hay/cow</th><th class="num">Suppl./cow</th><th class="num">Hay, t</th><th class="num">Suppl., t</th><th class="num">Cost</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="ps-note">Needs and feed are ' + per + ' (herd-average cow); tons are for the whole herd including bulls, weaned calves and heifers.</div>' +
      (gsvg ? '<h2>Grazing calendar</h2><div class="ps-graze">' + gsvg + '</div><div class="ps-note">Green: grazing · orange: herd kept there and fed hay · gray: resting. Moves at least every ' + gp.maxStay + ' days, in the order set on the map page.</div>' : '') +
      '<h2>Things to watch</h2><ul class="ps-list">' +
        (use != null && use > 1 ? '<li>The herd is ' + fmt((use - 1)*100) + '% over the estimated capacity: plan to sell down, lease grazing, or budget the hay above.</li>' : '') +
        (bestC ? '<li>Best calving month at today’s prices and your pastures: <strong>' + FEED.MONTHS[bestC.m] + '</strong>' + (h.calving !== 'us' && FEED.monthOfDay(FEED.doy(h.start1)) === bestC.m ? ' (what you do now).' : ' — worth ' + money(bestC.net - ec.net) + ' a year more than your current season.') + '</li>' : '') +
        (+h.bcsWean > 0 && +h.bcsWean < +h.bcs ? '<li>Cows weaning at condition ' + h.bcsWean + ' need to get back to ' + h.bcs + ' before calving: feed it between weaning and a month before calving, when it is cheapest.</li>' : '') +
        '<li>Check forage in the pastures each season (clip-and-weigh or a grazing stick) and update the map — the numbers here are typical, not measured.</li>' +
        (h.nws === 'yes' ? '<li>Screwworm: check newborn calves daily during warm months and report suspected cases to TAHC.</li>' : '') +
      '</ul><div class="ps-foot">Estimates from USDA-NRCS soil survey forage, NRC 2016 nutrient requirements and your inputs. Not a guarantee of results. Talk to your county Extension agent before making big changes.</div>';
  }
  /* Share this herd's purchased-feed cost per cow with the Cow operating cost (BCU) calculator on the home page */
  var RANCH_FEED_KEY = 'tamuDecisionAidsRanchFeed';
  function sendFeedToBcu(){
    var h = state.herd; if(!(h.cows > 0)) return;
    var res = runFeed(), t = res.totals, per = function(v){ return Math.round(v/h.cows*100)/100; };
    var payload = {hay:per(t.hay/2000*h.hayPrice), supplement:per(t.sup/2000*h.supPrice), feeding:per(t.tripCost + t.dist),
                   hayTons:Math.round(t.hay/2000*10)/10, supTons:Math.round(t.sup/2000*10)/10, cows:h.cows, ranch:state.name || '', savedAt:new Date().toISOString()};
    payload.total = Math.round((payload.hay + payload.supplement + payload.feeding)*100)/100;
    var ok = true; try{ localStorage.setItem(RANCH_FEED_KEY, JSON.stringify(payload)); }catch(e){ ok = false; }
    $('fc_bcuNote').innerHTML = ok ? 'Sent: ' + money(payload.total) + ' per cow (hay ' + money(payload.hay) + ', supplement ' + money(payload.supplement) + ', feeding ' + money(payload.feeding) + '). Open <a href="../index.html#bcu-calculator">Cow operating cost</a> on the home page and choose “Use My Ranch feed”.' : 'This browser is blocking storage, so the cost can’t be shared.';
  }
  var planBusy = false;
  function printPlan(){
    if(planBusy) return;
    planBusy = true; setTimeout(function(){ planBusy = false; }, 1500);
    var el = document.getElementById('planSheet');
    if(!el){ el = document.createElement('div'); el.id = 'planSheet'; document.body.appendChild(el); }
    el.innerHTML = planSheetHtml();
    document.documentElement.classList.add('print-plan');
    var done = function(){ document.documentElement.classList.remove('print-plan'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function(){ window.print(); }, 50);
  }

  /* ---- grazing calendar: one herd moved through the pastures in your order */
  function grazingPlan(){
    if(!(state.herd.cows > 0)) return null;
    var list = state.pastures.filter(function(p){ return isGrazed(p) && annualLb(p) != null; });
    if(!list.length) return null;
    var res = runFeed(), reg = regionKey(), he = state.settings.harvestEff/100;
    var k = 1, mc = state.settings.manualCap;
    if(mc > 0){ var have = list.reduce(function(a, p){ return a + annualLb(p)*he; }, 0); if(have > 0) k = mc*state.settings.intakeLb*365/have; }
    var P = list.map(function(p){
      return {p:p, g:FEED.pastureGrowth({annualLb:annualLb(p), type:p.type}, he, reg).map(function(x){ return x*k; }),
              meas:p.measured && p.measured.lbAc > 0 ? {m:p.measured.month, lb:p.measured.lbAc*forageAcres(p)*he} : null,
              stock:0, day:[], sd:[], visits:0, grazed:0, fed:0};
    });
    // ungrazed grass doesn't pile up forever: it weathers and is trampled, so standing forage never exceeds one year's usable growth
    P.forEach(function(x){ x.cap = Math.max(x.g.reduce(function(a, b){ return a + b; }, 0), x.meas ? x.meas.lb : 0); });
    var maxStay = Math.max(3, +state.settings.maxGraze || 30), cur = 0, stay = 0, hayDays = 0, feeding = false, demDay = [];
    for(var yr = 0; yr < 2; yr++){
      for(var d = 0; d < 365; d++){
        var m = FEED.monthOfDay(d), first = d === FEED.MONTH_START[m];
        var dem = res.months[m].forageDemandLb/FEED.MONTH_DAYS[m];
        P.forEach(function(x){ if(first && x.meas && x.meas.m === m) x.stock = x.meas.lb; x.stock = Math.min(x.stock + x.g[m]/FEED.MONTH_DAYS[m], x.cap); if(yr === 1) x.sd[d] = x.stock; });
        if(yr === 1) demDay[d] = dem;
        // move when this pasture can't feed today, or after the longest stay, to the next pasture (in your order) with at least
        // a week of feed (two weeks if the herd is being fed hay). If none has, the herd stays put and is fed there.
        if(P[cur].stock < dem || stay >= maxStay){
          var need = feeding ? 14 : 7;
          for(var j = 1; j < P.length + (P.length === 1 ? 1 : 0); j++){ var c = (cur + j) % P.length; if(c !== cur && P[c].stock >= dem*need){ cur = c; stay = 0; if(yr === 1) P[cur].visits++; break; } }
        }
        var x = P[cur], eat = Math.min(x.stock, dem); x.stock -= eat; stay++; feeding = eat < dem*0.98;
        if(yr === 1){
          var short = eat < dem*0.98;
          P.forEach(function(y, i){ y.day[d] = i === cur ? (short ? 'feed' : 'graze') : 'rest'; });
          if(short){ x.fed++; hayDays++; } else x.grazed++;
        }
      }
    }
    P.forEach(function(x){
      // rest periods between visits (wrapping the year)
      var rests = [], run = 0, started = false, firstRun = 0;
      for(var d = 0; d < 365; d++){ if(x.day[d] === 'rest'){ run++; } else { if(run){ if(started) rests.push(run); else firstRun = run; } run = 0; started = true; } }
      if(run || firstRun) rests.push(run + firstRun);
      x.rest = rests.length && x.grazed + x.fed > 0 ? rests.reduce(function(a, b){ return a + b; }, 0)/rests.length : null;
      if(!x.visits && x.grazed + x.fed > 0) x.visits = 1;
    });
    return {P:P, hayDays:hayDays, maxStay:maxStay, dem:demDay};
  }

  /* ---- where the herd is today and how much grass each pasture has standing (estimates from the grazing calendar) */
  function todayDate(){ var t = window.MR_TODAY ? new Date(window.MR_TODAY + 'T12:00:00') : new Date(); t.setHours(12, 0, 0, 0); return t; }
  function dayOfYear(dt){ var m = dt.getMonth(); return Math.min(364, FEED.MONTH_START[m] + dt.getDate() - 1); }
  function addDays(dt, n){ var r = new Date(dt.getTime()); r.setDate(r.getDate() + n); return r; }
  function shortDate(dt){ return FEED.MONTHS[dt.getMonth()] + ' ' + dt.getDate(); }
  function grassToday(){
    var g = grazingPlan(); if(!g) return null;
    var today = todayDate(), td = dayOfYear(today), herd = herdAU();
    var W = function(d){ return ((d % 365) + 365) % 365; };
    var out = {g:g, today:today, list:[], herd:null, herdAU:herd};
    var hn = state.herdNow || {}, actual = null;
    if(hn.pid && hn.since){
      var x0 = null; g.P.forEach(function(x){ if(x.p.id === hn.pid) x0 = x; });
      var since = new Date(hn.since + 'T12:00:00');
      var din = Math.round((today - since)/864e5);
      if(x0 && !isNaN(din) && din >= 0 && din < 365){
        // the herd went in on `since`: start from the grass the calendar has standing that day, then graze it down
        var sd = W(td - din), stock = x0.sd[sd], stay = 0, d = sd, now = null;
        for(var k = 0; k < 400; k++){
          var dd = W(d), m = FEED.monthOfDay(dd);
          if(k > 0) stock = Math.min(stock + x0.g[m]/FEED.MONTH_DAYS[m], x0.cap);
          if(k === din) now = stock;
          if(stock < g.dem[dd] || stay >= g.maxStay) break;
          stock -= g.dem[dd]; stay++; d++;
        }
        if(now == null) now = stock;
        actual = {x:x0, since:since, daysIn:din, stay:stay, now:now};
      } else if(x0 && din < 0) out.future = true;
    }
    g.P.forEach(function(x, i){
      var st = x.day[td], rest = null, standing = x.sd[td];
      if(st === 'rest'){ rest = 0; for(var b = 1; b < 365 && x.day[W(td - b)] === 'rest'; b++) rest = b; if(rest >= 364) rest = null; else rest++; }
      out.list.push({x:x, i:i, planHere:st !== 'rest', rest:rest, standing:standing, days:standing/g.dem[td]});
    });
    if(actual){
      out.list.forEach(function(r){ if(r.x === actual.x){ r.standing = actual.now; r.days = actual.now/g.dem[td]; } });
      out.herd = {p:actual.x.p, since:actual.since, daysIn:actual.daysIn, stay:actual.stay, left:Math.max(0, actual.stay - actual.daysIn), moveBy:addDays(actual.since, actual.stay), source:'you'};
    } else {
      var here = null; out.list.forEach(function(r){ if(r.planHere) here = r; });
      if(here){
        var a = 0; while(a < 364 && here.x.day[W(td - a - 1)] !== 'rest') a++;
        var f = 0; while(f < 364 && here.x.day[W(td + f + 1)] !== 'rest') f++;
        out.herd = {p:here.x.p, since:addDays(today, -a), daysIn:a, stay:a + f + 1, left:f + 1, moveBy:addDays(today, f + 1), source:'plan', fed:here.x.day[td] === 'feed'};
      }
    }
    if(out.herd){
      var hp = out.herd.p, ga = grazeableAcres(hp);
      out.herd.acPerAU = herd > 0 ? ga/herd : null;
      // next pasture in your order with at least a week of grass when the herd moves
      var idx = -1; g.P.forEach(function(x, i){ if(x.p === hp) idx = i; });
      var md = W(td + out.herd.left);
      for(var j = 1; j < g.P.length; j++){ var c = g.P[(idx + j) % g.P.length]; if(c.sd[md] >= g.dem[md]*7){ out.herd.next = {p:c.p, days:c.sd[md]/g.dem[md]}; break; } }
      out.list.forEach(function(r){ r.herdHere = r.x.p === hp; if(r.herdHere) r.rest = null; });
    }
    return out;
  }
  function grassClass(r){ return r.herdHere ? 'herd' : r.days >= 21 ? 'good' : r.days >= 7 ? 'mid' : 'low'; }
  var GRASS_COLORS = {herd:'#8B0215', good:'#1f9e5a', mid:'#e0a526', low:'#c2410c', none:'#8a8a8a'};
  var hnOpen = false;
  function herdNowHtml(){
    var t = grassToday(); if(!t) return '';
    var opts = '<option value="">Follow the grazing calendar</option>' + t.g.P.map(function(x){ return '<option value="' + x.p.id + '"' + ((state.herdNow || {}).pid === x.p.id ? ' selected' : '') + '>' + esc(x.p.name) + '</option>'; }).join('');
    var hn = state.herdNow || {}, h = t.herd, msg = '';
    if(t.future) msg = '<span class="tag warn">Date is in the future</span> Pick the day the herd went in.';
    else if(h){
      var days = function(n){ return fmt(n) + (Math.round(n) === 1 ? ' day' : ' days'); };
      msg = (h.source === 'plan' ? 'By the grazing calendar, the herd is in ' : 'The herd is in ') + '<strong>' + esc(h.p.name) + '</strong> ' + (h.daysIn > 0 ? 'since ' + shortDate(h.since) + ' (' + days(h.daysIn) + ')' : 'from today') +
        (h.acPerAU != null ? ', at ' + fmt(h.acPerAU, h.acPerAU < 10 ? 1 : 0) + ' ac per AU while it’s there' : '') + '. ' +
        (h.fed ? 'No pasture has enough grass right now, so the herd is fed hay here. ' :
         h.left > 0 ? 'Its grass should last until about <strong>' + shortDate(h.moveBy) + '</strong> (' + days(h.left) + ' more). ' : '<strong>Time to move:</strong> by this estimate its grass is used up. ') +
        (h.next ? 'Next: <strong>' + esc(h.next.p.name) + '</strong>, with about ' + days(h.next.days) + ' of grass for the herd when you move.' : 'No other pasture has a week of grass for the herd then — plan hay or supplement.');
    }
    var rows = t.list.slice().sort(function(a, b){ return (b.herdHere - a.herdHere) || (b.days - a.days); }).map(function(r){
      var c = grassClass(r);
      return '<tr><td><span class="p-swatch" style="display:inline-block;vertical-align:-2px;margin-right:6px;background:' + GRASS_COLORS[c] + ';"></span>' + esc(r.x.p.name) + '</td>' +
        '<td>' + (r.herdHere ? '🐄 Herd here' : r.rest != null ? 'Rested ' + fmt(r.rest) + ' d' : r.planHere ? 'Resting' : 'Not used this year') + '</td>' +
        '<td class="num">' + fmt(r.standing/Math.max(forageAcres(r.x.p), 0.01)/(state.settings.harvestEff/100)) + ' lb/ac</td>' +
        '<td class="num">' + fmt(r.days) + ' d</td></tr>';
    }).join('');
    return '<h3 class="gp-title">Where is the herd today?</h3>' +
      '<div class="herd-now-form"><label>Herd is in <select id="hn_pid" aria-label="Pasture the herd is in now">' + opts + '</select></label>' +
      '<label' + (hn.pid ? '' : ' hidden') + '>since <input type="date" id="hn_since" max="' + isoDate(t.today) + '" value="' + (hn.since || '') + '" aria-label="Day the herd went in"></label></div>' +
      '<p class="narrative" id="hn_msg" style="margin:10px 0 0;font-size:13px;">' + msg + '</p>' +
      '<details class="advanced hn-details"' + (hnOpen ? ' open' : '') + ' style="margin-top:10px;"><summary>Grass in each pasture today</summary><div class="adv-body">' +
      '<div class="table-scroll"><table class="plan" id="hn_table"><thead><tr><th>Pasture</th><th>Today</th><th class="num">Standing grass</th><th class="num">Days for the herd</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="card-note" style="margin:8px 0 0;">Estimates from the grazing calendar: growth by month for your region, minus what the herd ate where the calendar put it. Measure a pasture under <em>Pastures → Measured forage</em> to correct it. Same colors as <em>Grass today</em> on the map: green 3+ weeks, yellow 1–3 weeks, orange under a week.</p></div></details>';
  }
  function grazingPlanHtml(){
    var g = grazingPlan(); if(!g) return '';
    var W = 680, lw = 120, rw = 130, cw = (W - lw - rw)/365, rh = 24, H = 26 + g.P.length*rh + 6;
    var s = '<svg class="gp-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Grazing calendar: which pasture the herd is in each day of the year">';
    FEED.MONTHS.forEach(function(n, m){ var x = lw + FEED.MONTH_START[m]*cw; s += '<line class="gp-grid" x1="' + x + '" x2="' + x + '" y1="18" y2="' + (H - 4) + '"/><text class="gp-mon" x="' + (x + FEED.MONTH_DAYS[m]*cw/2) + '" y="13" text-anchor="middle">' + n + '</text>'; });
    g.P.forEach(function(x, i){
      var y = 22 + i*rh;
      s += '<text class="gp-name" x="' + (lw - 8) + '" y="' + (y + 14) + '" text-anchor="end">' + esc(x.p.name.length > 16 ? x.p.name.slice(0, 15) + '…' : x.p.name) + '</text>';
      s += '<rect class="gp-rest" x="' + lw + '" y="' + (y + 4) + '" width="' + (365*cw) + '" height="' + (rh - 8) + '" rx="3"/>';
      var d = 0;
      while(d < 365){
        var st = x.day[d], e = d; while(e < 365 && x.day[e] === st) e++;
        if(st !== 'rest') s += '<rect class="gp-' + st + '" x="' + (lw + d*cw) + '" y="' + (y + 3) + '" width="' + Math.max(1.5, (e - d)*cw) + '" height="' + (rh - 6) + '" rx="2"/>';
        d = e;
      }
      var txt = (x.grazed + x.fed) + ' d' + (x.rest != null ? ' · rest ' + fmt(x.rest) + ' d' : ' · not used');
      s += '<text class="gp-stat" x="' + (lw + 365*cw + 8) + '" y="' + (y + 14) + '">' + txt + '</text>';
    });
    s += '</svg>';
    var unused = g.P.filter(function(x){ return x.grazed + x.fed === 0; }).map(function(x){ return x.p.name; });
    return '<h3 class="gp-title">Grazing calendar</h3>' +
      '<div class="fc-legend"><span><i class="sw gp-graze"></i>Grazing</span><span><i class="sw gp-feed"></i>Herd here, feeding hay</span><span><i class="sw gp-rest"></i>Resting</span>' +
      '<label class="gp-max">Move at least every <input type="number" id="gp_max" min="3" max="120" step="1" value="' + g.maxStay + '"> days</label></div>' +
      '<div class="table-scroll">' + s + '</div>' +
      '<p class="narrative" style="margin:10px 0 0;font-size:13px;">One herd moving through your pastures in order, leaving each when its grass runs out or after ' + g.maxStay + ' days. ' +
      (g.hayDays > 0 ? 'On about <strong>' + fmt(g.hayDays) + ' days</strong> no pasture has enough, so the herd stays put and is fed hay (orange). ' : 'Pasture carries the herd every day of the year. ') +
      (unused.length ? 'Never needed: ' + esc(unused.join(', ')) + '. ' : '') + 'Aim for 30–90 days of rest in the growing season.</p>';
  }

  /* ---- charts */
  function niceMax(v){
    if(!(v > 0)) return 10;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v/p;
    var s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return s*p;
  }
  function monthList(arr){
    if(!arr.length) return '';
    var runs = [], start = arr[0], prev = arr[0];
    for(var i = 1; i <= arr.length; i++){
      var cur = arr[i];
      if(cur === prev + 1){ prev = cur; continue; }
      runs.push(start === prev ? FEED.MONTHS[start] : FEED.MONTHS[start] + '–' + FEED.MONTHS[prev]);
      start = prev = cur;
    }
    return runs.join(', ');
  }
  var SERIES = [
    {key:'cow', label:'Cows', color:'var(--s1)', t:'cowTdn', c:'cowCp'},
    {key:'bull', label:'Bulls', color:'var(--s2)', t:'bullTdn', c:'bullCp'},
    {key:'calf', label:'Nursing calves (beyond milk)', color:'var(--s3)', t:'calfTdn', c:'calfCp'},
    {key:'wc', label:'Weaned calves', color:'var(--s4)', t:'wcTdn', c:'wcCp'},
    {key:'h', label:'Replacement heifers', color:'var(--s5)', t:'hTdn', c:'hCp'}
  ];
  function renderFeedChart(res, nut, el, interactive){
    var W = Math.round(Math.max(320, Math.min(720, el.clientWidth || 720))), H = W < 500 ? 250 : 290, ml = W < 500 ? 40 : 52, mr = 6, mt = 12, mb = 34, pw = W - ml - mr, ph = H - mt - mb;
    var ser = SERIES.filter(function(se){ return res.months.some(function(x){ return x.herdReq[se.t] > 0.01; }); });
    var rows = res.months.map(function(x){
      var v = {}; var tot = 0;
      ser.forEach(function(se){ v[se.key] = x.herdReq[nut === 'tdn' ? se.t : se.c]; tot += v[se.key]; });
      return {x:x, v:v, total:tot, supply:x.pasture[nut]};
    });
    var max = niceMax(Math.max.apply(null, rows.map(function(r){ return Math.max(r.total, res.hasSupply ? r.supply : 0); })));
    var band = pw/12, bw = Math.min(40, band*0.62);
    function y(v){ return mt + ph - v/max*ph; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g class="grid">';
    for(var i = 0; i <= 4; i++){ var gy = y(max*i/4); s += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + gy + '" y2="' + gy + '"/>'; }
    s += '</g><g class="axis">';
    for(i = 0; i <= 4; i++){ s += '<text x="' + (ml - 8) + '" y="' + (y(max*i/4) + 4) + '" text-anchor="end">' + fmt(max*i/4) + '</text>'; }
    s += '</g>';
    rows.forEach(function(r, m){
      var cx = ml + band*m + band/2, x0 = cx - bw/2, base = mt + ph, acc = 0;
      var vis = ser.filter(function(se){ return r.v[se.key] > 0; });
      vis.forEach(function(se, j){
        var y1 = y(acc + r.v[se.key]), y0 = y(acc); acc += r.v[se.key];
        var h = Math.max(0, y0 - y1);
        if(j === vis.length - 1 && h > 4){
          var rr = 4;
          s += '<path class="seg" fill="' + se.color + '" d="M' + x0 + ',' + y0 + 'V' + (y1 + rr) + 'Q' + x0 + ',' + y1 + ' ' + (x0 + rr) + ',' + y1 + 'H' + (x0 + bw - rr) + 'Q' + (x0 + bw) + ',' + y1 + ' ' + (x0 + bw) + ',' + (y1 + rr) + 'V' + y0 + 'Z"/>';
        } else s += '<rect class="seg" fill="' + se.color + '" x="' + x0 + '" y="' + y1 + '" width="' + bw + '" height="' + h + '"/>';
      });
      s += '<g class="axis"><text x="' + cx + '" y="' + (base + 16) + '" text-anchor="middle">' + FEED.MONTHS[m] + '</text></g>';
      if(res.hasSupply && r.supply < r.total*0.98) s += '<circle class="short-mark" cx="' + cx + '" cy="' + (base + 26) + '" r="3"/>';
    });
    if(res.hasSupply){
      var pts = rows.map(function(r, m){ return [ml + band*m + band/2, y(r.supply)]; });
      s += '<polyline class="supply-line" points="' + pts.map(function(p){ return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
      pts.forEach(function(p){ s += '<circle class="supply-dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4"/>'; });
    }
    if(interactive) rows.forEach(function(r, m){ s += '<rect class="hit" data-m="' + m + '" tabindex="0" x="' + (ml + band*m) + '" y="' + mt + '" width="' + band + '" height="' + (ph + mb) + '"/>'; });
    s += '</svg>';
    el.innerHTML = s;
    var unit = nut === 'tdn' ? 'lb TDN' : 'lb crude protein';
    if(!interactive) return;
    el.setAttribute('aria-label', 'Whole-herd ' + unit + ' per day by month: needs of cows, bulls and calves compared with what pasture supplies. The table below has the same numbers.');
    $('fc_legend').innerHTML = ser.map(function(se){ return '<span><i class="sw" style="background:' + se.color + '"></i>' + se.label + '</span>'; }).join('') +
      (res.hasSupply ? '<span><i class="ln"></i>From pasture</span>' : '') + '<span style="color:var(--ink-muted);">' + unit + ' per day, whole herd</span>';
    var tip = feedTip();
    el.querySelectorAll('.hit').forEach(function(h){
      function show(){
        var r = rows[+h.getAttribute('data-m')], x = r.x, b = h.getBoundingClientRect(), d = nut === 'tdn' ? 0 : 1;
        tip.innerHTML = '<div class="tt-val">' + x.name + '</div>' +
          '<div>Needs: <strong>' + fmt(r.total, d) + '</strong> ' + unit + '/day</div>' +
          '<div class="tt-lbl">' + ser.map(function(se){ return se.label.split(' (')[0] + ' ' + fmt(r.v[se.key], d); }).join(' · ') + '</div>' +
          (res.hasSupply ? '<div>Pasture gives: <strong>' + fmt(r.supply, d) + '</strong></div>' +
            '<div class="tt-lbl">' + (x.cow.hay > 0.05 || x.cow.sup > 0.05 ? 'Buy per cow/day: ' + [x.cow.hay > 0.05 ? fmt(x.cow.hay, 1) + ' lb hay' : '', x.cow.sup > 0.05 ? fmt(x.cow.sup, 1) + ' lb supplement' : ''].filter(Boolean).join(', ') : 'Pasture covers the cows') + '</div>' : '');
        tip.style.left = (b.left + b.width/2) + 'px'; tip.style.top = (b.top + 10) + 'px';
        tip.classList.add('show');
      }
      h.addEventListener('mouseenter', show); h.addEventListener('focus', show);
      h.addEventListener('mouseleave', function(){ tip.classList.remove('show'); }); h.addEventListener('blur', function(){ tip.classList.remove('show'); });
    });
  }
  function feedTip(){
    var t = $('fcTooltip');
    if(!t){ t = document.createElement('div'); t.id = 'fcTooltip'; t.className = 'viz-tooltip'; t.style.maxWidth = '270px'; document.body.appendChild(t); }
    return t;
  }

  /* cow body condition through the year (protein-only supplementation lets cows use body reserves for energy) */
  function bcsTile(b){
    if(!b) return '';
    var f1 = function(v){ return fmt(v, 1); };
    if(b.mode === 'full') return '<div class="stat-tile"><span class="label">Cow condition</span><span class="value small">Held at ' + f1(b.start) + '</span><span class="sub">supplement covers energy too, so cows don’t lose condition</span></div>';
    var drop = b.start - b.low, back = b.end - b.start;
    var cls = b.low < 4 || back < -0.5 ? 'critical' : (b.low < 4.5 || back < -0.2 ? 'caution' : 'good');
    return '<div class="stat-tile ' + cls + '"><span class="label">Cow condition (BCS)</span><span class="value small">' + f1(b.start) + ' → ' + f1(b.low) + ' → ' + f1(b.end) + '</span>' +
      '<span class="sub">' + (drop < 0.05 ? 'no condition lost' : 'lowest in ' + FEED.MONTHS[b.lowMonth]) + ' · ' + (back < -0.2 ? 'not back at calving' : 'back at calving') + '</span></div>';
  }
  function calfTile(res){
    var cf = res.calf; if(!cf || cf.lbLostPerCalf < 1) return '';
    if(cf.strategy === 'creep') return '<div class="stat-tile"><span class="label">Creep feed for calves</span><span class="value small">' + fmt(cf.creepLb/2000, 1) + ' tons</span><span class="sub">' + fmt(cf.creepLbPerCalf) + ' lb per calf · ' + money(cf.creepCost) + ' · without it ' + fmt(cf.lbLostPerCalf) + ' lb lighter</span></div>';
    return '<div class="stat-tile caution"><span class="label">Calves wean lighter</span><span class="value small">' + fmt(res.econ.avgWeanLb) + ' lb</span><span class="sub">' + fmt(cf.lbLostPerCalf) + ' lb under the planned weight · grass and milk fall short</span></div>';
  }
  function bcsNote(b){
    if(!b || b.mode === 'full') return '';
    var back = b.end - b.start;
    if(b.low < 4 || back < -0.5) return ' <strong>Cows lose too much condition</strong> (down to ' + fmt(b.low, 1) + ' in ' + FEED.MONTHS[b.lowMonth] + (back < -0.2 ? ', ' + fmt(b.end, 1) + ' at calving' : '') + '): thin cows at calving and breeding rebreed later and less. Feed more energy, wean earlier or carry fewer cows.';
    if(b.low < 4.5 || back < -0.2) return ' Cows drop to condition ' + fmt(b.low, 1) + ' in ' + FEED.MONTHS[b.lowMonth] + (back < -0.2 ? ' and calve at ' + fmt(b.end, 1) : '') + ' — watch them; below 5 at calving, rebreeding suffers.';
    if(b.start - b.low < 0.1) return ' With protein alone the cows hold their condition all year.';
    return ' Cows use body reserves for the energy grass lacks (lowest ' + fmt(b.low, 1) + ' in ' + FEED.MONTHS[b.lowMonth] + ') and regain it on green grass.';
  }

  /* one sentence that says what the year looks like */
  function planHeadline(res, hayM, supM){
    var h = state.herd, t = res.totals, ec = res.econ, b = res.bcs, cf = res.calf, parts = [];
    var grass = t.hay < 100 ? 'Your grass carries the herd all year, with no hay.' : 'Your grass runs short: buy about <strong>' + fmt(t.hay/2000, 1) + ' t of hay</strong> (' + monthList(hayM) + ').';
    if(t.sup >= 100) parts.push('<strong>' + fmt(t.sup/2000, 1) + ' t of ' + (b && b.mode === 'full' ? 'supplement' : 'protein supplement') + '</strong> (' + monthList(supM) + ', about ' + money(t.sup/2000*h.supPrice) + ')');
    if(cf && cf.strategy === 'creep' && (ec.creepLb || 0) >= 100) parts.push('<strong>' + fmt(ec.creepLb/2000, 1) + ' t of creep</strong> to wean at ' + fmt(h.weanLb) + ' lb');
    var txt = grass + (parts.length ? ' You need ' + parts.join(' and ') + '.' : t.hay < 100 ? ' Nothing else to buy.' : '');
    if(cf && cf.strategy !== 'creep' && cf.lbLostPerCalf >= 1) txt += ' Calves wean at about <strong>' + fmt(ec.avgWeanLb) + ' lb</strong> on milk and grass.';
    if(b){
      if(b.mode === 'full' || b.start - b.low < 0.1) txt += ' Cows hold <strong>condition ' + fmt(b.start, b.start % 1 ? 1 : 0) + '</strong> all year.';
      else txt += ' Cows drop to <strong>condition ' + fmt(b.low, 1) + '</strong> in ' + FEED.MONTHS[b.lowMonth] + (b.end < b.start - 0.2 ? ' and aren’t back by calving.' : ' and regain it on green grass.');
    }
    return txt;
  }

  /* ---- main render */
  function renderFeed(){
    renderRegionSelect();
    syncFields();
    var h = state.herd, main = $('fc_main'), empty = $('fc_empty');
    if(!(h.cows > 0)){
      main.hidden = true; empty.hidden = false;
      empty.innerHTML = 'Enter your <strong>number of cows</strong> in <button type="button" class="link-btn" data-go="herd">step 2 · Herd</button> to build your year plan.';
      feedLast = null; $('fc_weanNote').textContent = ''; updateStrip(); renderDecisions(); return;
    }
    main.hidden = false;
    var res = runFeed(), co = res.calves, ec = res.econ;
    if(!res.hasSupply){
      empty.hidden = false;
      empty.innerHTML = 'No pasture forage estimate yet, so the chart shows only what the herd <strong>needs</strong>. Draw pastures (or enter your own forage estimate or carrying capacity) to compare it with what they supply and price the hay and supplement.';
    } else empty.hidden = true;

    var ages = co.cohorts.map(function(c){ return c.weanAge; }), minA = Math.min.apply(null, ages), maxA = Math.max.apply(null, ages);
    $('fc_weanNote').textContent = h.calving === 'us' ? '' : 'Calves will be ' + (minA === maxA ? minA : minA + '–' + maxA) + ' days old at weaning (average ' + fmt(co.avgAge) + ').';
    $('fc_weanLbHint').textContent = 'Growth ' + fmt(co.preAdg, 2) + ' lb/day from birth; sale weight after the weaning period ≈ ' + fmt(ec.avgSaleLb) + ' lb';
    $('fc_replNote').innerHTML = ec.heifersKept > 0.05
      ? 'Each year: keep <strong>' + fmt(ec.heifersKept) + ' heifer calves</strong>, sell ' + fmt(ec.opensSold, 1) + ' open at pregnancy check and ' + fmt(ec.cullsSold) + ' cull cows (' + money(ec.cullIncome + ec.openIncome) + '). About ' + fmt(res.months.reduce(function(a, x){ return a + x.heiferHeads; }, 0)/12) + ' heifers are on the ranch on an average day.'
      : 'Replacements aren’t raised here: no heifers kept and no culls sold.';
    var bw = +h.bcsWean;
    $('fc_bcsHint').textContent = bw > 0 && bw < +h.bcs ? 'Putting back ' + (+h.bcs - bw) + ' score' + (+h.bcs - bw > 1 ? 's' : '') + ' costs ' + fmt(res.months.reduce(function(a, x){ return a + x.req.bcsTdn*x.days; }, 0)) + ' lb TDN per cow' : 'Cows lose condition while nursing';
    $('fc_lossNote').innerHTML = 'At these settings: <strong>' + fmt(ec.calvesSold) + ' calves sold</strong>' + (ec.heifersKept > 0.05 ? ' (after keeping ' + fmt(ec.heifersKept) + ' heifers)' : '') + ' from ' + fmt(h.cows) + ' cows — ' +
      fmt(ec.deadWeather, 1) + ' lost to weather, ' + fmt(ec.deadOther, 1) + ' to other causes' + (h.nws === 'yes' ? ', ' + fmt(ec.deadNws, 1) + ' to screwworm' : '') + '. Cold nights in ' + FEED.REGIONS[regionKey()].station + ' raise weather losses for calves born Nov–Mar.';
    $('fc_flyNote').innerHTML = h.nws === 'yes'
      ? 'Screwworm flies are most active when it’s warm (little activity below 59°F). No published loss rate exists yet — untreated newborn navel infestations are usually fatal, so set what you expect with daily checks. Calving in the cool months lowers the risk.'
      : 'Screwworm was confirmed in 17 South and West Texas counties in 2026 (TAHC). Choose “In or near my area” to add its risk to the calving-season comparison.';
    var protDriven = res.months.filter(function(x){ return x.cow.sup > 0.05; }).every(function(x){ return x.cow.protDriven; });
    $('fc_tripNote').textContent = (+h.supTrips < 7 && res.totals.sup > 100 && !protDriven)
      ? 'Heads up: some months need supplement for energy, not just protein. Energy supplements (grain, high-starch feeds) should be fed daily; protein cubes can go 2–3 times a week.'
      : 'Protein cubes can usually be fed 2–3 times a week with the same total amount; each trip costs you fuel and time.';

    renderFeedChart(res, feedNutrient, $('fc_chart'), true);
    renderFeedChart(res, 'tdn', $('fc_chart_p_tdn'), false);
    renderFeedChart(res, 'cp', $('fc_chart_p_cp'), false);

    var ms = res.months, eShort = [], pShort = [], cShort = [], hayM = [], supM = [];
    ms.forEach(function(x, m){
      if(x.pasture.tdn < x.herdReq.tdn*0.98) eShort.push(m);
      if(x.pasture.cp < x.herdReq.cp*0.98) pShort.push(m);
      if(x.calfShortTdn*h.cows > 0.5 && x.req.calf.nursing > 0.05) cShort.push(m);
      if(x.hayLb > 1) hayM.push(m);
      if(x.supLb > 1) supM.push(m);
    });
    var shortTxt = '';
    if(res.hasSupply){
      shortTxt = (eShort.length || pShort.length)
        ? 'Pasture alone falls short on <strong>energy</strong> in ' + (eShort.length ? monthList(eShort) : 'no month') + ' and on <strong>protein</strong> in ' + (pShort.length ? monthList(pShort) : 'no month') + ' (red dots under the chart).'
        : 'Pasture covers the herd’s energy and protein all year at these numbers.';
      if(cShort.length){
        var cf = res.calf;
        shortTxt += ' Nursing calves can’t get all they need for a ' + fmt(h.weanLb) + ' lb weaning weight from milk plus pasture in ' + monthList(cShort) + ' — ' +
          (cf.strategy === 'creep' ? 'creep feed to close it: about <strong>' + fmt(cf.creepLbPerCalf) + ' lb per calf</strong> (' + money(cf.creepCost) + ' a year, in the costs).'
                                   : 'without creep they wean about <strong>' + fmt(cf.lbLostPerCalf) + ' lb lighter</strong> (' + fmt(res.econ.avgWeanLb) + ' lb), and sales count that.');
      }
    } else shortTxt = 'Hover a month to see how the need splits between cows, bulls and calves.';
    $('fc_short').innerHTML = shortTxt + (res.hasSupply ? bcsNote(res.bcs) : '');

    var t = res.totals;
    var feedLbs = t.hay + t.sup + (ec.creepLb || 0);
    $('fc_tiles').innerHTML = res.hasSupply ?
      '<div class="stat-tile"><span class="label">Calves sold</span><span class="value small">' + fmt(ec.calvesSold) + '</span><span class="sub">' + fmt(ec.avgSaleLb) + ' lb at $' + fmt(ec.avgPrice) + '/cwt</span></div>' +
      '<div class="stat-tile"><span class="label">Cattle sales</span><span class="value small">' + money(ec.income) + '</span><span class="sub">' + (ec.cullIncome + ec.openIncome > 0.5 ? 'calves ' + money(ec.calfIncome) + ' · culls ' + money(ec.cullIncome + ec.openIncome) : money(ec.income/h.cows) + ' per cow') + '</span></div>' +
      '<div class="stat-tile"><span class="label">Feed &amp; feeding</span><span class="value small">' + money(ec.costs) + '</span><span class="sub">' + (feedLbs >= 100 ? [t.hay >= 100 ? fmt(t.hay/2000, 1) + ' t hay' : '', t.sup >= 100 ? fmt(t.sup/2000, 1) + ' t supplement' : '', (ec.creepLb || 0) >= 100 ? fmt(ec.creepLb/2000, 1) + ' t creep' : '', (ec.mineralLb || 0) >= 100 ? fmt(ec.mineralLb/2000, 1) + ' t mineral' : ''].filter(Boolean).join(' · ') + ' + trips' : (ec.mineral > 0.5 ? 'mineral only' : 'nothing to buy')) + '</span></div>' +
      '<div class="stat-tile ' + (ec.net >= 0 ? 'good' : 'critical') + '"><span class="label">Sales minus feed</span><span class="value small">' + money(ec.net) + '</span><span class="sub">' + money(ec.net/h.cows) + ' per cow · not profit</span></div>'
      : '';
    $('fc_tiles2').innerHTML = res.hasSupply ?
      '<div class="stat-tile"><span class="label">Hay to buy</span><span class="value small">' + (t.hay >= 100 ? fmt(t.hay/2000, 1) + ' tons' : 'None') + '</span><span class="sub">' + (t.hay >= 100 ? money(t.hay/2000*h.hayPrice) + ' · ' + monthList(hayM) : 'standing forage lasts all year') + '</span></div>' +
      '<div class="stat-tile"><span class="label">Protein supplement</span><span class="value small">' + (t.sup >= 100 ? fmt(t.sup/2000, 1) + ' tons' : 'None') + '</span><span class="sub">' + (t.sup >= 100 ? money(t.sup/2000*h.supPrice) + ' · ' + monthList(supM) : 'not needed') + '</span></div>' +
      bcsTile(res.bcs) + calfTile(res) +
      '<div class="stat-tile"><span class="label">Feeding trips &amp; delivery</span><span class="value small">' + money(t.tripCost + t.dist) + '</span><span class="sub">' + fmt(t.trips) + ' trips' + (ec.nwsCare > 0 ? ' · screwworm care ' + money(ec.nwsCare) : '') + (ec.bcsRestore > 0.5 ? ' · condition feed ' + money(ec.bcsRestore) : '') + '</span></div>'
      : '';
    $('fc_headline').innerHTML = res.hasSupply ? planHeadline(res, hayM, supM) : '';
    $('fc_tiles').hidden = !res.hasSupply;

    var d1 = function(v){ return v > 0.05 ? fmt(v, 1) : '—'; };
    $('fc_table').innerHTML = res.hasSupply ?
      '<thead><tr><th>Month</th><th class="num">Grazed</th><th class="num">TDN need / pasture</th><th class="num">CP need / pasture</th><th class="num">Hay</th><th class="num">Suppl.</th>' + (res.bcs && res.bcs.mode === 'protein' ? '<th class="num">Cow BCS</th>' : '') + '<th class="num">Cost</th></tr></thead><tbody>' +
      ms.map(function(x){
        var bad = x.hayLb > 1 || x.supLb > 1;
        return '<tr class="' + (bad ? 'short' : '') + '"><td><span class="' + (bad ? 'flag' : 'ok') + '"></span>' + x.name + '</td>' +
          '<td class="num">' + fmt(x.pastureShare*100) + '%</td>' +
          '<td class="num">' + fmt(x.herdReq.tdn) + ' / ' + fmt(x.pasture.tdn) + '</td>' +
          '<td class="num">' + fmt(x.herdReq.cp) + ' / ' + fmt(x.pasture.cp) + '</td>' +
          '<td class="num">' + d1(x.cow.hay) + '</td><td class="num">' + d1(x.cow.sup) + '</td>' +
          (res.bcs && res.bcs.mode === 'protein' ? '<td class="num">' + (x.cowBcs != null ? fmt(x.cowBcs, 1) : '—') + '</td>' : '') +
          '<td class="num">' + (x.cost > 0.5 ? money(x.cost) : '—') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Year</td><td></td><td></td><td></td><td class="num">' + fmt(t.hay/2000, 1) + ' t</td><td class="num">' + fmt(t.sup/2000, 1) + ' t</td>' + (res.bcs && res.bcs.mode === 'protein' ? '<td></td>' : '') + '<td class="num">' + money(t.cost) + '</td></tr></tfoot>'
      : '';
    $('fc_tableWrap').hidden = !res.hasSupply;

    $('fc_perhead').innerHTML = '<thead><tr><th>Month</th><th class="num">Cow TDN</th><th class="num">Cow CP</th><th class="num">Weather</th><th class="num">Bull TDN</th><th class="num">Bull CP</th><th class="num">Calf TDN</th><th class="num">Calf CP</th><th class="num">Weaned TDN</th><th class="num">Weaned CP</th><th class="num">Heifer TDN</th><th class="num">Heifer CP</th><th class="num">Diet TDN / CP</th></tr></thead><tbody>' +
      ms.map(function(x){
        var wn = x.req.weaned.n > 0.001;
        return '<tr><td>' + x.name + '</td><td class="num">' + fmt(x.req.cow.tdn, 1) + '</td><td class="num">' + fmt(x.req.cow.cp, 2) + '</td>' +
          '<td class="num">' + wxCell(x) + '</td>' +
          '<td class="num">' + fmt(x.req.bull.tdn, 1) + '</td><td class="num">' + fmt(x.req.bull.cp, 2) + '</td>' +
          '<td class="num">' + fmt(x.req.calf.tdn, 1) + '</td><td class="num">' + fmt(x.req.calf.cp, 2) + '</td>' +
          '<td class="num">' + (wn ? fmt(x.req.weaned.tdn, 1) : '—') + '</td><td class="num">' + (wn ? fmt(x.req.weaned.cp, 2) : '—') + '</td>' +
          '<td class="num">' + (x.req.heifer.n > 0.001 ? fmt(x.req.heifer.tdn, 1) : '—') + '</td><td class="num">' + (x.req.heifer.n > 0.001 ? fmt(x.req.heifer.cp, 2) : '—') + '</td>' +
          '<td class="num">' + fmt(x.dietTdn) + '% / ' + fmt(x.dietCp, 1) + '%</td></tr>';
      }).join('') + '</tbody>';
    $('fc_wxNote').textContent = wxNote(ms);
    updateStrip();
    scheduleDecisions();
  }

  /* ------------------------------------------------------------------ decisions */
  function scheduleDecisions(){ clearTimeout(decTimer); decTimer = setTimeout(renderDecisions, 250); }
  function netOf(oOver, fOver, supMult, supTransform){
    var sup = supplyNow(supMult);
    if(supTransform) sup = supTransform(sup);
    return FEED.balance(feedOptions(oOver), sup, feedsFor(fOver));
  }
  function renderDecisions(){
    var h = state.herd, empty = $('dec_empty');
    var ready = h.cows > 0 && feedLast && feedLast.hasSupply;
    document.querySelectorAll('.dec-panel').forEach(function(p){ p.hidden = !ready || p.id !== 'dec_' + decTab; });
    if(!ready){ empty.hidden = false; empty.innerHTML = 'Enter your cows and draw pastures with a forage estimate (or enter your own carrying capacity) to compare decisions.'; return; }
    empty.hidden = true;
    var key = decTab + '|' + feedKey + '|' + JSON.stringify(h.dr) + '|' + JSON.stringify(h.sell || {}) + '|' + (h.decPrice || '');
    if(key === decKey) return;
    decKey = key;
    if(decTab === 'calving') renderCalvingDecision();
    else if(decTab === 'drought') renderDroughtDecision();
    else renderWhatIf();
  }

  /* dot chart: one value per calving month; best in accent, current ringed */
  function decDotChart(el, vals, o){
    var W = Math.round(Math.max(320, Math.min(720, el.clientWidth || 720))), H = 210, ml = W < 500 ? 50 : 64, mr = 6, mt = 18, mb = 30, pw = W - ml - mr, ph = H - mt - mb;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max(o.minPad || 1, (hi - lo)*0.2), y0v = lo - pad, y1v = hi + pad;
    function y(v){ return mt + ph - (v - y0v)/(y1v - y0v)*ph; }
    var band = pw/12;
    var sv = '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><g class="grid">';
    for(var i = 0; i <= 3; i++){ var gv = y0v + (y1v - y0v)*i/3; sv += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(gv) + '" y2="' + y(gv) + '"/>'; }
    sv += '</g><g class="axis">';
    for(i = 0; i <= 3; i++){ gv = y0v + (y1v - y0v)*i/3; sv += '<text x="' + (ml - 8) + '" y="' + (y(gv) + 4) + '" text-anchor="end">' + o.fmt(gv) + '</text>'; }
    sv += '</g><polyline class="dec-line" points="' + vals.map(function(v, m){ return (ml + band*m + band/2).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ') + '"/>';
    vals.forEach(function(v, m){
      var cx = ml + band*m + band/2, cy = y(v), isBest = m === o.best, isCur = m === o.cur;
      sv += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (isBest ? 7 : 5) + '" class="dec-dot' + (isBest ? ' best' : '') + (isCur ? ' cur' : '') + '"/>';
      if(isBest) sv += '<text x="' + cx + '" y="' + (cy - 12) + '" text-anchor="middle" class="dec-lbl">Best</text>';
      sv += '<g class="axis"><text x="' + cx + '" y="' + (mt + ph + 16) + '" text-anchor="middle">' + FEED.MONTHS[m] + '</text></g>';
      sv += '<rect class="hit" data-m="' + m + '" tabindex="0" x="' + (ml + band*m) + '" y="' + mt + '" width="' + band + '" height="' + (ph + mb) + '"/>';
    });
    sv += '</svg>';
    el.innerHTML = '<div class="fc-legend" style="margin-bottom:6px;"><span style="color:var(--ink-muted);">' + o.legend + '</span>' + (o.cur >= 0 ? '<span><i class="sw" style="background:var(--dec-muted);border-radius:50%;box-shadow:0 0 0 2px var(--ink);"></i>Your season</span>' : '') + '<span><i class="sw" style="background:var(--accent);border-radius:50%;"></i>Best</span></div>' + sv;
    var tip = feedTip();
    el.querySelectorAll('.hit').forEach(function(hh){
      function show(){ var b = hh.getBoundingClientRect(); tip.innerHTML = o.tip(+hh.getAttribute('data-m')); tip.style.left = (b.left + b.width/2) + 'px'; tip.style.top = (b.top + 10) + 'px'; tip.classList.add('show'); }
      hh.addEventListener('mouseenter', show); hh.addEventListener('focus', show);
      hh.addEventListener('mouseleave', function(){ tip.classList.remove('show'); }); hh.addEventListener('blur', function(){ tip.classList.remove('show'); });
    });
  }

  function renderCalvingDecision(){
    var h = state.herd, len = h.calving === 'us' ? 60 : h.len1, cows = h.cows;
    $('dec_calvLen').textContent = len;
    var seasonal = h.decPrice !== 'flat';
    var ps = $('dec_calvPrice'); if(ps) ps.value = seasonal ? 'season' : 'flat';
    var base = feedOptions(), age = Math.round(base.refWeanAge);
    var curM = h.calving === 'us' ? -1 : FEED.monthOfDay(FEED.doy(h.start1));
    var rows = [];
    for(var s = 0; s < 12; s++){
      var ov = {calving:'one', start1:FEED.MONTH_START[s] + 14, len1:len, weanMode:'age', weanAge:age, refWeanAge:age, seasonal:seasonal};
      var r = netOf(ov);
      // thinner cows at breeding get pregnant less (Sprott 1985): scale your calving rate by the pregnancy rate at this
      // season's breeding condition vs. your own season's, and run it again
      var pf = FEED.pregByBcs(r.bcs.breed)/FEED.pregByBcs(feedLast.bcs.breed), calvRate = Math.min(100, h.calvingRate*pf);
      if(Math.abs(pf - 1) > 0.002) r = netOf(Object.assign({}, ov, {calvingRate:calvRate}));
      var e = r.econ, weaned = e.calvesSold + e.heifersKept;
      var cs = r.calves.cohorts, mid = cs[Math.floor(cs.length/2)] || cs[0];
      var feedLb = r.totals.hay + r.totals.sup + (e.creepLb || 0), shortM = r.months.filter(function(x){ return x.hayLb + x.supLb > 1; }).length;
      var post = [1, 2, 3, 4].map(function(k){ return r.months[(s + k) % 12]; });
      var cov = post.map(function(x){ var t = x.herdReq.tdn > 0 ? x.pasture.tdn/x.herdReq.tdn : 1, c = x.herdReq.cp > 0 ? x.pasture.cp/x.herdReq.cp : 1; return Math.min(1, t, c); });
      var postFeed = post.reduce(function(a, x){ return a + x.hayLb + x.supLb; }, 0);
      rows.push({m:s, res:r, e:e, weaned:weaned, bcsBreed:r.bcs.breed, calvRate:calvRate, natLb:e.weanLbNoCreep, creepCalf:e.creepLbPerCalf, postCov:cov.reduce(function(a, b){ return a + b; }, 0)/4, postFeed:postFeed/cows, postMonths:[1, 2, 3, 4].map(function(k){ return (s + k) % 12; }), weanLb:e.avgWeanLb, lbPerCow:weaned*e.weanLbNoCreep/cows, deadCold:e.deadWeather, deadNws:e.deadNws,
                 hayT:r.totals.hay/2000, supT:r.totals.sup/2000, feedPerCow:feedLb/cows, shortM:shortM, saleM:mid ? mid.saleMonth : 0});
    }
    function argBest(f, max){ return rows.reduce(function(a, r){ return (max ? f(r) > f(a) : f(r) < f(a)) ? r : a; }, rows[0]); }
    function moStr(m){ return FEED.MONTHS[m] + ' 15'; }

    /* 1. production */
    var bestFeed = argBest(function(r){ return r.feedPerCow; }, false), bestLb = argBest(function(r){ return r.lbPerCow; }, true);
    var worstFeed = argBest(function(r){ return r.feedPerCow; }, true);
    var bestCov = argBest(function(r){ return r.postCov + r.lbPerCow*1e-6 - r.postFeed*1e-9; }, true), worstCov = argBest(function(r){ return r.postCov; }, false);
    (function(){
      var el = $('dec_calvChart'), W = Math.round(Math.max(320, Math.min(720, el.clientWidth || 720))), H = 220, ml = W < 500 ? 40 : 48, mr = 6, mt = 18, mb = 30, pw = W - ml - mr, ph = H - mt - mb, band = pw/12, bw = Math.min(34, band*0.62);
      function Y(v){ return mt + ph - v*ph; }
      var sv = '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><g class="grid">';
      for(var i = 0; i <= 4; i++) sv += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(i/4) + '" y2="' + Y(i/4) + '"/>';
      sv += '</g><g class="axis">';
      for(i = 0; i <= 4; i++) sv += '<text x="' + (ml - 8) + '" y="' + (Y(i/4) + 4) + '" text-anchor="end">' + (i*25) + '%</text>';
      sv += '</g>';
      rows.forEach(function(r, m){
        var x = ml + band*m + band/2 - bw/2, y = Y(r.postCov), isB = r === bestCov, isC = m === curM;
        sv += '<rect class="pc-bar' + (isB ? ' best' : '') + (isC ? ' cur' : '') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (Y(0) - y).toFixed(1) + '" rx="3"/>';
        sv += '<text class="pc-val" x="' + (x + bw/2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle">' + fmt(r.postCov*100) + '</text>';
        sv += '<g class="axis"><text x="' + (x + bw/2).toFixed(1) + '" y="' + (mt + ph + 16) + '" text-anchor="middle">' + FEED.MONTHS[m] + '</text></g>';
        sv += '<rect class="hit" data-m="' + m + '" tabindex="0" x="' + (ml + band*m) + '" y="' + mt + '" width="' + band + '" height="' + (ph + mb) + '"/>';
      });
      sv += '</svg>';
      el.innerHTML = '<div class="fc-legend" style="margin-bottom:6px;"><span style="color:var(--ink-muted);">% of the herd’s energy and protein that grass covers in the 4 months after calving starts · calving from the 15th</span>' + (curM >= 0 ? '<span><i class="sw" style="background:var(--dec-muted);box-shadow:0 0 0 2px var(--ink);"></i>Your season</span>' : '') + '<span><i class="sw" style="background:var(--accent);"></i>Best</span></div>' + sv;
      var tip = feedTip();
      el.querySelectorAll('.hit').forEach(function(hh){
        function show(){ var r = rows[+hh.getAttribute('data-m')], b = hh.getBoundingClientRect();
          tip.innerHTML = '<div class="tt-val">Calving from ' + moStr(r.m) + '</div><div>Grass covers ' + fmt(r.postCov*100) + '% in ' + FEED.MONTHS[r.postMonths[0]] + '–' + FEED.MONTHS[r.postMonths[3]] + '</div><div class="tt-lbl">' + fmt(r.postFeed) + ' lb hay + supplement per cow those months · ' + fmt(r.feedPerCow) + ' lb all year</div>';
          tip.style.left = (b.left + b.width/2) + 'px'; tip.style.top = (b.top + 10) + 'px'; tip.classList.add('show'); }
        hh.addEventListener('mouseenter', show); hh.addEventListener('focus', show);
        hh.addEventListener('mouseleave', function(){ tip.classList.remove('show'); }); hh.addEventListener('blur', function(){ tip.classList.remove('show'); });
      });
    })();
    var cur = curM >= 0 ? rows[curM] : null;
    var goodM = rows.filter(function(r){ return r.postCov >= bestCov.postCov - 0.05; }).map(function(r){ return r.m; });
    var heavy = argBest(function(r){ return r.natLb; }, true), light = argBest(function(r){ return r.natLb; }, false);
    $('dec_calvText').innerHTML = 'Best time to calve on your pastures: from <strong>' + moStr(bestCov.m) + '</strong>. In the 4 months after calving starts (' + FEED.MONTHS[bestCov.postMonths[0]] + '–' + FEED.MONTHS[bestCov.postMonths[3]] + '), when cows are nursing and need the most, grass covers <strong>' + fmt(bestCov.postCov*100) + '%</strong> of the herd’s energy and protein' +
      (bestCov.postFeed > 1 ? ' and you’d buy ' + fmt(bestCov.postFeed) + ' lb of feed per cow' : ' with nothing bought') + '. ' +
      (goodM.length > 1 ? 'Calving from ' + monthList(goodM.slice().sort(function(a, b){ return a - b; })) + ' does almost as well (within 5 points). ' : '') +
      'The weakest is ' + moStr(worstCov.m) + ': grass covers only ' + fmt(worstCov.postCov*100) + '% after calving. ' +
      (cur ? 'Your season (from ' + FEED.MONTHS[curM] + '): ' + fmt(cur.postCov*100) + '%. ' : '') +
      'On milk and grass alone, calves wean at about ' + fmt(bestCov.natLb) + ' lb calving from ' + FEED.MONTHS[bestCov.m] + (heavy.natLb - light.natLb > 5 ? ' (heaviest ' + fmt(heavy.natLb) + ' lb from ' + FEED.MONTHS[heavy.m] + ', lightest ' + fmt(light.natLb) + ' lb from ' + FEED.MONTHS[light.m] + ')' : '') + '. ' +
      (function(){ var thin = rows.filter(function(r){ return r.bcsBreed < 4.75; }); return thin.length ? 'Cows calving from ' + monthList(thin.map(function(r){ return r.m; })) + ' are under condition 4.75 at breeding, so fewer get pregnant (58% at BCS 4, 85% at 5, 95% at 6; Sprott 1985) and fewer calves are born. ' : ''; })() +
      'Over the whole year, the least bought feed (hay, supplement' + (state.herd.calfShort !== 'lighter' ? ' and creep to reach ' + fmt(state.herd.weanLb) + ' lb' : '') + ') is calving from ' + moStr(bestFeed.m) + ' (' + fmt(bestFeed.feedPerCow) + ' lb per cow).';
    $('dec_calvTable').innerHTML = '<thead><tr><th>Calving from</th><th class="num">Grass covers after calving</th><th class="num">Cow BCS at breeding · calves born</th><th class="num">Calves weaned</th><th class="num">Weaning weight on milk + grass</th><th class="num">Creep to reach ' + fmt(h.weanLb) + ' lb</th><th class="num">Lb weaned per cow (no creep)</th><th class="num">Deaths (cold · screwworm)</th><th class="num">Hay · supplement</th><th class="num">Feed bought per cow (year, incl. creep)</th></tr></thead><tbody>' +
      rows.map(function(r){ return '<tr' + (r === bestCov ? ' class="best"' : '') + '><td>' + (r === bestCov ? '★ ' : '') + moStr(r.m) + (r.m === curM ? ' (yours)' : '') + '</td>' +
        '<td class="num">' + fmt(r.postCov*100) + '%</td><td class="num">' + fmt(r.bcsBreed, 1) + ' · ' + fmt(r.calvRate) + '%</td><td class="num">' + fmt(r.weaned, 1) + '</td><td class="num">' + fmt(r.natLb) + ' lb</td><td class="num">' + (r.creepCalf >= 1 ? fmt(r.creepCalf) + ' lb/calf' : '—') + '</td><td class="num">' + fmt(r.lbPerCow) + '</td>' +
        '<td class="num">' + fmt(r.deadCold, 1) + ' · ' + fmt(r.deadNws, 1) + '</td><td class="num">' + fmt(r.hayT, 1) + ' t · ' + fmt(r.supT, 1) + ' t</td><td class="num">' + fmt(r.feedPerCow) + ' lb</td></tr>'; }).join('') + '</tbody>';

    /* 2. economics */
    var best = argBest(function(r){ return r.e.net; }, true), worst = argBest(function(r){ return r.e.net; }, false);
    decDotChart($('dec_calvEconChart'), rows.map(function(r){ return r.e.net/cows; }), {best:best.m, cur:curM, minPad:5,
      legend:'Cattle sales minus feed, per cow' + (seasonal ? ' · calves priced in the month they’re sold' : ' · same price all year'), fmt:money,
      tip:function(m){ var r = rows[m]; return '<div class="tt-val">Calving from ' + moStr(m) + '</div><div>' + money(r.e.net/cows) + ' per cow</div><div class="tt-lbl">Sold in ' + FEED.MONTHS[r.saleM] + ': ' + fmt(r.e.calvesSold) + ' calves × ' + fmt(r.e.avgSaleLb) + ' lb at $' + fmt(r.e.avgPrice) + '/cwt · feed ' + money(r.e.costs) + '</div>'; }});
    $('dec_calvEconText').innerHTML = 'Adding prices, calving from <strong>' + moStr(best.m) + '</strong> leaves the most: <strong>' + money(best.e.net) + '</strong> a year (' + money(best.e.net/cows) + ' per cow), ' +
      money(best.e.net - worst.e.net) + ' more than ' + FEED.MONTHS[worst.m] + '.' +
      (cur && cur !== best ? ' Your season leaves ' + money(cur.e.net) + ' — ' + money(best.e.net - cur.e.net) + ' less.' : cur ? ' That’s already your season.' : '') +
      (seasonal ? ' Calves and culls are priced in the month they’re sold, with the seasonal pattern of 2016–2025 Oklahoma City calf prices (USDA; Feb–Apr about 3–4% above the yearly average, October about 6% below), starting from today’s market prices.'
                : ' Every month uses today’s market prices; switch to seasonal prices to see the effect of the sale month.') +
      (state.herd.calfShort !== 'lighter' ? ' Feed costs include the creep feed each month needs to wean calves at ' + fmt(state.herd.weanLb) + ' lb.' : ' Calves are sold at the weight milk and grass give them in each month, so lighter calves bring more per hundredweight but less per head.') +
      ' Fewer calves when cows are thin at breeding, cold-weather calf deaths by birth month (USDA NAHMS rate) and feed to put back condition the cows don’t regain by calving are all counted. Labor at calving isn’t included.';
    $('dec_calvEconTable').innerHTML = '<thead><tr><th>Calving from</th><th class="num">Calves sold</th><th class="num">Sold in</th><th class="num">Price</th><th class="num">Cattle sales</th><th class="num">Feed &amp; feeding</th><th class="num">Income − feed</th></tr></thead><tbody>' +
      rows.map(function(r){ var e = r.e; return '<tr' + (r === best ? ' class="best"' : '') + '><td>' + (r === best ? '★ ' : '') + moStr(r.m) + (r.m === curM ? ' (yours)' : '') + '</td>' +
        '<td class="num">' + fmt(e.calvesSold, 1) + ' × ' + fmt(e.avgSaleLb) + ' lb</td><td class="num">' + FEED.MONTHS[r.saleM] + '</td><td class="num">$' + fmt(e.avgPrice) + '/cwt</td>' +
        '<td class="num">' + money(e.income) + '</td><td class="num">' + money(e.costs) + '</td><td class="num"><strong>' + money(e.net) + '</strong></td></tr>'; }).join('') + '</tbody>';
    /* keeping the calves after weaning: hand the numbers to the stocker budget (Retained Ownership page) */
    (function(){
      var F = feedLast, cs = F.calves.cohorts, mid = cs[Math.floor(cs.length/2)] || cs[0];
      var nowD = new Date(), y = nowD.getFullYear(), dd = mid ? ((Math.round(mid.day + mid.weanAge) % 365) + 365) % 365 : 0;
      var dt = new Date(y, 0, 1 + dd); if(dt < new Date(y, nowD.getMonth(), nowD.getDate())) dt = new Date(y + 1, 0, 1 + dd);
      var iso = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
      $('dec_keepLink').href = '../retained-ownership/index.html#stockers?heads=' + Math.round(F.econ.calvesSold) + '&weight=' + Math.round(F.econ.avgWeanLb) + '&price=' + Math.round(F.econ.avgPrice) + '&start=' + iso;
    })();
  }

  function bredCowPrice(){
    var v = 2829;
    try{ var mp = JSON.parse(localStorage.getItem('tamuDecisionAidsMarketPrices') || 'null'); if(mp && +mp.mp_bredCowPrice > 0) v = +mp.mp_bredCowPrice; }catch(e){}
    return v;
  }
  var DR_DEFAULTS = {cut:50, from:5, months:6, which:'all', earlyAge:150, feedAdg:2.0, sellPct:30, sellWhen:'start', hayPrice:null, recover:75, buyPrice:null, buyYear:1, otherCost:189, devCost:900, rate:7, later:0};
  function renderDroughtDecision(){
    var h = state.herd, dr = Object.assign({}, DR_DEFAULTS, h.dr || {});
    var cut = function(sup){ return FEED.adjustSupply(sup, dr.cut, +dr.from, dr.months, dr.which); };
    var base = feedOptions(), normalAge = Math.round(base.refWeanAge), cows = h.cows, bulls = base.bulls;
    var nowM = new Date().getMonth();
    var hayD = +dr.hayPrice > 0 ? {hayPrice:+dr.hayPrice} : {};   // hay usually costs more in a drought
    var A = netOf({}, hayD, 1, cut);
    var B = netOf({weanMode:'age', weanAge:dr.earlyAge, weanPeriod:0, refWeanAge:normalAge}, hayD, 1, cut);
    var C = netOf({weanMode:'age', weanAge:dr.earlyAge, weanPeriod:Math.max(0, normalAge - dr.earlyAge) + (h.weanPeriod || 0), postAdg:dr.feedAdg, refWeanAge:normalAge}, hayD, 1, cut);
    var N = feedLast;
    /* selling cows: as if sold when the drought starts (their calves go with them) or after weaning */
    var X = Math.max(0, Math.min(90, +dr.sellPct || 0))/100, nSell = Math.round(cows*X), keepCows = cows - nSell;
    var midA = A.calves.cohorts[Math.floor(A.calves.cohorts.length/2)] || A.calves.cohorts[0];
    var sellM = dr.sellWhen === 'weaning' ? (midA ? midA.saleMonth : 9) : +dr.from;
    var cullHd = h.cowLb/100*cullPrice()*FEED.SEASON_CULL[sellM]/FEED.SEASON_CULL[nowM];
    var saleVal = nSell*cullHd;
    var Dr = dr.sellWhen === 'weaning' ? A : netOf({cows:keepCows, bulls:Math.max(1, Math.round(bulls*(1 - X)))}, hayD, 1, cut);
    var D = {r:Dr, sale:saleVal};
    var opts = [
      {key:'A', title:'Keep calves on the cows, buy feed', r:A, sub:'Wean as planned; cows keep nursing through the dry spell.', extra:0},
      {key:'B', title:'Wean early at ' + dr.earlyAge + ' days and sell', r:B, sub:'Lighter calves, but dry cows need about a third less feed.', extra:0},
      {key:'C', title:'Wean early and feed the calves', r:C, sub:'Calves on feed gaining ' + dr.feedAdg + ' lb/day until your normal weaning age' + (h.weanPeriod ? ' plus the weaning period' : '') + ', then sold.', extra:0},
      {key:'D', title:'Sell ' + fmt(nSell) + ' cows (' + fmt(X*100) + '%) ' + (dr.sellWhen === 'weaning' ? 'after weaning' : 'when it starts'), r:Dr, sub:(dr.sellWhen === 'weaning' ? 'Feed the whole herd through the drought, then sell them in ' : 'Fewer cows to feed; they go with their calves in ') + FEED.MONTHS[sellM] + ' at about ' + money(cullHd) + ' a head.', extra:saleVal}
    ];
    opts.forEach(function(o){ o.net = o.r.econ.net + o.extra; });
    var best = opts.reduce(function(a, o){ return o.net > a.net ? o : a; }, opts[0]);
    var rowsDef = [
      ['Calves sold', function(o){ return fmt(o.r.econ.calvesSold) + ' × ' + fmt(o.r.econ.avgSaleLb) + ' lb'; }],
      ['Price', function(o){ return '$' + fmt(o.r.econ.avgPrice) + '/cwt'; }],
      ['Cattle sales', function(o){ return money(o.r.econ.income + o.extra) + (o.extra ? '<br><small>incl. ' + money(o.extra) + ' cows sold</small>' : ''); }],
      ['Hay bought', function(o){ return fmt(o.r.totals.hay/2000, 1) + ' t'; }],
      ['Supplement bought', function(o){ return fmt(o.r.totals.sup/2000, 1) + ' t'; }],
      ['Feed &amp; feeding cost', function(o){ return money(o.r.econ.costs); }],
      ['Cows going into next year', function(o){ return fmt(o.key === 'D' ? keepCows : cows) + ' · BCS ' + fmt(o.r.bcs.breed, 1) + ' at breeding'; }]
    ];
    $('dec_drOptions').innerHTML = '<div class="table-scroll"><table class="plan dec-drtable"><thead><tr><th></th>' + opts.map(function(o){
        return '<th class="' + (o === best ? 'best' : '') + '">' + (o === best ? '<span class="verdict-pill good"><span class="dot"></span>Most this year</span>' : '') + '<div class="opt-title">' + esc(o.title) + '</div><div class="opt-sub">' + esc(o.sub) + '</div></th>'; }).join('') + '</tr></thead><tbody>' +
      rowsDef.map(function(rd){ return '<tr><td>' + rd[0] + '</td>' + opts.map(function(o){ return '<td class="num' + (o === best ? ' best' : '') + '">' + rd[1](o) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Income − feed (this year)</td>' + opts.map(function(o){ return '<td class="num' + (o === best ? ' best' : '') + '">' + money(o.net) + '</td>'; }).join('') + '</tr></tfoot></table></div>';
    var keepOpts = opts.slice(0, 3), K = keepOpts.reduce(function(a, o){ return o.net > a.net ? o : a; });
    var second = opts.filter(function(o){ return o !== best; }).reduce(function(a, o){ return o.net > a.net ? o : a; });
    $('dec_drText').innerHTML = 'With ' + dr.cut + '% less forage from ' + FEED.MONTHS[+dr.from] + ' for ' + dr.months + ' month' + (dr.months > 1 ? 's' : '') + ', the drought costs about <strong>' + money(N.econ.net - A.econ.net) + '</strong> this year if you just buy feed. ' +
      '<strong>' + esc(best.title) + '</strong> leaves ' + money(best.net - second.net) + ' more than the next option <em>this year</em>' + (best.key === 'D' ? ' — but selling cows is spending the herd: the next 10 years below show what it costs to get them back.' : '.') +
      ' Lighter calves bring more per hundredweight (price slide), which is why early weaning loses less than the weight alone suggests.' + (+dr.hayPrice > 0 ? ' Hay this year at ' + money(+dr.hayPrice) + '/ton (normal ' + money(h.hayPrice) + ').' : ' Hay at your normal price, ' + money(h.hayPrice) + '/ton — in a drought it usually costs more: set it above.');

    /* ---- 2. the next 10 years: keep the herd, or sell and then buy back / raise heifers / stay smaller */
    var Y = 10, r = Math.max(0, +dr.rate || 0)/100, other = Math.max(0, +dr.otherCost || 0), buyP = +dr.buyPrice > 0 ? +dr.buyPrice : bredCowPrice();
    var later = 1 + (+dr.later || 0)/100;
    var Nl = later !== 1 ? netOf({priceMult:later}) : N;
    function mPerCow(y){ return ((y >= 4 ? Nl : N).econ.net)/cows - other; }   // a normal year, per cow, after your other costs
    // grass after the drought: year 1 at "recover" % of normal, year 2 halfway back, then normal. A herd too big for the
    // recovering grass buys hay (at your normal price) — this is where stocking lighter pays: the range rests.
    var rec1 = Math.max(30, Math.min(100, +dr.recover || 100))/100, recY = function(y){ return y === 1 ? rec1 : y === 2 ? (1 + rec1)/2 : 1; };
    var mCache = {};
    function herdNet(c, y){
      c = Math.round(c); if(c <= 0) return 0;
      var mult = recY(y), pm = y >= 4 ? later : 1;
      if(mult === 1 && c === cows) return (pm !== 1 ? Nl : N).econ.net - other*c;
      var key = c + '|' + mult + '|' + pm;
      if(!(key in mCache)){
        var o = {cows:c, bulls:Math.max(1, Math.round(bulls*c/cows))}; if(pm !== 1) o.priceMult = pm;
        mCache[key] = netOf(o, {}, mult).econ.net;
      }
      return mCache[key] - other*c;
    }
    var heiferCalvesPerCow = (N.econ.calvesSold + N.econ.heifersKept)/cows/2, keptPerCow = N.econ.heifersKept/cows;
    var calfVal = N.econ.avgSaleLb/100*N.econ.avgPrice, preg = (+h.heiferPreg || 85)/100;
    // thin cows at breeding during the drought get pregnant less: fewer calves the year after (Sprott 1985)
    function pregLoss(run, herd){ var pf = FEED.pregByBcs(run.bcs.breed)/FEED.pregByBcs(N.bcs.breed); return Math.max(0, 1 - pf)*N.econ.calfIncome/cows*herd; }
    function strat(key, label, year0, herd0, pathFn){
      var cash = [year0], herd = [herd0], c = herd0, pipe = {}, spent = 0;
      for(var y = 1; y <= Y; y++){
        var res = pathFn(y, c, pipe); c = res.cows;
        cash.push(res.cash); herd.push(c); spent += res.spent || 0;
      }
      var endVal = c*h.cowLb/100*cullPrice();   // herd still owned at year 10, valued as culls
      var pv = cash.reduce(function(a, v, i){ return a + v/Math.pow(1 + r, i); }, 0) + endVal/Math.pow(1 + r, Y);
      var full = herd.indexOf(herd.filter(function(x){ return x >= cows - 0.5; })[0]);
      var minCum = 0, cum = 0; cash.forEach(function(v){ cum += v; minCum = Math.min(minCum, cum); });
      return {key:key, label:label, cash:cash, herd:herd, pv:pv, total:cash.reduce(function(a, b){ return a + b; }, 0), endVal:endVal, full:full, need:-minCum, spent:spent};
    }
    var year0Keep = K.net - other*cows;
    var year0Sell = D.r.econ.net + saleVal - other*(dr.sellWhen === 'weaning' ? cows : keepCows);
    var S = [];
    S.push(strat('keep', 'Keep the herd (' + K.title.charAt(0).toLowerCase() + K.title.slice(1) + ')', year0Keep, cows, function(y, c){
      return {cows:c, cash:herdNet(c, y) - (y === 1 ? pregLoss(K.r, c) : 0)}; }));
    var bYear = Math.max(1, Math.min(3, +dr.buyYear || 1));
    if(nSell > 0){
      S.push(strat('buy', 'Sell ' + fmt(nSell) + ', buy back bred cows in year ' + bYear, year0Sell, keepCows, function(y, c){
        var cash = 0, sp = 0; if(y === bYear){ sp = nSell*buyP; cash -= sp; c = cows; }
        return {cows:c, spent:sp, cash:cash + herdNet(c, y) - (y === 1 ? pregLoss(D.r, c) : 0)}; }));
      S.push(strat('raise', 'Sell ' + fmt(nSell) + ', raise your own heifers', year0Sell, keepCows, function(y, c, pipe){
        c = Math.min(cows, c + (pipe[y] || 0)); delete pipe[y];
        var cash = herdNet(c, y) - (y === 1 ? pregLoss(D.r, c) : 0);
        var coming = Object.keys(pipe).reduce(function(a, k){ return a + pipe[k]; }, 0);
        var extra = Math.max(0, Math.min(c*(heiferCalvesPerCow - keptPerCow), (cows - c - coming)/preg));
        var sp = 0; if(extra > 0.01){ pipe[y + 2] = (pipe[y + 2] || 0) + extra*preg; sp = extra*(calfVal*(y >= 4 ? later : 1) + (+dr.devCost || 0)); cash -= sp; }
        return {cows:c, cash:cash, spent:sp}; }));
      S.push(strat('stay', 'Sell ' + fmt(nSell) + ' and stay smaller', year0Sell, keepCows, function(y, c){
        return {cows:c, cash:herdNet(c, y) - (y === 1 ? pregLoss(D.r, c) : 0)}; }));
    }
    var bestS = S.reduce(function(a, s){ return s.pv > a.pv ? s : a; }, S[0]);
    var COLORS = {keep:'var(--accent)', buy:'#115740', raise:'#b8860b', stay:'#707070'};
    (function(){
      var el = $('dec_drLongChart'), W = Math.round(Math.max(320, Math.min(760, el.clientWidth || 760))), H = 240, ml = W < 500 ? 56 : 70, mr = W < 500 ? 12 : 120, mt = 16, mb = 30, pw = W - ml - mr, ph = H - mt - mb;
      // difference from keeping the herd, adding up year by year (keeping the herd = the $0 line)
      var cum0 = (function(){ var c = 0; return S[0].cash.map(function(v){ c += v; return c; }); })();
      var cums = S.map(function(s){ var c = 0; return s.cash.map(function(v, i){ c += v; return c - cum0[i]; }); });
      var all = [].concat.apply([0], cums), lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo)*0.06 || 1;
      function X2(i){ return ml + i/Y*pw; } function Y2(v){ return mt + ph - (v - lo + pad)/(hi - lo + 2*pad)*ph; }
      var sv = '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><g class="grid">';
      for(var g = 0; g <= 4; g++){ var gv = lo - pad + (hi - lo + 2*pad)*g/4; sv += '<line x1="' + ml + '" x2="' + (ml + pw) + '" y1="' + Y2(gv).toFixed(1) + '" y2="' + Y2(gv).toFixed(1) + '"/>'; }
      sv += '</g><g class="axis">';
      for(g = 0; g <= 4; g++){ gv = lo - pad + (hi - lo + 2*pad)*g/4; sv += '<text x="' + (ml - 8) + '" y="' + (Y2(gv) + 4).toFixed(1) + '" text-anchor="end">' + money(Math.round(gv/1000)*1000) + '</text>'; }
      for(var i = 0; i <= Y; i++) sv += '<text x="' + X2(i).toFixed(1) + '" y="' + (mt + ph + 18) + '" text-anchor="middle">' + (i === 0 ? 'Drought' : 'Yr ' + i) + '</text>';
      sv += '</g>';
      S.forEach(function(s, k){
        sv += '<polyline fill="none" stroke="' + COLORS[s.key] + '" stroke-width="' + (s === bestS ? 3 : 2) + '" points="' + cums[k].map(function(v, i){ return X2(i).toFixed(1) + ',' + Y2(v).toFixed(1); }).join(' ') + '"/>';
      });
      if(W >= 500){   // end labels, nudged apart so they don't overlap
        var labs = S.map(function(s, k){ return {s:s, y:Y2(cums[k][Y])}; }).sort(function(a, b){ return a.y - b.y; });
        for(var q = 1; q < labs.length; q++) if(labs[q].y - labs[q - 1].y < 13) labs[q].y = labs[q - 1].y + 13;
        labs.forEach(function(l){ sv += '<text x="' + (ml + pw + 6) + '" y="' + (l.y + 4).toFixed(1) + '" font-size="11" font-weight="700" fill="' + COLORS[l.s.key] + '">' + {keep:'Keep the herd', buy:'Buy back', raise:'Raise heifers', stay:'Stay smaller'}[l.s.key] + '</text>'; });
      }
      sv += '</svg>';
      el.innerHTML = '<div class="fc-legend" style="margin-bottom:6px;"><span style="color:var(--ink-muted);">Cash compared with keeping the herd, adding up year by year (after feed and your other costs)</span>' + S.map(function(s){ return '<span><i class="sw" style="background:' + COLORS[s.key] + ';"></i>' + {keep:'Keep the herd', buy:'Buy back', raise:'Raise heifers', stay:'Stay smaller'}[s.key] + '</span>'; }).join('') + '</div>' + sv;
    })();
    var keepS = S[0];
    $('dec_drLongText').innerHTML = nSell > 0 ?
      'Over 10 years, <strong>' + esc(bestS.label.charAt(0).toLowerCase() + bestS.label.slice(1)) + '</strong> is worth the most today: <strong>' + money(bestS.pv) + '</strong> (cash discounted at ' + fmt(r*100, 1) + '% a year, plus the cows you still own at the end, valued as culls). ' +
      S.filter(function(s){ return s !== bestS; }).map(function(s){ return esc({keep:'Keeping the herd', buy:'Buying back', raise:'Raising heifers', stay:'Staying smaller'}[s.key]) + ': ' + money(s.pv - bestS.pv); }).join(' · ') + '. ' +
      (S[1] ? 'Buying back ' + fmt(nSell) + ' bred cows at ' + money(buyP) + ' takes ' + money(nSell*buyP) + '; a cow earns about ' + money(mPerCow(1)) + ' a year after feed and other costs, so she pays for herself in about ' + fmt(buyP/Math.max(1, mPerCow(1)), 1) + ' years. ' : '') +
      (S[2] ? 'Raising heifers brings the herd back in year ' + (S[2].full > 0 ? S[2].full : '10+') + ', without buying, but you give up selling those heifers and wait two years for each one to calve. ' : '') +
      'The grass is counted at ' + fmt(rec1*100) + '% of normal the year after the drought and ' + fmt((1 + rec1)/2*100) + '% the next, so a herd too big for it buys hay — that is what resting the range with fewer cows is worth here. ' + (+dr.hayPrice > 0 ? 'Drought-year hay at ' + money(+dr.hayPrice) + '/ton.' : '')
      : 'Set a share of cows to sell above 0% to compare selling and rebuilding with keeping the herd.';
    $('dec_drLongTable').innerHTML = '<thead><tr><th></th><th class="num">Drought year</th><th class="num">Cows yr 1 · 3 · 5 · 10</th><th class="num">Back to ' + fmt(cows) + ' cows</th><th class="num">Spent to rebuild</th><th class="num">10-year cash</th><th class="num">Worth today*</th></tr></thead><tbody>' +
      S.map(function(s){ return '<tr' + (s === bestS ? ' class="best"' : '') + '><td><i class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:' + COLORS[s.key] + ';"></i>' + (s === bestS ? '★ ' : '') + esc(s.label) + '</td>' +
        '<td class="num">' + money(s.cash[0]) + '</td><td class="num">' + [1, 3, 5, 10].map(function(i){ return fmt(s.herd[i]); }).join(' · ') + '</td>' +
        '<td class="num">' + (s.key === 'keep' ? '—' : s.full > 0 ? 'year ' + s.full : 'not in 10 yrs') + '</td><td class="num">' + (s.spent > 0.5 ? money(s.spent) + (s.key === 'raise' ? '<br><small>heifers not sold + raising</small>' : '') : '—') + '</td>' +
        '<td class="num">' + money(s.total) + '</td><td class="num"><strong>' + money(s.pv) + '</strong></td></tr>'; }).join('') + '</tbody>';
    var bp = $('dr_buyPrice'); if(bp) bp.placeholder = fmt(bredCowPrice());
    var hp = $('dr_hayPrice'); if(hp) hp.placeholder = fmt(h.hayPrice);
  }

  function renderWhatIf(){
    var h = state.herd, base = feedLast.econ.net;
    var tests = [
      {label:'Pasture forage', lo:'−25%', hi:'+25%', a:function(){ return netOf({}, {}, 0.75); }, b:function(){ return netOf({}, {}, 1.25); }},
      {label:'Calf prices', lo:'−10%', hi:'+10%', a:function(){ return netOf({priceMult:0.9}); }, b:function(){ return netOf({priceMult:1.1}); }},
      {label:'Weaning weight', lo:'−10%', hi:'+10%', a:function(){ return netOf({weanLb:h.weanLb*0.9}); }, b:function(){ return netOf({weanLb:h.weanLb*1.1}); }},
      {label:'Hay price', lo:'+25%', hi:'−25%', a:function(){ return netOf({}, {hayPrice:h.hayPrice*1.25}); }, b:function(){ return netOf({}, {hayPrice:h.hayPrice*0.75}); }},
      {label:'Supplement price', lo:'+25%', hi:'−25%', a:function(){ return netOf({}, {supPrice:h.supPrice*1.25}); }, b:function(){ return netOf({}, {supPrice:h.supPrice*0.75}); }},
      {label:'Calf death loss', lo:'+3 pts', hi:'−3 pts', a:function(){ return netOf({calfLoss:h.calfLoss + 3}); }, b:function(){ return netOf({calfLoss:Math.max(0, h.calfLoss - 3)}); }},
      {label:'Calving rate', lo:'−5 pts', hi:'+5 pts', a:function(){ return netOf({calvingRate:Math.max(30, h.calvingRate - 5)}); }, b:function(){ return netOf({calvingRate:Math.min(100, h.calvingRate + 5)}); }},
      {label:'Cow size', lo:'+100 lb', hi:'−100 lb', a:function(){ return netOf({cowLb:h.cowLb + 100}); }, b:function(){ return netOf({cowLb:h.cowLb - 100}); }}
    ];
    if(h.calving !== 'us') tests.push({label:'Calving 30 days', lo:'later', hi:'earlier',
      a:function(){ var o = feedOptions(); return netOf({start1:(o.start1 + 30) % 365, start2:(o.start2 + 30) % 365, weanMode:'age', weanAge:Math.round(o.refWeanAge)}); },
      b:function(){ var o = feedOptions(); return netOf({start1:(o.start1 + 335) % 365, start2:(o.start2 + 335) % 365, weanMode:'age', weanAge:Math.round(o.refWeanAge)}); }});
    var rows = tests.map(function(t){ var a = t.a().econ.net - base, b = t.b().econ.net - base; return {t:t, a:a, b:b, span:Math.abs(b - a)}; });
    rows.sort(function(x, y){ return y.span - x.span; });
    var max = Math.max.apply(null, rows.map(function(r){ return Math.max(Math.abs(r.a), Math.abs(r.b)); })) || 1;
    $('dec_whatifChart').innerHTML = '<div class="wi-head"><span></span><span>Worse</span><span>Better</span></div>' + rows.map(function(r){
      function bar(v, lab){
        var w = Math.abs(v)/max*100, neg = v < 0;
        return '<div class="wi-bar ' + (neg ? 'neg' : 'pos') + '" style="width:' + w.toFixed(1) + '%"></div><span class="wi-val">' + (v >= 0 ? '+' : '−') + money(Math.abs(v)).replace('$', '$') + ' <em>' + esc(lab) + '</em></span>';
      }
      var worse = r.a < r.b ? {v:r.a, l:r.t.lo} : {v:r.b, l:r.t.hi}, better = r.a < r.b ? {v:r.b, l:r.t.hi} : {v:r.a, l:r.t.lo};
      return '<div class="wi-row"><span class="wi-lbl">' + esc(r.t.label) + '</span><div class="wi-side left">' + bar(Math.min(0, worse.v), worse.l) + '</div><div class="wi-side right">' + bar(Math.max(0, better.v), better.l) + '</div></div>';
    }).join('') + '<p class="card-note" style="margin:12px 0 0;">Change in cattle sales minus feed costs per year, whole herd, from today’s ' + money(base) + '.</p>';
  }

  /* ---- bindings */
  function bindFeed(){
    $('fc_breed').innerHTML = Object.keys(FEED.BREEDS).map(function(k){ return '<option value="' + k + '">' + esc(FEED.BREEDS[k].label) + '</option>'; }).join('');
    $('fc_source').innerHTML = Object.keys(FEED.SOURCES).map(function(k){ var s = FEED.SOURCES[k]; return '<option value="' + k + '">' + esc(s.label) + (s.cp != null ? ' (' + s.cp + '% CP)' : '') + '</option>'; }).join('');
    $('dr_from').innerHTML = FEED.MONTHS.map(function(m, i){ return '<option value="' + i + '">' + m + '</option>'; }).join('');
    $('dec_calvPrice').addEventListener('change', function(){ state.herd.decPrice = this.value; save(); scheduleDecisions(); });
    bindFeedValues();
    function rerender(){ save(); renderSummary(); renderRotation(); renderFeed(); renderHerdNote(); }
    document.querySelectorAll('[data-h]').forEach(function(el){
      var k = el.getAttribute('data-h'), mn = +el.min, mx = +el.max;
      el.addEventListener('input', function(){ var v = num(this.value); if(v != null && v >= mn && v <= mx){ state.herd[k] = v; rerender(); } });
      el.addEventListener('blur', function(){ this.value = state.herd[k]; });
    });
    document.querySelectorAll('[data-hs]').forEach(function(el){
      var k = el.getAttribute('data-hs');
      el.addEventListener('change', function(){ state.herd[k] = el.hasAttribute('data-num') ? +this.value : this.value; syncFields(); rerender(); });
    });
    document.querySelectorAll('[data-hd]').forEach(function(el){
      var k = el.getAttribute('data-hd');
      el.addEventListener('change', function(){ var v = dateToMmdd(this.value); if(v){ state.herd[k] = v; rerender(); } });
    });
    document.querySelectorAll('[data-dr]').forEach(function(el){
      var k = el.getAttribute('data-dr'), mn = +el.min, mx = +el.max;
      el.addEventListener('input', function(){ var v = num(this.value); if(this.value === '' && (k === 'buyPrice' || k === 'hayPrice')){ state.herd.dr[k] = null; save(); scheduleDecisions(); return; } if(v != null && v >= mn && v <= mx){ state.herd.dr[k] = v; save(); scheduleDecisions(); } });
      el.addEventListener('blur', function(){ this.value = state.herd.dr[k] == null ? '' : state.herd.dr[k]; });
    });
    document.querySelectorAll('[data-sl]').forEach(function(el){
      var k = el.getAttribute('data-sl'), mn = +el.min, mx = +el.max;
      el.addEventListener('input', function(){ var v = num(this.value); if(v != null && v >= mn && v <= mx){ state.herd.sell = Object.assign({rate:8, death:0.5}, state.herd.sell || {}); state.herd.sell[k] = v; save(); scheduleDecisions(); } });
      el.addEventListener('blur', function(){ this.value = (state.herd.sell || {})[k]; });
    });
    document.querySelectorAll('[data-drs]').forEach(function(el){
      var k = el.getAttribute('data-drs');
      el.addEventListener('change', function(){ state.herd.dr[k] = el.hasAttribute('data-num') ? +this.value : this.value; save(); scheduleDecisions(); });
    });
    $('fc_region').addEventListener('change', function(){ state.herd.region = this.value; rerender(); });
    $('fc_source').addEventListener('change', function(){
      var s = FEED.SOURCES[this.value]; state.herd.source = this.value;
      if(s && s.cp != null){ state.herd.supCp = s.cp; state.herd.supTdn = s.tdn; }
      bindFeedValues(); rerender();
    });
    $('fc_reset').addEventListener('click', function(){
      var keep = {calving:1, start1:1, len1:1, start2:1, len2:1, share2:1, wean1:1, wean2:1, weanAge:1, region:1, dr:1, cows:1, cowLb:1, bulls:1, bullLb:1};
      Object.keys(DEFAULT_HERD).forEach(function(k){ if(!keep[k]) state.herd[k] = DEFAULT_HERD[k]; });
      bindFeedValues(); rerender();
    });
    document.querySelectorAll('.seg-btn[data-nutrient]').forEach(function(b){
      b.addEventListener('click', function(){
        feedNutrient = b.getAttribute('data-nutrient');
        document.querySelectorAll('.seg-btn[data-nutrient]').forEach(function(x){ var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
        if(feedLast) renderFeedChart(feedLast, feedNutrient, $('fc_chart'), true);
      });
    });
    document.querySelectorAll('.seg-btn[data-dec]').forEach(function(b){
      b.addEventListener('click', function(){
        decTab = b.getAttribute('data-dec');
        document.querySelectorAll('.seg-btn[data-dec]').forEach(function(x){ var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
        decKey = ''; renderDecisions();
      });
    });
    window.addEventListener('scroll', function(){ var t = $('fcTooltip'); if(t) t.classList.remove('show'); }, {passive:true});
    var rsz = null; window.addEventListener('resize', function(){ clearTimeout(rsz); rsz = setTimeout(function(){ if(feedLast && !$('fc_main').hidden){ renderFeedChart(feedLast, feedNutrient, $('fc_chart'), true); decKey = ''; renderDecisions(); } }, 150); });
    window.addEventListener('beforeprint', function(){
      if(!feedLast) return;
      renderFeedChart(feedLast, 'tdn', $('fc_chart_p_tdn'), false); renderFeedChart(feedLast, 'cp', $('fc_chart_p_cp'), false);
      if(feedLast.hasSupply){ try{ renderCalvingDecision(); renderDroughtDecision(); renderWhatIf(); decKey = ''; }catch(e){} }
    });
  }
