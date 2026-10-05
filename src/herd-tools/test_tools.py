import os
HERE=os.path.dirname(os.path.abspath(__file__)); REPO=os.path.abspath(os.path.join(HERE,'..','..')); OUT=os.path.join(HERE,'.out'); os.makedirs(OUT, exist_ok=True)
import threading, http.server, socketserver, functools, sys, datetime
from playwright.sync_api import sync_playwright

ROOT=REPO; PORT=8766
Handler=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
Handler.log_message=lambda *a: None
class Q(socketserver.TCPServer): allow_reuse_address=True
httpd=Q(('127.0.0.1',PORT),Handler); threading.Thread(target=httpd.serve_forever,daemon=True).start()
fails=[]
def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ')+name+(' — '+str(detail) if detail!='' else ''))
    if not cond: fails.append(name)
def route(r):
    u=r.request.url
    if u.startswith('http://127.0.0.1'): return r.continue_()
    return r.fulfill(status=200, body='', headers={'content-type':'text/css'})
O=os.path.join(OUT,'')
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={'width':1360,'height':900}); ctx.route('**/*', route); pg=ctx.new_page()
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{PORT}/herd-tools/index.html'); pg.wait_for_timeout(400)
    H='window.HerdTools'
    # --- engine: water matches the published table exactly at table points
    check('water table point: nursing 900 lb 70F = 16.9', abs(pg.evaluate(H+".water('lactating',900,70).gal")-16.9)<1e-9)
    check('water table point: growing 600 lb 90F = 12.7', abs(pg.evaluate(H+".water('growing',600,90).gal")-12.7)<1e-9)
    check('water interpolates 700 lb growing at 65F', abs(pg.evaluate(H+".water('growing',700,65).gal")-((6.5+7.9)/2+((7.8+9.2)/2-(6.5+7.9)/2)*0.5))<1e-9)
    check('water scales above table weight', abs(pg.evaluate(H+".water('lactating',1200,60).gal")-14.5*1200/900)<1e-9)
    check('nursing cows never less water when hotter', pg.evaluate(H+".water('lactating',900,90).gal")>=pg.evaluate(H+".water('lactating',900,80).gal"))
    check('dry cows above 70F extended', pg.evaluate(H+".water('pregnant',900,90).gal")>9.7)
    # --- pearson
    p=pg.evaluate(H+".pearson(7,22,10)")
    check('pearson fractions', abs(p['fa']-12/15)<1e-9 and abs(p['fb']-3/15)<1e-9 and abs(p['fa']*7+p['fb']*22-10)<1e-9)
    check('pearson rejects target outside', pg.evaluate(H+".pearson(7,22,25)") is None)
    # --- dewormer
    d=pg.evaluate(H+".dewormer('ivm_inj',1100,10,500,{})")
    check('ivermectin injectable 1 mL/110 lb: 1100 lb = 10 mL, 100 mL, 1 bottle, 35 d', abs(d['ml']-10)<1e-9 and abs(d['total']-100)<1e-9 and d['bottles']==1 and d['wd']==35)
    d2=pg.evaluate(H+".dewormer('epr_er',1320,1,500,{})")
    check('extended-release eprinomectin over 10 mL splits into 2 sites', d2['sites']==2 and d2['wd']==48)
    d3=pg.evaluate(H+".dewormer('fbz',600,1,1000,{})")
    check('fenbendazole 2.3 mL/100 lb', abs(d3['ml']-13.8)<1e-9 and d3['wd']==8)
    check('custom dose', abs(pg.evaluate(H+".dewormer('custom',500,1,500,{dose:2,per:100,wd:10}).ml")-10)<1e-9)
    # --- gain & spa
    g=pg.evaluate(H+".gain({start:450,now:540,days:60,target:1.75,sale:750,shrink:3})")
    check('gain ADG and days', abs(g['adg']-1.5)<1e-9 and abs(g['daysReal']-140)<1e-9 and abs(g['pay']-727.5)<1e-9)
    s=pg.evaluate(H+".spa({exposed:100,heifers:18,tested:98,preg:90,weaned:84,wwt:540,begin:210,born:88,bought:4,sold:95,died:3})")
    check('SPA measures', abs(s['pregExp']-90)<1e-9 and abs(s['wean']-84)<1e-9 and abs(s['lbExp']-453.6)<1e-9 and s['expected']==204)
    # --- UI
    check('water shows by default', pg.is_visible('#tool-water') and not pg.is_visible('#tool-ration'))
    check('water herd total', pg.inner_text('#w_herd').replace(',','')==str(round(pg.evaluate(H+".water('lactating',1200,95).gal")*100)))
    pg.fill('#w_head','50'); pg.wait_for_timeout(100)
    check('water updates on input', pg.inner_text('#w_herd').replace(',','')==str(round(pg.evaluate(H+".water('lactating',1200,95).gal")*50)))
    check('above 90F note', '90°F' in pg.inner_text('#w_note'))
    pg.click('[data-tool="ration"]'); pg.wait_for_timeout(100)
    check('tab switches and hash', pg.is_visible('#tool-ration') and pg.evaluate('location.hash')=='#ration')
    check('ration pill shows mix', '80% Grass hay' in pg.inner_text('#r_pill'), pg.inner_text('#r_pill'))
    check('ration cost per head', pg.inner_text('#r_costHead').startswith('$'))
    pg.fill('#r_target','30'); pg.wait_for_timeout(100)
    check('ration target outside feeds warns', 'must be between' in pg.inner_text('#r_pill') and not pg.is_visible('#r_out'))
    pg.fill('#r_target','10'); pg.wait_for_timeout(100)
    pg.click('[data-tool="dewormer"]'); pg.wait_for_timeout(100)
    check('dewormer dose 600 lb ivermectin = 5.5 mL', pg.inner_text('#d_dose')=='5.5')
    check('dewormer label restrictions and source link', 'dairy' in pg.inner_text('#d_restrict') and pg.locator('#d_source a[href*="dailymed"]').count()==1)
    sale=(datetime.date.today()+datetime.timedelta(days=20)).isoformat()
    pg.fill('#d_sale', sale); pg.dispatch_event('#d_sale','change'); pg.wait_for_timeout(100)
    check('withdrawal past sale flagged', 'too late' in pg.inner_text('#d_earliestSub') and 'critical' in pg.get_attribute('#d_pill','class'))
    pg.select_option('#d_prod','custom'); pg.wait_for_timeout(100)
    check('custom fields appear', pg.is_visible('#d_cDose'))
    pg.select_option('#d_prod','mox_po'); pg.wait_for_timeout(100)
    check('zero-withdrawal product OK', pg.inner_text('#d_wd')=='None' and 'good' in pg.get_attribute('#d_pill','class') and not pg.is_visible('#d_cDose'))
    pg.click('[data-tool="gain"]'); pg.wait_for_timeout(100)
    check('gain behind target', 'Behind target' in pg.inner_text('#g_pill') and pg.inner_text('#g_adg')=='1.50')
    pg.click('[data-tool="herd"]'); pg.wait_for_timeout(100)
    check('herd count matches', 'matches' in pg.inner_text('#h_pill'))
    pg.fill('#h_count','200'); pg.wait_for_timeout(100)
    check('herd count mismatch', '4 head fewer' in pg.inner_text('#h_pill'))
    pg.screenshot(path=O+'ht-herd.png')
    pg.reload(); pg.wait_for_timeout(300)
    check('inputs and tab persist', pg.is_visible('#tool-herd') and pg.input_value('#h_count')=='200')
    for t in ['water','ration','dewormer','gain']:
        pg.click(f'[data-tool="{t}"]'); pg.wait_for_timeout(150); pg.screenshot(path=O+f'ht-{t}.png')
    pg.click('#themeToggle'); pg.wait_for_timeout(200); pg.click('[data-tool="ration"]'); pg.wait_for_timeout(150); pg.screenshot(path=O+'ht-ration-dark.png'); pg.click('#themeToggle')
    m=ctx.new_page(); m.set_viewport_size({'width':390,'height':844}); m.goto(f'http://127.0.0.1:{PORT}/herd-tools/index.html#dewormer'); m.wait_for_timeout(400)
    m.screenshot(path=O+'ht-mobile.png', full_page=True)
    check('no horizontal scroll on phone', m.evaluate('document.documentElement.scrollWidth')<=390, m.evaluate('document.documentElement.scrollWidth'))
    # portal card
    pg.goto(f'http://127.0.0.1:{PORT}/index.html'); pg.wait_for_timeout(300)
    check('portal links to herd calculators', pg.locator('a[href="herd-tools/index.html"]').count()==1)
    check('no JS errors', not errs, errs)
    b.close()
print('\n%d failures' % len(fails)); sys.exit(1 if fails else 0)
