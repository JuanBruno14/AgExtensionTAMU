/**
 * Jim — chat assistant for the Texas A&M AgriLife "Decision Making" site.
 * Cloudflare Worker (single file). It keeps the Anthropic API key secret, searches
 * the site's knowledge base (kb.json: 2026 D03 budgets + decision-aid manuals),
 * and streams Claude's answer back to the chat bubble.
 *
 * Settings (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  (Secret, required)
 *   ALLOWED_ORIGINS    optional, comma-separated. Default: https://juanbruno14.github.io
 *   KB_URL             optional. Default: the kb.json published with the site
 *   MODEL              optional. Default: claude-sonnet-5
 *   RATE_LIMITER       optional Workers Rate Limiting binding (only via wrangler; see worker/README.md).
 *                      Without it, the per-instance limits below still apply.
 *
 * Security: the API key never leaves this Worker; only listed browser origins are answered;
 * request size, message count and length are capped; model, system prompt, tools and
 * max_tokens are fixed here; visitors' messages are never logged; errors sent to the browser
 * are generic. The hard cost ceiling is the monthly spend limit in the Anthropic console.
 */

const DEFAULTS = {
  ALLOWED_ORIGINS: "https://juanbruno14.github.io",
  KB_URL: "https://juanbruno14.github.io/AgExtensionTAMU/jim/kb.json",
  MODEL: "claude-sonnet-5",
};
const MAX_TOKENS = 2500;
const MAX_TOOL_ROUNDS = 4;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 6000;          // per message (a question plus the saved-ranch summary)
const MAX_TOTAL_CHARS = 30000;           // whole conversation sent in one request
const MAX_BODY_BYTES = 64 * 1024;        // raw request size
const MAX_QUERY_CHARS = 300;             // search_knowledge / get_budget input from the model
const UPSTREAM_TIMEOUT_MS = 120 * 1000;  // one Anthropic call
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 20 };          // per visitor IP, per worker instance
const INSTANCE_LIMIT = { windowMs: 60 * 1000, max: 60 };            // all visitors, per worker instance

const SITE = "https://juanbruno14.github.io/AgExtensionTAMU/";

