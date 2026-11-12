// === Ivy: the job pipeline ===
//
// Ivy as the middle man between client, sub and Richelle, from intake to invoice.
//
//   1. A new intake comes in for a service Richelle has given a sub (cleaning is
//      Maggie). Ivy sends the sub the job to price in her portal and texts her.
//   2. The sub prices it. Ivy thanks her and texts Richelle the price. Richelle
//      replies with her markup (18, 20, 25, 30...). Ivy works out the client
//      price and emails the client a formal quote.
//   3. The client opens the quote, says yes and picks up to three days that
//      suit them, or says no thanks.
//   4. On a yes, Ivy makes the job, gives it to the sub and texts her the
//      client's days. The sub accepts one in her portal (or offers others,
//      which Ivy emails back to the client to pick from).
//   5. Once a time is agreed, Ivy emails the client their confirmation and
//      texts Richelle.
//   6. Sunday at 5 pm Ivy texts each sub the week ahead, with addresses, and
//      emails each client a reminder.
//   7. Weekdays at 4:30 pm Ivy texts Richelle the invoices ready for jobs the
//      crew has finished. At 5 pm she sends them through Square, unless held.
//
// Everything is driven by tick(), which Cloud Scheduler calls every 10 minutes
// and which the website pokes whenever something happens, so most steps happen
// within seconds. Every step records that it ran, so a tick can run any number
// of times without sending anything twice.

import crypto from "node:crypto";
import { db, FieldValue } from "./store.js";
import { sendSms, normalizePhone, prettyPhone } from "./sms.js";
import { sendJobInvoice, squareConfigured, squareScopes } from "./square.js";

const SITE = "https://www.thefinishingtouch-tx.com";
const SETTINGS = db.collection("settings").doc("pipeline");
const LINKS = db.collection("quoteLinks");
const TZ = "America/Chicago";
const FINISHED = ["submitted_for_review", "approved", "completion_package_sent", "payout_pending", "paid", "completed"];
const WINDOWS = {
  morning: "Morning (8 to 12)", midday: "Midday (11 to 2)", afternoon: "Afternoon (12 to 4)",
  evening: "Evening (4 to 7)", anytime: "Anytime that day"
};
const PHONE_LINE = "(281) 620-3963";
const BIZ_EMAIL = "contact.thefinishingtouch.tx@gmail.com";

/* ------------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------------ */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `$${Number(n || 0).toFixed(2).replace(/\.00$/, "")}`;
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
const shortName = (n) => {
  const parts = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "the client";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};
const winLabel = (w) => WINDOWS[w] || w || "";

/** Today in Texas as YYYY-MM-DD, plus the weekday and minutes since midnight. */
export function texasNow(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minutes: hour * 60 + Number(parts.minute)
  };
}

function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v._seconds) return v._seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function normService(v) {
  const s = String(v || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!s) return "";
  if (s.includes("reset") || s.includes("concierge")) return "home_reset";
  if (s.includes("virtual")) return "virtual_design";
  if (s.includes("clean") || ["airbnb", "turnover", "commercial", "office", "post_construction", "move_in_out"].includes(s)) return "cleaning";
  if (s.includes("organiz")) return "organizing";
  if (s.includes("holiday") || s.includes("christmas")) return "holiday";
  if (s.includes("stag")) return "staging";
  if (s.includes("decor") || s.includes("styl") || s.includes("interior")) return "decor";
  return s;
}

export async function getPipelineSettings() {
  const snap = await SETTINGS.get();
  return { autopilot: false, subsByService: {}, ...(snap.exists ? snap.data() : {}) };
}

async function userById(uid) {
  if (!uid) return null;
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? { id: uid, ...snap.data() } : null;
}
const personName = (u) => (u && (u.displayName || u.fullName || u.name || u.application?.fullName || u.email)) || "";
const personPhone = (u) => normalizePhone((u && (u.phone || u.phoneNumber || u.mobile || u.application?.phone || u.profile?.phone)) || "");

/** Fire and forget a text, never letting one failure stop the pipeline. */
async function text(to, body, label) {
  const phone = normalizePhone(to);
  if (!phone) { console.warn(`[ivy pipeline] no phone for ${label || "text"}`); return false; }
  try { await sendSms(phone, body); return true; }
  catch (err) { console.error(`[ivy pipeline] text to ${label || phone} failed:`, err.message); return false; }
}

