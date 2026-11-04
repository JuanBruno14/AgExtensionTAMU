#!/usr/bin/env python3
"""Offline tests for tools/update_prices.py (no network, no API key).

    python3 tools/test_update_prices.py
"""
import copy, datetime as dt, json, os, shutil, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import update_prices as up

REPO = up.REPO
BASE = json.load(open(up.DATA, encoding='utf-8'))

def fetch_base():
    """The live JSON, with the bred heifer price pinned to a known value for the fetch tests."""
    d = copy.deepcopy(BASE)
    d['prices']['bred_heifer'].update(value=3625.0, report_date='2026-10-09')
    return d
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

def cwt(**kw):
    row = {'report_date': '10/30/2026', 'commodity': 'Feeder Cattle', 'class': 'Steers', 'frame': 'Medium and Large',
           'muscle_grade': '1', 'price_unit': 'Per Cwt', 'head_count': 100, 'avg_weight': 532,
           'avg_weight_min': 500, 'avg_weight_max': 549, 'avg_price_min': 360, 'avg_price_max': 450, 'avg_price': 407.31}
    row.update(kw)
    return row

def slaughter(**kw):
    row = {'report_date': '10/30/2026', 'commodity': 'Slaughter Cattle', 'class': 'Cows', 'grade': 'Boner 80-85%',
           'dressing': 'Average', 'price_unit': 'Per Cwt', 'head_count': 34, 'avg_weight': 1164,
           'avg_weight_min': 1015, 'avg_weight_max': 1305, 'avg_price_min': 114, 'avg_price_max': 133, 'avg_price': 126.24}
    row.update(kw)
    return row

check('steer 500-549 plain matches', up.match_steer(cwt()))
check('steer Fancy lot rejected', not up.match_steer(cwt(lot_desc='Fancy')))
check('steer Unweaned rejected', not up.match_steer(cwt(comments='Unweaned')))
check('steer Thin Fleshed rejected', not up.match_steer(cwt(lot_desc='Thin Fleshed')))
check('steer Value Added rejected', not up.match_steer(cwt(lot_desc='Value Added')))
check('steer 550-597 rejected', not up.match_steer(cwt(avg_weight=573, avg_weight_min=550, avg_weight_max=597)))
check('steer range crossing 550 rejected', not up.match_steer(cwt(avg_weight=545, avg_weight_min=520, avg_weight_max=585)))
check('steer M&L 1-2 rejected', not up.match_steer(cwt(muscle_grade='1-2')))
check('heifer line is not a steer', not up.match_steer(cwt(**{'class': 'Heifers'})))
check('heifer 500-545 matches', up.match_heifer(cwt(**{'class': 'Heifers', 'avg_weight': 516, 'avg_weight_max': 545})))
check('bred heifer is not a feeder heifer', not up.match_heifer(cwt(**{'class': 'Bred Heifers', 'commodity': 'Replacement Cattle'})))
check('700-740 steer -> 700 path', up.match_stocker_700(cwt(avg_weight=715, avg_weight_min=700, avg_weight_max=740)))
check('750-795 steer not 700 path', not up.match_stocker_700(cwt(avg_weight=780, avg_weight_min=750, avg_weight_max=795)))
check('800-845 steer -> 800 path', up.match_stocker_800(cwt(avg_weight=820, avg_weight_min=800, avg_weight_max=845)))
check('Boner average matches', up.match_cull_cow(slaughter()))
check('Boner light weight rejected', not up.match_cull_cow(slaughter(dressing='Average Light Weight')))
check('Boner high dressing rejected', not up.match_cull_cow(slaughter(dressing='High')))
check('Lean cow rejected', not up.match_cull_cow(slaughter(grade='Lean 85-90%')))
check('bred cow not a cull cow', not up.match_cull_cow(slaughter(**{'class': 'Bred Cows', 'price_unit': 'Per Head'})))
check('bull 1-2 average matches', up.match_cull_bull(slaughter(**{'class': 'Bulls', 'grade': '1-2'})))
check('bull 1 rejected', not up.match_cull_bull(slaughter(**{'class': 'Bulls', 'grade': '1'})))
check('bull low dressing rejected', not up.match_cull_bull(slaughter(**{'class': 'Bulls', 'grade': '1-2', 'dressing': 'Low'})))