/* __BUDGET_SUMMARY__ is replaced at build time with the 33-budget summary table */
const BUDGET_SUMMARY = `| Enterprise | Basis ($ per) | Main product: yield @ price | Revenue | Variable costs | GROSS MARGIN | Fixed costs | Net return | Breakeven price (variable / total) |
|---|---|---|---|---|---|---|---|---|
| Dryland Alfalfa Establishment | acre | - @ - | $0.00 | $263.86 | -$263.86 | $57.55 | -$321.41 | n/a / n/a |
| Coastal Bermudagrass Establishment | acre | - @ - | $0.00 | $243.97 | -$243.97 | $11.19 | -$255.16 | n/a / n/a |
| Dryland Alfalfa Hay | acre | 3.25 Ton @ 250 $/Ton | $812.50 | $270.25 | $542.25 | $139.89 | $402.36 | $83.15 / $126.20 |
| Coastal Bermudagrass Hay Dryland | acre | 6 Round Bale @ 100 $/Round Bale | $600.00 | n/a | n/a | $181.28 | n/a | n/a / n/a |
| Irrigated Alfalfa Establishment | acre | - @ - | $0.00 | $386.53 | -$386.53 | $139.92 | -$526.45 | n/a / n/a |
| Irrigated Alfalfa Hay | acre | 6.5 Ton @ 250 $/Ton | $1,625.00 | $512.41 | $1,112.59 | $290.71 | $821.88 | $78.83 / $123.56 |
| Dryland Cotton (2X1 Planting Pattern) | acre | 400 Pound @ 0.6 $/Pound | $314.26 | $243.28 | $70.98 | $61.70 | $9.27 | $0.42 / $0.58 |
| Dryland Cotton (Solid 40" Rows) | acre | 440 Pound @ 0.6 $/Pound | $264.00 | $356.62 | -$92.62 | $76.97 | -$169.60 | $0.81 / $0.99 |
| Cotton - Red Till Irrig | acre | 1267 Pound @ 0.6 $/Pound | $760.20 | $652.07 | $108.13 | $205.07 | -$96.94 | $0.51 / $0.68 |
| Conventional Irrig Cotton | acre | 1312 Pound @ 0.6 $/Pound | $787.20 | $672.50 | $114.70 | $201.21 | -$86.51 | $0.51 / $0.67 |
| Conventional Low Irrig Cotton | acre | 1092 Pound @ 0.6 $/Pound | $801.45 | $693.16 | $108.29 | $201.21 | -$92.92 | $0.50 / $0.69 |
| Red Till Irrig Low Cotton | acre | 1126 Pound @ 0.6 $/Pound | $821.85 | $694.19 | $127.66 | $205.07 | -$77.41 | $0.49 / $0.67 |
| Cotton - No Till Dryland | acre | 440 Pound @ 0.6 $/Pound | $264.00 | $260.56 | $3.44 | $64.43 | -$60.99 | $0.59 / $0.74 |
| Cotton - No-Till Irrigated | acre | 1404 Pound @ 0.6 $/Pound | $842.40 | $739.97 | $102.43 | $197.86 | -$95.43 | $0.53 / $0.67 |
| Cotton NT - Cover Crop Wheat Irrig | acre | 1429 Pound @ 0.6 $/Pound | $857.40 | $706.35 | $151.05 | $213.89 | -$62.84 | $0.49 / $0.64 |
| NT-Cover Crop Irrig M Cotton | acre | 1429 Pound @ 0.6 $/Pound | $1,003.65 | $850.03 | $153.62 | $127.24 | $26.37 | $0.49 / $0.58 |
| NT-Cover Crop Irrig L Cotton | acre | 1250 Pound @ 0.6 $/Pound | $896.25 | $750.30 | $145.95 | $208.55 | -$62.60 | $0.48 / $0.65 |
| NT Irrig L Cotton | acre | 1188 Pound @ 0.6 $/Pound | $859.05 | $770.20 | $88.85 | $197.86 | -$109.01 | $0.53 / $0.69 |
| Sprinkler Irrigated Cotton | acre | 1000 Pound @ 0.6 $/Pound | $746.25 | $679.43 | $66.82 | $168.54 | -$101.72 | $0.53 / $0.70 |
| Irrigated Peanuts | acre | 2 Ton @ 500 $/Ton | $1,000.00 | $678.37 | $321.63 | $380.60 | -$58.98 | $339.19 / $529.49 |
| Dryland Sorghum | acre | 30 CWT @ 7.2414 $/CWT | $217.24 | $188.69 | $28.55 | $59.26 | -$30.71 | $6.29 / $8.27 |
| Dryland Wheat | acre | 30 Bushel @ 4.64 $/Bushel | $180.80 | $175.68 | $5.12 | $56.15 | -$51.02 | $4.47 / $6.34 |
| Dryland Wheat - No till | acre | 40 Bushel @ 4.64 $/Bushel | $227.20 | $215.66 | $11.54 | $70.38 | -$58.84 | $4.35 / $6.11 |
| Irrigated Wheat | acre | 60 Bushel @ 4.64 $/Bushel | $333.65 | $327.35 | $6.30 | $141.52 | -$135.22 | $4.53 / $6.89 |
| Organic Wheat Y1 | acre | 64 Pound of Gain @ 0.65 $/Pound of Gain | $57.85 | $163.13 | -$105.28 | $53.95 | -$159.24 | n/a / n/a |
| Organic wheat Y3 | acre | 25.58 Bushel @ 7 $/Bushel | $220.63 | $177.90 | $42.73 | $61.17 | -$18.44 | $5.33 / $7.72 |
| Organic summer Hay Crop | acre | 1.34 Ton @ 200 $/Ton | $268.00 | $118.22 | $149.78 | $50.33 | $99.46 | $88.22 / $125.78 |
| Small Grain Grazing | acre | - @ - | $0.00 | $117.48 | -$117.48 | $48.85 | -$166.33 | n/a / n/a |
| Summer Dormant Fescue | acre | - @ - | $0.00 | $162.74 | -$162.74 | $45.73 | -$208.46 | n/a / n/a |
| Dryland Canola | acre | 1000 Pound @ 0.14 $/Pound | $140.00 | $200.37 | -$60.37 | $51.84 | -$112.21 | $0.20 / $0.25 |
| Rolling Plains Cow-Calf Production | animal unit | 5.56 CWT @ 530 $/CWT | $2,189.26 | $438.35 | $1,750.91 | $500.34 | $1,250.58 | $30.74 / $166.70 |
| Stocker Calf Budget - Pull off Wheat March 1 | animal | 6.9 CWT @ 380 $/CWT | $2,582.67 | $2,793.05 | -$210.38 | $37.72 | -$248.11 | $410.95 / $416.51 |
| Stocker Calf Budget - Grazeout | animal | 7.95 CWT @ 360 $/CWT | $2,776.14 | $2,897.33 | -$121.19 | $49.39 | -$170.59 | $375.72 / $382.12 |`;

