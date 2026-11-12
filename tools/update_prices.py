#!/usr/bin/env python3
"""Weekly USDA AMS price update for the Decision Aids site.

These prices on this site come from public USDA AMS Market News reports:

    bred_cow     AMS 1955  Texas Weekly Cattle Auction Summary   BRED COWS M&L 1 / 1-2, 2-4 yr, 2nd-3rd stage ($/hd)
    bred_heifer  AMS 1955  Texas Weekly Cattle Auction Summary   BRED HEIFERS M&L 1                      ($/hd)
    fed_cattle   AMS 2477  5 Area Weekly Direct Slaughter Cattle Live FOB steers, Over 80% Choice        ($/cwt)
    steer        AMS 1955  Texas Weekly Cattle Auction Summary   FEEDER STEERS M&L 1, 500-549 lb         ($/cwt)
    heifer       AMS 1955  Texas Weekly Cattle Auction Summary   FEEDER HEIFERS M&L 1, 500-549 lb        ($/cwt)
    stocker_700  AMS 1955  Texas Weekly Cattle Auction Summary   FEEDER STEERS M&L 1, 700-749 lb         ($/cwt)
    stocker_800  AMS 1955  Texas Weekly Cattle Auction Summary   FEEDER STEERS M&L 1, 800-849 lb         ($/cwt)
    cull_cow     AMS 1955  Texas Weekly Cattle Auction Summary   SLAUGHTER COWS Boner 80-85%, Average    ($/cwt)
    cull_bull    AMS 1955  Texas Weekly Cattle Auction Summary   SLAUGHTER BULLS 1-2, Average            ($/cwt)

Auction prices (every class except fed_cattle) are the head-weighted average of all matching
lines in the last WINDOW_DAYS of reports (four weekly editions), so one thin week does not
swing a price; fewer than MIN_HEAD head in the window keeps the old price. fed_cattle is
already a national weekly weighted average and uses the newest week only.

Feeder lines only count when they are plain lots: lines the report marks Fancy, Full,
Fleshy, Thin Fleshed, Unweaned, Value Added or Gaunt are left out, and so are slaughter
lines marked Light Weight, High or Low dressing.

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
MPR = 'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/'
LOOKBACK_DAYS = 35         # enough reports for the 4-week window
WINDOW_DAYS = 28           # auction prices: head-weighted over the last four weekly reports
MIN_HEAD = 10              # fewer head than this in the window: keep the old price
MAX_CHANGE = 0.25          # 25% week-to-week move is treated as "check by hand"
SANE = {'bred_cow': (800, 8000), 'bred_heifer': (800, 9000), 'fed_cattle': (100, 400),
        'steer': (100, 1000), 'heifer': (100, 1000), 'stocker_700': (100, 800), 'stocker_800': (100, 800),
        'cull_cow': (40, 400), 'cull_bull': (40, 400)}

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
    """USDA writes per-head prices as "Per Unit" in the API ("Per Head" in some reports)."""
    u = field(row, 'price_unit', 'unit', 'priceUnit')
    return u is None or 'head' in str(u).lower() or 'unit' in str(u).lower()

def is_class(row, word):
    c = field(row, 'class', 'class_description', 'commodity_class')
    return word in (str(c).lower() if c is not None else text(row))

def match_bred_cow(row):
    """Young (2-4 yr) bred cows, Medium & Large 1 or 1-2, 2nd or 3rd stage (2nd/3rd lines too).
    Young cows fit A1's seven calving opportunities; 1st-stage cows carry more open risk."""
    if not (is_class(row, 'bred cow') and (grade_is_1(row) or grade_is_12(row)) and per_head(row)):
        return False
    frame = str(field(row, 'frame', 'frame_desc') or '').lower()
    if frame and 'medium' not in frame and 'large' not in frame:
        return False
    age = str(field(row, 'age', 'age_description') or text(row)).lower()
    stage = str(field(row, 'pregnancy_stage', 'stage', 'trimester', 'pregnancyStage') or text(row)).lower()
    later = bool(re.search(r'\bt[23]\b|2nd|3rd|second|third', stage))
    early = bool(re.search(r'1st|first|\bt1\b', stage))
    return bool(re.search(r'\b2\s*-\s*4\b', age)) and later and not early

