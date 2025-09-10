/* =========================================
   The Finishing Touch — script.js (DROP-IN)
   Intake → Quote → Book (embedded calendar)
   ========================================= */
"use strict";

/* ---------- Config ---------- */
const BOOKING_SECTION_HASH = "#book";
const FORMSPREE_ENDPOINT   = "https://formspree.io/f/mzzaogbv"; // ← your Formspree form ID
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
async function postToFormspree(formEl, extraFields = {}, statusElId){
  try{
    const fd = new FormData(formEl);
    // add a little metadata
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
      statusEl.textContent = ok ? "Saved. Check your email for confirmation." : "We couldn’t save your form just now, but your quote is above — please try submitting again later.";
    }
    return ok;
  }catch(err){
    console.error("Formspree error:", err);
    const statusEl = statusElId ? document.getElementById(statusElId) : null;
    if (statusEl) statusEl.textContent = "We couldn’t save your form just now. Your quote is above — please try again.";
    return false;
  }
}

/* =========================================
   CLEANING — PRICING & TIME
   ========================================= */
const initialBySqft  = {"<1000":250,"1000–2000":300,"2000–3000":375,"3000–4000":450,"4000+":520};
const standardBySqft = {"<1000":170,"1000–2000":200,"2000–3000":250,"3000–4000":300,"4000+":360};

const serviceMult = {
  "Initial Clean": 1.00,
  "Deep Clean": 1.20,
  "Move-In / Move-Out Clean": 1.35,
  "Airbnb Turnover": 0.55
};
const freqDisc = { "weekly":0.85, "biweekly":0.90, "monthly":0.95, "one-time":1 };
const perExtraBathroom = 20, perExtraBedroom=12, perOtherRoom=10, twoStoryFee=20, petFee=12;

const addonPricesCleaning = {
  "oven":35,"fridge":30,"refrigerator":30,
  "windows":80,"window":80,"baseboards":60,"laundry":18
};
const addonHoursCleaning = {
  "oven":0.25, "fridge":0.25, "refrigerator":0.25,
  "windows":1.5, "window":1.5, "baseboards":1.0, "laundry":0.5
};

function airbnbByBedrooms(beds){
  const b = Number(beds) || 0;
  if (b <= 1) return 120;
  if (b === 2) return 140;
  if (b === 3) return 160;
  if (b === 4) return 180;
  return 200;
}

function calcCleaning(data){
  const sqft = data.sqft || "1000–2000";
  const service = data.service || "Initial Clean";
  const frequency = data.frequency || "one-time";
  const beds = Number(data.beds||0);
  const baths = Number(data.baths||0);
  const otherRooms = Number(data.other_rooms||0);
  const stories = String(data.stories||"1");
  const pets = String(data.pets||"");

  let base = 0;
  if (service === "Standard Clean"){
    base = standardBySqft[sqft] ?? 200;
  } else if (service === "Airbnb Turnover"){
    base = airbnbByBedrooms(beds);
  } else {
    const initial = initialBySqft[sqft] ?? 300;
    base = initial * (serviceMult[service] ?? 1);
  }

  const extraBaths = Math.max(0, baths-2) * perExtraBathroom;
  const extraBeds  = Math.max(0, beds-3) * perExtraBedroom;
  const extraRooms = Math.max(0, otherRooms) * perOtherRoom;
  const storyFee   = (stories === "2") ? twoStoryFee : 0;
  const petsFee    = pets.trim() ? petFee : 0;
  const addonsFee  = parseAddonsList(data.addons, addonPricesCleaning);

  let est = base + extraBaths + extraBeds + extraRooms + storyFee + petsFee + addonsFee;
  if (service === "Standard Clean"){ est *= (freqDisc[frequency] || 1); }
  return Math.round(est);
}

function estimateHoursCleaning(data){
  const sqft = data.sqft || "1000–2000";
  const service = data.service || "Initial Clean";
  const beds = Number(data.beds||0);
  const baths = Number(data.baths||0);
  const otherRooms = Number(data.other_rooms||0);
  const stories = String(data.stories||"1");

  let solo = 2;
  if (sqft === "<1000") solo = 2;
  else if (sqft === "1000–2000") solo = 3;
  else if (sqft === "2000–3000") solo = 4;
  else if (sqft === "3000–4000") solo = 5;
  else solo = 6;

  if (service === "Airbnb Turnover"){
    if (beds <= 1) solo = 2;
    else if (beds === 2) solo = 2.5;
    else if (beds === 3) solo = 3;
    else if (beds === 4) solo = 3.5;
    else solo = 4;
  }

  solo += Math.max(0, beds - 3)  * 0.5;
  solo += Math.max(0, baths - 2) * 0.75;
  solo += Math.max(0, otherRooms) * 0.25;
  if (stories === "2") solo += 0.25;
  solo += parseAddonsHours(data.addons, addonHoursCleaning);

  if (service === "Deep Clean") solo *= 1.5;
  if (service === "Move-In / Move-Out Clean") solo *= 2;
  if (service === "Initial Clean") solo *= 1.2;

  solo = roundHalf(solo);
  const team = roundHalf(solo / 2);
  return { soloHours: solo, teamHours: team };
}