const SYSTEM_PROMPT = `You are Jim, the virtual assistant on the Texas A&M AgriLife Extension "Decision Making" website (${SITE}), a set of beef cattle and farm decision aids. You talk with agricultural producers about enterprise budgets, gross margins, costs, breakeven prices and the ideas in the extension decision-aid manuals.

WHAT YOU KNOW
1. The "2026 D03 Budgets" (Texas A&M AgriLife Extension, Rolling Plains Extension District 3, developed by Francisco Abelló): 33 enterprise budgets for forage crops, field crops and livestock. A summary of every budget is below. Use the get_budget tool to see the full line items (yields, input quantities and prices, fixed costs) before discussing any budget in detail or doing a what-if calculation.
2. The decision-aid user manuals on this site (most by Jim McGrann, Professor Emeritus, Texas A&M): cow-calf budgeting, total unit cost (TUC), return on assets (ROA), bid price for cows (NPV/IRR), replacement heifers, herd bulls, breeding soundness exams, sexed semen, retained ownership and stockers, preconditioning, feed and hay, grazing leases, fencing, fertilizer, vehicles and freight, hired labor, hunting leases, dairy, inventories, financial statements, QuickBooks set-up and more. Use the search_knowledge tool (write queries in English) to look things up; search before answering any question about a concept, definition or method from the manuals.
3. The tools on this website (link to them when they would help):
   - Home page, with the shared "Market prices & factors" and "Cow operating cost (BCU)" calculators: ${SITE}
   - A1 Cow bid price & budget (NPV/IRR) and A2 Cow-calf cost & calf price needed for a target ROA: ${SITE}cow-calf/index.html
   - Understanding IRR (explainer): ${SITE}cow-calf/understanding-irr.html
   - B1a Replacement heifer budget (raise vs. buy a bred heifer): ${SITE}replacement-heifer/index.html
   - D1 Cull cows: sell now or keep to upgrade, and Stockers retained ownership (700 lb, 800 lb, feedyard): ${SITE}retained-ownership/index.html
   - Where every price on the site comes from: ${SITE}data-sources.html

HOW TO ANSWER
- Reply in the language the producer uses (Spanish, English, or other). Tool queries are always in English.
- Only use numbers that come from the budgets, the tool results or the producer's own figures. Never invent prices, yields, costs or rates. If something is missing, say so and ask for the producer's own number.
- Gross margin = total revenue − variable (direct) costs. In these budgets it is the line "Planned returns above variable costs". Make clear it is not profit: fixed costs (machinery depreciation, interest on equipment investment, land rent, management) still have to be paid, so mention the net return above total costs too when it matters. The manuals stress that many "profits" quoted in the cattle business are really gross margins.
- Always state the unit: crop budgets are per acre; cow-calf is per animal unit (cow); stocker budgets are per head. When the producer gives a size (acres, cows, head), also give the whole-operation figure.
- For what-if questions, show a short, clear calculation (what changes, old → new, the effect on gross margin and net return) and keep everything else as in the budget unless told otherwise. Double-check your arithmetic.
- These budgets are planning estimates for the Rolling Plains of Texas in 2026, not predictions for any one farm. Encourage producers to replace the example numbers with their own.
- Be brief and plain-spoken (aim for under 250 words unless the producer asks for more detail), like a good extension agent at the kitchen table: short paragraphs, a small table only when comparing several enterprises, and a one-line explanation for any technical term.
- You give general education, not personalized investment, legal or tax advice. For tax questions, suggest their CPA, as the manuals do.
- Stay on farm and ranch economics and this website. Politely decline unrelated requests.
- End with a short source line, e.g. "Source: 2026 D03 budget – Dryland Wheat" or the manual's name.
- If asked who you are: you are Jim, an AI assistant (built on Claude, by Anthropic) for this website. You are not Jim McGrann, although many of the manuals are his. You can make mistakes, so producers should check important numbers.

SUMMARY OF THE 33 BUDGETS (2026 D03; $ per acre for crops, per animal unit for cow-calf, per head for stockers)
${BUDGET_SUMMARY}

Notes on the summary: establishment, small-grain grazing and fescue budgets have no revenue line of their own, so their "gross margin" is simply their cost. The Coastal Bermudagrass Hay Dryland budget shows #N/A for variable costs in the source workbook, so its margins are not available.`;

