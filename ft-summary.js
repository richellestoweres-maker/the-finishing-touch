/* The Finishing Touch: job and intake summaries as an easy to read list.
   Every intake form saves its summary as one long line:
     "Cleaning | Property: residential | Layout: 2 Stories | 4 bed | 4 bath"
   This turns it into the service name plus one bullet per detail. Pieces
   with no label of their own (like "4 bed") join the line before them.
   Used by the admin, contractor and client portals. Load before their
   scripts:  <script src="ft-summary.js"></script>                        */
(function () {
  if (window.ftSummary) return;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function parts(summary) {
    var bits = String(summary || "").split(/\s*\|\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    var title = bits.length && !/:\s/.test(bits[0]) ? bits.shift() : "";
    var details = [];
    bits.forEach(function (p) {
      var i = p.indexOf(":");
      if (i > 0 && i < 40) {
        var value = p.slice(i + 1).trim();
        if (value) details.push({ label: p.slice(0, i).trim(), value: value });
      } else if (details.length) {
        details[details.length - 1].value += ", " + p;
      } else {
        details.push({ label: "", value: p });
      }
    });
    return { title: title, details: details };
  }

  // opts.title: show the service name above the list (default false, since
  //             most cards already show it)
  // opts.max:   how many lines show before "Show all" (default 8, 0 = all)
  function html(summary, opts) {
    opts = opts || {};
    var p = parts(summary);
    if (!p.details.length && !p.title) return "";
    var max = opts.max === 0 ? 0 : (opts.max || 8);
    var li = function (d) {
      return '<li>' + (d.label ? "<b>" + esc(d.label) + ":</b> " : "") + esc(d.value) + "</li>";
    };
    var shown = max ? p.details.slice(0, max) : p.details;
    var rest = max ? p.details.slice(max) : [];
    return '<div class="ft-sum">' +
      (opts.title && p.title ? '<div class="ft-sum-title">' + esc(p.title) + "</div>" : "") +
      (shown.length ? '<ul class="ft-details">' + shown.map(li).join("") + "</ul>" : "") +
      (rest.length ? '<details class="ft-more"><summary>Show all (' + rest.length + ' more)</summary><ul class="ft-details">' + rest.map(li).join("") + "</ul></details>" : "") +
      "</div>";
  }

  function title(summary) { return parts(summary).title; }

  var css = document.createElement("style");
  css.textContent =
    ".ft-sum{margin:10px 0}" +
    ".ft-sum-title{font-weight:700;margin:0 0 6px}" +
    ".ft-details{list-style:none;margin:0;padding:2px 0;border:1px solid #eadfd5;border-radius:12px;background:#fffdf9}" +
    ".ft-details li{position:relative;padding:7px 12px 7px 26px;font-size:14px;line-height:1.45;color:#3d3531;text-align:left}" +
    ".ft-details li+li{border-top:1px solid #f3ebe3}" +
    ".ft-details li::before{content:'';position:absolute;left:12px;top:14px;width:6px;height:6px;border-radius:50%;background:#9c6b74}" +
    ".ft-details b{font-weight:700;color:#2f2926}" +
    ".ft-more{margin-top:6px}" +
    ".ft-more summary{cursor:pointer;font-size:13px;font-weight:700;color:#9c6b74;padding:4px 2px}" +
    ".ft-more .ft-details{margin-top:6px}";
  (document.head || document.documentElement).appendChild(css);

  window.ftSummary = { parts: parts, html: html, title: title };
})();
