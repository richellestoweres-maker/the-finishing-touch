/* =========================================
   The Finishing Touch — script.js (DROP-IN)
   ========================================= */
"use strict";

const BOOKING_SECTION_HASH = "#book";


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
function ensureScheduleButton(estElId, url, buttonId){
  const estEl = document.getElementById(estElId);
  if (!estEl) return;
  let btn = document.getElementById(buttonId);
  if (!btn){
    btn = document.createElement("a");
    btn.id = buttonId;
    btn.className = "btn btn-solid";
    btn.style.marginTop = "10px";
    btn.textContent = "Schedule on Square";
    estEl.parentNode.insertBefore(btn, estEl.nextSibling);
  }
  btn.href = url;
  btn.target = "_blank";
  btn.rel = "noopener";
}

/* =================================================
   CLEANING — COMPETITIVE PRICING
   ================================================= */
const initialBySqft = {"<1000":250,"1000–2000":300,"2000–3000":375,"3000–4000":450,"4000+":520};
const standardBySqft = {"<1000":170,"1000–2000":200,"2000–3000":250,"3000–4000":300,"4000+":360};

const serviceMult = {
  "Initial Clean": 1.00,
  "Deep Clean": 1.20,
  "Move-In / Move-Out Clean": 1.35,
  "Airbnb Turnover": 0.55
};
const freqDisc = {"weekly":0.85,"biweekly":0.90,"monthly":0.95,"one-time":1};
const perExtraBathroom = 20, perExtraBedroom=12, perOtherRoom=10, twoStoryFee=20, petFee=12;

const addonPricesCleaning = {
  "oven":35,"fridge":30,"refrigerator":30,
  "windows":80,"window":80,"baseboards":60,"laundry":18
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
  const storyFee   = stories === "2" ? twoStoryFee : 0;
  const petsFee    = pets.trim() ? petFee : 0;
  const addonsFee  = parseAddonsList(data.addons, addonPricesCleaning);

  let est = base + extraBaths + extraBeds + extraRooms + storyFee + petsFee + addonsFee;
  if (service === "Standard Clean"){ est *= (freqDisc[frequency] || 1); }
  return Math.round(est);
}

const SQUARE_CLEAN_SMALL  = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/B7HOTUU7R3PZTXU3KDWVTUGN";
const SQUARE_CLEAN_MEDIUM = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/7DCTTLC4L6RT5ITF2NXHC2UJ";
const SQUARE_CLEAN_LARGE  = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/54JN4EKJXG6FU5G7PWWNHSAV"; // ✅ fixed
const SQUARE_CLEAN_XL     = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/TJ25PH72FBCZ246QF27JR2RK";



const addonHoursCleaning = {
  "oven":0.25, "fridge":0.25, "refrigerator":0.25,
  "windows":1.5, "window":1.5, "baseboards":1.0, "laundry":0.5
};

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
function squareUrlForCleaning(teamHours){
  if (teamHours <= 2.5) return SQUARE_CLEAN_SMALL;
  if (teamHours <= 3.5) return SQUARE_CLEAN_MEDIUM;
  if (teamHours <= 5)   return SQUARE_CLEAN_LARGE;
  return SQUARE_CLEAN_XL;
}

/* ======================================
   ORGANIZING — COMPETITIVE PRICING
   ====================================== */
const ORG_HOURLY=65, ORG_MIN_HOURS=3;
const hoursPerSpace = {"Light":1,"Moderate":2,"Heavy":3};
const addonPricesOrganizing = {"bins":25,"labels":20,"bins/labels":40};


function calcOrganizing(data){
  const spaces = Math.max(1, Number(data.spaces||1));
  const complexity = data.complexity || "Moderate";
  const team = Math.max(1, Number(data.team||1));
  const hoursEach = hoursPerSpace[complexity] || 2;
  let estHours = Math.max(ORG_MIN_HOURS, spaces * hoursEach);
  const labor = estHours * ORG_HOURLY * team;
  const addons = parseAddonsList(data.addons, addonPricesOrganizing);
  return Math.round(labor + addons);
}

