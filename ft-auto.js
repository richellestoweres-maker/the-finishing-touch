// === The Finishing Touch — Intake Inbox Save Helper ===
// Purpose: Save website intake submissions into Firestore for the Admin Dashboard Intake Inbox.
// Formspree/Zapier is still handled by each intake form separately.
// Include on intake pages with: <script type="module" src="ft-auto.js"></script>

import { auth, db, storage } from "./ft-firebase.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js";
import {
  collection,
  addDoc,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

/* ---------- Marketing opt-in ("the feed") ----------
   Adds a consent checkbox + optional birthday to the intake form, and upserts a
   subscribers/{emailSlug} record when the person opts in. Used later for holiday,
   birthday, and specials emails (with unsubscribe). Purely additive to the intake. */
const FT_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function injectMarketingFields(){
  try{
    if (document.getElementById("ft-mkt-block")) return;
    const form = document.querySelector("form");
    if (!form) return;
    const block = document.createElement("div");
    block.id = "ft-mkt-block";
    block.style.cssText = "margin:16px 0;padding:13px 15px;border:1px solid #e6dccd;border-radius:12px;background:#fffdf9;font-family:inherit";
    const dayOpts = ['<option value="">Day</option>'].concat(Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}</option>`)).join("");
    const monOpts = ['<option value="">Month</option>'].concat(FT_MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`)).join("");
    block.innerHTML =
      '<label style="display:flex;gap:9px;align-items:flex-start;font-size:14px;cursor:pointer;line-height:1.45">'
      + '<input type="checkbox" id="ft-mkt-consent" style="margin-top:3px;width:16px;height:16px;flex:none">'
      + '<span>Keep me posted — send me seasonal specials, updates, and a little something on my birthday 🎉</span></label>'
      + '<div id="ft-mkt-bday" style="display:none;margin-top:11px;font-size:13px;color:#6c5f52">'
      + '<span style="font-weight:700">My birthday (optional):</span> '
      + '<select id="ft-mkt-bmonth" style="margin-left:6px;padding:6px 8px;border:1px solid #d8cdc0;border-radius:8px;font-family:inherit">'+monOpts+'</select> '
      + '<select id="ft-mkt-bdayn" style="margin-left:4px;padding:6px 8px;border:1px solid #d8cdc0;border-radius:8px;font-family:inherit">'+dayOpts+'</select>'
      + '<div style="margin-top:6px;font-size:11.5px;color:#98897b">We only use this to send you a birthday treat. You can unsubscribe anytime.</div></div>';
    // Sit this just above the Consents box, where people are already reading and
    // ticking things, instead of orphaned down by the submit button.
    const consentFieldset = form.querySelector('fieldset[aria-labelledby="consentLegend"]')
      || Array.from(form.querySelectorAll("fieldset")).find((fs) => /consent/i.test(fs.querySelector("legend")?.textContent || ""));
    const submitBtn = form.querySelector('[type="submit"], button:not([type="button"])');
    if (consentFieldset && consentFieldset.parentElement) consentFieldset.parentElement.insertBefore(block, consentFieldset);
    else if (submitBtn && submitBtn.parentElement) submitBtn.parentElement.insertBefore(block, submitBtn);
    else form.appendChild(block);
    const consent = block.querySelector("#ft-mkt-consent");
    const bday = block.querySelector("#ft-mkt-bday");
    consent.addEventListener("change", () => { bday.style.display = consent.checked ? "" : "none"; });
  } catch(e){ console.warn("Marketing field inject skipped:", e); }
}

function readMarketing(){
  const consent = document.getElementById("ft-mkt-consent");
  return {
    consent: !!(consent && consent.checked),
    birthMonth: safeString(document.getElementById("ft-mkt-bmonth")?.value),
    birthDay: safeString(document.getElementById("ft-mkt-bdayn")?.value)
  };
}

async function saveSubscriber(email, name, phone, page){
  try{
    const mk = readMarketing();
    if (!mk.consent) return;
    const em = safeString(email);
    if (!em) return;
    const slug = em.toLowerCase().replace(/[^a-z0-9]/gi, "_").slice(0, 60);
    await setDoc(doc(db, "subscribers", slug), cleanObject({
      email: em,
      name: safeString(name),
      phone: safeString(phone),
      birthMonth: mk.birthMonth,
      birthDay: mk.birthDay,
      marketingConsent: true,
      subscribed: true,
      source: safeString(page) || "website",
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }), { merge: true });
  } catch(e){ console.warn("Subscriber save skipped:", e); }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectMarketingFields);
