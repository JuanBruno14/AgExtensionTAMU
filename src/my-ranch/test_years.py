import os
HERE=os.path.dirname(os.path.realpath(__file__))
__file__=os.path.join(HERE,'test_ranch.py')
exec(open(__file__).read().split('with sync_playwright() as pw:')[0].replace('PORT=8765','PORT=8786'))
# Satellite forage record (Rangeland Analysis Platform), the plan run year by year, "what to measure first", a second herd and
# rest periods in the grazing calendar, heifers sold lighter, interest on the herd, and the worked example of the manual.
# The satellite service is mocked with a real answer saved in data/rap_central_texas.txt (read 2026-11-10).
RAP_HOST='us-central1-rap-data-365417.cloudfunctions.net'
FIX={}
for line in open(os.path.join(HERE,'data','rap_central_texas.txt')):
    if line.startswith('#') or '|' not in line: continue
    y,rest=line.strip().split('|'); FIX[int(y)]=[(int(a.split(':')[0]), float(a.split(':')[1])) for a in rest.split(',')]
def rap_rows(scale=1.0):
    rows=[["date","year","doy","AFG","PFG","HER"]]
    for y in sorted(FIX):
        for d,v in FIX[y]: rows.append(["%d-01-01"%y, y, d, 0 if v>=0 else -99, v*scale if v>=0 else -99, v*scale if v>=0 else -99])
    return rows
COMPLETE=[y for y in sorted(FIX) if all(d>0 and v>=0 for d,v in FIX[y])]
TOT={y:sum(v for d,v in FIX[y]) for y in COMPLETE}
MEAN=sum(TOT.values())/len(TOT)
DRY=min(TOT, key=TOT.get); WET=max(TOT, key=TOT.get)   # 2022 and 2004 in this record
rap_requests=[]; rap_mode={'v':'ok'}
def route3(r):
    u=r.request.url
    if RAP_HOST in u:
        if r.request.method=='OPTIONS':
            return r.fulfill(status=204, headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'POST'})
        rap_requests.append(json.loads(r.request.post_data or '{}'))
        if rap_mode['v']=='fail': return r.abort()
        # every second pasture grows 20% less, so pastures have records of their own
        k=0.8 if len(rap_requests)%2==0 else 1.0
        return r.fulfill(status=200, body=json.dumps({"type":"Feature","properties":{"mask":True,"production16day":rap_rows(k)}}), headers={'content-type':'application/json','access-control-allow-origin':'*'})
    return route(r)
def wait_js(pg, expr, timeout=30000):
    t0=time.time()
    while time.time()-t0 < timeout/1000:
        if pg.evaluate(expr): return True
        pg.wait_for_timeout(200)
    return False
