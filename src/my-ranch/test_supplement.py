import os
HERE=os.path.dirname(os.path.realpath(__file__)); OUT=os.path.join(HERE,'.out'); os.makedirs(OUT, exist_ok=True)
__file__=os.path.join(HERE,'test_ranch.py')
exec(open(__file__).read().split('with sync_playwright() as pw:')[0].replace('PORT=8765','PORT=8779'))
# a Rolling Plains ranch like the Vanzandt SPA test (154 cows, April calving, dormant winter range)
POLY="{type:'Polygon',coordinates:[[[-100.458,35.515],[-100.42183,35.515],[-100.42183,35.54446],[-100.458,35.54446],[-100.458,35.515]]]}"
def setup(pg, lb, mode=None):
    pg.evaluate("MyRanch.addPasture(%s,{name:'Range',type:'range',mode:'manual',manual:%d})" % (POLY, lb))
    pg.evaluate("Object.assign(MyRanch.state().herd,{cowLb:1100,calving:'one',start1:'04-01',len1:63,wean1:'10-18',weanLb:426,region:'rp',source:'cube38',supCp:38,supTdn:75,calvingRate:87,calfLoss:1.5,cowLoss:2,weanPeriod:0,replRate:10%s})" % (",supMode:'%s'" % mode if mode else ''))
    pg.fill('#hd_cows','153'); pg.wait_for_timeout(200); pg.fill('#hd_cows','154'); pg.wait_for_timeout(900)
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    def page():
        c=b.new_context(viewport={'width':1360,'height':1300}); c.route('**/*', route); p=c.new_page(); p.on('pageerror', lambda e: errs.append(str(e)))
        p.goto(f'http://127.0.0.1:{PORT}/my-ranch/index.html'); p.wait_for_timeout(600); return p
    pg=page(); setup(pg, 3200)
    check('protein-only is the default', pg.input_value('#fc_supMode')=='protein' and pg.evaluate("MyRanch.feed().bcs.mode")=='protein')
    sup=pg.evaluate("MyRanch.feed().totals.sup")/154
    check('wet-year Vanzandt: protein supplement near the 285 lb/cow they fed', 200 < sup < 360, round(sup))
    check('no hay needed at 3,200 lb/ac', pg.evaluate("MyRanch.feed().totals.hay") < 100)
    check('condition tile shown', 'cow condition' in pg.inner_text('#fc_tiles').lower())
    check('BCS column in monthly table', 'cow bcs' in pg.inner_text('#fc_table').lower())
    # calf weight: varies with calving month, creep counted in costs
    pg.evaluate("document.getElementById('decCard').scrollIntoView()"); pg.wait_for_timeout(900)
    rows=[l.split('\t') for l in pg.inner_text('#dec_calvTable').split('\n')[1:] if l.count('\t')>=5]
    nat=[float(r[3].replace(' lb','').replace(',','')) for r in rows]
    check('natural weaning weight varies by calving month', max(nat)-min(nat) > 40, nat)
    check('April natural weight within 15% of Vanzandt 426 lb', 360 < nat[3] < 440, nat[3])
    check('summer calving weans lighter than spring', nat[7] < nat[2], (nat[2], nat[7]))
    href=pg.get_attribute('#dec_keepLink','href')
    check('stocker budget link carries calves, weight, price, date', 'retained-ownership/index.html#stockers?heads=' in href and '&weight=' in href and '&start=' in href, href)
    pg.click('#dec_keepLink'); pg.wait_for_timeout(1200)
    check('stocker budget opens prefilled', pg.is_visible('#panel-stockers') and pg.input_value('#sk_calfWeight') in href and 'loaded from my ranch' in pg.inner_text('#panel-stockers').lower(), pg.url)
    days=pg.evaluate("(new Date(document.getElementById('sk_pullOff800').value)-new Date(document.getElementById('sk_earlyStart').value))/864e5")
    check('stocker dates moved with the weaning date', days > 100, days)
    pg.go_back(); pg.wait_for_timeout(1500)
    ws=pg.evaluate("MyRanch.netOf({weanMode:'age',weanAge:200,calfShort:'lighter'}).econ.avgWeanLb")
    check('engine: weaned calf gain from forage', 0.2 < pg.evaluate("MyRanch.FEED.weanedGain({breed:'angus',cowLb:1100},400,48,4.5,75,38).adg") < 0.7 and pg.evaluate("MyRanch.FEED.weanedGain({breed:'angus',cowLb:1100},400,62,12,75,38).adg") > 1.2)
    check('calving + sale table', pg.locator('#dec_calvEconTable tbody tr').count()==12 and 'leaves the most' in pg.inner_text('#dec_calvEconText'))
    cf=pg.evaluate("MyRanch.feed().econ")
    check('creep cost included in costs', cf['creep'] >= 0 and abs(cf['costs'] - (cf['feed']+cf['trips']+cf['dist']+cf['nwsCare']+cf['creep'])) < 1, cf)
    pg.evaluate("MyRanch.state().herd.calfShort='lighter'"); pg.fill('#hd_cows','153'); pg.wait_for_timeout(200); pg.fill('#hd_cows','154'); pg.wait_for_timeout(900)
    lf=pg.evaluate("MyRanch.feed().econ")
    check('lighter option: no creep, lighter calves', lf['creep']==0 and lf['avgWeanLb'] <= cf['avgWeanLb'], (lf['avgWeanLb'], cf['avgWeanLb']))
    pg.evaluate("MyRanch.state().herd.calfShort='creep'"); pg.fill('#hd_cows','153'); pg.wait_for_timeout(200); pg.fill('#hd_cows','154'); pg.wait_for_timeout(700)
    pg.evaluate("document.getElementById('fc_supMode').closest('details').open=true"); pg.select_option('#fc_supMode','full'); pg.wait_for_timeout(700)
    check('protein and energy: condition held', 'held at' in pg.inner_text('#fc_tiles').lower() and 'cow bcs' not in pg.inner_text('#fc_table').lower())
    check('feeding energy too never needs less supplement', pg.evaluate("MyRanch.feed().totals.sup")/154 >= sup - 0.5)
    pg2=page(); setup(pg2, 1300, 'protein')
    pg2.evaluate("(function(){var h=MyRanch.state().herd; h.weatherAdj='on';})()")
    bc=pg2.evaluate("MyRanch.feed().bcs")
    check('low cows lose condition on poor range with protein only', bc['low'] < bc['start'] - 0.05 or pg2.evaluate("MyRanch.feed().totals.hay")>0, bc)
    pg3=page(); setup(pg3, 900, 'protein')
    pg3.evaluate("(function(){var s=MyRanch.state(); s.herd.hayPrice=0;})()")
    t=pg3.inner_text('#fc_short')
    check('feed calendar text mentions condition', 'condition' in t, t[-200:])
    check('no JS errors', not errs, errs)
    b.close()
print('\n%d failures' % len(fails)); sys.exit(1 if fails else 0)
