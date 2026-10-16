"""Automated accessibility check (axe-core, WCAG 2.0/2.1 A and AA rules) on every page,
in light and dark mode, on desktop and phone width, with the Jim panel open.

    cd tools && npm install axe-core@4.10.2     # once (tools/node_modules is git-ignored)
    python3 tools/test_a11y.py                  # exit 1 on any violation

Automated tools find roughly a third to a half of accessibility problems; a manual keyboard and
screen-reader review is still needed (see OPERATIONS.md).
"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
AXE = os.environ.get('AXE_PATH') or os.path.join(REPO, 'tools', 'node_modules', 'axe-core', 'axe.min.js')
if not os.path.exists(AXE):
    sys.exit('axe-core not found. Run:  cd tools && npm install axe-core@4.10.2')
AXE_SRC = open(AXE, encoding='utf-8').read()
PORT = 8773
PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d0e1a10000000049454e44ae426082')

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class Q(socketserver.TCPServer): allow_reuse_address = True
httpd = Q(('127.0.0.1', PORT), functools.partial(H, directory=REPO))
threading.Thread(target=httpd.serve_forever, daemon=True).start()

def route(r):
    u = r.request.url
    if u.startswith('http://127.0.0.1'): return r.continue_()
    if 'arcgisonline' in u or 'tile.openstreetmap' in u: return r.fulfill(status=200, body=PNG, headers={'content-type': 'image/png'})
    if 'sdmdataaccess' in u.lower(): return r.fulfill(status=200, body='{"Table":[]}', headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    if 'arcgis.com' in u: return r.fulfill(status=200, body='{"features":[]}', headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    return r.abort()

PAGES = ['index.html', 'data-sources.html', 'privacy.html', 'cow-calf/index.html', 'cow-calf/understanding-irr.html',
         'replacement-heifer/index.html', 'retained-ownership/index.html', 'herd-tools/index.html', 'my-ranch/index.html']
RUN = """async () => { const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa']}, resultTypes: ['violations']});
  return r.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, n: v.nodes.length,
     nodes: v.nodes.slice(0, 4).map(n => ({t: n.target.join(' '), s: (n.failureSummary || '').split('\\n').slice(1, 3).join(' ')}))})); }"""

total = 0
report = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for vw, label in [((1280, 900), 'desktop'), ((390, 844), 'phone')]:
        for theme in ['light', 'dark']:
            ctx = b.new_context(viewport={'width': vw[0], 'height': vw[1]}, bypass_csp=True, color_scheme=theme)
            ctx.route('**/*', route)
            ctx.add_init_script("try{localStorage.setItem('tamuDecisionAidsTheme','%s')}catch(e){}" % theme)
            for path in PAGES:
                p = ctx.new_page()
                p.goto('http://127.0.0.1:%d/%s' % (PORT, path)); p.wait_for_timeout(800)
                p.add_script_tag(content=AXE_SRC)
                vs = p.evaluate(RUN)
                if p.evaluate('!!window.Jim'):
                    p.evaluate('window.Jim.open()'); p.wait_for_timeout(300)
                    for v in p.evaluate(RUN):
                        if not any(x['id'] == v['id'] for x in vs): v['help'] += ' (Jim open)'; vs.append(v)
                for v in vs:
                    total += v['n']
                    report.append('%s | %s %s | %s [%s] x%d: %s' % (path, label, theme, v['id'], v['impact'], v['n'],
                                  '; '.join(n['t'] + ' -> ' + n['s'] for n in v['nodes'])))
                print(('FAIL ' if vs else 'PASS ') + '%s (%s, %s)' % (path, label, theme) + (' — ' + ', '.join('%s x%d' % (v['id'], v['n']) for v in vs) if vs else ''))
                p.close()
            ctx.close()
    b.close()
httpd.shutdown()
if report:
    print('\nDetails:\n' + '\n'.join(report))
print('\n%d violation node(s)' % total)
sys.exit(1 if total else 0)