def match_bred_heifer(row):
    return is_class(row, 'bred heifer') and grade_is_1(row) and per_head(row)

def match_fed_cattle(row):
    t = text(row)
    basis = str(field(row, 'selling_basis_description', 'selling_basis', 'basis') or t).lower()
    klass = str(field(row, 'class_description', 'class') or t).lower()
    grade = str(field(row, 'grade_description', 'grade', 'quality_grade') or t).lower()
    return ('live' in basis and 'fob' in basis and 'steer' in klass and 'heifer' not in klass
            and 'mixed' not in klass and 'over 80' in grade)

SPECIAL = re.compile(r'\b(fancy|full|fleshy|thin|unweaned|value[ -]?added|gaunt|light ?weight)\b')

def per_cwt(row):
    u = field(row, 'price_unit', 'unit', 'priceUnit')
    return u is None or 'cwt' in str(u).lower()

def klass(row):
    c = field(row, 'class', 'class_description', 'commodity_class')
    return str(c).lower() if c is not None else text(row)

def plain(row):
    """No lot note (Fancy, Unweaned, Light Weight, ...) anywhere on the line."""
    return not SPECIAL.search(text(row))

def feeder(row):
    c = field(row, 'commodity', 'commodity_desc', 'market_type_category')
    return c is None or 'feeder' in str(c).lower()

def in_band(row, lo, hi):
    """Average weight in [lo, hi) and, when given, the whole weight range inside it too."""
    a = number(row, *WEIGHT)
    mn, mx = number(row, *WLOW), number(row, *WHIGH)
    if a is None:
        return False
    return lo <= a < hi and (mn is None or mn >= lo) and (mx is None or mx < hi)

def feeder_line(row, sex, lo, hi):
    k = klass(row)
    other = 'heifer' if sex == 'steer' else 'steer'
    return (sex in k and other not in k and 'bred' not in k and feeder(row) and grade_is_1(row)
            and per_cwt(row) and plain(row) and in_band(row, lo, hi))

def average_dressing(row):
    d = field(row, 'dressing', 'dressing_desc', 'dressing_description', 'yield_desc')
    if d is not None:
        return str(d).strip().lower() == 'average'
    t = text(row)
    return 'average' in t and not re.search(r'\b(high|low)\b', t)

def grade_is_12(row):
    for name in ('muscle_grade', 'yield_grade', 'quality_grade_name', 'grade', 'muscleGrade'):
        g = field(row, name)
        if g is not None and re.sub(r'\s', '', str(g)).endswith('1-2'):
            return True
    return False

def match_steer(row):
    return feeder_line(row, 'steer', 500, 550)

def match_heifer(row):
    return feeder_line(row, 'heifer', 500, 550)

def match_stocker_700(row):
    return feeder_line(row, 'steer', 700, 750)

def match_stocker_800(row):
    return feeder_line(row, 'steer', 800, 850)

def match_cull_cow(row):
    k = klass(row)
    return ('cow' in k and 'bred' not in k and 'pair' not in k and 'boner' in text(row)
            and per_cwt(row) and plain(row) and average_dressing(row))

def match_cull_bull(row):
    c = field(row, 'commodity', 'commodity_desc')
    slaughter = c is None or 'slaughter' in str(c).lower()
    return ('bull' in klass(row) and slaughter and grade_is_12(row) and per_cwt(row) and plain(row)
            and average_dressing(row))

HINT = {'bred_cow': 'bred cow', 'bred_heifer': 'bred heifer', 'cull_bull': 'bull', 'cull_cow': 'boner',
        'steer': 'steer', 'heifer': 'heifer', 'stocker_700': 'steer', 'stocker_800': 'steer', 'fed_cattle': 'live'}