/* ======================================
   ORGANIZING — TIME & SQUARE ROUTING
   ====================================== */
const SQUARE_ORG_SMALL  = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/BD7XIHWD3YSDVE76FLUC6TN";
const SQUARE_ORG_MEDIUM = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/BMQXJT324IV7SABC3N7N434E";
const SQUARE_ORG_LARGE  = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/GCZWD4QHC4EOKWZYYUBOMENC";
const SQUARE_ORG_XL     = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/35VRE245LJFHS7UADNOABFSS";

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
function squareUrlForOrganizing(teamHours){
  if (teamHours <= 2.5) return SQUARE_ORG_SMALL;
  if (teamHours <= 4)   return SQUARE_ORG_MEDIUM;
  if (teamHours <= 6)   return SQUARE_ORG_LARGE;
  return SQUARE_ORG_XL;
}

/* ======================================
   DECOR/STAGING — COMPETITIVE PRICING
   ====================================== */
const decorBase = {"Living Room":500,"Bedroom":400,"Dining Room":450,"Home Office":450};
const addonPricesDecor = {"moodboard":75,"sourcing":150,"shopping":150,"install":250,"install day":250,"window treatments":200,"art hanging":100};

function calcDecor(data){
  const room = data.room || "Living Room";
  const count = Math.max(1, Number(data.count||1));
  const base = (decorBase[room] ?? 450) * count;
  const addons = parseAddonsList(data.addons, addonPricesDecor);
  return Math.round(base + addons);
}

/* ======================================
   DECOR/STAGING — TIME & SQUARE ROUTING
   ====================================== */
const SQUARE_DECOR_SMALL  = "https://book.squareup.com/appointments/...";
const SQUARE_DECOR_MEDIUM = "https://book.squareup.com/appointments/...";
const SQUARE_DECOR_LARGE  = "https://book.squareup.com/appointments/...";
const SQUARE_DECOR_XL     = "https://book.squareup.com/appointments/...";

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
function squareUrlForDecor(teamHours){
  if (teamHours <= 2.5) return SQUARE_DECOR_SMALL;
  if (teamHours <= 4)   return SQUARE_DECOR_MEDIUM;
  if (teamHours <= 6)   return SQUARE_DECOR_LARGE;
  return SQUARE_DECOR_XL;
}

/* ======================================
   Optional: EmailJS helper
   ====================================== */
function sendEstimateEmail(serviceId, templateId, vars, statusEl){
  if (!window.emailjs) return;
  emailjs.send(serviceId, templateId, vars)
    .then(()=> { if (statusEl) statusEl.textContent = "Your estimate has been emailed. Check your inbox!"; })
    .catch(err => { console.error(err); if (statusEl) statusEl.textContent = "Estimate shown above. Email failed."; });
}

