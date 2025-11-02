// === The Finishing Touch — Auto-create Jobs from Intakes (Thumbtack mode) ===
// Requires: ft-firebase.js (auth + db), Firestore rules that restrict /jobs/{id}/private/**
// Include with: <script type="module" src="ft-auto.js"></script>

import { auth, db } from "./ft-firebase.js";
import {
  collection, addDoc, setDoc, doc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

// === PRIVACY / EMAIL TRAIL ===
// If true -> Formspree email will include address & phone (PII).
// If false -> Formspree email excludes address & phone (safer).
const SEND_PII_TO_FORMSPREE = true; // <-- flip to false if you want email without PII

// ---- CONFIG ----
const CFG = {
  squareBookingUrl: "https://book.squareup.com/appointments/kbcbv6uu1d7qd7/location/L2P303Y0SXTD9",
  formspreeEndpoint: "https://formspree.io/f/mzzaogbv",
  // Default company cut used only to split client-facing price into slot pay
  defaultCompanyCutPct: 30,
  // Default slots by service type
  slotsByType: { cleaning: 1, organizing: 2, decor: 2, holiday: 2 },
};

// ---- UTIL ----
const USD = (n) => `$${Math.round(Number(n || 0))}`;
function teamHoursLabel(h){
  if (h <= 2.5) return "Small (≈2–2.5 hr)";
  if (h <= 4)   return "Medium (≈3–4 hr)";
  if (h <= 6)   return "Large (≈5–6 hr)";
  return "XL (6.5+ hr)";
}
function todayWindowLabel(){
  const d = new Date();
  const wk = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
  return `${wk} (flexible)`;
}
function whenAtFromOptional(dateStr, startStr){
  if (!dateStr) return null;
  const [y,m,d] = dateStr.split("-").map(Number);
  const [hh,mm] = (startStr || "09:00").split(":").map(Number);
  return new Date(y,(m||1)-1,d,hh||9,mm||0,0,0);
}
function cap(s){ return s ? (s[0].toUpperCase() + s.slice(1)) : ""; }

// ---- PUBLIC API ----
/**
 * createJobFromIntake(opts)
 * Accepts both the new field names and some alternates used elsewhere.
 * @param {Object} opts
 *  - type: "cleaning" | "organizing" | "decor" | "holiday"   (alt: serviceType)
 *  - intakeData: raw FormData object/entries (alt: intake)
 *  - estimate: { price, teamHours, teardownPrice?, teardownHours? }
 *      (alts supported: flatRate -> price, estTeamHours -> teamHours)
 *  - windowHint?: human label for time window
 *  - summary?: client-facing summary
 *  - slots?: override number of contractor slots
 *  - afterCreate?: (jobId)=>void
 */
async function createJobFromIntake(opts){
  const user = auth.currentUser;
  if (!user){
    const next = encodeURIComponent(location.pathname);
    location.href = `login.html?next=${next}`;
    return false;
  }

  const {
    type, intakeData, estimate, windowHint, summary, slots, teardownPrice, teardownHours
  } = normalizeInputs(opts);

  // Compute exact datetime if your intake captured date+time
  const whenAt = whenAtFromOptional(intakeData.date, intakeData.start);
  const serviceDateTs = whenAt ? Timestamp.fromDate(whenAt) : null;

  // Build top-level public job
  const contractorsNeeded = Math.max(1, Number(slots ?? CFG.slotsByType[type] ?? 1));
  const job = {
    serviceType: type,
    status: "open",

    // Exact scheduled time (helps reminders/sorting)
    serviceDate: serviceDateTs,
    arriveEarlyMinutes: 15,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    reminderFlags: { dayBefore: false, dayOf: false },

    zip: (intakeData.zip || intakeData.postal || intakeData.area || "").toString().trim(),
    area: (intakeData.area || intakeData.city || "").toString().trim(),
    window: windowHint || todayWindowLabel(),

    summary: summary || defaultSummary(type, intakeData, estimate),
    notes: "",
    flatRate: Number(estimate.price || 0),
    estimatedTeamHours: Number(estimate.teamHours || 0),
    contractorsNeeded,
    contractorIds: [],

    clientId: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  // Legacy/back-compat fields (optional)
  if (whenAt) job.whenAt = serviceDateTs;
  if (intakeData.date)  job.whenDate  = intakeData.date;
  if (intakeData.start) job.whenStart = intakeData.start;

  // 1) Create the job
  const ref = await addDoc(collection(db, "jobs"), job);

  // 2) Create contractor slots (split the client price into per-slot pay)
  const keep = Math.round(job.flatRate * (CFG.defaultCompanyCutPct / 100));
  const toContractors = Math.max(0, job.flatRate - keep);
  const base = Math.floor(toContractors / contractorsNeeded);
  const remainder = toContractors % contractorsNeeded;

  for (let i = 0; i < contractorsNeeded; i++){
    const per = base + (i < remainder ? 1 : 0);
    await setDoc(doc(db, "jobs", ref.id, "slots", `slot_${i + 1}`), {
      slotNumber: i + 1, status: "open", contractorId: "", pay: per
    });
  }

  // 3) Private/PII doc — structured intake for admin only
  await setDoc(doc(db, "jobs", ref.id, "private", "pii"), {
    clientEmail: user.email || "",
    intake: intakeData,
    clientPrice: Number(job.flatRate || 0),
    teardownPrice: Number(estimate.teardownPrice || teardownPrice || 0),
    createdAt: serverTimestamp()
  });

  // 4) Fire-and-forget Formspree admin trail (conditional PII)
  try {
    const fd = new FormData();
    fd.append("_subject", `New ${cap(type)} Intake → Job Created — ${ref.id}`);
    // Searchable metadata
    fd.append("service_type", type);
    fd.append("job_id", ref.id);
    fd.append("client_uid", auth.currentUser?.uid || "");
    fd.append("window", job.window || "");
    if (serviceDateTs) fd.append("service_date", serviceDateTs.toDate().toString());
    fd.append("price", USD(job.flatRate));
    fd.append("team_hours", String(job.estimatedTeamHours || ""));
    fd.append("slots_needed", String(contractorsNeeded));

    // Compact non-PII summary for email search
    fd.append("intake_summary", JSON.stringify({
      name: intakeData.name || "",
      email: intakeData.email || "",
      service: intakeData.service || "",
      beds: intakeData.beds || "",
      baths: intakeData.baths || "",
      sqft: intakeData.sqft || "",
      notes: intakeData.notes || "",
      addons: intakeData.addons || ""
    }));

    // Conditionally include PII for admin mailbox convenience
    if (SEND_PII_TO_FORMSPREE) {
      fd.append("address", intakeData.address || "");
      fd.append("phone", intakeData.phone || "");
      fd.append("pii_quick", `${intakeData.name||""} • ${intakeData.phone||""} • ${intakeData.address||""}`);
    }

    // Full raw intake for record (email), regardless of PII toggle
    fd.append("intake_json", JSON.stringify(intakeData || {}));

    await fetch(CFG.formspreeEndpoint, {
      method: "POST",
      body: fd,
      headers: { Accept: "application/json" }
    });
  } catch (err) {
    console.warn("Formspree notification failed:", err);
    // no-op: do not block job creation on email
  }

  // Optional hook
  if (typeof opts.afterCreate === "function") {
    try { opts.afterCreate(ref.id); } catch {}
  }

  return ref.id;
}

// ---- HELPERS ----
function normalizeInputs(opts){
  const o = { ...opts };

  // Map common alternates to the canonical names
  o.type       = (o.type || o.serviceType || "cleaning").toString().toLowerCase();
  o.intakeData = o.intakeData || o.intake || {};
  o.estimate   = o.estimate || {};
  if (o.flatRate != null && o.estimate.price == null) o.estimate.price = Number(o.flatRate);
  if (o.estTeamHours != null && o.estimate.teamHours == null) o.estimate.teamHours = Number(o.estTeamHours);

  // Defaults
  if (!o.estimate || typeof o.estimate !== "object") o.estimate = { price: 0, teamHours: 0 };
  if (o.estimate.price == null) o.estimate.price = 0;
  if (o.estimate.teamHours == null) o.estimate.teamHours = 0;

  return o;
}

function defaultSummary(type, d, est){
  if (type === "cleaning"){
    const beds = d.beds != null ? `${d.beds} bed / ` : "";
    const baths = d.baths != null ? `${d.baths} bath` : "";
    const svc = d.service || "cleaning";
    return `${beds}${baths} — ${svc} · est ${teamHoursLabel(est.teamHours)}`;
  }
  if (type === "organizing"){
    const area = d.org_area || d.area || "Organizing";
    return `${area} — ${d.org_size || "Medium"} · est ${teamHoursLabel(est.teamHours)}`;
  }
  if (type === "decor"){
    const room = d.room || "Decor";
    return `${room} — ${d.decor_scope || "refresh"} · est ${teamHoursLabel(est.teamHours)}`;
  }
  if (type === "holiday"){
    const occ = d.occasion ? ` (${d.occasion})` : "";
    return `Holiday/Event${occ} — est ${teamHoursLabel(est.teamHours)}`;
  }
  return "Service";
}

// Expose on window so intake pages can call it without re-import boilerplate
window.FTAuto = { createJobFromIntake };

