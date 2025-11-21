"use strict";

/* ---------- Config ---------- */
const BOOKING_SECTION_HASH = "#book";
const FORMSPREE_ENDPOINT   = "https://formspree.io/f/mzzaogbv";
const INTAKE_UNLOCK_KEY    = "ftt_intake_ok";
const INTAKE_HINT_KEY      = "ftt_booking_hint";

/* ---------- Small helpers ---------- */
const roundHalf = n => Math.round(n * 2) / 2;

function parseAddonsList(txt, priceMap){
  txt = (txt || "").toLowerCase();
  let total = 0;
  for (const k of Object.keys(priceMap)){
    if (txt.includes(k)) total += priceMap[k];
  }
  return total;
}
function parseAddonsHours(txt, hoursMap){
  txt = (txt || "").toLowerCase();
  let total = 0;
  for (const k of Object.keys(hoursMap)){
    if (txt.includes(k)) total += hoursMap[k];
  }
  return total;
}
function ensureScheduleButton(estElId, url, buttonId, label="Book Now"){
  const estEl = document.getElementById(estElId);
  if (!estEl) return;
  let btn = document.getElementById(buttonId);
  if (!btn){
    btn = document.createElement("a");
    btn.id = buttonId;
    btn.className = "btn btn-solid";
    btn.style.marginTop = "10px";
    btn.textContent = label;
    estEl.parentNode.insertBefore(btn, estEl.nextSibling);
  }
  btn.href = url || BOOKING_SECTION_HASH;
  btn.removeAttribute("target");
  btn.removeAttribute("rel");
}

/* ---------- Booking lock + hint helpers ---------- */
function saveBookingUnlock(hintText){
  try{
    localStorage.setItem(INTAKE_UNLOCK_KEY, "1");
    if (hintText) localStorage.setItem(INTAKE_HINT_KEY, hintText);
  }catch(e){}
}
function isUnlocked(){
  try{ return localStorage.getItem(INTAKE_UNLOCK_KEY) === "1"; }catch(e){ return false; }
}
function readBookingHint(){
  try{ return localStorage.getItem(INTAKE_HINT_KEY) || ""; }catch(e){ return ""; }
}
function showBookingHelper(hint){
  const sec = document.querySelector('#book .container');
  if (!sec) return;
  const id = "booking-helper-note";
  if (document.getElementById(id)) return;

  const note = document.createElement("div");
  note.id = id;
  note.style.margin = "0 0 10px";
  note.style.padding = "10px 12px";
  note.style.border = "1px solid #e3d9ce";
  note.style.borderRadius = "10px";
  note.style.background = "#fffdfb";
  note.style.color = "#524a46";
  note.style.fontWeight = "700";
  note.textContent = hint || "You're all set to book. Pick the recommended option in the services list.";
  sec.insertBefore(note, sec.firstChild);
}

/* ---------- Post to Formspree (AJAX) ---------- */
async function postToFormspree(formEl, extraFields = {}, statusElId, successMessage){
  try{
    const fd = new FormData(formEl);
    fd.append("_subject", "New Intake — The Finishing Touch");
    fd.append("_page", location.pathname);
    Object.entries(extraFields).forEach(([k,v]) => fd.append(k, v));

    const res = await fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      body: fd,
      headers: { "Accept": "application/json" }
    });

    const ok = res.ok;
    const statusEl = statusElId ? document.getElementById(statusElId) : null;
    if (statusEl){
      statusEl.textContent = ok
        ? (successMessage || "Thanks! Your form was received. We’ll review it and follow up shortly.")
        : "We couldn’t save your form just now, but your info is still on-screen.";
    }
    return ok;
  }catch(err){
    console.error("Formspree error:", err);
    const statusEl = statusElId ? document.getElementById(statusElId) : null;
    if (statusEl) statusEl.textContent = "We couldn’t save your form just now. Please try again later.";
    return false;
  }
}

