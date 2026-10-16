#!/usr/bin/env python3
"""Weekly USDA AMS price update for the Decision Aids site.

Three prices on this site come from public USDA AMS Market News reports:

    bred_cow     AMS 1953  Cattlemen's Livestock, Dalhart TX     BRED COWS M&L 1, 2-4 yr, 2nd trimester  ($/hd)
    bred_heifer  AMS 1955  Texas Weekly Cattle Auction Summary   BRED HEIFERS M&L 1                      ($/hd)
    fed_cattle   AMS 2477  5 Area Weekly Direct Slaughter Cattle Live FOB steers, Over 80% Choice        ($/cwt)

`data/market-prices.json` is the single source of truth for them. This script has two steps:

    python3 tools/update_prices.py fetch   # ask the MyMarketNews API for newer reports, update the JSON
    python3 tools/update_prices.py apply   # write the JSON values into the pages (defaults only)

`fetch` needs a free MyMarketNews API key in the AMS_API_KEY environment variable
(https://mymarketnews.ams.usda.gov -> sign in -> API key). It never touches the pages.

Safety rules (a price is only changed when ALL hold):
  * the report is newer than the one on file;
  * a line matching the exact rule above exists (no fallback to a different class);
  * the new value is inside a sane range for that class;
  * it moved less than MAX_CHANGE from the value on file.
A matching line that breaks the range or the MAX_CHANGE rule is left out and written to
`price-update-report.md` as a warning, so the workflow can open an issue for a person to check.

Visitors' own saved numbers (localStorage) are never touched: only the page defaults change.
Standard library only.
"""
import base64, datetime as dt, json, os, re, subprocess, sys, urllib.error, urllib.parse, urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
DATA = os.path.join(REPO, 'data', 'market-prices.json')
REPORT = os.path.join(REPO, 'price-update-report.md')
API = 'https://marsapi.ams.usda.gov/services/v1.2/reports/'
LOOKBACK_DAYS = 21
MAX_CHANGE = 0.25          # 25% week-to-week move is treated as "check by hand"
SANE = {'bred_cow': (800, 8000), 'bred_heifer': (800, 9000), 'fed_cattle': (100, 400)}

# ---------------------------------------------------------------------------------------------
# Reading API rows. MyMarketNews field names differ between reports, so rows are read
# defensively: keys are compared without case/punctuation, and text rules look at the
# specific field when it exists and at the whole row otherwise.
# ---------------------------------------------------------------------------------------------

def norm(k):
    return re.sub(r'[^a-z0-9]', '', str(k).lower())

def field(row, *names):
    nk = {norm(k): v for k, v in row.items()}
    for n in names:
        v = nk.get(norm(n))
        if v not in (None, ''):
            return v
    return None

def number(row, *names):
    v = field(row, *names)
    if v is None:
        return None
    try:
        return float(str(v).replace(',', '').replace('$', '').strip())
    except ValueError:
        return None

def text(row):
    return ' '.join(str(v) for v in row.values() if isinstance(v, (str, int, float))).lower()

def parse_date(s):
    if not s:
        return None
    s = str(s).strip()[:10]
    for f in ('%m/%d/%Y', '%Y-%m-%d', '%Y/%m/%d'):
        try:
            return dt.datetime.strptime(s, f).date()
        except ValueError:
            pass
    return None

def rows_of(payload):
    """Flatten an API response (single section or allSections list) into rows."""
    out = []
    if isinstance(payload, dict):
        if isinstance(payload.get('results'), list):
            out += [r for r in payload['results'] if isinstance(r, dict)]
        for v in payload.values():
            if isinstance(v, list) and v is not payload.get('results'):
                out += rows_of(v)
    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict) and isinstance(item.get('results'), list):
                out += rows_of(item)
            elif isinstance(item, dict):
                out.append(item)
    return out

def grade_is_1(row):
    """Medium & Large 1, not 1-2."""
    g = field(row, 'muscle_grade', 'grade', 'muscleGrade')
    if g is not None:
        return str(g).strip() in ('1', 'Medium and Large 1', 'Medium & Large 1')
    t = text(row)
    return bool(re.search(r'large\s*1(?![\s-]*\d)', t))

def per_head(row):
    u = field(row, 'price_unit', 'unit', 'priceUnit')
    return u is None or 'head' in str(u).lower()

def is_class(row, word):
    c = field(row, 'class', 'class_description', 'commodity_class')
    return word in (str(c).lower() if c is not None else text(row))