PRICE = ('avg_price', 'weighted_avg_price', 'wtd_avg_price', 'weighted_average_price', 'weighted_average', 'avg')
HEAD = ('head_count', 'heads', 'head', 'number_of_head')
WEIGHT = ('avg_weight', 'weighted_avg_weight', 'average_weight', 'wtd_avg_weight')
LOW = ('avg_price_min', 'price_low', 'price_range_low', 'low_price', 'price_min')
HIGH = ('avg_price_max', 'price_high', 'price_range_high', 'high_price', 'price_max')
WLOW = ('avg_weight_min', 'weight_min', 'weight_range_low')
WHIGH = ('avg_weight_max', 'weight_max', 'weight_range_high')

RULES = {'bred_cow': match_bred_cow, 'bred_heifer': match_bred_heifer, 'fed_cattle': match_fed_cattle,
         'steer': match_steer, 'heifer': match_heifer, 'stocker_700': match_stocker_700,
         'stocker_800': match_stocker_800, 'cull_cow': match_cull_cow, 'cull_bull': match_cull_bull}

# How each 1955 per-cwt class is named in data-sources.html.
CWT_LINE = {
    'steer': 'FEEDER STEERS, Medium &amp; Large 1, 500&ndash;549&nbsp;lb',
    'heifer': 'FEEDER HEIFERS, Medium &amp; Large 1, 500&ndash;549&nbsp;lb',
    'stocker_700': 'FEEDER STEERS, Medium &amp; Large 1, 700&ndash;749&nbsp;lb',
    'stocker_800': 'FEEDER STEERS, Medium &amp; Large 1, 800&ndash;849&nbsp;lb',
    'cull_cow': 'SLAUGHTER COWS, Boner 80&ndash;85%, average dressing',
    'cull_bull': 'SLAUGHTER BULLS, 1&ndash;2, average dressing',
}

def money(v, dec=2):
    return ('${:,.%df}' % dec).format(v)

def lbs(v):
    return '{:,.0f}'.format(v)

def pick(key, rows, since):
    """Newest report after `since` with at least one line matching the rule; auction classes then
    average every matching line of the last WINDOW_DAYS (head-weighted).
    Returns (date, value, detail_html, lines) or None."""
    by_date = {}
    for r in rows:
        d = parse_date(field(r, 'published_date', 'report_date', 'report_end_date', 'reportDate'))
        if d and RULES[key](r) and number(r, *PRICE):
            by_date.setdefault(d, []).append(r)
    if not by_date:
        return None
    d = max(by_date)
    if d <= since:
        return None
    if key == 'fed_cattle':
        dates = [d]
    else:
        dates = sorted(x for x in by_date if (d - x).days < WINDOW_DAYS)
    lines = [r for x in dates for r in by_date[x]]
    heads = [number(r, *HEAD) or 0 for r in lines]
    prices = [number(r, *PRICE) for r in lines]
    total = sum(heads)
    if key != 'fed_cattle' and total < MIN_HEAD:
        return None
    value = sum(h * p for h, p in zip(heads, prices)) / total if total else sum(prices) / len(prices)
    value = round(value, 2)
    detail = detail_for(key, lines, value, total)
    if len(dates) > 1:
        detail += ' &mdash; %d weekly reports, %s to %s' % (len(dates), as_of_label(key, dates[0]), as_of_label(key, dates[-1]))
    return d, value, detail, lines

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
    if key in CWT_LINE:
        if lo and hi:
            bits.append('$%s&ndash;$%s/cwt' % ('{:,.2f}'.format(min(lo)), '{:,.2f}'.format(max(hi))))
        return ('USDA AMS "Texas Weekly Cattle Auction Summary" (<code>ams_1955.pdf</code>) &mdash; "%s", plain lots only '
                '(%s): %s, average %s/cwt' % (CWT_LINE[key], linewords, ', '.join(bits), money(value)))
    if lo and hi:
        bits.append('$%s&ndash;$%s/hd' % ('{:,.0f}'.format(min(lo)), '{:,.0f}'.format(max(hi))))
    if key == 'bred_cow':
        return ('USDA AMS "Texas Weekly Cattle Auction Summary" (<code>ams_1955.pdf</code>) &mdash; "BRED COWS, Medium &amp; Large 1 and 1&ndash;2", '
                'young (2&ndash;4&nbsp;yr), 2nd&ndash;3rd stage (%s): %s, average %s/hd' % (linewords, ', '.join(bits), money(value)))
    return ('USDA AMS "Texas Weekly Cattle Auction Summary" (<code>ams_1955.pdf</code>) &mdash; "BRED HEIFERS, Medium &amp; Large 1" '
            '(%s): %s, average %s/hd' % (linewords, ', '.join(bits), money(value)))

