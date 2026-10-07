"""Seasonal calf price index for My Ranch (feed.js SEASON_CALF).

Usage: python3 -I seasonal_index.py LivestockPrices.xlsx
Input: USDA ERS "Livestock prices" workbook (Livestock and Meat Domestic Data), sheet "Historical".
Method: each month's price / centered 2x12 moving average, averaged by calendar month over the years, rescaled to
average 100. SEASON_CALF = mean of steers 500-550, steers 600-650 and heifers 450-500 lb (Oklahoma City), 2016-2025.
"""
import openpyxl, statistics as st, sys
wb=openpyxl.load_workbook(sys.argv[1],data_only=True,read_only=True)
rows=[r for r in wb['Historical'].iter_rows(values_only=True)][4:]
data=[(r[0],r[3],r[4],r[6]) for r in rows if r[0] is not None and hasattr(r[0],'year')]
print('range',data[0][0],data[-1][0],len(data))
def series(k): return [(d[0],d[k]) for d in data if isinstance(d[k],(int,float))]
def index(ser,y0,y1):
    vals=[v for _,v in ser]; dates=[d for d,_ in ser]
    ratios={m:[] for m in range(12)}
    for i in range(6,len(vals)-6):
        if not (y0<=dates[i].year<=y1): continue
        ma=(0.5*vals[i-6]+sum(vals[i-5:i+6])+0.5*vals[i+6])/12
        ratios[dates[i].month-1].append(vals[i]/ma)
    idx=[st.mean(ratios[m])*100 for m in range(12)]
    s=sum(idx)/12; idx=[x*100/s for x in idx]
    sd=[st.pstdev(ratios[m])*100 for m in range(12)]
    return idx,[len(ratios[m]) for m in range(12)],sd
M='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
old=[100.54,102.79,104.35,104.82,103.23,102.03,101.59,99.49,96.09,94.93,94.14,96.01]
res={}
for name,k in [('st500',1),('st600',2),('hf450',3)]:
    for y0,y1 in [(2016,2025),(2006,2025)]:
        i,n,sd=index(series(k),y0,y1); res[(name,y0)]=i
        print(name,y0,y1,' '.join('%s %.1f'%(M[m],i[m]) for m in range(12)), 'n',min(n))
for y0 in (2016,2006):
    c=[(res[('st500',y0)][m]+res[('st600',y0)][m]+res[('hf450',y0)][m])/3 for m in range(12)]
    print('COMBINED',y0,[round(x,2) for x in c])
print('OLD',old)
i,n,sd=index(series(1),2016,2025); print('sd st500',[round(x,1) for x in sd])
