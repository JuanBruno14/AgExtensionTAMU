#!/usr/bin/env python3
"""Security pass for every published page. Run it after any page edit or build:

    python3 tools/secure_pages.py          # update all pages
    python3 tools/secure_pages.py --check  # exit 1 if any page is out of date (for tests / CI)

For each .html page outside vendor/ and src/ it:
  1. writes a Content-Security-Policy <meta> (scripts only from this site + the exact inline
     scripts on the page, by SHA-256 hash; network calls only to the services listed below);
  2. writes a Referrer-Policy <meta>;
  3. puts the site links (privacy & data, price sources) at the end of the page footer;
  4. adds rel="noopener noreferrer" to any link that opens a new tab without it;
  5. writes the search/social block (canonical, description, Open Graph, favicon, JSON-LD) and sitemap.xml.

The two built pages (my-ranch, herd-tools) call this script at the end of their build.
"""
import base64, glob, hashlib, html as htmllib, json, os, re, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))

# Jim's relay (Cloudflare Worker). Read from jim/jim.js so the policy always matches the widget.
_jim = open(os.path.join(REPO, 'jim', 'jim.js'), encoding='utf-8').read()
_m = re.search(r'var JIM_ENDPOINT = "(https://[^"/]+)', _jim)
JIM_ORIGIN = _m.group(1) if _m else ''

CONNECT = ["'self'", JIM_ORIGIN,
           'https://sdmdataaccess.sc.egov.usda.gov',     # USDA-NRCS Soil Data Access (My Ranch)
           'https://elevation.nationalmap.gov',          # USGS 3DEP elevation, pasture slopes (My Ranch)
           'https://services9.arcgis.com',               # U.S. Drought Monitor layer (My Ranch)
           'https://nominatim.openstreetmap.org']        # place search (My Ranch)
IMAGES = ["'self'", 'data:', 'blob:',
          'https://server.arcgisonline.com',             # Esri imagery and reference tiles
          'https://tile.openstreetmap.org']              # street map tiles

REQUIRED_LINKS = [
    ('Privacy &amp; Data', '{root}privacy.html'),
    ('Where the Prices Come From', '{root}data-sources.html'),
]
LINKS_START, LINKS_END = '<!-- required-links:start (tools/secure_pages.py) -->', '<!-- required-links:end -->'
CSS = ('<style>.required-links{display:flex;flex-wrap:wrap;gap:4px 14px;margin:14px 0 0;padding:12px 0 0;'
       'border-top:1px solid var(--border,#d1d1d1);list-style:none;font-size:12px;line-height:1.6}'
       '.required-links a{color:inherit;text-decoration:underline}</style>')

