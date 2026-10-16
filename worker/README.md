# Jim relay (Cloudflare Worker)

`jim-worker.js` is the whole Worker. It keeps the Anthropic API key, searches `jim/kb.json`
and streams answers to the chat bubble (`jim/jim.js`). This file is the source of truth: the
copy in Cloudflare should always match it. It contains no secrets.

## Deploy from the Cloudflare dashboard

1. Cloudflare → Workers & Pages → **jim** → **Edit code**.
2. Select everything in the editor, delete it, paste the full contents of `jim-worker.js`.
3. **Deploy**.
4. Settings → Variables and Secrets: `ANTHROPIC_API_KEY` (Secret) must exist. `ALLOWED_ORIGINS`
   is optional; if set it must be exactly `https://juanbruno14.github.io` (no trailing slash),
   or the production domain once the site moves.
5. Check: open a page of the site and ask Jim a question.

## Security settings outside the code

- **Anthropic console:** a key used only by this site, and a monthly spend limit. This is the hard
  cost ceiling, whatever happens to the Worker.
- **Logs:** the Worker logs only status codes and error types, never message text. If Workers Logs
  are on, that is all they contain.
- **Per-IP limit across all Cloudflare locations (optional):** the code already limits each visitor
  to 20 questions per 10 minutes and each Worker instance to 60 per minute. A stronger,
  account-wide limit needs a Rate Limiting binding, which can only be added with wrangler
  (not in the dashboard):

  ```toml
  # wrangler.toml
  name = "jim"
  main = "jim-worker.js"
  compatibility_date = "2026-10-01"

  [[ratelimits]]
  name = "RATE_LIMITER"
  namespace_id = "1001"
    [ratelimits.simple]
    limit = 6
    period = 60
  ```

  The code uses `env.RATE_LIMITER` automatically when it exists.

## Tests

```
node worker/test_worker.mjs
```

Anthropic and the knowledge base are mocked: streaming, the tool loop, CORS, content type, size
caps, message trimming, prompt-safe page note, generic errors, no secrets in logs, rate limits.

## After the D03 workbook changes

The 33-budget summary table is inside `jim-worker.js` (`BUDGET_SUMMARY`). Update it there,
re-deploy, and replace `jim/kb.json` in the site.
