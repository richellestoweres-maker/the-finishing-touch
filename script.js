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
/* 👇 Replace these with your real Square booking URLs (Square → Appointments → Online Booking → Share).
   Create service variations (Small/Medium/Large/XL) with matching durations. */
const SQUARE_CLEAN_SMALL  = "https://squareup.com/appointments/book/YOUR_SMALL_SERVICE";   // ≤2.5h team
const SQUARE_CLEAN_MEDIUM = "https://squareup.com/appointments/book/YOUR_MEDIUM_SERVICE";  // ≤3.5h team
const SQUARE_CLEAN_LARGE  = "https://squareup.com/appointments/book/YOUR_LARGE_SERVICE";   // ≤5h team
const SQUARE_CLEAN_XL     = "https://squareup.com/appointments/book/YOUR_XL_SERVICE";      // >5h team

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
  if (teamHours <= 2.5) return SQUARE_CLEAN_SMALL;
  if (teamHours <= 3.5) return SQUARE_CLEAN_MEDIUM;
  if (teamHours <= 5)   return SQUARE_CLEAN_LARGE;
  return SQUARE_CLEAN_XL;
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