/* =========================================
   CLEANING — PRICING & TIME (per-sq-ft)
   ========================================= */

// Interpret sqft either as a typed number (“2300”) or old select range (“2000–3000”)
function normalizeSqft(value){
  const raw = (value || "").trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw); // plain number

  // Fallback: approximate midpoints for old dropdown ranges
  const ranges = {
    "<1000": 800,
    "1000–2000": 1500,
    "1000-2000": 1500,
    "2000–3000": 2500,
    "2000-3000": 2500,
    "3000–4000": 3500,
    "3000-4000": 3500,
    "4000+": 4200
  };
  return ranges[raw] || 1500;
}

// Main price calculator using your per-sq-ft rates
function calcCleaning(data) {
  const sqft = normalizeSqft(data.sqft);
  const service = (data.service || "").toLowerCase();
  const frequency = (data.frequency || "").toLowerCase();

  if (!sqft || sqft <= 0) return 0;

  // Base rates (you can tweak these anytime)
  let rate = 0.20; // default to initial-style if we somehow don't match anything

  // Standard recurring cleaning
  if (service.includes("standard")) {
    if (frequency.includes("weekly"))        rate = 0.14;
    else if (frequency.includes("biweekly")) rate = 0.16;
    else if (frequency.includes("monthly"))  rate = 0.18;
    else                                     rate = 0.20; // one-time standard → similar to initial
  }
  // Initial
  else if (service.includes("initial")) {
    rate = 0.20;
  }
  // Deep clean (use middle of 0.22–0.28)
  else if (service.includes("deep")) {
    rate = 0.24;
  }
  // Move-in / move-out (0.28–0.35)
  else if (service.includes("move")) {
    rate = 0.32;
  }
  // Airbnb turnover
  else if (service.includes("airbnb")) {
    rate = 0.25;
  }

  const est = sqft * rate;
  return Math.round(est);
}

// Time estimate + suggested cleaners
function estimateHoursCleaning(data){
  const sqft = normalizeSqft(data.sqft);
  const service = (data.service || "").toLowerCase();
  const beds = Number(data.beds || 0);
  const baths = Number(data.baths || 0);
  const stories = String(data.stories || "1");
  const addonsText = data.addons || "";

  if (!sqft || sqft <= 0){
    return { soloHours: 0, teamHours: 0, cleaners: 1 };
  }

  // Base solo speed: ~700 sq ft per hour for a detailed clean
  let solo = sqft / 700;

  // More beds/baths = more time
  solo += Math.max(0, beds - 3) * 0.25;
  solo += Math.max(0, baths - 2) * 0.40;

  // 2-story bump
  if (stories === "2") solo += 0.25;

  // Addons bumps (quick/rough)
  const addonBumps = {
    "oven": 0.5,
    "fridge": 0.5,
    "refrigerator": 0.5,
    "windows": 1.0,
    "window": 1.0,
    "baseboards": 1.0,
    "laundry": 0.75
  };
  const addonsLower = addonsText.toLowerCase();
  for (const key of Object.keys(addonBumps)){
    if (addonsLower.includes(key)) solo += addonBumps[key];
  }

  // Service intensity
  if (service.includes("initial")) solo *= 1.15;
  if (service.includes("deep"))    solo *= 1.35;
  if (service.includes("move"))    solo *= 1.6;
  if (service.includes("airbnb"))  solo *= 0.9; // usually lighter than full deep

  // Round solo to nearest 0.5
  solo = roundHalf(solo);

  // Suggest cleaners so nobody is there all day
  let cleaners = 1;
  if (solo > 4 && solo <= 7) cleaners = 2;
  else if (solo > 7 && solo <= 10) cleaners = 3;
  else if (solo > 10) cleaners = 4;

  const teamHours = cleaners > 0 ? roundHalf(solo / cleaners) : 0;

  return { soloHours: solo, teamHours, cleaners };
}

