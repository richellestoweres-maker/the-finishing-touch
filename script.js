/* ============================
   CLEANING — COMPETITIVE PRICING
   ============================ */
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
function parseAddonsList(txt, priceMap){
  txt = (txt||"").toLowerCase(); let total = 0;
  for (const k of Object.keys(priceMap)){ if (txt.includes(k)) total += priceMap[k]; }
  return total;
}
function airbnbByBedrooms(beds){ const b=Number(beds)||0; if (b<=1) return 120; if (b===2) return 140; if (b===3) return 160; if (b===4) return 180; return 200; }

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

  const extraBaths = Math.max(0,baths-2)*perExtraBathroom;
  const extraBeds  = Math.max(0,beds-3)*perExtraBedroom;
  const extraRooms = Math.max(0,otherRooms)*perOtherRoom;
  const storyFee   = stories==="2" ? twoStoryFee : 0;
  const petsFee    = pets.trim()? petFee : 0;
  const addonsFee  = parseAddonsList(data.addons, addonPricesCleaning);

  let est = base + extraBaths + extraBeds + extraRooms + storyFee + petsFee + addonsFee;
  if (service === "Standard Clean"){ est *= (freqDisc[frequency] || 1); }
  return Math.round(est);
}

/* ============================
   CLEANING — TIME ESTIMATE (2-person team, HIDDEN)
   ============================ */
/* ✅ Your real Square links */
const SQUARE_CLEAN_SMALL  = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/B7HOTUU7R3PZTXU3KDWVTUGN"; // Small Clean (≤2.5h team)
const SQUARE_CLEAN_MEDIUM = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/7DCTTLC4L6RT5ITF2NXHC2UJ"; // Medium Clean (≤3.5h team)
const SQUARE_CLEAN_LARGE  = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/54JN4EKJXG6FU5G7P-WWWNHSAV"; // ← TODO: paste Large Clean link here (≤5h team)
const SQUARE_CLEAN_XL     = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/TJ25PH72FBCZ246QF27JR2RK"; // XL Clean (>5h team)

const addonHoursCleaning = {
  "oven":0.25, "fridge":0.25, "refrigerator":0.25,
  "windows":1.5, "window":1.5, "baseboards":1.0, "laundry":0.5
};
function parseAddonsHours(txt, hoursMap){
  txt = (txt||"").toLowerCase(); let total = 0;
  for (const k of Object.keys(hoursMap)){ if (txt.includes(k)) total += hoursMap[k]; }
  return total;
}
const roundHalf = n => Math.round(n*2)/2;

function estimateHoursCleaning(data){
  const sqft = data.sqft || "1000–2000";
  const service = data.service || "Initial Clean";
  const beds = Number(data.beds||0);
  const baths = Number(data.baths||0);
  const otherRooms = Number(data.other_rooms||0);
  const stories = String(data.stories||"1");

  // base hours for a solo cleaner
  let solo = 2;
  if (sqft === "<1000") solo = 2;
  else if (sqft === "1000–2000") solo = 3;
  else if (sqft === "2000–3000") solo = 4;
  else if (sqft === "3000–4000") solo = 5;
  else solo = 6; // 4000+

  // Airbnb depends more on bedrooms
  if (service === "Airbnb Turnover"){
    if (beds <= 1) solo = 2;
    else if (beds === 2) solo = 2.5;
    else if (beds === 3) solo = 3;
    else if (beds === 4) solo = 3.5;
    else solo = 4;
  }

  // extras
  solo += Math.max(0, beds - 3) * 0.5;   // +30m per bedroom over 3
  solo += Math.max(0, baths - 2) * 0.75; // +45m per bath over 2
  solo += Math.max(0, otherRooms) * 0.25;// +15m per “other room”
  if (stories === "2") solo += 0.25;     // +15m stairs/travel
  solo += parseAddonsHours(data.addons, addonHoursCleaning);

  // service multipliers
  if (service === "Deep Clean") solo *= 1.5;
  if (service === "Move-In / Move-Out Clean") solo *= 2;
  if (service === "Initial Clean") solo *= 1.2;

  solo = roundHalf(solo);
  const team = roundHalf(solo / 2); // 2-person team
  return { soloHours: solo, teamHours: team };
}

