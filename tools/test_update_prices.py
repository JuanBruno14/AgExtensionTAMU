#!/usr/bin/env python3
"""Offline tests for tools/update_prices.py (no network, no API key).

    python3 tools/test_update_prices.py
"""
import copy, datetime as dt, json, os, shutil, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import update_prices as up

REPO = up.REPO
BASE = json.load(open(up.DATA, encoding='utf-8'))
TODAY = dt.date(2026, 10, 19)

def auction(**kw):
    row = {'report_date': '10/16/2026', 'commodity': 'Replacement Cattle', 'frame': 'Medium and Large',
           'muscle_grade': '1', 'price_unit': 'Per Head', 'head_count': 10, 'avg_weight': 1100,
           'avg_weight_min': 1050, 'avg_weight_max': 1150, 'avg_price_min': 3000, 'avg_price_max': 3200}
    row.update(kw)
    return row

def section(rows):
    return [{'reportSection': 'Report Header', 'results': [{'report_date': '10/16/2026', 'report_title': 'x'}]},
            {'reportSection': 'Report Detail', 'results': rows}]

def fed(**kw):
    row = {'report_date': '10/19/2026', 'selling_basis_description': 'LIVE FOB', 'class_description': 'STEER',
           'grade_description': 'Over 80% Choice', 'head_count': 20000, 'weighted_avg_price': 224.50,
           'price_range_low': 222, 'price_range_high': 227, 'avg_weight': 1600}
    row.update(kw)
    return row

fails = []
def check(name, cond):
    print(('ok   ' if cond else 'FAIL ') + name)
    if not cond:
        fails.append(name)

# --- matching rules -------------------------------------------------------------------------
check('bred cow M&L 1, 2-4 yr, T2 matches', up.match_bred_cow(auction(**{'class': 'Bred Cows', 'age': '2-4', 'pregnancy_stage': 'T2'})))
check('bred cow M&L 1-2 rejected', not up.match_bred_cow(auction(**{'class': 'Bred Cows', 'muscle_grade': '1-2', 'age': '2-4', 'pregnancy_stage': 'T2'})))
check('bred cow >8 yr rejected', not up.match_bred_cow(auction(**{'class': 'Bred Cows', 'age': '>8', 'pregnancy_stage': 'T2'})))
check('bred cow T3 rejected', not up.match_bred_cow(auction(**{'class': 'Bred Cows', 'age': '2-4', 'pregnancy_stage': 'T3'})))
check('bred cow per cwt rejected', not up.match_bred_cow(auction(**{'class': 'Bred Cows', 'age': '2-4', 'pregnancy_stage': 'T2', 'price_unit': 'Per Cwt'})))
check('bred heifer M&L 1 matches', up.match_bred_heifer(auction(**{'class': 'Bred Heifers'})))
check('bred heifer M&L 1-2 rejected', not up.match_bred_heifer(auction(**{'class': 'Bred Heifers', 'muscle_grade': '1-2'})))
check('fed steers live FOB over 80% matches', up.match_fed_cattle(fed()))
check('dressed basis rejected', not up.match_fed_cattle(fed(selling_basis_description='DRESSED DELIVERED')))
check('heifers rejected', not up.match_fed_cattle(fed(class_description='HEIFER')))
check('65-80% Choice rejected', not up.match_fed_cattle(fed(grade_description='65-80% Choice')))
check('no field names: text fallback', up.match_bred_heifer({'desc': 'Bred Heifers Medium and Large 1 Per Head', 'avg_price': 3000}))

# --- fetch logic ----------------------------------------------------------------------------
data = copy.deepcopy(BASE)
payloads = {
    '1953': section([auction(**{'class': 'Bred Cows', 'age': '2-4', 'pregnancy_stage': 'T2', 'head_count': 10, 'avg_price': 2900}),
                     auction(**{'class': 'Bred Cows', 'age': '2-4', 'pregnancy_stage': 'T2', 'head_count': 30, 'avg_price': 3000}),
                     auction(**{'class': 'Bred Cows', 'muscle_grade': '1-2', 'age': '2-4', 'pregnancy_stage': 'T2', 'avg_price': 1000})]),
    '1955': section([auction(**{'class': 'Bred Heifers', 'avg_price': 3700, 'report_date': '10/09/2026'})]),  # not newer
    '2477': {'results': [fed()]},
}
changed, notes = up.fetch(data, payloads, TODAY)
check('bred cow head-weighted average', data['prices']['bred_cow']['value'] == 2975.0)
check('bred cow dated from report', data['prices']['bred_cow']['report_date'] == '2026-10-16')
check('bred heifer kept when report not newer', data['prices']['bred_heifer']['value'] == 3625.0 and 'bred_heifer' not in changed)
check('fed cattle updated', data['prices']['fed_cattle']['value'] == 224.5)
check('history appended', len(data['history']) == len(BASE['history']) + 2)

data = copy.deepcopy(BASE)
changed, notes = up.fetch(data, {'1955': section([auction(**{'class': 'Bred Heifers', 'avg_price': 6000})])}, TODAY)
check('65% jump not applied', data['prices']['bred_heifer']['value'] == 3625.0 and any(':warning:' in n for n in notes))
check('missing report keeps value', data['prices']['bred_cow']['value'] == 2828.62)

data = copy.deepcopy(BASE)
changed, notes = up.fetch(data, {'1955': section([auction(**{'class': 'Bred Heifers', 'muscle_grade': '1-2', 'avg_price': 3500})])}, TODAY)
check('only 1-2 lines -> no change', not changed)

# --- apply on a copy of the site ------------------------------------------------------------
tmp = tempfile.mkdtemp()
try:
    for f in ['index.html', 'cow-calf/index.html', 'replacement-heifer/index.html', 'retained-ownership/index.html',
              'data-sources.html', 'tools/secure_pages.py', 'jim/jim.js']:
        os.makedirs(os.path.join(tmp, os.path.dirname(f)), exist_ok=True)
        shutil.copy(os.path.join(REPO, f), os.path.join(tmp, f))
    check('apply with current JSON changes nothing', up.apply(copy.deepcopy(BASE), repo=tmp) == [])
    data = copy.deepcopy(BASE)
    up.fetch(data, payloads, TODAY)
    files = up.apply(data, repo=tmp)
    check('apply edits the four tools and data-sources', sorted(files) == sorted(
        ['index.html', 'cow-calf/index.html', 'retained-ownership/index.html', 'data-sources.html']))
    cc = open(os.path.join(tmp, 'cow-calf/index.html')).read()
    check('A1 input and default updated', 'id="bidPrice" value="2975"' in cc and 'bidPrice:2975.00' in cc and '2828.62,' not in cc)
    ro = open(os.path.join(tmp, 'retained-ownership/index.html')).read()
    check('feedyard paths updated', ro.count('skfy7_salePrice:224.50') == 1 and 'value="224.5"' in ro)
    ds = open(os.path.join(tmp, 'data-sources.html')).read()
    check('data-sources row regenerated', '$2,975.00/hd' in ds and 'Oct 16, 2026' in ds)
    check('apply is idempotent', up.apply(data, repo=tmp) == [])
    rh = open(os.path.join(tmp, 'replacement-heifer/index.html')).read()
    check('untouched page stays identical', rh == open(os.path.join(REPO, 'replacement-heifer/index.html')).read())
finally:
    shutil.rmtree(tmp)

print('\n%d failed' % len(fails) if fails else '\nall passed')
sys.exit(1 if fails else 0)
