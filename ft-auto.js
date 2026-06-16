// === The Finishing Touch — Intake Inbox Save Helper ===
// Purpose: Save website intake submissions into Firestore for the Admin Dashboard Intake Inbox.
// Formspree/Zapier is still handled by each intake form separately.
// Include with: <script type="module" src="ft-auto.js"></script>

import { auth, db } from "./ft-firebase.js";
import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

function safeString(v){
  return (v == null ? "" : String(v)).trim();
}

function normalizeServiceType(type, intakeData = {}){
  const raw = safeString(
    type ||
    intakeData.INTERNAL_app_intake_type ||
    intakeData.serviceType ||
    intakeData.service ||
    intakeData.page ||
    "cleaning"
  ).toLowerCase();

  const page = safeString(intakeData.page).toLowerCase();

  if (page.includes("organizing") || raw.includes("organizing") || raw.includes("organize")) return "organizing";
  if (page.includes("decor") || raw.includes("decor") || raw.includes("interior")) return "decor";
  if (page.includes("holiday") || raw.includes("holiday") || raw.includes("christmas")) return "holiday";
  if (page.includes("staging") || raw.includes("staging") || raw.includes("stage")) return "staging";
  if (raw.includes("move")) return "move_in_out";
  if (raw.includes("airbnb") || raw.includes("turnover")) return "airbnb";
  if (raw.includes("commercial")) return "commercial";
  if (raw.includes("carpet") || raw.includes("upholstery") || raw.includes("grout")) return "carpet_upholstery_grout";

  return "cleaning";
}

function serviceLabel(serviceType){
  const labels = {
    cleaning: "Cleaning",
    move_in_out: "Move-In / Move-Out Cleaning",
    airbnb: "Airbnb Turnover",
    commercial: "Commercial Cleaning",
    organizing: "Home Organizing",
    decor: "Interior Decorating / Styling",
    holiday: "Holiday Decorating",
    staging: "Staging & Styling",
    carpet_upholstery_grout: "Carpet, Upholstery & Grout Request"
  };
  return labels[serviceType] || serviceType;
}

function buildClientContactClear(d){
  return [
    d.name ? `Name: ${d.name}` : null,
    d.email ? `Email: ${d.email}` : null,
    d.phone ? `Phone: ${d.phone}` : null,
    d.address ? `Address: ${d.address}` : null
  ].filter(Boolean).join(" | ");
}

function buildBasicSummary(serviceType, d, summary){
  if (summary) return summary;

  if (
    serviceType === "cleaning" ||
    serviceType === "move_in_out" ||
    serviceType === "airbnb" ||
    serviceType === "commercial"
  ){
    return [
      serviceLabel(serviceType),
      d.service ? `Service: ${d.service}` : null,
      d.HOME_LAYOUT_CLEAR || null,
      d.sqft ? `Sq Ft: ${d.sqft}` : null,
      d.general_area ? `Area: ${d.general_area}` : null,
      d.notes ? `Notes: ${d.notes}` : null,
      d.SPECIALTY_ADDONS_CLEAR && d.SPECIALTY_ADDONS_CLEAR !== "None selected"
        ? `Specialty: ${d.SPECIALTY_ADDONS_CLEAR}`
        : null
    ].filter(Boolean).join(" | ");
  }

  if (serviceType === "organizing"){
    return [
      "Home Organizing",
      d.ORGANIZING_AREAS_CLEAR || null,
      d.ORGANIZING_GOALS_CLEAR || null,
      d.notes ? `Notes: ${d.notes}` : null
    ].filter(Boolean).join(" | ");
  }

  if (serviceType === "decor"){
    return [
      "Interior Decorating / Styling",
      d.DECOR_SCOPE_CLEAR || null,
      d.STYLE_GOALS_CLEAR || null,
      d.notes ? `Notes: ${d.notes}` : null
    ].filter(Boolean).join(" | ");
  }

  if (serviceType === "holiday"){
    return [
      "Holiday Decorating",
      d.HOLIDAY_SCOPE_CLEAR || null,
      d.INSTALL_TIMELINE_CLEAR || null,
      d.notes ? `Notes: ${d.notes}` : null
    ].filter(Boolean).join(" | ");
  }

  if (serviceType === "staging"){
    return [
      "Staging & Styling",
      d.STAGING_SCOPE_CLEAR || null,
      d.PROPERTY_DETAILS_CLEAR || null,
      d.LISTING_TIMELINE_CLEAR || null,
      d.notes ? `Notes: ${d.notes}` : null
    ].filter(Boolean).join(" | ");
  }

  return serviceLabel(serviceType);
}