function squareUrlForCleaning(teamHours){
  if (teamHours <= 2.5) return SQUARE_CLEAN_SMALL;   // Small
  if (teamHours <= 3.5) return SQUARE_CLEAN_MEDIUM;  // Medium
  if (teamHours <= 5)   return SQUARE_CLEAN_LARGE;   // Large
  return SQUARE_CLEAN_XL;                             // XL
}

function ensureScheduleButton(estElId, url){
  const estEl = document.getElementById(estElId);
  let btn = document.getElementById("scheduleOnSquareCleaning");
  if (!btn){
    btn = document.createElement("a");
    btn.id = "scheduleOnSquareCleaning";
    btn.className = "btn btn-solid";
    btn.style.marginTop = "10px";
    btn.textContent = "Schedule on Square";
    estEl.parentNode.insertBefore(btn, estEl.nextSibling);
  }
  btn.href = url; btn.target = "_blank"; btn.rel = "noopener";
}

/* ============================
   ORGANIZING — TIME ESTIMATE & SQUARE ROUTING (HIDDEN)
   ============================ */

/* ✅ Real Square links for Organizing */
const SQUARE_ORG_SMALL  = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/BD7XIHWD3YSDVE76FLUC6TN"; // ≤2.5h team
const SQUARE_ORG_MEDIUM = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/BMQXJT324IV7SABC3N7N434E"; // ≤4h team
const SQUARE_ORG_LARGE  = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/GCZWD4QHC4EOKWZYYUBOMENC"; // ≤6h team
const SQUARE_ORG_XL     = "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9/services/35VRE245LJFHS7UADNOABFSS"; // >6h team

function estimateHoursOrganizing(data){
  // Base solo hours by area & size
  const area = data.org_area || "Closet";
  const size = data.org_size || "Medium";
  const baseMap = {
    "Closet":        {Small:2,   Medium:3,   Large:4},
    "Pantry":        {Small:2,   Medium:3,   Large:4},
    "Kitchen":       {Small:3,   Medium:4.5, Large:6},
    "Bedroom":       {Small:2.5, Medium:3.5, Large:5},
    "Bathroom":      {Small:1.5, Medium:2.5, Large:3.5},
    "Garage":        {Small:3,   Medium:5,   Large:7},
    "Laundry Room":  {Small:2,   Medium:3,   Large:4},
    "Office":        {Small:2.5, Medium:4,   Large:5.5},
    "Playroom":      {Small:2.5, Medium:4,   Large:5.5},
    "Whole Home (multi-area)": {Small:6, Medium:8, Large:12}
  };
  let solo = (baseMap[area]?.[size] ?? 3.5);

  // Complexity multipliers
  const clutter = data.org_clutter || "Moderate";
  if (clutter === "Light") solo *= 0.9;
  if (clutter === "Moderate") solo *= 1.0;
  if (clutter === "Heavy") solo *= 1.35;

  const decision = data.org_decision_speed || "Average";
  if (decision === "Fast") solo *= 0.9;
  if (decision === "Average") solo *= 1.0;
  if (decision === "Slow") solo *= 1.25;

  // Inventory adjustments
  const volume = data.org_volume || "Medium";
  if (volume === "Low") solo += 0.0;
  if (volume === "Medium") solo += 0.5;
  if (volume === "High") solo += 1.0;

  const containers = data.org_containers || "None";
  if (containers === "Some (up to 10)") solo += 0.5;
  if (containers === "Many (10+)") solo += 1.0;

  // Logistics
  const access = data.org_access || "Easy (ground floor)";
  if (access === "Stairs") solo += 0.5;
  if (access === "Tight spaces / HOA constraints") solo += 0.75;

  const haul = data.org_haul || "None";
  if (haul === "1–3 bags/boxes") solo += 0.5;
  if (haul === "4–8 bags/boxes") solo += 1.0;
  if (haul === "Carload+") solo += 1.5;

  // Round and convert to team hours (default team=2)
  const roundHalf = n => Math.round(n*2)/2;
  solo = roundHalf(solo);
  const teamCount = Math.max(1, Number(data.team || 2));
  const teamHours = roundHalf(solo / teamCount);
  return { soloHours: solo, teamHours };
}

