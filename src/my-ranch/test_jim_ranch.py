# Jim on the other pages knows the ranch saved in My Ranch (Jim itself is not on My Ranch)
import os, json
HERE=os.path.dirname(os.path.realpath(__file__))
__file__=os.path.join(HERE,'test_ranch.py')
exec(open(__file__).read().split('with sync_playwright() as pw:')[0].replace('PORT=8765','PORT=8783'))
sent=[]
def jim_route(r):
    if r.request.method=='POST':
        sent.append(json.loads(r.request.post_data))
        r.fulfill(status=200, headers={'content-type':'text/event-stream','access-control-allow-origin':'*'}, body='event: text\ndata: {"t":"Your ranch looks fine."}\n\nevent: done\ndata: {}\n\n')
    else: r.fulfill(status=204, headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type'})
with sync_playwright() as pw:
    b=pw.chromium.launch(); c=b.new_context(viewport={'width':1280,'height':900}); c.route('**/*', route); c.route('https://jim.j-bautista-bruno.workers.dev/**', jim_route)
    p=c.new_page(); errs=[]; p.on('pageerror', lambda e: errs.append(str(e)))
    p.goto(f'http://127.0.0.1:{PORT}/index.html'); p.wait_for_timeout(700)
    p.evaluate("window.Jim && window.Jim.open()"); p.wait_for_timeout(300)
    check('no ranch saved: no ranch line in Jim', 'saved in My Ranch' not in p.inner_text('body'))
    p.goto(f'http://127.0.0.1:{PORT}/my-ranch/index.html'); p.wait_for_timeout(700)
    check('Jim is not on My Ranch', p.evaluate("!window.Jim"))
    p.click('#summaryBody [data-example="central-texas-1600ac"]'); p.wait_for_timeout(2500)
    br=p.evaluate("JSON.parse(localStorage.getItem('tamuDecisionAidsRanchBrief.v1')||'null')")
    check('My Ranch writes a ranch brief', br and 'Feed calendar' in br['text'] and 'body condition' in br['text'] and 'Pasture list' in br['text'], (br or {}).get('text','')[:200])
    p.goto(f'http://127.0.0.1:{PORT}/index.html'); p.wait_for_timeout(700)
    p.evaluate("sessionStorage.clear(); window.Jim.open()"); p.wait_for_timeout(300)
    txt=p.inner_text('body')
    check('Jim says it can see the saved ranch and offers ranch questions', 'saved in My Ranch' in txt and 'my ranch' in txt.lower())
    p.evaluate("window.Jim.ask('How does my ranch look this year?')"); p.wait_for_timeout(1200)
    last=sent[-1]['messages'][-1]['content'] if sent else ''
    check('the question carries the ranch summary', 'My Ranch tool' in last and 'Feed calendar' in last and last.endswith('How does my ranch look this year?'), last[:120])
    stored=p.evaluate("sessionStorage.getItem('tamuJimChat.v1')") or ''
    check('summary is not stored in the chat history', 'Feed calendar' not in stored)
    check('answer shown', 'Your ranch looks fine' in p.inner_text('body'))
    check('no JS errors', not [e for e in errs if 'fonts.g' not in e], errs[:3])
    b.close()
print('\n%d failures' % len(fails)); sys.exit(1 if fails else 0)
