/* ============================
   COMPETITIVE PRICING MATRIX
   ============================ */

// Base tiers by square footage
const initialBySqft = {
  "<1000": 250, "1000–2000": 300, "2000–3000": 375,
  "3000–4000": 450, "4000+": 520
};
const standardBySqft = {
  "<1000": 170, "1000–2000": 200, "2000–3000": 250,
  "3000–4000": 300, "4000+": 360
};

// Service multipliers (relative to Initial)
const serviceMult = {
  "Initial Clean": 1.0,
  "Deep Clean": 1.2,
  "Move-In / Move-Out Clean": 1.35,
  "Airbnb Turnover": 0.55, // fallback if not using bedroom-based formula
  "Organizing": 0          // handled separately
};

// Frequency discounts (applies to Standard Clean only)
const freqDisc = {
  "weekly": 0.85,
  "biweekly": 0.90,
  "monthly": 0.95,
  "one-time": 1
};

// Modifiers
const perExtraBathroom = 20; // per bath above 2
const perExtraBedroom  = 12; // per BR above 3
const perOtherRoom     = 10; // offices, dining, playroom
const twoStoryFee      = 20;
const petFee           = 12;

// Add-on menu
const addonPrices = {
  "oven": 35,
  "fridge": 30,
  "refrigerator": 30,
  "windows": 80,
  "window": 80,
  "baseboards": 60,
  "laundry": 18
};

// Airbnb flat-fee by bedrooms
function airbnbByBedrooms(beds) {
  const b = Number(beds) || 0;
  if (b <= 1) return 120;
  if (b === 2) return 140;
  if (b === 3) return 160;
  if (b === 4) return 180;
  return 200;
}

/* ============================
   CALCULATOR
   ============================ */
function parseAddons(addonStr="") {
  const txt = addonStr.toLowerCase();
  let total = 0;
  for (const key of Object.keys(addonPrices)) {
    if (txt.includes(key)) total += addonPrices[key];
  }
  return total;
}

function calcEstimate(data){
  const sqft = data.sqft || "1000–2000";
  const service = data.service || "Initial Clean";
  const frequency = data.frequency || "one-time";

  const beds = Number(data.beds || 0);
  const baths = Number(data.baths || 0);
  const otherRooms = Number(data.other_rooms || 0);
  const stories = String(data.stories || "1");
  const pets = String(data.pets || "");

  // Organizing is hourly (2-hr min at $55/hr)
  if (service === "Organizing") return 55 * 2;

  let base = 0;

  if (service === "Standard Clean") {
    base = standardBySqft[sqft] ?? 200;
  } else if (service === "Airbnb Turnover") {
    base = airbnbByBedrooms(beds); // OR fallback multiplier if you prefer
  } else {
    const initial = initialBySqft[sqft] ?? 300;
    base = initial * (serviceMult[service] ?? 1);
  }

  // Modifiers
  const extraBaths = Math.max(0, baths - 2) * perExtraBathroom;
  const extraBeds  = Math.max(0, beds - 3) * perExtraBedroom;
  const extraRooms = Math.max(0, otherRooms) * perOtherRoom;
  const storyFee   = stories === "2" ? twoStoryFee : 0;
  const petsFee    = pets.trim() ? petFee : 0;
  const addonsFee  = parseAddons(data.addons || "");

  let est = base + extraBaths + extraBeds + extraRooms + storyFee + petsFee + addonsFee;

  // Apply discount for Standard frequency
  if (service === "Standard Clean") {
    est *= (freqDisc[frequency] || 1);
  }

  return Math.round(est);
}

/* ============================
   FORM HOOKS
   ============================ */
const intakeForm = document.getElementById('intakeForm');
if (intakeForm){
  intakeForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(intakeForm);
    const data = Object.fromEntries(fd.entries());
    const est = calcEstimate(data);

    // Show estimate on page
    const estEl = document.getElementById('estimate');
    estEl.textContent = `Ballpark Estimate: $${est}`;

    // Optional email via EmailJS
    const statusEl = document.getElementById('emailStatus');
    try{
      await emailjs.send("YOUR_SERVICE_ID","YOUR_TEMPLATE_ID",{
        to_email: data.email,
        to_name: data.name || "there",
        estimate: `$${est}`,
        service: data.service,
        sqft: data.sqft,
        beds: data.beds,
        baths: data.baths,
        other_rooms: data.other_rooms || "0",
        stories: data.stories,
        frequency: data.frequency,
        addons: data.addons || "None",
        notes: data.notes || "",
        phone: data.phone || "",
        address: data.address || ""
      });
      statusEl.textContent = "Your estimate has been emailed. We’ll follow up to confirm scheduling!";
    }catch(err){
      statusEl.textContent = "Estimate shown above. Email failed—please double-check your email or connection.";
      console.error(err);
    }
  });
}

// Contact form (optional)
const contactForm = document.getElementById('contactForm');
if (contactForm){
  contactForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(contactForm);
    const payload = Object.fromEntries(fd.entries());
    const status = document.getElementById('contactStatus');
    try{
      await emailjs.send("YOUR_SERVICE_ID","YOUR_CONTACT_TEMPLATE_ID",payload);
      status.textContent = "Thanks! We’ll be in touch shortly.";
      contactForm.reset();
    }catch(e2){
      status.textContent = "Message not sent. Please try again or email us directly.";
    }
  });
}