else injectMarketingFields();

function safeString(value){
  return (value == null ? "" : String(value)).trim();
}

function firstNonEmpty(...values){
  for (const value of values){
    const clean = safeString(value);
    if (clean) return clean;
  }
  return "";
}

function normalizeServiceType(type, intakeData = {}){
  const raw = safeString(
    type ||
    intakeData.INTERNAL_app_intake_type ||
    intakeData.serviceType ||
    intakeData.service ||
    intakeData.vd_package ||
    intakeData.project_type ||
    intakeData.page ||
    "cleaning"
  ).toLowerCase();

  const page = safeString(intakeData.page).toLowerCase();

  if (
    page.includes("virtual") ||
    raw.includes("virtual") ||
    raw.includes("e-design") ||
    raw.includes("edesign") ||
    raw.includes("online design")
  ){
    return "virtual_design";
  }

  if (page.includes("organizing") || raw.includes("organizing") || raw.includes("organize")){
    return "organizing";
  }

  if (page.includes("decor") || raw.includes("decor") || raw.includes("interior")){
    return "decor";
  }

  if (page.includes("holiday") || raw.includes("holiday") || raw.includes("christmas")){
    return "holiday";
  }

  if (page.includes("staging") || raw.includes("staging") || raw.includes("stage")){
    return "staging";
  }

  if (raw.includes("move")){
    return "move_in_out";
  }

  if (raw.includes("airbnb") || raw.includes("turnover") || raw.includes("short-term rental")){
    return "airbnb";
  }

  if (raw.includes("commercial")){
    return "commercial";
  }

  if (raw.includes("carpet") || raw.includes("upholstery") || raw.includes("grout")){
    return "carpet_upholstery_grout";
  }

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
    virtual_design: "Virtual Design",
    carpet_upholstery_grout: "Carpet, Upholstery & Grout Request"
  };

  return labels[serviceType] || serviceType;
}

function buildClientContactClear(data = {}){
  return [
    data.name ? `Name: ${data.name}` : null,
    data.email ? `Email: ${data.email}` : null,
    data.phone ? `Phone: ${data.phone}` : null,
    data.address ? `Address: ${data.address}` : null,
    data.location && !data.address ? `Location: ${data.location}` : null
  ].filter(Boolean).join(" | ");
}

function buildBasicSummary(serviceType, data = {}, suppliedSummary = ""){
  if (safeString(suppliedSummary)) return suppliedSummary;

  if (
    serviceType === "cleaning" ||
    serviceType === "move_in_out" ||
    serviceType === "airbnb" ||
    serviceType === "commercial" ||
    serviceType === "carpet_upholstery_grout"
  ){
    return [
      serviceLabel(serviceType),
      data.service ? `Service: ${data.service}` : null,
      data.HOME_LAYOUT_CLEAR || null,
      data.PROPERTY_DETAILS_CLEAR || null,
      data.sqft ? `Sq Ft: ${data.sqft}` : null,
      data.general_area ? `Area: ${data.general_area}` : null,
      data.notes ? `Notes: ${data.notes}` : null,
      data.SPECIALTY_ADDONS_CLEAR && data.SPECIALTY_ADDONS_CLEAR !== "None selected"
        ? `Specialty: ${data.SPECIALTY_ADDONS_CLEAR}`
        : null
    ].filter(Boolean).join(" | ");
  }

  if (serviceType === "organizing"){
    return [
      "Home Organizing",
      data.ORGANIZING_AREAS_CLEAR || null,
      data.ORGANIZING_GOALS_CLEAR || null,
      data.SCHEDULING_PREFERENCES_CLEAR || null,
      data.notes ? `Notes: ${data.notes}` : null
    ].filter(Boolean).join(" | ");
  }

  if (serviceType === "decor"){
    return [
      "Interior Decorating / Styling",
      data.DECOR_SCOPE_CLEAR || null,
      data.STYLE_GOALS_CLEAR || null,
      data.notes ? `Notes: ${data.notes}` : null
    ].filter(Boolean).join(" | ");
  }

  if (serviceType === "holiday"){
    return [
      "Holiday Decorating",
      data.HOLIDAY_SCOPE_CLEAR || null,
      data.INSTALL_TIMELINE_CLEAR || null,
      data.TAKEDOWN_NEEDED_CLEAR ? `Teardown: ${data.TAKEDOWN_NEEDED_CLEAR}` : null,
      data.notes ? `Notes: ${data.notes}` : null
    ].filter(Boolean).join(" | ");
  }

  if (serviceType === "staging"){
    return [
      "Staging & Styling",
      data.STAGING_SCOPE_CLEAR || null,
      data.PROPERTY_DETAILS_CLEAR || null,
      data.STYLE_GOALS_CLEAR || null,
      data.LISTING_TIMELINE_CLEAR || null,
      data.CLIENT_SEGMENT_DETAILS_CLEAR || null,
      data.notes ? `Notes: ${data.notes}` : null
    ].filter(Boolean).join(" | ");
  }

  if (serviceType === "virtual_design"){
    return [
      "Virtual Design",
      data.VIRTUAL_DESIGN_SCOPE_CLEAR || null,
      data.STYLE_GOALS_CLEAR || null,
      data.DESIGN_DETAILS_CLEAR || null,
      data.notes ? `Notes: ${data.notes}` : null
    ].filter(Boolean).join(" | ");
  }

  return serviceLabel(serviceType);
}

