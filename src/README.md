# Source for the built pages

`my-ranch/index.html` and `herd-tools/index.html` are single self-contained files **generated** from the sources in this folder. Edit the sources here, run the build, and commit both.

| Page | Sources | Build |
| --- | --- | --- |
| My Ranch | `src/my-ranch/` | `python3 src/my-ranch/build.py` → writes `my-ranch/index.html` |
| Herd Calculators | `src/herd-tools/` | `python3 src/herd-tools/build.py` → writes `herd-tools/index.html` |

Both builds end by running `tools/secure_pages.py` (Content-Security-Policy, referrer policy, required links). After hand-editing any other page, run `python3 tools/secure_pages.py` yourself; `python3 tools/test_security.py` checks the whole site. See `SECURITY.md`.

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
cd src/my-ranch && npm install          # test helpers only; the site itself serves Leaflet, Geoman, etc. from vendor/
pip install playwright && playwright install chromium
python3 src/my-ranch/test_ranch.py      # map, soil, capacity, feed calendar, decisions, print
python3 src/my-ranch/test_grass.py      # Grass today / where is the herd
python3 src/my-ranch/test_portal.py     # home-page "Your ranch" card and shared stores
python3 src/my-ranch/test_import.py     # opening a downloaded ranch file (replace or add)
python3 src/my-ranch/test_supplement.py # protein-only supplementation and cow condition (Vanzandt 2023 check)
python3 src/my-ranch/test_steps.py      # the four steps, summary strip, save panel (desktop and phone)
python3 src/my-ranch/test_examples.py   # example ranches (my-ranch/examples), grazing system, Drought Monitor suggestion
python3 src/my-ranch/test_jim_ranch.py   # Jim on other pages reads the ranch saved in My Ranch
python3 src/herd-tools/test_tools.py    # Herd Calculators
python3 tools/test_security.py          # CSP, required links, third-party hosts, Jim ranch switch, privacy delete
cd src/my-ranch && node valbc.js        # nutrition vs. BCNRM
```

Automated browsers see all four steps at once so the other tests can reach every field; `test_steps.py` sets `window.__MR_STEPS` to test real step navigation.

External services (soil survey, drought, map tiles, search) are mocked in the tests, so the tests run offline. Screenshots and the print PDF go to `src/*/.out/` (ignored by git).

## Data sources

Every number the pages use is listed with its source on `data-sources.html` and in the My Ranch user manual.

## Weekly USDA prices

Three prices (bred cow, bred heifer, fed cattle) come from USDA AMS Market News and live in `data/market-prices.json`. The GitHub Action `.github/workflows/update-prices.yml` runs every Monday: `tools/update_prices.py fetch` asks the MyMarketNews API for newer editions of the same reports, and `tools/update_prices.py apply` writes the values into the page defaults and `data-sources.html`, then re-runs `secure_pages.py`. A price only changes when a newer report has a line of the exact same class and it moved less than 25%; anything else opens a GitHub issue. Needs the repository secret `AMS_API_KEY`. Tests: `python3 tools/test_update_prices.py` (offline). The workflow can also be run by hand from the Actions tab ("Run workflow").