INLINE_SCRIPT = re.compile(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', re.S | re.I)


def pages():
    out = []
    for p in sorted(glob.glob(os.path.join(REPO, '**', '*.html'), recursive=True)):
        rel = os.path.relpath(p, REPO)
        if rel.split(os.sep)[0] in ('vendor', 'src', 'node_modules') or '/.out/' in p or 'node_modules' in p:
            continue
        out.append(p)
    return out


def links_block(rel, footer_has_eeo=False):
    root = '../' * rel.count('/')
    items = ''.join('<li><a href="%s">%s</a></li>' % (href.format(root=root), label) for label, href in REQUIRED_LINKS)
    return LINKS_START + CSS + '<ul class="required-links" aria-label="Site links">' + items + '</ul>' + LINKS_END


def csp_for(html):
    hashes = []
    for attrs, body in INLINE_SCRIPT.findall(html):
        if 'application/ld+json' in attrs or 'application/json' in attrs:
            continue
        h = base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode()
        hashes.append("'sha256-%s'" % h)
    policy = [
        "default-src 'self'",
        "script-src 'self' " + ' '.join(sorted(set(hashes))),
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        'img-src ' + ' '.join(IMAGES),
        'connect-src ' + ' '.join(c for c in CONNECT if c),
        "worker-src 'self' blob:",
        "object-src 'none'",
        "frame-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        'upgrade-insecure-requests',
    ]
    return '; '.join(policy)


# ---------------------------------------------------------------------------
# Search and sharing: canonical, description, Open Graph, favicon, JSON-LD, sitemap.xml
# ---------------------------------------------------------------------------
SITE = 'https://back40agtools.com'   # change here if the site moves to its own domain, then run this script
OG_IMAGE = SITE + '/brand/photos/hero-herd.jpg'
OG_IMAGE_ALT = 'Black-and-white photo of a mixed herd of cows standing in tall grass'
SEO = {  # page -> (description, kind): site / app / page
    'index.html': ('Free decision tools for cow-calf producers. Price a bred cow, run quick herd calculators, and map your pastures to match your herd to your grass.', 'site'),
    'about/index.html': ('About Back40: free beef cattle decision tools for cow-calf producers, who they are for, and who to contact.', 'page'),
    'cow-decisions/index.html': ('Budgets for the big cow-calf calls: what to pay for a bred cow, what calf price you need, whether to raise a heifer, and when to sell or keep.', 'page'),
    'herd-tools/index.html': (None, 'app'),
    'my-ranch/index.html': ('Draw your pastures on a satellite map, get carrying capacity from USDA soil data, and match your herd to your grass with a feed and grazing calendar.', 'app'),
    'cow-calf/index.html': ('How much can you afford to pay for a bred cow? Enter the bid, discount rate and financing to see NPV, IRR and payback over 7 years.', 'app'),
    'cow-calf/understanding-irr.html': ('A plain-language explanation of internal rate of return (IRR) and how to use it to judge what to pay for a bred cow.', 'page'),
    'replacement-heifer/index.html': ('What does a bred replacement heifer cost you? Budget from weaned calf to bred heifer with natural service, and compare it with buying one.', 'app'),
    'retained-ownership/index.html': ('Sell or keep to upgrade cull cows: profit projection for selling now versus feeding cattle out at a feedyard or retaining them to May.', 'app'),
    'privacy.html': (None, 'page'),
    'data-sources.html': ('Every price and number on Back40 with its source and how current it is: USDA market reports, extension budgets and product labels.', 'page'),
}
SEO_START, SEO_END = '<!-- seo:start (tools/secure_pages.py) -->', '<!-- seo:end -->'


def canonical(rel):
    if rel == 'index.html':
        return SITE + '/'
    if rel.endswith('/index.html'):
        return SITE + '/' + rel[:-len('index.html')]
    return SITE + '/' + rel


def seo_block(html, rel):
    if rel not in SEO:
        return ''
    desc, kind = SEO[rel]
    m = re.search(r'<title>(.*?)</title>', html, re.S)
    title = m.group(1).strip() if m else 'Back40'
    existing = re.search(r'<meta name="description" content="([^"]*)"', html)
    have_desc = bool(existing)
    if existing:
        desc = existing.group(1)
    esc = lambda t: t.replace('"', '&quot;')
    url = canonical(rel)
    root = '../' * rel.count('/')
    out = [SEO_START, '<link rel="canonical" href="%s">' % url,
           '<link rel="icon" href="%sbrand/favicon.svg" type="image/svg+xml">' % root]
    if not have_desc:
        out.append('<meta name="description" content="%s">' % esc(desc))
    out += ['<meta property="og:type" content="website">', '<meta property="og:site_name" content="Back40">',
            '<meta property="og:title" content="%s">' % esc(title), '<meta property="og:description" content="%s">' % esc(desc),
            '<meta property="og:url" content="%s">' % url, '<meta property="og:image" content="%s">' % OG_IMAGE,
            '<meta property="og:image:alt" content="%s">' % OG_IMAGE_ALT, '<meta name="twitter:card" content="summary_large_image">']
    name = htmllib.unescape(title)
    d = htmllib.unescape(desc)
    if kind == 'site':
        ld = {'@context': 'https://schema.org', '@type': 'WebSite', 'name': 'Back40', 'url': SITE + '/', 'description': d, 'inLanguage': 'en'}
    elif kind == 'app':
        ld = {'@context': 'https://schema.org', '@type': 'WebApplication', 'name': name.split(' · ')[0], 'url': url, 'description': d,
              'applicationCategory': 'BusinessApplication', 'operatingSystem': 'Any (web browser)', 'inLanguage': 'en',
              'isPartOf': {'@type': 'WebSite', 'name': 'Back40', 'url': SITE + '/'},
              'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'}}
    else:
        ld = {'@context': 'https://schema.org', '@type': 'WebPage', 'name': name, 'url': url, 'description': d, 'inLanguage': 'en',
              'isPartOf': {'@type': 'WebSite', 'name': 'Back40', 'url': SITE + '/'}}
    out.append('<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + '</script>')
    out.append(SEO_END)
    return '\n'.join(out) + '\n'


def sitemap_xml():
    urls = ''.join('  <url><loc>%s</loc></url>\n' % canonical(r) for r in sorted(SEO, key=lambda r: (r != 'index.html', r)))
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '</urlset>\n'


def secure(html, rel):
    # 1. site links at the end of the footer (replace an earlier copy)
    html = re.sub(re.escape(LINKS_START) + '.*?' + re.escape(LINKS_END) + r'\n?', '', html, flags=re.S)
    m = re.search(r'<footer\b[^>]*>(.*?)</footer>', html, re.S)
    if m:
        block = links_block(rel, 'eeo-statement' in m.group(1))
        end = m.end() - len('</footer>')
        html = html[:end] + block + '\n' + html[end:]
    else:
        block = '<footer class="site-required">' + links_block(rel, False) + '</footer>\n'
        html = html.replace('</body>', block + '</body>', 1)

    # 2. links that open a new tab
    def fix_blank(a):
        tag = a.group(0)
        if 'noopener' in tag:
            return tag
        if 'rel="' in tag:
            return tag.replace('rel="', 'rel="noopener noreferrer ', 1)
        return tag[:-1] + ' rel="noopener noreferrer">'
    html = re.sub(r'<a\b[^>]*target="_blank"[^>]*>', fix_blank, html)

    # 2b. search/social block just before </head> (replace an earlier copy)
    html = re.sub(re.escape(SEO_START) + '.*?' + re.escape(SEO_END) + r'\n?', '', html, flags=re.S)
    block = seo_block(html, rel)
    if block:
        html = html.replace('</head>', block + '</head>', 1)

    # 3. CSP + referrer policy right after <meta charset> (hashes are of the final inline scripts)
    html = re.sub(r'\n?<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
    html = re.sub(r'\n?<meta name="referrer"[^>]*>', '', html)
    metas = ('\n<meta http-equiv="Content-Security-Policy" content="%s">'
             '\n<meta name="referrer" content="strict-origin-when-cross-origin">') % csp_for(html)
    html, n = re.subn(r'(<meta charset="[^"]*">)', r'\1' + metas.replace('\\', '\\\\'), html, count=1)
    if not n:
        raise SystemExit('No <meta charset> in ' + rel)
    return html


def main():
    check = '--check' in sys.argv
    stale = []
    for p in pages():
        rel = os.path.relpath(p, REPO).replace(os.sep, '/')
        old = open(p, encoding='utf-8').read()
        new = secure(old, rel)
        if new != old:
            stale.append(rel)
            if not check:
                open(p, 'w', encoding='utf-8').write(new)
    sm = os.path.join(REPO, 'sitemap.xml')
    if not os.path.exists(sm) or open(sm, encoding='utf-8').read() != sitemap_xml():
        stale.append('sitemap.xml')
        if not check:
            open(sm, 'w', encoding='utf-8').write(sitemap_xml())
    if check:
        if stale:
            print('Out of date (run python3 tools/secure_pages.py):', ', '.join(stale))
            sys.exit(1)
        print('All pages secured.')
    else:
        print('Secured %d page(s): %s' % (len(stale), ', '.join(stale) or 'none changed'))


if __name__ == '__main__':
    main()