function cleaningHint(data, teamHours){
  const service = data.service || "Initial Clean";
  const sqft = data.sqft || "1000–2000";

  const sqftLabel = {
    "<1000":"Small (≤1,000 sq ft)",
    "1000–2000":"Medium (1,000–2,000 sq ft)",
    "2000–3000":"Large (2,000–3,000 sq ft)",
    "3000–4000":"XL (3,000–4,000 sq ft)",
    "4000+":"Estate (4,000+ sq ft)"
  }[sqft] || "Sized by intake";

  if (service === "Standard Clean"){
    return `Standard Clean — ${sqftLabel}`;
  }
  if (service === "Airbnb Turnover"){
    if (teamHours <= 2.5) return "Airbnb Turnover — Quick (≈2 hr)";
    if (teamHours <= 3.5) return "Airbnb Turnover — Standard (≈3 hr)";
    if (teamHours <= 5)   return "Airbnb Turnover — Extended (≈4 hr)";
    return "Airbnb Turnover — Extended XL (4.5+ hr)";
  }
  if (teamHours <= 2.5) return `${service} — Small (≈2–2.5 hr)`;
  if (teamHours <= 3.5) return `${service} — Medium (≈3–3.5 hr)`;
  if (teamHours <= 5)   return `${service} — Large (≈4–5 hr)`;
  return `${service} — XL (5.5+ hr)`;
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

/* =========================================
   HOLIDAY DECORATING — INDOOR ONLY
   ========================================= */
}
const HOLI_HOURLY = 85;
const HOLI_MIN_HOURS = 3;

function hoursForTrees(count, tallest, style, ribbon){
  const t = Number(count)||0; if(!t) return 0;
  const map = {
    "≤6 ft":   {base:1.5, addl:1.2},
    "7–8 ft":  {base:2.5, addl:1.8},
    "9–10 ft": {base:3.5, addl:2.5},
    "11–12+ ft": {base:4.5, addl:3.0}
  };
  const m = map[tallest] || map["7–8 ft"];
  let h = m.base + Math.max(0,t-1)*m.addl;
  const styleFactor = style==="Full design + sourcing" ? 1.6
                    : style==="Needs ribbon/theme refresh" ? 1.25 : 1.0;
  h *= styleFactor;
  if ((ribbon||"").toLowerCase()==="yes") h += 0.4 * t;
  return h;
}

function estimateHoursHoliday(data){
  // Indoor only
  let hrs = 0;

  // Trees
  hrs += hoursForTrees(
    Number(data.trees||0),
    data.tallest || "7–8 ft",
    data.tree_style || "Ready: ornaments & lights on hand",
    data.tree_ribbon || "No"
  );

  // Interior decor elements
  hrs += (Number(data.wreaths||0) * 0.4);
  hrs += (Number(data.garland_sections||0) * 0.6);
  hrs += (Number(data.stair_sections||0) * 0.7);
  if ((data.mantle||"No")==="Yes") hrs += 0.8;
  hrs += (Number(data.tablescapes||0) * 0.4);

  // Logistics
  const storage = data.storage || "Garage/closet (easy)";
  if (storage === "Attic (ladder)") hrs += 0.5;
  if (storage === "Offsite pickup") hrs += 1.0;

  // Shopping trips
  const trips = (data.shopping_trips||"0")==="3+" ? 3 : Number(data.shopping_trips||0);
  hrs += trips * 1.0;

  // Baseline overhead & minimum
  hrs = Math.max(HOLI_MIN_HOURS, roundHalf(hrs + 0.5));

  // Suggest schedule time if 2-person crew (for internal plan)
  const teamHours = roundHalf(hrs / 2);

  // Teardown ~60% of install hours
  const teardownHours = (data.teardown||"Yes")==="Yes" ? roundHalf(hrs * 0.6) : 0;

  return { soloHours: hrs, teamHours, teardownHours };
}

