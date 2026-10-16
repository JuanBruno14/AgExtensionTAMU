"""Security checks for the whole site (Playwright + Chromium, runs offline).

    python3 tools/test_security.py

Checks:
  * every page passes tools/secure_pages.py --check (CSP, referrer policy, required links up to date)
  * no page triggers a Content-Security-Policy violation or a script error, including My Ranch
    importing KML, KMZ and a zipped shapefile (the libraries that unzip and parse files)
  * no page loads anything from a third-party host except the allowed public services
  * every page shows the State/AgriLife required links and the equal-opportunity statement
  * Jim sends the saved ranch only while the "Use my saved ranch" switch is on, and links the privacy page
  * the privacy page's delete button removes everything the site stored
"""
import functools, http.server, io, json, os, socketserver, subprocess, sys, threading, zipfile
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
OUT = os.path.join(REPO, 'src', 'my-ranch', '.out'); os.makedirs(OUT, exist_ok=True)
PORT = 8771
fails = []
def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail != '' else ''))
    if not cond: fails.append(name)

r = subprocess.run([sys.executable, os.path.join(REPO, 'tools', 'secure_pages.py'), '--check'], capture_output=True, text=True)
check('secure_pages --check', r.returncode == 0, r.stdout.strip())

class Q(socketserver.TCPServer): allow_reuse_address = True
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
httpd = Q(('127.0.0.1', PORT), functools.partial(H, directory=REPO))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}/'

ALLOWED = {'127.0.0.1', 'jim.j-bautista-bruno.workers.dev', 'sdmdataaccess.sc.egov.usda.gov', 'services9.arcgis.com',
           'nominatim.openstreetmap.org', 'server.arcgisonline.com', 'tile.openstreetmap.org'}
PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d0e1a10000000049454e44ae426082')
hosts, jim_bodies = set(), []

