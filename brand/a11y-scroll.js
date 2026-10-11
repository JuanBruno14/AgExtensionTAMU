/*!
 * Keyboard access for tables that scroll sideways (WCAG 2.1.1).
 * When a .table-scroll wrapper overflows and holds nothing focusable, it becomes a labelled,
 * focusable region, so keyboard users can Tab to it and scroll it with the arrow keys.
 * Re-checked after the page changes or resizes, so it follows tables that are filled in by script
 * and only scroll on narrow screens.
 * Add to a page with:  <script src="../brand/a11y-scroll.js" defer></script>
 */
(function () {
  "use strict";
  var FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  var timer = null;

  function labelFor(w) {
    var cap = w.querySelector("caption");
    if (cap && cap.textContent.trim()) return cap.textContent.trim();
    var box = w.closest(".card, section, details, .subtool-panel, .tool-panel");
    var h = box && box.querySelector("h2, h3, h4, summary");
    return h ? h.textContent.trim() : "Table";
  }

  function update() {
    timer = null;
    document.querySelectorAll(".table-scroll").forEach(function (w) {
      var scrolls = w.scrollWidth > w.clientWidth + 1;
      var managed = w.getAttribute("data-a11y-scroll") === "1";
      if (scrolls && !w.querySelector(FOCUSABLE)) {
        if (!managed) {
          w.setAttribute("tabindex", "0");
          w.setAttribute("role", "region");
          w.setAttribute("aria-label", labelFor(w) + " (table, scrolls sideways)");
          w.setAttribute("data-a11y-scroll", "1");
        }
      } else if (managed) {
        w.removeAttribute("tabindex");
        w.removeAttribute("role");
        w.removeAttribute("aria-label");
        w.removeAttribute("data-a11y-scroll");
      }
    });
  }

  var firstQueued = 0;
  function queue() {
    var now = Date.now();
    if (timer) clearTimeout(timer); else firstQueued = now;
    // settle for 200 ms, but never wait more than a second while the page keeps changing (map tiles, charts)
    timer = setTimeout(update, now - firstQueued > 1000 ? 0 : 200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", queue);
  else queue();
  window.addEventListener("resize", queue);
  if (window.MutationObserver) new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
})();