function intakeArea(r) {
  const d = r.intakeData || {};
  const city = d.city || r.city || "";
  const zip = d.zip || d.zipcode || d.zip_code || r.zip || "";
  return [city, zip].filter(Boolean).join(" ");
}
function intakeAddress(r) {
  const d = r.intakeData || {};
  const line = d.address || d.street || d.service_address || "";
  const city = d.city || "";
  const zip = d.zip || d.zipcode || d.zip_code || "";
  return [line, [city, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
function intakeDays(r) {
  const d = r.intakeData || {};
  return String(d.availability || d.preferred_days || d.best_days || r.SCHEDULING_PREFERENCES_CLEAR || "").trim();
}

/* ------------------------------------------------------------------
   Email: written to the `mail` collection, which the Trigger Email
   extension delivers from the business Gmail, so replies come home.
   ------------------------------------------------------------------ */

function shell(inner) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3efe8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe8;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border:1px solid #e8ded2;border-radius:14px;overflow:hidden;">
<tr><td style="padding:26px 30px 6px 30px;text-align:center;font-family:Georgia,serif;font-size:25px;color:#2b2622;">The Finishing Touch</td></tr>
<tr><td style="padding:14px 30px 26px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15.5px;line-height:1.65;color:#2b2622;">${inner}</td></tr>
<tr><td style="padding:16px 30px 22px 30px;border-top:1px solid #eee5da;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.6;color:#8a7d6f;text-align:center;">
The Finishing Touch &middot; <a href="${SITE}" style="color:#8a7d6f;">thefinishingtouch-tx.com</a> &middot; ${PHONE_LINE}<br>903 Texas Ave, La Marque, TX 77568</td></tr>
</table></td></tr></table></body></html>`;
}
const p = (t) => `<p style="margin:0 0 14px 0;">${t}</p>`;
const button = (href, label) =>
  `<p style="margin:22px 0;text-align:center;"><a href="${href}" style="display:inline-block;background:#2f2926;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;">${esc(label)}</a></p>`;
const signoff = () => p(`Warmly,<br>Richelle<br>Owner, The Finishing Touch<br>${PHONE_LINE}<br><a href="mailto:${BIZ_EMAIL}" style="color:#2b2622;">${BIZ_EMAIL}</a>`);

async function email(to, subject, inner, meta = {}) {
  if (!to) return false;
  await db.collection("mail").add({
    to: String(to).trim().toLowerCase(),
    replyTo: BIZ_EMAIL,
    message: { subject, html: shell(inner) },
    source: "ivy_pipeline",
    ...meta,
    createdAt: FieldValue.serverTimestamp()
  });
  return true;
}

/* ------------------------------------------------------------------
   Quote links: one secret per quote, kept where no browser can read it
   ------------------------------------------------------------------ */

async function linkFor(quoteId) {
  const existing = await LINKS.where("quoteId", "==", quoteId).limit(1).get();
  if (!existing.empty) return existing.docs[0].id;
  const token = crypto.randomBytes(18).toString("base64url");
  await LINKS.doc(token).set({ quoteId, createdAt: FieldValue.serverTimestamp() });
  return token;
}
export async function quoteFromToken(token) {
  if (!token || !/^[\w-]{16,40}$/.test(token)) return null;
  const link = await LINKS.doc(token).get();
  if (!link.exists) return null;
  const qRef = db.collection("quoteRequests").doc(link.data().quoteId);
  const q = await qRef.get();
  if (!q.exists) return null;
  return { ref: qRef, q: { id: q.id, ...q.data() } };
}
const quoteUrl = (token) => `${SITE}/quote.html?t=${encodeURIComponent(token)}`;

/* ------------------------------------------------------------------
   Step 1: new intake goes to the sub
   ------------------------------------------------------------------ */

async function routeNewIntakes(settings, notifyOwner, log) {
  if (!settings.autopilot) return;
  const since = millis(settings.autopilotSince) || Date.now();
  const snap = await db.collection("intakeRequests").orderBy("createdAt", "desc").limit(40).get();
  for (const d of snap.docs) {
    const r = { id: d.id, ...d.data() };
    if (r.pipelineStage || millis(r.createdAt) < since) continue;
    if (String(r.status || "new") !== "new") continue;
    const service = normService(r.serviceType || r.type);
    const subUid = (settings.subsByService || {})[service];
    if (!subUid) { await d.ref.set({ pipelineStage: "manual", pipelineNote: `No sub set for ${service || "this service"}` }, { merge: true }); continue; }

    const already = await db.collection("quoteRequests").where("intakeId", "==", r.id).limit(1).get();
    if (!already.empty) { await d.ref.set({ pipelineStage: "manual", pipelineNote: "Quote already started by hand" }, { merge: true }); continue; }

    const sub = await userById(subUid);
    const q = {
      intakeId: r.id,
      offeredTo: [subUid],
      offeredNames: [personName(sub)],
      status: "awaiting_sub_quote",
      serviceType: r.serviceType || service,
      serviceLabel: r.serviceLabel || "",
      scopeSummary: r.REQUEST_SUMMARY_CLEAR || r.summary || "",
      layout: r.HOME_LAYOUT_CLEAR || r.PROPERTY_DETAILS_CLEAR || "",
      addons: (r.SPECIALTY_ADDONS_CLEAR && r.SPECIALTY_ADDONS_CLEAR !== "None selected") ? r.SPECIALTY_ADDONS_CLEAR : "",
      addonNotes: r.SPECIALTY_ADDON_NOTES_CLEAR || "",
      clientDays: intakeDays(r),
      area: intakeArea(r),
      mediaPhotoUrls: Array.isArray(r.mediaPhotoUrls) ? r.mediaPhotoUrls : [],
      mediaVideoUrls: Array.isArray(r.mediaVideoUrls) ? r.mediaVideoUrls : [],
      subRate: null, subUid: "", subNote: "", clientPrice: null,
      ivyManaged: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: "ivy"
      // No client name, contact or street address: the sub sees those only once it is booked.
    };
    const ref = await db.collection("quoteRequests").add(q);
    await d.ref.set({ pipelineStage: "sent_to_sub", quoteRequestId: ref.id, intakeStatus: "sent_to_sub", updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    const what = r.serviceLabel || service;
    const texted = await text(personPhone(sub),
      `Hi ${firstName(personName(sub))}! New ${what} to price${q.area ? ` in ${q.area}` : ""}. ` +
      `Photos and details are in your portal under Quote Requests: ${SITE}/contractor-dashboard.html` +
      `${q.clientDays ? `\nClient's best days: ${q.clientDays}` : ""}\nThank you!`, "sub");
    if (!texted) await notifyOwner(`I put a new ${what} in ${personName(sub) || "the sub"}'s portal to price, but couldn't text them. Their profile has no phone number.`);
    log.push(`sent intake ${r.id} to ${personName(sub)}`);
  }
}

/* ------------------------------------------------------------------
   Step 2: sub priced it, ask Richelle for the markup
   ------------------------------------------------------------------ */

async function pendingMarkups() {
  const snap = await db.collection("quoteRequests").where("status", "==", "sub_quoted").limit(30).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((q) => q.ivyManaged && q.markupAskedAt && !q.markupPct)
    .sort((a, b) => millis(a.markupAskedAt) - millis(b.markupAskedAt));
}

async function askForMarkups(notifyOwner, log) {
  const snap = await db.collection("quoteRequests").where("status", "==", "sub_quoted").limit(30).get();
  for (const d of snap.docs) {
    const q = { id: d.id, ...d.data() };
    if (!q.ivyManaged || q.markupAskedAt) continue;
    const intake = q.intakeId ? (await db.collection("intakeRequests").doc(q.intakeId).get()).data() || {} : {};
    const sub = await userById(q.subUid);
    await d.ref.set({ markupAskedAt: FieldValue.serverTimestamp() }, { merge: true });

    // Her own words for acknowledging a sub's price.
    await text(personPhone(sub), "Thank you! Richelle will review and I'll let you know if she accepts or has questions.", "sub");

    const waiting = await pendingMarkups();
    const n = waiting.findIndex((w) => w.id === q.id) + 1;
    const how = waiting.length > 1
      ? `${waiting.length} quotes waiting. Reply Q${n} 25 (or 18, 20, 30) for this one, or Q${n} SKIP to price it yourself.`
      : "Reply 18, 20, 25 or 30 for your markup, or SKIP to price it yourself.";
    await notifyOwner(
      `${personName(sub) || "Your sub"} quoted ${money(q.subRate)} for ${shortName(intake.clientName)}, ` +
      `${q.serviceLabel || q.serviceType}${q.area ? ` in ${q.area}` : ""}.` +
      `${q.subNote ? `\nTheir note: "${String(q.subNote).slice(0, 160)}"` : ""}\n${how}`
    );
    log.push(`asked markup for quote ${q.id}`);
  }
}

/** Richelle's reply to a markup ask. Returns a reply string, or null if it was not one. */
export async function handleMarkupCommand(textIn, notifyOwner) {
  const m = String(textIn || "").trim().match(/^(?:q\s*(\d{1,2})\s+)?(\d{1,2}(?:\.\d)?\s*%?|skip)\s*$/i);
  if (!m) return null;
  const waiting = await pendingMarkups();
  if (!waiting.length) return null;
  const pick = m[1] ? Number(m[1]) : (waiting.length === 1 ? 1 : 0);
  if (!pick) return `${waiting.length} quotes are waiting, so tell me which: ` + waiting.map((w, i) => `Q${i + 1} ${money(w.subRate)} ${w.serviceLabel || w.serviceType}${w.area ? ` (${w.area})` : ""}`).join("; ");
  const q = waiting[pick - 1];
  if (!q) return `There is no Q${pick}. ${waiting.length} waiting.`;
  const ref = db.collection("quoteRequests").doc(q.id);

  if (/skip/i.test(m[2])) {
    await ref.set({ ivyManaged: false, markupSkippedAt: FieldValue.serverTimestamp() }, { merge: true });
    return `Okay, that one's yours. It's in the Intake Inbox to price by hand.`;
  }
  const pct = Number(String(m[2]).replace("%", ""));
  if (!(pct >= 5 && pct <= 80)) return "Send the markup as a number like 18, 20, 25 or 30.";
  const price = Math.round(Number(q.subRate) * (1 + pct / 100));
  await ref.set({
    markupPct: pct, clientPrice: price, status: "priced", pricedAt: FieldValue.serverTimestamp(), pricedBy: "ivy",
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  const sent = await sendQuoteEmail({ ...q, clientPrice: price, markupPct: pct });
  return sent
    ? `Quote sent to ${sent} for ${money(price)} (${money(q.subRate)} to the sub, ${money(price - q.subRate)} to you).`
    : `Priced at ${money(price)}, but the intake has no client email, so I couldn't send it. It's in the Intake Inbox.`;
}

/* ------------------------------------------------------------------
   Step 2b: the quote email
   ------------------------------------------------------------------ */

async function sendQuoteEmail(q) {
  const intakeSnap = q.intakeId ? await db.collection("intakeRequests").doc(q.intakeId).get() : null;
  const r = intakeSnap && intakeSnap.exists ? intakeSnap.data() : {};
  if (!r.clientEmail) return "";
  const token = await linkFor(q.id);
  const service = q.serviceLabel || q.serviceType || "service";
  const include = [q.scopeSummary, q.layout, q.addons].filter(Boolean)
    .map((t) => `<li style="margin:0 0 6px 0;">${esc(t)}</li>`).join("");

  const inner =
    p(`Hi ${esc(firstName(r.clientName))},`) +
    p(`Thank you so much for sending everything over! Here's your quote for your ${esc(service)}${q.area ? ` in ${esc(q.area)}` : ""}.`) +
    `<p style="margin:18px 0;text-align:center;font-family:Georgia,serif;font-size:30px;color:#2b2622;">${money(q.clientPrice)}</p>` +
    (include ? `<p style="margin:0 0 6px 0;font-weight:700;">Based on what you shared</p><ul style="margin:0 0 14px 18px;padding:0;">${include}</ul>` : "") +
    p(`Pricing is based on your photos and details. If anything is very different when we arrive, we'll talk with you before making any change.`) +
    p(`We schedule Monday through Friday. Your invoice comes by email through Square when the job is done and is due on receipt.`) +
    p(`If it looks good, tap below to accept and choose the days that work best for you, and we'll get you on the calendar.`) +
    button(quoteUrl(token), "Accept and choose my days") +
    p(`<span style="font-size:13.5px;color:#6c5f52;">Not the right fit? <a href="${quoteUrl(token)}&no=1" style="color:#6c5f52;">Let us know here</a>, no hard feelings.</span>`) +
    signoff();

  await email(r.clientEmail, `Your quote from The Finishing Touch: ${service}`, inner, { quoteRequestId: q.id });
  await db.collection("quoteRequests").doc(q.id).set({ quoteSentAt: FieldValue.serverTimestamp(), quoteToken: token.slice(0, 4) + "…" }, { merge: true });
  if (q.intakeId) await db.collection("intakeRequests").doc(q.intakeId).set({ pipelineStage: "quote_sent", intakeStatus: "quote_sent" }, { merge: true });
  return r.clientEmail;
}

/* ------------------------------------------------------------------
   Step 3: the client answers the quote (called from quote.html)
   ------------------------------------------------------------------ */

export async function quoteView(token) {
  const found = await quoteFromToken(token);
  if (!found) return null;
  const { q } = found;
  const r = q.intakeId ? (await db.collection("intakeRequests").doc(q.intakeId).get()).data() || {} : {};
  let job = null;
  if (q.jobId) {
    const j = await db.collection("jobs").doc(q.jobId).get();
    if (j.exists) job = j.data();
  }
  let stage = "quote";
  if (q.clientDecision === "declined") stage = "declined";
  else if (job && job.schedStatus === "confirmed") stage = "booked";
  else if (job && job.schedStatus === "sub_proposed") stage = "pick";
  else if (job) stage = "waiting";
  return {
    stage,
    firstName: firstName(r.clientName),
    service: q.serviceLabel || q.serviceType || "Service",
    area: q.area || "",
    price: q.clientPrice,
    summary: [q.scopeSummary, q.layout, q.addons].filter(Boolean),
    clientDays: q.clientDays || "",
    options: job?.clientDatePref?.options || [],
    slots: stage === "pick" ? (job.subProposedSlots || []) : [],
    booked: stage === "booked" ? { date: job.scheduledDate, window: job.scheduledWindow, arrival: job.arrivalTime || "" } : null
  };
}

export async function quoteRespond(token, body, notifyOwner) {
  const found = await quoteFromToken(token);
  if (!found) throw new Error("This quote link isn't valid anymore. Please call or text us.");
  const { ref, q } = found;
  if (q.clientPrice == null) throw new Error("This quote isn't ready yet.");
  const r = q.intakeId ? (await db.collection("intakeRequests").doc(q.intakeId).get()).data() || {} : {};
  const today = texasNow().date;

  if (body.decision === "decline") {
    if (q.jobId) throw new Error("This one is already booked. Please call or text us to change it.");
    const why = String(body.note || "").slice(0, 500);
    await ref.set({ clientDecision: "declined", clientDecisionAt: FieldValue.serverTimestamp(), clientDeclineNote: why, status: "declined" }, { merge: true });
    if (q.intakeId) await db.collection("intakeRequests").doc(q.intakeId).set({ pipelineStage: "declined", intakeStatus: "declined" }, { merge: true });
    await notifyOwner(`${shortName(r.clientName)} passed on the ${money(q.clientPrice)} ${q.serviceLabel || q.serviceType} quote.${why ? ` They said: "${why.slice(0, 200)}"` : ""}`);
    return { ok: true, stage: "declined" };
  }

  if (body.decision === "accept") {
    if (q.jobId) return { ok: true, stage: "waiting" };
    const options = (Array.isArray(body.options) ? body.options : [])
      .map((o) => ({ date: String(o.date || "").slice(0, 10), window: WINDOWS[o.window] ? o.window : "anytime" }))
      .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.date > today)
      .filter((o) => { const wd = new Date(o.date + "T12:00:00Z").getUTCDay(); return wd >= 1 && wd <= 5; })
      .slice(0, 3);
    if (!options.length) throw new Error("Pick at least one weekday that works for you.");
    const note = String(body.note || "").slice(0, 600);

    const subUid = q.subUid || (q.offeredTo || [])[0] || "";
    const d = r.intakeData || {};
    const job = {
      // "claimed" with the sub already on it is what the crew's job run screen
      // needs before it will let her check in.
      status: "claimed",
      workflowStatus: "assigned",
      claimedAt: FieldValue.serverTimestamp(),
      source: "ivy_quote",
      ivyManaged: true,
      intakeId: q.intakeId || "",
      quoteRequestId: q.id,
      serviceType: r.serviceType || q.serviceType || "cleaning",
      serviceLabel: r.serviceLabel || q.serviceLabel || "",
      summary: r.REQUEST_SUMMARY_CLEAR || r.summary || q.scopeSummary || "",
      notes: [r.SPECIALTY_ADDON_NOTES_CLEAR || "", note ? `Client note: ${note}` : ""].filter(Boolean).join("\n"),
      clientName: r.clientName || "",
      clientEmail: r.clientEmail || "",
      clientPhone: r.clientPhone || "",
      clientUid: r.clientUid || "",
      clientId: r.clientUid || "",
      address: intakeAddress(r),
      area: q.area || "",
      zip: d.zip || d.zipcode || "",
      subRate: Number(q.subRate) || null,
      clientPrice: Number(q.clientPrice) || null,
      serviceFee: Number((Number(q.clientPrice) - Number(q.subRate)).toFixed(2)),
      markupPct: q.markupPct || null,
      subUid,
      contractorIds: subUid ? [subUid] : [],
      HOME_LAYOUT_CLEAR: r.HOME_LAYOUT_CLEAR || "",
      PROPERTY_DETAILS_CLEAR: r.PROPERTY_DETAILS_CLEAR || "",
      SPECIALTY_ADDONS_CLEAR: r.SPECIALTY_ADDONS_CLEAR || "",
      schedStatus: "awaiting_sub",
      clientDatePref: { mode: "options", options, window: options[0].window },
      subProposedSlots: [], subDecision: "", subResponseNote: "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: "ivy"
    };
    const jobRef = await db.collection("jobs").add(job);
    await ref.set({ clientDecision: "accepted", clientDecisionAt: FieldValue.serverTimestamp(), status: "converted", jobId: jobRef.id }, { merge: true });
    if (q.intakeId) await db.collection("intakeRequests").doc(q.intakeId).set({ pipelineStage: "booking", intakeStatus: "accepted", jobId: jobRef.id }, { merge: true });

    const sub = await userById(subUid);
    const days = options.map((o) => `${prettyDate(o.date)} ${winLabel(o.window).toLowerCase()}`).join("; ");
    await text(personPhone(sub),
      `Good news! ${shortName(r.clientName)} said yes to the ${job.serviceLabel || job.serviceType}${job.area ? ` in ${job.area}` : ""}. ` +
      `They can do: ${days}. Please pick one in your portal under Schedule, or offer other times: ${SITE}/contractor-dashboard.html`, "sub");
    await notifyOwner(`${shortName(r.clientName)} accepted the ${money(q.clientPrice)} ${job.serviceLabel || job.serviceType} quote. Days they offered: ${days}. I've sent them to ${personName(sub) || "the sub"} to pick.`);
    return { ok: true, stage: "waiting" };
  }

  if (body.decision === "pick") {
    if (!q.jobId) throw new Error("Please accept the quote first.");
    const jRef = db.collection("jobs").doc(q.jobId);
    const j = (await jRef.get()).data() || {};
    if (j.schedStatus === "confirmed") return { ok: true, stage: "booked" };
    if (body.none) {
      const note = String(body.note || "").slice(0, 500);
      await jRef.set({ schedStatus: "client_needs_call", clientResponseNote: note, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await notifyOwner(`${shortName(j.clientName)} said none of ${personName(await userById(j.subUid)) || "the sub"}'s times work for the ${j.serviceLabel || j.serviceType}.${note ? ` They said: "${note.slice(0, 200)}"` : ""} This one needs you.`);
      return { ok: true, stage: "waiting" };
    }
    const slot = (j.subProposedSlots || [])[Number(body.index)];
    if (!slot) throw new Error("Please choose one of the times shown.");
    await jRef.set({
      schedStatus: "confirmed", subDecision: "client_picked",
      scheduledDate: slot.date, scheduledWindow: slot.window, arrivalTime: slot.arrival || "",
      scheduledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true, stage: "booked" };
  }
  throw new Error("Unknown answer.");
}

/* ------------------------------------------------------------------
   Step 4: the sub accepts a day or offers others (from her portal)
   ------------------------------------------------------------------ */

export async function subSchedule(uid, body) {
  const jRef = db.collection("jobs").doc(String(body.jobId || ""));
  const snap = await jRef.get();
  if (!snap.exists) throw new Error("Job not found.");
  const j = snap.data();
  if (!(j.contractorIds || []).includes(uid)) throw new Error("This job isn't assigned to you.");
  const today = texasNow().date;

  if (body.action === "accept") {
    const date = String(body.date || "").slice(0, 10);
    const window = WINDOWS[body.window] ? body.window : "anytime";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today) throw new Error("Pick a date after today.");
    const arrival = String(body.arrival || "").slice(0, 10);
    await jRef.set({
      schedStatus: "confirmed", subDecision: "accepted", scheduledDate: date, scheduledWindow: window, arrivalTime: arrival,
      scheduledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true };
  }
  if (body.action === "propose") {
    const slots = (Array.isArray(body.slots) ? body.slots : [])
      .map((s) => ({ date: String(s.date || "").slice(0, 10), window: WINDOWS[s.window] ? s.window : "anytime", arrival: String(s.arrival || "").slice(0, 10) }))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.date > today)
      .slice(0, 4);
    if (!slots.length) throw new Error("Add at least one date you can do.");
    await jRef.set({
      schedStatus: "sub_proposed", subDecision: "proposed", subProposedSlots: slots,
      subResponseNote: String(body.note || "").slice(0, 500), clientPickSentAt: null,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true };
  }
  throw new Error("Unknown action.");
}

/* ------------------------------------------------------------------
   Step 5: tell the client what was agreed, or ask them to pick
   ------------------------------------------------------------------ */

async function followUpJobs(notifyOwner, log) {
  const snap = await db.collection("jobs").where("ivyManaged", "==", true).limit(200).get();
  for (const d of snap.docs) {
    const j = { id: d.id, ...d.data() };

    if (j.schedStatus === "sub_proposed" && !j.clientPickSentAt && j.clientEmail && j.quoteRequestId) {
      const token = await linkFor(j.quoteRequestId);
      const list = (j.subProposedSlots || []).map((s) => `<li>${esc(prettyDate(s.date))}, ${esc(winLabel(s.window).toLowerCase())}${s.arrival ? `, arriving around ${esc(s.arrival)}` : ""}</li>`).join("");
      await email(j.clientEmail, "Let's pick your day",
        p(`Hi ${esc(firstName(j.clientName))},`) +
        p(`Our team isn't free on the days you picked, but they can come on any of these:`) +
        `<ul style="margin:0 0 14px 18px;padding:0;">${list}</ul>` +
        p(`Tap below to choose the one that works best, and you're all set.`) +
        button(quoteUrl(token), "Choose my day") + signoff(), { jobId: j.id });
      await d.ref.set({ clientPickSentAt: FieldValue.serverTimestamp() }, { merge: true });
      log.push(`asked client to pick for job ${j.id}`);
    }

    if (j.schedStatus === "confirmed" && j.scheduledDate && !j.confirmationSentAt) {
      const when = `${prettyDate(j.scheduledDate)}, ${winLabel(j.scheduledWindow).toLowerCase()}${j.arrivalTime ? `, arriving around ${j.arrivalTime}` : ""}`;
      if (j.clientEmail) {
        await email(j.clientEmail, `You're booked: ${j.serviceLabel || j.serviceType}, ${prettyDate(j.scheduledDate)}`,
          p(`Hi ${esc(firstName(j.clientName))},`) +
          p(`You're all set! Here are your details:`) +
          `<table role="presentation" style="margin:0 0 16px 0;font-size:15px;">` +
          `<tr><td style="padding:3px 14px 3px 0;color:#6c5f52;">Service</td><td><strong>${esc(j.serviceLabel || j.serviceType)}</strong></td></tr>` +
          `<tr><td style="padding:3px 14px 3px 0;color:#6c5f52;">When</td><td><strong>${esc(when)}</strong></td></tr>` +
          (j.address ? `<tr><td style="padding:3px 14px 3px 0;color:#6c5f52;">Where</td><td>${esc(j.address)}</td></tr>` : "") +
          `<tr><td style="padding:3px 14px 3px 0;color:#6c5f52;">Price</td><td>${money(j.clientPrice)}</td></tr></table>` +
          p(`If there's a gate code, a front desk, pets, or anything else the team should know before they arrive, just reply to this email or add it in your client portal.`) +
          p(`We'll send a reminder the week before. We can't wait to take care of your home!`) +
          signoff(), { jobId: j.id });
      }
      const sub = await userById(j.subUid);
      if (j.subDecision === "client_picked") {
        await text(personPhone(sub), `${shortName(j.clientName)} picked ${when} for the ${j.serviceLabel || j.serviceType}. It's on your schedule in the portal. Thank you!`, "sub");
      }
      await notifyOwner(`Booked: ${shortName(j.clientName)}, ${j.serviceLabel || j.serviceType}, ${when}, with ${personName(sub) || "your sub"}. ${money(j.clientPrice)} (${money(j.subRate)} to the sub).`);
      await d.ref.set({ confirmationSentAt: FieldValue.serverTimestamp() }, { merge: true });
      if (j.intakeId) await db.collection("intakeRequests").doc(j.intakeId).set({ pipelineStage: "booked", intakeStatus: "booked" }, { merge: true });
      log.push(`confirmed job ${j.id}`);
    }
  }
}

/* ------------------------------------------------------------------
   Step 6: Sunday 5 pm, the week ahead
   ------------------------------------------------------------------ */

async function sundayReminders(now, log) {
  if (now.weekday !== "Sun" || now.minutes < 17 * 60) return;
  const weekKey = now.date;
  const flag = db.collection("ivyPrivate").doc("weeklyReminders");
  const last = (await flag.get()).data() || {};
  if (last.week === weekKey) return;
  await flag.set({ week: weekKey, at: FieldValue.serverTimestamp() });

  const monday = addDays(now.date, 1);
  const friday = addDays(now.date, 5);
  const snap = await db.collection("jobs").where("schedStatus", "==", "confirmed").limit(300).get();
  const week = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((j) => j.scheduledDate >= monday && j.scheduledDate <= friday)
    .sort((a, b) => (a.scheduledDate + (a.arrivalTime || a.scheduledWindow)).localeCompare(b.scheduledDate + (b.arrivalTime || b.scheduledWindow)));

  const bySub = new Map();
  for (const j of week) {
    for (const uid of j.contractorIds || []) {
      if (!bySub.has(uid)) bySub.set(uid, []);
      bySub.get(uid).push(j);
    }
  }
  for (const [uid, jobs] of bySub) {
    const sub = await userById(uid);
    const lines = jobs.map((j) => [
      `${prettyDate(j.scheduledDate)}, ${j.arrivalTime || winLabel(j.scheduledWindow)}`,
      `${shortName(j.clientName)}, ${j.serviceLabel || j.serviceType}`,
      j.address ? j.address : (j.area || ""),
      j.subRate ? `Pay: ${money(j.subRate)} flat rate` : ""
    ].filter(Boolean).join("\n")).join("\n\n");
    await text(personPhone(sub),
      `Hi ${firstName(personName(sub))}! Your Finishing Touch jobs this week:\n\n${lines}\n\n` +
      `Full details and entry notes are in your portal. Before and after photos are required for payment. Thank you!`, "sub");
  }
  for (const j of week.filter((x) => x.ivyManaged && x.clientEmail && !x.weekReminderSentAt)) {
    await email(j.clientEmail, `See you ${prettyDate(j.scheduledDate)}!`,
      p(`Hi ${esc(firstName(j.clientName))},`) +
      p(`A quick reminder that your ${esc(j.serviceLabel || j.serviceType)} is coming up on <strong>${esc(prettyDate(j.scheduledDate))}</strong>, ${esc(j.arrivalTime ? `arriving around ${j.arrivalTime}` : winLabel(j.scheduledWindow).toLowerCase())}.`) +
      p(`If anything has changed, or there's anything the team should know before they arrive, just reply to this email.`) + signoff(), { jobId: j.id });
    await db.collection("jobs").doc(j.id).set({ weekReminderSentAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  log.push(`sunday reminders: ${week.length} jobs, ${bySub.size} subs`);
}

/* ------------------------------------------------------------------
   Step 7: invoices. List at 4:30, send at 5, weekdays.
   ------------------------------------------------------------------ */

async function invoiceCandidates() {
  const snap = await db.collection("jobs").where("ivyManaged", "==", true).limit(300).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((j) => FINISHED.includes(j.status) || FINISHED.includes(j.workflowStatus))
    .filter((j) => !j.squareInvoiceId && !j.invoiceHold && j.clientPrice && j.clientEmail)
    .sort((a, b) => String(a.scheduledDate || "").localeCompare(String(b.scheduledDate || "")));
}

async function invoiceRun(now, notifyOwner, log) {
  if (["Sat", "Sun"].includes(now.weekday)) return;
  const flag = db.collection("ivyPrivate").doc("invoiceRun");
  const state = (await flag.get()).data() || {};

  if (now.minutes >= 16 * 60 + 30 && state.listedFor !== now.date) {
    const list = await invoiceCandidates();
    await flag.set({ listedFor: now.date, listed: list.map((j) => j.id) }, { merge: true });
    if (list.length) {
      await notifyOwner(
        `Invoices going out at 5 pm:\n` +
        list.map((j, i) => `${i + 1}. ${shortName(j.clientName)}, ${j.serviceLabel || j.serviceType}, ${money(j.clientPrice)}`).join("\n") +
        `\nReply GO to send them now, HOLD to stop all, or HOLD 2 to stop one.`
      );
    }
    log.push(`listed ${list.length} invoices`);
  }

  if (now.minutes >= 17 * 60 && state.sentFor !== now.date && (state.listedFor === now.date)) {
    await flag.set({ sentFor: now.date }, { merge: true });
    const ids = new Set(state.listed || []);
    const list = (await invoiceCandidates()).filter((j) => ids.has(j.id));
    const out = await sendInvoices(list);
    if (list.length) await notifyOwner(out);
    log.push(`sent ${list.length} invoices`);
  }
}

async function sendInvoices(list) {
  if (!squareConfigured()) return "Square isn't connected, so no invoices went out.";
  const done = [];
  const failed = [];
  for (const j of list) {
    try {
      const inv = await sendJobInvoice({
        jobId: j.id, email: j.clientEmail, name: j.clientName, phone: normalizePhone(j.clientPhone),
        service: j.serviceLabel || j.serviceType, amount: j.clientPrice, dueDate: texasNow().date,
        description: `Thank you for choosing The Finishing Touch! ${j.scheduledDate ? `Service on ${prettyDate(j.scheduledDate)}.` : ""} Tips are optional and go to your team.`
      });
      await db.collection("jobs").doc(j.id).set({
        squareInvoiceId: inv.id, squareInvoiceNumber: inv.number, invoiceUrl: inv.url,
        invoiceSentAt: FieldValue.serverTimestamp(), invoiceStatus: inv.status
      }, { merge: true });
      done.push(`${shortName(j.clientName)} ${money(j.clientPrice)}`);
    } catch (err) {
      console.error(`[ivy pipeline] invoice for ${j.id} failed:`, err);
      failed.push(`${shortName(j.clientName)}: ${String(err.message).slice(0, 90)}`);
    }
  }
  return [done.length ? `Invoices sent: ${done.join(", ")}.` : "", failed.length ? `Didn't send: ${failed.join("; ")}` : ""].filter(Boolean).join("\n");
}

/** Richelle's GO / HOLD replies to the 4:30 list. */
export async function handleInvoiceCommand(textIn) {
  const m = String(textIn || "").trim().match(/^(go|hold)(?:\s+(\d{1,2}))?\s*$/i);
  if (!m) return null;
  const flag = db.collection("ivyPrivate").doc("invoiceRun");
  const state = (await flag.get()).data() || {};
  const today = texasNow().date;
  if (state.listedFor !== today || state.sentFor === today) return null;
  const ids = state.listed || [];
  const all = await invoiceCandidates();
  const listed = ids.map((id) => all.find((j) => j.id === id)).filter(Boolean);
  if (!listed.length) return "Nothing left to send today.";

  if (/hold/i.test(m[1])) {
    const which = m[2] ? [listed[Number(m[2]) - 1]].filter(Boolean) : listed;
    if (!which.length) return `There's no number ${m[2]} on today's list.`;
    for (const j of which) await db.collection("jobs").doc(j.id).set({ invoiceHold: true, invoiceHeldAt: FieldValue.serverTimestamp() }, { merge: true });
    return `Held ${which.map((j) => shortName(j.clientName)).join(", ")}. ${m[2] ? "The rest still go at 5." : "Nothing will go out. Send them from Square when you're ready, or clear the hold in the dashboard."}`;
  }
  const out = await sendInvoices(listed);
  await flag.set({ sentFor: today }, { merge: true });
  return out;
}

/* ------------------------------------------------------------------
   The tick
   ------------------------------------------------------------------ */

let running = null;
export async function tick(notifyOwner) {
  if (running) return running;
  running = (async () => {
    const log = [];
    const now = texasNow();
    const settings = await getPipelineSettings();
    const steps = [
      ["intakes", () => routeNewIntakes(settings, notifyOwner, log)],
      ["markups", () => askForMarkups(notifyOwner, log)],
      ["jobs", () => followUpJobs(notifyOwner, log)],
      ["sunday", () => sundayReminders(now, log)],
      ["invoices", () => invoiceRun(now, notifyOwner, log)]
    ];
    const errors = [];
    for (const [name, fn] of steps) {
      try { await fn(); } catch (err) { console.error(`[ivy pipeline] ${name} failed:`, err); errors.push(`${name}: ${err.message}`); }
    }
    if (errors.length) {
      const flag = db.collection("ivyPrivate").doc("pipelineErrors");
      const last = (await flag.get()).data() || {};
      const sig = errors.join("|").slice(0, 300);
      if (last.sig !== sig) {
        await flag.set({ sig, at: FieldValue.serverTimestamp() });
        await notifyOwner(`Ivy's job pipeline hit a problem: ${errors.join("; ").slice(0, 300)}`);
      }
    }
    return { ok: !errors.length, log, errors, at: now };
  })();
  try { return await running; } finally { running = null; }
}

/* ------------------------------------------------------------------
   Routes
   ------------------------------------------------------------------ */

const ORIGINS = new Set(["https://www.thefinishingtouch-tx.com", "https://thefinishingtouch-tx.com"]);

export function registerPipeline(app, { notifyOwner, taskKey, signedInUser, signedInOwner }) {
  for (const base of ["/quote", "/pipeline"]) {
    app.use(base, (req, res, next) => {
      const origin = req.header("Origin") || "";
      if (ORIGINS.has(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
        res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      }
      if (req.method === "OPTIONS") return res.status(204).end();
      next();
    });
  }

  // Cloud Scheduler, every 10 minutes.
  app.post("/tasks/pipeline", async (req, res) => {
    if (!taskKey || req.header("X-Task-Key") !== taskKey) return res.status(403).json({ ok: false });
    res.json(await tick(notifyOwner));
  });

  // The website says "something just happened". Anyone may poke; it only runs
  // the same idempotent tick, at most every 20 seconds.
  let lastPoke = 0;
  app.post("/pipeline/poke", (req, res) => {
    const now = Date.now();
    if (now - lastPoke > 20000) {
      lastPoke = now;
      tick(notifyOwner).catch((err) => console.error("[ivy pipeline] poke tick failed:", err));
    }
    res.json({ ok: true });
  });

  // The client's quote page.
  app.get("/quote/view", async (req, res) => {
    try {
      const v = await quoteView(String(req.query.t || ""));
      if (!v) return res.status(404).json({ ok: false, error: "This quote link isn't valid anymore. Please call or text us." });
      res.json({ ok: true, ...v });
    } catch (err) {
      console.error("[ivy pipeline] quote view failed:", err);
      res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
    }
  });
  app.post("/quote/respond", async (req, res) => {
    try {
      const out = await quoteRespond(String((req.body || {}).t || ""), req.body || {}, notifyOwner);
      res.json(out);
      tick(notifyOwner).catch(() => {});
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Richelle, from the dashboard: is everything wired, and run a tick now.
  app.post("/pipeline/run", async (req, res) => {
    let who = null;
    try { who = await signedInOwner(req); } catch { /* not the owner */ }
    if (!who) return res.status(403).json({ ok: false, error: "Owner only." });
    let square = null;
    try { square = squareConfigured() ? await squareScopes() : { missing: ["not connected"] }; }
    catch (err) { square = { error: err.message }; }
    const settings = await getPipelineSettings();
    res.json({ ...(await tick(notifyOwner)), square, autopilot: settings.autopilot, subs: settings.subsByService });
  });

  // The sub's schedule actions from her portal.
  app.post("/pipeline/sub-schedule", async (req, res) => {
    let who = null;
    try { who = await signedInUser(req); } catch { /* not signed in */ }
    if (!who) return res.status(401).json({ ok: false, error: "Please sign in again." });
    try {
      const out = await subSchedule(who.uid, req.body || {});
      res.json(out);
      tick(notifyOwner).catch(() => {});
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });
}