def route(rt):
    u = rt.request.url; h = urlparse(u).hostname or ''
    hosts.add(h)
    if h == '127.0.0.1': return rt.continue_()
    if 'workers.dev' in h:
        jim_bodies.append(rt.request.post_data or '')
        return rt.fulfill(status=200, body='event: text\ndata: {"t":"ok"}\n\nevent: done\ndata: {}\n\n',
                          headers={'content-type': 'text/event-stream', 'access-control-allow-origin': '*'})
    if h in ('server.arcgisonline.com', 'tile.openstreetmap.org'):
        return rt.fulfill(status=200, body=PNG, headers={'content-type': 'image/png'})
    if h == 'sdmdataaccess.sc.egov.usda.gov':
        return rt.fulfill(status=200, body=json.dumps({'Table': []}), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    if h == 'services9.arcgis.com':
        return rt.fulfill(status=200, body=json.dumps({'features': []}), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    if h == 'nominatim.openstreetmap.org':
        return rt.fulfill(status=200, body='[]', headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    return rt.abort()

PAGES = ['index.html', 'data-sources.html', 'privacy.html', 'cow-calf/index.html', 'cow-calf/understanding-irr.html',
         'replacement-heifer/index.html', 'retained-ownership/index.html', 'herd-tools/index.html', 'my-ranch/index.html']

# test files for the importer
KML = ('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>North</name><Polygon><outerBoundaryIs><LinearRing>'
       '<coordinates>-99.20,33.18 -99.19,33.18 -99.19,33.19 -99.20,33.19 -99.20,33.18</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>')
open(os.path.join(OUT, 'sec.kml'), 'w').write(KML)
with zipfile.ZipFile(os.path.join(OUT, 'sec.kmz'), 'w') as z: z.writestr('doc.kml', KML)
try:
    import shapefile  # pyshp
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    w = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON); w.field('name', 'C')
    w.poly([[[-99.20, 33.18], [-99.20, 33.19], [-99.19, 33.19], [-99.19, 33.18], [-99.20, 33.18]]]); w.record('South'); w.close()
    with zipfile.ZipFile(os.path.join(OUT, 'sec_shp.zip'), 'w') as z:
        z.writestr('p.shp', shp.getvalue()); z.writestr('p.shx', shx.getvalue()); z.writestr('p.dbf', dbf.getvalue())
        z.writestr('p.prj', 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]')
    HAVE_SHP = True
except ImportError:
    HAVE_SHP = False

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.route('**/*', route)
    ctx.add_init_script("window.__csp=[];document.addEventListener('securitypolicyviolation',function(e){window.__csp.push(e.violatedDirective+' '+e.blockedURI)});")
    for path in PAGES:
        p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
        p.on('console', lambda m, errs=errs: errs.append(m.text) if m.type == 'error' and 'Content Security Policy' in m.text else None)
        p.goto(BASE + path); p.wait_for_timeout(900)
        if path == 'my-ranch/index.html':
            files = ['sec.kml', 'sec.kmz'] + (['sec_shp.zip'] if HAVE_SHP else [])
            for f in files:
                p.set_input_files('#fileInput', os.path.join(OUT, f)); p.wait_for_timeout(1500)
            names = p.evaluate("Array.from(document.querySelectorAll('input,td,span,div')).map(e=>e.value||e.textContent).join(' ')")
            check('My Ranch imports KML + KMZ under CSP', 'North' in names)
            if HAVE_SHP: check('My Ranch imports a zipped shapefile under CSP', 'South' in names)
        csp = p.evaluate('window.__csp')
        check('no CSP violation: ' + path, not csp, csp[:3])
        check('no script error: ' + path, not errs, errs[:3])
        meta = p.evaluate("""() => ({csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
            ref: (document.querySelector('meta[name=referrer]')||{}).content,
            links: Array.from(document.querySelectorAll('.required-links a')).map(a => a.textContent),
            eeo: !!document.querySelector('.eeo-statement')})""")
        check('CSP + referrer meta: ' + path, meta['csp'] and meta['ref'] == 'strict-origin-when-cross-origin')
        check('required links + EEO: ' + path, len(meta['links']) == 13 and 'Compact with Texans' in meta['links'] and meta['eeo'], len(meta['links']))
        p.close()
    check('only allowed hosts contacted', hosts <= ALLOWED, sorted(hosts - ALLOWED))

    # Jim: ranch sharing switch and privacy link
    p = ctx.new_page()
    p.goto(BASE + 'index.html'); p.wait_for_timeout(600)
    p.evaluate("""localStorage.setItem('tamuDecisionAidsRanchBrief.v1', JSON.stringify({text:'RANCH-SUMMARY-MARKER 640 ac', name:'Test ranch', updated: Date.now()}));
                  localStorage.removeItem('tamuJimShareRanch.v1'); sessionStorage.clear();""")
    p.reload(); p.wait_for_timeout(600)
    p.evaluate("window.Jim.open()"); p.wait_for_timeout(300)
    check('Jim notice links the privacy page', p.evaluate("!!document.querySelector('.jim-note a[href$=\"privacy.html\"]')"))
    check('Jim shows the ranch switch, on by default', p.evaluate("(document.querySelector('.jim-share input')||{}).checked === true"))
    p.evaluate("window.Jim.ask('How does my ranch look?')"); p.wait_for_timeout(900)
    check('ranch summary sent while switch is on', jim_bodies and 'RANCH-SUMMARY-MARKER' in jim_bodies[-1])
    p.click('.jim-share input'); p.wait_for_timeout(200)
    check('switch off is remembered', p.evaluate("localStorage.getItem('tamuJimShareRanch.v1')") == 'off')
    n = len(jim_bodies)
    p.evaluate("window.Jim.ask('And my costs?')"); p.wait_for_timeout(900)
    check('ranch summary NOT sent once switch is off', len(jim_bodies) > n and 'RANCH-SUMMARY-MARKER' not in jim_bodies[-1])

    # privacy page: delete everything
    p.goto(BASE + 'privacy.html'); p.wait_for_timeout(400)
    p.on('dialog', lambda d: d.accept())
    p.click('#clearSiteData'); p.wait_for_timeout(300)
    left = p.evaluate("Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k => k.indexOf('tamu') === 0)")
    check('privacy page deletes all site data', left == [], left)
    b.close()

httpd.shutdown()
print('\n%d failure(s)' % len(fails))
sys.exit(1 if fails else 0)