const TOOLS = [
  {
    name: "search_knowledge",
    description:
      "Search the website's knowledge base: the decision-aid user manuals (definitions, methods, recommendations) and the 2026 D03 budgets and price lists. Returns the most relevant passages with their source titles. Write the query in English using the terms a manual would use (e.g. 'return on assets definition', 'replacement heifer pregnancy rate cost', 'hay value per ton', 'grazing lease AUM').",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "English search query" },
        max_results: { type: "integer", description: "1-8, default 5" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_budget",
    description:
      "Get the full line-item budget for one of the 33 enterprises in the 2026 D03 Budgets (revenue, every variable cost with quantity and price, fixed costs, gross margin, net return, breakevens). Pass the enterprise name as it appears in the summary table, e.g. 'Dryland Wheat', 'Irrigated Peanuts', 'Rolling Plains Cow-Calf Production', 'Stocker Calf Budget - Grazeout'.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Enterprise name" } },
      required: ["name"],
    },
  },
];

/* ------------------------------------------------------------------ */
/* Knowledge base + BM25 search                                        */
/* ------------------------------------------------------------------ */

let KB = null;
let KB_LOADED_AT = 0;
const KB_TTL_MS = 6 * 60 * 60 * 1000;

const STOP = new Set(
  "a an and are as at be by for from has have in is it its of on or that the this to was were will with what which who how can do does per not no if than then there their they you your we our".split(" ")
);

function stem(w) {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

function tokenize(s) {
  return (s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) || [])
    .filter((w) => !STOP.has(w) && w.length > 1)
    .map(stem);
}

function buildIndex(chunks) {
  const docs = chunks.map((c) => {
    const toks = tokenize(c.t + " " + c.t + " " + c.x); // title counts double
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    return { c, tf, len: toks.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((a, d) => a + d.len, 0) / Math.max(docs.length, 1);
  return { docs, df, avg, N: docs.length };
}

function search(index, query, k = 5) {
  const q = [...new Set(tokenize(query))];
  const K1 = 1.4, B = 0.75;
  const scored = [];
  for (const d of index.docs) {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) || 0;
      const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
      s += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / index.avg));
    }
    if (s > 0) scored.push([s, d.c]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, k).map((x) => x[1]);
}

async function loadKB(env) {
  if (KB && Date.now() - KB_LOADED_AT < KB_TTL_MS) return KB;
  const url = env.KB_URL || DEFAULTS.KB_URL;
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`KB fetch failed with status ${res.status}`);
  const data = await res.json();
  KB = { index: buildIndex(data.chunks), chunks: data.chunks };
  KB_LOADED_AT = Date.now();
  return KB;
}