function squareUrlForOrganizing(teamHours){
  if (teamHours <= 2.5) return SQUARE_ORG_SMALL;   // Small
  if (teamHours <= 4)   return SQUARE_ORG_MEDIUM;  // Medium
  if (teamHours <= 6)   return SQUARE_ORG_LARGE;   // Large
  return SQUARE_ORG_XL;                            // XL
}

/* Create/refresh the Organizing schedule button (unique ID so it won't clash) */
function ensureScheduleButtonOrganizing(estElId, url){
  const estEl = document.getElementById(estElId);
  if (!estEl) return;
  let btn = document.getElementById("scheduleOnSquareOrganizing");
  if (!btn){
    btn = document.createElement("a");
    btn.id = "scheduleOnSquareOrganizing";
    btn.className = "btn btn-solid";
    btn.style.marginTop = "10px";
    btn.textContent = "Schedule on Square";
    estEl.parentNode.insertBefore(btn, estEl.nextSibling);
  }
  btn.href = url;
  btn.target = "_blank";
  btn.rel = "noopener";
}

/* Hook into the Organizing form submit */
const formOrg = document.getElementById('intakeFormOrganizing');
if (formOrg){
  formOrg.addEventListener('submit', (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formOrg).entries());

    // 1) Price shown to client
    const price = calcOrganizing(data);
    const estEl = document.getElementById('estimateOrganizing');
    if (estEl) estEl.textContent = `Ballpark Estimate: $${price}`;

    // 2) Hidden time → Square link
    const { teamHours } = estimateHoursOrganizing(data);
    const url = squareUrlForOrganizing(teamHours);

    // 3) Button (unique to Organizing)
    ensureScheduleButtonOrganizing('estimateOrganizing', url);

    // 4) Optional: email (no time shown)
    sendEstimateEmail(
      "YOUR_SERVICE_ID","YOUR_TEMPLATE_ID_ORG",
      {
        to_email:data.email, to_name:data.name||"there",
        estimate:`$${price}`,
        spaces:data.spaces||"", complexity:data.org_clutter||"",
        team:data.team||"2", addons:data.addons||"None",
        notes:data.notes||"", phone:data.phone||"", address:data.address||"",
        action_link:"https://YOUR-USERNAME.github.io/the-finishing-touch/intake-organizing.html"
      },
      document.getElementById('emailStatusOrganizing')
    );
  });
}

/* ============================
   DECOR/STAGING — TIME ESTIMATE & SQUARE ROUTING (HIDDEN)
   ============================ */

/* Square links for hidden services */
const SQUARE_DECOR_SMALL  = "https://book.squareup.com/appointments/..."; // ≤2.5h team
const SQUARE_DECOR_MEDIUM = "https://book.squareup.com/appointments/..."; // ≤4h team
const SQUARE_DECOR_LARGE  = "https://book.squareup.com/appointments/..."; // ≤6h team
const SQUARE_DECOR_XL     = "https://book.squareup.com/appointments/..."; // >6h team

