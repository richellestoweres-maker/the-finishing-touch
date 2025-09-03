// Pricing helpers
const baseBySqft = {"<1000":220,"1000–2000":290,"2000–3000":360,"3000–4000":440,"4000+":520};
const svcMult = {"Initial Clean":1,"Deep Clean":1.2,"Move-In / Move-Out Clean":1.35,"Standard Clean":0.65,"Airbnb Turnover":0.55,"Organizing":0};
const freqDisc = {"weekly":0.85,"biweekly":0.90,"monthly":0.95,"one-time":1};

function calcEstimate(data){
  if (data.service==="Organizing") return 55*2; // 2 hr min
  let base = baseBySqft[data.sqft] || 290;
  base *= (svcMult[data.service] ?? 1);

  const baths = Math.max(0, (parseInt(data.baths)||0) - 2)*18;
  const beds  = Math.max(0, (parseInt(data.beds)||0)  - 3)*12;
  const story = data.stories==="2" ? 20 : 0;
  const pets  = /yes/i.test(data.pets) ? 12 : 0;

  const addons = (data.addons||"").toLowerCase();
  let addon = 0;
  if (addons.includes("oven")) addon+=35;
  if (addons.includes("fridge")) addon+=30;
  if (addons.includes("window")) addon+=60;
  if (addons.includes("baseboard")) addon+=40;
  if (addons.includes("laundry")) addon+=15;

  let est = base + baths + beds + story + pets + addon;

  if (data.service==="Standard Clean"){
    est *= (freqDisc[data.frequency] || 1);
  }
  return Math.round(est);
}

const intakeForm = document.getElementById('intakeForm');
if (intakeForm){
  intakeForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(intakeForm);
    const data = Object.fromEntries(fd.entries());
    const est = calcEstimate(data);

    const estEl = document.getElementById('estimate');
    estEl.textContent = `Ballpark Estimate: $${est}`;

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
        stories: data.stories,
        frequency: data.frequency,
        addons: data.addons || "None",
        notes: data.notes || "",
        phone: data.phone || "",
        address: data.address || ""
      });
      statusEl.textContent = "Your estimate has been emailed. We’ll follow up to confirm scheduling!";
    }catch(err){
      statusEl.textContent = "Estimate shown above. Email failed—please double-check your connection or email address.";
      console.error(err);
    }
  });
}

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
