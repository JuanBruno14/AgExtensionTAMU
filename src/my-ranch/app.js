(function(){
  'use strict';

  /* ------------------------------------------------------------------ constants */
  var STORE_KEY = 'tamuDecisionAidsMyRanch.v1';
  var ACRE_M2 = 4046.8564224;
  var EARTH_R = 6371008.8;          // same mean radius turf.js uses for area
  var SDA_URL = 'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest';
  var DROUGHT_URL = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/US_Drought_Intensity_v1/FeatureServer/3/query';
  var GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
  var LIBS = {
    toGeoJSON: 'https://cdn.jsdelivr.net/npm/@tmcw/togeojson@5.8.1/dist/togeojson.umd.js',
    shp: 'https://cdn.jsdelivr.net/npm/shpjs@4.0.4/dist/shp.min.js',
    JSZip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
  };
  var COLORS = ['#f6c343','#4fd1c5','#f687b3','#90cdf4','#fbad6b','#9ae6b4','#fc8181','#b794f4','#e2e8a0','#76e4f7'];

  var TYPES = {
    range:      {label:'Native rangeland',                  grazed:true,  mode:'soil'},
    improved:   {label:'Improved pasture (bermuda, etc.)',   grazed:true,  mode:'manual'},
    smallgrain: {label:'Small grain / wheat pasture',       grazed:true,  mode:'manual'},
    hay:        {label:'Hay meadow',                        grazed:true,  mode:'manual'},
    other:      {label:'Not grazed (headquarters, crops)',  grazed:false, mode:'manual'}
  };
  var POINT_TYPES = {
    water:  {label:'Water',        icon:'💧'},
    pen:    {label:'Pens / corral',icon:'🐄'},
    gate:   {label:'Gate',         icon:'🚪'},
    feeder: {label:'Feeder',       icon:'🌾'},
    other:  {label:'Point',        icon:'📍'}
  };
  var DM_LABELS = [
    {code:'D0', name:'Abnormally dry',      color:'#ffff00'},
    {code:'D1', name:'Moderate drought',    color:'#fcd37f'},
    {code:'D2', name:'Severe drought',      color:'#ffaa00'},
    {code:'D3', name:'Extreme drought',     color:'#e60000'},
    {code:'D4', name:'Exceptional drought', color:'#730000'}
  ];
  /* AgriLife Extension 2026 D03 Budgets, sheet 'CowCalf' (Rolling Plains cow-calf), all per animal unit. */
  var D03 = {revenue:2189.26, variable:438.35, grossMargin:1750.91, fixed:500.34, netReturn:1250.58, acresPerAU:11.25, rentPerAcre:15};
  var DEFAULT_SETTINGS = {harvestEff:25, intakeLb:26, manualCap:null, maxGraze:30, mapColor:'name', cond:{poor:50, fair:75, excellent:90}, zoneF:{brush:25, bottom:200}};
  var CONDITIONS = {poor:'Poor', fair:'Fair', excellent:'Excellent'};
  var ZONE_TYPES = {
    water:  {label:'Pond / lake', icon:'💧', style:{color:'#bfe3ff', weight:1.5, fillColor:'#2b7fd6', fillOpacity:0.6}},
    brush:  {label:'Brush / woods', icon:'🌳', style:{color:'#d5f0c8', weight:1.5, dashArray:'4 3', fillColor:'#2f5d27', fillOpacity:0.55}},
    bottom: {label:'Bottomland', icon:'〰', style:{color:'#e6fff5', weight:1.5, fillColor:'#35c29a', fillOpacity:0.45}}
  };
  var DEFAULT_HERD = {cows:0, cowLb:1200, bulls:null, bullLb:1800, breed:'angus', milk:'moderate', bcs:5, activity:'rolling',
    calving:'us', start1:'02-15', len1:60, start2:'09-15', len2:60, share2:30, weanAge:205, wean1:'09-15', wean2:'04-15', weanLb:535,
    weanPeriod:45, postAdg:1.5, calvingRate:91, calfLoss:6.4, cowLoss:1.5, region:'auto',
    nws:'no', nwsLoss:2, nwsCost:15, hornFly:0, weatherAdj:'on', windMph:10, coat:1, heat:1, replRate:15, heiferPreg:85, bcsWean:0, seasonal:'off', supMode:'protein', calfShort:'creep', creepPrice:350, creepConv:8,
    hayTdn:55, hayCp:10, hayDm:88, hayPrice:200, mineralOz:4, mineralPrice:0.45, source:'cube20', supCp:20, supTdn:70, supPrice:392,
    supTrips:3, hayTrips:2, tripCost:25, distPerTon:0,
    dr:{cut:50, from:5, months:6, which:'all', earlyAge:150, feedAdg:2.0, sellPct:30, sellWhen:'start', hayPrice:null, recover:75, buyPrice:null, buyYear:1, otherCost:189, devCost:900, rate:7, later:0},
    sell:{rate:8, death:0.5}};

/*@@FEED@@*/
  /* ------------------------------------------------------------------ helpers */
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function fmt(n, d){ if(n == null || !isFinite(n)) return '—'; return n.toLocaleString('en-US', {minimumFractionDigits:d||0, maximumFractionDigits:d||0}); }
  function money(n){ if(n == null || !isFinite(n)) return '—'; var s = Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}); return (n < 0 ? '−$' : '$') + s; }
  function uid(){ return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function num(v){ var n = parseFloat(v); return isFinite(n) ? n : null; }
  function cowsPerBull(){
    try{ var mp = JSON.parse(localStorage.getItem('tamuDecisionAidsMarketPrices') || 'null'); var v = mp && +mp.mp_perBull; if(v > 0) return v; }catch(e){}
    return 25;
  }
  function bullCount(){ var h = state.herd; if(h.bulls != null && h.bulls >= 0) return h.bulls; return h.cows > 0 ? Math.max(1, Math.ceil(h.cows/cowsPerBull())) : 0; }
  /* Animal-unit equivalents by metabolic weight: AUE = (weight / 1,000 lb)^0.75 (NRC; NDSU Manske).
     1 AU = 1,000-lb cow with a calf up to 6 months, 26 lb of forage dry matter a day (NRCS). */
  function aue(lb){ return lb > 0 ? Math.pow(lb/1000, 0.75) : 0; }
  function herdAUParts(){
    var h = state.herd, cows = h.cows || 0, bulls = bullCount();
    var r = {cows:cows*aue(h.cowLb), bulls:bulls*aue(h.bullLb), calves:0, heifers:0, cowAue:aue(h.cowLb), bullAue:aue(h.bullLb)};
    if(cows > 0){
      try{
        // calves still on the ranch after 6 months of age (nursing or in the weaning period) count by their own weight
        var o = feedOptions(), cs = FEED.cohorts(o), co = FEED.calfOutcome(o, cs), days = 0;
        cs.forEach(function(c){
          var surv = o.calvingRate/100*(c.surv == null ? 1 : c.surv), extra = Math.max(0, c.weanAge - 183);
          var wMid = o.birthLb + co.preAdg*(183 + extra/2);
          var w2 = c.wWean + (o.postAdg || 0)*(o.weanPeriod || 0)/2;
          days += c.share*surv*(extra*aue(wMid) + (o.weanPeriod || 0)*aue(w2));
        });
        r.calves = cows*days/365;
        // replacement heifers from weaning to first calving
        var hd = 0;
        for(var d = 0; d < 365; d += 5) cs.forEach(function(c){ FEED.heiferAges(o, c, d).forEach(function(x){ hd += 5*x.n*aue(FEED.heiferState(o, x.age, c.weanAge, c.wWean).sbw/0.96*2.2046); }); });
        r.heifers = cows*hd/365;
      }catch(e){}
    }
    r.total = r.cows + r.bulls + r.calves + r.heifers;
    return r;
  }
  function herdAU(){ return herdAUParts().total; }
  /* cows (with their share of bulls, calves and replacement heifers) that a capacity in AU carries */
  function cowsAtCapacity(cap){
    var ap = herdAUParts(), perCalf = (ap.calves + ap.heifers)/Math.max(1, state.herd.cows || 1);
    return state.herd.bulls != null ? Math.max(0, (cap - ap.bulls)/(ap.cowAue + perCalf)) : cap/(ap.cowAue + perCalf + ap.bullAue/cowsPerBull());
  }

  /* Geodesic area — same algorithm as turf.js @turf/area (spherical excess, mean earth radius). */
  function ringArea(c){
    var n = c.length - 1; if(n <= 2) return 0;
    var t = 0, k = Math.PI / 180;
    for(var i = 0; i < n; i++){
      var lo = c[i], mi = c[i+1 === n ? 0 : i+1], up = c[i+2 >= n ? (i+2) % n : i+2];
      t += (up[0]*k - lo[0]*k) * Math.sin(mi[1]*k);
    }
    return t * EARTH_R * EARTH_R / 2;
  }
  function polygonAcres(geom){
    if(!geom || geom.type !== 'Polygon' || !geom.coordinates.length) return 0;
    var t = Math.abs(ringArea(geom.coordinates[0]));
    for(var i = 1; i < geom.coordinates.length; i++) t -= Math.abs(ringArea(geom.coordinates[i]));
    return t / ACRE_M2;
  }
  function centroid(geom){
    var r = geom.coordinates[0], n = r.length - 1, x = 0, y = 0;
    for(var i = 0; i < n; i++){ x += r[i][0]; y += r[i][1]; }
    return {lng: x/n, lat: y/n};
  }
  function milesBetween(a, b){
    var k = Math.PI/180, dLat = (b.lat-a.lat)*k, dLng = (b.lng-a.lng)*k;
    var h = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(a.lat*k)*Math.cos(b.lat*k)*Math.sin(dLng/2)*Math.sin(dLng/2);
    return 2 * 3958.7613 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function closeRing(ring){
    var a = ring[0], b = ring[ring.length-1];
    if(a[0] !== b[0] || a[1] !== b[1]) ring = ring.concat([a.slice()]);
    return ring;
  }
  function cleanPolygon(coords){
    return coords.map(function(r){ return closeRing(r.map(function(p){ return [+p[0], +p[1]]; })); })
                 .filter(function(r){ return r.length >= 4; });
  }

  /* ------------------------------------------------------------------ state */
  function blankState(){ return {v:1, name:'', pastures:[], points:[], zones:[], settings:Object.assign({}, DEFAULT_SETTINGS), herd:Object.assign({}, DEFAULT_HERD, {dr:Object.assign({}, DEFAULT_HERD.dr), sell:Object.assign({}, DEFAULT_HERD.sell)}), drought:null, view:null, summary:null, herdNow:null}; }
  function loadState(){
    try{
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if(s && s.v === 1){
        s.herd = Object.assign({}, DEFAULT_HERD, s.herd || {});
        if(s.settings && s.settings.herdAU > 0 && !(s.herd.cows > 0)) s.herd.cows = Math.round(s.settings.herdAU*1000/s.herd.cowLb);
        s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
        s.settings.cond = Object.assign({}, DEFAULT_SETTINGS.cond, s.settings.cond || {});
        s.settings.zoneF = Object.assign({}, DEFAULT_SETTINGS.zoneF, s.settings.zoneF || {});
        s.herd.dr = Object.assign({}, DEFAULT_HERD.dr, s.herd.dr || {});
        s.herd.sell = Object.assign({}, DEFAULT_HERD.sell, s.herd.sell || {});
        s.zones = (s.zones || []).filter(function(z){ return z && z.geometry && z.geometry.type === 'Polygon' && ZONE_TYPES[z.type]; });
        s.pastures.forEach(function(p){ if(!CONDITIONS[p.condition]) p.condition = 'fair'; });
        delete s.settings.herdAU;
        s.pastures = (s.pastures || []).filter(function(p){ return p && p.geometry && p.geometry.type === 'Polygon'; });
        s.points = s.points || [];
        s.pastures.forEach(function(p){ if(p.soil && p.soil.status === 'loading') p.soil = null; });
        if(s.drought && s.drought.status === 'loading') s.drought = null;
        return s;
      }
    }catch(e){}
    return blankState();
  }
  var state = loadState();
  var saveFailed = false;

  function getPasture(id){ for(var i = 0; i < state.pastures.length; i++) if(state.pastures[i].id === id) return state.pastures[i]; return null; }
  function pastureIndex(id){ for(var i = 0; i < state.pastures.length; i++) if(state.pastures[i].id === id) return i; return -1; }

  /* ------------------------------------------------------------------ forage math */
  function annualDemandLb(){ return state.settings.intakeLb * 365; }
  function isGrazed(p){ return !!(TYPES[p.type] && TYPES[p.type].grazed); }
  function condFactor(p){ return (state.settings.cond[p.condition || 'fair'] || 75)/100; }
  /* forage per acre (lb/ac/yr) for the open part of the pasture; soil-survey numbers are scaled by range condition */
  function forageLb(p){
    if(!isGrazed(p)) return null;
    if(p.mode === 'soil') return (p.soil && p.soil.status === 'ok') ? p.soil.normal*condFactor(p) : null;
    return (typeof p.manual === 'number' && p.manual > 0) ? p.manual : null;
  }
  /* acres of each zone type inside a pasture (clipped to the pasture outline) */
  var zoneCache = {};
  function zoneAcres(p){
    var key = p.id + '|' + JSON.stringify(p.geometry.coordinates).length + '|' + state.zones.map(function(z){ return z.id + z.type + JSON.stringify(z.geometry.coordinates).length; }).join(',');
    if(zoneCache[p.id] && zoneCache[p.id].key === key) return zoneCache[p.id].v;
    var v = {water:0, brush:0, bottom:0};
    state.zones.forEach(function(z){
      var ac = 0;
      if(window.polygonClipping){
        try{
          var inter = polygonClipping.intersection(p.geometry.coordinates, z.geometry.coordinates);
          inter.forEach(function(poly){ ac += polygonAcres({type:'Polygon', coordinates:poly}); });
        }catch(e){ ac = 0; }
      } else if(pointInRing(centroid(z.geometry), p.geometry.coordinates[0])) ac = polygonAcres(z.geometry);
      v[z.type] += Math.min(ac, p.acres);
    });
    var tot = v.water + v.brush + v.bottom;
    if(tot > p.acres){ var k = p.acres/tot; v.water *= k; v.brush *= k; v.bottom *= k; }
    zoneCache[p.id] = {key:key, v:v};
    return v;
  }
  function pointInRing(pt, ring){
    var inside = false;
    for(var i = 0, j = ring.length - 1; i < ring.length; j = i++){
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if(((yi > pt.lat) !== (yj > pt.lat)) && (pt.lng < (xj - xi)*(pt.lat - yi)/(yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  /* forage-weighted acres: open ground x1, brush and bottomland by their factors, ponds x0 */
  function forageAcres(p){
    var z = zoneAcres(p), f = state.settings.zoneF;
    return Math.max(0, p.acres - z.water - z.brush - z.bottom) + z.brush*f.brush/100 + z.bottom*f.bottom/100;
  }
  function grazeableAcres(p){ return Math.max(0, p.acres - zoneAcres(p).water); }
  function annualLb(p){ var lb = forageLb(p); return lb == null ? null : forageAcres(p)*lb; }
  function capacityAU(p){
    var lb = annualLb(p);
    if(lb == null || !(annualDemandLb() > 0)) return null;
    return lb * (state.settings.harvestEff/100) / annualDemandLb();
  }
  function lowCapacityAU(p){
    if(p.mode !== 'soil' || !p.soil || p.soil.status !== 'ok' || p.soil.low == null) return null;
    return forageAcres(p) * p.soil.low * condFactor(p) * (state.settings.harvestEff/100) / annualDemandLb();
  }
  function grazingDays(p, herd){
    var lb = annualLb(p);
    if(lb == null || !(herd > 0) || !(state.settings.intakeLb > 0)) return null;
    return lb * (state.settings.harvestEff/100) / (herd * state.settings.intakeLb);
  }
  function totals(){
    var t = {pastures:state.pastures.length, acres:0, grazedAcres:0, estAcres:0, cap:0, missing:0, soilCap:0, soilLow:0, lowAvailable:false, water:0};
    state.pastures.forEach(function(p){
      t.acres += p.acres;
      if(!isGrazed(p)) return;
      t.water += zoneAcres(p).water;
      t.grazedAcres += grazeableAcres(p);
      var c = capacityAU(p);
      if(c == null){ t.missing++; return; }
      t.estAcres += grazeableAcres(p); t.cap += c;
      var lo = lowCapacityAU(p);
      if(lo != null){ t.soilCap += c; t.soilLow += lo; t.lowAvailable = true; }
    });
    t.lowCap = t.lowAvailable ? (t.cap - t.soilCap + t.soilLow) : null;
    t.estCap = t.cap;
    var mc = state.settings.manualCap;
    t.manual = mc > 0;
    if(t.manual){
      if(t.lowCap != null && t.cap > 0) t.lowCap = t.lowCap*mc/t.cap;
      t.cap = mc; t.missing = 0;
      if(!(t.estAcres > 0)) t.estAcres = t.grazedAcres;
    }
    t.acresPerAU = t.cap > 0 && t.estAcres > 0 ? t.estAcres / t.cap : null;
    return t;
  }
  function ranchCenter(){
    if(!state.pastures.length) return null;
    var x = 0, y = 0, w = 0;
    state.pastures.forEach(function(p){ var c = centroid(p.geometry), a = Math.max(p.acres, 0.01); x += c.lng*a; y += c.lat*a; w += a; });
    return {lng:x/w, lat:y/w};
  }
  function nearestWaterMiles(p){
    var waters = state.points.filter(function(pt){ return pt.type === 'water'; })
      .concat(state.zones.filter(function(z){ return z.type === 'water'; }).map(function(z){ return centroid(z.geometry); }));
    if(!waters.length) return null;
    var c = centroid(p.geometry), best = Infinity;
    waters.forEach(function(w){ var d = milesBetween(c, {lat:w.lat, lng:w.lng}); if(d < best) best = d; });
    return best;
  }

  /* ------------------------------------------------------------------ persistence */
  function save(){
    var t = totals();
    state.summary = {pastures:t.pastures, acres:t.acres, capacityAU:t.cap, updated:Date.now()};
    if(map){ var c = map.getCenter(); state.view = {lat:c.lat, lng:c.lng, zoom:map.getZoom()}; }
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(state)); saveFailed = false; }
    catch(e){ saveFailed = true; }
    renderSaveStatus();
  }
  function renderSaveStatus(){
    var el = $('saveStatus'); if(!el) return;
    el.className = 'save-status' + (saveFailed ? ' bad' : '');
    el.innerHTML = '<span class="dot"></span>' + (saveFailed
      ? 'This browser is blocking storage (private window?). Download a file below so you don’t lose your map.'
      : 'Saved on this device');
  }

  /* ------------------------------------------------------------------ map */
  var map = null, pastureLayers = {}, pointLayers = {}, zoneLayers = {}, drawMode = null, editOn = false, selectedId = null;

  function pointIcon(type){
    var t = POINT_TYPES[type] || POINT_TYPES.other;
    return L.divIcon({className:'pt-icon-wrap', html:'<span class="pt-icon">' + t.icon + '</span>', iconSize:[28,28], iconAnchor:[14,14], popupAnchor:[0,-14]});
  }

  function initMap(){
    if(!window.L || !L.PM){
      $('map').innerHTML = '<div class="map-error">The map couldn’t load. Check your internet connection and reload the page — your saved pastures are still here.</div>';
      return false;
    }
    map = L.map('map', {zoomControl:true, maxZoom:19, tap:true});
    var imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom:19, attribution:'Imagery &copy; Esri, Maxar, Earthstar Geographics'
    });
    var streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    map.createPane('labels'); map.getPane('labels').style.zIndex = 450; map.getPane('labels').style.pointerEvents = 'none';
    var refs = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, pane:'labels'}),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, pane:'labels'})
    ]);
    imagery.addTo(map); refs.addTo(map);
    L.control.layers({'Satellite':imagery, 'Street map':streets}, {'Roads & place names':refs}, {position:'topright'}).addTo(map);
    L.control.scale({imperial:true, metric:false}).addTo(map);
    var ColorCtl = L.Control.extend({options:{position:'bottomright'}, onAdd:function(){
      var d = L.DomUtil.create('div', 'seg map-color leaflet-bar');
      d.setAttribute('role', 'group'); d.setAttribute('aria-label', 'Color pastures by');
      d.innerHTML = '<button type="button" data-mapcolor="name" aria-pressed="true">Pastures</button><button type="button" data-mapcolor="grass" aria-pressed="false" title="Where the herd is and how many days of grass each pasture has today">🌱 Grass today</button>';
      L.DomEvent.disableClickPropagation(d);
      d.querySelectorAll('button').forEach(function(b){ b.addEventListener('click', function(){ state.settings.mapColor = b.getAttribute('data-mapcolor'); updateMapGrass(); save(); }); });
      return d;
    }});
    new ColorCtl().addTo(map);

    map.pm.setGlobalOptions({
      snappable:true, snapDistance:14, allowSelfIntersection:false, continueDrawing:false,
      templineStyle:{color:'#ffffff', weight:2},
      hintlineStyle:{color:'#ffffff', dashArray:[5,5]},
      pathOptions:{color:'#ffffff', weight:2, fillColor:'#f6c343', fillOpacity:0.3}
    });

    map.on('pm:create', function(e){
      var layer = e.layer;
      if((e.shape === 'Polygon' || e.shape === 'Rectangle') && drawMode && drawMode.indexOf('zone:') === 0){
        var zg = layer.toGeoJSON().geometry;
        map.removeLayer(layer);
        addZone(drawMode.slice(5), zg);
      } else if(e.shape === 'Polygon' || e.shape === 'Rectangle'){
        var geom = layer.toGeoJSON().geometry;
        map.removeLayer(layer);
        addPasture(geom, null, true);
      } else if(e.shape === 'Marker'){
        var ll = layer.getLatLng();
        map.removeLayer(layer);
        addPoint(drawMode && drawMode.indexOf('point:') === 0 ? drawMode.slice(6) : 'other', ll.lat, ll.lng);
      }
      setDrawMode(null);
    });
    map.on('pm:drawstart', function(){ if(drawMode === 'pasture' || (drawMode && drawMode.indexOf('zone:') === 0)) $('hintActions').hidden = false; });
    map.on('moveend', function(){ if(state.pastures.length || state.view) save(); });

    if(state.pastures.length){
      state.pastures.forEach(function(p){ drawPastureLayer(p); });
      state.zones.forEach(function(z){ drawZoneLayer(z); });
      state.points.forEach(function(pt){ drawPointLayer(pt); });
      if(state.view) map.setView([state.view.lat, state.view.lng], state.view.zoom);
      else fitRanch();
    } else if(state.view){
      map.setView([state.view.lat, state.view.lng], state.view.zoom);
      state.points.forEach(function(pt){ drawPointLayer(pt); });
    } else {
      map.setView([31.2, -99.3], 6);   // Texas
      state.points.forEach(function(pt){ drawPointLayer(pt); });
    }
    setTimeout(function(){ map.invalidateSize(); }, 50);
    return true;
  }

  function fitRanch(){
    if(!map) return;
    var group = L.featureGroup(Object.keys(pastureLayers).map(function(k){ return pastureLayers[k]; }));
    if(group.getLayers().length) map.fitBounds(group.getBounds(), {padding:[30,30], maxZoom:17});
  }

  function colorFor(p){ return COLORS[pastureIndex(p.id) % COLORS.length]; }
  var grassMap = null;   // pasture id -> {cls, label} when the map shows "Grass today"
  function fillFor(p){
    if(state.settings.mapColor !== 'grass') return colorFor(p);
    var g = grassMap && grassMap[p.id];
    return GRASS_COLORS[g ? g.cls : 'none'];
  }
  function labelText(p){
    if(state.settings.mapColor === 'grass'){
      var g = grassMap && grassMap[p.id];
      return g ? g.label : esc(p.name) + (isGrazed(p) ? ' · no forage estimate' : ' · not grazed');
    }
    return esc(p.name) + ' · ' + fmt(p.acres, p.acres < 10 ? 1 : 0) + ' ac';
  }
  var herdMarker = null;
  function updateMapGrass(){
    grassMap = null;
    var t = null;
    if(state.settings.mapColor === 'grass'){ try{ t = grassToday(); }catch(e){ t = null; } }
    if(t){
      grassMap = {};
      t.list.forEach(function(r){
        var h = t.herd, lbl;
        if(r.herdHere) lbl = '🐄 ' + esc(r.x.p.name) + '<span class="lbl-sub">day ' + fmt(h.daysIn + 1) + (h.fed ? ' · feeding hay' : h.left > 0 ? ' · move ~' + shortDate(h.moveBy) : ' · move now') + '</span>';
        else lbl = esc(r.x.p.name) + '<span class="lbl-sub">' + fmt(r.days) + ' d grass' + (r.rest != null ? ' · rested ' + fmt(r.rest) + ' d' : '') + '</span>';
        grassMap[r.x.p.id] = {cls:grassClass(r), label:lbl};
      });
    }
    state.pastures.forEach(function(p){ var l = pastureLayers[p.id]; if(l){ l.setStyle({fillColor:fillFor(p)}); l.setTooltipContent(labelText(p)); } });
    if(map){
      if(herdMarker){ map.removeLayer(herdMarker); herdMarker = null; }
      if(t && t.herd){
        var c = centroid(t.herd.p.geometry);
        herdMarker = L.marker([c.lat, c.lng], {icon:L.divIcon({className:'pt-icon-wrap', html:'<span class="pt-icon herd-icon">🐄</span>', iconSize:[34,34], iconAnchor:[17,40]}), interactive:false, keyboard:false}).addTo(map);
      }
    }
    var lg = $('grassLegend');
    if(lg){
      lg.hidden = state.settings.mapColor !== 'grass';
      lg.innerHTML = t ? '<span><i style="background:' + GRASS_COLORS.herd + '"></i>Herd here</span><span><i style="background:' + GRASS_COLORS.good + '"></i>3+ weeks of grass</span><span><i style="background:' + GRASS_COLORS.mid + '"></i>1–3 weeks</span><span><i style="background:' + GRASS_COLORS.low + '"></i>Under a week</span><span class="lg-note">for the whole herd, today · <a href="#herdNow">details</a></span>'
                       : '<span class="lg-note">Draw grazed pastures with a forage estimate and enter your number of cows to see grass today.</span>';
    }
    document.querySelectorAll('[data-mapcolor]').forEach(function(b){ var on = b.getAttribute('data-mapcolor') === (state.settings.mapColor || 'name'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }

  function drawPastureLayer(p){
    if(!map) return;
    if(pastureLayers[p.id]){ map.removeLayer(pastureLayers[p.id]); }
    var latlngs = p.geometry.coordinates.map(function(r){ return r.slice(0, -1).map(function(c){ return [c[1], c[0]]; }); });
    var layer = L.polygon(latlngs, {color:'#ffffff', weight:2, fillColor:fillFor(p), fillOpacity:0.35});
    layer._ranchId = p.id;
    layer.bindTooltip(labelText(p), {permanent:true, direction:'center', className:'pasture-label', interactive:false});
    layer.on('click', function(){ if(!drawMode) selectPasture(p.id, true); });
    layer.on('pm:edit', function(){ onPastureEdited(p.id); });
    layer.addTo(map);
    if(editOn && layer.pm) layer.pm.enable({allowSelfIntersection:false, snappable:true});
    pastureLayers[p.id] = layer;
    styleSelection();
  }
  function recolorLayers(){
    state.pastures.forEach(function(p){ var l = pastureLayers[p.id]; if(l) l.setStyle({fillColor:fillFor(p)}); });
  }
  function styleSelection(){
    Object.keys(pastureLayers).forEach(function(id){
      var sel = id === selectedId;
      pastureLayers[id].setStyle({weight: sel ? 4 : 2, color: sel ? '#ffe28a' : '#ffffff', fillOpacity: sel ? 0.45 : 0.35});
    });
  }

  function drawPointLayer(pt){
    if(!map) return;
    if(pointLayers[pt.id]) map.removeLayer(pointLayers[pt.id]);
    var m = L.marker([pt.lat, pt.lng], {icon:pointIcon(pt.type), draggable:true, title:(POINT_TYPES[pt.type]||POINT_TYPES.other).label});
    m.on('dragend', function(){ var ll = m.getLatLng(); pt.lat = ll.lat; pt.lng = ll.lng; renderAll(false); });
    m.on('pm:edit', function(){ var ll = m.getLatLng(); pt.lat = ll.lat; pt.lng = ll.lng; renderAll(false); });
    m.bindPopup(function(){
      var t = POINT_TYPES[pt.type] || POINT_TYPES.other;
      return '<strong>' + t.icon + ' ' + esc(pt.name || t.label) + '</strong><div class="popup-actions"><button type="button" data-del-point="' + pt.id + '">Delete</button></div>';
    });
    m.addTo(map);
    pointLayers[pt.id] = m;
  }

  function onPastureEdited(id){
    var p = getPasture(id), layer = pastureLayers[id];
    if(!p || !layer) return;
    var g = layer.toGeoJSON().geometry;
    if(g.type !== 'Polygon') return;
    p.geometry = {type:'Polygon', coordinates:cleanPolygon(g.coordinates)};
    p.acres = polygonAcres(p.geometry); zoneCache = {};
    layer.setTooltipContent(labelText(p));
    if(p.mode === 'soil' && isGrazed(p)) scheduleSoil(p.id, 900);
    renderAll(true);
    refreshDroughtIfMoved();
  }

  /* ------------------------------------------------------------------ drawing modes */
  function setDrawMode(mode){
    if(!map) return;
    if(map.pm.globalDrawModeEnabled && map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
    if(mode && editOn) toggleEdit(false);
    drawMode = mode;
    document.querySelectorAll('.draw-tools .tool-btn').forEach(function(b){ b.classList.remove('active'); });
    $('hintActions').hidden = true;
    $('undoPointBtn').hidden = false; $('finishBtn').hidden = false;
    if(mode === 'pasture'){
      $('drawPastureBtn').classList.add('active');
      map.pm.enableDraw('Polygon', {snappable:true, finishOn:null});
      setHint('<strong>Drawing a pasture:</strong> click (or tap) each corner along the fence. Click the first corner again, or press <strong>Finish</strong>, to close it.');
      $('hintActions').hidden = false;
    } else if(mode === 'rect'){
      $('drawRectBtn').classList.add('active');
      map.pm.enableDraw('Rectangle', {snappable:true});
      setHint('<strong>Drawing a rectangle:</strong> click one corner, then the opposite corner.');
      $('hintActions').hidden = false; $('undoPointBtn').hidden = true; $('finishBtn').hidden = true;
    } else if(mode && mode.indexOf('zone:') === 0){
      var zt = mode.slice(5), zb = document.querySelector('[data-zone="' + zt + '"]'); if(zb) zb.classList.add('active');
      map.pm.enableDraw('Polygon', {snappable:true, finishOn:null, pathOptions:ZONE_TYPES[zt].style, templineStyle:{color:ZONE_TYPES[zt].style.fillColor, weight:2}});
      setHint('<strong>Drawing ' + esc(ZONE_TYPES[zt].label.toLowerCase()) + ':</strong> click around its edge inside the pasture, then close it or press <strong>Finish</strong>. ' +
        (zt === 'water' ? 'Ponds and lakes are taken out of the grazing area.' : zt === 'brush' ? 'Brush counts at ' + state.settings.zoneF.brush + '% of the pasture’s forage.' : 'Bottomland counts at ' + state.settings.zoneF.bottom + '% of the pasture’s forage.'));
      $('hintActions').hidden = false;
    } else if(mode && mode.indexOf('point:') === 0){
      var t = mode.slice(6);
      var btn = document.querySelector('[data-point="' + t + '"]'); if(btn) btn.classList.add('active');
      map.pm.enableDraw('Marker', {markerStyle:{icon:pointIcon(t)}, snappable:false});
      setHint('<strong>Place ' + esc(POINT_TYPES[t].label.toLowerCase()) + ':</strong> click on the map where it goes.');
      $('hintActions').hidden = false; $('undoPointBtn').hidden = true; $('finishBtn').hidden = true;
    } else {
      setDefaultHint();
    }
  }
  function setHint(html){ $('mapHintText').innerHTML = html; }
  function setDefaultHint(){
    if(editOn){ setHint('<strong>Editing:</strong> drag the white corner handles to follow your fence lines; drag the middle handles to add a corner. Press <strong>Done editing</strong> when finished.'); return; }
    if(!state.pastures.length) setHint('<strong>Start here:</strong> search for your ranch or use <strong>My location</strong>, zoom in until you can see your fences, then press <strong>Draw pasture</strong>.');
    else setHint('Click a pasture on the map to find it in the list. Use <strong>Edit shapes</strong> to adjust a fence line, or <strong>Draw pasture</strong> to add another.');
  }
  function toggleEdit(on){
    if(!map) return;
    editOn = (on === undefined) ? !editOn : on;
    if(editOn && drawMode) setDrawMode(null);
    Object.keys(pastureLayers).concat(Object.keys(zoneLayers)).forEach(function(id){ var l = pastureLayers[id] || zoneLayers[id]; if(l && l.pm){ editOn ? l.pm.enable({allowSelfIntersection:false, snappable:true}) : l.pm.disable(); } });
    $('editBtn').classList.toggle('active', editOn);
    $('editBtn').textContent = editOn ? '✓ Done editing' : '↔ Edit shapes';
    setDefaultHint();
  }

  /* ------------------------------------------------------------------ zones (pond, brush, bottomland) */
  function zoneLabel(z){ var t = ZONE_TYPES[z.type]; return t.icon + ' ' + t.label + ' · ' + fmt(polygonAcres(z.geometry), polygonAcres(z.geometry) < 10 ? 1 : 0) + ' ac'; }
  function drawZoneLayer(z){
    if(!map) return;
    if(zoneLayers[z.id]) map.removeLayer(zoneLayers[z.id]);
    var latlngs = z.geometry.coordinates.map(function(r){ return r.slice(0, -1).map(function(c){ return [c[1], c[0]]; }); });
    var layer = L.polygon(latlngs, ZONE_TYPES[z.type].style);
    layer.bindTooltip(zoneLabel(z), {sticky:true, className:'pasture-label'});
    layer.on('pm:edit', function(){
      var g = layer.toGeoJSON().geometry; if(g.type !== 'Polygon') return;
      z.geometry = {type:'Polygon', coordinates:cleanPolygon(g.coordinates)};
      layer.setTooltipContent(zoneLabel(z)); zoneCache = {};
      renderAll(true);
    });
    layer.addTo(map);
    if(editOn && layer.pm) layer.pm.enable({allowSelfIntersection:false, snappable:true});
    zoneLayers[z.id] = layer;
  }
  function addZone(type, geom){
    var coords = cleanPolygon(geom.coordinates || []);
    if(!coords.length || !ZONE_TYPES[type]) return null;
    var z = {id:uid(), type:type, geometry:{type:'Polygon', coordinates:coords}};
    if(!(polygonAcres(z.geometry) > 0)) return null;
    state.zones.push(z); zoneCache = {};
    drawZoneLayer(z);
    renderAll(true);
    return z;
  }
  function removeZone(id){
    state.zones = state.zones.filter(function(z){ return z.id !== id; });
    if(zoneLayers[id]){ map && map.removeLayer(zoneLayers[id]); delete zoneLayers[id]; }
    zoneCache = {};
    renderAll(true);
  }

  /* ------------------------------------------------------------------ add / remove */
  function addPasture(geom, props, fromDraw){
    var coords = cleanPolygon(geom.coordinates);
    if(!coords.length) return null;
    var g = {type:'Polygon', coordinates:coords};
    props = props || {};
    var type = TYPES[props.type] ? props.type : 'range';
    var p = {
      id: uid(),
      name: (props.name || ('Pasture ' + (state.pastures.length + 1))).toString().slice(0, 60),
      type: type,
      mode: props.mode || TYPES[type].mode,
      manual: (typeof props.manual === 'number') ? props.manual : null,
      condition: CONDITIONS[props.condition] ? props.condition : 'fair',
      measured: props.measured || null,
      geometry: g,
      acres: polygonAcres(g),
      soil: null
    };
    state.pastures.push(p);
    drawPastureLayer(p);
    if(p.mode === 'soil' && isGrazed(p)) scheduleSoil(p.id, 0);
    if(fromDraw){ selectedId = p.id; styleSelection(); }
    renderAll(true);
    refreshDroughtIfMoved();
    if(fromDraw) setTimeout(function(){ offerZoneFor(p); }, 0);
    if(fromDraw){
      setTimeout(function(){
        var row = document.querySelector('.pasture-row[data-id="' + p.id + '"] .p-name');
        if(row){ row.focus(); row.select(); }
      }, 60);
    }
    return p;
  }
  /* acres of pasture p that lie inside other pastures */
  function overlaps(p){
    var out = [];
    if(!window.polygonClipping) return out;
    state.pastures.forEach(function(q){
      if(q.id === p.id) return;
      var ac = 0;
      try{ polygonClipping.intersection(p.geometry.coordinates, q.geometry.coordinates).forEach(function(poly){ ac += polygonAcres({type:'Polygon', coordinates:poly}); }); }catch(e){}
      if(ac > 0.05) out.push({p:q, ac:ac});
    });
    return out;
  }
  /* A shape drawn with "Draw pasture" inside another pasture is usually a pond, brush or a low spot:
     offer to turn it into one so it isn't counted as extra grass. */
  function offerZoneFor(p){
    var ov = overlaps(p).sort(function(a, b){ return b.ac - a.ac; })[0];
    if(!ov || ov.ac < 0.5*p.acres) return;
    var el = $('zoneOffer'); el.hidden = false;
    el.innerHTML = ('<strong>“' + esc(p.name) + '” is inside “' + esc(ov.p.name) + '”.</strong> As a pasture its acres would be counted twice. What is it? ' +
      '<button type="button" class="tool-btn small" data-to-zone="water" data-pid="' + p.id + '">💧 Pond/lake</button> ' +
      '<button type="button" class="tool-btn small" data-to-zone="brush" data-pid="' + p.id + '">🌳 Brush</button> ' +
      '<button type="button" class="tool-btn small" data-to-zone="bottom" data-pid="' + p.id + '">〰 Bottomland</button> ' +
      '<button type="button" class="tool-btn small" data-to-zone="keep" data-pid="' + p.id + '">Keep as pasture</button>');
    el.scrollIntoView({block:'nearest'});
  }
  function pastureToZone(id, type){
    var i = pastureIndex(id); if(i < 0) return;
    var p = state.pastures[i];
    state.pastures.splice(i, 1);
    if(pastureLayers[id]){ map && map.removeLayer(pastureLayers[id]); delete pastureLayers[id]; }
    if(selectedId === id) selectedId = null;
    recolorLayers();
    $('zoneOffer').hidden = true;
    addZone(type, p.geometry);
  }
  function removePasture(id){
    var i = pastureIndex(id); if(i < 0) return;
    var p = state.pastures[i];
    if(!confirm('Delete “' + p.name + '”? This can’t be undone.')) return;
    state.pastures.splice(i, 1);
    if(pastureLayers[id]){ map && map.removeLayer(pastureLayers[id]); delete pastureLayers[id]; }
    if(selectedId === id) selectedId = null;
    recolorLayers();
    renderAll(true);
  }
  function addPoint(type, lat, lng, name){
    var pt = {id:uid(), type:POINT_TYPES[type] ? type : 'other', lat:lat, lng:lng, name:name || ''};
    state.points.push(pt);
    drawPointLayer(pt);
    renderAll(false);
    return pt;
  }
  function removePoint(id){
    state.points = state.points.filter(function(p){ return p.id !== id; });
    if(pointLayers[id]){ map && map.removeLayer(pointLayers[id]); delete pointLayers[id]; }
    renderAll(false);
  }
  function movePasture(id, dir){
    var i = pastureIndex(id), j = i + dir;
    if(i < 0 || j < 0 || j >= state.pastures.length) return;
    var tmp = state.pastures[i]; state.pastures[i] = state.pastures[j]; state.pastures[j] = tmp;
    recolorLayers();
    renderAll(true);
  }
  function selectPasture(id, scroll){
    selectedId = id; styleSelection();
    document.querySelectorAll('.pasture-row').forEach(function(r){ r.classList.toggle('selected', r.getAttribute('data-id') === id); });
    if(scroll){
      var row = document.querySelector('.pasture-row[data-id="' + id + '"]');
      if(row) row.scrollIntoView({behavior:'smooth', block:'center'});
    }
  }
  function zoomTo(id){
    var l = pastureLayers[id]; if(!l || !map) return;
    selectPasture(id, false);
    map.fitBounds(l.getBounds(), {padding:[40,40], maxZoom:17});
    $('map').scrollIntoView({behavior:'smooth', block:'center'});
  }

  /* ------------------------------------------------------------------ soil survey */
  var soilTimers = {}, soilQueue = [], soilBusy = false;

  function toWkt(geom){
    return 'POLYGON(' + geom.coordinates.map(function(r){
      return '(' + r.map(function(c){ return c[0].toFixed(7) + ' ' + c[1].toFixed(7); }).join(', ') + ')';
    }).join(', ') + ')';
  }
  function soilQuery(geom){
    return [
      '~DeclareGeometry(@aoi)~',
      "select @aoi = geometry::STPolyFromText('" + toWkt(geom) + "', 4326)",
      '~DeclareIdGeomTable(@clipped)~',
      '~GetClippedMapunits(@aoi,polygon,geo,@clipped)~',
      '~DeclareIdGeogTable(@clippedGeog)~',
      '~GetGeogFromGeomWgs84(@clipped,@clippedGeog)~',
      'select id as mukey, sum(geog.STArea()) as area_m2 into #aoiarea from @clippedGeog group by id;',
      'select a.mukey, a.area_m2, mu.muname, c.cokey, c.compname, c.comppct_r, c.rsprod_l, c.rsprod_r, c.rsprod_h,',
      "(select top 1 e.ecoclassid from coecoclass e where e.cokey = c.cokey order by case when e.ecoclasstypename like 'NRCS Rangeland%' then 0 else 1 end, e.ecoclassid) as ecoclassid,",
      "(select top 1 e.ecoclassname from coecoclass e where e.cokey = c.cokey order by case when e.ecoclasstypename like 'NRCS Rangeland%' then 0 else 1 end, e.ecoclassid) as ecoclassname",
      'from #aoiarea a inner join mapunit mu on mu.mukey = a.mukey',
      'left join component c on c.mukey = a.mukey',
      'order by a.area_m2 desc, c.comppct_r desc'
    ].join('\n');
  }
  /* Turns SDA rows into an area- and component-weighted production estimate. Exposed for testing. */
  function summarizeSoil(table){
    if(!table || table.length < 2) return {status:'nodata', soils:[], coverage:0};
    var head = table[0].map(function(h){ return String(h).toLowerCase(); });
    var ix = function(n){ return head.indexOf(n); };
    var mus = {}, order = [];
    for(var r = 1; r < table.length; r++){
      var row = table[r], mukey = row[ix('mukey')];
      if(!mus[mukey]){ mus[mukey] = {mukey:mukey, name:row[ix('muname')] || 'Unnamed soil', area:num(row[ix('area_m2')]) || 0, comps:[]}; order.push(mukey); }
      if(row[ix('cokey')] != null) mus[mukey].comps.push({
        pct: num(row[ix('comppct_r')]) || 0,
        l: num(row[ix('rsprod_l')]), r: num(row[ix('rsprod_r')]), h: num(row[ix('rsprod_h')]),
        eco: ix('ecoclassid') >= 0 ? row[ix('ecoclassid')] : null, ecoName: ix('ecoclassname') >= 0 ? row[ix('ecoclassname')] : null
      });
    }
    var total = 0; order.forEach(function(k){ total += mus[k].area; });
    if(!(total > 0)) return {status:'nodata', soils:[], coverage:0};
    var wData = 0, sR = 0, sL = 0, sH = 0, mlraW = {};
    var soils = order.map(function(k){
      var mu = mus[k], mw = 0, mr = 0, site = null, sitePct = 0;
      mu.comps.forEach(function(c){
        var mm = c.eco && String(c.eco).match(/^[RF](\d{3}[A-Z]?)/);
        if(mm){ mlraW[mm[1]] = (mlraW[mm[1]] || 0) + mu.area * c.pct / 100; }
        if(c.ecoName && c.pct > sitePct){ site = c.ecoName; sitePct = c.pct; }
        if(c.r == null || !(c.pct > 0)) return;
        var w = mu.area * c.pct / 100;
        wData += w; sR += w * c.r;
        sL += w * (c.l != null ? c.l : c.r);
        sH += w * (c.h != null ? c.h : c.r);
        mw += c.pct; mr += c.pct * c.r;
      });
      return {name:mu.name, share:mu.area/total, prod: mw > 0 ? mr/mw : null, site:site};
    });
    var mlra = null, best = 0; Object.keys(mlraW).forEach(function(k){ if(mlraW[k] > best){ best = mlraW[k]; mlra = k; } });
    if(!(wData > 0)) return {status:'nodata', soils:soils, coverage:0, mlra:mlra, at:Date.now()};
    return {status:'ok', normal:sR/wData, low:sL/wData, high:sH/wData, coverage:wData/total, soils:soils, mlra:mlra, at:Date.now()};
  }
  function fetchSoil(geom){
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function(){ if(ctrl) ctrl.abort(); }, 45000);
    return fetch(SDA_URL, {
      method:'POST',
      /* form-encoded (like NRCS's own soilDB client) keeps this a "simple" CORS request, so no preflight */
      body:new URLSearchParams({query:soilQuery(geom), format:'JSON+COLUMNNAME'}),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function(res){
      clearTimeout(timer);
      if(!res.ok) return res.text().then(function(t){ throw new Error('The soil survey service answered with an error (' + res.status + ').'); });
      return res.text();
    }).then(function(txt){
      if(!txt || !txt.trim()) return summarizeSoil(null);
      var j = JSON.parse(txt);
      return summarizeSoil(j.Table || null);
    }, function(err){
      clearTimeout(timer);
      throw (err && err.name === 'AbortError') ? new Error('The soil survey took too long to answer.') : err;
    });
  }
  function scheduleSoil(id, delay){
    clearTimeout(soilTimers[id]);
    var p = getPasture(id); if(p){ p.soil = {status:'loading'}; }
    soilTimers[id] = setTimeout(function(){
      if(soilQueue.indexOf(id) < 0) soilQueue.push(id);
      pumpSoil();
    }, delay || 0);
  }
  function pumpSoil(){
    if(soilBusy) return;
    var id = soilQueue.shift(); if(!id) return;
    var p = getPasture(id);
    if(!p || p.mode !== 'soil' || !isGrazed(p)){ pumpSoil(); return; }
    soilBusy = true;
    var sent = JSON.stringify(p.geometry);
    fetchSoil(p.geometry).then(function(res){
      var cur = getPasture(id);
      if(cur && JSON.stringify(cur.geometry) === sent) cur.soil = res;
    }).catch(function(err){
      var cur = getPasture(id);
      if(cur && JSON.stringify(cur.geometry) === sent){
        var msg = (err && err.message && !/Failed to fetch|NetworkError|Load failed/i.test(err.message)) ? err.message : 'Couldn’t reach the USDA soil survey.';
        cur.soil = {status:'error', message:msg};
      }
    }).then(function(){
      soilBusy = false;
      renderAll(true);
      pumpSoil();
    });
    renderPastures();
  }

  /* ------------------------------------------------------------------ drought monitor */
  var droughtBusy = false;
  function inUSDM(c){ return c && c.lat > 17 && c.lat < 72 && c.lng > -180 && c.lng < -64; }
  function refreshDroughtIfMoved(force){
    var c = ranchCenter();
    if(!c){ return; }
    var d = state.drought;
    var fresh = d && d.at && (Date.now() - d.at < 12*3600*1000);
    var near = d && d.lat != null && milesBetween(c, {lat:d.lat, lng:d.lng}) < 3;
    if(!force && fresh && near && (d.status === 'ok' || d.status === 'outside')) return;
    if(!inUSDM(c)){ state.drought = {status:'outside', lat:c.lat, lng:c.lng, at:Date.now()}; renderSummary(); save(); return; }
    if(droughtBusy) return;
    droughtBusy = true;
    state.drought = Object.assign({}, d || {}, {status:'loading'});
    renderSummary();
    var params = 'geometry=' + encodeURIComponent(c.lng.toFixed(5) + ',' + c.lat.toFixed(5)) +
      '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=dm,ddate&returnGeometry=false&f=json';
    fetch(DROUGHT_URL + '?' + params).then(function(r){ return r.json(); }).then(function(j){
      if(j.error) throw new Error('drought service error');
      var dm = -1, date = null;
      (j.features || []).forEach(function(f){
        var a = f.attributes || {};
        if(typeof a.dm === 'number' && a.dm > dm) dm = a.dm;
        if(a.ddate) date = a.ddate;
      });
      state.drought = {status:'ok', dm:dm, date:date, lat:c.lat, lng:c.lng, at:Date.now()};
    }).catch(function(){
      state.drought = {status:'error', lat:c.lat, lng:c.lng, at:Date.now()};
    }).then(function(){
      droughtBusy = false; renderSummary(); renderBudget(); updateStrip(); if(typeof renderDroughtMonitor === 'function') renderDroughtMonitor(); save();
    });
  }
  function droughtHtml(){
    var d = state.drought;
    var link = ' <a href="https://droughtmonitor.unl.edu/" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent);">Drought Monitor ↗</a>';
    if(!state.pastures.length) return '';
    if(!d || d.status === 'loading') return '<span class="drought-badge" style="background:var(--surface-sunken);"><span class="spinner"></span> Checking drought status…</span>';
    if(d.status === 'outside') return '<span class="tag">Drought Monitor covers the U.S. only</span>';
    if(d.status === 'error') return '<span class="tag warn">Couldn’t reach the Drought Monitor</span> <button type="button" class="tool-btn small" id="droughtRetry">Try again</button>';
    var when = d.date ? ' · week of ' + new Date(d.date).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'}) : '';
    if(d.dm < 0) return '<span class="drought-badge" style="background:var(--good-100);color:var(--good-700);"><span class="dot" style="background:var(--good-700);"></span>No drought mapped' + when + '</span>' + link;
    var L0 = DM_LABELS[Math.min(d.dm, 4)];
    var bad = d.dm >= 2;
    return '<span class="drought-badge" style="background:' + (bad ? 'var(--critical-100)' : 'var(--wheat-100)') + ';color:' + (bad ? 'var(--critical-700)' : 'var(--ink)') + ';"><span class="dot" style="background:' + L0.color + ';"></span>' + L0.code + ' · ' + L0.name + when + '</span>' + link;
  }

  /* ------------------------------------------------------------------ rendering */
  function renderAll(listChanged){
    if(listChanged) renderPastures(); else updatePastureNumbers();
    renderZones();
    renderPoints();
    renderSummary();
    renderRotation();
    renderBudget();
    renderFeed();
    try{ updateMapGrass(); }catch(e){}
    try{ renderHerdNote(); }catch(e){}
    updateStrip();
    if(!drawMode) setDefaultHint();
    save();
  }

  function soilBlock(p){
    if(!isGrazed(p)) return '<div class="p-soil">Not counted toward grazing capacity.</div>';
    if(p.mode !== 'soil') return '';
    var s = p.soil;
    if(!s || s.status === 'loading') return '<div class="p-soil"><span class="spinner"></span> Looking up the soil survey for this pasture…</div>';
    if(s.status === 'error') return '<div class="p-soil"><span class="tag bad">Soil lookup failed</span> ' + esc(s.message || '') + ' You can try again, or switch to “My estimate”.</div>';
    if(s.status === 'nodata') return '<div class="p-soil"><span class="tag warn">No range forage data</span> The soil survey has no rangeland production estimate for these soils — common for cropland and improved pasture. Switch to “My estimate” and enter what this pasture grows.</div>';
    var rows = s.soils.slice(0, 5).map(function(x){
      return '<tr><td>' + esc(x.name) + (x.site ? '<div style="font-size:11px;color:var(--ink-muted);">' + esc(x.site) + '</div>' : '') + '</td><td class="num">' + fmt(x.share*100) + '%</td><td class="num">' + (x.prod != null ? fmt(x.prod) + ' lb' : '—') + '</td></tr>';
    }).join('');
    var more = s.soils.length > 5 ? '<tr><td colspan="3" style="color:var(--ink-muted);">+ ' + (s.soils.length - 5) + ' more soil' + (s.soils.length - 5 > 1 ? 's' : '') + '</td></tr>' : '';
    var cov = s.coverage < 0.8 ? '<div style="margin-top:6px;"><span class="tag warn">Partial data</span> Only ' + fmt(s.coverage*100) + '% of this pasture has a soil-survey forage estimate; the average is applied to the whole pasture.</div>' : '';
    var cf = condFactor(p);
    return '<div class="p-soil">Soil survey: <strong>' + fmt(s.normal) + ' lb/ac</strong> in a normal year (' + fmt(s.low) + ' unfavorable · ' + fmt(s.high) + ' favorable) for the site in top condition. At ' + CONDITIONS[p.condition || 'fair'].toLowerCase() + ' condition this tool uses <strong>' + fmt(s.normal*cf) + ' lb/ac</strong>.' + cov +
      '<div class="table-scroll"><table><thead><tr><th>Soil</th><th class="num">Of pasture</th><th class="num">Normal year</th></tr></thead><tbody>' + rows + more + '</tbody></table></div></div>';
  }

  function capBlock(p){
    var c = capacityAU(p);
    if(!isGrazed(p)) return '<div class="big">—</div><div class="sub">not grazed</div>';
    if(c == null) return '<div class="big">—</div><div class="sub">' + (p.mode === 'soil' ? 'waiting on forage' : 'enter a forage estimate') + '</div>';
    return '<div class="big">' + fmt(c, c < 10 ? 1 : 0) + ' AU</div><div class="sub">' + fmt(grazeableAcres(p) / c, 1) + ' ac per AU · yearlong</div>';
  }
  function zoneLine(p){
    var z = zoneAcres(p), f = state.settings.zoneF, parts = [];
    if(z.water > 0.05) parts.push('💧 ' + fmt(z.water, z.water < 10 ? 1 : 0) + ' ac pond/lake (not grazed)');
    if(z.brush > 0.05) parts.push('🌳 ' + fmt(z.brush, z.brush < 10 ? 1 : 0) + ' ac brush (' + f.brush + '% forage)');
    if(z.bottom > 0.05) parts.push('〰 ' + fmt(z.bottom, z.bottom < 10 ? 1 : 0) + ' ac bottomland (' + f.bottom + '% forage)');
    var ov = overlaps(p).map(function(o){ return fmt(o.ac, o.ac < 10 ? 1 : 0) + ' ac with “' + esc(o.p.name) + '”'; });
    return (parts.length ? '<div class="p-zones">Inside this pasture: ' + parts.join(' · ') + '</div>' : '') +
      (ov.length ? '<div class="p-zones p-overlap">⚠ Overlaps ' + ov.join(', ') + ' — those acres are counted twice. If it’s a pond, brush or bottomland, delete it and draw it with 💧 🌳 〰 instead.</div>' : '');
  }
  var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function measureBlock(p){
    if(!isGrazed(p)) return '';
    var m = p.measured || {}, mon = m.month != null ? m.month : new Date().getMonth();
    return '<details class="p-measure"' + (m.lbAc > 0 ? ' open' : '') + '><summary>Measured forage' + (m.lbAc > 0 ? ': ' + fmt(m.lbAc) + ' lb/ac in ' + MONTH_NAMES[mon] : ' (optional)') + '</summary>' +
      '<div class="p-measure-body"><div class="input-wrap has-suffix"><input type="number" class="p-meas" min="0" max="15000" step="50" inputmode="decimal" placeholder="e.g. 1500" value="' + (m.lbAc > 0 ? m.lbAc : '') + '" aria-label="Measured standing forage"><span class="suffix">lb/ac</span></div>' +
      '<select class="p-measMonth" aria-label="Month measured">' + MONTH_NAMES.map(function(n, i){ return '<option value="' + i + '"' + (i === mon ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' +
      '<p class="card-note" style="margin:6px 0 0;">Clip everything inside a 9.6 sq ft frame (2.4 × 4 ft) at ground level in several typical spots, dry it and weigh it: average grams × 10 = lb per acre. The feed calendar then starts that month from what’s really standing, instead of the soil-survey estimate.</p></div></details>';
  }
  function condSelect(p){
    if(!isGrazed(p) || p.mode !== 'soil') return '';
    var c = state.settings.cond;
    return '<div class="p-cond"><label>Range condition</label><select class="p-condition">' + Object.keys(CONDITIONS).map(function(k){
      return '<option value="' + k + '"' + ((p.condition || 'fair') === k ? ' selected' : '') + '>' + CONDITIONS[k] + ' condition (' + c[k] + '%)</option>'; }).join('') + '</select></div>';
  }

  function renderPastures(){
    var list = $('pastureList');
    if(!state.pastures.length){
      list.innerHTML = '<p class="narrative" style="margin:0;">No pastures yet. Draw one on the map above, or open a Google Earth / GeoJSON / shapefile under <strong>Save, share &amp; print</strong>.</p>';
      return;
    }
    list.innerHTML = state.pastures.map(function(p){
      var typeOpts = Object.keys(TYPES).map(function(k){ return '<option value="' + k + '"' + (p.type === k ? ' selected' : '') + '>' + esc(TYPES[k].label) + '</option>'; }).join('');
      var grazed = isGrazed(p);
      var water = nearestWaterMiles(p);
      var waterTxt = water == null ? (state.points.some(function(x){ return x.type === 'water'; }) ? '' : 'Add a 💧 water point to see distance to water')
                                   : '💧 Middle of pasture is ' + (water < 0.1 ? 'under 0.1' : fmt(water, 1)) + ' mi from water';
      return '<div class="pasture-row' + (p.id === selectedId ? ' selected' : '') + '" data-id="' + p.id + '">' +
        '<div class="p-head"><span class="p-swatch" style="background:' + colorFor(p) + ';"></span>' +
          '<input type="text" class="p-name" value="' + esc(p.name) + '" maxlength="60" aria-label="Pasture name">' +
          '<span class="p-acres">' + fmt(p.acres, p.acres < 10 ? 1 : 0) + ' ac</span></div>' +
        '<div class="p-grid">' +
          '<div><label>Land use</label><select class="p-type">' + typeOpts + '</select></div>' +
          '<div><label>Forage estimate</label>' + (grazed ?
            '<select class="p-mode"><option value="soil"' + (p.mode === 'soil' ? ' selected' : '') + '>Soil survey</option><option value="manual"' + (p.mode === 'manual' ? ' selected' : '') + '>My estimate</option></select>' +
            condSelect(p) + (p.mode === 'manual' ? '<div class="input-wrap has-suffix" style="margin-top:6px;"><input type="number" class="p-manual" min="0" step="50" inputmode="decimal" placeholder="lb per acre" value="' + (p.manual != null ? p.manual : '') + '" aria-label="Forage per acre per year"><span class="suffix">lb/ac/yr</span></div>' : '')
            : '<div class="sub" style="font-size:12.5px;color:var(--ink-muted);padding-top:8px;">—</div>') + '</div>' +
          '<div class="p-cap">' + capBlock(p) + '</div>' +
        '</div>' +
        zoneLine(p) +
        soilBlock(p) +
        measureBlock(p) +
        '<div class="p-foot"><span class="water">' + waterTxt + '</span>' +
          (grazed && p.mode === 'soil' && p.soil && (p.soil.status === 'error' || p.soil.status === 'ok' || p.soil.status === 'nodata') ? '<button type="button" class="tool-btn small p-soil-retry">↻ Soil lookup</button>' : '') +
          '<button type="button" class="tool-btn small p-zoom">🔍 Show on map</button>' +
          '<button type="button" class="tool-btn small danger p-del">Delete</button></div>' +
      '</div>';
    }).join('');
  }
  function updatePastureNumbers(){
    state.pastures.forEach(function(p){
      var row = document.querySelector('.pasture-row[data-id="' + p.id + '"]');
      if(!row){ return; }
      var cap = row.querySelector('.p-cap'); if(cap) cap.innerHTML = capBlock(p);
      var zl = row.querySelector('.p-zones'), zh = zoneLine(p);
      if(zl && zh) zl.outerHTML = zh; else if(zl && !zh) zl.remove();
      var ac = row.querySelector('.p-acres'); if(ac) ac.textContent = fmt(p.acres, p.acres < 10 ? 1 : 0) + ' ac';
      var w = row.querySelector('.p-foot .water');
      if(w){
        var water = nearestWaterMiles(p);
        w.textContent = water == null ? (state.points.some(function(x){ return x.type === 'water'; }) ? '' : 'Add a 💧 water point to see distance to water')
                                      : '💧 Middle of pasture is ' + (water < 0.1 ? 'under 0.1' : fmt(water, 1)) + ' mi from water';
      }
    });
  }

  function renderZones(){
    var el = $('zoneList'); if(!el) return;
    if(!state.zones.length){ el.innerHTML = '<p class="narrative" style="margin:0;color:var(--ink-muted);font-size:13px;">No ponds, brush or bottomland marked. Use the 💧 🌳 〰 buttons above the map to draw them inside a pasture.</p>'; return; }
    el.innerHTML = state.zones.map(function(z){
      var inP = state.pastures.filter(function(p){ return (function(v){ return v.water + v.brush + v.bottom; })(zoneAcres(p)) > 0 && (function(){ var s = 0; try{ polygonClipping.intersection(p.geometry.coordinates, z.geometry.coordinates).forEach(function(q){ s += polygonAcres({type:'Polygon', coordinates:q}); }); }catch(e){ s = pointInRing(centroid(z.geometry), p.geometry.coordinates[0]) ? 1 : 0; } return s > 0.01; })(); }).map(function(p){ return p.name; });
      return '<div class="point-row"><span class="ico" aria-hidden="true">' + ZONE_TYPES[z.type].icon + '</span>' +
        '<select class="zone-type" data-id="' + z.id + '" aria-label="Area type">' + Object.keys(ZONE_TYPES).map(function(k){ return '<option value="' + k + '"' + (z.type === k ? ' selected' : '') + '>' + ZONE_TYPES[k].label + '</option>'; }).join('') + '</select>' +
        '<span class="zone-meta">' + fmt(polygonAcres(z.geometry), 1) + ' ac' + (inP.length ? ' · in ' + esc(inP.join(', ')) : ' · <span style="color:var(--critical-700);">outside every pasture</span>') + '</span>' +
        '<button type="button" class="tool-btn small danger" data-del-zone="' + z.id + '">Delete</button></div>';
    }).join('');
  }
  function renderPoints(){
    var el = $('pointList');
    if(!state.points.length){ el.innerHTML = '<p class="narrative" style="margin:0;color:var(--ink-muted);">Nothing placed yet.</p>'; return; }
    var focused = document.activeElement && document.activeElement.classList.contains('pt-name') ? document.activeElement.getAttribute('data-id') : null;
    if(focused) return; // don't rebuild while typing a name
    el.innerHTML = state.points.map(function(pt){
      var t = POINT_TYPES[pt.type] || POINT_TYPES.other;
      return '<div class="point-row"><span class="ico" aria-hidden="true">' + t.icon + '</span>' +
        '<input type="text" class="pt-name" data-id="' + pt.id + '" value="' + esc(pt.name) + '" placeholder="' + esc(t.label) + '" maxlength="40" aria-label="' + esc(t.label) + ' name">' +
        '<button type="button" class="tool-btn small danger" data-del-point="' + pt.id + '">Delete</button></div>';
    }).join('');
  }

  function renderSummary(){
    var el = $('summaryBody');
    var t = totals();
    if(!state.pastures.length){
      el.innerHTML = '<ol class="empty-steps">' +
        '<li><strong>Find your ranch</strong> with the search box or <em>My location</em>.</li>' +
        '<li><strong>Draw each pasture</strong> by clicking its corners along the fence.</li>' +
        '<li><strong>Check the land use</strong> for each one — the soil survey fills in rangeland forage for you.</li>' +
        '<li><strong>Enter your cows and bulls</strong> to see if the ranch can carry them and when you’ll need hay.</li></ol>' +
        '<p class="ex-row">Just looking? Open an example ranch: <button type="button" class="link-btn" data-example="central-texas-1600ac">Central Texas · 1,600 ac · 80 cows</button> · <button type="button" class="link-btn" data-example="rolling-plains-154-cows">Rolling Plains · 154 cows</button></p>' +
        '<div class="save-status" id="saveStatus"></div>';
      renderSaveStatus();
      return;
    }
    var herd = herdAU();
    var html = '<div class="stat-tiles">' +
      '<div class="stat-tile"><span class="label">Total acres</span><span class="value">' + fmt(t.acres) + '</span><span class="sub">' + t.pastures + ' pasture' + (t.pastures === 1 ? '' : 's') + (t.grazedAcres < t.acres ? ' · ' + fmt(t.grazedAcres) + ' grazed' : '') + '</span></div>' +
      '<div class="stat-tile"><span class="label">Carrying capacity</span><span class="value">' + (t.cap > 0 ? fmt(t.cap, t.cap < 10 ? 1 : 0) : '—') + '</span><span class="sub">animal units, yearlong' + (t.missing ? ' · ' + t.missing + ' pasture' + (t.missing > 1 ? 's' : '') + ' still need forage' : '') + '</span></div>' +
      '<div class="stat-tile"><span class="label">Acres per AU</span><span class="value small">' + (t.acresPerAU ? fmt(t.acresPerAU, 1) : '—') + '</span><span class="sub">on pastures with an estimate</span></div>' +
      '<div class="stat-tile"><span class="label">Unfavorable year</span><span class="value small">' + (t.lowCap != null ? fmt(t.lowCap) + ' AU' : '—') + '</span><span class="sub">' + (t.lowCap != null ? 'soil-survey pastures at drought-year growth' : 'needs soil-survey pastures') + '</span></div>' +
      '</div>';
    if(herd > 0 && t.cap > 0){
      var use = herd / t.cap, over = use > 1, warn = !over && use > 0.85;
      /* fixed scale in animal units, 5 to 1,000 AU (log), the same for every ranch, so any change in herd or capacity moves the bar */
      var LO = Math.log(5), HI = Math.log(1000), pos = function(au){ return Math.max(0, Math.min(100, (Math.log(Math.max(au, 0.01)) - LO)/(HI - LO)*100)); };
      var ticks = [10, 25, 50, 100, 250, 500, 1000];
      var fitCows = cowsAtCapacity(t.cap);
      html += '<div style="margin-top:16px;"><div class="verdict-pill ' + (over ? 'critical' : warn ? 'caution' : 'good') + '"><span class="dot"></span>' +
        (over ? 'Planned herd is ' + fmt((use - 1) * 100) + '% over estimated capacity' : 'Planned herd uses ' + fmt(use * 100) + '% of estimated capacity') + '</div>' +
        '<div class="meter log" role="img" aria-label="Planned herd ' + fmt(herd) + ' AU, capacity ' + fmt(t.cap) + ' AU">' +
          '<div class="meter-cap" style="left:' + pos(t.cap) + '%">capacity</div>' +
          '<div class="meter-track"><div class="meter-band ok" style="width:' + pos(0.85*t.cap) + '%"></div><div class="meter-band warn" style="left:' + pos(0.85*t.cap) + '%;width:' + (pos(t.cap) - pos(0.85*t.cap)) + '%"></div><div class="meter-band bad" style="left:' + pos(t.cap) + '%;right:0"></div>' +
          '<div class="meter-fill' + (over ? ' over' : warn ? ' warn' : '') + '" style="width:' + pos(herd) + '%"></div>' +
          ticks.map(function(k){ return '<div class="meter-tick" style="left:' + pos(k) + '%"></div>'; }).join('') +
          '<div class="meter-tick cap" style="left:' + pos(t.cap) + '%"></div>' +
          (herd > 1000 ? '<span class="meter-more">›</span>' : '') + '</div>' +
          '<div class="meter-scale">' + ticks.map(function(k){ return '<span style="left:' + pos(k) + '%">' + fmt(k) + '</span>'; }).join('') + '</div>' +
        '<div class="meter-labels"><span>' + fmt(herd, herd < 10 ? 1 : 0) + ' AU planned</span><span>capacity ' + fmt(t.cap, t.cap < 10 ? 1 : 0) + ' AU</span></div>' +
        '<p class="meter-note">' + (over || warn ? 'At this capacity the ranch carries about <strong>' + fmt(fitCows) + ' cows</strong> with their bulls and calves.' : 'Room for about <strong>' + fmt(Math.max(0, fitCows - (state.herd.cows || 0))) + ' more cows</strong> at this capacity.') + '</p></div>' +
        (t.lowCap != null && herd > t.lowCap && !over ? '<p class="narrative" style="margin:10px 0 0;font-size:12.5px;">In an unfavorable year the soil survey’s lower forage numbers put capacity near <strong>' + fmt(t.lowCap) + ' AU</strong> — have a destocking or feeding plan ready.</p>' : '') +
        '</div>';
    } else if(t.cap > 0){
      html += '<p class="narrative" style="margin:14px 0 0;font-size:13px;">Enter your <strong>number of cows</strong> under <em>Herd &amp; grazing assumptions</em> to compare it with this capacity.</p>';
    }
    var dh = droughtHtml();
    if(dh) html += '<div style="margin-top:16px;"><div class="label" style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-muted);margin-bottom:6px;">Drought Monitor at your ranch</div>' + dh + '</div>';
    html += '<div class="save-status" id="saveStatus"></div>';
    el.innerHTML = html;
    renderSaveStatus();
    var retry = $('droughtRetry'); if(retry) retry.addEventListener('click', function(){ refreshDroughtIfMoved(true); });
  }

  var rotOpen = false;   // keep 'Grazing days by pasture' open while re-rendering (arrows)
  function renderRotation(){
    var el = $('rotationBody');
    var herd = herdAU();
    var grazed = state.pastures.filter(isGrazed);
    if(!grazed.length){ el.innerHTML = '<p class="narrative" style="margin:0;color:var(--ink-muted);">Draw at least one grazed pasture first.</p>'; return; }
    if(!(herd > 0)){ el.innerHTML = '<p class="narrative" style="margin:0;color:var(--ink-muted);">Enter your number of cows under <em>Herd &amp; grazing assumptions</em> to see grazing days.</p>'; return; }
    var total = 0, anyMissing = false;
    var rows = state.pastures.map(function(p, i){
      if(!isGrazed(p)) return '';
      var d = grazingDays(p, herd);
      if(d == null) anyMissing = true; else total += d;
      return '<tr><td><span class="order-btns"><button type="button" data-move="' + p.id + '" data-dir="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button><button type="button" data-move="' + p.id + '" data-dir="1" aria-label="Move down"' + (i === state.pastures.length - 1 ? ' disabled' : '') + '>↓</button></span></td>' +
        '<td><span class="p-swatch" style="display:inline-block;vertical-align:-2px;margin-right:6px;background:' + colorFor(p) + ';"></span>' + esc(p.name) + '</td>' +
        '<td class="num">' + fmt(p.acres) + '</td>' +
        '<td class="num">' + (d == null ? '<span class="tag warn">needs forage</span>' : fmt(d) + ' days') + '</td></tr>';
    }).join('');
    var shortTxt = total >= 365 ? 'enough for a full year (' + fmt(total) + ' days) at this herd size, before any hay or supplement.'
                                : fmt(total) + ' days — about ' + fmt(365 - total) + ' days short of a full year for this herd. Plan hay, supplement, leased grazing, or a smaller herd for the gap.';
    el.innerHTML = '<div id="grazingPlan">' + grazingPlanHtml() + '</div>' +
      '<div id="herdNow">' + herdNowHtml() + '</div>' +
      '<details class="advanced rot-days"' + (rotOpen ? ' open' : '') + '><summary>Grazing days by pasture · ' + (total >= 365 ? 'a full year' : fmt(total) + ' of 365 days') + '</summary><div class="adv-body">' +
      '<p class="card-note" style="margin:0 0 8px;">How many days each pasture carries your herd, in the order you graze them (use the arrows).</p>' +
      '<div class="table-scroll"><table class="plan"><thead><tr><th style="width:62px;">Order</th><th>Pasture</th><th class="num">Acres</th><th class="num">Days for ' + fmt(herd) + ' AU</th></tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td></td><td>Total</td><td></td><td class="num">' + fmt(total) + ' days</td></tr></tfoot></table></div>' +
      '<p class="narrative" style="margin:12px 0 0;font-size:13px;">Your grazed pastures together provide ' + shortTxt + (anyMissing ? ' (Pastures still missing a forage estimate aren’t counted.)' : '') + '</p>' +
      '<p class="card-note" style="margin:8px 0 0;">These are forage-supply days, not a rest schedule: rotation lets plants recover, but it doesn’t create extra forage.</p></div></details>';
    var rd = el.querySelector('.rot-days'); if(rd) rd.addEventListener('toggle', function(){ rotOpen = rd.open; });
    var hd = el.querySelector('.hn-details'); if(hd) hd.addEventListener('toggle', function(){ hnOpen = hd.open; });
    var hp = $('hn_pid'), hs = $('hn_since');
    if(hp) hp.addEventListener('change', function(){
      if(!this.value){ state.herdNow = null; }
      else { var prev = state.herdNow || {}; state.herdNow = {pid:this.value, since:prev.since || isoDate(todayDate())}; }
      renderRotation(); updateMapGrass(); save();
    });
    if(hs) hs.addEventListener('change', function(){ if(state.herdNow && /^\d{4}-\d{2}-\d{2}$/.test(this.value)){ state.herdNow.since = this.value; renderRotation(); updateMapGrass(); save(); } });
    var gm = $('gp_max');
    if(gm) gm.addEventListener('change', function(){ var v = num(this.value); if(v >= 3 && v <= 120){ state.settings.maxGraze = v; renderRotation(); updateMapGrass(); save(); } });
  }
  function isoDate(dt){ return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }

  function renderBudget(){
    var el = $('budgetBody');
    var t = totals();
    var herd = herdAU();
    var note = '<p class="card-note" style="margin:12px 0 0;">Benchmark from AgriLife Extension’s 2026 District 3 (Rolling Plains) cow-calf budget, per animal unit: revenue $2,189, variable costs $438, <strong>gross margin $1,751</strong>, net return after fixed costs (including pasture rent) $1,251. Gross margin is money left after variable costs — it is <strong>not profit</strong>. That budget assumes about 11.25 acres per AU.</p>';
    if(!(t.cap > 0)){
      el.innerHTML = '<p class="narrative" style="margin:0;">Once your pastures have a forage estimate, this card compares your ranch with AgriLife’s 2026 cow-calf budget.</p>' + note;
      return;
    }
    /* The D03 budget is per cow unit (one cow with her calf = 1 AU), so compare by cows, not metabolic AU */
    var capCows = cowsAtCapacity(t.cap), cows = state.herd.cows || 0;
    var au = cows > 0 ? Math.min(cows, capCows) : capCows;
    var basis = cows > 0 ? (cows > capCows ? 'the ' + fmt(capCows) + ' cows your estimated capacity carries (you plan ' + fmt(cows) + ')' : 'your ' + fmt(cows) + ' cows') : 'the ' + fmt(capCows) + ' cows your estimated capacity carries';
    var acPerCow = capCows > 0 && t.estAcres > 0 ? t.estAcres/capCows : null;
    var ratio = acPerCow / D03.acresPerAU;
    var cmp = ratio > 1.15 ? 'Your land needs <strong>more acres per cow</strong> (' + fmt(acPerCow, 1) + ' vs. 11.25) than the budget assumes, so land cost per cow will run higher than the budget’s.'
            : ratio < 0.87 ? 'Your land carries a cow on <strong>fewer acres</strong> (' + fmt(acPerCow, 1) + ' vs. 11.25) than the budget assumes.'
            : 'Your acres per cow (' + fmt(acPerCow, 1) + ') are close to the budget’s 11.25.';
    el.innerHTML = '<div class="stat-tiles">' +
      '<div class="stat-tile wide"><span class="label">Budget gross margin for ' + fmt(au) + ' cows</span><span class="value">' + money(au * D03.grossMargin) + '</span><span class="sub">per year, based on ' + basis + '</span></div>' +
      '<div class="stat-tile"><span class="label">Net return (budget)</span><span class="value small">' + money(au * D03.netReturn) + '</span><span class="sub">after the budget’s fixed costs</span></div>' +
      '<div class="stat-tile"><span class="label">Acres per cow</span><span class="value small">' + fmt(acPerCow, 1) + '</span><span class="sub">yours, with bulls &amp; calves · budget 11.25</span></div>' +
      '</div><p class="narrative" style="margin:14px 0 0;font-size:13px;">' + cmp + ' Your own prices, weaning weights and costs will differ — run your numbers in the <a href="../cow-calf/index.html" style="color:var(--accent);font-weight:700;">Cow-Calf Bid Price and Budgets</a> tools.</p>' + note;
  }


/*@@FEEDUI@@*/
  /* ------------------------------------------------------------------ Jim */
  function ranchContext(){
    var t = totals(), s = state.settings;
    var lines = [];
    lines.push('[My ranch, from the "My Ranch" map page' + (state.name ? ' — ' + state.name : '') + ']');
    lines.push('Pastures: ' + t.pastures + ', total ' + fmt(t.acres) + ' acres (' + fmt(t.grazedAcres) + ' grazed).');
    lines.push('Assumptions: harvest efficiency ' + s.harvestEff + '%, ' + s.intakeLb + ' lb forage per AU per day.');
    lines.push('Estimated yearlong carrying capacity: ' + (t.cap > 0 ? fmt(t.cap, 1) + ' AU (' + fmt(t.acresPerAU, 1) + ' acres/AU)' : 'not yet estimated') +
      (t.lowCap != null ? '; unfavorable-year estimate ' + fmt(t.lowCap, 1) + ' AU' : '') + '.');
    var h = state.herd;
    lines.push('Planned herd: ' + (h.cows > 0 ? fmt(h.cows) + ' cows (' + fmt(h.cowLb) + ' lb) + ' + bullCount() + ' bulls (' + fmt(h.bullLb) + ' lb) = ' + fmt(herdAU(), 1) + ' AU' : 'not entered') + '.');
    var fb = feedLast;
    if(fb && h.cows > 0){
      lines.push('Feed calendar (NRC 2016 requirements vs. pasture at typical monthly quality; calving: ' + calvingText() + '; region curve: ' + FEED.REGIONS[regionKey()].label + '):');
      fb.months.forEach(function(x){
        lines.push('- ' + x.name + ': herd needs ' + fmt(x.herdReq.tdn) + ' lb TDN & ' + fmt(x.herdReq.cp) + ' lb CP/day; pasture supplies ' + fmt(x.pasture.tdn) + ' TDN & ' + fmt(x.pasture.cp) + ' CP; pasture covers ' + fmt(x.pastureShare*100) + '% of intake; buy ' + fmt(x.cow.hay, 1) + ' lb hay + ' + fmt(x.cow.sup, 1) + ' lb supplement per cow/day');
      });
      var ec = fb.econ;
      lines.push('Calves: ' + fmt(ec.calvesSold, 1) + ' sold at ~' + fmt(ec.avgSaleLb) + ' lb, $' + fmt(ec.avgPrice) + '/cwt (market price slide) = ' + money(ec.calfIncome) + (ec.heifersKept > 0.05 ? '; keeps ' + fmt(ec.heifersKept, 1) + ' replacement heifers, sells ' + fmt(ec.cullsSold, 1) + ' cull cows and ' + fmt(ec.opensSold, 1) + ' open heifers (' + money(ec.cullIncome + ec.openIncome) + ')' : '') + '; prices adjusted to the sale month with the seasonal pattern (calves: USDA Oklahoma City 2016–2025); losses: ' + fmt(ec.deadWeather, 1) + ' weather, ' + fmt(ec.deadOther, 1) + ' other' + (h.nws === 'yes' ? ', ' + fmt(ec.deadNws, 1) + ' screwworm' : '') + '. Weaning period ' + h.weanPeriod + ' days at ' + h.postAdg + ' lb/day. Cattle sales minus feed & feeding costs: ' + money(ec.net) + ' (not profit).' + (+h.bcsWean > 0 && +h.bcsWean < +h.bcs ? ' Cows wean at BCS ' + h.bcsWean + ' and are fed back to ' + h.bcs + ' before calving.' : ''));
      lines.push('Yearly purchased feed: ' + fmt(fb.totals.hay/2000, 1) + ' tons hay ($' + h.hayPrice + '/ton, ' + h.hayTdn + '% TDN, ' + h.hayCp + '% CP) + ' + fmt(fb.totals.sup/2000, 1) + ' tons supplement ($' + h.supPrice + '/ton, ' + h.supCp + '% CP) + feeding trips & delivery = ' + money(fb.totals.cost) + ' (' + money(fb.totals.cost/h.cows) + ' per cow).');
    }
    var d = state.drought;
    if(d && d.status === 'ok') lines.push('U.S. Drought Monitor at the ranch: ' + (d.dm < 0 ? 'no drought mapped' : DM_LABELS[Math.min(d.dm,4)].code + ' ' + DM_LABELS[Math.min(d.dm,4)].name) + (d.date ? ' (week of ' + new Date(d.date).toISOString().slice(0,10) + ')' : '') + '.');
    var c = ranchCenter(); if(c) lines.push('Approximate location: ' + c.lat.toFixed(2) + ', ' + c.lng.toFixed(2) + '.');
    lines.push('Pasture list:');
    state.pastures.forEach(function(p){
      var lb = forageLb(p), cap = capacityAU(p), w = nearestWaterMiles(p);
      var zz = zoneAcres(p), zt = [zz.water > 0.05 ? fmt(zz.water, 1) + ' ac pond' : '', zz.brush > 0.05 ? fmt(zz.brush, 1) + ' ac brush' : '', zz.bottom > 0.05 ? fmt(zz.bottom, 1) + ' ac bottomland' : ''].filter(Boolean).join(', ');
      lines.push('- ' + p.name + ': ' + TYPES[p.type].label + (p.mode === 'soil' && isGrazed(p) ? ' (' + CONDITIONS[p.condition || 'fair'].toLowerCase() + ' condition)' : '') + ', ' + fmt(p.acres, 1) + ' ac' + (zt ? ' incl. ' + zt : '') +
        (isGrazed(p) ? ', forage ' + (lb != null ? fmt(lb) + ' lb/ac/yr (' + (p.mode === 'soil' ? 'soil survey, normal year' : 'producer estimate') + ')' : 'unknown') + (cap != null ? ', capacity ' + fmt(cap, 1) + ' AU' : '') : '') +
        (w != null ? ', ' + fmt(w, 1) + ' mi from water' : ''));
    });
    return lines.join('\n');
  }


  /* ------------------------------------------------------------------ import / export */
  function loadLib(globalName){
    if(window[globalName]) return Promise.resolve(window[globalName]);
    return new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = LIBS[globalName];
      s.onload = function(){ window[globalName] ? res(window[globalName]) : rej(new Error('Could not load the file reader.')); };
      s.onerror = function(){ rej(new Error('Could not load the file reader — check your internet connection.')); };
      document.head.appendChild(s);
    });
  }
  function readAs(file, how){
    return new Promise(function(res, rej){
      var r = new FileReader();
      r.onload = function(){ res(r.result); };
      r.onerror = function(){ rej(new Error('Could not read the file.')); };
      how === 'text' ? r.readAsText(file) : r.readAsArrayBuffer(file);
    });
  }
  function parseKmlText(text){
    return loadLib('toGeoJSON').then(function(tg){
      var dom = new DOMParser().parseFromString(text, 'text/xml');
      if(dom.getElementsByTagName('parsererror').length) throw new Error('That KML file looks damaged.');
      return tg.kml(dom);
    });
  }
  function parseFile(file){
    var name = file.name.toLowerCase();
    if(/\.(geo)?json$/.test(name)) return readAs(file, 'text').then(function(t){ return JSON.parse(t); });
    if(/\.kml$/.test(name)) return readAs(file, 'text').then(parseKmlText);
    if(/\.kmz$/.test(name)) return Promise.all([readAs(file, 'buffer'), loadLib('JSZip')]).then(function(r){
      return r[1].loadAsync(r[0]).then(function(zip){
        var kml = Object.keys(zip.files).filter(function(n){ return /\.kml$/i.test(n); })[0];
        if(!kml) throw new Error('No KML found inside that KMZ file.');
        return zip.files[kml].async('text');
      }).then(parseKmlText);
    });
    if(/\.zip$/.test(name)) return Promise.all([readAs(file, 'buffer'), loadLib('shp')]).then(function(r){ return r[1](r[0]); });
    return Promise.reject(new Error('Use a .kml, .kmz, .geojson, .json or zipped shapefile (.zip).'));
  }
  function featuresOf(obj){
    if(!obj) return [];
    if(Array.isArray(obj)) return obj.reduce(function(a, o){ return a.concat(featuresOf(o)); }, []);
    if(obj.type === 'FeatureCollection') return obj.features || [];
    if(obj.type === 'Feature') return [obj];
    if(obj.type && obj.coordinates) return [{type:'Feature', properties:{}, geometry:obj}];
    if(obj.type === 'GeometryCollection') return (obj.geometries || []).map(function(g){ return {type:'Feature', properties:{}, geometry:g}; });
    return [];
  }
  function propName(pr){ pr = pr || {}; return pr.name || pr.Name || pr.NAME || pr.title || pr.PASTURE || pr.pasture || pr.label || ''; }
  function importObject(obj){
    var feats = featuresOf(obj), nP = 0, nPt = 0, nZ = 0, skipped = 0;
    feats.forEach(function(f){
      var g = f && f.geometry; if(!g){ skipped++; return; }
      var pr = f.properties || {}, nm = propName(pr);
      var pType = TYPES[pr.land_use] ? pr.land_use : (TYPES[pr.type] ? pr.type : null);
      var props = {name:nm, type:pType || undefined, mode:(pr.forage_source === 'manual' || pr.forage_source === 'soil') ? pr.forage_source : undefined,
                   manual: (pr.forage_source === 'manual' && isFinite(+pr.forage_lb_ac) && +pr.forage_lb_ac > 0) ? +pr.forage_lb_ac : undefined};
      var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
      props.condition = CONDITIONS[pr.condition] ? pr.condition : undefined;
      if(+pr.measured_lb_ac > 0) props.measured = {lbAc:+pr.measured_lb_ac, month:Math.max(0, Math.min(11, (+pr.measured_month || 1) - 1))};
      if(polys && ZONE_TYPES[pr.zone_type]){
        polys.forEach(function(c){ var cc = cleanPolygon(c); if(cc.length){ state.zones.push({id:uid(), type:pr.zone_type, geometry:{type:'Polygon', coordinates:cc}}); nZ++; } });
        return;
      }
      if(polys){
        polys.forEach(function(c, i){
          var pp = Object.assign({}, props); if(polys.length > 1 && nm) pp.name = nm + ' ' + (i + 1);
          if(addPastureSilently({type:'Polygon', coordinates:c}, pp)) nP++;
        });
        return;
      }
      if(g.type === 'Point'){
        var type = POINT_TYPES[pr.point_type] ? pr.point_type : (/water|tank|trough|well|pond|windmill/i.test(nm) ? 'water' : /pen|corral|trap/i.test(nm) ? 'pen' : /gate/i.test(nm) ? 'gate' : /feed/i.test(nm) ? 'feeder' : 'other');
        state.points.push({id:uid(), type:type, lat:g.coordinates[1], lng:g.coordinates[0], name:String(nm || '').slice(0,40)});
        nPt++; return;
      }
      skipped++;
    });
    zoneCache = {};
    // herd, feed and decision settings saved by My Ranch itself (GeoJSON download)
    var mr = obj && !Array.isArray(obj) && obj.my_ranch, herdLoaded = false;
    if(mr && typeof mr === 'object'){
      if(mr.herd && typeof mr.herd === 'object'){
        state.herd = Object.assign({}, DEFAULT_HERD, mr.herd);
        state.herd.dr = Object.assign({}, DEFAULT_HERD.dr, mr.herd.dr || {});
        state.herd.sell = Object.assign({}, DEFAULT_HERD.sell, mr.herd.sell || {});
        herdLoaded = true;
      }
      if(mr.settings && typeof mr.settings === 'object'){
        ['harvestEff', 'intakeLb', 'manualCap', 'maxGraze'].forEach(function(k){ if(mr.settings[k] === null || isFinite(+mr.settings[k])) state.settings[k] = mr.settings[k] === null ? null : +mr.settings[k]; });
        if(mr.settings.cond) state.settings.cond = Object.assign({}, DEFAULT_SETTINGS.cond, mr.settings.cond);
        if(mr.settings.zoneF) state.settings.zoneF = Object.assign({}, DEFAULT_SETTINGS.zoneF, mr.settings.zoneF);
      }
      if(typeof mr.name === 'string' && mr.name) state.name = mr.name.slice(0, 60);
      if(mr.herdNow && mr.herdNow.since) state.herdNow = null;   // pasture ids change on import
      if(herdLoaded){ try{ bindHerdValues(); $('ranchName').value = state.name || ''; }catch(e){} }
    }
    return {pastures:nP, points:nPt, zones:nZ, skipped:skipped, herd:herdLoaded};
  }
  function addPastureSilently(geom, props){
    var coords = cleanPolygon(geom.coordinates || []);
    if(!coords.length) return null;
    var g = {type:'Polygon', coordinates:coords};
    var type = TYPES[props.type] ? props.type : 'range';
    var p = {id:uid(), name:(props.name || ('Pasture ' + (state.pastures.length + 1))).toString().slice(0,60), type:type,
             mode: props.mode || TYPES[type].mode, manual: typeof props.manual === 'number' ? props.manual : null,
             geometry:g, acres:polygonAcres(g), soil:null};
    if(!(p.acres > 0)) return null;
    state.pastures.push(p);
    return p;
  }
  function showNotice(msg, kind){
    var n = $('fileNotice'); n.hidden = false; n.className = 'notice ' + (kind || 'good'); n.textContent = msg;
  }
  function handleFile(file){
    if(!file) return;
    showNotice('Reading ' + file.name + '…', 'good');
    parseFile(file).then(function(obj){ applyObject(obj, file.name); }).catch(function(err){
      showNotice((err && err.message) || 'That file couldn’t be opened.', 'bad');
    });
  }
  var EXAMPLES = {'central-texas-1600ac':'Central Texas example', 'rolling-plains-154-cows':'Rolling Plains example'};
  function loadExample(slug){
    if(!EXAMPLES[slug]) return;
    showFilePanel(); showNotice('Opening the ' + EXAMPLES[slug] + '…', 'good');
    fetch('examples/' + slug + '.geojson').then(function(r){ if(!r.ok) throw new Error('The example ranch couldn’t be loaded. Check your internet connection.'); return r.json(); })
      .then(function(obj){ applyObject(obj, 'the ' + EXAMPLES[slug]); })
      .catch(function(err){ showNotice((err && err.message) || 'The example ranch couldn’t be loaded.', 'bad'); });
  }
  function showFilePanel(){ var fp = $('filePanel'), b = $('stripSaveBtn'); if(fp && fp.hidden){ fp.hidden = false; if(b) b.setAttribute('aria-expanded', 'true'); } }
  function applyObject(obj, label){
    (function(){
      var file = {name:label};
      var whole = !!(obj && !Array.isArray(obj) && obj.my_ranch && obj.my_ranch.herd), useHerd = whole;
      if(whole && (state.pastures.length || state.points.length || state.zones.length || state.herd.cows > 0)){
        useHerd = confirm('“' + file.name + '” is a complete My Ranch file' + (obj.my_ranch.name ? ' (' + obj.my_ranch.name + ')' : '') + '.\n\nOK: replace the ranch on this device with it (pastures, herd and settings).\nCancel: keep your ranch and only add its pastures.');
      }
      if(useHerd) wipeRanch();
      var before = state.pastures.length;
      var r = importObject(useHerd ? obj : Object.assign({}, obj, {my_ranch:null}));
      if(useHerd) bindSettingsValues();
      if(!r.pastures && !r.points && !r.zones){ showNotice('No pasture shapes or points were found in ' + file.name + '.', 'bad'); return; }
      state.pastures.slice(before).forEach(function(p){ drawPastureLayer(p); if(p.mode === 'soil' && isGrazed(p)) scheduleSoil(p.id, 0); });
      state.zones.forEach(function(z){ if(!zoneLayers[z.id]) drawZoneLayer(z); });
      state.points.forEach(function(pt){ if(!pointLayers[pt.id]) drawPointLayer(pt); });
      recolorLayers();
      renderAll(true);
      fitRanch();
      refreshDroughtIfMoved(true);
      showNotice((r.herd ? 'Loaded ' + (state.name ? '“' + state.name + '”' : 'the ranch') + ' — ' : 'Added ') + r.pastures + ' pasture' + (r.pastures === 1 ? '' : 's') + (r.points ? ' and ' + r.points + ' point' + (r.points === 1 ? '' : 's') : '') + (r.herd ? ', herd and feed settings' : '') + ' from ' + file.name + '.' + (r.skipped ? ' Skipped ' + r.skipped + ' line or other shape' + (r.skipped === 1 ? '' : 's') + '.' : ''), 'good');
    })();
  }
  function toGeoJSON(){
    var feats = state.pastures.map(function(p){
      var cap = capacityAU(p);
      return {type:'Feature', geometry:p.geometry, properties:{
        name:p.name, land_use:p.type, acres:+p.acres.toFixed(2),
        forage_source:p.mode, forage_lb_ac: forageLb(p) != null ? Math.round(forageLb(p)) : null,
        capacity_au: cap != null ? +cap.toFixed(1) : null, condition:p.condition || 'fair',
        measured_lb_ac: p.measured ? p.measured.lbAc : null, measured_month: p.measured ? p.measured.month + 1 : null
      }};
    }).concat(state.zones.map(function(z){
      return {type:'Feature', geometry:z.geometry, properties:{name:ZONE_TYPES[z.type].label, zone_type:z.type, acres:+polygonAcres(z.geometry).toFixed(2)}};
    })).concat(state.points.map(function(pt){
      return {type:'Feature', geometry:{type:'Point', coordinates:[pt.lng, pt.lat]}, properties:{name:pt.name || POINT_TYPES[pt.type].label, point_type:pt.type}};
    }));
    var st = state.settings;
    return {type:'FeatureCollection', name:state.name || 'My Ranch', features:feats,
            my_ranch:{version:1, name:state.name || '', herd:state.herd, herdNow:state.herdNow || null,
                      settings:{harvestEff:st.harvestEff, intakeLb:st.intakeLb, manualCap:st.manualCap, maxGraze:st.maxGraze, cond:st.cond, zoneF:st.zoneF}}};
  }
  function xml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]; }); }
  function toKml(){
    function ring(r){ return r.map(function(c){ return c[0].toFixed(7) + ',' + c[1].toFixed(7) + ',0'; }).join(' '); }
    var pm = state.pastures.map(function(p){
      var inner = p.geometry.coordinates.slice(1).map(function(r){ return '<innerBoundaryIs><LinearRing><coordinates>' + ring(r) + '</coordinates></LinearRing></innerBoundaryIs>'; }).join('');
      var cap = capacityAU(p);
      return '<Placemark><name>' + xml(p.name) + '</name><description>' + xml(TYPES[p.type].label + ' · ' + p.acres.toFixed(1) + ' ac' + (cap != null ? ' · ' + cap.toFixed(1) + ' AU' : '')) + '</description>' +
        '<ExtendedData><Data name="land_use"><value>' + xml(p.type) + '</value></Data><Data name="forage_source"><value>' + xml(p.mode) + '</value></Data>' +
        (forageLb(p) != null ? '<Data name="forage_lb_ac"><value>' + Math.round(forageLb(p)) + '</value></Data>' : '') + '</ExtendedData>' +
        '<Style><LineStyle><color>ffffffff</color><width>2</width></LineStyle><PolyStyle><color>5543c3f6</color></PolyStyle></Style>' +
        '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + ring(p.geometry.coordinates[0]) + '</coordinates></LinearRing></outerBoundaryIs>' + inner + '</Polygon></Placemark>';
    }).join('\n');
    var zs = state.zones.map(function(z){
      return '<Placemark><name>' + xml(ZONE_TYPES[z.type].label) + '</name><ExtendedData><Data name="zone_type"><value>' + xml(z.type) + '</value></Data></ExtendedData>' +
        '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + ring(z.geometry.coordinates[0]) + '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>';
    }).join('\n');
    var pts = state.points.map(function(pt){
      return '<Placemark><name>' + xml(pt.name || POINT_TYPES[pt.type].label) + '</name><ExtendedData><Data name="point_type"><value>' + xml(pt.type) + '</value></Data></ExtendedData><Point><coordinates>' + pt.lng.toFixed(7) + ',' + pt.lat.toFixed(7) + ',0</coordinates></Point></Placemark>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xml(state.name || 'My Ranch') + '</name>\n' + pm + '\n' + zs + '\n' + pts + '\n</Document></kml>';
  }
  function download(text, filename, type){
    var blob = new Blob([text], {type:type});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function fileBase(){ return (state.name || 'my-ranch').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-ranch'; }

  /* ------------------------------------------------------------------ search / locate */
  var searchTimer = null;
  function runSearch(){
    var q = $('searchInput').value.trim(), box = $('searchResults');
    if(!q){ box.hidden = true; return; }
    var m = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if(m && map){
      var lat = +m[1], lng = +m[2];
      if(Math.abs(lat) <= 90 && Math.abs(lng) <= 180){ map.setView([lat, lng], 16); box.hidden = true; return; }
    }
    box.hidden = false; box.innerHTML = '<div class="msg"><span class="spinner"></span> Searching…</div>';
    fetch(GEOCODE_URL + '?format=jsonv2&limit=6&countrycodes=us&q=' + encodeURIComponent(q), {headers:{'Accept':'application/json'}})
      .then(function(r){ return r.json(); })
      .then(function(list){
        if(!list || !list.length){ box.innerHTML = '<div class="msg">No places found. Try a town and county, e.g. “Throckmorton, TX”.</div>'; return; }
        box.innerHTML = list.map(function(x, i){ return '<button type="button" data-i="' + i + '">' + esc(x.display_name) + '</button>'; }).join('');
        box.querySelectorAll('button').forEach(function(b){
          b.addEventListener('click', function(){
            var x = list[+b.getAttribute('data-i')];
            if(x.boundingbox){ var bb = x.boundingbox.map(Number); map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], {maxZoom:16}); }
            else map.setView([+x.lat, +x.lon], 15);
            box.hidden = true;
          });
        });
      })
      .catch(function(){ box.innerHTML = '<div class="msg">Search isn’t available right now. You can type coordinates instead, e.g. 33.18, -99.25.</div>'; });
  }
  function locate(){
    if(!navigator.geolocation || !map){ alert('This device can’t share its location.'); return; }
    $('locateBtn').textContent = '📍 Finding you…';
    navigator.geolocation.getCurrentPosition(function(pos){
      $('locateBtn').textContent = '📍 My location';
      map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      L.circleMarker([pos.coords.latitude, pos.coords.longitude], {radius:7, color:'#fff', weight:2, fillColor:'#2f6fb3', fillOpacity:1}).addTo(map).bindTooltip('You are here').openTooltip();
    }, function(){
      $('locateBtn').textContent = '📍 My location';
      alert('Couldn’t get your location. Check that location is allowed for this site, or search for your ranch instead.');
    }, {enableHighAccuracy:true, timeout:15000, maximumAge:60000});
  }

  /* ------------------------------------------------------------------ theme */
  function initThemeToggle(){
    var KEY = 'tamuDecisionAidsTheme', toggle = $('themeToggle');
    var stored = null; try{ stored = localStorage.getItem(KEY); }catch(e){}
    if(stored === 'light' || stored === 'dark') document.documentElement.setAttribute('data-theme', stored);
    function current(){
      var a = document.documentElement.getAttribute('data-theme');
      if(a === 'light' || a === 'dark') return a;
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    function update(){ var dark = current() === 'dark'; toggle.textContent = dark ? '☀️' : '🌙'; var l = dark ? 'Switch to light mode' : 'Switch to dark mode'; toggle.setAttribute('aria-label', l); toggle.setAttribute('title', l); }
    update();
    toggle.addEventListener('click', function(){
      var next = current() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try{ localStorage.setItem(KEY, next); }catch(e){}
      update();
    });
  }

  /* ------------------------------------------------------------------ wiring */
  function bindSettings(){
    $('ranchName').value = state.name || '';
    $('harvestEff').value = state.settings.harvestEff;
    $('intakeLb').value = state.settings.intakeLb;
    $('manualCap').value = state.settings.manualCap > 0 ? state.settings.manualCap : '';
    $('manualCap').addEventListener('input', function(){ var v = num(this.value); state.settings.manualCap = v != null && v > 0 ? v : null; renderAll(false); });
    bindHerdValues();
    $('ranchName').addEventListener('input', function(){ state.name = this.value.slice(0, 80); save(); });
    $('hd_cows').addEventListener('input', function(){ var v = num(this.value); state.herd.cows = v != null && v > 0 ? Math.round(v) : 0; renderHerdNote(); renderAll(false); });
    $('hd_bulls').addEventListener('input', function(){ var v = num(this.value); state.herd.bulls = (this.value === '' || v == null || v < 0) ? null : Math.round(v); renderHerdNote(); renderAll(false); });
    [['hd_cowLb','cowLb',600,2000],['hd_bullLb','bullLb',1000,3000]].forEach(function(f){
      $(f[0]).addEventListener('input', function(){ var v = num(this.value); if(v != null && v >= f[2] && v <= f[3]){ state.herd[f[1]] = v; renderHerdNote(); renderAll(false); } });
      $(f[0]).addEventListener('blur', function(){ this.value = state.herd[f[1]]; });
    });
    $('harvestEff').addEventListener('input', function(){ var v = num(this.value); if(v != null && v > 0 && v <= 100){ state.settings.harvestEff = v; syncGrazeSys(); renderAll(false); } });
    $('grazeSys').addEventListener('change', function(){ if(this.value !== 'custom'){ state.settings.harvestEff = +this.value; $('harvestEff').value = state.settings.harvestEff; renderAll(false); } else $('harvestEff').focus(); });
    syncGrazeSys();
    $('intakeLb').addEventListener('input', function(){ var v = num(this.value); if(v != null && v > 0){ state.settings.intakeLb = v; renderAll(false); } });
    ['harvestEff','intakeLb'].forEach(function(id){
      $(id).addEventListener('blur', function(){ if(!(num(this.value) > 0)) this.value = state.settings[id]; });
    });
  }

  function bindList(){
    var list = $('pastureList');
    list.addEventListener('input', function(e){
      var row = e.target.closest('.pasture-row'); if(!row) return;
      var p = getPasture(row.getAttribute('data-id')); if(!p) return;
      if(e.target.classList.contains('p-name')){
        p.name = e.target.value.slice(0, 60) || 'Pasture';
        if(pastureLayers[p.id]) pastureLayers[p.id].setTooltipContent(labelText(p));
        renderRotation(); save();
      } else if(e.target.classList.contains('p-manual')){
        var v = num(e.target.value); p.manual = (v != null && v > 0) ? v : null;
        renderAll(false);
      } else if(e.target.classList.contains('p-meas')){
        var mv = num(e.target.value), sel = row.querySelector('.p-measMonth');
        p.measured = (mv != null && mv > 0) ? {lbAc:mv, month:sel ? +sel.value : new Date().getMonth()} : null;
        renderAll(false);
      }
    });
    list.addEventListener('change', function(e){
      var row = e.target.closest('.pasture-row'); if(!row) return;
      var p = getPasture(row.getAttribute('data-id')); if(!p) return;
      if(e.target.classList.contains('p-type')){
        var was = p.type; p.type = e.target.value;
        if(TYPES[was].mode !== TYPES[p.type].mode && !(p.mode === 'manual' && p.manual != null)) p.mode = TYPES[p.type].mode;
        if(p.mode === 'soil' && isGrazed(p) && (!p.soil || p.soil.status === 'error')) scheduleSoil(p.id, 0);
        renderAll(true);
      } else if(e.target.classList.contains('p-mode')){
        p.mode = e.target.value;
        if(p.mode === 'soil' && (!p.soil || p.soil.status === 'error')) scheduleSoil(p.id, 0);
        renderAll(true);
        if(p.mode === 'manual'){ var inp = document.querySelector('.pasture-row[data-id="' + p.id + '"] .p-manual'); if(inp) inp.focus(); }
      } else if(e.target.classList.contains('p-condition')){
        p.condition = e.target.value;
        renderAll(true);
      } else if(e.target.classList.contains('p-measMonth')){
        if(p.measured) p.measured.month = +e.target.value;
        renderAll(false);
      }
    });
    list.addEventListener('click', function(e){
      var row = e.target.closest('.pasture-row'); if(!row) return;
      var id = row.getAttribute('data-id');
      if(e.target.closest('.p-del')) removePasture(id);
      else if(e.target.closest('.p-zoom')) zoomTo(id);
      else if(e.target.closest('.p-soil-retry')){ scheduleSoil(id, 0); renderPastures(); }
      else if(!e.target.closest('input,select,button')) selectPasture(id, false);
    });
    $('rotationBody').addEventListener('click', function(e){
      var b = e.target.closest('[data-move]'); if(b) movePasture(b.getAttribute('data-move'), +b.getAttribute('data-dir'));
    });
    $('pointList').addEventListener('input', function(e){
      if(!e.target.classList.contains('pt-name')) return;
      var pt = state.points.filter(function(x){ return x.id === e.target.getAttribute('data-id'); })[0];
      if(pt){ pt.name = e.target.value.slice(0, 40); save(); }
    });
    document.addEventListener('click', function(e){
      var b = e.target.closest('[data-del-point]');
      if(b){ removePoint(b.getAttribute('data-del-point')); if(map) map.closePopup(); }
      var tz = e.target.closest('[data-to-zone]');
      if(tz){ var zt = tz.getAttribute('data-to-zone'); $('zoneOffer').hidden = true; if(zt !== 'keep') pastureToZone(tz.getAttribute('data-pid'), zt); return; }
      var bz = e.target.closest('[data-del-zone]');
      if(bz) removeZone(bz.getAttribute('data-del-zone'));
      if(!e.target.closest('.search-box')) $('searchResults').hidden = true;
    });
  }

  function bindTools(){
    $('drawPastureBtn').addEventListener('click', function(){ setDrawMode(drawMode === 'pasture' ? null : 'pasture'); });
    $('drawRectBtn').addEventListener('click', function(){ setDrawMode(drawMode === 'rect' ? null : 'rect'); });
    document.querySelectorAll('[data-point]').forEach(function(b){
      b.addEventListener('click', function(){ var m = 'point:' + b.getAttribute('data-point'); setDrawMode(drawMode === m ? null : m); });
    });
    document.querySelectorAll('[data-zone]').forEach(function(b){
      b.addEventListener('click', function(){ var m = 'zone:' + b.getAttribute('data-zone'); setDrawMode(drawMode === m ? null : m); });
    });
    $('zoneList').addEventListener('change', function(e){
      if(!e.target.classList.contains('zone-type')) return;
      var z = state.zones.filter(function(x){ return x.id === e.target.getAttribute('data-id'); })[0];
      if(z && ZONE_TYPES[e.target.value]){ z.type = e.target.value; zoneCache = {}; drawZoneLayer(z); renderAll(true); }
    });
    [['la_poor','cond','poor',5,100],['la_fair','cond','fair',5,100],['la_excellent','cond','excellent',5,100],['la_brush','zoneF','brush',0,100],['la_bottom','zoneF','bottom',50,400]].forEach(function(f){
      var el = $(f[0]); el.value = state.settings[f[1]][f[2]];
      el.addEventListener('input', function(){ var v = num(this.value); if(v != null && v >= f[3] && v <= f[4]){ state.settings[f[1]][f[2]] = v; zoneCache = {}; renderAll(true); } });
      el.addEventListener('blur', function(){ this.value = state.settings[f[1]][f[2]]; });
    });
    $('editBtn').addEventListener('click', function(){ toggleEdit(); });
    $('cancelDrawBtn').addEventListener('click', function(){ setDrawMode(null); });
    $('finishBtn').addEventListener('click', function(){
      try{ if(map.pm.Draw.Polygon._layer && map.pm.Draw.Polygon._layer.getLatLngs().length >= 3) map.pm.Draw.Polygon._finishShape(); else setHint('<strong>Keep going:</strong> a pasture needs at least 3 corners.'); }catch(err){}
    });
    $('undoPointBtn').addEventListener('click', function(){ try{ map.pm.Draw.Polygon._removeLastVertex(); }catch(err){} });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && drawMode) setDrawMode(null); });

    $('searchBtn').addEventListener('click', runSearch);
    $('searchInput').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); runSearch(); } });
    $('locateBtn').addEventListener('click', locate);

    $('importBtn').addEventListener('click', function(){ $('fileInput').click(); });
    document.addEventListener('click', function(e){ var b = e.target.closest && e.target.closest('[data-example]'); if(b){ e.preventDefault(); loadExample(b.getAttribute('data-example')); } });
    $('fileInput').addEventListener('change', function(){ handleFile(this.files[0]); this.value = ''; });
    $('exportGeoBtn').addEventListener('click', function(){
      if(!state.pastures.length && !state.points.length){ showNotice('Draw a pasture first — there’s nothing to download yet.', 'bad'); return; }
      download(JSON.stringify(toGeoJSON(), null, 1), fileBase() + '.geojson', 'application/geo+json');
    });
    $('exportKmlBtn').addEventListener('click', function(){
      if(!state.pastures.length && !state.points.length){ showNotice('Draw a pasture first — there’s nothing to download yet.', 'bad'); return; }
      download(toKml(), fileBase() + '.kml', 'application/vnd.google-earth.kml+xml');
    });
    $('fc_planBtn').addEventListener('click', function(){ printPlan(); });
    $('fc_bcuBtn').addEventListener('click', function(){ sendFeedToBcu(); });
    $('planBtn').addEventListener('click', function(){
      if(!(state.herd.cows > 0)){ showNotice('Enter your number of cows first — the plan is built from the herd and the feed calendar.', 'bad'); return; }
      printPlan();
    });
    $('printBtn').addEventListener('click', function(){
      $('printDate').textContent = (state.name ? state.name + ' · ' : '') + 'Printed ' + new Date().toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'});
      if(editOn) toggleEdit(false);
      if(state.pastures.length) fitRanch();
      setTimeout(function(){ window.print(); }, 400);
    });
    $('clearBtn').addEventListener('click', function(){
      if(!confirm('Delete every pasture, point and setting for this ranch from this device? Download a file first if you want to keep it.')) return;
      wipeRanch();
      renderAll(true);
    });
  }
  function wipeRanch(){
    Object.keys(pastureLayers).forEach(function(k){ map && map.removeLayer(pastureLayers[k]); });
    Object.keys(pointLayers).forEach(function(k){ map && map.removeLayer(pointLayers[k]); });
    Object.keys(zoneLayers).forEach(function(k){ map && map.removeLayer(zoneLayers[k]); });
    pastureLayers = {}; pointLayers = {}; zoneLayers = {}; selectedId = null; zoneCache = {};
    var view = state.view;
    state = blankState(); state.view = view;
    bindSettingsValues();
  }
  function syncGrazeSys(){ var g = $('grazeSys'); if(g) g.value = [25, 30, 40].indexOf(+state.settings.harvestEff) >= 0 ? String(+state.settings.harvestEff) : 'custom'; }
  function bindSettingsValues(){
    $('ranchName').value = state.name || ''; bindHerdValues();
    $('manualCap').value = state.settings.manualCap > 0 ? state.settings.manualCap : '';
    ['la_poor','la_fair','la_excellent'].forEach(function(id){ $(id).value = state.settings.cond[id.slice(3)]; });
    $('la_brush').value = state.settings.zoneF.brush; $('la_bottom').value = state.settings.zoneF.bottom;
    $('harvestEff').value = state.settings.harvestEff; $('intakeLb').value = state.settings.intakeLb; syncGrazeSys();
  }


  /* ---- steps (Ranch · Herd · Year plan · Decisions) and the summary strip */
  var STEPS = ['ranch', 'herd', 'plan', 'decide'], curStep = null, STEP_KEY = 'tamuMyRanchStep';
  function stepDone(s){
    if(s === 'ranch') return state.pastures.length > 0;
    if(s === 'herd') return state.herd.cows > 0;
    if(s === 'plan') return !!(feedLast && feedLast.hasSupply);
    return false;
  }
  function markSteps(){
    document.querySelectorAll('.mr-step-btn').forEach(function(b){
      var s = b.getAttribute('data-go');
      b.classList.toggle('on', s === curStep); b.classList.toggle('done', s !== curStep && stepDone(s));
      if(s === curStep) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }
  function showStep(s, noScroll){
    if(STEPS.indexOf(s) < 0) s = 'ranch';
    var changed = s !== curStep; curStep = s;
    // automated browser tests see every step at once, unless a test asks for real steps (window.__MR_STEPS)
    var all = navigator.webdriver && !window.__MR_STEPS;
    document.querySelectorAll('.mr-step').forEach(function(el){ el.hidden = !all && el.getAttribute('data-step') !== s; });
    markSteps();
    try{ localStorage.setItem(STEP_KEY, s); }catch(e){}
    if(s === 'ranch' && map) setTimeout(function(){ map.invalidateSize(); }, 30);
    if((s === 'plan' || s === 'decide') && changed){
      // charts drawn while their step was hidden had no width: draw them again now
      if(feedLast && s === 'plan') renderFeedChart(feedLast, feedNutrient, $('fc_chart'), true);
      decKey = ''; renderDecisions();
    }
    if(!noScroll && changed){ var nav = $('mrSteps'); if(nav && nav.getBoundingClientRect().top < 0) window.scrollTo({top:window.scrollY + nav.getBoundingClientRect().top - 70, behavior:'smooth'}); }
  }
  function firstStep(){
    var saved = null; try{ saved = localStorage.getItem(STEP_KEY); }catch(e){}
    if(saved && STEPS.indexOf(saved) >= 0 && (saved === 'ranch' || state.pastures.length)) return saved;
    if(!state.pastures.length) return 'ranch';
    if(!(state.herd.cows > 0)) return 'herd';
    return 'plan';
  }
  function updateStrip(){
    if(!$('mrStrip')) return;
    var t = totals(), herd = herdAU(), h = state.herd;
    $('st_name').textContent = state.name || 'Your ranch';
    $('st_sub').textContent = t.pastures ? fmt(t.acres) + ' ac' + (h.cows > 0 ? ' · ' + fmt(h.cows) + ' cows' : ' · enter your herd') : 'Draw your pastures to start';
    var st = $('st_stock'), bar = $('st_stockBar');
    if(herd > 0 && t.cap > 0){
      var use = herd/t.cap;
      st.innerHTML = fmt(use*100) + '% <small>of capacity</small>'; st.className = use > 1 ? 'bad' : use > 0.85 ? 'warn' : 'ok';
      bar.style.width = Math.min(100, use*100) + '%'; bar.className = st.className;
    } else { st.textContent = '—'; st.className = ''; bar.style.width = '0'; }
    var d = state.drought, dr = $('st_drought');
    if(d && d.status === 'ok'){ if(d.dm < 0){ dr.textContent = 'None'; dr.className = 'ok'; } else { var L = DM_LABELS[Math.min(d.dm, 4)]; dr.textContent = L.code + ' ' + L.name.split(' ')[0]; dr.className = d.dm >= 2 ? 'bad' : 'warn'; } }
    else { dr.textContent = '—'; dr.className = ''; }
    var f = feedLast && feedLast.hasSupply ? feedLast : null;
    if(f){
      var hay = f.totals.hay/2000, sup = f.totals.sup/2000, parts = [];
      if(hay >= 0.05) parts.push(fmt(hay, hay < 10 ? 1 : 0) + ' t hay');
      if(sup >= 0.05) parts.push(fmt(sup, sup < 10 ? 1 : 0) + ' t ' + (f.bcs && f.bcs.mode === 'full' ? 'suppl.' : 'protein'));
      $('st_feed').textContent = parts.length ? parts.join(' + ') : 'None';
      $('st_net').textContent = money(f.econ.net); $('st_net').className = f.econ.net >= 0 ? '' : 'bad';
    } else { $('st_feed').textContent = '—'; $('st_net').textContent = '—'; $('st_net').className = ''; }
    markSteps();
  }
  function bindSteps(){
    document.addEventListener('click', function(e){
      var g = e.target.closest && e.target.closest('[data-go]');
      if(g){ e.preventDefault(); showStep(g.getAttribute('data-go')); }
    });
    $('stripSaveBtn').addEventListener('click', function(){
      var p = $('filePanel'), open = p.hidden; p.hidden = !open; this.setAttribute('aria-expanded', String(open));
      if(open) p.scrollIntoView({behavior:'smooth', block:'nearest'});
    });
    $('stripPlanBtn').addEventListener('click', function(){ $('planBtn').click(); });
  }

  function init(){
    initThemeToggle();
    bindSettings();
    bindList();
    bindFeed();
    var ok = initMap();
    bindTools();
    if(!ok) document.querySelectorAll('.draw-tools .tool-btn, #locateBtn, #searchBtn').forEach(function(b){ b.disabled = true; });
    bindSteps();
    renderAll(true);
    showStep(firstStep(), true);
    state.pastures.forEach(function(p){ if(p.mode === 'soil' && isGrazed(p) && (!p.soil || p.soil.status === 'error')) scheduleSoil(p.id, 0); });
    if(state.pastures.length) refreshDroughtIfMoved(false);
    window.addEventListener('beforeprint', function(){ if(map) map.invalidateSize(); });
  }

  /* test hooks (read-only helpers; harmless in production) */
  window.MyRanch = {FEED:FEED, feed:function(){ return feedLast; }, netOf:function(a, b, c){ return netOf(a, b, c); }, herd:function(){ return state.herd; }, fit:fitRanch, drought:refreshDroughtIfMoved, polygonAcres:polygonAcres, summarizeSoil:summarizeSoil, soilQuery:soilQuery, state:function(){ return state; },
                    addPasture:function(g, p){ return addPasture(g, p, false); }, addPoint:addPoint, totals:totals, ranchContext:ranchContext, toKml:toKml, toGeoJSON:toGeoJSON, importObject:function(o){ var r = importObject(o); state.pastures.forEach(function(p){ if(!pastureLayers[p.id]){ drawPastureLayer(p); if(p.mode === 'soil' && isGrazed(p)) scheduleSoil(p.id, 0);} }); state.points.forEach(function(pt){ if(!pointLayers[pt.id]) drawPointLayer(pt); }); state.zones.forEach(function(z){ if(!zoneLayers[z.id]) drawZoneLayer(z); }); renderAll(true); return r; }, addZone:addZone, grassToday:grassToday, herdAU:herdAU, herdAUParts:herdAUParts, addPastureDrawn:function(g){ return addPasture(g, null, true); }, zoneAcres:function(id){ return zoneAcres(getPasture(id)); }, go:function(s){ showStep(s, true); }, step:function(){ return curStep; }};

  init();
})();
