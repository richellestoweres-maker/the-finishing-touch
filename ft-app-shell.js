/* The Finishing Touch: shared portal layout for the admin, contractor and client portals.
   Computers get a left sidebar and a portal header. Phones (820px wide or less) get
   the wordmark up top and tabs along the bottom, ready to wrap as an app.
   It drives each page's own menu buttons, so no page logic changes. */
(function () {
  if (window.__ftAppShell) return;
  window.__ftAppShell = true;

  var PAGE = /contractor-dashboard/.test(location.pathname) ? "contractor"
    : /client-dashboard/.test(location.pathname) ? "client"
    : /admin-dashboard/.test(location.pathname) ? "admin" : "";
  if (!PAGE) return;

  var ICONS = {
    home: '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>',
    inbox: '<path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M4 13h3l3 3h4l3 -3h3"/>',
    briefcase: '<path d="M3 7m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2"/><path d="M12 12l0 .01"/><path d="M3 13a20 20 0 0 0 18 0"/>',
    stack: '<path d="M12 4l-8 4l8 4l8 -4l-8 -4"/><path d="M4 12l8 4l8 -4"/><path d="M4 16l8 4l8 -4"/>',
    users: '<path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/>',
    user: '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
    calendar: '<path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/>',
    quote: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    message: '<path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z"/>',
    more: '<path d="M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>',
    dot: '<path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>',
    out: '<path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/>',
    link: '<path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/>',
    chevron: '<path d="M9 6l6 6l-6 6"/>'
  };

  function svg(name, size) {
    var s = size || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.dot) + "</svg>";
  }

  /* Per portal: where its menu lives, the tabs in the bar, and the account links. */
  var CONFIG = {
    admin: {
      portal: "Admin Portal", suite: "Admin Command Center", account: "Admin",
      items: ".tabs .tabbtn",
      key: function (b) { return b.dataset.tab || ""; },
      primary: [
        { key: "today", label: "Today", icon: "calendar" },
        { key: "intake", label: "Inbox", icon: "inbox" },
        { key: "all", label: "Jobs", icon: "stack" }
      ],
      more: true,
      actions: ".topbar .row a",
      /* The admin sections have no titles of their own, so the layout adds one. */
      titles: {
        today: ["Today", "Operations overview for {date}."],
        intake: ["Intake Inbox", "Review new service requests, add notes, and move them to jobs."],
        open: ["Job Inbox", "Work queue for jobs already created. Review, assign, and move jobs toward scheduling."],
        all: ["All Jobs", "Every job, newest first."],
        workflow: ["Job Workflow", ""],
        create: ["Create Job", "Add a job by hand."],
        walkthroughs: ["Walkthroughs", "Schedule and track client walkthroughs for active jobs."],
        quotes: ["Quote Queue", "Review contractor pricing, apply markup, and create client quotes."],
        estimate: ["Estimate Hub", "Create, manage, and send estimates to clients."],
        contractors: ["Contractors", "Manage approved contractors, their services, service areas, and availability."],
        apps: ["Applications", "Review contractor and team applications, move them through the process, and request more information."],
        compliance: ["Compliance", "Agreements, insurance, and documents on file."],
        clients: ["Clients", "Search and manage clients, view recent activity, and handle pending requests."],
        scheduling: ["Scheduling AI", ""],
        calendar: ["Calendar", ""],
        payments: ["Payments", ""],
        settings: ["Settings", ""]
      },
      ready: function () { return !!document.querySelector(".tabs .tabbtn"); }
    },
    contractor: {
      portal: "Contractor Portal", suite: "Contractor Suite", account: "My Account",
      items: ".rail-nav .navbtn",
      key: function (b) { return b.dataset.view || ""; },
      primary: [
        { key: "home", label: "Home", icon: "home" },
        { key: "jobs", label: "Jobs", icon: "briefcase" },
        { key: "schedule", label: "Schedule", icon: "calendar" }
      ],
      more: true,
      moreFirst: ["quotes"],
      actions: ".rail-footer > a",
      ready: function () { return !!document.querySelector("#appScreen.active"); }
    },
    client: {
      portal: "Client Portal", suite: "Client Suite", account: "My Account",
      items: ".side-nav .side-link",
      key: function (b) { return b.dataset.side || ""; },
      primary: [
        { key: "dashboard", label: "Home", icon: "home" },
        { key: "bookings", label: "Bookings", icon: "calendar" },
        { key: "messages", label: "Messages", icon: "message" },
        { key: "profile", label: "Profile", icon: "user", match: /profile/i }
      ],
      more: false,
      /* With no More tab, the other sections are listed at the top of Profile. */
      profileLinks: { panel: "#profilePanel .panel-shell", keys: ["scheduling", "perks", "invoices"] },
      actions: ".side-footer > a",
      ready: function () { return !!document.querySelector(".side-nav .side-link"); }
    }
  }[PAGE];

  var INK = "#2b1a10", BROWN = "#3a2214", IVORY = "#f8f2e8", CARD = "#fcf8f2", LINE = "#e2d4c0", FIELD = "#cdb9a3", GOLD = "#d9bf94", MUTED = "#8c7564";
  var SERIF = "'Cormorant Garamond',Georgia,serif";
  var SANS = "Manrope,system-ui,-apple-system,sans-serif";

  var CSS = [
    "#ftAppBar,#ftTabBar,#ftSheet,#ftSide{display:none}",

    /* ---------- shared look, every screen size ---------- */
    "html.ft-app body{background:" + IVORY + " !important;background-image:none !important;color:" + INK + "}",
    "html.ft-app .mini-kicker,html.ft-app .script-kicker,html.ft-app.ft-admin .portal>.topbar,html.ft-app.ft-admin .admin-hero,html.ft-app.ft-admin .tabs,html.ft-app.ft-contractor nav.bottom-nav,html.ft-app.ft-contractor .app-rail,html.ft-app.ft-contractor .main>.topbar,html.ft-app.ft-client .sidebar,html.ft-app.ft-client .main-area>.topbar{display:none !important}",
    "html.ft-app.ft-client:not([data-ft-tab=dashboard]) .main-area>.hero-card{display:none !important}",
    "html.ft-app .app-shell,html.ft-app .portal-shell{display:block !important}",
    "html.ft-app .portal,html.ft-app .portal-shell,html.ft-app .app-shell,html.ft-app .main,html.ft-app .main-area,html.ft-app .panels{background:transparent !important;background-image:none !important;box-shadow:none !important;border:0 !important}",
    "html.ft-app .appview,html.ft-app .panel-shell,html.ft-app.ft-client .hero-card,html.ft-app .client-panel{background:transparent !important;background-image:none !important;border:0 !important;box-shadow:none !important;padding-left:0 !important;padding-right:0 !important}",
    "html.ft-app .card,html.ft-app .tile,html.ft-app .qr-card,html.ft-app .sc-card,html.ft-app .doc-item,html.ft-app .clause-card,html.ft-app .review-row,html.ft-app .workflow-kpi,html.ft-app .compliance-kpi,html.ft-app .stat,html.ft-app .request-box,html.ft-app .setting-row,html.ft-app .empty,html.ft-app .workflow-hero,html.ft-app .form-grid{background:" + CARD + " !important;background-image:none !important;border:1px solid " + LINE + " !important;border-radius:12px !important;box-shadow:none !important}",
    "html.ft-app .tile::before,html.ft-app .tile::after,html.ft-app .card::before,html.ft-app .card::after{display:none !important}",
    "html.ft-app .card h3,html.ft-app .card strong,html.ft-app .tile h3,html.ft-app .tile strong,html.ft-app .tile h4,html.ft-app .qr-card strong,html.ft-app .stat strong,html.ft-app .panel-shell h3{font-family:" + SANS + " !important;font-weight:700 !important;color:" + INK + " !important;letter-spacing:0 !important}",
    "html.ft-app .screen-title,html.ft-app .client-panel>.panel-shell>h2,html.ft-app .hero-card h2{font-family:" + SERIF + " !important;font-style:italic !important;font-weight:500 !important;color:" + INK + " !important;letter-spacing:-.01em !important;line-height:1.02 !important}",
    "html.ft-app .screen-copy,html.ft-app .client-panel>.panel-shell>p.small,html.ft-app .hero-card p{font-family:" + SANS + " !important;color:#3d2b20 !important}",
    "html.ft-app .btn-solid,html.ft-app .btn-primary{background:" + BROWN + " !important;background-image:none !important;color:#fff !important;border:0 !important;border-radius:10px !important;box-shadow:none !important;font-family:" + SANS + " !important;font-weight:600 !important}",
    "html.ft-app .btn-outline,html.ft-app .btn-soft{background:transparent !important;background-image:none !important;color:" + INK + " !important;border:1px solid " + FIELD + " !important;border-radius:10px !important;box-shadow:none !important}",
    "html.ft-app .chip,html.ft-app .fa-chip,html.ft-app #filterChips button{background:transparent !important;border:1px solid " + FIELD + " !important;border-radius:10px !important;color:" + INK + " !important;box-shadow:none !important}",
    "html.ft-app input:not([type=checkbox]):not([type=radio]),html.ft-app select,html.ft-app textarea{background:#fffdf9 !important;border:1px solid " + FIELD + " !important;border-radius:10px !important;box-shadow:none !important;color:" + INK + " !important}",
    "html.ft-app .rolepill,html.ft-app .status-pill{background:#f1e6d8 !important;border:0 !important;color:" + INK + " !important}",
    "html.ft-app .bar,html.ft-app .toolbar{background:transparent !important;background-image:none !important;box-shadow:none !important;border:0 !important;padding-left:0 !important;padding-right:0 !important;justify-content:flex-start !important}",
    "html.ft-app .stat::before,html.ft-app .stat::after,html.ft-app .hero-card::before,html.ft-app .hero-card::after,html.ft-app .toolbar::before,html.ft-app .toolbar::after{display:none !important}",
    "html.ft-app .stats-row{align-items:start !important;align-self:start !important}",
    "html.ft-app #searchBox{min-width:min(420px,100%)}",
    "#ftAppBar .ft-page h1{font-family:" + SERIF + ";font-style:italic;font-weight:500;color:" + INK + ";margin:0;letter-spacing:-.01em;line-height:1.02}",
    "#ftAppBar .ft-page p{font:400 16px/1.5 " + SANS + ";color:#3d2b20;margin:10px 0 0}",
    "#ftAppBar .ft-page:empty{display:none}",
    ".ft-row{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;min-height:54px;padding:0 16px;margin-bottom:8px;border:1px solid " + LINE + ";border-radius:12px;background:" + CARD + ";color:" + INK + ";font:600 16px/1.2 " + SANS + ";cursor:pointer}",
    ".ft-row span{flex:1}",
    ".ft-row.on{border-color:" + INK + "}",
    ".ft-row svg{color:" + INK + ";flex:none}",
    ".ft-sec{font:600 11px/1 " + SANS + ";letter-spacing:.16em;text-transform:uppercase;color:" + MUTED + ";margin:16px 4px 10px}",

    /* ---------- computer: sidebar on the left, portal name across the top ---------- */
    "@media (min-width:821px){",
    "html.ft-app body{padding-left:300px !important}",
    "html.ft-app #ftSide{display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;width:300px;z-index:900;background:#f5eee3;border-right:1px solid " + LINE + ";padding:34px 26px 24px;box-sizing:border-box;overflow:auto}",
    "#ftSide .ft-brand{font:600 14px/1 " + SERIF + ";letter-spacing:.32em;text-transform:uppercase;color:" + INK + ";padding-bottom:18px;border-bottom:1px solid " + GOLD + ";white-space:nowrap}",
    "#ftSide .ft-suite{font:400 15px/1 " + SANS + ";color:" + INK + ";margin:18px 0 26px}",
    "#ftSide nav{display:flex;flex-direction:column;gap:4px;flex:1}",
    "#ftSide nav button{all:unset;box-sizing:border-box;display:block;padding:12px 18px;border-radius:8px;border-left:3px solid transparent;font:400 17px/1.2 " + SANS + ";color:" + INK + ";cursor:pointer}",
    "#ftSide nav button:hover{background:#efe5d7}",
    "#ftSide nav button.on{background:#efe3d2;border-left-color:" + INK + ";font-weight:700}",
    "#ftSide .ft-foot{border-top:1px solid " + GOLD + ";padding-top:16px;margin-top:20px}",
    "#ftSide .ft-foot button{all:unset;cursor:pointer;font:400 17px/1.2 " + SANS + ";color:" + INK + ";padding:6px 4px}",
    "html.ft-app #ftAppBar{display:block;padding:26px 48px 0;max-width:1240px}",
    "#ftAppBar .ft-top{display:flex;align-items:center;justify-content:space-between;padding-bottom:22px;border-bottom:1px solid " + GOLD + ";position:relative}",
    "#ftAppBar .ft-portal{font:700 15px/1 " + SANS + ";letter-spacing:.24em;text-transform:uppercase;color:" + INK + "}",
    "#ftAppBar .ft-acct{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;font:500 17px/1 " + SANS + ";color:" + INK + "}",
    "#ftAppBar .ft-menu{display:none;position:absolute;right:0;top:44px;min-width:240px;background:" + IVORY + ";border:1px solid " + LINE + ";border-radius:12px;padding:10px;z-index:960;box-shadow:0 12px 30px rgba(43,26,16,.10)}",
    "#ftAppBar .ft-menu.open{display:block}",
    "#ftAppBar .ft-menu .ft-row{margin-bottom:6px}",
    "#ftAppBar .ft-brand{display:none}",
    "#ftAppBar .ft-page{padding:44px 0 4px}",
    "#ftAppBar .ft-page h1{font-size:68px}",
    "#ftAppBar .ft-page p{font-size:19px}",
    "html.ft-app .portal,html.ft-app .main,html.ft-app .main-area{padding:18px 48px 48px !important;max-width:1240px !important;margin:0 !important;box-sizing:border-box}",
    "html.ft-app .screen-title,html.ft-app .client-panel>.panel-shell>h2,html.ft-app .hero-card h2{font-size:68px !important;margin:18px 0 12px !important}",
    "html.ft-app .screen-copy,html.ft-app .client-panel>.panel-shell>p.small,html.ft-app .hero-card p{font-size:19px !important}",
    "html.ft-app .ft-links{display:none}",
    "}",

    /* ---------- phone: wordmark at the top, tabs along the bottom ---------- */
    "@media (max-width:820px){",
    "html{-webkit-text-size-adjust:100%}",
    "html.ft-app body{padding-bottom:calc(92px + env(safe-area-inset-bottom)) !important}",
    "html.ft-app #ftAppBar{display:block;padding:calc(18px + env(safe-area-inset-top)) 22px 0;background:" + IVORY + "}",
    "#ftAppBar .ft-top{display:none}",
    "#ftAppBar .ft-brand{font:600 14px/1 " + SERIF + ";letter-spacing:.36em;text-transform:uppercase;color:" + INK + ";text-align:center;padding:6px 0 18px;border-bottom:1px solid " + GOLD + ";margin:0 6px}",
    "#ftAppBar .ft-page{padding:26px 0 6px}",
    "#ftAppBar .ft-page h1{font-size:42px}",
    "html.ft-app #ftTabBar{display:grid;position:fixed;left:0;right:0;bottom:0;z-index:950;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:" + IVORY + ";border-top:1px solid " + LINE + "}",
    "#ftTabBar button{all:unset;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:56px;color:#5c4636;font:500 12px/1 " + SANS + ";cursor:pointer;-webkit-tap-highlight-color:transparent}",
    "#ftTabBar button.on{color:" + INK + ";font-weight:700}",
    "#ftTabBar button.on::after{content:'';position:absolute;bottom:0;width:36px;height:2px;border-radius:2px;background:" + INK + "}",
    "html.ft-app #ftSheet{display:block;position:fixed;inset:0;z-index:1000;pointer-events:none}",
    "#ftSheet .ft-dim{position:absolute;inset:0;background:rgba(43,26,16,.28);opacity:0;transition:opacity .2s}",
    "#ftSheet .ft-panel{position:absolute;left:0;right:0;bottom:0;max-height:80vh;overflow:auto;background:" + IVORY + ";border-radius:22px 22px 0 0;padding:10px 18px calc(20px + env(safe-area-inset-bottom));transform:translateY(105%);transition:transform .25s ease}",
    "#ftSheet.open{pointer-events:auto}",
    "#ftSheet.open .ft-dim{opacity:1}",
    "#ftSheet.open .ft-panel{transform:none}",
    "#ftSheet .ft-grab{width:40px;height:4px;border-radius:9px;background:" + LINE + ";margin:4px auto 10px}",
    "html.ft-app .portal,html.ft-app .main,html.ft-app .main-area{padding-left:20px !important;padding-right:20px !important;max-width:none !important}",
    "html.ft-app .screen-title,html.ft-app .client-panel>.panel-shell>h2,html.ft-app .hero-card h2{font-size:42px !important;margin:6px 0 10px !important}",
    "html.ft-app .screen-copy,html.ft-app .client-panel>.panel-shell>p.small,html.ft-app .hero-card p{font-size:16px !important;line-height:1.5 !important}",
    "html.ft-app.ft-contractor #view-home .grid{display:grid !important;grid-template-columns:1fr 1fr !important;gap:10px !important}",
    "html.ft-app .btn-solid,html.ft-app .btn-primary{min-height:50px}",
    "html.ft-app .btn-outline,html.ft-app .btn-soft{min-height:48px}",
    "html.ft-app .chip,html.ft-app .fa-chip,html.ft-app #filterChips button{min-height:42px}",
    "html.ft-app input:not([type=checkbox]):not([type=radio]),html.ft-app select,html.ft-app textarea{font-size:16px !important;min-height:48px}",
    "html.ft-app .form-grid{grid-template-columns:1fr !important}",
    "html.ft-app .stats-row{grid-template-columns:repeat(3,1fr) !important;gap:8px !important}",
    "html.ft-app #ftt-chat-launcher,html.ft-app #admin-help-launcher{bottom:calc(96px + env(safe-area-inset-bottom)) !important}",
    /* The crew's Open job bar sits just above the tabs, never on top of them. */
    "html.ft-app #ftjr-launch{bottom:calc(73px + env(safe-area-inset-bottom)) !important;padding-bottom:12px !important;z-index:940 !important;border-bottom:1px solid " + LINE + "}",
    "html.ft-app body:has(#ftjr-launch.on){padding-bottom:calc(170px + env(safe-area-inset-bottom)) !important}",
    "}"
  ].join("\n");

  function clean(t) {
    return String(t || "").replace(/\s+/g, " ").replace(/^(\d{2}|[A-Z](?=[A-Z][a-z]))\s*/, "").trim();
  }

  function items() { return Array.prototype.slice.call(document.querySelectorAll(CONFIG.items)); }
  function find(key) {
    var list = items();
    var hit = list.filter(function (b) { return CONFIG.key(b) === key; })[0];
    if (hit) return hit;
    var p = CONFIG.primary.filter(function (x) { return x.key === key; })[0];
    return p && p.match ? list.filter(function (b) { return p.match.test(b.textContent); })[0] : null;
  }
  function keyOf(b) {
    var k = CONFIG.key(b);
    var p = CONFIG.primary.filter(function (x) { return x.match && x.match.test(b.textContent); })[0];
    return p ? p.key : k;
  }
  function activeKey() {
    var a = items().filter(function (b) { return b.classList.contains("active"); })[0];
    return a ? keyOf(a) : "";
  }

  var bar, tabs, sheet, side, lastKey = null, lastNav = "";

  function accountActions() { return Array.prototype.slice.call(document.querySelectorAll(CONFIG.actions)); }

  function build() {
    var font = document.createElement("link");
    font.rel = "stylesheet";
    font.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Manrope:wght@400;500;600;700&display=swap";
    document.head.appendChild(font);

    var style = document.createElement("style");
    style.id = "ftAppShellCss";
    style.textContent = CSS;
    document.head.appendChild(style);

    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && !/viewport-fit/.test(vp.content)) vp.content += ", viewport-fit=cover";

    bar = document.createElement("header");
    bar.id = "ftAppBar";
    bar.innerHTML = '<div class="ft-top"><span class="ft-portal">' + CONFIG.portal + '</span><button type="button" class="ft-acct" aria-haspopup="true">' + CONFIG.account + ' <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6"/></svg></button><div class="ft-menu" role="menu"></div></div><div class="ft-brand">The Finishing Touch</div><div class="ft-page"></div>';
    document.body.insertBefore(bar, document.body.firstChild);
    bar.querySelector(".ft-acct").addEventListener("click", function (e) {
      e.stopPropagation();
      var menu = bar.querySelector(".ft-menu");
      var acts = accountActions();
      menu.innerHTML = actionRows(acts.filter(function (a) { return !/sign out|log out/i.test(a.textContent); }), acts);
      wire(menu, acts);
      menu.classList.toggle("open");
    });
    document.addEventListener("click", function () { bar.querySelector(".ft-menu").classList.remove("open"); });

    side = document.createElement("aside");
    side.id = "ftSide";
    side.innerHTML = '<div class="ft-brand">The Finishing Touch</div><div class="ft-suite">' + CONFIG.suite + '</div><nav aria-label="Sections"></nav><div class="ft-foot"><button type="button" class="ft-signout">Sign out</button></div>';
    side.querySelector(".ft-signout").addEventListener("click", function () {
      var out = accountActions().filter(function (a) { return /sign out|log out/i.test(a.textContent); })[0];
      if (out) out.click();
    });
    document.body.insertBefore(side, document.body.firstChild);

    tabs = document.createElement("nav");
    tabs.id = "ftTabBar";
    tabs.setAttribute("aria-label", "Main");
    var count = CONFIG.primary.length + (CONFIG.more ? 1 : 0);
    tabs.style.gridTemplateColumns = "repeat(" + count + ",1fr)";
    CONFIG.primary.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.key = p.key;
      b.innerHTML = svg(p.icon) + "<span>" + p.label + "</span>";
      b.addEventListener("click", function () { go(p.key); });
      tabs.appendChild(b);
    });
    if (CONFIG.more) {
      var more = document.createElement("button");
      more.type = "button";
      more.dataset.key = "__more";
      more.innerHTML = svg("more") + "<span>More</span>";
      more.addEventListener("click", openSheet);
      tabs.appendChild(more);
    }
    document.body.appendChild(tabs);

    sheet = document.createElement("div");
    sheet.id = "ftSheet";
    sheet.innerHTML = '<div class="ft-dim"></div><div class="ft-panel" role="dialog" aria-label="More"><div class="ft-grab"></div><div class="ft-list"></div></div>';
    sheet.querySelector(".ft-dim").addEventListener("click", closeSheet);
    document.body.appendChild(sheet);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  }

  function go(key) {
    var b = find(key);
    if (!b) return;
    b.click();
    closeSheet();
    window.scrollTo(0, 0);
    sync();
  }

  function rowHtml(attr, icon, text, on) {
    return '<button type="button" class="ft-row' + (on ? " on" : "") + '" ' + attr + ">" + svg(icon, 22) + "<span>" + escapeHtml(text) + "</span>" + svg("chevron", 18) + "</button>";
  }

  function actionRows(acts, all) {
    var html = "";
    acts.forEach(function (a) {
      var i = (all || acts).indexOf(a);
      var t = clean(a.textContent);
      html += rowHtml('data-act="' + i + '"', /sign out|log out/i.test(t) ? "out" : "link", t, false);
    });
    return html;
  }

  function wire(list, acts) {
    list.querySelectorAll("[data-key]").forEach(function (el) {
      el.addEventListener("click", function () { go(el.dataset.key); });
    });
    list.querySelectorAll("[data-act]").forEach(function (el) {
      el.addEventListener("click", function () { closeSheet(); acts[+el.dataset.act].click(); });
    });
  }

  function openSheet() {
    var list = sheet.querySelector(".ft-list");
    var current = activeKey();
    var inBar = CONFIG.primary.map(function (p) { return p.key; });
    var rest = items().filter(function (b) { return inBar.indexOf(keyOf(b)) < 0 && keyOf(b); });
    var first = CONFIG.moreFirst || [];
    rest.sort(function (a, b) {
      var ia = first.indexOf(keyOf(a)), ib = first.indexOf(keyOf(b));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var html = "";
    rest.forEach(function (b) {
      var k = keyOf(b);
      html += rowHtml('data-key="' + k + '"', "dot", clean(b.textContent), k === current);
    });
    var acts = Array.prototype.slice.call(document.querySelectorAll(CONFIG.actions));
    if (acts.length) html += '<div class="ft-sec">Account</div>' + actionRows(acts);
    list.innerHTML = html;
    wire(list, acts);
    sheet.classList.add("open");
  }

  function closeSheet() { if (sheet) sheet.classList.remove("open"); }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* Client: Profile also lists the sections that have no tab of their own. */
  function profileLinks() {
    var cfg = CONFIG.profileLinks;
    if (!cfg) return;
    var host = document.querySelector(cfg.panel);
    if (!host || host.querySelector(".ft-links")) return;
    var acts = Array.prototype.slice.call(document.querySelectorAll(CONFIG.actions));
    var html = "";
    cfg.keys.forEach(function (k) {
      var b = find(k);
      if (b) html += rowHtml('data-key="' + k + '"', "dot", clean(b.textContent), false);
    });
    html += actionRows(acts);
    var box = document.createElement("div");
    box.className = "ft-links";
    box.innerHTML = html;
    var title = host.querySelector("h2");
    host.insertBefore(box, title ? title.nextSibling : host.firstChild);
    wire(box, acts);
  }

  function sync() {
    var on = CONFIG.ready();
    var root = document.documentElement;
    root.classList.toggle("ft-app", on);
    root.classList.add("ft-" + PAGE);
    if (!on) return;
    var key = activeKey();
    root.setAttribute("data-ft-tab", key);
    var inBar = CONFIG.primary.some(function (p) { return p.key === key; });
    tabs.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.key === key || (b.dataset.key === "__more" && !inBar && !!key));
    });
    if (key !== lastKey) {
      lastKey = key;
      var page = bar.querySelector(".ft-page");
      if (CONFIG.titles) {
        var t = CONFIG.titles[key] || [clean((find(key) || {}).textContent || ""), ""];
        var sub = String(t[1] || "").replace("{date}", new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" }));
        page.innerHTML = "<h1>" + escapeHtml(t[0]) + "</h1>" + (sub ? "<p>" + escapeHtml(sub) + "</p>" : "");
      } else {
        page.innerHTML = "";
      }
    }
    var list = items();
    var sig = list.map(function (b) { return keyOf(b) + ":" + clean(b.textContent); }).join("|");
    var nav = side.querySelector("nav");
    if (sig !== lastNav) {
      lastNav = sig;
      nav.innerHTML = list.map(function (b) {
        return '<button type="button" data-key="' + keyOf(b) + '">' + escapeHtml(clean(b.textContent)) + "</button>";
      }).join("");
      nav.querySelectorAll("button").forEach(function (el) {
        el.addEventListener("click", function () { go(el.dataset.key); });
      });
    }
    nav.querySelectorAll("button").forEach(function (el) { el.classList.toggle("on", el.dataset.key === key); });
    profileLinks();
  }

  function start() {
    build();
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; sync(); });
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    sync();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