def match_bred_cow(row):
    if not (is_class(row, 'bred cow') and grade_is_1(row) and per_head(row)):
        return False
    age = str(field(row, 'age', 'age_description') or text(row)).lower()
    stage = str(field(row, 'pregnancy_stage', 'stage', 'trimester', 'pregnancyStage') or text(row)).lower()
    return bool(re.search(r'\b2\s*-\s*4\b', age)) and bool(re.search(r'\bt2\b|2nd|second|\bt\s*2\b', stage))

def match_bred_heifer(row):
    return is_class(row, 'bred heifer') and grade_is_1(row) and per_head(row)

def match_fed_cattle(row):
    t = text(row)
    basis = str(field(row, 'selling_basis_description', 'selling_basis', 'basis') or t).lower()
    klass = str(field(row, 'class_description', 'class') or t).lower()
    grade = str(field(row, 'grade_description', 'grade', 'quality_grade') or t).lower()
    return ('live' in basis and 'fob' in basis and 'steer' in klass and 'heifer' not in klass
            and 'mixed' not in klass and 'over 80' in grade)

PRICE = ('avg_price', 'weighted_avg_price', 'wtd_avg_price', 'weighted_average_price', 'weighted_average', 'avg')
HEAD = ('head_count', 'heads', 'head', 'number_of_head')
WEIGHT = ('avg_weight', 'weighted_avg_weight', 'average_weight', 'wtd_avg_weight')
LOW = ('avg_price_min', 'price_low', 'price_range_low', 'low_price', 'price_min')
HIGH = ('avg_price_max', 'price_high', 'price_range_high', 'high_price', 'price_max')
WLOW = ('avg_weight_min', 'weight_min', 'weight_range_low')
WHIGH = ('avg_weight_max', 'weight_max', 'weight_range_high')

RULES = {'bred_cow': match_bred_cow, 'bred_heifer': match_bred_heifer, 'fed_cattle': match_fed_cattle}

def money(v, dec=2):
    return ('${:,.%df}' % dec).format(v)

def lbs(v):
    return '{:,.0f}'.format(v)

def pick(key, rows, since):
    """Newest report after `since` with at least one line matching the rule.
    Returns (date, value, detail_html, lines) or None."""
    by_date = {}
    for r in rows:
        d = parse_date(field(r, 'report_date', 'report_end_date', 'published_date', 'reportDate'))
        if d and d > since and RULES[key](r) and number(r, *PRICE):
            by_date.setdefault(d, []).append(r)
    if not by_date:
        return None
    d = max(by_date)
    lines = by_date[d]
    heads = [number(r, *HEAD) or 0 for r in lines]
    prices = [number(r, *PRICE) for r in lines]
    total = sum(heads)
    value = sum(h * p for h, p in zip(heads, prices)) / total if total else sum(prices) / len(prices)
    value = round(value, 2)
    return d, value, detail_for(key, lines, value, total), lines

def detail_for(key, lines, value, heads):
    lo = [x for x in (number(r, *LOW) for r in lines) if x]
    hi = [x for x in (number(r, *HIGH) for r in lines) if x]
    wl = [x for x in (number(r, *WLOW) for r in lines) if x]
    wh = [x for x in (number(r, *WHIGH) for r in lines) if x]
    wa = [x for x in (number(r, *WEIGHT) for r in lines) if x]
    n = len(lines)
    linewords = '1 line' if n == 1 else '%d lines, head-weighted average' % n
    bits = []
    if heads:
        bits.append('{:,.0f}&nbsp;hd'.format(heads))
    if wl and wh:
        bits.append('%s&ndash;%s&nbsp;lb' % (lbs(min(wl)), lbs(max(wh))))
    elif wa:
        bits.append('avg %s&nbsp;lb' % lbs(sum(wa) / len(wa)))
    if key == 'fed_cattle':
        if lo and hi:
            bits.insert(0, '$%s&ndash;$%s/cwt' % ('{:,.0f}'.format(min(lo)), '{:,.0f}'.format(max(hi))))
        return ('USDA AMS "5&nbsp;Area Weekly Weighted Average Direct Slaughter Cattle" (<code>ams_2477.pdf</code>) '
                '&mdash; live FOB steers, Over 80%% Choice, %s, weighted avg %s/cwt' % (', '.join(bits), money(value)))
    if lo and hi:
        bits.append('$%s&ndash;$%s/hd' % ('{:,.0f}'.format(min(lo)), '{:,.0f}'.format(max(hi))))
    if key == 'bred_cow':
        return ('Cattlemen\'s Livestock, Dalhart TX (<code>ams_1953.pdf</code>) &mdash; "BRED COWS, Medium &amp; Large 1", '
                '2&ndash;4&nbsp;yr, 2nd trimester (%s): %s' % (linewords, ', '.join(bits)))
    return ('USDA AMS "Texas Weekly Cattle Auction Summary" (<code>ams_1955.pdf</code>) &mdash; "BRED HEIFERS, Medium &amp; Large 1" '
            '(%s): %s, average %s/hd' % (linewords, ', '.join(bits), money(value)))