// Just a simple label — no dollars mentioned
function cleaningHint(data, teamHours){
  const service = data.service || "Cleaning";
  if (teamHours <= 2.5) return `${service} — Small (≈2–2.5 hr)`;
  if (teamHours <= 4)   return `${service} — Medium (≈3–4 hr)`;
  if (teamHours <= 6)   return `${service} — Large (≈4–6 hr)`;
  return `${service} — XL (6+ hr)`;
}

/* =========================================
   ORGANIZING — PRICING & TIME
   ========================================= */
const ORG_HOURLY=65, ORG_MIN_HOURS=3;
const hoursPerSpace = {"Light":1,"Moderate":2,"Heavy":3};
const addonPricesOrganizing = {"bins":25,"labels":20,"bins/labels":40};

function calcOrganizing(data){
  const spaces = Math.max(1, Number(data.spaces||1));
  const complexity = data.complexity || "Moderate";
  const team = Math.max(1, Number(data.team||1));
  const hoursEach = hoursPerSpace[complexity] || 2;
  const estHours = Math.max(ORG_MIN_HOURS, spaces * hoursEach);
  const labor = estHours * ORG_HOURLY * team;
  const addons = parseAddonsList(data.addons, addonPricesOrganizing);
  return Math.round(labor + addons);
}

function estimateHoursOrganizing(data){
  const area = data.org_area || "Closet";
  const size = data.org_size || "Medium";
  const baseMap = {
    "Closet":{Small:2,Medium:3,Large:4}, "Pantry":{Small:2,Medium:3,Large:4},
    "Kitchen":{Small:3,Medium:4.5,Large:6}, "Bedroom":{Small:2.5,Medium:3.5,Large:5},
    "Bathroom":{Small:1.5,Medium:2.5,Large:3.5}, "Garage":{Small:3,Medium:5,Large:7},
    "Laundry Room":{Small:2,Medium:3,Large:4}, "Office":{Small:2.5,Medium:4,Large:5.5},
    "Playroom":{Small:2.5,Medium:4,Large:5.5}, "Whole Home (multi-area)":{Small:6,Medium:8,Large:12}
  };
  let solo = (baseMap[area]?.[size] ?? 3.5);

  const clutter = data.org_clutter || "Moderate";
  if (clutter === "Light") solo *= 0.9;
  if (clutter === "Moderate") solo *= 1.0;
  if (clutter === "Heavy") solo *= 1.35;

  const decision = data.org_decision_speed || "Average";
  if (decision === "Fast") solo *= 0.9;
  if (decision === "Average") solo *= 1.0;
  if (decision === "Slow") solo *= 1.25;

  const volume = data.org_volume || "Medium";
  if (volume === "Medium") solo += 0.5;
  if (volume === "High") solo += 1.0;

  const containers = data.org_containers || "None";
  if (containers === "Some (up to 10)") solo += 0.5;
  if (containers === "Many (10+)") solo += 1.0;

  const access = data.org_access || "Easy (ground floor)";
  if (access === "Stairs") solo += 0.5;
  if (access === "Tight spaces / HOA constraints") solo += 0.75;

  const haul = data.org_haul || "None";
  if (haul === "1–3 bags/boxes") solo += 0.5;
  if (haul === "4–8 bags/boxes") solo += 1.0;
  if (haul === "Carload+") solo += 1.5;

  const teamCount = Math.max(1, Number(data.team || 2));
  solo = roundHalf(solo);
  const teamHours = roundHalf(solo / teamCount);
  return { soloHours: solo, teamHours };
}
function organizingHint(data, teamHours){
  const area = data.org_area || "Space";
  const size = data.org_size || "Medium";
  if (teamHours <= 2.5) return `${area} Organizing — Small (${size}, ≈2–2.5 hr)`;
  if (teamHours <= 4)   return `${area} Organizing — Medium (${size}, ≈3–4 hr)`;
  if (teamHours <= 6)   return `${area} Organizing — Large (${size}, ≈5–6 hr)`;
  return `${area} Organizing — XL (${size}, 6.5+ hr)`;
}