function cleanObject(obj){
  const out = {};

  Object.entries(obj || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value) && value.length === 0) return;

    out[key] = value;
  });

  return out;
}

function getPrimaryPage(intakeData = {}, opts = {}){
  return firstNonEmpty(
    intakeData.page,
    opts.page,
    window.location?.pathname?.split("/").pop()
  );
}

function getClientName(intakeData = {}, opts = {}){
  return firstNonEmpty(
    intakeData.name,
    intakeData.full_name,
    opts.clientName
  );
}

function getClientEmail(intakeData = {}, user = null, opts = {}){
  return firstNonEmpty(
    intakeData.email,
    user?.email,
    opts.clientEmail
  );
}

function getClientPhone(intakeData = {}, opts = {}){
  return firstNonEmpty(
    intakeData.phone,
    opts.clientPhone
  );
}

/**
 * createJobFromIntake(opts)
 *
 * Name kept for backward compatibility with the existing intake forms,
 * but this saves an intake request instead of creating an open job.
 *
 * The actual job should be created later from:
 * Admin Dashboard → Intake Inbox → Create Job
 */
async function uploadIntakeMedia(intakeData = {}, clientEmail = ""){
  const result = { photoUrls: [], videoUrls: [] };
  try {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const hasFiles = inputs.some(function(i){ return i.files && i.files.length; });
    if (hasFiles && !auth.currentUser) {
      try { await signInAnonymously(auth); await auth.currentUser.getIdToken(true); } catch (e) { console.warn("Anon sign-in for upload failed:", e); }
    }
    const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const emailSlug = (clientEmail || "anon").replace(/[^a-z0-9]/gi, "_").slice(0, 40);
    for (const input of inputs){
      const files = input.files ? Array.from(input.files) : [];
      if (!files.length) continue;
      const accept = (input.getAttribute("accept") || "").toLowerCase();
      const name = (input.getAttribute("name") || "").toLowerCase();
      const isVideo = accept.includes("video") || name.includes("video");
      for (const file of files){
        try {
          const safeName = (file.name || "upload").replace(/[^a-z0-9._-]/gi, "_");
          const path = "intake-media/" + emailSlug + "/" + stamp + "/" + safeName;
          const snap = await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "application/octet-stream" });
          const url = await getDownloadURL(snap.ref);
          (isVideo ? result.videoUrls : result.photoUrls).push(url);
        } catch (err){
          console.warn("Intake media upload failed for a file:", err);
        }
      }
    }
  } catch (err){
    console.warn("Intake media step skipped:", err);
  }
  return result;
}

