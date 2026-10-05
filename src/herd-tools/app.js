(function(){
  'use strict';
  var STORE = 'tamuHerdTools.v1';
  function $(id){ return document.getElementById(id); }
  function fmt(n, d){ if(n == null || !isFinite(n)) return '—'; return n.toLocaleString('en-US', {minimumFractionDigits:d || 0, maximumFractionDigits:d || 0}); }
  function money(n, d){ if(n == null || !isFinite(n)) return '—'; return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits:d || 0, maximumFractionDigits:d || 0}); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function num(v){ var n = parseFloat(v); return isFinite(n) ? n : null; }

  /* ================================================================ ENGINE (pure functions) */

  /* Water: NRC (2000) table as published in MSU Extension P2490. Gallons per head per day at 40..90 °F. */
  var W_TEMPS = [40, 50, 60, 70, 80, 90];
  var W_TABLE = {
    growing:   {label:'growing calves, heifers and steers', rows:[[400,[4.0,4.3,5.0,5.8,6.7,9.5]],[600,[5.3,5.8,6.5,7.8,8.9,12.7]],[800,[6.3,6.8,7.9,9.2,10.6,15.0]]]},
    finishing: {label:'finishing cattle', rows:[[600,[6.0,6.5,7.4,8.7,10.0,14.3]],[800,[7.3,7.9,9.1,10.7,12.3,17.4]],[1000,[8.7,9.4,10.8,12.6,14.5,20.6]]]},
    pregnant:  {label:'dry pregnant cows', rows:[[900,[6.7,7.2,8.3,9.7,null,null]]]},
    lactating: {label:'cows nursing calves', rows:[[900,[11.4,12.6,14.5,16.9,17.9,16.2]]]},
    bulls:     {label:'mature bulls', rows:[[1400,[8.0,8.6,9.9,11.7,13.4,19.0]],[1600,[8.7,9.4,10.8,12.6,14.5,20.6]]]}
  };
  // Dry pregnant cows have no published values above 70 °F: extend with the mature-bull pattern (70→80, 70→90).
  var BULL_RATIO = [13.4/11.7, 19.0/11.7];
  function waterRow(cls, lb){
    var t = W_TABLE[cls] || W_TABLE.lactating, rows = t.rows, flags = {};
    var row;
    if(rows.length === 1 || lb <= rows[0][0]){
      var r0 = rows[0]; row = r0[1].map(function(v){ return v == null ? null : v*lb/r0[0]; });
      if(Math.abs(lb - r0[0]) > 1) flags.scaled = true;
    } else if(lb >= rows[rows.length - 1][0]){
      var rl = rows[rows.length - 1]; row = rl[1].map(function(v){ return v*lb/rl[0]; });
      if(Math.abs(lb - rl[0]) > 1) flags.scaled = true;
    } else {
      for(var i = 0; i < rows.length - 1; i++){
        var a = rows[i], b = rows[i + 1];
        if(lb >= a[0] && lb <= b[0]){ var f = (lb - a[0])/(b[0] - a[0]); row = a[1].map(function(v, k){ return v + (b[1][k] - v)*f; }); break; }
      }
    }
    if(cls === 'pregnant'){ row[4] = row[3]*BULL_RATIO[0]; row[5] = row[3]*BULL_RATIO[1]; flags.pregHot = true; }
    if(cls === 'lactating'){ row[5] = Math.max(row[5], row[4]); flags.lactHot = true; }   // planning: never less water as it gets hotter
    return {row:row, flags:flags};
  }
  function water(cls, lb, tempF){
    var wr = waterRow(cls, lb), row = wr.row, t = Math.max(40, Math.min(90, tempF));
    var i = Math.min(4, Math.floor((t - 40)/10)), f = (t - W_TEMPS[i])/10;
    var gal = row[i] + (row[i + 1] - row[i])*f;
    var flags = wr.flags; flags.below40 = tempF < 40; flags.above90 = tempF > 90;
    flags.usedHot = t > 70;
    return {gal:gal, row:row, flags:flags};
  }

  /* Pearson square on a dry-matter basis: fraction of feed A so that a*x + b*(1-x) = target */
  function pearson(a, b, target){
    if(a === b) return null;
    var lo = Math.min(a, b), hi = Math.max(a, b);
    if(target < lo || target > hi) return null;
    var partsA = Math.abs(b - target), partsB = Math.abs(a - target), tot = partsA + partsB;
    return {fa:partsA/tot, fb:partsB/tot, partsA:partsA, partsB:partsB};
  }

  /* Dewormers: FDA-approved label directions (DailyMed). mlPerLb = label mL / label lb. */
  var DM = 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=';
  var DEWORMERS = {
    ivm_inj: {label:'Ivermectin 1% injectable', route:'injection under the skin', dose:1, per:110, maxSite:10, wd:35, bottle:500,
      restrict:'Not for female dairy cattle of breeding age or calves to be processed for veal.', ex:'Ivomec® Injection', url:DM + '84fe39b2-0423-479a-b81f-198e2fb4e826'},
    ivm_po: {label:'Ivermectin pour-on (0.5%)', route:'pour-on along the back', dose:1, per:22, wd:48, bottle:2500,
      restrict:'Not for female dairy cattle of breeding age or calves to be processed for veal.', ex:'Ivomec® Pour-On', url:DM + 'a3ee24dc-527f-4880-a55e-acd33b833192'},
    dor_inj: {label:'Doramectin 1% injectable', route:'injection under the skin or in the muscle', dose:1, per:110, wd:35, bottle:500,
      restrict:'Not for female dairy cattle 20 months of age or older, or veal calves.', ex:'Dectomax® Injectable', url:DM + '44b8a743-4f00-457a-8b7e-5f3a557c04f1'},
    dor_po: {label:'Doramectin pour-on (0.5%)', route:'pour-on along the back', dose:1, per:22, wd:45, bottle:2500,
      restrict:'Not for female dairy cattle 20 months of age or older, or veal calves.', ex:'Dectomax® Pour-On', url:DM + 'ec6ff537-4773-432d-86db-7ba767769c80'},
    epr_er: {label:'Eprinomectin 5% extended-release injectable', route:'injection under the skin in front of the shoulder', dose:1, per:110, maxSite:10, wd:48, bottle:500,
      restrict:'Not for female dairy cattle 20 months or older (including dry cows), veal calves, breeding bulls, or calves under 3 months.', ex:'LongRange®', url:DM + '040cd8ea-5c01-4eda-b36a-5427e5a7bdef'},
    epr_po: {label:'Eprinomectin pour-on (0.5%)', route:'pour-on along the back', dose:1, per:22, wd:0, bottle:2500,
      restrict:'No slaughter withdrawal and no milk discard. Not for calves to be processed for veal.', ex:'Eprinex® Pour-On', url:DM + '7cf8669c-c000-4645-962e-891946c0e54b'},
    mox_po: {label:'Moxidectin pour-on (0.5%)', route:'pour-on along the back', dose:1, per:22, wd:0, bottle:2500,
      restrict:'No slaughter withdrawal and no milk discard. Not for veal calves.', ex:'Cydectin® Pour-On', url:DM + 'b9b31948-0fad-4666-bba3-d31e1c38779e'},
    fbz: {label:'Fenbendazole 10% oral suspension', route:'by mouth (drench)', dose:2.3, per:100, wd:8, bottle:1000,
      restrict:'Milk: discard during treatment and for 48 hours after. Not for beef calves under 2 months, dairy calves or veal calves.', ex:'Safe-Guard® 10% Suspension', url:DM + '9188886a-54bc-4c68-9f1d-37a20e031076'},
    alb: {label:'Albendazole 11.36% oral suspension', route:'by mouth (drench)', dose:4, per:100, wd:27, bottle:1000,
      restrict:'Not for female dairy cattle of breeding age.', ex:'Valbazen®', url:DM + '94cf5818-f27d-4374-87ad-54a2d9ce6ef1'},
    custom: {label:'Other product (enter from its label)', route:'', dose:null, per:null, wd:null, bottle:500, restrict:'', ex:'', url:''}
  };
  function dewormer(key, lb, head, bottle, custom){
    var p = DEWORMERS[key] || DEWORMERS.ivm_inj;
    var dose = key === 'custom' ? custom.dose : p.dose, per = key === 'custom' ? custom.per : p.per, wd = key === 'custom' ? custom.wd : p.wd;
    if(!(dose > 0) || !(per > 0)) return null;
    var ml = lb*dose/per, total = ml*head;
    return {ml:ml, total:total, bottles:bottle > 0 ? Math.ceil(total/bottle - 1e-9) : null, wd:wd, sites:p.maxSite ? Math.ceil(ml/p.maxSite - 1e-9) : 1, product:p};
  }
  function addDays(iso, d){ var t = new Date(iso + 'T12:00:00'); if(isNaN(t)) return null; t.setDate(t.getDate() + d); return t; }
  function isoOf(t){ return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  function niceDate(t){ return t.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}); }

  /* Weight gain */
  function gain(o){
    var adg = (o.now - o.start)/o.days;
    var left = Math.max(0, o.sale - o.now);
    return {adg:adg, gap:adg - o.target, daysReal:adg > 0 ? left/adg : null, daysTarget:o.target > 0 ? left/o.target : null,
            pay:o.sale*(1 - o.shrink/100), shrinkLb:o.sale*o.shrink/100};
  }

  /* SPA reproduction measures (exposed-female basis) */
  function spa(o){
    return {pregExp:o.exposed > 0 ? o.preg/o.exposed*100 : null, pregTest:o.tested > 0 ? o.preg/o.tested*100 : null,
            wean:o.exposed > 0 ? o.weaned/o.exposed*100 : null, lbExp:o.exposed > 0 ? o.weaned/o.exposed*o.wwt : null,
            repl:o.exposed > 0 ? o.heifers/o.exposed*100 : null,
            expected:o.begin + o.born + o.bought - o.sold - o.died};
  }

  /* ================================================================ STATE */
  var DEF = {
    tool:'water',
    w_class:'lactating', w_lb:1200, w_head:100, w_temp:95, w_tank:3000,
    r_nut:'cp', r_target:10, r_aName:'Grass hay', r_aCp:7, r_aTdn:52, r_aDm:90, r_aPrice:120,
    r_bName:'20% range cubes', r_bCp:22, r_bTdn:78, r_bDm:90, r_bPrice:392, r_dmi:26, r_bw:1200, r_head:100, r_days:90,
    d_prod:'ivm_inj', d_cDose:1, d_cPer:110, d_cWd:35, d_lb:600, d_head:100, d_bottle:500, d_date:'', d_sale:'',
    g_start:450, g_now:540, g_days:60, g_target:1.75, g_sale:750, g_shrink:3, g_head:100, g_price:300,
    h_exposed:100, h_heifers:18, h_tested:98, h_preg:90, h_weaned:84, h_wwt:540,
    h_begin:210, h_born:88, h_bought:4, h_sold:95, h_died:3, h_count:204
  };
  var S = Object.assign({}, DEF);
  try{ var saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if(saved && typeof saved === 'object') Object.keys(DEF).forEach(function(k){ if(saved[k] != null) S[k] = saved[k]; }); }catch(e){}
  function save(){ try{ localStorage.setItem(STORE, JSON.stringify(S)); }catch(e){} }
  var today = isoOf(new Date());
  if(!S.d_date) S.d_date = today;
  if(!S.d_sale){ var t60 = addDays(today, 60); S.d_sale = t60 ? isoOf(t60) : today; }

  /* ================================================================ RENDER */
  function pill(el, kind, text){ el.className = 'verdict-pill ' + kind; el.querySelector('span:last-child').textContent = text; }

  function renderWater(){
    var r = water(S.w_class, S.w_lb, S.w_temp), herd = r.gal*S.w_head;
    $('w_perHead').textContent = fmt(r.gal, 1);
    $('w_herd').textContent = fmt(herd);
    var days = S.w_tank > 0 && herd > 0 ? S.w_tank/herd : null;
    $('w_days').textContent = days == null ? '—' : days < 1 ? fmt(days*24) + ' hours' : fmt(days, 1) + ' days';
    var notes = [];
    if(r.flags.above90) notes.push('The published table stops at 90°F, so this is the 90°F figure — on hotter days cattle drink even more.');
    if(r.flags.below40) notes.push('Below 40°F the table’s coldest value is used.');
    if(r.flags.scaled) notes.push('Your weight is outside the published weights, so the figure is scaled in proportion to weight.');
    if(r.flags.pregHot && r.flags.usedHot) notes.push('The table has no values above 70°F for dry pregnant cows; above 70°F this tool follows the pattern published for mature bulls.');
    if(r.flags.lactHot && S.w_temp > 80) notes.push('For nursing cows the published 90°F value is lower than the 80°F one; for planning, the tool keeps the 80°F value.');
    $('w_note').textContent = 'About ' + fmt(r.gal, 1) + ' gallons per head a day for ' + W_TABLE[S.w_class].label + ' weighing ' + fmt(S.w_lb) + ' lb at ' + fmt(S.w_temp) + '°F. ' + notes.join(' ');
    $('w_table').innerHTML = '<thead><tr><th>Temperature</th>' + W_TEMPS.map(function(t){ return '<th class="num">' + t + '°F</th>'; }).join('') + '</tr></thead><tbody><tr><td>Gal/head/day</td>' +
      r.row.map(function(v, i){ var on = Math.abs(Math.max(40, Math.min(90, S.w_temp)) - W_TEMPS[i]) < 5; return '<td class="num' + (on ? ' hl' : '') + '">' + fmt(v, 1) + '</td>'; }).join('') + '</tr></tbody>';
  }

  function renderRation(){
    var cp = S.r_nut === 'cp', a = cp ? S.r_aCp : S.r_aTdn, b = cp ? S.r_bCp : S.r_bTdn, tgt = S.r_target;
    var res = pearson(a, b, tgt), nutLbl = cp ? 'crude protein' : 'TDN';
    var pillEl = $('r_pill');
    if(!res){
      pill(pillEl, 'critical', a === b ? 'The two feeds have the same ' + nutLbl + ' — pick feeds that differ.' : 'The target (' + fmt(tgt, 1) + '%) must be between the two feeds (' + fmt(Math.min(a, b), 1) + '% and ' + fmt(Math.max(a, b), 1) + '%).');
      $('r_out').hidden = true; return;
    }
    $('r_out').hidden = false;
    var dmA = S.r_dmi*res.fa, dmB = S.r_dmi*res.fb;
    var afA = dmA/(S.r_aDm/100), afB = dmB/(S.r_bDm/100);
    var costHead = afA/2000*S.r_aPrice + afB/2000*S.r_bPrice;
    var other = cp ? res.fa*S.r_aTdn + res.fb*S.r_bTdn : res.fa*S.r_aCp + res.fb*S.r_bCp;
    pill(pillEl, 'good', fmt(res.fa*100) + '% ' + (S.r_aName || 'Feed 1') + ' + ' + fmt(res.fb*100) + '% ' + (S.r_bName || 'Feed 2') + ' (dry matter)');
    $('r_bar').innerHTML = '<span class="mb-a" style="width:' + (res.fa*100).toFixed(1) + '%">' + (res.fa > 0.3 ? esc(S.r_aName || 'Feed 1') : '') + '</span><span class="mb-b" style="width:' + (res.fb*100).toFixed(1) + '%">' + (res.fb > 0.3 ? esc(S.r_bName || 'Feed 2') : '') + '</span>';
    $('r_table').innerHTML = '<thead><tr><th>Per head per day</th><th class="num">Dry matter</th><th class="num">As fed</th><th class="num">Share</th></tr></thead><tbody>' +
      '<tr><td>' + esc(S.r_aName || 'Feed 1') + '</td><td class="num">' + fmt(dmA, 1) + ' lb</td><td class="num">' + fmt(afA, 1) + ' lb</td><td class="num">' + fmt(res.fa*100) + '%</td></tr>' +
      '<tr><td>' + esc(S.r_bName || 'Feed 2') + '</td><td class="num">' + fmt(dmB, 1) + ' lb</td><td class="num">' + fmt(afB, 1) + ' lb</td><td class="num">' + fmt(res.fb*100) + '%</td></tr></tbody>' +
      '<tfoot><tr><td>Total</td><td class="num">' + fmt(S.r_dmi, 1) + ' lb</td><td class="num">' + fmt(afA + afB, 1) + ' lb</td><td class="num">100%</td></tr></tfoot>';
    $('r_costHead').textContent = money(costHead, 2);
    $('r_costAll').textContent = money(costHead*S.r_head*S.r_days);
    $('r_tons').textContent = fmt(afA*S.r_head*S.r_days/2000, 1) + ' t ' + (S.r_aName || 'Feed 1') + ' · ' + fmt(afB*S.r_head*S.r_days/2000, 1) + ' t ' + (S.r_bName || 'Feed 2');
    // supplement = the feed richer in energy; check rate against body weight (McCollum, B-6067)
    var supIsB = S.r_bTdn >= S.r_aTdn, supAf = supIsB ? afB : afA, supName = supIsB ? (S.r_bName || 'Feed 2') : (S.r_aName || 'Feed 1');
    var pctBw = S.r_bw > 0 ? supAf/S.r_bw*100 : 0;
    var notes = ['The mix works out to ' + fmt(other, 1) + '% ' + (cp ? 'TDN' : 'crude protein') + ' on a dry-matter basis.'];
    if(pctBw >= 0.7) notes.push(supName + ' is ' + fmt(pctBw, 2) + '% of body weight a day. At 0.7–1% of body weight an energy feed deliberately replaces forage; step cattle up to it over several days.');
    else if(pctBw > 0.3) notes.push(supName + ' is ' + fmt(pctBw, 2) + '% of body weight a day. Above about 0.3% of body weight, energy feeds start to replace some of the forage cattle would eat, so hay use may drop.');
    else notes.push(supName + ' is ' + fmt(pctBw, 2) + '% of body weight a day — at under 0.3% it barely changes how much forage cattle eat.');
    if(cp && Math.min(S.r_aCp, S.r_bCp) < 7) notes.push('Forage under about 7% crude protein limits how much cattle eat; bringing the ration up in protein usually raises forage intake.');
    $('r_note').textContent = notes.join(' ');
  }

  function renderDewormer(){
    var key = S.d_prod, p = DEWORMERS[key] || DEWORMERS.ivm_inj;
    document.querySelectorAll('#tool-dewormer .custom-only').forEach(function(el){ el.hidden = key !== 'custom'; });
    var r = dewormer(key, S.d_lb, S.d_head, S.d_bottle, {dose:S.d_cDose, per:S.d_cPer, wd:S.d_cWd});
    if(!r){ pill($('d_pill'), 'critical', 'Enter the label dose'); return; }
    $('d_dose').textContent = fmt(r.ml, 1);
    $('d_doseSub').textContent = 'mL · ' + (key === 'custom' ? fmt(S.d_cDose, 1) + ' mL per ' + fmt(S.d_cPer) + ' lb' : fmt(p.dose, 1) + ' mL per ' + fmt(p.per) + ' lb') + (p.route ? ' · ' + p.route : '');
    $('d_bottles').textContent = r.bottles == null ? '—' : fmt(r.bottles);
    $('d_total').textContent = fmt(r.total) + ' mL for ' + fmt(S.d_head) + ' head';
    $('d_wd').textContent = r.wd == null ? '—' : r.wd === 0 ? 'None' : fmt(r.wd) + ' days';
    var earliest = r.wd != null ? addDays(S.d_date, r.wd) : null, sale = S.d_sale ? new Date(S.d_sale + 'T12:00:00') : null;
    $('d_earliest').textContent = earliest ? niceDate(earliest) : '—';
    if(earliest && sale && !isNaN(sale)){
      var diff = Math.round((sale - earliest)/86400000);
      $('d_earliestSub').textContent = diff >= 0 ? fmt(diff) + ' days to spare before your sale' : fmt(-diff) + ' days too late for your sale';
      pill($('d_pill'), diff >= 0 ? 'good' : 'critical', diff >= 0 ? 'Cattle clear withdrawal before your planned sale' : 'Withdrawal runs past your planned sale — sell later or pick another product');
    } else { $('d_earliestSub').textContent = ''; pill($('d_pill'), 'good', 'Enter a sale date to check withdrawal'); }
    var notes = [];
    if(p.maxSite && r.sites > 1) notes.push('The label allows at most ' + p.maxSite + ' mL per injection site: split each dose into ' + r.sites + ' sites.');
    if(r.bottles != null) notes.push('Buy whole containers: ' + fmt(r.total) + ' mL needs ' + fmt(r.bottles) + ' × ' + fmt(S.d_bottle) + ' mL.');
    notes.push('Withdrawal counts from the treatment date to slaughter; cattle sold as feeders carry the date with them — tell the buyer.');
    $('d_note').textContent = notes.join(' ');
    $('d_restrict').innerHTML = p.restrict ? '<strong>Label restrictions:</strong> ' + esc(p.restrict) : '';
    $('d_source').innerHTML = p.url ? '<strong>Source:</strong> FDA-approved label for ' + esc(p.ex) + ' on <a href="' + p.url + '" target="_blank" rel="noopener">DailyMed (U.S. National Library of Medicine)</a>. Other brands with the same active ingredient can have different doses or withdrawal times.' : '<strong>Source:</strong> the label of the product you use.';
  }

  function renderGain(){
    var r = gain({start:S.g_start, now:S.g_now, days:S.g_days, target:S.g_target, sale:S.g_sale, shrink:S.g_shrink});
    $('g_adg').textContent = fmt(r.adg, 2);
    $('g_gap').textContent = 'lb/day · ' + (r.gap >= 0 ? fmt(r.gap, 2) + ' above' : fmt(-r.gap, 2) + ' below') + ' the ' + fmt(S.g_target, 2) + ' target';
    $('g_daysReal').textContent = S.g_now >= S.g_sale ? 'There' : r.daysReal == null ? '—' : fmt(r.daysReal);
    $('g_daysTarget').textContent = S.g_now >= S.g_sale ? 'already at the goal' : 'at this pace · ' + (r.daysTarget == null ? '—' : fmt(r.daysTarget)) + ' at target';
    $('g_pay').textContent = fmt(r.pay) + ' lb';
    $('g_payAll').textContent = fmt(r.pay*S.g_head) + ' lb for ' + fmt(S.g_head) + ' head';
    var val = S.g_price > 0 ? r.pay/100*S.g_price*S.g_head : null;
    $('g_value').textContent = val == null ? '—' : money(val);
    $('g_shrinkCost').textContent = S.g_price > 0 ? 'shrink costs ' + money(r.shrinkLb/100*S.g_price*S.g_head) : 'enter a price';
    pill($('g_pill'), r.adg <= 0 ? 'critical' : r.gap >= 0 ? 'good' : 'critical', r.adg <= 0 ? 'Cattle are not gaining' : r.gap >= 0 ? 'On or above target' : 'Behind target by ' + fmt(-r.gap, 2) + ' lb/day');
    var n = [];
    if(r.adg > 0 && S.g_now < S.g_sale && r.gap < 0) n.push('At ' + fmt(r.adg, 2) + ' lb/day the calves need ' + fmt(r.daysReal - r.daysTarget) + ' more days than planned to reach ' + fmt(S.g_sale) + ' lb.');
    n.push('Weigh the same way both times (same time of day, same fill) or shrink differences will hide the real gain.');
    $('g_note').textContent = n.join(' ');
  }

  function renderHerd(){
    var o = {exposed:S.h_exposed, heifers:S.h_heifers, tested:S.h_tested, preg:S.h_preg, weaned:S.h_weaned, wwt:S.h_wwt,
             begin:S.h_begin, born:S.h_born, bought:S.h_bought, sold:S.h_sold, died:S.h_died};
    var r = spa(o);
    $('h_pregExp').textContent = r.pregExp == null ? '—' : fmt(r.pregExp) + '%';
    $('h_pregTest').textContent = r.pregTest == null ? 'of those tested: —' : fmt(r.pregTest) + '% of those tested';
    $('h_weanPct').textContent = r.wean == null ? '—' : fmt(r.wean) + '%';
    $('h_lbExp').textContent = r.lbExp == null ? '—' : fmt(r.lbExp);
    $('h_lbAll').textContent = fmt(S.h_weaned*S.h_wwt) + ' lb weaned in all';
    $('h_repl').textContent = r.repl == null ? '—' : fmt(r.repl) + '%';
    var diff = S.h_count - r.expected;
    pill($('h_pill'), diff === 0 ? 'good' : 'critical', diff === 0 ? 'Head count matches the records' : (diff < 0 ? fmt(-diff) + ' head fewer' : fmt(diff) + ' head more') + ' than the records say (' + fmt(r.expected) + ' expected, ' + fmt(S.h_count) + ' counted)');
    var n = [];
    if(S.h_tested > S.h_exposed || S.h_preg > S.h_tested) n.push('Check the numbers: pregnant can’t exceed tested, and tested can’t exceed exposed.');
    if(r.pregExp != null && r.wean != null && r.pregExp - r.wean > 0) n.push(fmt(r.pregExp - r.wean) + ' calves per 100 exposed females were lost between pregnancy check and weaning (abortions, calving and calf deaths).');
    if(diff !== 0) n.push('A count that doesn’t match usually means a sale, death or birth that wasn’t written down — or cattle that aren’t where they should be.');
    $('h_note').textContent = n.join(' ');
  }

  var RENDER = {water:renderWater, ration:renderRation, dewormer:renderDewormer, gain:renderGain, herd:renderHerd};
  function renderAll(){ Object.keys(RENDER).forEach(function(k){ try{ RENDER[k](); }catch(e){ if(window.console) console.error(e); } }); }

  /* ================================================================ WIRING */
  function showTool(t, push){
    if(!RENDER[t]) t = 'water';
    S.tool = t; save();
    document.querySelectorAll('.tool-tabs .seg-btn').forEach(function(b){ var on = b.getAttribute('data-tool') === t; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    document.querySelectorAll('.tool-panel').forEach(function(p){ p.hidden = p.id !== 'tool-' + t; });
    if(push && history.replaceState) history.replaceState(null, '', '#' + t);
  }
  function initTheme(){
    var KEY = 'tamuDecisionAidsTheme', toggle = $('themeToggle');
    var stored = null; try{ stored = localStorage.getItem(KEY); }catch(e){}
    if(stored === 'light' || stored === 'dark') document.documentElement.setAttribute('data-theme', stored);
    function current(){ var a = document.documentElement.getAttribute('data-theme'); if(a === 'light' || a === 'dark') return a; return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'; }
    function update(){ var dark = current() === 'dark'; toggle.textContent = dark ? '☀️' : '🌙'; var l = dark ? 'Switch to light mode' : 'Switch to dark mode'; toggle.setAttribute('aria-label', l); toggle.setAttribute('title', l); }
    update();
    toggle.addEventListener('click', function(){ var next = current() === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); try{ localStorage.setItem(KEY, next); }catch(e){} update(); });
  }
  function init(){
    initTheme();
    $('d_prod').innerHTML = Object.keys(DEWORMERS).map(function(k){ return '<option value="' + k + '">' + esc(DEWORMERS[k].label) + '</option>'; }).join('');
    document.querySelectorAll('[data-k]').forEach(function(el){
      var k = el.getAttribute('data-k');
      el.value = S[k];
      var isNum = el.type === 'number';
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', function(){
        if(isNum){ var v = num(el.value); if(v == null || v < +el.min || v > +el.max) return; S[k] = v; }
        else S[k] = el.value;
        if(k === 'd_prod'){ S.d_bottle = (DEWORMERS[S.d_prod] || {}).bottle || S.d_bottle; $('d_bottle').value = S.d_bottle; }
        if(k === 'r_nut'){ S.r_target = S.r_nut === 'cp' ? 10 : 55; $('r_target').value = S.r_target; }
        save(); renderAll();
      });
      if(isNum) el.addEventListener('blur', function(){ el.value = S[k]; });
    });
    document.querySelectorAll('.tool-tabs .seg-btn').forEach(function(b){ b.addEventListener('click', function(){ showTool(b.getAttribute('data-tool'), true); }); });
    var h = (location.hash || '').replace('#', '');
    showTool(RENDER[h] ? h : S.tool, false);
    window.addEventListener('hashchange', function(){ var t = (location.hash || '').replace('#', ''); if(RENDER[t]) showTool(t, false); });
    renderAll();
  }
  window.HerdTools = {water:water, pearson:pearson, dewormer:dewormer, gain:gain, spa:spa, DEWORMERS:DEWORMERS, state:function(){ return S; }};
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
