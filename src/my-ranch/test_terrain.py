import os
HERE=os.path.dirname(os.path.realpath(__file__)); OUT=os.path.join(HERE,'.out'); os.makedirs(OUT, exist_ok=True)
__file__=os.path.join(HERE,'test_ranch.py')
exec(open(__file__).read().split('with sync_playwright() as pw:')[0].replace('PORT=8765','PORT=8784'))
# Pasture slope from USGS 3DEP elevation: a mocked elevation service returns an uncompressed tiled float32 GeoTIFF
# (the same layout the real service returns) whose west half rises 20% eastward and whose east half is flat.
import math, struct, urllib.parse as up
R=6378137.0
def tiff_f32(w, h, z, tile=128, le=True):
    e='<' if le else '>'
    across=(w+tile-1)//tile; down=(h+tile-1)//tile
    tiles=[]
    for ty in range(down):
        for tx in range(across):
            vals=[]
            for r in range(tile):
                for c in range(tile):
                    y,x=ty*tile+r, tx*tile+c
                    vals.append(z[y*w+x] if (y<h and x<w) else -9999.0)
            tiles.append(struct.pack(e+'%df'%len(vals), *vals))
    entries=[(256,3,1,w),(257,3,1,h),(258,3,1,32),(259,3,1,1),(262,3,1,1),(277,3,1,1),(284,3,1,1),(322,3,1,tile),(323,3,1,tile),(324,4,len(tiles),None),(325,4,len(tiles),None),(339,3,1,3)]
    ifd_off=8; ifd_len=2+12*len(entries)+4; arr_off=ifd_off+ifd_len; data_off=arr_off+8*len(tiles)
    offs=[]; o=data_off
    for t in tiles: offs.append(o); o+=len(t)
    out=bytearray(b'II' if le else b'MM'); out+=struct.pack(e+'HI',42,ifd_off); out+=struct.pack(e+'H',len(entries))
    for tag,typ,cnt,val in entries:
        if tag==324: out+=struct.pack(e+'HHII',tag,typ,cnt,arr_off if cnt>1 else offs[0])
        elif tag==325: out+=struct.pack(e+'HHII',tag,typ,cnt,arr_off+4*len(tiles) if cnt>1 else len(tiles[0]))
        else: out+=struct.pack(e+'HHIHH',tag,typ,cnt,val,0)
    out+=struct.pack(e+'I',0)
    out+=struct.pack(e+'%dI'%len(offs),*offs)+struct.pack(e+'%dI'%len(tiles),*[len(t) for t in tiles])
    for t in tiles: out+=t
    return bytes(out)
elev_requests=[]
def elevation(r):
    u=r.request.url; elev_requests.append(u)
    if len(elev_requests)==1: return r.abort()       # the real service drops some requests: the page tries again
    q=up.parse_qs(up.urlparse(u).query)
    x0,y0,x1,y1=map(float,q['bbox'][0].split(',')); w,h=map(int,q['size'][0].split(','))
    lat=(2*math.atan(math.exp((y0+y1)/2/R))-math.pi/2)
    g=(x1-x0)/w*math.cos(lat)          # ground meters per cell
    half=w//2
    z=[(min(c,half)*g*0.20)+100 for rr in range(h) for c in range(w)]
    return r.fulfill(status=200, body=tiff_f32(w,h,z), headers={'content-type':'image/tiff','access-control-allow-origin':'*'})
def route2(r):
    if 'elevation.nationalmap.gov' in r.request.url: return elevation(r)
    return route(r)
SOIL_SLOPE={"Table":[["mukey","area_m2","muname","cokey","compname","compkind","comppct_r","slope_r","rsprod_l","rsprod_r","rsprod_h"],
 ["111","1000000","Steep stony loam","1","Stony","Series","100","45","1000","2000","2600"]]}
def wait_js(pg, expr, timeout=20000):
    t0=time.time()
    while time.time()-t0 < timeout/1000:
        if pg.evaluate(expr): return True
        pg.wait_for_timeout(150)
    return False
