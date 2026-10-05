# Source for the built pages

`my-ranch/index.html` and `herd-tools/index.html` are single self-contained files **generated** from the sources in this folder. Edit the sources here, run the build, and commit both.

| Page | Sources | Build |
| --- | --- | --- |
| My Ranch | `src/my-ranch/` | `python3 src/my-ranch/build.py` → writes `my-ranch/index.html` |
| Herd Calculators | `src/herd-tools/` | `python3 src/herd-tools/build.py` → writes `herd-tools/index.html` |

Both builds take the shared page styles from `replacement-heifer/index.html` (the `<style>` block), add the page's own `extra.css`, then `body.html` and the script. The site brand stylesheet `brand/tamu-brand.css` is linked last.

## My Ranch files

| File | What it holds |
| --- | --- |
| `body.html` | Page markup (cards, inputs, tables) |
| `extra.css` | Styles specific to My Ranch |
| `app.js` | Map (Leaflet + Geoman), pastures, soil survey lookup (USDA-NRCS Soil Data Access), drought (U.S. Drought Monitor), capacity, storage, import/export |
| `feed.js` | Nutrition engine, no DOM: NRC 2016 / BCNRM requirements, calves, heifers, weather, pasture supply, monthly balance, economics. Injected into `app.js` at `/*@@FEED@@*/` |
| `feedui.js` | Feed calendar, grazing calendar, "Grass today", decisions (calving season, drought, what-if), one-page plan. Injected at `/*@@FEEDUI@@*/` |
| `valbc.js` + `bcnrm_val.json` | Checks `feed.js` against 12 cow scenarios run in the official BCNRM 2016 spreadsheet (v1.0.37). `node valbc.js` must print `WORST % diff vs BCNRM: 0.000` |

## Tests

Browser tests use Python Playwright with Chromium; the CDN libraries are served from local copies.

```
cd src/my-ranch && npm install          # local copies of Leaflet, Geoman, etc. (test only)
pip install playwright && playwright install chromium
python3 src/my-ranch/test_ranch.py      # map, soil, capacity, feed calendar, decisions, print
python3 src/my-ranch/test_grass.py      # Grass today / where is the herd
python3 src/my-ranch/test_portal.py     # home-page "Your ranch" card and shared stores
python3 src/herd-tools/test_tools.py    # Herd Calculators
cd src/my-ranch && node valbc.js        # nutrition vs. BCNRM
```

External services (soil survey, drought, map tiles, search) are mocked in the tests, so the tests run offline. Screenshots and the print PDF go to `src/*/.out/` (ignored by git).

## Data sources

Every number the pages use is listed with its source on `data-sources.html` and in the My Ranch user manual.