/* =========================================
   DECOR/STAGING — PRICING & TIME
   ========================================= */
const decorBase = {"Living Room":500,"Bedroom":400,"Dining Room":450,"Home Office":450};
const addonPricesDecor = {"moodboard":75,"sourcing":150,"shopping":150,"install":250,"install day":250,"window treatments":200,"art hanging":100};

function calcDecor(data){
  const room = data.room || "Living Room";
  const count = Math.max(1, Number(data.count||1));
  const base = (decorBase[room] ?? 450) * count;
  const addons = parseAddonsList(data.addons, addonPricesDecor);
  return Math.round(base + addons);
}

function estimateHoursDecor(data){
  const type = data.decor_type || "Interior Decorating (refresh)";
  const scope = data.decor_scope || "Light refresh (styling)";
  const room = data.decor_room || "Living Room";
  const count = Math.max(1, Number(data.count||1));

  const basePerRoom = {
    "Living Room":3, "Bedroom":2.5, "Dining Room":2.5, "Home Office":2.5,
    "Kitchen / Nook":2.5, "Entryway":1.5, "Multiple Rooms":3
  };
  let solo = (basePerRoom[room] ?? 2.5) * count;

  if (scope === "Refresh + small sourcing") solo *= 1.3;
  if (scope === "Full design (sourcing + install)") solo *= 1.8;

  if (type.includes("Staging — Occupied")) solo *= 1.2;
  if (type.includes("Staging — Vacant"))   solo *= 1.6;

  const furn = data.decor_furniture || "No";
  if (furn === "Yes — a few pieces") solo += 1.0;
  if (furn === "Yes — multiple pieces") solo += 2.0;

  const install = data.decor_install || "Light (art, textiles)";
  if (install === "Moderate (art + small furniture)") solo += 1.0;
  if (install === "Heavy (multiple furniture + window treatments)") solo += 2.0;

  const trips = Number(data.decor_shopping || 0);
  if (trips > 0) solo += trips * 1.0;

  const access = data.decor_access || "Easy";
  if (access === "Stairs / elevator") solo += 0.5;
  if (access === "HOA / tight timing") solo += 0.75;

  solo = roundHalf(solo);
  const teamHours = roundHalf(solo / 2);
  return { soloHours: solo, teamHours };
}
function decorHint(data, teamHours){
  const room = data.decor_room || data.room || "Room";
  const scope = data.decor_scope || "Refresh";
  if (teamHours <= 2.5) return `${room} — ${scope} (Small, ≈2–2.5 hr)`;
  if (teamHours <= 4)   return `${room} — ${scope} (Medium, ≈3–4 hr)`;
  if (teamHours <= 6)   return `${room} — ${scope} (Large, ≈5–6 hr)`;
  return `${room} — ${scope} (XL, 6.5+ hr)`;
}

/* =========================================
   HOLIDAY DECORATING — INDOOR ONLY (multi-holiday)
   ========================================= */
const HOLI_HOURLY = 85;
const HOLI_MIN_HOURS = 3;

// Per-tree hours based on tallest size + style/ribbon
function hoursForTrees(count, tallest, style, ribbon){
  const t = Math.max(0, Number(count)||0);
  if (!t) return 0;

  const map = {
    "≤6 ft":     { base: 1.5, addl: 1.2 },
    "7–8 ft":    { base: 2.7, addl: 1.9 },
    "9–10 ft":   { base: 3.6, addl: 2.5 },
    "11–12+ ft": { base: 4.6, addl: 3.1 }
  };
  const m = map[tallest] || map["7–8 ft"];

  let hours = m.base + Math.max(0, t - 1) * m.addl;

  const s = String(style || "").toLowerCase();
  if (s.includes("full design")) hours += 1.4;
  else if (s.includes("refresh")) hours += 0.6;

  if (String(ribbon || "No") === "Yes") hours += 0.4 * t;

  return hours;
}