function estimateHoursDecor(data){
  const type = data.decor_type || "Interior Decorating (refresh)";
  const scope = data.decor_scope || "Light refresh (styling)";
  const room = data.decor_room || "Living Room";
  const count = Math.max(1, Number(data.count||1));

  // Base solo hours per room (very light starting points)
  const basePerRoom = {
    "Living Room": 3,
    "Bedroom": 2.5,
    "Dining Room": 2.5,
    "Home Office": 2.5,
    "Kitchen / Nook": 2.5,
    "Entryway": 1.5,
    "Multiple Rooms": 3 // will multiply by count anyway
  };
  let solo = (basePerRoom[room] ?? 2.5) * count;

  // Scope multiplier
  if (scope === "Light refresh (styling)") solo *= 1.0;
  if (scope === "Refresh + small sourcing") solo *= 1.3;
  if (scope === "Full design (sourcing + install)") solo *= 1.8;

  // Project type adjustments
  if (type.includes("Staging — Occupied")) solo *= 1.2;
  if (type.includes("Staging — Vacant"))   solo *= 1.6;

  // Furniture sourcing
  const furn = data.decor_furniture || "No";
  if (furn === "Yes — a few pieces") solo += 1.0;
  if (furn === "Yes — multiple pieces") solo += 2.0;

  // Install complexity
  const install = data.decor_install || "Light (art, textiles)";
  if (install === "Moderate (art + small furniture)") solo += 1.0;
  if (install === "Heavy (multiple furniture + window treatments)") solo += 2.0;

  // Shopping trips
  const trips = Number(data.decor_shopping || 0);
  if (trips > 0) solo += trips * 1.0; // 1 hr per trip (prep + checkout)

  // Access
  const access = data.decor_access || "Easy";
  if (access === "Stairs / elevator") solo += 0.5;
  if (access === "HOA / tight timing") solo += 0.75;

  // Round & convert to team hours (team=2 default)
  const roundHalf = n => Math.round(n*2)/2;
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

/* Hook into Decor form submit */
const formDecor = document.getElementById('intakeFormDecor');
if (formDecor){
  formDecor.addEventListener('submit', (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formDecor).entries());
    const price = calcDecor(data); // your existing price logic
    document.getElementById('estimateDecor').textContent = `Ballpark Estimate: $${price}`;

    const { teamHours } = estimateHoursDecor(data);
    const url = squareUrlForDecor(teamHours);
    ensureScheduleButton('estimateDecor', url);

    // (Optional) email
    sendEstimateEmail(
      "YOUR_SERVICE_ID","YOUR_TEMPLATE_ID_DECOR",
      {
        to_email:data.email, to_name:data.name||"there",
        estimate:`$${price}`, room:data.decor_room||data.room||"", count:data.count||"1",
        addons:data.addons||"None", budget:data.budget||"",
        notes:data.notes||"", phone:data.phone||"", address:data.address||"",
        action_link:"https://YOUR-USERNAME.github.io/the-finishing-touch/intake-decor.html"
      },
      document.getElementById('emailStatusDecor')
    );
  });
}


/* ============================
   ORGANIZING — COMPETITIVE PRICING
   ============================ */
const ORG_HOURLY=65, ORG_MIN_HOURS=3;
const hoursPerSpace = {"Light":1,"Moderate":2,"Heavy":3};
const addonPricesOrganizing = {"bins":25,"labels":20,"bins/labels":40,"haul-away":35,"donation":30,"donation drop-off":30};

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

/* ============================
   DECORATING — COMPETITIVE PRICING
   ============================ */
const decorBase = {"Living Room":500,"Bedroom":400,"Dining Room":450,"Home Office":450};
const addonPricesDecor = {"moodboard":75,"sourcing":150,"shopping":150,"install":250,"install day":250,"window treatments":200,"art hanging":100};

function calcDecor(data){
  const room = data.room || "Living Room";
  const count = Math.max(1, Number(data.count||1));
  const base = (decorBase[room] ?? 450) * count;
  const addons = parseAddonsList(data.addons, addonPricesDecor);
  return Math.round(base + addons);
}

/* ============================
   EMAILJS helper (optional)
   ============================ */
function sendEstimateEmail(serviceId, templateId, vars, statusEl){
  if (!window.emailjs) return;
  emailjs.send(serviceId, templateId, vars)
    .then(()=> statusEl.textContent = "Your estimate has been emailed. Check your inbox!")
    .catch(err=>{ console.error(err); statusEl.textContent = "Estimate shown above. Email failed."; });
}

