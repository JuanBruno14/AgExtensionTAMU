#!/usr/bin/env python3
"""Security pass for every published page. Run it after any page edit or build:

    python3 tools/secure_pages.py          # update all pages
    python3 tools/secure_pages.py --check  # exit 1 if any page is out of date (for tests / CI)

For each .html page outside vendor/ and src/ it:
  1. writes a Content-Security-Policy <meta> (scripts only from this site + the exact inline
     scripts on the page, by SHA-256 hash; network calls only to the services listed below);
  2. writes a Referrer-Policy <meta>;
  3. puts the State of Texas / Texas A&M AgriLife required links (and the Extension
     equal-opportunity statement, if the footer lacks it) at the end of the page footer;
  4. adds rel="noopener noreferrer" to any link that opens a new tab without it.

The two built pages (my-ranch, herd-tools) call this script at the end of their build.
"""
import base64, glob, hashlib, os, re, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))

# Jim's relay (Cloudflare Worker). Read from jim/jim.js so the policy always matches the widget.
_jim = open(os.path.join(REPO, 'jim', 'jim.js'), encoding='utf-8').read()
_m = re.search(r'var JIM_ENDPOINT = "(https://[^"/]+)', _jim)
JIM_ORIGIN = _m.group(1) if _m else ''

CONNECT = ["'self'", JIM_ORIGIN,
           'https://sdmdataaccess.sc.egov.usda.gov',     # USDA-NRCS Soil Data Access (My Ranch)
           'https://services9.arcgis.com',               # U.S. Drought Monitor layer (My Ranch)
           'https://nominatim.openstreetmap.org']        # place search (My Ranch)
IMAGES = ["'self'", 'data:', 'blob:',
          'https://server.arcgisonline.com',             # Esri imagery and reference tiles
          'https://tile.openstreetmap.org']              # street map tiles

REQUIRED_LINKS = [
    ('Site privacy &amp; data', '{root}privacy.html'),
    ('Compact with Texans', 'https://agrilife.tamu.edu/required-links/compact/'),
    ('Privacy and Security', 'https://agrilife.tamu.edu/required-links/privacy/'),
    ('Accessibility Policy', 'https://agrilife.tamu.edu/accessibility/'),
    ('State Link Policy', 'https://dir.texas.gov/resource-library-item/state-website-linking-and-privacy-policy'),
    ('Statewide Search', 'https://www.tsl.texas.gov/trail/index.html'),
    ('Veterans Benefits', 'https://veterans.tamu.edu/'),
    ('Military Families', 'https://fch.tamu.edu/programs/military-programs/'),
    ('Risk, Fraud &amp; Misconduct Hotline', 'https://secure.ethicspoint.com/domain/en/report_custom.asp?clientid=19681'),
    ('Texas Homeland Security', 'https://gov.texas.gov/organization/hsgd'),
    ("Texas Veteran&rsquo;s Portal", 'https://veterans.portal.texas.gov/'),
    ('Equal Opportunity', 'https://agrilifeas.tamu.edu/hr/equal-opportunity/affirmative-actionequal-opportunity-employment/'),
    ('Open Records/Public Information', 'https://agrilife.tamu.edu/required-links/orpi/'),
]
EEO = ('<p class="eeo-statement">Texas A&amp;M AgriLife Extension Service provides equal opportunities in its programs and '
       'employment to all persons, regardless of race, color, sex, religion, national origin, disability, age, genetic '
       'information, and veteran status. The Texas A&amp;M University System, U.S. Department of Agriculture, and the '
       'County Commissioners Courts of Texas Cooperating.</p>')
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


def links_block(rel, footer_has_eeo):
    root = '../' * rel.count('/')
    items = ''.join('<li><a href="%s">%s</a></li>' % (href.format(root=root), label) for label, href in REQUIRED_LINKS)
    eeo = '' if footer_has_eeo else EEO
    return LINKS_START + CSS + eeo + '<ul class="required-links" aria-label="Required links">' + items + '</ul>' + LINKS_END


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


def secure(html, rel):
    # 1. required links at the end of the footer (replace an earlier copy)
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
    if check:
        if stale:
            print('Out of date (run python3 tools/secure_pages.py):', ', '.join(stale))
            sys.exit(1)
        print('All pages secured.')
    else:
        print('Secured %d page(s): %s' % (len(stale), ', '.join(stale) or 'none changed'))


if __name__ == '__main__':
    main()