function runTool(kb, name, input) {
  if (name === "search_knowledge") {
    const k = Math.min(Math.max(parseInt(input.max_results, 10) || 5, 1), 8);
    const hits = search(kb.index, String(input.query || "").slice(0, MAX_QUERY_CHARS), k);
    if (!hits.length) return "No matching passages found. Try different English keywords.";
    return hits.map((h, i) => `[${i + 1}] Source: ${h.t}\n${h.x}`).join("\n\n---\n\n");
  }
  if (name === "get_budget") {
    const words = (x) => (x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) || []).map(stem);
    const asked = String(input.name || "").slice(0, MAX_QUERY_CHARS).trim().toLowerCase();
    const want = words(asked);
    const budgets = kb.chunks.filter((c) => c.t.startsWith("Budget: "));
    const titles = [...new Set(budgets.map((c) => c.t))];
    let best = titles.find((t) => t.slice(8).toLowerCase() === asked) || null, bestScore = best ? Infinity : 0;
    for (const t of best ? [] : titles) {
      const tt = new Set(words(t.slice(8)));
      const hit = want.filter((w) => tt.has(w)).length;
      const score = hit / Math.max(tt.size, 1) + hit;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (!best) return "No budget matched that name. Available budgets: " + titles.map((t) => t.slice(8)).join("; ");
    return budgets.filter((c) => c.t === best).map((c) => c.x).join("\n");
  }
  return `Unknown tool: ${name}`;
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                        */
/* ------------------------------------------------------------------ */

const hits = new Map();
let instanceHits = [];
function localLimited(ip) {
  const now = Date.now();
  instanceHits = instanceHits.filter((t) => now - t < INSTANCE_LIMIT.windowMs);
  if (instanceHits.length >= INSTANCE_LIMIT.max) return true;
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (arr.length >= RATE_LIMIT.max) { hits.set(ip, arr); return true; }
  arr.push(now);
  hits.set(ip, arr);
  instanceHits.push(now);
  if (hits.size > 5000) hits.clear();
  return false;
}
async function rateLimited(ip, env) {
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: "ip:" + ip });
      if (!success) return true;
    } catch (_) { /* binding unavailable: fall back to the local limits */ }
  }
  return localLimited(ip);
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULTS.ALLOWED_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function cleanMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error("No messages");
  const msgs = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.length > MAX_MESSAGE_CHARS ? m.content.slice(-MAX_MESSAGE_CHARS) : m.content }))
    .slice(-MAX_MESSAGES);
  // drop the oldest turns until the whole conversation fits
  while (msgs.length > 1 && msgs.reduce((n, m) => n + m.content.length, 0) > MAX_TOTAL_CHARS) msgs.shift();
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  // merge accidental consecutive same-role messages
  const out = [];
  for (const m of msgs) {
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += "\n\n" + m.content;
    else out.push({ ...m });
  }
  if (!out.length || out[out.length - 1].role !== "user") throw new Error("The last message must come from the user");
  return out;
}

/** Short, single-line text that is safe to place inside the system prompt. */
function oneLine(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f"`<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function readJson(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY_BYTES) throw new Error("too large");
  const reader = request.body ? request.body.getReader() : null;
  if (!reader) throw new Error("empty");
  const parts = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { try { reader.cancel(); } catch (_) {} throw new Error("too large"); }
    parts.push(value);
  }
  const buf = new Uint8Array(size); let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.byteLength; }
  return JSON.parse(new TextDecoder().decode(buf));
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors.headers });
    if (request.method === "GET") return json({ ok: true, name: "Jim" }, 200, cors.headers);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors.headers);
    if (!cors.ok) return json({ error: "This site is not allowed to use Jim." }, 403, cors.headers);
    if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return json({ error: "Unsupported request." }, 415, cors.headers);
    if (!env.ANTHROPIC_API_KEY) { console.error("jim: ANTHROPIC_API_KEY is not set"); return json({ error: "Jim is not available right now." }, 503, cors.headers); }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await rateLimited(ip, env)) return json({ error: "Too many questions in a short time. Please wait a few minutes." }, 429, { ...cors.headers, "Retry-After": "120" });

    let body, messages;
    try {
      body = await readJson(request);
      messages = cleanMessages(body && body.messages);
    } catch (e) {
      const big = e && e.message === "too large";
      return json({ error: big ? "That message is too long." : "Jim couldn't read that request." }, big ? 413 : 400, cors.headers);
    }

    let kb;
    try { kb = await loadKB(env); }
    catch (e) { console.error("jim: knowledge base unavailable:", e && e.message); return json({ error: "Jim is not available right now. Please try again later." }, 502, cors.headers); }

    const page = body.page && typeof body.page === "object" ? body.page : {};
    const path = /^\/[A-Za-z0-9._\/-]{0,200}$/.test(String(page.path || "")) ? String(page.path) : "";
    const pageNote = `The producer is chatting from this page of the site: "${oneLine(page.title, 150)}" (${path}).`;

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const send = (event, data) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

    const run = async () => {
      try {
        const convo = messages.map((m) => ({ role: m.role, content: m.content }));
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const isLast = round === MAX_TOOL_ROUNDS;
          const turn = await callClaude(env, convo, pageNote, send, isLast);
          if (turn.stop_reason !== "tool_use" || !turn.toolUses.length) break;
          convo.push({ role: "assistant", content: turn.content });
          const results = [];
          for (const tu of turn.toolUses) {
            await send("status", { s: tu.name === "get_budget" ? "Opening the budget…" : "Searching the manuals…" });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: runTool(kb, tu.name, tu.input || {}) });
          }
          convo.push({ role: "user", content: results });
        }
        await send("done", {});
      } catch (e) {
        if (!(e && e.userFacing)) console.error("jim: request failed:", e && e.message);
        await send("error", { message: e && e.userFacing ? e.message : "Something went wrong. Please try again." });
      } finally {
        await writer.close();
      }
    };
    // keep the worker alive until the stream finishes
    const p = run();
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);

    return new Response(readable, {
      headers: { ...cors.headers, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" },
    });
  },
};