POLY="{type:'Polygon',coordinates:[[[-100.458,35.515],[-100.42183,35.515],[-100.42183,35.54446],[-100.458,35.54446],[-100.458,35.515]]]}"
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    c=b.new_context(viewport={'width':1360,'height':1200}); c.route('**/*', route2)
    pg=c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{PORT}/my-ranch/index.html'); pg.wait_for_timeout(700)

    # parser: strips and big-endian too
    ok=pg.evaluate("""(()=>{ const W=5,H=3; const b=new ArrayBuffer(8+2+12*9+4+4*W*H); const d=new DataView(b); let o=0;
      d.setUint16(0,0x4D4D); d.setUint16(2,42); d.setUint32(4,8); d.setUint16(8,9); const tags=[[256,3,W],[257,3,H],[258,3,32],[259,3,1],[273,4,8+2+12*9+4],[277,3,1],[278,3,H],[279,4,4*W*H],[339,3,3]];
      tags.forEach((t,i)=>{const p=10+12*i; d.setUint16(p,t[0]); d.setUint16(p+2,t[1]); d.setUint32(p+4,1); if(t[1]===3) d.setUint16(p+8,t[2]); else d.setUint32(p+8,t[2]);});
      const s=8+2+12*9+4; for(let i=0;i<W*H;i++) d.setFloat32(s+4*i,i+0.5);
      const g=MyRanch.parseTiffF32(b); return g.w===W && g.h===H && g.data[0]===0.5 && g.data[14]===14.5; })()""")
    check('TIFF reader: big-endian strips', ok)

    # request sizing
    rq=pg.evaluate("MyRanch.terrainRequest(%s)" % POLY)
    check('request ~10 m ground cells', 9.5 < rq['groundCell'] < 10.5, rq['groundCell'])
    check('request is an uncompressed float32 tiff', 'format=tiff' in rq['url'] and 'pixelType=F32' in rq['url'] and 'compression=None' in rq['url'])
    big=pg.evaluate("MyRanch.terrainRequest({type:'Polygon',coordinates:[[[-101,35],[-100.6,35],[-100.6,35.3],[-101,35.3],[-101,35]]]})")
    check('large pasture coarsened to stay under 1,200 px', big['w']<=1200 and big['h']<=1200 and big['groundCell']>10, (big['w'],big['h'],round(big['groundCell'],1)))

    # pasture on native range: slope read from elevation
    pg.evaluate("MyRanch.addPasture(%s,{name:'Hill',type:'range',mode:'soil'})" % POLY)
    wait_js(pg, "(()=>{const p=MyRanch.state().pastures[0]; return p.terrain && p.terrain.status!=='loading'})()")
    p=pg.evaluate("MyRanch.state().pastures[0]")
    t=p['terrain']
    check('dropped request retried once', len(elev_requests)==2, len(elev_requests))
    check('terrain read ok', t['status']=='ok', t)
    check('about half the pasture in 11-30% slope', abs(t['shares'][1]-0.5)<0.03 and t['shares'][2]==0 and t['shares'][3]==0, [round(x,3) for x in t['shares']])
    sf=pg.evaluate("MyRanch.slopeFactor(MyRanch.state().pastures[0].id)")
    check('slope factor = Holechek on terrain (~0.85)', abs(sf-(t['shares'][0]+0.7*t['shares'][1]))<1e-9 and 0.83<sf<0.87, sf)
    txt=pg.inner_text('.pasture-row')
    check('pasture shows terrain slope line', 'USGS 3DEP elevation' in txt and '11–30%' in txt, txt[:400])
    check('zone line explains the slope cut', 'steeper than 10% (USGS elevation)' in txt)

    # reload keeps the reading, no new request
    pg.reload(); pg.wait_for_timeout(1500)
    check('saved terrain reused after reload', len(elev_requests)==2 and pg.evaluate("MyRanch.state().pastures[0].terrain.status")=='ok', len(elev_requests))

    # editing the outline invalidates it
    pg.evaluate("(()=>{const s=MyRanch.state(); s.pastures[0].geometry.coordinates[0][1][0]=-100.43; })()")
    check('stale terrain ignored when outline changed', abs(pg.evaluate("MyRanch.slopeFactor(MyRanch.state().pastures[0].id)")-1)<1e-9)
    c.close()

    # service down: falls back to the soil-survey slope
    import json as _j
    def route3(r):
        u=r.request.url
        if 'elevation.nationalmap.gov' in u: elev_requests.append(u); return r.abort()
        if 'sdmdataaccess' in u.lower(): return r.fulfill(status=200, body=_j.dumps(SOIL_SLOPE), headers={'content-type':'application/json','access-control-allow-origin':'*'})
        return route(r)
    c=b.new_context(viewport={'width':1360,'height':1200}); c.route('**/*', route3)
    pg=c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{PORT}/my-ranch/index.html'); pg.wait_for_timeout(700)
    pg.evaluate("MyRanch.addPasture(%s,{name:'Hill',type:'range',mode:'soil'})" % POLY)
    wait_js(pg, "(()=>{const p=MyRanch.state().pastures[0]; return p.terrain && p.terrain.status==='error' && p.soil && p.soil.status==='ok'})()")
    sf=pg.evaluate("MyRanch.slopeFactor(MyRanch.state().pastures[0].id)")
    check('falls back to soil-survey slope (45% -> 0.4)', abs(sf-0.4)<1e-9, sf)
    check('gives up after 3 tries', len(elev_requests)==5, len(elev_requests))
    check('fallback is labelled', 'soil-survey slope' in pg.inner_text('.pasture-row'))
    pg.select_option('#slopeAdj','off'); pg.wait_for_timeout(200)
    check('slope adjustment can be turned off', abs(pg.evaluate("MyRanch.slopeFactor(MyRanch.state().pastures[0].id)")-1)<1e-9)
    pg.screenshot(path=os.path.join(OUT,'terrain.png'), full_page=False)
    c.close()
    check('no JS errors', not errs, errs)
print('failed checks:', fails)