// Compute install hours with holiday-specific multipliers
function estimateHoursHoliday(data){
  const holiday = String(data.holiday || "christmas").toLowerCase();

  const trees    = Number(data.trees || 0);
  const tallest  = data.tallest || "7–8 ft";
  const style    = data.tree_style || "Ready: ornaments & lights on hand";
  const ribbon   = data.tree_ribbon || "No";

  const wreaths  = Math.max(0, Number(data.wreaths || 0));
  const garland  = Math.max(0, Number(data.garland_sections || 0));
  const stairs   = Math.max(0, Number(data.stair_sections || 0));
  const mantle   = String(data.mantle || "No") === "Yes";
  const tables   = Math.max(0, Number(data.tablescapes || 0));

  const storage  = String(data.storage || "Garage/closet (easy)");
  const tripsStr = String(data.shopping_trips || "0");
  const trips    = (tripsStr === "3+") ? 3 : Math.max(0, Number(tripsStr || 0));

  const teardownWanted = String(data.teardown || "No") === "Yes";

  const PER_WREATH      = 0.30;
  const PER_GARLAND     = 0.50;
  const PER_STAIRS      = 0.75;
  const PER_MANTLE      = 0.60;
  const PER_TABLESCAPE  = 0.40;

  let holMult = 1.0;
  let wreathMult = 1.0, garlandMult = 1.0, tablesMult = 1.0, mantleMult = 1.0, stairsMult = 1.0;

  switch (holiday) {
    case "halloween":
      holMult = 1.05; wreathMult = 1.10; garlandMult = 1.10; tablesMult = 1.10; mantleMult = 1.15; stairsMult = 1.05;
      break;
    case "thanksgiving":
      tablesMult = 1.20; mantleMult = 1.05;
      break;
    case "valentines":
    case "galentines":
      tablesMult = 1.15; mantleMult = 1.05; garlandMult = 0.95;
      break;
    case "july4":
    case "4th of july":
      wreathMult = 0.95; tablesMult = 1.05;
      break;
    case "easter":
      tablesMult = 1.15; wreathMult = 1.05; garlandMult = 1.05;
      break;
    case "other":
      holMult = 1.05;
      break;
    default:
      break;
  }

  let solo = 0;
  solo += hoursForTrees(trees, tallest, style, ribbon);

  solo += wreaths * PER_WREATH * wreathMult;
  solo += garland * PER_GARLAND * garlandMult;
  solo += stairs  * PER_STAIRS  * stairsMult;
  if (mantle) solo += PER_MANTLE * mantleMult;
  solo += tables * PER_TABLESCAPE * tablesMult;

  if (/attic/i.test(storage))         solo += 0.5;
  else if (/offsite/i.test(storage))  solo += 1.0;

  solo += trips * 1.0;

  solo *= holMult;

  const roundQ = x => Math.max(0, Math.round(x * 4) / 4);
  solo = roundQ(Math.max(HOLI_MIN_HOURS, solo + 0.5));

  const teamHours = roundQ(solo / 2);

  const teardownHours = teardownWanted ? roundQ(Math.max(1, solo * 0.6)) : 0;

  return { soloHours: solo, teamHours, teardownHours };
}

function calcHoliday(data){
  const { soloHours, teamHours, teardownHours } = estimateHoursHoliday(data);
  const price         = Math.round(HOLI_HOURLY * soloHours);
  const teardownPrice = teardownHours ? Math.round(HOLI_HOURLY * teardownHours) : 0;
  return { price, soloHours, teamHours, teardownHours, teardownPrice };
}