def near(a, b, tol): return abs(a-b) <= tol
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    c=b.new_context(viewport={'width':1360,'height':1300}); c.route('**/*', route3)
    pg=c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(f'http://127.0.0.1:{PORT}/my-ranch/index.html'); pg.wait_for_timeout(700)
    pg.click('#summaryBody [data-example="central-texas-1600ac"]'); pg.wait_for_timeout(2000)

    # ---- the worked example of the manual (Section 7): these numbers are printed there, so a change here must be on purpose
    t=pg.evaluate("MyRanch.totals()"); f=pg.evaluate("(()=>{const r=MyRanch.feed();return {hay:r.totals.hay,sup:r.totals.sup,wean:r.econ.avgWeanLb,sold:r.econ.calvesSold,bcs:r.bcs.breed,jan:r.months[0].req.cow,share:r.months.map(m=>m.pastureShare)}})()")
    check('manual example: capacity 105.6 AU from 1,604 ac x 2,500 lb x 25% / (26 x 365)', near(t['cap'],105.6,0.15), round(t['cap'],2))
    check('manual example: herd 100.9 AU (80 cows 91.7, 4 bulls 6.2, calves over 6 months 3.0)', near(pg.evaluate("MyRanch.herdAU()"),100.9,0.2), pg.evaluate("MyRanch.herdAU()"))
    check('manual example: January cow needs 13.0 lb TDN and 1.66 lb CP', near(f['jan']['tdn'],13.0,0.1) and near(f['jan']['cp'],1.66,0.02), f['jan'])
    check('manual example: 9.9 t of cubes, no hay, pasture covers every month', near(f['sup']/2000,9.9,0.15) and f['hay']<1000 and min(f['share'])>0.999, (round(f['sup']/2000,2), f['hay']))
    check('manual example: 68 calves at 471 lb, cows bred at BCS 5.0', near(f['sold'],68,0.6) and near(f['wean'],471,2) and near(f['bcs'],5.0,0.05), (f['sold'], f['wean'], f['bcs']))
    base_net=pg.evaluate("MyRanch.feed().econ.net"); base_cap=t['cap']

    # ---- satellite record: off by default, nothing is sent
    check('satellite record is off by default and no outline has been sent', pg.evaluate("MyRanch.state().settings.satellite")=='off' and len(rap_requests)==0 and pg.locator('.p-rap').count()==0)
    pg.evaluate("MyRanch.go('decide')"); pg.click('.seg-btn[data-dec="years"]'); pg.wait_for_timeout(600)
    check('year by year asks to turn the record on first', pg.is_visible('#yr_on') and not pg.is_visible('#dec_yrBody') and len(rap_requests)==0)
    pg.click('#yr_on')
    check('turning it on reads every pasture', wait_js(pg, "MyRanch.state().pastures.every(p=>p.rap&&p.rap.status==='ok')"), [ (p.get('rap') or {}).get('status') for p in pg.evaluate("MyRanch.state().pastures")])
    q=rap_requests[0]
    check('request is a GeoJSON polygon with mask on and all years', q.get('type')=='Feature' and q['geometry']['type']=='Polygon' and q['properties']=={'mask':True,'year':None} and len(q['geometry']['coordinates'][0])>=4, str(q)[:160])
    check('one request per pasture', len(rap_requests)==4, len(rap_requests))
    r0=pg.evaluate("MyRanch.state().pastures[0].rap")
    check('only complete years are kept: 2000-2025 here (earlier years have gaps, 2026 is not over)', r0['years']==COMPLETE and COMPLETE[0]==2000 and COMPLETE[-1]==2025 and r0['n']==26, (r0['years'][0], r0['years'][-1], r0['n']))
    check('average year matches the record', near(r0['mean'], MEAN, MEAN*0.01), (r0['mean'], round(MEAN)))
    check('months add up to the year and the curve to 100%', all(near(sum(m), TOT[y], 8) for m,y in zip(r0['mon'], r0['years'])) and near(sum(r0['curve']),100,0.6), round(sum(r0['curve']),1))
    check('driest year of the record is found (2022 here, 74% of average)', r0['worst']['year']==DRY==2022 and near(r0['worst']['lb'], TOT[DRY], 8), r0['worst'])
    card=pg.evaluate("document.querySelector('#pastureList .p-rap').textContent")
    check('pasture card shows the record next to the estimate, with a bar per year', 'Satellite record, 2000–2025' in card and 'your estimate' in card and pg.locator('#pastureList .p-rap').first.locator('rect').count()==26, card[:220])
    check('turning the record on changes no number of the plan', near(pg.evaluate("MyRanch.totals().cap"), base_cap, 1e-6) and near(pg.evaluate("MyRanch.feed().econ.net"), base_net, 0.01))

    # ---- year by year
    check('year by year shows after the record is read', wait_js(pg, "!document.getElementById('dec_yrBody').hidden && document.querySelectorAll('#dec_yrTable tbody tr').length===26"))
    run=pg.evaluate("MyRanch.yearsRun()")
    Y=run['years']; g={y['year']:y for y in Y}
    check('26 years, grass averages 100% of the plan', run['n']==26 and near(sum(y['grass'] for y in Y)/26, 1.0, 0.01), round(sum(y['grass'] for y in Y)/26,3))
    lo=min(Y, key=lambda y:y['grass'])
    check('the driest year takes the most hay, the best year none', lo['year']==DRY and run['maxHay']['year']==DRY and g[DRY]['hayT']>1 and g[WET]['hayT']<0.05, (lo['year'], round(lo['grass'],2), run['maxHay']['year'], round(run['maxHay']['hayT'],1)))
    check('a dry year costs money: net in the driest year below the average', g[DRY]['net'] < run['avgNet'] and run['worst']['net'] <= run['dryNet'] <= run['avgNet'] <= run['best']['net'], (round(g[DRY]['net']), round(run['avgNet'])))
    check('real years average no better than the normal-year plan (extra grass is left, missing grass is bought)', run['avgNet'] <= run['normal']['net']+1, (round(run['avgNet']), round(run['normal']['net'])))
    check('chart, text and table are filled', pg.locator('#dec_yrChart rect.yr-grass').count()==26 and '26 years from 2000 to 2025' in pg.inner_text('#dec_yrText') and 'average' in pg.text_content('#dec_yrTable tfoot').lower(), (pg.locator('#dec_yrChart rect.yr-grass').count(), pg.inner_text('#dec_yrTable tfoot')[:40], pg.inner_text('#dec_yrText')[:60]))
    check('herd sizes: six sizes compared, yours marked', wait_js(pg, "document.querySelectorAll('#dec_yrSizes tbody tr').length===6 && !document.querySelector('#dec_yrSizes .spinner') && document.getElementById('dec_yrSizeText').textContent.length>40") and 'your herd' in pg.inner_text('#dec_yrSizes').lower(), pg.inner_text('#dec_yrSizeText')[:200])
    big=pg.evaluate("MyRanch.yearsRun({cows:120})"); small=pg.evaluate("MyRanch.yearsRun({cows:56})")
    check('more cows on the same grass buy hay in more years; fewer cows in fewer', big['hayYears'] >= run['hayYears'] >= small['hayYears'] and big['avgHay'] > small['avgHay'], (small['hayYears'], run['hayYears'], big['hayYears']))
    again=pg.evaluate("MyRanch.yearsRun()")
    check('the run is repeatable', near(again['avgNet'], run['avgNet'], 0.01))
    pg.wait_for_timeout(900)
    brief=pg.evaluate("MyRanch.ranchContext()")
    check('Jim reads why hay is fed (or that none is) and the year-by-year result', ('Why hay is fed' in brief or 'No hay months' in brief) and 'Satellite forage record' in brief and 'Plan run through each of those 26 years' in brief, brief[brief.find('Satellite'):][:300])

    # ---- the pasture's own growth curve
    g0=pg.evaluate("MyRanch.feed().months.map(m=>m.forageAvailLb)")
    pg.evaluate("MyRanch.go('ranch')"); pg.evaluate("document.querySelector('#satCurveField').closest('details') && (document.querySelector('#satCurveField').closest('details').open=true)")
    check('growth-curve choice appears once the record is on', pg.evaluate("!document.getElementById('satCurveField').hidden"))
    pg.select_option('#satCurve','sat'); pg.wait_for_timeout(900)
    g1=pg.evaluate("MyRanch.feed().months.map(m=>m.forageAvailLb)")
    check('own satellite curve moves the months, not the yearly capacity', near(pg.evaluate("MyRanch.totals().cap"), base_cap, 1e-6) and max(abs(a-b) for a,b in zip(g0,g1)) > 1000, (round(g0[0]), round(g1[0])))
    pg.select_option('#satCurve','nrcs'); pg.wait_for_timeout(600)

    # ---- use the satellite average as the estimate; a failed lookup can be retried; off again
    pg.click('#pastureList .p-rap-use'); pg.wait_for_timeout(700)
    p0=pg.evaluate("MyRanch.state().pastures.find(p=>p.manual && p.manual!==2500)")
    check('"use as my estimate" copies the satellite average, rounded to 10 lb', p0 is not None and p0['mode']=='manual' and p0['manual']==round(p0['rap']['mean']/10)*10, p0 and p0['manual'])
    rap_mode['v']='fail'; n0=len(rap_requests)
    pg.evaluate("(()=>{const s=MyRanch.state(); s.pastures[1].rap=null;})()"); pg.select_option('#satMode','off'); pg.select_option('#satMode','on')
    check('a failed lookup says so and offers to try again', wait_js(pg, "(MyRanch.state().pastures[1].rap||{}).status==='error'") and pg.locator('#pastureList .p-rap-retry').count()==1)
    rap_mode['v']='ok'; pg.click('#pastureList .p-rap-retry')
    check('trying again reads it', wait_js(pg, "(MyRanch.state().pastures[1].rap||{}).status==='ok'"))
    n1=len(rap_requests); pg.select_option('#satMode','off'); pg.wait_for_timeout(500)
    check('turning the record off hides it and sends nothing more', pg.locator('.p-rap').count()==0 and len(rap_requests)==n1 and pg.evaluate("MyRanch.state().settings.satCurve")=='nrcs')

    # ---- what to measure first
    pg.evaluate("MyRanch.go('decide')"); pg.click('.seg-btn[data-dec="whatif"]'); pg.wait_for_timeout(2500)
    rows=pg.evaluate("[...document.querySelectorAll('#dec_assume tbody tr')].map(tr=>[tr.cells[0].textContent, +tr.cells[3].textContent.replace(/[^0-9.]/g,'')])")
    check('what to measure first: five inputs, largest effect on top', len(rows)==5 and all(rows[i][1]>=rows[i+1][1] for i in range(4)), rows)
    check('... and the text names the top one', rows[0][0].lower()[:12] in pg.inner_text('#dec_assumeText').lower(), pg.inner_text('#dec_assumeText')[:160])

    # ---- economics: heifers lighter than steers, interest on the herd
    e0=pg.evaluate("(()=>{const e=MyRanch.netOf({}).econ;return [e.calfIncome,e.avgWeanLb,e.calvesSold]})()")
    e6=pg.evaluate("(()=>{const r=MyRanch.netOf({heiferLighter:6});const c=r.calves.cohorts[0];return [r.econ.calfIncome,r.econ.avgWeanLb,r.econ.calvesSold,c.wSale]})()")
    check('heifers 6% lighter: same head and average weight, each sex priced at its own weight, income moves a little', near(e6[2],e0[2],1e-6) and near(e6[1],e0[1],0.5) and e6[0]!=e0[0] and abs(e6[0]/e0[0]-1)<0.03, (round(e0[0]), round(e6[0])))
    s6=pg.evaluate("(()=>{const F=MyRanch.FEED;const w=500,hl=0.06,ws=w*2/(2-hl),wh=ws*(1-hl);return [ws,wh,(ws+wh)/2]})()")
    check('... steers and heifers average the herd weight and differ by 6%', near(s6[2],500,1e-6) and near(s6[1]/s6[0],0.94,1e-9), s6)
    pg.evaluate("MyRanch.go('herd')")
    net0=pg.evaluate("(()=>{const el=document.getElementById('oc_note');return el.textContent})()")
    check('interest on the herd is not charged by default', 'Interest on the herd' not in net0)
    pg.evaluate("(()=>{const i=document.getElementById('oc_int'); i.closest('details') && (i.closest('details').open=true); i.value='5'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}));})()"); pg.wait_for_timeout(900)
    note=pg.inner_text('#oc_note')
    check('5% interest shows what it is charged on and enters the other costs', pg.evaluate("MyRanch.state().herd.intRate")==5 and 'Interest on the herd: 5.0% of' in note, note[:260])
    pg.evaluate("(()=>{const i=document.getElementById('oc_int'); i.value='0'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}));})()"); pg.wait_for_timeout(600)

    # ---- grazing calendar: minimum rest, and heifers and weaned calves as a second herd
    pg.evaluate("MyRanch.go('plan')"); pg.wait_for_timeout(500)
    check('rest setting is on the calendar, 0 by default', pg.input_value('#gp_rest')=='0')
    pg.fill('#gp_rest','60'); pg.dispatch_event('#gp_rest','change'); pg.wait_for_timeout(900)
    check('rest of 60 days is kept and described', pg.evaluate("MyRanch.state().settings.minRest")==60 and 'rested 60 days or more' in pg.inner_text('#rotationBody'), pg.inner_text('#rotationBody')[-400:])
    check('no second herd offered without young stock on the ranch', pg.locator('#gp_young').count()==0)
    pg.evaluate("MyRanch.go('herd')")
    pg.evaluate("(()=>{const i=document.getElementById('fc_replRate'); i.closest('details') && (i.closest('details').open=true); i.value='15'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}));})()"); pg.wait_for_timeout(1200)
    pg.evaluate("MyRanch.go('plan')"); pg.wait_for_timeout(600)
    check('with replacement heifers kept, the calendar offers them their own pastures', pg.locator('#gp_young').count()==1)
    pg.select_option('#gp_young','own'); pg.wait_for_timeout(700)
    check('asks for a pasture for each herd', pg.locator('#rotationBody [data-grp]').count()==4 and 'at least one pasture to each herd' in pg.inner_text('#rotationBody'))
    pid=pg.evaluate("MyRanch.state().pastures[3].id")
    pg.select_option('#rotationBody [data-grp="%s"]' % pid, 'young'); pg.wait_for_timeout(900)
    txt=pg.inner_text('#rotationBody')
    check('two herds on the calendar, the young stock on their pasture', 'Two herds' in txt and pg.locator('#rotationBody rect.gp-young').count()>=1 and pg.evaluate("MyRanch.state().pastures[3].group")=='young', txt[-300:])
    check('the feed plan itself does not change with how the herds are split', near(pg.evaluate("MyRanch.feed().totals.sup"), pg.evaluate("MyRanch.netOf({}).totals.sup"), 1e-6))

    check('no script errors', not errs, errs[:3])
    pg.screenshot(path=os.path.join(OUT,'years.png'), full_page=True)
print('\n%d failures' % len(fails))
for x in fails: print('FAIL', x)