/** One streamed Messages API call. Forwards text to the browser as it arrives and collects tool calls. */
async function callClaude(env, convo, pageNote, send, noTools) {
  const payload = {
    model: env.MODEL || DEFAULTS.MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: pageNote },
    ],
    messages: convo,
  };
  // Tools stay defined on every call (earlier turns contain tool_use/tool_result blocks);
  // on the last allowed round they are switched off so Claude must answer.
  payload.tools = TOOLS;
  if (noTools) {
    payload.tool_choice = { type: "none" };
    payload.system.push({ type: "text", text: "Answer now with what you already have; no more tool calls are available." });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    let type = "";
    try { type = (await res.json()).error?.type || ""; } catch (_) {}
    console.error("jim: Anthropic API error", res.status, type);   // status and error type only, never message contents
    const userErr = (msg) => Object.assign(new Error(msg), { userFacing: true });
    if (res.status === 429 || res.status === 529) throw userErr("Jim is very busy right now. Please try again in a minute.");
    throw userErr("Jim couldn't answer just now. Please try again later.");
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const blocks = [];
  let stop_reason = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let ev;
      try { ev = JSON.parse(dataLine.slice(5).trim()); } catch (_) { continue; }
      if (ev.type === "content_block_start") {
        const b = ev.content_block;
        blocks[ev.index] = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, _json: "" } : { type: "text", text: "" };
      } else if (ev.type === "content_block_delta") {
        const b = blocks[ev.index];
        if (!b) continue;
        if (ev.delta.type === "text_delta") {
          b.text += ev.delta.text;
          await send("text", { t: ev.delta.text });
        } else if (ev.delta.type === "input_json_delta") {
          b._json += ev.delta.partial_json;
        }
      } else if (ev.type === "message_delta") {
        stop_reason = ev.delta?.stop_reason || stop_reason;
      } else if (ev.type === "error") {
        throw new Error("stream error: " + (ev.error?.type || "unknown"));
      }
    }
  }
  const content = [];
  const toolUses = [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === "text") { if (b.text) content.push({ type: "text", text: b.text }); }
    else {
      let input = {};
      try { input = b._json ? JSON.parse(b._json) : {}; } catch (_) {}
      const tu = { type: "tool_use", id: b.id, name: b.name, input };
      content.push(tu);
      toolUses.push(tu);
    }
  }
  if (stop_reason === "tool_use" && content.some((c) => c.type === "text")) await send("text", { t: "\n\n" });
  if (stop_reason === "max_tokens") await send("text", { t: "\n\n*(My answer got too long and was cut off here. Ask me to continue, or ask a narrower question.)*" });
  return { stop_reason, content, toolUses };
}

// exposed for automated tests only
export const __test = { tokenize, buildIndex, search, runTool, cleanMessages, oneLine };