function holidayHint(data, teamHours){
  const hRaw = String(data.holiday || "Christmas");
  const h = hRaw.charAt(0).toUpperCase() + hRaw.slice(1);
  if (teamHours <= 2.5) return `${h} — Small (≈2–2.5 hr)`;
  if (teamHours <= 4)   return `${h} — Medium (≈3–4 hr)`;
  if (teamHours <= 6)   return `${h} — Large (≈5–6 hr)`;
  return `${h} — XL (6.5+ hr)`;
}

/* ==========================================================
   WIRE EVERYTHING AFTER DOM PARSE
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
  try {
    document.querySelectorAll('a[href*="book.squareup.com/appointments"]').forEach(a => {
      a.setAttribute('href', BOOKING_SECTION_HASH);
      a.removeAttribute('target'); a.removeAttribute('rel');
    });
  } catch (e) { console.warn(e); }

  const bookingSec = document.querySelector('.booking-embed[data-locked]');
  if (bookingSec && isUnlocked()){
    bookingSec.removeAttribute('data-locked');
    const hint = readBookingHint();
    if (hint) showBookingHelper(`Recommended: ${hint}`);
  }

  const scrollToBook = () => {
    const el = document.getElementById('book');
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  };
  if (location.hash === BOOKING_SECTION_HASH){ scrollToBook(); setTimeout(scrollToBook, 400); }

  const dd  = document.getElementById('quoteDropdownHero');
  const btn = document.getElementById('quoteBtnHero');
  const menu= document.getElementById('quoteMenuHero');
  if (dd && btn && menu){
    const toggle = (open) => {
      dd.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-hidden', String(!open));
    };
    btn.addEventListener('click', (e)=>{ e.preventDefault(); toggle(!dd.classList.contains('open')); });
    document.addEventListener('click', (e)=>{ if (!dd.contains(e.target)) toggle(false); });
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') toggle(false); });
  }

  /* CLEANING intake */
  try {
    const form = document.getElementById('intakeFormCleaning');
    if (form){
      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());

        const price = calcCleaning(data);
        const { soloHours, teamHours, cleaners } = estimateHoursCleaning(data);
        const hint = cleaningHint(data, teamHours);

        // 70/30 split, then 70/30 of the 70% again
        const total = price || 0;
        const poolLabourAdmin   = total * 0.70;
        const poolBusinessBase  = total * 0.30;
        const poolCleaners      = poolLabourAdmin * 0.70;    // 49% of total
        const poolRichelleAdmin = poolLabourAdmin * 0.30;    // 21% of total

        const perCleaner = cleaners > 0 ? poolCleaners / cleaners : 0;

        // Save unlock hint for booking page (no dollar amounts shown to client)
        if (hint) saveBookingUnlock(hint);

        await postToFormspree(
          form,
          {
            service_type: "Cleaning",
            estimate_price: price ? `$${price}` : "",
            estimate_hint: hint,
            est_solo_hours: soloHours ? String(soloHours) : "",
            est_team_hours: teamHours ? String(teamHours) : "",
            est_cleaners_recommended: cleaners ? String(cleaners) : "",
            pay_total: total ? `$${Math.round(total)}` : "",
            pay_business_base_30: total ? `$${Math.round(poolBusinessBase)}` : "",
            pay_cleaners_pool_49: total ? `$${Math.round(poolCleaners)}` : "",
            pay_per_cleaner: total && cleaners ? `$${Math.round(perCleaner)}` : "",
            pay_admin_richelle_21: total ? `$${Math.round(poolRichelleAdmin)}` : ""
          },
          "formspreeStatusCleaning",
          "Thank you! Your intake was received. We’ll review everything and follow up with a ballpark quote and next steps."
        );

        try { form.reset(); } catch(e){}
      });
    }
  } catch (err){ console.error("Cleaning handler error:", err); }

  /* ORGANIZING intake */
  try {
    const form = document.getElementById('intakeFormOrganizing');
    if (form){
      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        const estPrice = calcOrganizing(data);
        const { teamHours } = estimateHoursOrganizing(data);
        const hint = organizingHint(data, teamHours);

        const estEl = document.getElementById('estimateOrganizing');
        if (estEl) estEl.innerHTML = `Ballpark Estimate: <strong>$${estPrice}</strong><br><span class="hint">${hint}</span>`;
        ensureScheduleButton('estimateOrganizing', BOOKING_SECTION_HASH, 'goBookOrganizing');

        saveBookingUnlock(hint);

        await postToFormspree(
          form,
          {
            service_type: "Organizing",
            estimate_price: `$${estPrice}`,
            estimate_hint: hint
          },
          "emailStatusOrganizing"
        );
      });
    }
  } catch (err){ console.error("Organizing handler error:", err); }

  /* DECOR/STAGING intake */
  try {
    const form = document.getElementById('intakeFormDecor');
    if (form){
      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        const price = calcDecor(data);
        const { teamHours } = estimateHoursDecor(data);
        const hint = decorHint(data, teamHours);

        const estEl = document.getElementById('estimateDecor');
        if (estEl) estEl.innerHTML = `Ballpark Estimate: <strong>$${price}</strong><br><span class="hint">${hint}</span>`;
        ensureScheduleButton('estimateDecor', BOOKING_SECTION_HASH, 'goBookDecor');

        saveBookingUnlock(hint);

        await postToFormspree(
          form,
          {
            service_type: "Interior Decorating",
            estimate_price: `$${price}`,
            estimate_hint: hint
          },
          "emailStatusDecor"
        );
      });
    }
  } catch (err){ console.error("Decor handler error:", err); }

  /* HOLIDAY (INDOOR) intake */
  try {
    const form = document.getElementById('intakeFormHoliday');
    if (form){
      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        const { price, soloHours, teamHours, teardownHours, teardownPrice } = calcHoliday(data);
        const hint = holidayHint(data, teamHours);

        const estEl = document.getElementById('estimateHoliday');
        if (estEl){
          const lines = [
            `Install (ballpark): <strong>$${price}</strong>`,
            `Estimated time: ${soloHours} solo hrs (~${teamHours} hrs with 2 stylists)`,
          ];
          if (teardownHours){
            lines.push(`Teardown (optional): ~${teardownHours} hrs • approx <strong>$${teardownPrice}</strong>`);
          }
          lines.push(`<span class="hint">${hint}</span>`);
          estEl.innerHTML = lines.join("<br>");
        }

        ensureScheduleButton('estimateHoliday', BOOKING_SECTION_HASH, 'goBookHoliday');

        saveBookingUnlock(hint);

        await postToFormspree(
          form,
          {
            service_type: "Holiday Decorating (indoor)",
            estimate_price: `$${price}`,
            estimate_hint: hint,
            estimate_hours: `${soloHours} solo (~${teamHours} with team)`,
            teardown_price: teardownHours ? `$${teardownPrice}` : "n/a"
          },
          "emailStatusHoliday"
        );
      });
    }
  } catch (err){ console.error("Holiday handler error:", err); }

  /* CONTACT form */
  try {
    const contactForm = document.getElementById('contactForm');
    if (contactForm){
      contactForm.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const ok = await postToFormspree(
          contactForm,
          { service_type: "Contact" },
          "contactStatus",
          "Thank you for reaching out! We’ll respond as soon as we can."
        );
        if (ok) contactForm.reset();
      });
    }
  } catch (err){ console.error("Contact handler error:", err); }
});

/* AUTH FORMS: Login + Signup (placeholder) */
try {
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(loginForm).entries());
      console.log("Login attempt:", data);
      alert("Login form submitted! (Check console for values)");
    });
  }

  const signupForm = document.getElementById("signupForm");
  if (signupForm) {
    signupForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(signupForm).entries());
      console.log("Signup attempt:", data);
      alert("Signup form submitted! (Check console for values)");
    });
  }
} catch (err) {
  console.error("Auth handler error:", err);
}