def as_of_label(key, d):
    s = d.strftime('%b ') + str(d.day) + d.strftime(', %Y')
    return ('report dated ' + s) if key == 'fed_cattle' else s

# ---------------------------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------------------------

def api_get(slug, key, today):
    """Not every report answers the same query: try the date-range query first, then simpler ones
    (rows outside the date window are filtered later by report date anyway)."""
    start = (today - dt.timedelta(days=LOOKBACK_DAYS)).strftime('%m/%d/%Y')
    end = today.strftime('%m/%d/%Y')
    q = urllib.parse.quote('report_begin_date=%s:%s' % (start, end), safe='=:/')
    tries = ['%s%s?q=%s&allSections=true' % (API, slug, q), '%s%s?q=%s' % (API, slug, q),
             '%s%s?allSections=true' % (API, slug), '%s%s' % (API, slug)]
    # Mandatory price reports (LM_*, e.g. 2477) live on the LMPR datamart, not on MyMarketNews.
    mq = urllib.parse.quote('report_date=%s:%s' % (start, end), safe='=:/')
    tries += ['%s%s?q=%s&allSections=true' % (MPR, slug, mq), '%s%s?allSections=true' % (MPR, slug), '%s%s' % (MPR, slug)]
    last = None
    for url in tries:
        req = urllib.request.Request(url, headers={
            'Authorization': 'Basic ' + base64.b64encode((key + ':').encode()).decode(),
            'Accept': 'application/json', 'User-Agent': 'tamu-decision-aids-price-update'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (400, 404):
                raise
            last = e
    raise last

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
            seen = pick(key, rows, dt.date.min)   # say what the rule did find, so a broken rule shows up
            word = HINT.get(key)
            like = [r for r in rows if word and word in text(r)]
            if key == 'cull_bull':
                like = [r for r in like if 'slaughter' in text(r)]
            if seen:
                found = 'latest matching line %s, %s' % (seen[0], fmt_unit(p, seen[1]))
            elif like:   # the class is in the report, just not this exact age/stage/weight this period
                found = 'no line fits the rule in this period, %d other %s lines seen' % (len(like), word)
            else:        # nothing of the class at all: the report format may have changed
                found = ':warning: no line of this class at all, check the rule against the report'
                for r in [r for r in rows if word and word.split()[0] in text(r)][:2]:
                    found += '\n  - sample row: `%s`' % json.dumps(r, default=str)[:900]
            notes.append('- %s: no newer matching line in report %s (%d rows read; %s); kept %s from %s.'
                         % (p['label'], p['report_slug'], len(rows), found, fmt_unit(p), p['report_date']))
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

# (file, js object keys, input ids[, year-grid arrays]) per price. Only these files.
# The weight-curve anchors (STEER_ANCHOR p:530 etc.) are the curves' own points: never edited here.
FEEDUI = 'src/my-ranch/feedui.js'
TARGETS = {
    'bred_cow': [('cow-decisions/index.html', ['mp_bredCowPrice'], ['mp_bredCowPrice']),
                 ('cow-calf/index.html', ['mp_bredCowPrice', 'bidPrice', 'a2_cowCost'], ['bidPrice', 'a2_cowCost'])],
    'bred_heifer': [('cow-decisions/index.html', ['mp_bredHeiferPrice'], ['mp_bredHeiferPrice']),
                    ('replacement-heifer/index.html', ['mp_bredHeiferPrice', 'rh_bredPrice'], ['rh_bredPrice'])],
    'fed_cattle': [('cow-decisions/index.html', ['mp_fedCattlePrice'], ['mp_fedCattlePrice']),
                   ('retained-ownership/index.html', ['mp_fedCattlePrice', 'skfy7_salePrice', 'skfy8_salePrice'],
                    ['skfy7_salePrice', 'skfy8_salePrice'])],
    'steer': [('cow-decisions/index.html', ['mp_steerPrice'], ['mp_steerPrice']),
              ('cow-calf/index.html', ['mp_steerPrice', 'a2_steerPrice'], ['a2_steerPrice'], ['STEER_PRICE_DEFAULT']),
              ('retained-ownership/index.html', ['mp_steerPrice', 'sk_calfPrice'], ['sk_calfPrice']),
              (FEEDUI, ['mp_steerPrice'], [])],
    'heifer': [('cow-decisions/index.html', ['mp_heiferPrice'], ['mp_heiferPrice']),
               ('cow-calf/index.html', ['mp_heiferPrice', 'a2_heiferPrice'], ['a2_heiferPrice'], ['HEIFER_PRICE_DEFAULT']),
               ('replacement-heifer/index.html', ['mp_heiferPrice'], []),
               (FEEDUI, ['mp_heiferPrice'], [])],
    'stocker_700': [('cow-decisions/index.html', ['mp_stocker700Price'], ['mp_stocker700Price']),
                    ('retained-ownership/index.html', ['mp_stocker700Price', 'sk_price700'], ['sk_price700'])],
    'stocker_800': [('cow-decisions/index.html', ['mp_stocker800Price'], ['mp_stocker800Price']),
                    ('retained-ownership/index.html', ['mp_stocker800Price', 'sk_price800'], ['sk_price800'])],
    'cull_cow': [('cow-decisions/index.html', ['mp_cullCowPrice'], ['mp_cullCowPrice']),
                 ('cow-calf/index.html', ['mp_cullCowPrice', 'a2_cullCowPrice'], ['a2_cullCowPrice'], ['CULL_PRICE_DEFAULT']),
                 ('retained-ownership/index.html', ['mp_cullCowPrice', 'd1_priceSold'], ['d1_priceSold']),
                 (FEEDUI, ['mp_cullCowPrice'], [])],
    'cull_bull': [('cow-decisions/index.html', ['mp_cullBullPrice'], ['mp_cullBullPrice']),
                  ('cow-calf/index.html', ['mp_cullBullPrice', 'a2_cullBullPrice'], ['a2_cullBullPrice']),
                  ('replacement-heifer/index.html', ['mp_cullBullPrice'], []),
                  (FEEDUI, ['mp_cullBullPrice'], [])],
}

USED = {
    'bred_cow': 'Bred cow purchase price &mdash; <a href="cow-calf/index.html">A1</a> "Bid price", <a href="cow-calf/index.html">A2</a> "Cost/head"',
    'fed_cattle': 'Fed/finished cattle sale price &mdash; <a href="retained-ownership/index.html">Stockers</a> "Feedyard" paths (both sub-paths)',
    'bred_heifer': 'Bred heifer sale price &mdash; shared store\'s <code>mp_bredHeiferPrice</code>, read by <a href="replacement-heifer/index.html">B1a</a> "Bred heifer sale price"',
    'steer': 'Steer price (516.4&nbsp;lb reference) &mdash; shared store\'s <code>mp_steerPrice</code>, read by <a href="cow-calf/index.html">A1/A2</a>, <a href="retained-ownership/index.html">Stockers</a>\' calf purchase price and <a href="my-ranch/index.html">My Ranch</a>; rescales <code>STEER_PRICE_SLIDE</code>',
    'heifer': 'Heifer price (531.3&nbsp;lb reference) &mdash; shared store\'s <code>mp_heiferPrice</code>, read by <a href="cow-calf/index.html">A1/A2</a>, <a href="replacement-heifer/index.html">B1a</a> and <a href="my-ranch/index.html">My Ranch</a>; rescales <code>HEIFER_PRICE_SLIDE</code>',
    'stocker_700': '700&nbsp;lb path sale price &mdash; shared store\'s <code>mp_stocker700Price</code>, read by <a href="retained-ownership/index.html">Stockers</a>',
    'stocker_800': '800&nbsp;lb path sale price &mdash; shared store\'s <code>mp_stocker800Price</code>, read by <a href="retained-ownership/index.html">Stockers</a>',
    'cull_cow': 'Cull cow price (1,279.4&nbsp;lb Boner reference) &mdash; shared store\'s <code>mp_cullCowPrice</code>, read by <a href="cow-calf/index.html">A1/A2</a>, <a href="retained-ownership/index.html">D1</a> and <a href="my-ranch/index.html">My Ranch</a>; rescales <code>CULL_COW_PRICE_SLIDE</code>',
    'cull_bull': 'Cull bull price &mdash; shared store\'s <code>mp_cullBullPrice</code>, read by <a href="cow-calf/index.html">A2</a>, <a href="replacement-heifer/index.html">B1a</a> and <a href="my-ranch/index.html">My Ranch</a> (bull salvage)',
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

KB = 'jim/kb.json'      # Jim's knowledge base, read live by the Worker from the published site
KB_ID = 'market-prices'
KB_ORDER = ['steer', 'heifer', 'stocker_700', 'stocker_800', 'cull_cow', 'cull_bull', 'bred_cow', 'bred_heifer',
            'fed_cattle']

def kb_chunk(data):
    """One knowledge-base passage with today's prices, so Jim can answer "what are calves worth now"."""
    out = ['These are the cattle prices the decision aids on this website start from. They are refreshed every '
           'week from USDA AMS market reports (auction prices are the head-weighted average of the last four weekly '
           'reports). Anyone can type their own prices on the home page, in "Market Prices & Factors".',
           '', 'Current prices, updated %s:' % data['updated']]
    for key in KB_ORDER + [k for k in data['prices'] if k not in KB_ORDER]:
        p = data['prices'][key]
        out.append('- %s: %s (USDA AMS %s, %s; %s)' % (p['label'], fmt_unit(p), p['report_name'], p['as_of_label'], p['rule']))
    out += ['', 'The 2026 D03 budgets were built in early 2026 with their own price list (for example steer calves '
            '$530/cwt, heifer calves $460/cwt, cull cows $180/cwt). Those are budget assumptions, not today\'s market. '
            'When someone asks what cattle are worth now, or which prices the tools use, give the prices above with their date.']
    return {'t': 'Current cattle market prices used on this website today (USDA weekly)', 'x': '\n'.join(out), 'i': KB_ID}

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
        for t in targets:
            f, objkeys, ids = t[:3]
            arrays = t[3] if len(t) > 3 else []
            html = load(f)
            for a in arrays:   # year-grid defaults: every year starts at today's price
                html, n = re.subn(r'(\b%s\s*=\s*\[)[^\]]*(\])' % re.escape(a),
                                  lambda m: m.group(1) + ','.join([js_num(v)] * 7) + m.group(2), html)
                if n != 1:
                    raise SystemExit('apply: %s: expected one array %s, found %d' % (f, a, n))
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
    kb = json.loads(load(KB))
    chunk = kb_chunk(data)
    idx = [n for n, c in enumerate(kb['chunks']) if c.get('i') == KB_ID]
    if idx:
        kb['chunks'][idx[0]] = chunk
    else:
        kb['chunks'].append(chunk)
    edits[KB] = json.dumps(kb, separators=(',', ':'), ensure_ascii=False)
    for f, html in edits.items():
        path = os.path.join(repo, f)
        if open(path, encoding='utf-8').read() != html:
            open(path, 'w', encoding='utf-8').write(html)
            changed.append(f)
    if FEEDUI in changed:   # My Ranch is built from src/my-ranch
        subprocess.run([sys.executable, os.path.join(repo, 'src', 'my-ranch', 'build.py')], check=True,
                       stdout=subprocess.DEVNULL)
        changed.append('my-ranch/index.html')
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