data = copy.deepcopy(BASE)
for k in ('steer', 'heifer', 'cull_cow'):
    data['prices'][k]['report_date'] = '2026-10-23'
payload = section([cwt(head_count=144, avg_price=400), cwt(head_count=56, avg_price=420), cwt(lot_desc='Fancy', avg_price=900),
                   cwt(**{'class': 'Heifers', 'avg_price': 380}), slaughter(avg_price=130),
                   slaughter(dressing='High', avg_price=200)])
changed, notes = up.fetch(data, {'1955': payload}, dt.date(2026, 11, 2))
check('steer: head-weighted plain lots only', data['prices']['steer']['value'] == round((144*400 + 56*420) / 200, 2))
check('heifer updated', data['prices']['heifer']['value'] == 380.0)
check('cull cow from average dressing only', data['prices']['cull_cow']['value'] == 130.0)
check('class with no line keeps its price', data['prices']['stocker_800']['value'] == BASE['prices']['stocker_800']['value']
      and 'stocker_800' not in changed)

# --- fetch logic ----------------------------------------------------------------------------
data = fetch_base()
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

data = fetch_base()
changed, notes = up.fetch(data, {'1955': section([auction(**{'class': 'Bred Heifers', 'avg_price': 6000})])}, TODAY)
check('65% jump not applied', data['prices']['bred_heifer']['value'] == 3625.0 and any(':warning:' in n for n in notes))
check('missing report keeps value', data['prices']['bred_cow']['value'] == 2828.62)

data = fetch_base()
changed, notes = up.fetch(data, {'1955': section([auction(**{'class': 'Bred Heifers', 'muscle_grade': '1-2', 'avg_price': 3500})])}, TODAY)
check('only 1-2 lines -> no change', not changed)

# --- apply on a copy of the site ------------------------------------------------------------
tmp = tempfile.mkdtemp()
try:
    for f in ['index.html', 'cow-calf/index.html', 'replacement-heifer/index.html', 'retained-ownership/index.html',
              'data-sources.html', 'tools/secure_pages.py', 'jim/jim.js', 'my-ranch/index.html', 'herd-tools/index.html',
              'src/my-ranch/build.py', 'src/my-ranch/body.html', 'src/my-ranch/extra.css', 'src/my-ranch/app.js',
              'src/my-ranch/feed.js', 'src/my-ranch/feedui.js']:
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
    data = copy.deepcopy(BASE)
    data['prices']['steer']['value'] = 401.5
    data['prices']['cull_cow']['value'] = 131.0
    files = up.apply(data, repo=tmp)
    check('steer/cull change reaches My Ranch (rebuilt)', 'src/my-ranch/feedui.js' in files and 'my-ranch/index.html' in files)
    cc = open(os.path.join(tmp, 'cow-calf/index.html')).read()
    check('A1 year grid follows the steer price', 'STEER_PRICE_DEFAULT  = [401.50,401.50,401.50,401.50,401.50,401.50,401.50]' in cc)
    check('curve anchors untouched', 'STEER_ANCHOR = {w:516.4, p:530.0}' in cc and 'CULLCOW_ANCHOR = {w:1279.4, p:180.0}' in cc)
    mr = open(os.path.join(tmp, 'my-ranch/index.html')).read()
    check('My Ranch default steer price', 'mp_steerPrice:401.50' in mr and '/530*(mult' in mr)
    ds = open(os.path.join(tmp, 'data-sources.html')).read()
    check('data-sources steer row', '$401.50/cwt' in ds)
finally:
    shutil.rmtree(tmp)

print('\n%d failed' % len(fails) if fails else '\nall passed')
sys.exit(1 if fails else 0)
