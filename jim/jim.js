/*!
 * Jim — chat bubble for the Texas A&M AgriLife "Decision Making" site.
 * Add to any page with:  <script src="jim/jim.js" defer></script>   (use ../jim/jim.js from sub-folders)
 * Talks to the "Jim" Cloudflare Worker, which holds the API key and the knowledge base.
 */
(function () {
  "use strict";

  /* ▼▼ The ONLY line to edit after creating the Cloudflare Worker: paste its address here ▼▼ */
  var JIM_ENDPOINT = "https://YOUR-WORKER-NAME.YOUR-ACCOUNT.workers.dev";
  /* ▲▲ ------------------------------------------------------------------------------ ▲▲ */

  if (window.__jimLoaded) return;
  window.__jimLoaded = true;

  var scriptTag = document.currentScript;
  var endpoint = (scriptTag && scriptTag.getAttribute("data-endpoint")) || JIM_ENDPOINT;
  var configured = /^https:\/\//.test(endpoint) && endpoint.indexOf("YOUR-") === -1 ||
                   /^http:\/\/(localhost|127\.0\.0\.1)/.test(endpoint);
  var STORE_KEY = "tamuJimChat.v1";
  var MAX_HISTORY = 16;

  var SUGGESTIONS = [
    "Which crop has the best gross margin per acre?",
    "What's the gross margin for dryland wheat?",
    "What if cotton drops to 55¢ a pound?",
    "Why is gross margin not the same as profit?"
  ];

  /* ------------------------------------------------------------------ styles */
  var css = [
    ".jim-root{--jim-accent:var(--maroon-800,#500000);--jim-accent-dark:var(--maroon-900,#3a0000);--jim-soft:var(--maroon-100,#f7e9e6);",
    "--jim-surface:var(--surface,#fff);--jim-sunken:var(--surface-sunken,#f0ece4);--jim-border:var(--border,#e2dbcf);",
    "--jim-ink:var(--ink,#241c19);--jim-ink2:var(--ink-secondary,#5a4f48);--jim-muted:var(--ink-muted,#8a7d73);--jim-focus:var(--focus,#2f6fb3);",
    "--jim-wheat:var(--wheat-500,#b8862f);font-family:'Public Sans',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:var(--jim-ink)}",
    ".jim-root *{box-sizing:border-box}",
    ".jim-launch{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:10px;border:0;cursor:pointer;",
    "background:var(--jim-accent);color:#fff;border-radius:999px;padding:10px 18px 10px 10px;font:600 15px/1 'Public Sans',system-ui,sans-serif;",
    "box-shadow:0 6px 20px rgba(58,0,0,.28),0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease,box-shadow .15s ease}",
    ".jim-launch:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(58,0,0,.32),0 1px 3px rgba(0,0,0,.2)}",
    ".jim-launch:focus-visible,.jim-root button:focus-visible,.jim-root textarea:focus-visible{outline:3px solid var(--jim-focus);outline-offset:2px}",
    ".jim-launch[hidden]{display:none}",
    ".jim-avatar{flex:none;width:36px;height:36px;border-radius:50%;background:#fff;display:grid;place-items:center}",
    ".jim-avatar svg{width:26px;height:26px}",
    ".jim-avatar.sm{width:28px;height:28px;background:var(--jim-soft)}.jim-avatar.sm svg{width:20px;height:20px}",
    ".jim-panel{position:fixed;right:20px;bottom:20px;z-index:2147483001;width:400px;height:min(640px,calc(100vh - 40px));display:flex;flex-direction:column;",
    "background:var(--jim-surface);border:1px solid var(--jim-border);border-radius:16px;overflow:hidden;",
    "box-shadow:0 18px 50px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.12);transform-origin:bottom right;animation:jimIn .18s ease-out}",
    ".jim-panel[hidden]{display:none}",
    "@keyframes jimIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}",
    "@media (prefers-reduced-motion:reduce){.jim-panel,.jim-launch{animation:none;transition:none}}",
    ".jim-head{display:flex;align-items:center;gap:12px;padding:12px 12px 12px 16px;background:var(--jim-accent);color:#fff}",
    ".jim-head .t{flex:1;min-width:0}",
    ".jim-head .n{font:600 18px/1.15 'Fraunces',Georgia,serif}",
    ".jim-head .s{font-size:12.5px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".jim-iconbtn{flex:none;width:34px;height:34px;border-radius:8px;border:0;background:transparent;color:#fff;cursor:pointer;display:grid;place-items:center}",
    ".jim-iconbtn:hover{background:rgba(255,255,255,.14)}",
    ".jim-iconbtn svg{width:18px;height:18px}",
    ".jim-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;background:var(--jim-surface);overscroll-behavior:contain}",
    ".jim-row{display:flex;gap:8px;align-items:flex-start}",
    ".jim-row.user{justify-content:flex-end}",
    ".jim-bubble{max-width:86%;padding:10px 13px;border-radius:14px;overflow-wrap:anywhere}",
    ".jim-row.bot .jim-bubble{background:var(--jim-sunken);border-top-left-radius:4px}",
    ".jim-row.user .jim-bubble{background:var(--jim-accent);color:#fff;border-top-right-radius:4px;white-space:pre-wrap}",
    ".jim-bubble p{margin:0 0 8px}.jim-bubble p:last-child{margin-bottom:0}",
    ".jim-bubble ul,.jim-bubble ol{margin:4px 0 8px;padding-left:20px}.jim-bubble li{margin:2px 0}",
    ".jim-bubble strong{font-weight:700}",
    ".jim-bubble code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;background:var(--jim-surface);padding:1px 4px;border-radius:4px}",
    ".jim-bubble a{color:var(--accent,var(--jim-accent));font-weight:600}",
    ".jim-bubble h4{font:600 15px/1.3 'Public Sans',system-ui,sans-serif;margin:8px 0 4px}",
    ".jim-tablewrap{overflow-x:auto;margin:6px 0 8px}",
    ".jim-bubble table{border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;min-width:100%}",
    ".jim-bubble th,.jim-bubble td{border-bottom:1px solid var(--jim-border);padding:5px 8px;text-align:left;white-space:nowrap}",
    ".jim-bubble th{font-weight:700;background:var(--jim-surface)}",
    ".jim-bubble .src{display:block;margin-top:8px;font-size:12.5px;color:var(--jim-muted)}",
    ".jim-status{display:flex;align-items:center;gap:8px;color:var(--jim-muted);font-size:13.5px}",
    ".jim-dots{display:inline-flex;gap:3px}.jim-dots i{width:6px;height:6px;border-radius:50%;background:var(--jim-muted);animation:jimDot 1.2s infinite ease-in-out}",
    ".jim-dots i:nth-child(2){animation-delay:.15s}.jim-dots i:nth-child(3){animation-delay:.3s}",
    "@keyframes jimDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}",
    ".jim-err{color:var(--critical-700,#9a3412)}",
    ".jim-retry{margin-top:6px;border:1px solid var(--jim-border);background:var(--jim-surface);color:var(--jim-ink);border-radius:8px;padding:5px 10px;font:600 13px 'Public Sans',system-ui,sans-serif;cursor:pointer}",
    ".jim-chips{display:flex;flex-wrap:wrap;gap:8px;padding-left:36px}",
    ".jim-chip{border:1px solid var(--jim-border);background:var(--jim-surface);color:var(--jim-ink);border-radius:999px;padding:7px 12px;",
    "font:500 13.5px/1.25 'Public Sans',system-ui,sans-serif;cursor:pointer;text-align:left}",
    ".jim-chip:hover{border-color:var(--jim-accent);color:var(--accent,var(--jim-accent))}",
    ".jim-foot{border-top:1px solid var(--jim-border);padding:10px 12px 8px;background:var(--jim-surface)}",
    ".jim-form{display:flex;gap:8px;align-items:flex-end}",
    ".jim-input{flex:1;resize:none;max-height:140px;min-height:44px;border:1px solid var(--jim-border);border-radius:12px;padding:11px 12px;",
    "font:15px/1.4 'Public Sans',system-ui,sans-serif;color:var(--jim-ink);background:var(--jim-sunken)}",
    ".jim-input::placeholder{color:var(--jim-muted)}",
    ".jim-send{flex:none;width:44px;height:44px;border-radius:12px;border:0;background:var(--jim-accent);color:#fff;cursor:pointer;display:grid;place-items:center}",
    ".jim-send:disabled{opacity:.45;cursor:default}",
    ".jim-send svg{width:20px;height:20px}",
    ".jim-note{margin:6px 2px 0;font-size:11.5px;color:var(--jim-muted);line-height:1.35}",
    "@media (max-width:520px){.jim-panel{right:0;bottom:0;width:100vw;height:100dvh;max-height:none;border-radius:0;border:0}",
    ".jim-launch{right:14px;bottom:14px}.jim-bubble{max-width:92%}}",
    "@media print{.jim-root{display:none}}"
  ].join("");

  var HAT = '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="var(--jim-wheat)" d="M11 9.5c0-2 2.2-3.5 5-3.5s5 1.5 5 3.5l.9 7.4c-2 .8-4 1.1-5.9 1.1s-3.9-.3-5.9-1.1z"/>' +
    '<path fill="var(--jim-accent)" d="M10.6 14.6c1.8.7 3.6 1 5.4 1s3.6-.3 5.4-1l.3 2.3c-1.9.7-3.8 1-5.7 1s-3.8-.3-5.7-1z"/>' +
    '<path fill="var(--jim-wheat)" d="M2.5 16.2c1.4-.9 2.9-.8 4.3.2 2.8 2 5.8 2.9 9.2 2.9s6.4-.9 9.2-2.9c1.4-1 2.9-1.1 4.3-.2-1.5 4.5-7 7.3-13.5 7.3S4 20.7 2.5 16.2z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_NEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7"/></svg>';

  /* ------------------------------------------------------------------ state */
  var state = { messages: [], open: false };
  try {
    var saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    if (saved && Array.isArray(saved.messages)) state = { messages: saved.messages.slice(-40), open: !!saved.open };
  } catch (e) { /* storage unavailable: start fresh */ }
  function persist() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  var busy = false;

  /* ------------------------------------------------------------------ DOM */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  var style = el("style");
  style.textContent = css;
  document.head.appendChild(style);

  var root = el("div", "jim-root");
  var launch = el("button", "jim-launch", '<span class="jim-avatar">' + HAT + '</span><span>Ask Jim</span>');
  launch.type = "button";
  launch.setAttribute("aria-label", "Open chat with Jim, the budgets assistant");

  var panel = el("section", "jim-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Chat with Jim");
  panel.hidden = true;
  panel.innerHTML =
    '<header class="jim-head"><span class="jim-avatar">' + HAT + '</span>' +
    '<div class="t"><div class="n">Jim</div><div class="s">Budgets &amp; decision-aids assistant</div></div>' +
    '<button type="button" class="jim-iconbtn" data-act="new" title="Start a new chat" aria-label="Start a new chat">' + ICON_NEW + '</button>' +
    '<button type="button" class="jim-iconbtn" data-act="close" title="Close" aria-label="Close chat">' + ICON_X + '</button></header>' +
    '<div class="jim-log" aria-live="polite"></div>' +
    '<div class="jim-foot"><form class="jim-form"><label class="jim-sr" for="jimInput" style="position:absolute;left:-9999px">Your question for Jim</label>' +
    '<textarea id="jimInput" class="jim-input" rows="1" placeholder="Ask about margins, costs, prices…" maxlength="2000"></textarea>' +
    '<button type="submit" class="jim-send" aria-label="Send">' + ICON_SEND + '</button></form>' +
    '<p class="jim-note">Jim is an AI assistant and can make mistakes. Budget figures are 2026 planning estimates for the Rolling Plains (District 3) — check them against your own numbers.</p></div>';

  root.appendChild(launch);
  root.appendChild(panel);
  var log = panel.querySelector(".jim-log");
  var form = panel.querySelector(".jim-form");
  var input = panel.querySelector(".jim-input");
  var sendBtn = panel.querySelector(".jim-send");

  /* ------------------------------------------------------------------ markdown (safe subset) */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return s;
  }
  function md(text) {
    var lines = String(text).replace(/\r/g, "").split("\n");
    var out = [], i = 0, para = [];
    function flush() { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } }
    while (i < lines.length) {
      var ln = lines[i];
      if (/^\s*$/.test(ln)) { flush(); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        flush();
        var cells = function (r) { return r.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return inline(c.trim()); }); };
        var h = cells(ln), rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push('<div class="jim-tablewrap"><table><thead><tr><th>' + h.join("</th><th>") + "</th></tr></thead><tbody>" +
          rows.map(function (r) { return "<tr><td>" + r.join("</td><td>") + "</td></tr>"; }).join("") + "</tbody></table></div>");
        continue;
      }
      var m;
      if ((m = ln.match(/^\s*#{1,6}\s+(.*)$/))) { flush(); out.push("<h4>" + inline(m[1]) + "</h4>"); i++; continue; }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(ln)) {
        flush();
        var ordered = /^\s*\d+[.)]\s+/.test(ln), items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          items.push(inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, "")));
          i++;
        }
        out.push((ordered ? "<ol>" : "<ul>") + "<li>" + items.join("</li><li>") + "</li>" + (ordered ? "</ol>" : "</ul>"));
        continue;
      }
      if ((m = ln.match(/^\s*(Source|Sources|Fuente|Fuentes)\s*:\s*(.*)$/i))) {
        flush(); out.push('<span class="src">' + esc(m[1]) + ": " + inline(m[2]) + "</span>"); i++; continue;
      }
      para.push(ln.trim());
      i++;
    }
    flush();
    return out.join("");
  }

  /* ------------------------------------------------------------------ rendering */
  function botRow(html) {
    var row = el("div", "jim-row bot");
    row.appendChild(el("span", "jim-avatar sm", HAT));
    var b = el("div", "jim-bubble", html);
    row.appendChild(b);
    log.appendChild(row);
    return b;
  }
  function userRow(text) {
    var row = el("div", "jim-row user");
    var b = el("div", "jim-bubble");
    b.textContent = text;
    row.appendChild(b);
    log.appendChild(row);
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function render() {
    log.innerHTML = "";
    botRow(md("Hi, I'm **Jim**. Ask me about the gross margins, costs and breakeven prices in the 2026 District 3 budgets — wheat, cotton, peanuts, sorghum, hay, cow-calf, stockers and more — or about anything in the decision-aid manuals on this site."));
    if (!state.messages.length) {
      var chips = el("div", "jim-chips");
      SUGGESTIONS.forEach(function (s) {
        var c = el("button", "jim-chip");
        c.type = "button";
        c.textContent = s;
        c.addEventListener("click", function () { ask(s); });
        chips.appendChild(c);
      });
      log.appendChild(chips);
    }
    state.messages.forEach(function (m) {
      if (m.role === "user") userRow(m.content); else botRow(md(m.content));
    });
    var last = state.messages[state.messages.length - 1];
    if (last && last.role === "user" && !busy) showRetry(botRow(""), "I didn't get to answer that one.");
    scrollDown();
  }
  function showRetry(bubble, msg) {
    bubble.insertAdjacentHTML("beforeend", '<p class="jim-err">' + esc(msg) + "</p>");
    var retry = el("button", "jim-retry", "Try again");
    retry.type = "button";
    retry.addEventListener("click", function () { if (busy) return; bubble.parentNode.remove(); reply(); });
    bubble.appendChild(retry);
  }

  /* ------------------------------------------------------------------ open / close */
  function openPanel(focus) {
    state.open = true; persist();
    panel.hidden = false; launch.hidden = true;
    scrollDown();
    if (focus !== false) setTimeout(function () { input.focus(); }, 30);
  }
  function closePanel() {
    state.open = false; persist();
    panel.hidden = true; launch.hidden = false;
    launch.focus();
  }
  launch.addEventListener("click", function () { openPanel(true); });
  panel.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.getAttribute("data-act") === "close") closePanel();
    if (b.getAttribute("data-act") === "new" && !busy) { state.messages = []; persist(); render(); input.focus(); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) closePanel(); });

  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : submit(); }
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
  function submit() {
    var q = input.value.trim();
    if (!q || busy) return;
    input.value = ""; autosize();
    ask(q);
  }

  /* ------------------------------------------------------------------ talking to the worker */
  function setBusy(b) { busy = b; sendBtn.disabled = b; }

  function ask(question) {
    if (busy) return;
    if (!state.open) openPanel(false);
    var chips = log.querySelector(".jim-chips");
    if (chips) chips.remove();
    state.messages.push({ role: "user", content: question });
    persist();
    userRow(question);
    reply();
  }

  function reply() {
    var bubble = botRow('<span class="jim-status"><span class="jim-dots"><i></i><i></i><i></i></span><span class="lbl">Thinking…</span></span>');
    scrollDown();
    if (!configured) {
      bubble.innerHTML = md("I'm not connected yet. The site owner still needs to link me to my server (see the setup guide). Please check back soon!");
      state.messages.pop(); persist();
      return;
    }
    setBusy(true);
    var text = "", gotText = false, failed = null;
    var history = state.messages.slice(-MAX_HISTORY);

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, page: { title: document.title, path: location.pathname } })
    }).then(function (res) {
      var ctype = res.headers.get("content-type") || "";
      if (!res.ok || ctype.indexOf("text/event-stream") === -1) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || ("Jim couldn't answer (error " + res.status + ")."));
        });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            var chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
            var ev = (chunk.match(/^event: (.*)$/m) || [])[1];
            var data = (chunk.match(/^data: (.*)$/m) || [])[1];
            var obj = {};
            try { obj = JSON.parse(data || "{}"); } catch (e) { continue; }
            if (ev === "text" && obj.t) {
              text += obj.t; gotText = true;
              bubble.innerHTML = md(text);
              scrollDown();
            } else if (ev === "status") {
              if (!gotText) { var l = bubble.querySelector(".lbl"); if (l) l.textContent = obj.s; }
              else { bubble.innerHTML = md(text) + '<span class="jim-status"><span class="jim-dots"><i></i><i></i><i></i></span><span class="lbl">' + esc(obj.s) + "</span></span>"; }
              scrollDown();
            } else if (ev === "error") {
              failed = obj.message || "Something went wrong.";
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      failed = (e && e.message && e.message !== "Failed to fetch") ? e.message : "I couldn't reach my server. Check your connection and try again.";
    }).then(function () {
      setBusy(false);
      if (failed || !text.trim()) {
        bubble.innerHTML = text.trim() ? md(text) : "";
        showRetry(bubble, failed || "I didn't get an answer that time.");
      } else {
        bubble.innerHTML = md(text);
        state.messages.push({ role: "assistant", content: text });
        persist();
      }
      scrollDown();
    });
  }

  function mount() { document.body.appendChild(root); render(); if (state.open) openPanel(false); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  window.Jim = { open: function () { openPanel(true); }, ask: ask };
})();