def as_of_label(key, d):
    s = d.strftime('%b ') + str(d.day) + d.strftime(', %Y')
    return ('report dated ' + s) if key == 'fed_cattle' else s

# ---------------------------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------------------------

def api_get(slug, key, today):
    start = (today - dt.timedelta(days=LOOKBACK_DAYS)).strftime('%m/%d/%Y')
    end = today.strftime('%m/%d/%Y')
    q = urllib.parse.quote('report_begin_date=%s:%s' % (start, end), safe='=:/')
    url = '%s%s?q=%s&allSections=true' % (API, slug, q)
    req = urllib.request.Request(url, headers={
        'Authorization': 'Basic ' + base64.b64encode((key + ':').encode()).decode(),
        'Accept': 'application/json', 'User-Agent': 'tamu-decision-aids-price-update'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def fetch(data, payloads, today):
    """payloads: {slug: api json}. Returns (changed_keys, report_lines)."""
    changed, notes = [], []
    for key, p in data['prices'].items():
        since = parse_date(p['report_date'])
        payload = payloads.get(p['report_slug'])
        if payload is None:
            notes.append('- **%s**: report %s could not be read; kept %s.' % (p['label'], p['report_slug'], fmt_unit(p)))
            continue
        rows = rows_of(payload)
        got = pick(key, rows, since)
        if not got:
            notes.append('- %s: no newer matching line in report %s (%d rows read); kept %s from %s.'
                         % (p['label'], p['report_slug'], len(rows), fmt_unit(p), p['report_date']))
            continue
        d, value, detail, lines = got
        lo, hi = SANE[key]
        move = abs(value - p['value']) / p['value'] if p['value'] else 0
        if not (lo <= value <= hi) or move > MAX_CHANGE:
            notes.append('- :warning: **%s**: report %s dated %s gives %s (%+.1f%% vs %s). Outside the safety limits, '
                         'NOT applied; check the report by hand.' % (p['label'], p['report_slug'], d, fmt_unit(p, value),
                                                                    100 * (value - p['value']) / p['value'], fmt_unit(p)))
            continue
        old = p['value']
        p.update(value=value, report_date=d.isoformat(), as_of_label=as_of_label(key, d), detail_html=detail)
        data['history'].append({'key': key, 'value': value, 'report_date': d.isoformat(), 'applied': today.isoformat()})
        if round(old, 2) != round(value, 2):
            notes.append('- **%s**: %s -> **%s** (report %s, %s).' % (p['label'], fmt_unit(p, old), fmt_unit(p), p['report_slug'], d))
        else:
            notes.append('- %s: newer report %s (%s), same value %s; date updated.' % (p['label'], p['report_slug'], d, fmt_unit(p)))
        changed.append(key)
    if changed:
        data['updated'] = today.isoformat()
    return changed, notes

def fmt_unit(p, v=None):
    v = p['value'] if v is None else v
    return money(v) + ('/hd' if p['unit'] == '$/hd' else '/cwt')

# ---------------------------------------------------------------------------------------------
# apply: write JSON values into the pages
# ---------------------------------------------------------------------------------------------

# (file, js object keys, input ids) per price. Only these files.
TARGETS = {
    'bred_cow': [('index.html', ['mp_bredCowPrice'], ['mp_bredCowPrice']),
                 ('cow-calf/index.html', ['mp_bredCowPrice', 'bidPrice', 'a2_cowCost'], ['bidPrice', 'a2_cowCost'])],
    'bred_heifer': [('index.html', ['mp_bredHeiferPrice'], ['mp_bredHeiferPrice']),
                    ('replacement-heifer/index.html', ['mp_bredHeiferPrice', 'rh_bredPrice'], ['rh_bredPrice'])],
    'fed_cattle': [('index.html', ['mp_fedCattlePrice'], ['mp_fedCattlePrice']),
                   ('retained-ownership/index.html', ['mp_fedCattlePrice', 'skfy7_salePrice', 'skfy8_salePrice'],
                    ['skfy7_salePrice', 'skfy8_salePrice'])],
}

USED = {
    'bred_cow': 'Bred cow purchase price &mdash; <a href="cow-calf/index.html">A1</a> "Bid price", <a href="cow-calf/index.html">A2</a> "Cost/head"',
    'fed_cattle': 'Fed/finished cattle sale price &mdash; <a href="retained-ownership/index.html">Stockers</a> "Feedyard" paths (both sub-paths)',
    'bred_heifer': 'Bred heifer sale price &mdash; shared store\'s <code>mp_bredHeiferPrice</code>, read by <a href="replacement-heifer/index.html">B1a</a> "Bred heifer sale price"',
}
CENTRAL = {'bred_cow': 'Bred cow purchase price', 'fed_cattle': 'Fed/finished cattle sale price'}

def js_num(v):
    return '%.2f' % v

def input_num(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')

def row_html(key, p):
    return ('<!-- price:%s:start -->\n          <tr>\n            <td class="value nowrap">%s</td>\n'
            '            <td class="used">%s</td>\n            <td>%s</td>\n'
            '            <td><span class="tag fresh">%s</span></td>\n          </tr>\n          <!-- price:%s:end -->'
            % (key, fmt_unit(p), USED[key], p['detail_html'], p['as_of_label'], key))

def apply(data, repo=REPO):
    """Returns list of files changed. Raises if an expected spot is missing."""
    changed = []
    edits = {}
    def load(f):
        if f not in edits:
            edits[f] = open(os.path.join(repo, f), encoding='utf-8').read()
        return edits[f]
    for key, targets in TARGETS.items():
        v = data['prices'][key]['value']
        for f, objkeys, ids in targets:
            html = load(f)
            for k in objkeys:
                html, n = re.subn(r'(\b%s\s*:\s*)[0-9]+(?:\.[0-9]+)?' % re.escape(k), lambda m: m.group(1) + js_num(v), html)
                if n == 0:
                    raise SystemExit('apply: %s: no "%s:" default found' % (f, k))
            for i in ids:
                html, n = re.subn(r'(id="%s"[^>]*?\bvalue=")[0-9.]*(")' % re.escape(i),
                                  lambda m: m.group(1) + input_num(v) + m.group(2), html)
                if n != 1:
                    raise SystemExit('apply: %s: expected one input #%s, found %d' % (f, i, n))
            edits[f] = html
    ds = load('data-sources.html')
    for key, p in data['prices'].items():
        ds, n = re.subn(r'<!-- price:%s:start -->.*?<!-- price:%s:end -->' % (key, key),
                        lambda m: row_html(key, p), ds, flags=re.S)
        if n != 1:
            raise SystemExit('apply: data-sources.html: marker for %s missing' % key)
        if key in CENTRAL:
            ds, n = re.subn(r'(<tr><td class="value nowrap">)\$[0-9,.]+/(?:hd|cwt)(</td><td class="used">%s)' % re.escape(CENTRAL[key]),
                            lambda m: m.group(1) + fmt_unit(p) + m.group(2), ds)
            if n != 1:
                raise SystemExit('apply: data-sources.html: centralized row for %s missing' % key)
    edits['data-sources.html'] = ds
    for f, html in edits.items():
        path = os.path.join(repo, f)
        if open(path, encoding='utf-8').read() != html:
            open(path, 'w', encoding='utf-8').write(html)
            changed.append(f)
    if changed:   # inline-script hashes in the CSP must follow the edit
        subprocess.run([sys.executable, os.path.join(repo, 'tools', 'secure_pages.py')], check=True,
                       stdout=subprocess.DEVNULL)
    return changed

# ---------------------------------------------------------------------------------------------

def main(argv):
    cmd = argv[1] if len(argv) > 1 else ''
    data = json.load(open(DATA, encoding='utf-8'))
    if cmd == 'fetch':
        key = os.environ.get('AMS_API_KEY', '').strip()
        if not key:
            raise SystemExit('fetch: AMS_API_KEY is not set (add it under Settings -> Secrets and variables -> Actions)')
        today = dt.date.today()
        dump = os.environ.get('AMS_DUMP_DIR')
        payloads = {}
        errors = []
        for slug in sorted({p['report_slug'] for p in data['prices'].values()}):
            try:
                payloads[slug] = api_get(slug, key, today)
                if dump:
                    os.makedirs(dump, exist_ok=True)
                    json.dump(payloads[slug], open(os.path.join(dump, 'ams_%s.json' % slug), 'w'), indent=1)
            except (urllib.error.URLError, ValueError, TimeoutError) as e:
                errors.append('- report %s: %s' % (slug, e))
        changed, notes = fetch(data, payloads, today)
        if changed:
            with open(DATA, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write('\n')
        body = ['## USDA price check, %s' % today.isoformat(), ''] + notes
        if errors:
            body += ['', '**API errors:**'] + errors
        open(REPORT, 'w', encoding='utf-8').write('\n'.join(body) + '\n')
        print('\n'.join(body))
        return 0
    if cmd == 'apply':
        files = apply(data)
        print('updated: ' + (', '.join(files) if files else 'nothing (pages already match)'))
        return 0
    print(__doc__)
    return 2

if __name__ == '__main__':
    sys.exit(main(sys.argv))
