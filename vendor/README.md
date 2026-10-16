# Third-party libraries served by the site

All are used only by the My Ranch page and are served from this folder (no CDN). Versions are
pinned in the folder name. Last vulnerability check: 2026-10-16, `npm audit` — 0 known
vulnerabilities.

| Library | Version | License | Used for |
| --- | --- | --- | --- |
| [Leaflet](https://leafletjs.com/) | 1.9.4 | BSD-2-Clause | Map |
| [Leaflet-Geoman (free)](https://github.com/geoman-io/leaflet-geoman) | 2.20.2 | MIT | Drawing and editing pastures (2.17.0 replaced: it bundled a vulnerable lodash) |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | 0.15.7 | MIT | Pasture overlap and area math |
| [@tmcw/togeojson](https://github.com/placemark/togeojson) | 5.8.1 | BSD-2-Clause | Importing KML/KMZ files (loaded only when a file is imported) |
| [shpjs](https://github.com/calvinmetcalf/shapefile-js) | 4.0.4 | MIT | Importing zipped shapefiles (loaded only when a file is imported) |
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | MIT | Unzipping KMZ files (loaded only when a file is imported) |

Fonts (`brand/fonts/`): Open Sans, Oswald, Work Sans, Public Sans, Fraunces — SIL Open Font License 1.1, from Fontsource.

## Checking for vulnerabilities (every few months, or when an advisory appears)

```
mkdir /tmp/vendor-audit && cd /tmp/vendor-audit
echo '{"private":true,"dependencies":{"leaflet":"1.9.4","@geoman-io/leaflet-geoman-free":"2.20.2","polygon-clipping":"0.15.7","@tmcw/togeojson":"5.8.1","shpjs":"4.0.4","jszip":"3.10.1"}}' > package.json
npm install --package-lock-only && npm audit
```

## Updating a library

1. `npm install <package>@<version>` in a scratch folder; copy the same `dist/` files into a new
   `vendor/<name>-<version>/` folder with its LICENSE; delete the old folder.
2. Change the path in `src/my-ranch/build.py` (map libraries) or `src/my-ranch/app.js` (`LIBS`, file importers).
3. `python3 src/my-ranch/build.py`, then run the My Ranch tests and `python3 tools/test_security.py`.