function cleanObject(obj){
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  });
  return out;
}

/**
 * createJobFromIntake(opts)
 *
 * Name kept for backward compatibility with the existing intake forms,
 * but this now saves an intake request instead of creating an open job.
 *
 * The actual job should be created later from:
 * Admin Dashboard → Intake Inbox → Create Job
 */
async function createJobFromIntake(opts = {}){
  const user = auth.currentUser || null;

  const intakeData = opts.intakeData || opts.intake || {};
  const serviceType = normalizeServiceType(opts.type || opts.serviceType, intakeData);
  const estimate = opts.estimate || {};
  const summary = buildBasicSummary(serviceType, intakeData, opts.summary);
  const clientContactClear = intakeData.CLIENT_CONTACT_CLEAR || buildClientContactClear(intakeData);

  const payload = cleanObject({
    requestKind: "website_intake",
    source: "website_intake_form",
    status: "new",
    intakeStatus: "new",

    serviceType,
    serviceLabel: serviceLabel(serviceType),
    type: serviceType,

    summary,
    clientName: intakeData.name || opts.clientName || "",
    clientEmail: intakeData.email || user?.email || opts.clientEmail || "",
    clientPhone: intakeData.phone || "",
    clientUid: user?.uid || "",

    page: intakeData.page || opts.page || "",
    estimate,
    intakeData,

    SERVICE_CATEGORY_CLEAR: intakeData.SERVICE_CATEGORY_CLEAR || serviceLabel(serviceType),
    CLIENT_CONTACT_CLEAR: clientContactClear,
    REQUEST_SUMMARY_CLEAR: intakeData.REQUEST_SUMMARY_CLEAR || summary,

    HOME_LAYOUT_CLEAR: intakeData.HOME_LAYOUT_CLEAR || "",
    PROPERTY_DETAILS_CLEAR: intakeData.PROPERTY_DETAILS_CLEAR || "",
    SPECIALTY_ADDONS_CLEAR: intakeData.SPECIALTY_ADDONS_CLEAR || "",

    ORGANIZING_AREAS_CLEAR: intakeData.ORGANIZING_AREAS_CLEAR || "",
    ORGANIZING_GOALS_CLEAR: intakeData.ORGANIZING_GOALS_CLEAR || "",
    SCHEDULING_PREFERENCES_CLEAR: intakeData.SCHEDULING_PREFERENCES_CLEAR || "",

    DECOR_SCOPE_CLEAR: intakeData.DECOR_SCOPE_CLEAR || "",
    STYLE_GOALS_CLEAR: intakeData.STYLE_GOALS_CLEAR || "",

    HOLIDAY_SCOPE_CLEAR: intakeData.HOLIDAY_SCOPE_CLEAR || "",
    INSTALL_TIMELINE_CLEAR: intakeData.INSTALL_TIMELINE_CLEAR || "",
    TAKEDOWN_NEEDED_CLEAR: intakeData.TAKEDOWN_NEEDED_CLEAR || "",

    STAGING_SCOPE_CLEAR: intakeData.STAGING_SCOPE_CLEAR || "",
    LISTING_TIMELINE_CLEAR: intakeData.LISTING_TIMELINE_CLEAR || "",
    CLIENT_SEGMENT_DETAILS_CLEAR: intakeData.CLIENT_SEGMENT_DETAILS_CLEAR || "",

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user?.email || user?.uid || "public_form"
  });

  try{
    const ref = await addDoc(collection(db, "intakeRequests"), payload);

    if (typeof opts.afterCreate === "function"){
      try { opts.afterCreate(ref.id); } catch {}
    }

    return ref.id;
  } catch(err){
    console.warn("Could not save intake to app Intake Inbox. Formspree/Zapier backup should still send.", err);
    return false;
  }
}

window.FTAuto = { createJobFromIntake };
