import os
HERE=os.path.dirname(os.path.realpath(__file__)); REPO=os.path.abspath(os.path.join(HERE,'..','..')); OUT=os.path.join(HERE,'.out'); os.makedirs(OUT, exist_ok=True)
import json, re, threading, http.server, socketserver, os, functools, time, sys
from playwright.sync_api import sync_playwright

ROOT=REPO; NM=os.path.join(HERE,'node_modules')
PORT=8765
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(socketserver.TCPServer): allow_reuse_address=True
httpd=Q(('127.0.0.1',PORT),type('H',(Handler.func,),{'log_message':lambda *a:None}) if False else Handler)
threading.Thread(target=httpd.serve_forever,daemon=True).start()

CDN={'leaflet@1.9.4/dist/leaflet.js':'leaflet/dist/leaflet.js','leaflet@1.9.4/dist/leaflet.css':'leaflet/dist/leaflet.css',
'@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.min.js':'@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.min.js',
'@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css':'@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css',
'@tmcw/togeojson@5.8.1/dist/togeojson.umd.js':'@tmcw/togeojson/dist/togeojson.umd.js',
'shpjs@4.0.4/dist/shp.min.js':'shpjs/dist/shp.min.js','polygon-clipping@0.15.7/dist/polygon-clipping.umd.min.js':'polygon-clipping/dist/polygon-clipping.umd.min.js','jszip@3.10.1/dist/jszip.min.js':'jszip/dist/jszip.min.js'}
PNG=bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'+'1f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d0e1a10000000049454e44ae426082')
SOIL={"Table":[["mukey","area_m2","muname","cokey","compname","comppct_r","rsprod_l","rsprod_r","rsprod_h","ecoclassid","ecoclassname"],
 ["111","600000","Clay loam, 1 to 3 percent slopes","1","Clayloam","85","2000","3000","3800","R078CY096TX","Clay Loam 23-30\" PZ"],
 ["111","600000","Clay loam, 1 to 3 percent slopes","2","Minor","15",None,None,None,None,None],
 ["222","400000","Tillman clay loam","3","Tillman","90","1500","2500","3200","R078CY096TX","Clay Loam 23-30\" PZ"]]}
EXPECTED=(600000*.85*3000+400000*.9*2500)/(600000*.85+400000*.9)
soil_requests=[]; soil_ct=[]; jim_bodies=[]; drought_requests=[]; fails=[]
def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ')+name+(' — '+str(detail) if detail!='' else ''))
    if not cond: fails.append(name)

def route(r):
    u=r.request.url
    if 'cdn.jsdelivr.net/npm/' in u:
        k=u.split('/npm/')[1]
        if k.startswith('leaflet@1.9.4/dist/images/'):
            return r.fulfill(status=200, body=open(os.path.join(NM,'leaflet/dist/images/',k.split('/')[-1]),'rb').read(), headers={'content-type':'image/png'})
        if k in CDN:
            p=os.path.join(NM,CDN[k]); ct='text/css' if p.endswith('.css') else 'application/javascript'
            return r.fulfill(status=200, body=open(p,'rb').read(), headers={'content-type':ct,'access-control-allow-origin':'*'})
        return r.fulfill(status=404, body='')
    if 'sdmdataaccess' in u.lower():
        import urllib.parse as _u; soil_requests.append(_u.parse_qs(r.request.post_data or '').get('query',[''])[0]); soil_ct.append(r.request.headers.get('content-type',''))
        return r.fulfill(status=200, body=json.dumps(SOIL), headers={'content-type':'application/json','access-control-allow-origin':'*'})
    if 'US_Drought_Intensity' in u:
        drought_requests.append(u)
        return r.fulfill(status=200, body=json.dumps({"features":[{"attributes":{"dm":0,"ddate":1758240000000}},{"attributes":{"dm":2,"ddate":1758240000000}}]}), headers={'content-type':'application/json','access-control-allow-origin':'*'})
    if 'nominatim' in u:
        return r.fulfill(status=200, body=json.dumps([{"display_name":"Throckmorton, Throckmorton County, Texas, United States","lat":"33.18","lon":"-99.18","boundingbox":["33.17","33.19","-99.19","-99.17"]}]), headers={'content-type':'application/json','access-control-allow-origin':'*'})
    if 'arcgisonline' in u or 'openstreetmap.org/' in u and '.png' in u:
        return r.fulfill(status=200, body=PNG, headers={'content-type':'image/png'})
    if 'workers.dev' in u:
        jim_bodies.append(r.request.post_data or '')
        return r.fulfill(status=200, body='event: text\ndata: {"text":"ok"}\n\nevent: done\ndata: {}\n\n', headers={'content-type':'text/event-stream','access-control-allow-origin':'*'})
    if u.startswith('http://127.0.0.1'): return r.continue_()
    return r.abort()