function calcHoliday(data){
  const { soloHours, teamHours, teardownHours } = estimateHoursHoliday(data);
  const priceInstall = Math.round(HOLI_HOURLY * soloHours);
  const priceTeardown = teardownHours ? Math.round(HOLI_HOURLY * teardownHours) : 0;
  return { price: priceInstall, soloHours, teamHours, teardownHours, teardownPrice: priceTeardown };
}

function holidayHint(data, teamHours){
  // simple guidance line
  if (teamHours <= 2.5) return `Holiday (indoor) — Small (≈2–2.5 hr)`;
  if (teamHours <= 4)   return `Holiday (indoor) — Medium (≈3–4 hr)`;
  if (teamHours <= 6)   return `Holiday (indoor) — Large (≈5–6 hr)`;
  return `Holiday (indoor) — XL (6.5+ hr)`;
}

/* ==========================================================
   WIRE EVERYTHING AFTER DOM PARSE
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
  /* Force any external Square links to keep you on-page */
  try {
    document.querySelectorAll('a[href*="book.squareup.com/appointments"]').forEach(a => {
      a.setAttribute('href', BOOKING_SECTION_HASH);
      a.removeAttribute('target'); a.removeAttribute('rel');
    });
  } catch (e) { console.warn(e); }

  /* Unlock message on homepage if already completed an intake */
  const bookingSec = document.querySelector('.booking-embed[data-locked]');
  if (bookingSec && isUnlocked()){
    bookingSec.removeAttribute('data-locked');
    const hint = readBookingHint();
    if (hint) showBookingHelper(`Recommended: ${hint}`);
  }

  /* Smooth scroll to #book if hash present (also re-run after Square loads) */
  const scrollToBook = () => {
    const el = document.getElementById('book');
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  };
  if (location.hash === BOOKING_SECTION_HASH){ scrollToBook(); setTimeout(scrollToBook, 400); }

  /* Hero dropdown (homepage) */
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

  /* ===== INTAKE FORMS — show estimate, save to Formspree, unlock booking, show Book button ===== */

  /* CLEANING intake */
  try {
    const form = document.getElementById('intakeFormCleaning');
    if (form){
      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        const price = calcCleaning(data);
        const { teamHours } = estimateHoursCleaning(data);
        const hint = cleaningHint(data, teamHours);

        // Show estimate + booking button
        const estEl = document.getElementById('estimateCleaning');
        if (estEl) estEl.innerHTML = `Ballpark Estimate: <strong>$${price}</strong><br><span class="hint">${hint}</span>`;
        ensureScheduleButton('estimateCleaning', BOOKING_SECTION_HASH, 'goBookCleaning');

        // Unlock booking + remember hint
        saveBookingUnlock(hint);

        // Post to Formspree (background)
        await postToFormspree(form, {
          service_type: "Cleaning",
          estimate_price: `$${price}`,
          estimate_hint: hint
        }, "emailStatusCleaning");
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

        await postToFormspree(form, {
          service_type: "Organizing",
          estimate_price: `$${estPrice}`,
          estimate_hint: hint
        }, "emailStatusOrganizing");
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

        await postToFormspree(form, {
          service_type: "Interior Decorating",
          estimate_price: `$${price}`,
          estimate_hint: hint
        }, "emailStatusDecor");
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
        const lines = [
          `Install (ballpark): <strong>$${price}</strong>`,
          `Estimated time: ${soloHours} solo hrs (~${teamHours} hrs with 2 stylists)`,
        ];
        if (teardownHours){
          lines.push(`Teardown (optional): ~${teardownHours} hrs • approx <strong>$${teardownPrice}</strong>`);
        }
        lines.push(`<span class="hint">${hint}</span>`);
        if (estEl) estEl.innerHTML = lines.join("<br>");

        ensureScheduleButton('estimateHoliday', BOOKING_SECTION_HASH, 'goBookHoliday');

        saveBookingUnlock(hint);

        await postToFormspree(form, {
          service_type: "Holiday Decorating (indoor)",
          estimate_price: `$${price}`,
          estimate_hint: hint,
          estimate_hours: `${soloHours} solo (~${teamHours} with team)`,
          teardown_price: teardownHours ? `$${teardownPrice}` : "n/a",
        }, "emailStatusHoliday");
      });
    }
  } catch (err){ console.error("Holiday handler error:", err); }

  /* CONTACT form (homepage/contact page) */
  try {
    const contactForm = document.getElementById('contactForm');
    if (contactForm){
      contactForm.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const ok = await postToFormspree(contactForm, { service_type: "Contact" }, "contactStatus");
        if (ok) contactForm.reset();
      });
    }
  } catch (err){ console.error("Contact handler error:", err); }
});
