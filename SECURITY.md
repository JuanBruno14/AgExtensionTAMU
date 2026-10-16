# Security and privacy notes

Last reviewed: 2026-10-15. Contact: Department of Agricultural Economics, Texas A&M AgriLife Extension.

## What the site is

A static website (HTML, CSS, JavaScript). No accounts, no sign-in, no database, no cookies, no analytics or advertising scripts. Everything a visitor types is kept in their own browser (`localStorage` / `sessionStorage`, keys starting with `tamu`). The only server component is the small relay ("Worker") that lets the Jim assistant reach the Anthropic API without exposing the API key.

## Controls in place (in this repository)

| Control | Where |
| --- | --- |
| Content-Security-Policy on every page: scripts only from this site plus the page's own inline scripts by SHA-256 hash; network calls only to the Jim relay, USDA-NRCS Soil Data Access, the Drought Monitor layer and OpenStreetMap search; `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` | `tools/secure_pages.py` |
| `Referrer-Policy: strict-origin-when-cross-origin` on every page | `tools/secure_pages.py` |
| No third-party scripts or fonts: map libraries (Leaflet, Geoman, polygon-clipping, togeojson, shpjs, JSZip) and fonts are served from this site, pinned to exact versions, with their licenses | `vendor/`, `brand/fonts/` |
| No secrets in the code: the Anthropic API key exists only as an encrypted secret in the Worker | `jim/jim.js` holds only the public relay address |
| Jim's answers are HTML-escaped before display; links allowed only as `http(s)` with `rel="noopener"` | `jim/jim.js` (`esc`, `inline`, `md`) |
| Questions capped at 2,000 characters; only the last 16 messages are sent | `jim/jim.js` |
| Visitor notice in the chat (AI, may be wrong, data goes to Anthropic, do not type personal information) and link to the privacy page | `jim/jim.js` |
| Visitor control over the saved ranch: "Use my saved ranch in Jim's answers" switch; when off, nothing about the ranch is sent | `jim/jim.js` |
| Jim is never loaded on the My Ranch page | `jim/jim.js` |
| Privacy & data page: what is stored, what is sent and to whom, and a button that deletes everything the site saved in the browser | `privacy.html` |
| State of Texas / AgriLife required links and the Extension equal-opportunity statement on every page | `tools/secure_pages.py` |
| Links that open a new tab carry `rel="noopener noreferrer"` | `tools/secure_pages.py` |
| Automated check of all of the above (no CSP violations on any page, including file import on My Ranch; no contact with unlisted hosts; Jim switch honoured; delete button works) | `tools/test_security.py` |

After editing any page: run the page's build (if it has one) and `python3 tools/secure_pages.py`; then `python3 tools/test_security.py`.

## Jim relay (Cloudflare Worker) — checklist

The Worker code is not in this repository. Before launch on an AgriLife domain, confirm:

- [ ] Worker and API key moved to an institutional Cloudflare and Anthropic account (not a personal one); `JIM_ENDPOINT` in `jim/jim.js` updated, then `python3 tools/secure_pages.py` re-run.
- [ ] `ALLOWED_ORIGINS` set to the production domain only.
- [ ] Rate limit enforced outside the Worker's memory (Workers Rate Limiting binding, or a WAF rate-limiting rule on a custom domain), per IP.
- [ ] Requests rejected above a size limit (body, number of messages, characters per message); roles limited to `user` / `assistant`.
- [ ] Model, system prompt and `max_tokens` fixed on the server; nothing from the request can change them.
- [ ] Message contents not written to logs (no `console.log` of bodies; Workers Logs off or sampled without bodies).
- [ ] Monthly spend limit set in the Anthropic console, on an API key used only by this site.
- [ ] Worker returns no stack traces or upstream error details to the browser.

## Needs the hosting platform (cannot be set from GitHub Pages)

HTTP response headers: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `frame-ancestors` (clickjacking; not allowed in a `<meta>` CSP), `Permissions-Policy`. GitHub Pages already serves the site only over HTTPS.

## Reporting a problem

Contact the Department of Agricultural Economics, Texas A&M AgriLife Extension.