with sync_playwright() as pw:
    b=pw.chromium.launch()
    ctx=b.new_context(viewport={'width':1360,'height':1300}, accept_downloads=True)
    ctx.route('**/*', route)
    page=ctx.new_page(); errs=[]
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    page.on('dialog', lambda d: d.accept())
    page.goto(f'http://127.0.0.1:{PORT}/my-ranch/index.html'); page.wait_for_timeout(800)
    check('map initialised', page.evaluate("!!document.querySelector('#map.leaflet-container')"))
    check('draw buttons hidden when idle', not page.is_visible('#finishBtn'))
    check('empty-state steps shown', 'Draw each pasture' in page.inner_text('#summaryBody'))

    # search
    page.fill('#searchInput','Throckmorton'); page.click('#searchBtn'); page.wait_for_selector('#searchResults button')
    page.click('#searchResults button'); page.wait_for_timeout(500)
    z=page.evaluate("MyRanch.state()"); 
    # coordinate search
    page.fill('#searchInput','33.18, -99.25'); page.press('#searchInput','Enter'); page.wait_for_timeout(500)

    # draw a pasture by clicking
    page.click('#drawPastureBtn')
    box=page.locator('#map').bounding_box()
    cx,cy=box['x']+box['width']/2, box['y']+box['height']/2
    pts=[(cx-150,cy-100),(cx+150,cy-110),(cx+170,cy+100),(cx-140,cy+120)]
    for (x,y) in pts: page.mouse.click(x,y); page.wait_for_timeout(120)
    check('finish/undo buttons visible while drawing', page.is_visible('#finishBtn') and page.is_visible('#undoPointBtn'))
    page.click('#finishBtn'); page.wait_for_timeout(1200)
    st=page.evaluate("MyRanch.state()")
    check('pasture created by drawing', len(st['pastures'])==1, len(st['pastures']))
    p=st['pastures'][0]
    check('drawn pasture has acres', p['acres']>1, round(p['acres'],1))
    check('soil request sent with clip macros + WKT', soil_requests and 'GetClippedMapunits' in soil_requests[0] and 'POLYGON((' in soil_requests[0])
    check('soil request is form-encoded (no preflight)', soil_ct and soil_ct[0].startswith('application/x-www-form-urlencoded'), soil_ct[:1])
    check('soil estimate weighted correctly', p['soil'] and p['soil']['status']=='ok' and abs(p['soil']['normal']-EXPECTED)<1e-6, (p['soil'] or {}).get('normal'))
    expected_cap=p['acres']*EXPECTED*0.75*0.25/(26*365)
    tot=page.evaluate("MyRanch.totals()")
    check('capacity = acres*lb*25%/(26*365)', abs(tot['cap']-expected_cap)<1e-6, (round(tot['cap'],3), round(expected_cap,3)))
    check('drought D2 shown', 'D2' in page.inner_text('#summaryBody') and 'Severe drought' in page.inner_text('#summaryBody'))
    check('pasture label on map', page.locator('.leaflet-tooltip.pasture-label').count()==1)

    # rename + herd
    page.fill('.pasture-row .p-name','North trap'); page.fill('#hd_cows', '3')
    page.wait_for_timeout(200)
    check('over-capacity verdict', 'over estimated capacity' in page.inner_text('#summaryBody'))
    check('label follows rename', 'North trap' in page.inner_text('.leaflet-tooltip.pasture-label'))
    rot=page.inner_text('#rotationBody')
    check('rotation days shown', 'days' in rot and 'short of a full year' in rot, rot[:120])
    days=page.evaluate("(()=>{const s=MyRanch.state(),p=s.pastures[0];const au=MyRanch.herdAU();return p.acres*p.soil.normal*0.75*0.25/(au*26)})()")
    check('grazing days math', str(round(days)) in rot.replace(',',''), round(days))
    bud=page.text_content('#budgetBody')
    check('budget benchmark uses capacity when herd larger', 'budget gross margin' in bud.lower() and 'your estimated capacity carries (you plan' in bud, bud[:250])

    # manual estimate path
    page.select_option('.pasture-row .p-mode','manual'); page.wait_for_timeout(150)
    page.fill('.pasture-row .p-manual','4000'); page.wait_for_timeout(150)
    tot2=page.evaluate("MyRanch.totals()")
    check('manual estimate drives capacity', abs(tot2['cap']-p['acres']*4000*0.25/(26*365))<1e-6)
    page.select_option('.pasture-row .p-mode','soil'); page.wait_for_timeout(300)

    # harvest efficiency edit
    page.fill('#harvestEff','30'); page.wait_for_timeout(150)
    tot3=page.evaluate("MyRanch.totals()")
    check('harvest efficiency applied', abs(tot3['cap']-p['acres']*EXPECTED*0.75*0.30/(26*365))<1e-6)
    page.fill('#harvestEff','25')


    # ---------------- feed calendar
    page.fill('#hd_cows','3'); page.wait_for_timeout(300)
    check('ecological site shown in soil table', 'Clay Loam 23-30' in page.inner_text('#pastureList'))
    check('region auto from MLRA 078C', 'Rolling Plains' in page.inner_text('#fc_region') and '078C' in page.inner_text('#fc_regionHint'), page.inner_text('#fc_regionHint'))
    check('feed chart has 12 months', page.locator('#fc_chart .hit').count()==12)
    fl=page.evaluate("MyRanch.feed()")
    check('feed monthly totals add up', abs(sum(m['hayLb'] for m in fl['months'])-fl['totals']['hay'])<1e-6 and abs(sum(m['cost'] for m in fl['months'])-fl['totals']['cost'])<1e-6)
    check('no hay when pasture covers the month', all(m['hayLb']<1e-6 for m in fl['months'] if m['pastureShare']>=0.999999))
    check('pasture share within 0..1', all(0<=m['pastureShare']<=1 for m in fl['months']))
    check('tiles show cattle sales', 'cattle sales' in page.inner_text('#fc_tiles').lower() and 'minus feed' in page.inner_text('#fc_tiles').lower())
    check('US calving default hides dates', not page.is_visible('#fc_start1'))
    page.select_option('#fc_calving','one'); page.wait_for_timeout(200)
    check('one season shows dates', page.is_visible('#fc_start1') and not page.is_visible('#fc_start2'))
    before=page.evaluate("MyRanch.feed().months.map(m=>m.req.cow.tdn)")
    page.fill('#fc_start1','2026-09-15'); page.dispatch_event('#fc_start1','change'); page.wait_for_timeout(200)
    after=page.evaluate("MyRanch.feed().months.map(m=>m.req.cow.tdn)")
    check('changing calving date shifts the curve', before!=after and after[11]>after[5], (round(after[5],1), round(after[11],1)))

    # NRC 2016 weather adjustments
    page.evaluate("document.querySelectorAll('#fc_herdDetails, details.advanced').forEach(d=>d.open=true)"); page.wait_for_timeout(100)
    on=page.evaluate("MyRanch.feed().months.map(m=>m.req.cow.tdn)")
    check('weather column shown', 'weather' in page.inner_text('#fc_perhead').lower() and 'NRC 2016' in page.inner_text('#fc_wxNote'), page.inner_text('#fc_wxNote'))
    page.select_option('#fc_weatherAdj','off'); page.wait_for_timeout(200)
    off=page.evaluate("MyRanch.feed().months.map(m=>m.req.cow.tdn)")
    check('weather raises January need', on[0]>off[0], (round(on[0],2), round(off[0],2)))
    check('weather off note', 'off' in page.inner_text('#fc_wxNote'))
    page.select_option('#fc_weatherAdj','on'); page.select_option('#fc_coat','4'); page.wait_for_timeout(200)
    wet=page.evaluate("MyRanch.feed().months.map(m=>m.req.cow.tdn)")
    check('wet coat raises winter need', wet[0]>on[0], (round(wet[0],2), round(on[0],2)))
    page.select_option('#fc_coat','1'); page.wait_for_timeout(150)
    # replacements, culls, body condition, seasonal prices
    fe=page.evaluate("MyRanch.feed()")
    check('heifers kept and fed', fe['econ']['heifersKept']>0 and any(m['req']['heifer']['n']>0 for m in fe['months']) and fe['econ']['cullIncome']>0, fe['econ']['heifersKept'])
    check('replacement note', 'heifer calves' in page.inner_text('#fc_replNote'))
    page.fill('#fc_replRate','0'); page.wait_for_timeout(250)
    f0=page.evaluate("MyRanch.feed()")
    check('no replacements: no heifers, no culls', f0['econ']['heifersKept']==0 and f0['econ']['cullIncome']==0 and all(m['req']['heifer']['n']==0 for m in f0['months']))
    page.fill('#fc_replRate','15'); page.wait_for_timeout(250)
    before=page.evaluate("MyRanch.feed().months.map(m=>m.req.cow.tdn)")
    page.select_option('#fc_bcsWean','4'); page.wait_for_timeout(300)
    after=page.evaluate("MyRanch.feed().months.map(m=>m.req.cow.tdn)")
    check('thin cows at weaning need more energy', sum(after)>sum(before) and 'Putting back' in page.inner_text('#fc_bcsHint'), page.inner_text('#fc_bcsHint'))
    page.select_option('#fc_bcsWean','0'); page.wait_for_timeout(250)
    check('seasonal prices off by default', page.input_value('#fc_seasonal')=='off')
    p_off=page.evaluate("MyRanch.feed().econ.calfIncome")
    page.select_option('#fc_seasonal','on'); page.wait_for_timeout(250)
    p_on=page.evaluate("MyRanch.feed().econ.calfIncome")
    check('seasonal prices change calf income', abs(p_on-p_off)>1, (round(p_on), round(p_off)))
    page.select_option('#fc_seasonal','off'); page.wait_for_timeout(200)
    page.click('#fc_bcuBtn'); page.wait_for_timeout(150)
    rf=page.evaluate("JSON.parse(localStorage.getItem('tamuDecisionAidsRanchFeed'))")
    fe2=page.evaluate("MyRanch.feed()"); cows=page.evaluate("MyRanch.state().herd.cows")
    check('feed cost sent to BCU', rf and abs(rf['total']-(fe2['totals']['feed']+fe2['totals']['tripCost']+fe2['totals']['dist'])/cows)<0.05 and 'Sent' in page.inner_text('#fc_bcuNote'), rf)
    page.select_option('#fc_calving','two'); page.wait_for_timeout(200)
    check('two seasons shows fall fields', page.is_visible('#fc_start2') and page.is_visible('#fc_share2'))
    page.select_option('#fc_calving','us'); page.wait_for_timeout(200)
    page.click('.seg-btn[data-nutrient="cp"]'); page.wait_for_timeout(150)
    check('protein toggle', 'crude protein' in page.inner_text('#fc_legend'))
    page.hover('#fc_chart .hit >> nth=0'); page.wait_for_timeout(150)
    tt=page.inner_text('#fcTooltip')
    check('chart tooltip', 'Jan' in tt and 'Needs' in tt, tt[:80])
    page.click('.seg-btn[data-nutrient="tdn"]')
    c1=page.evaluate("MyRanch.feed().totals.cost")
    page.evaluate("document.querySelectorAll('details.advanced').forEach(d=>d.open=true)")
    page.fill('#fc_hayPrice','400'); page.wait_for_timeout(200)
    c2=page.evaluate("MyRanch.feed().totals")
    check('hay price changes cost', c2['cost']>c1 or c2['hay']==0, (c1, c2['cost']))
    page.select_option('#fc_source','cube38'); page.wait_for_timeout(150)
    check('38% source preset', page.input_value('#fc_supCp')=='38' and '$' in page.inner_text('#fc_perLbCp'))
    page.click('#fc_reset'); page.wait_for_timeout(150)
    check('reset details', page.input_value('#fc_hayPrice')=='200' and page.input_value('#fc_supCp')=='20')
    check('per-head table 12 rows', page.locator('#fc_perhead tbody tr').count()==12)
    check('AU note', 'animal units' in page.inner_text('#hd_auNote'))
    aup=page.evaluate("MyRanch.herdAUParts()")
    check('AU by metabolic weight (1,200 lb cow = 1.15)', abs(aup['cowAue']-1.2**0.75)<1e-9 and abs(aup['bullAue']-(page.evaluate("MyRanch.state().herd.bullLb")/1000)**0.75)<1e-9 and '1.15' in page.inner_text('#hd_auNote'), page.inner_text('#hd_auNote'))
    check('calves older than 6 months add AU', aup['calves']>0 and abs(aup['total']-(aup['cows']+aup['bulls']+aup['calves']+aup['heifers']))<1e-9 and aup['heifers']>0, aup)

    # ---------------- new round: land, losses, weaning, decisions
    pid=page.evaluate("MyRanch.state().pastures[0].id")
    cap_fair=page.evaluate("MyRanch.totals().cap")
    page.select_option('.pasture-row >> nth=0 >> .p-condition','excellent'); page.wait_for_timeout(200)
    cap_exc=page.evaluate("MyRanch.totals().cap")
    check('condition excellent = 90/75 of fair', abs(cap_exc/cap_fair-0.9/0.75)<1e-6, (cap_fair,cap_exc))
    page.select_option('.pasture-row >> nth=0 >> .p-condition','fair'); page.wait_for_timeout(150)
    zone_js = """(t)=>{const p=MyRanch.state().pastures[0];const r=p.geometry.coordinates[0];let xs=r.map(c=>c[0]),ys=r.map(c=>c[1]);
      const cx=(Math.min(...xs)+Math.max(...xs))/2, cy=(Math.min(...ys)+Math.max(...ys))/2, dx=(Math.max(...xs)-Math.min(...xs))*0.1, dy=(Math.max(...ys)-Math.min(...ys))*0.1;
      MyRanch.addZone(t,{type:'Polygon',coordinates:[[[cx-dx,cy-dy],[cx+dx,cy-dy],[cx+dx,cy+dy],[cx-dx,cy+dy],[cx-dx,cy-dy]]]}); return 1;}"""
    page.evaluate(zone_js,'water'); page.wait_for_timeout(250)
    za=page.evaluate("(id)=>MyRanch.zoneAcres(id)", pid)
    cap_pond=page.evaluate("MyRanch.totals().cap")
    check('pond clipped inside pasture', za['water']>0.1 and cap_pond<cap_fair, (za, cap_fair, cap_pond))
    check('pond removes its share of forage', abs(cap_pond/cap_fair - (1-za['water']/page.evaluate("MyRanch.state().pastures[0].acres")))<1e-3)
    check('zone listed and shown in pasture row', 'Pond / lake' in page.inner_text('#zoneList') and 'pond/lake' in page.inner_text('#pastureList'))
    check('pond counts as water for distance', 'from water' in page.inner_text('#pastureList'))
    zid=page.evaluate("MyRanch.state().zones[0].id")
    page.select_option('.zone-type','bottom'); page.wait_for_timeout(200)
    cap_bot=page.evaluate("MyRanch.totals().cap")
    check('bottomland adds forage (200%)', cap_bot>cap_fair, (cap_fair,cap_bot))
    page.select_option('.zone-type','brush'); page.wait_for_timeout(200)
    cap_br=page.evaluate("MyRanch.totals().cap")
    check('brush cuts forage (25%)', cap_br<cap_fair and cap_br>cap_pond)
    gj2=page.evaluate("MyRanch.toGeoJSON()")
    check('zone exported', any(f['properties'].get('zone_type')=='brush' for f in gj2['features']))
    page.click('[data-del-zone]'); page.wait_for_timeout(200)
    check('zone deleted', page.evaluate("MyRanch.state().zones.length")==0 and abs(page.evaluate("MyRanch.totals().cap")-cap_fair)<1e-6)
    # a pond drawn with "Draw pasture" inside a pasture: offer to convert it
    npast=page.evaluate("MyRanch.state().pastures.length")
    page.evaluate(zone_js.replace("MyRanch.addZone(t,","MyRanch.addPastureDrawn("),'water'); page.wait_for_timeout(300)
    check('pasture inside pasture flagged', page.is_visible('#zoneOffer') and 'counted twice' in page.inner_text('#zoneOffer') and 'Overlaps' in page.inner_text('#pastureList'), page.inner_text('#zoneOffer'))
    page.click('#zoneOffer [data-to-zone="water"]'); page.wait_for_timeout(300)
    check('converted to pond: capacity drops, no extra pasture', page.evaluate("MyRanch.state().pastures.length")==npast and page.evaluate("MyRanch.state().zones.length")==1 and page.evaluate("MyRanch.totals().cap")<cap_fair and not page.is_visible('#zoneOffer'))
    page.click('[data-del-zone]'); page.wait_for_timeout(200)
    check('capacity meter uses fixed log scale', page.locator('#summaryBody .meter.log .meter-tick.cap').count()==1 and '1,000' in page.inner_text('#summaryBody .meter-scale') and 'cows' in page.inner_text('#summaryBody .meter-note'))
    page.fill('#manualCap','50'); page.wait_for_timeout(250)
    check('manual capacity used', abs(page.evaluate("MyRanch.totals().cap")-50)<1e-9 and '50' in page.inner_text('#summaryBody'))
    fm=page.evaluate("MyRanch.feed()")
    check('feed supply scaled to manual capacity', all(m['pastureShare']>=0.999 for m in fm['months']))
    page.fill('#manualCap',''); page.wait_for_timeout(250)
    # losses & weaning
    page.fill('#hd_cows','40'); page.wait_for_timeout(300)
    e0=page.evaluate("MyRanch.feed().econ")
    page.fill('#fc_calfLoss','12'); page.wait_for_timeout(250)
    e1=page.evaluate("MyRanch.feed().econ")
    check('higher calf loss = fewer calves sold', e1['calvesSold']<e0['calvesSold'])
    page.fill('#fc_calfLoss','6.4'); page.wait_for_timeout(200)
    page.select_option('#fc_calving','one'); page.wait_for_timeout(200)
    page.fill('#fc_start1','2026-06-01'); page.dispatch_event('#fc_start1','change')
    page.fill('#fc_wean1','2027-01-01'); page.dispatch_event('#fc_wean1','change'); page.wait_for_timeout(300)
    check('weaning date gives ages', 'days old at weaning' in page.inner_text('#fc_weanNote'), page.inner_text('#fc_weanNote'))
    e2=page.evaluate("MyRanch.feed().econ")
    page.select_option('#fc_nws','yes'); page.wait_for_timeout(250)
    e3=page.evaluate("MyRanch.feed().econ")
    check('screwworm adds deaths for summer calving', e3['deadNws']>0 and e3['calvesSold']<e2['calvesSold'] and e3['nwsCare']>0, (e3['deadNws'], e3['nwsCare']))
    check('screwworm fields shown', page.is_visible('#fc_nwsLoss'))
    page.select_option('#fc_hornFly','15'); page.wait_for_timeout(250)
    e4=page.evaluate("MyRanch.feed().econ")
    check('horn flies cut summer weaning weight', e4['avgWeanLb']<e3['avgWeanLb'], (e3['avgWeanLb'], e4['avgWeanLb']))
    page.select_option('#fc_hornFly','0'); page.select_option('#fc_nws','no'); page.wait_for_timeout(200)
    page.fill('#fc_weanPeriod','0'); page.wait_for_timeout(250)
    e5=page.evaluate("MyRanch.feed().econ")
    check('weaning period 0: sold at weaning weight', abs(e5['avgSaleLb']-e5['avgWeanLb'])<1e-6)
    page.fill('#fc_weanPeriod','45'); page.wait_for_timeout(250)
    e6=page.evaluate("MyRanch.feed().econ")
    check('weaning period adds weight', abs(e6['avgSaleLb']-e6['avgWeanLb']-45*1.5)<1e-6)
    wcn=page.evaluate("MyRanch.feed().months.reduce((a,m)=>a+m.req.weaned.n,0)")
    check('weaned calves appear in calendar', wcn>0)
    # decisions
    page.evaluate("document.getElementById('decCard').scrollIntoView()"); page.wait_for_timeout(600)
    check('best calving season computed', page.locator('#dec_calvChart .pc-bar').count()==12 and 'Best time to calve' in page.inner_text('#dec_calvText') and 'least bought feed' in page.inner_text('#dec_calvText'), page.inner_text('#dec_calvText')[:120])
    check('calving table 12 rows', page.locator('#dec_calvTable tbody tr').count()==12)
    check('calving economics after production', page.locator('#dec_calvEconChart .dec-dot').count()==12 and 'leaves the most' in page.inner_text('#dec_calvEconText') and page.locator('#dec_calvEconTable tbody tr').count()==12)
    ev=page.inner_text('#dec_calvEconTable')
    check('seasonal prices by sale month by default', 'month they' in page.inner_text('#dec_calvEconText') and len(set(l.split('\t')[3] for l in ev.split('\n')[1:] if l.count('\t')>=4))>2, ev[:300])
    page.select_option('#dec_calvPrice','flat'); page.wait_for_timeout(900)
    check('flat price option', 'today’s market prices' in page.inner_text('#dec_calvEconText'))
    page.select_option('#dec_calvPrice','season'); page.wait_for_timeout(900)
    page.click('.seg-btn[data-dec="drought"]'); page.wait_for_timeout(700)
    check('drought: three options', page.locator('.dec-drtable thead th').count()==4 and page.locator('.dec-drtable thead th.best').count()==1, page.inner_text('#dec_drText')[:150])
    before_dr=page.inner_text('#dec_drOptions')
    page.fill('#dr_cut','90'); page.wait_for_timeout(700)
    check('drought inputs recompute', page.inner_text('#dec_drOptions')!=before_dr)
    page.click('.seg-btn[data-dec="whatif"]'); page.wait_for_timeout(900)
    check('what-if rows', page.locator('.wi-row').count()>=8)
    page.click('.seg-btn[data-dec="calving"]'); page.wait_for_timeout(300)
    # trips
    page.fill('#manualCap','5'); page.wait_for_timeout(300)
    t3=page.evaluate("MyRanch.feed().totals")
    page.select_option('#fc_supTrips','7'); page.wait_for_timeout(300)
    t7=page.evaluate("MyRanch.feed().totals")
    check('daily feeding costs more trips', t7['tripCost']>t3['tripCost'] if t3['sup']>1 or t3['hay']>1 else True, (t3['tripCost'], t7['tripCost']))
    page.select_option('#fc_supTrips','3'); page.fill('#manualCap',''); page.wait_for_timeout(300)
    # grazing calendar, measured forage, one-page plan
    sy=page.evaluate("window.scrollY")
    check('grazing calendar drawn', page.locator('#grazingPlan svg .gp-name').count()==page.evaluate("MyRanch.state().pastures.filter(p=>p.type!=='none').length") or page.locator('#grazingPlan svg .gp-name').count()>0, page.locator('#grazingPlan svg .gp-name').count())
    hay0=page.evaluate("MyRanch.feed().totals.hay")
    page.evaluate("document.querySelectorAll('.p-measure').forEach(d=>d.open=true)")
    page.select_option('.pasture-row .p-measMonth', '0'); page.fill('.pasture-row .p-meas', '6000'); page.wait_for_timeout(400)
    hay1=page.evaluate("MyRanch.feed().totals.hay")
    check('measured forage in January cuts winter hay', hay1<hay0, (round(hay0), round(hay1)))
    gj=json.loads(page.evaluate("MyRanch.toGeoJSON()")) if isinstance(page.evaluate("MyRanch.toGeoJSON()"), str) else page.evaluate("MyRanch.toGeoJSON()")
    check('measured forage exported', any(f['properties'].get('measured_lb_ac')==6000 for f in gj['features']))
    page.fill('.pasture-row .p-meas', ''); page.wait_for_timeout(300)
    page.evaluate("window.__printed=0; window.__stk=[]; window.print=function(){ window.__printed++; window.__stk.push(new Error().stack.slice(0,300)); }; 0")
    page.click('#fc_planBtn'); page.wait_for_timeout(1500)
    ps=page.inner_text('#planSheet') if page.locator('#planSheet').count() else ''
    check('one-page plan built', 'plan for the year' in page.evaluate("document.getElementById('planSheet').textContent") and page.locator('#planSheet .ps-table tbody tr').count()==12 and page.evaluate("window.__printed")==1, (page.locator('#planSheet .ps-table tbody tr').count(), page.evaluate("window.__printed"), page.evaluate("window.__stk")))
    page.emulate_media(media='print')
    check('plan prints alone', page.is_visible('#planSheet') and not page.is_visible('#map'))
    page.evaluate("window.dispatchEvent(new Event('afterprint'))"); page.emulate_media(media='screen'); page.wait_for_timeout(200)
    check('plan hidden on screen', not page.is_visible('#planSheet'))
    page.evaluate("(y)=>window.scrollTo(0,y)", sy); page.wait_for_timeout(200)
    # print
    page.emulate_media(media='print'); page.evaluate("window.dispatchEvent(new Event('beforeprint'))"); page.wait_for_timeout(1200)
    check('print shows energy and protein charts', page.is_visible('#fc_chart_p_tdn svg') and page.is_visible('#fc_chart_p_cp svg'))
    check('print shows all decision panels', page.is_visible('#dec_drought') and page.is_visible('#dec_whatif'))
    page.pdf(path=os.path.join(OUT,'my-ranch-print.pdf'), format='Letter', print_background=True)
    page.emulate_media(media='screen')
    ctxt0=page.evaluate("MyRanch.ranchContext()")
    check('Jim context has feed calendar', 'Feed calendar' in ctxt0 and 'Yearly purchased feed' in ctxt0)

    # water point
    page.click('[data-point="water"]'); page.mouse.click(cx+10,cy+10); page.wait_for_timeout(300)
    st=page.evaluate("MyRanch.state()")
    check('water point added', len(st['points'])==1 and st['points'][0]['type']=='water')
    check('distance to water shown', 'from water' in page.inner_text('#pastureList'))

    # rectangle
    page.locator('#map').scroll_into_view_if_needed(); rb=page.locator('#map').bounding_box()
    page.click('#drawRectBtn'); page.mouse.click(rb['x']+90,rb['y']+120); page.wait_for_timeout(100); page.mouse.click(rb['x']+190,rb['y']+190); page.wait_for_timeout(800)
    st=page.evaluate("MyRanch.state()")
    check('rectangle pasture added', len(st['pastures'])==2, len(st['pastures']))

    # change land use to not grazed
    page.locator('.pasture-row').nth(1).locator('.p-type').select_option('other'); page.wait_for_timeout(200)
    t4=page.evaluate("MyRanch.totals()")
    check('non-grazed excluded from grazed acres', t4['grazedAcres'] < t4['acres'])

    # reorder
    page.locator('#rotationBody [data-move]').first.wait_for()
    # import GeoJSON + KML
    gj={"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"East side","land_use":"improved","forage_source":"manual","forage_lb_ac":5000},"geometry":{"type":"Polygon","coordinates":[[[-99.24,33.17],[-99.235,33.17],[-99.235,33.175],[-99.24,33.175],[-99.24,33.17]]]}},{"type":"Feature","properties":{"name":"Stock tank"},"geometry":{"type":"Point","coordinates":[-99.237,33.172]}},{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[-99.2,33.1],[-99.21,33.11]]}}]}
    open('/tmp/claude-0/t.geojson','w').write(json.dumps(gj)) if os.path.isdir('/tmp/claude-0') else None
    os.makedirs(OUT,exist_ok=True)
    open(os.path.join(OUT,'test.geojson'),'w').write(json.dumps(gj))
    page.set_input_files('#fileInput',os.path.join(OUT,'test.geojson')); page.wait_for_timeout(700)
    note=page.inner_text('#fileNotice')
    check('geojson import message', 'Added 1 pasture and 1 point' in note and 'Skipped 1' in note, note)
    st=page.evaluate("MyRanch.state()")
    east=[x for x in st['pastures'] if x['name']=='East side'][0]
    check('imported land use + manual forage kept', east['type']=='improved' and east['mode']=='manual' and east['manual']==5000)
    check('stock tank recognised as water', any(x['type']=='water' and x['name']=='Stock tank' for x in st['points']))
    kml='''<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>West pasture</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-99.27,33.17,0 -99.26,33.17,0 -99.26,33.18,0 -99.27,33.18,0 -99.27,33.17,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>'''
    open(os.path.join(OUT,'test.kml'),'w').write(kml)
    page.set_input_files('#fileInput',os.path.join(OUT,'test.kml')); page.wait_for_timeout(1200)
    st=page.evaluate("MyRanch.state()")
    check('kml import', any(x['name']=='West pasture' for x in st['pastures']), page.inner_text('#fileNotice'))
    # kmz
    import zipfile
    with zipfile.ZipFile(os.path.join(OUT,'test.kmz'),'w') as z: z.writestr('doc.kml', kml.replace('West pasture','Zipped pasture'))
    page.set_input_files('#fileInput',os.path.join(OUT,'test.kmz')); page.wait_for_timeout(1200)
    st=page.evaluate("MyRanch.state()")
    check('kmz import', any(x['name']=='Zipped pasture' for x in st['pastures']), page.inner_text('#fileNotice'))
    # bad file
    open(os.path.join(OUT,'bad.txt'),'w').write('hello')
    page.set_input_files('#fileInput',os.path.join(OUT,'bad.txt')); page.wait_for_timeout(300)
    check('bad file rejected politely', 'Use a .kml' in page.inner_text('#fileNotice'))

    # export round-trip
    if not page.is_visible('#exportGeoBtn'): page.click('#stripSaveBtn'); page.wait_for_timeout(200)
    with page.expect_download() as d: page.click('#exportGeoBtn')
    path=d.value.path(); exported=json.load(open(path))
    check('geojson export has pastures+points', sum(1 for f in exported['features'] if f['geometry']['type']=='Polygon')==len(st['pastures']) and any(f['geometry']['type']=='Point' for f in exported['features']))
    with page.expect_download() as d2: page.click('#exportKmlBtn')
    k=open(d2.value.path()).read()
    check('kml export well-formed', k.count('<Placemark>')==len(st['pastures'])+len(st['points']) and '<outerBoundaryIs>' in k)
    rt=page.evaluate("(k)=>{const d=new DOMParser().parseFromString(k,'text/xml');return d.getElementsByTagName('parsererror').length}", k)
    check('kml parses as XML', rt==0)

    # Jim context
    ctxt=page.evaluate("MyRanch.ranchContext()")
    check('Jim context lists pastures + capacity', 'North trap' in ctxt and 'carrying capacity' in ctxt and 'Drought Monitor' in ctxt, ctxt[:200])
    check('Jim is not on My Ranch', page.locator('.jim-root, #jimCard, script[src*="jim.js"]').count()==0)

    # persistence
    n=len(st['pastures'])
    page.reload(); page.wait_for_timeout(1200)
    st2=page.evaluate("MyRanch.state()")
    check('pastures persist after reload', len(st2['pastures'])==n and st2['herd']['cows']==40)
    check('layers redrawn after reload', page.locator('.leaflet-tooltip.pasture-label').count()==n)

    # edit mode toggles
    page.click('#editBtn'); page.wait_for_timeout(200)
    check('edit mode on', 'Done editing' in page.inner_text('#editBtn') and page.locator('.marker-icon').count()>0)
    # drag a vertex to change acres
    before=page.evaluate("MyRanch.state().pastures[0].acres")
    h=page.locator('.marker-icon:not(.marker-icon-middle)').first
    hb=h.bounding_box(); page.mouse.move(hb['x']+hb['width']/2,hb['y']+hb['height']/2); page.mouse.down(); page.mouse.move(hb['x']-60,hb['y']-60,steps=6); page.mouse.up(); page.wait_for_timeout(1500)
    after=page.evaluate("MyRanch.state().pastures[0].acres")
    check('dragging a corner updates acres', abs(after-before)>0.01, (round(before,2), round(after,2)))
    page.click('#editBtn')

    page.screenshot(path=os.path.join(OUT,'light.png'), full_page=True)
    page.click('#themeToggle'); page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(OUT,'dark.png'), full_page=True)
    page.click('#themeToggle')

    # soil failure path
    ctx2=b.new_context(viewport={'width':390,'height':844})
    def route2(r):
        if 'sdmdataaccess' in r.request.url.lower(): return r.abort()
        return route(r)
    ctx2.route('**/*', route2)
    pg=ctx2.new_page(); e2=[]; pg.on('pageerror', lambda e: e2.append(str(e)))
    pg.goto(f'http://127.0.0.1:{PORT}/my-ranch/index.html'); pg.wait_for_timeout(600)
    pg.evaluate("MyRanch.addPasture({type:'Polygon',coordinates:[[[-99.3,33.1],[-99.29,33.1],[-99.29,33.11],[-99.3,33.11],[-99.3,33.1]]]},{name:'Test'})")
    pg.wait_for_timeout(800)
    check('soil failure shows friendly message', 'soil lookup failed' in pg.inner_text('#pastureList').lower())
    check('mobile: no horizontal scroll', pg.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    pg.screenshot(path=os.path.join(OUT,'mobile.png'), full_page=True)
    check('no JS errors (mobile)', not e2, e2)

    # no-soil-data path
    SOIL_BAK=SOIL['Table']; SOIL['Table']=[SOIL_BAK[0],["333","500000","Urban land","9","Urban","100",None,None,None,None,None]]
    ctx3=b.new_context(); ctx3.route('**/*', route); pg3=ctx3.new_page()
    pg3.goto(f'http://127.0.0.1:{PORT}/my-ranch/index.html'); pg3.wait_for_timeout(500)
    pg3.evaluate("MyRanch.addPasture({type:'Polygon',coordinates:[[[-99.3,33.1],[-99.29,33.1],[-99.29,33.11],[-99.3,33.11],[-99.3,33.1]]]},{name:'Town'})"); pg3.wait_for_timeout(600)
    check('no range data explained', 'no range forage data' in pg3.inner_text('#pastureList').lower())
    SOIL['Table']=SOIL_BAK

    real=[e for e in errs if 'fonts.g' not in e and 'workers.dev' not in e and 'ERR_FAILED' not in e]
    check('no JS errors (desktop)', not real, real[:5])
    # portal preview
    page.goto(f'http://127.0.0.1:{PORT}/index.html'); page.wait_for_timeout(500)
    b.close()
print('\n%d failures' % len(fails)); sys.exit(1 if fails else 0)