/* ==========================================================
   WIRE EVERYTHING AFTER DOM PARSE
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
  /* Hero dropdown */
     /* --- Safety net: force any “Book Now” links to use the embedded calendar --- */
  try {
    document.querySelectorAll('a[href*="book.squareup.com/appointments"]').forEach(a => {
      a.setAttribute('href', BOOKING_SECTION_HASH); // "#book"
      a.removeAttribute('target'); // keep them on your page
      a.removeAttribute('rel');
    });
  } catch (e) { console.warn(e); }

  /* --- Reliable scroll to #book (works when navigating from other pages) --- */
  const scrollToBook = () => {
    const el = document.getElementById('book');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (location.hash === BOOKING_SECTION_HASH) {
    // Scroll once on load, and again shortly after to account for the Square iframe inject
    scrollToBook();
    setTimeout(scrollToBook, 400);
  }

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

 /* CLEANING form */
try {
  const formCleaning = document.getElementById('intakeFormCleaning');
  if (formCleaning){
    formCleaning.addEventListener('submit', (e)=>{
      e.preventDefault();
      const data = Object.fromEntries(new FormData(formCleaning).entries());

      // Optional: still show estimate once before redirect
      const price = calcCleaning(data);
      const estEl = document.getElementById('estimateCleaning');
      if (estEl) estEl.innerHTML = `Ballpark Estimate: <strong>$${price}</strong>`;

      const { teamHours } = estimateHoursCleaning(data);
      const squareUrl = squareUrlForCleaning(teamHours);

      // 🔒 Safety: ensure it’s a direct /services/ link so Square shows only calendar
      if (!/\/services\//.test(squareUrl)) {
        console.warn("Square URL is not a direct service link. Calendar-only may fail:", squareUrl);
      }

      // Optional: keep a fallback button visible
      ensureScheduleButton('estimateCleaning', squareUrl, 'scheduleOnSquareCleaning');

      // 🚀 AUTO-REDIRECT straight to calendar (your requested flow)
      window.location.href = squareUrl;
    });
  }
} catch (err){ console.error("Cleaning handler error:", err); }


 /* ORGANIZING form */
try {
  const formOrg = document.getElementById('intakeFormOrganizing');
  if (formOrg){
    formOrg.addEventListener('submit', (e)=>{
      e.preventDefault();
      const data = Object.fromEntries(new FormData(formOrg).entries());

      // Optional: show estimate once before redirect
      const estPrice = calcOrganizing(data);
      const estEl = document.getElementById('estimateOrganizing');
      if (estEl) estEl.innerHTML = `Ballpark Estimate: <strong>$${estPrice}</strong>`;

      const { teamHours } = estimateHoursOrganizing(data);
      const url = squareUrlForOrganizing(teamHours);

      // Safety: ensure it's a direct service link (calendar-only UX)
      if (!/\/services\//.test(url)) {
        console.warn("Square URL is not a direct service link. Calendar-only may fail:", url);
      }

      // Optional fallback button (keep if you like)
      ensureScheduleButton('estimateOrganizing', url, 'scheduleOnSquareOrganizing');

      // 🚀 Auto-redirect straight to the calendar
      window.location.href = url;
    });
  }
} catch (err){ console.error("Organizing handler error:", err); }

 /* DECOR form */
try {
  const formDecor = document.getElementById('intakeFormDecor');
  if (formDecor){
    formDecor.addEventListener('submit', (e)=>{
      e.preventDefault();
      const data = Object.fromEntries(new FormData(formDecor).entries());

      // Optional: show estimate once before redirect
      const price = calcDecor(data);
      const estEl = document.getElementById('estimateDecor');
      if (estEl) estEl.innerHTML = `Ballpark Estimate: <strong>$${price}</strong>`;

      const { teamHours } = estimateHoursDecor(data);
      const url = squareUrlForDecor(teamHours);

      // Safety: ensure it's a direct service link (calendar-only UX)
      if (!/\/services\//.test(url)) {
        console.warn("Square URL is not a direct service link. Calendar-only may fail:", url);
      }

      // Optional fallback button (keep if you like)
      ensureScheduleButton('estimateDecor', url, 'scheduleOnSquareDecor');

      // 🚀 Auto-redirect straight to the calendar
      window.location.href = url;
    });
  }
} catch (err){ console.error("Decor handler error:", err); }

  /* CONTACT form (homepage) */
  try {
    const contactForm = document.getElementById('contactForm');
    if (contactForm){
      contactForm.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const payload = Object.fromEntries(new FormData(contactForm).entries());
        const status = document.getElementById('contactStatus');
        if (!window.emailjs){
          if (status) status.textContent = "Thanks! We’ll be in touch shortly.";
          contactForm.reset();
          return;
        }
        try{
          await emailjs.send("YOUR_SERVICE_ID","YOUR_TEMPLATE_ID_CONTACT",payload);
          if (status) status.textContent = "Thanks! We’ll be in touch shortly.";
          contactForm.reset();
        }catch(err){
          if (status) status.textContent = "Message not sent. Please try again.";
          console.error(err);
        }
      });
    }
  } catch (err){ console.error("Contact handler error:", err); }
});















