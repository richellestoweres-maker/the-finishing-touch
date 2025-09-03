/* ============================
   CLEANING — COMPETITIVE PRICING
   ============================ */
const initialBySqft = {"<1000":250,"1000–2000":300,"2000–3000":375,"3000–4000":450,"4000+":520};
const standardBySqft = {"<1000":170,"1000–2000":200,"2000–3000":250,"3000–4000":300,"4000+":360};

const serviceMult = {
  "Initial Clean": 1.00,
  "Deep Clean": 1.20,
  "Move-In / Move-Out Clean": 1.35,
  "Airbnb Turnover": 0.55, // fallback if not using bedroom table
};

const freqDisc = {"weekly":0.85,"biweekly":0.90,"monthly":0.95,"one-time":1};

const perExtraBathroom = 20;
const perExtraBedroom  = 12;
const perOtherRoom     = 10;
const twoStoryFee      = 20;
const petFee           = 12;

const addonPricesCleaning = {
  "oven":35,"fridge":30,"refrigerator":30,
  "windows":80,"window":80,"baseboards":60,"laundry":18
};

function parseAddonsList(txt, priceMap){
  txt = (txt||"").toLowerCase();
  let total = 0;
  for (const key of Object.keys(priceMap)){
    if (txt.includes(key)) total += priceMap[key];
  }
  return total;
}
function airbnbByBedrooms(beds){
  const b = Number(beds)||0;
  if (b<=1) return 120; if (b===2) return 140; if (b===3) return 160; if (b===4) return 180;
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
    base = airbnbByBedrooms(beds); // bedroom-based flat fee
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

  if (service === "Standard Clean"){
    est *= (freqDisc[frequency] || 1);
  }
  return Math.round(est);
}

/* ============================
   ORGANIZING — COMPETITIVE PRICING
   ============================ */
// $65/hr per organizer; 3-hr minimum.
// Hours per space by complexity: Light=1, Moderate=2, Heavy=3.
const ORG_HOURLY = 65;  // per organizer
const ORG_MIN_HOURS = 3;
const hoursPerSpace = {"Light":1,"Moderate":2,"Heavy":3};

const addonPricesOrganizing = {
  "bins":25, "labels":20, "bins/labels":40, "haul-away":35, "donation":30, "donation drop-off":30
};

function calcOrganizing(data){
  const spaces = Math.max(1, Number(data.spaces||1));
  const complexity = data.complexity || "Moderate";
  const team = Math.max(1, Number(data.team||1));

  const hoursEach = hoursPerSpace[complexity] || 2;
  let estHours = spaces * hoursEach;

  // Respect 3-hr minimum per organizer
  estHours = Math.max(ORG_MIN_HOURS, estHours);
  const labor = estHours * ORG_HOURLY * team;

  const addons = parseAddonsList(data.addons, addonPricesOrganizing);
  return Math.round(labor + addons);
}

/* ============================
   DECORATING — COMPETITIVE PRICING
   ============================ */
// Base design fee per room type
const decorBase = {
  "Living Room": 500,
  "Bedroom": 400,
  "Dining Room": 450,
  "Home Office": 450
};
// Add-ons
const addonPricesDecor = {
  "moodboard":75,
  "sourcing":150, "shopping":150,
  "install":250, "install day":250,
  "window treatments":200,
  "art hanging":100
};

function calcDecor(data){
  const room = data.room || "Living Room";
  const count = Math.max(1, Number(data.count||1));
  const base = (decorBase[room] ?? 450) * count;
  const addons = parseAddonsList(data.addons, addonPricesDecor);
  return Math.round(base + addons);
}

/* ============================
   FORM HOOKS + EMAIL (EmailJS)
   ============================ */
function sendEstimateEmail(templateId, vars, statusEl){
  return emailjs.send("YOUR_SERVICE_ID", templateId, vars)
    .then(()=> statusEl.textContent = "Your estimate has been emailed. Check your inbox!")
    .catch(err=>{
      console.error(err);
      statusEl.textContent = "Estimate shown above. Email failed—please double-check your email.";
    });
}

// CLEANING form
const formCleaning = document.getElementById('intakeFormCleaning');
if (formCleaning){
  formCleaning.addEventListener('submit', (e)=>{
    e.preventDefault();
    const fd = new FormData(formCleaning);
    const data = Object.fromEntries(fd.entries());
    const est = calcCleaning(data);
    document.getElementById('estimateCleaning').textContent = `Ballpark Estimate: $${est}`;
    const status = document.getElementById('emailStatusCleaning');

    // Send email
    sendEstimateEmail("YOUR_TEMPLATE_ID_CLEANING", {
      to_email: data.email, to_name: data.name || "there",
      estimate: `$${est}`, service: data.service, sqft: data.sqft,
      beds: data.beds, baths: data.baths, other_rooms: data.other_rooms || "0",
      stories: data.stories, frequency: data.frequency,
      addons: data.addons || "None", notes: data.notes || "",
      phone: data.phone || "", address: data.address || "",
      // Include a live link in the email (replace with your booking link or site)
      action_link: "https://YOUR-USERNAME.github.io/the-finishing-touch/intake-cleaning.html"
    }, status);
  });
}

// ORGANIZING form
const formOrg = document.getElementById('intakeFormOrganizing');
if (formOrg){
  formOrg.addEventListener('submit', (e)=>{
    e.preventDefault();
    const fd = new FormData(formOrg);
    const data = Object.fromEntries(fd.entries());
    const est = calcOrganizing(data);
    document.getElementById('estimateOrganizing').textContent = `Ballpark Estimate: $${est}`;
    const status = document.getElementById('emailStatusOrganizing');

    sendEstimateEmail("YOUR_TEMPLATE_ID_ORG", {
      to_email: data.email, to_name: data.name || "there",
      estimate: `$${est}`, spaces: data.spaces, complexity: data.complexity,
      team: data.team, addons: data.addons || "None",
      notes: data.notes || "", phone: data.phone || "", address: data.address || "",
      action_link: "https://YOUR-USERNAME.github.io/the-finishing-touch/intake-organizing.html"
    }, status);
  });
}

// DECOR form
const formDecor = document.getElementById('intakeFormDecor');
if (formDecor){
  formDecor.addEventListener('submit', (e)=>{
    e.preventDefault();
    const fd = new FormData(formDecor);
    const data = Object.fromEntries(fd.entries());
    const est = calcDecor(data);
    document.getElementById('estimateDecor').textContent = `Ballpark Estimate: $${est}`;
    const status = document.getElementById('emailStatusDecor');

    sendEstimateEmail("YOUR_TEMPLATE_ID_DECOR", {
      to_email: data.email, to_name: data.name || "there",
      estimate: `$${est}`, room: data.room, count: data.count,
      addons: data.addons || "None", budget: data.budget || "",
      notes: data.notes || "", phone: data.phone || "", address: data.address || "",
      action_link: "https://YOUR-USERNAME.github.io/the-finishing-touch/intake-decor.html"
    }, status);
  });
}