async function createJobFromIntake(opts = {}){
  const user = auth.currentUser || null;

  const intakeData = opts.intakeData || opts.intake || {};
  const serviceType = normalizeServiceType(opts.type || opts.serviceType, intakeData);
  const estimate = opts.estimate || {};
  const summary = buildBasicSummary(serviceType, intakeData, opts.summary);
  const clientContactClear = intakeData.CLIENT_CONTACT_CLEAR || buildClientContactClear(intakeData);
  const page = getPrimaryPage(intakeData, opts);

  const media = await uploadIntakeMedia(intakeData, getClientEmail(intakeData, user, opts));

  // Marketing feed: add opted-in visitor to the subscribers list (independent of intake save).
  const mk = readMarketing();
  await saveSubscriber(
    getClientEmail(intakeData, user, opts),
    getClientName(intakeData, opts),
    getClientPhone(intakeData, opts),
    page
  );

  const payload = cleanObject({
    marketingConsent: mk.consent,
    birthMonth: mk.birthMonth,
    birthDay: mk.birthDay,
    requestKind: "website_intake",
    source: "website_intake_form",
    status: "new",
    intakeStatus: "new",

    serviceType,
    serviceLabel: serviceLabel(serviceType),
    type: serviceType,

    summary,

    clientName: getClientName(intakeData, opts),
    clientEmail: getClientEmail(intakeData, user, opts),
    clientPhone: getClientPhone(intakeData, opts),
    clientUid: user?.uid || "",

    page,
    estimate,
    intakeData,
    mediaPhotoUrls: media.photoUrls,
    mediaVideoUrls: media.videoUrls,
    mediaCount: media.photoUrls.length + media.videoUrls.length,
    hasMedia: (media.photoUrls.length + media.videoUrls.length) > 0,

    SERVICE_CATEGORY_CLEAR: intakeData.SERVICE_CATEGORY_CLEAR || serviceLabel(serviceType),
    CLIENT_CONTACT_CLEAR: clientContactClear,
    REQUEST_SUMMARY_CLEAR: intakeData.REQUEST_SUMMARY_CLEAR || summary,

    HOME_LAYOUT_CLEAR: intakeData.HOME_LAYOUT_CLEAR || "",
    PROPERTY_DETAILS_CLEAR: intakeData.PROPERTY_DETAILS_CLEAR || "",
    SPECIALTY_ADDONS_CLEAR: intakeData.SPECIALTY_ADDONS_CLEAR || "",
    SPECIALTY_ADDON_NOTES_CLEAR: intakeData.SPECIALTY_ADDON_NOTES_CLEAR || "",

    ORGANIZING_AREAS_CLEAR: intakeData.ORGANIZING_AREAS_CLEAR || "",
    ORGANIZING_GOALS_CLEAR: intakeData.ORGANIZING_GOALS_CLEAR || "",
    SCHEDULING_PREFERENCES_CLEAR: intakeData.SCHEDULING_PREFERENCES_CLEAR || "",

    DECOR_SCOPE_CLEAR: intakeData.DECOR_SCOPE_CLEAR || "",
    STYLE_GOALS_CLEAR: intakeData.STYLE_GOALS_CLEAR || "",
    DESIGN_DETAILS_CLEAR: intakeData.DESIGN_DETAILS_CLEAR || "",

    HOLIDAY_SCOPE_CLEAR: intakeData.HOLIDAY_SCOPE_CLEAR || "",
    INSTALL_TIMELINE_CLEAR: intakeData.INSTALL_TIMELINE_CLEAR || "",
    TAKEDOWN_NEEDED_CLEAR: intakeData.TAKEDOWN_NEEDED_CLEAR || "",

    STAGING_SCOPE_CLEAR: intakeData.STAGING_SCOPE_CLEAR || "",
    LISTING_TIMELINE_CLEAR: intakeData.LISTING_TIMELINE_CLEAR || "",
    CLIENT_SEGMENT_DETAILS_CLEAR: intakeData.CLIENT_SEGMENT_DETAILS_CLEAR || "",

    VIRTUAL_DESIGN_SCOPE_CLEAR: intakeData.VIRTUAL_DESIGN_SCOPE_CLEAR || "",

    INTERNAL_app_intake_type: intakeData.INTERNAL_app_intake_type || serviceType,
    INTERNAL_estimate_method: intakeData.INTERNAL_estimate_method || "",
    INTERNAL_service_format: intakeData.INTERNAL_service_format || "",
    INTERNAL_project_summary: intakeData.INTERNAL_project_summary || "",

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user?.email || user?.uid || "public_form"
  });

  // Debug helpers for testing in browser console
  window.FTAutoLastIntakePayload = payload;

  try{
    const ref = await addDoc(collection(db, "intakeRequests"), payload);

    window.FTAutoLastIntakeId = ref.id;
    window.FTAutoLastError = null;

    if (typeof opts.afterCreate === "function"){
      try {
        opts.afterCreate(ref.id);
      } catch {}
    }

    return ref.id;
  } catch(err){
    window.FTAutoLastError = err;

    console.warn(
      "Could not save intake to app Intake Inbox. Formspree/Zapier backup should still send.",
      err
    );

    return false;
  }
}

window.FTAuto = { createJobFromIntake };