/* CLEANING form — SHOW PRICE ONLY, PICK SQUARE LINK BEHIND THE SCENES */
const formCleaning = document.getElementById('intakeFormCleaning');
if (formCleaning){
  formCleaning.addEventListener('submit', (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formCleaning).entries());

    // 1) PRICE (shown to client)
    const price = calcCleaning(data);
    const estEl = document.getElementById('estimateCleaning');
    estEl.innerHTML = `Ballpark Estimate: <strong>$${price}</strong>`;

    // 2) TIME (hidden) → choose correct Square URL
    const { teamHours } = estimateHoursCleaning(data);
    const squareUrl = squareUrlForCleaning(teamHours);

    // 3) Create/refresh “Schedule on Square” button
    ensureScheduleButton('estimateCleaning', squareUrl);

    // 4) Optional: email (without time)
    sendEstimateEmail(
      "YOUR_SERVICE_ID","YOUR_TEMPLATE_ID_CLEANING",
      {
        to_email: data.email, to_name: data.name || "there",
        estimate:`$${price}`,
        service:data.service, sqft:data.sqft,
        beds:data.beds, baths:data.baths, other_rooms:data.other_rooms||"0",
        stories:data.stories, frequency:data.frequency,
        addons:data.addons||"None", notes:data.notes||"",
        phone:data.phone||"", address:data.address||"",
        action_link:"https://YOUR-USERNAME.github.io/the-finishing-touch/intake-cleaning.html"
      },
      document.getElementById('emailStatusCleaning')
    );
  });
}

/* ORGANIZING form */
const formOrg = document.getElementById('intakeFormOrganizing');
if (formOrg){
  formOrg.addEventListener('submit', (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formOrg).entries());
    const est = calcOrganizing(data);
    document.getElementById('estimateOrganizing').textContent = `Ballpark Estimate: $${est}`;
    sendEstimateEmail(
      "YOUR_SERVICE_ID","YOUR_TEMPLATE_ID_ORG",
      {
        to_email:data.email, to_name:data.name||"there",
        estimate:`$${est}`, spaces:data.spaces, complexity:data.complexity,
        team:data.team, addons:data.addons||"None",
        notes:data.notes||"", phone:data.phone||"", address:data.address||"",
        action_link:"https://YOUR-USERNAME.github.io/the-finishing-touch/intake-organizing.html"
      },
      document.getElementById('emailStatusOrganizing')
    );
  });
}

/* DECOR form */
const formDecor = document.getElementById('intakeFormDecor');
if (formDecor){
  formDecor.addEventListener('submit', (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formDecor).entries());
    const est = calcDecor(data);
    document.getElementById('estimateDecor').textContent = `Ballpark Estimate: $${est}`;
    sendEstimateEmail(
      "YOUR_SERVICE_ID","YOUR_TEMPLATE_ID_DECOR",
      {
        to_email:data.email, to_name:data.name||"there",
        estimate:`$${est}`, room:data.room, count:data.count,
        addons:data.addons||"None", budget:data.budget||"",
        notes:data.notes||"", phone:data.phone||"", address:data.address||"",
        action_link:"https://YOUR-USERNAME.github.io/the-finishing-touch/intake-decor.html"
      },
      document.getElementById('emailStatusDecor')
    );
  });
}

/* OPTIONAL: homepage contact form email (only if you init EmailJS in index.html) */
const contactForm = document.getElementById('contactForm');
if (contactForm){
  contactForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(contactForm).entries());
    const status = document.getElementById('contactStatus');
    if (!window.emailjs){ status.textContent = "Thanks! We’ll be in touch shortly."; return; }
    try{
      await emailjs.send("YOUR_SERVICE_ID","YOUR_TEMPLATE_ID_CONTACT",payload);
      status.textContent = "Thanks! We’ll be in touch shortly.";
      contactForm.reset();
    }catch(err){ status.textContent = "Message not sent. Please try again."; console.error(err); }
  });
}




