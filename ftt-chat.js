/* ============================================================
   The Finishing Touch — Site-wide Chat Widget (PAGE-AWARE)
   How to use:
   1) Include on every page: <script src="ftt-chat.js" defer></script>
   2) Requires your styles in styles.css for #ftt-chat / launcher.
   3) Auto-detects page and tailors answers (cleaning/organizing/decor/holiday).
   ============================================================ */
(function(){
  "use strict";

  // Don't double-inject
  if (document.getElementById("ftt-chat") || document.getElementById("ftt-chat-launcher")) return;

  // ---------- Context detection ----------
  const PATH = (location.pathname || "").toLowerCase();
  const CONTEXT =
      PATH.includes("intake-cleaning")   ? "cleaning"   :
      PATH.includes("intake-organizing") ? "organizing" :
      (PATH.includes("intake-decor") || PATH.includes("intake-staging")) ? "decor" :
      PATH.includes("intake-holiday")    ? "holiday"    :
      "general";

  // ---------- Core config (edit if needed) ----------
  const BASE = {
    timezone: "America/Chicago",
    email: "contact.thefinishingtouch.tx@gmail.com",
    messengerDeepLink: "https://m.me/thefinishingtouch.tx",
    // Your Square location page (safe default for all contexts)
    bookUrl: "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9",
    hours: { days:[1,2,3,4,5], open:"09:00", close:"17:00" }, // Mon–Fri, 9–5
  };

  // Per-context intake link (defaults to Cleaning if unknown)
  const INTAKE_MAP = {
    cleaning:   "intake-cleaning.html",
    organizing: "intake-organizing.html",
    decor:      "intake-decor.html",
    holiday:    "intake-holiday.html",
    general:    "intake-cleaning.html",
  };
  // If you’re already on an intake page, link to *this* page
  const DEFAULT_INTAKE =
    (CONTEXT !== "general" && PATH.endsWith(INTAKE_MAP[CONTEXT])) ? INTAKE_MAP[CONTEXT] : INTAKE_MAP[CONTEXT];

  // ---------- Page-aware copy helpers ----------
  function hoursNowNote(){
    try{
      const opt = { timeZone: BASE.timezone, hour12:false, weekday:"short", hour:"2-digit", minute:"2-digit" };
      const parts = new Intl.DateTimeFormat("en-US", opt).formatToParts(new Date());
      const h = +(parts.find(p=>p.type==="hour")?.value||"0");
      const m = +(parts.find(p=>p.type==="minute")?.value||"0");
      const wdShort = parts.find(p=>p.type==="weekday")?.value||"";
      const map = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
      const wd = map[wdShort] ?? new Date().getDay();
      const [oH,oM] = BASE.hours.open.split(":").map(Number);
      const [cH,cM] = BASE.hours.close.split(":").map(Number);
      const open = BASE.hours.days.includes(wd) && ((h>oH)||(h===oH&&m>=oM)) && ((h<cH)||(h===cH&&m<=cM));
      return open
        ? "We’re online now—ask me anything or say “human” to chat with a person."
        : "We’re offline right now, but I can still help or route your message to a person.";
    }catch{ return ""; }
  }

  // Per-context answers
  function answerFor(intent){
    const intakeLink = `<a href="${DEFAULT_INTAKE}">Start Intake</a>`;
    const bookLink   = `<a href="${BASE.bookUrl}" target="_blank" rel="noopener">Book now</a>`;
    const hrsNote    = hoursNowNote();

    // Context blocks
    const COPY = {
      cleaning: {
        pricing: [
          "Here’s a quick overview (final quote depends on size/condition):",
          "• Initial/Deep: commonly $300–$450 for typical homes.",
          "• Standard (recurring): often $170–$360 depending on sq ft and frequency.",
          `${intakeLink} for a tailored estimate first, or ${bookLink} to see live availability.`,
          hrsNote
        ],
        services: [
          "Cleaning services:",
          "• Initial / Deep • Standard (weekly/biweekly/monthly) • Move-In/Move-Out • Airbnb Turnovers",
          "Add-ons by request: oven, fridge, windows, baseboards, laundry.",
          `Want a personalized estimate? ${intakeLink}.`
        ],
        recommend: [
          "<strong>Help choosing:</strong>",
          "• Standard Clean size
