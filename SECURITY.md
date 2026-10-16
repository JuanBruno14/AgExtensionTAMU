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

## Jim relay (Cloudflare Worker)

Source and deploy steps: `worker/jim-worker.js`, `worker/README.md`; tests: `node worker/test_worker.mjs`.

In the code: only listed origins answered (403 otherwise); JSON only (415); body capped at 64 KB (413);
at most 16 messages, 6,000 characters each (the end, with the question, is kept) and 30,000 in total;
only `user` / `assistant` roles; model, system prompt, tools, tool rounds and `max_tokens` fixed in the
Worker; page title and path sanitized before reaching the prompt; per-IP limit (20 questions / 10 min)
and per-instance limit (60 / min), plus an account-wide Rate Limiting binding when deployed with
wrangler; 120-second upstream timeout; visitors see generic errors only; logs hold status codes and
error types, never message text or the key; responses are `no-store` and `nosniff`.

Still to do outside the code:

- [ ] Paste the current `worker/jim-worker.js` into Cloudflare and deploy.
- [ ] Anthropic: a key used only by this site, with a monthly spend limit.
- [ ] Move the Worker and key to institutional accounts; set `ALLOWED_ORIGINS` to the production
      domain; update `JIM_ENDPOINT` in `jim/jim.js`, then run `python3 tools/secure_pages.py`.
- [ ] Optional: deploy with wrangler to add the account-wide Rate Limiting binding.
- [ ] Optional, if abuse appears: Cloudflare Turnstile (invisible bot check) in front of Jim.

## Needs the hosting platform (cannot be set from GitHub Pages)

HTTP response headers: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `frame-ancestors` (clickjacking; not allowed in a `<meta>` CSP), `Permissions-Policy`. GitHub Pages already serves the site only over HTTPS.

## Reporting a problem

Contact the Department of Agricultural Economics, Texas A&M AgriLife Extension.
