// === The Finishing Touch — Intake Inbox (admin dashboard add-on) ===
// Purpose: Show every website quote request (Firestore "intakeRequests") inside
// the Admin Dashboard as a new "Intake Inbox" tab, newest first, with a one-click
// "Create Job" action that turns a request into an open job.
//
// This file is self-contained: it injects its own tab + panel into admin-dashboard.html
// and manages its own show/hide, so the only change to admin-dashboard.html is adding:
//   <script type="module" src="ft-intake-inbox.js"></script>   (just before </body>)

import { db, auth } from "./ft-firebase.js";
import {
  collection, query, orderBy, limit, onSnapshot, where,
  doc, addDoc, updateDoc, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

/* ---------- helpers ---------- */
const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

const statusPill = (s) => {
  const map = {
    new: ["New", "#92400e", "#fef3c7"],
    reviewed: ["Reviewed", "#1e40af", "#dbeafe"],
    converted: ["Job created", "#166534", "#dcfce7"],
    archived: ["Archived", "#475569", "#f1f5f9"]
  };
  const [t, fg, bg] = map[s] || ["New", "#92400e", "#fef3c7"];
  return `<span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;color:${fg};background:${bg}">${t}</span>`;
};

/* ---------- inject tab + panel ---------- */
function injectUI() {
  const tabsWrap = document.querySelector(".tabs");
  const panelsWrap = document.querySelector(".panels");
  if (!tabsWrap || !panelsWrap || document.getElementById("panel-intake")) return false;

  // little icon for the new tab
  const style = document.createElement("style");
  style.textContent = `.tabbtn[data-tab="intake"]::before{content:"📥"}
    #panel-intake .intake-card{background:var(--card,#fff);border:1px solid var(--line,#e2e8f0);border-radius:14px;padding:16px 18px;margin-bottom:12px}
    #panel-intake .intake-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
    #panel-intake .intake-top strong{font-size:15px}
    #panel-intake .intake-meta{color:#64748b;font-size:12.5px;margin:2px 0}
    #panel-intake .intake-sum{font-size:13.5px;margin:8px 0}
    #panel-intake .intake-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    #panel-intake .intake-count{color:#64748b;font-size:13px;margin-bottom:12px}
    #panel-intake .qr-box{margin-top:12px;padding:12px 14px;border-radius:12px;border:1px solid #e2e8f0;background:#f8fafc}
    #panel-intake .qr-wait{color:#92400e;background:#fffbeb;border-color:#fde68a;font-size:13px;font-weight:600}
    #panel-intake .qr-quoted{background:#f0fdf4;border-color:#bbf7d0}
    #panel-intake .qr-row{display:flex;justify-content:space-between;align-items:center;font-size:13.5px;margin:2px 0}
    #panel-intake .qr-row strong{font-size:15px}
    #panel-intake .qr-final{margin-top:8px;padding-top:8px;border-top:1px dashed #cbd5e1;color:#166534}
    #panel-intake .qr-note{font-size:12.5px;color:#475569;margin:4px 0}
    #panel-intake .qr-sub{font-size:12px;color:#64748b;margin:10px 0 4px;font-weight:600}
    #panel-intake .qr-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
    #panel-intake .qr-chip{cursor:pointer;font-size:12.5px;font-weight:700;padding:6px 11px;border-radius:20px;border:1px solid #86efac;background:#dcfce7;color:#166534}
    #panel-intake .qr-chip:hover{background:#bbf7d0}
    #panel-intake .qr-setrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    #panel-intake .qr-cur{font-weight:700;color:#475569}
    #panel-intake .qr-price{width:110px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-weight:600}
    #panel-intake .sent-to{font-size:12.5px;color:#475569;margin-top:8px}
    #subPicker{position:fixed;inset:0;z-index:9999;background:rgba(47,41,38,.45);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}
    #subPicker .sp-box{background:#fffdfb;border-radius:22px;max-width:560px;width:100%;padding:22px;box-shadow:0 18px 45px rgba(68,54,45,.25);text-align:left}
    #subPicker h3{font-family:"Playfair Display",serif;margin:0 0 4px;font-size:1.3rem;color:#2f2926}
    #subPicker .sp-sub{color:#7a6f68;font-size:13.5px;margin:0 0 14px}
    #subPicker .sp-row{border:1px solid #eadfd8;border-radius:14px;padding:11px 13px;margin-bottom:9px;background:#fff}
    #subPicker .sp-main{display:flex;align-items:center;gap:10px;cursor:pointer}
    #subPicker .sp-main input{width:18px;height:18px;accent-color:#2f2926}
    #subPicker .sp-name{font-weight:700;color:#2f2926}
    #subPicker .sp-email{font-size:12px;color:#7a6f68}
    #subPicker .sp-chips{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0 0 28px}
    #subPicker .sp-chip{font-size:11.5px;padding:2px 9px;border-radius:999px;background:#fff1f3;border:1px solid #f2d8dc;color:#7d4f59}
    #subPicker .sp-edit{margin-left:auto;font-size:12px;background:none;border:0;color:#7d4f59;text-decoration:underline;cursor:pointer}
    #subPicker .sp-svc{display:none;margin:9px 0 0 28px;padding-top:9px;border-top:1px dashed #eadfd8}
    #subPicker .sp-svc.open{display:block}
    #subPicker .sp-svc label{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;margin:0 12px 6px 0}
    #subPicker .sp-toggle{font-size:13px;color:#7a6f68;margin:4px 0 12px;display:flex;align-items:center;gap:6px}
    #subPicker .sp-empty{color:#7a6f68;font-size:13.5px;padding:14px;border:1px dashed #eadfd8;border-radius:14px}
    #subPicker .sp-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
    #subPicker .sp-msg{font-size:12.5px;color:#7d4f59;margin-top:8px;min-height:1em}`;
  document.head.appendChild(style);

  // tab button — placed right after the first tab (Job Inbox)
  const tabBtn = document.createElement("button");
  tabBtn.className = "tabbtn";
  tabBtn.dataset.tab = "intake";
  tabBtn.textContent = "Intake Inbox";
  const firstTab = tabsWrap.querySelector(".tabbtn");
  if (firstTab && firstTab.nextSibling) tabsWrap.insertBefore(tabBtn, firstTab.nextSibling);
  else tabsWrap.appendChild(tabBtn);

  // panel
  const panel = document.createElement("section");
  panel.id = "panel-intake";
  panel.className = "panel";
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = `
    <div class="intake-count" id="intakeCount">Loading your quote requests…</div>
    <div id="listIntake"></div>`;
  panelsWrap.appendChild(panel);

  // --- tab switching (self-managed so it coexists with the dashboard's own tabs) ---
  function showIntake() {
    document.querySelectorAll(".tabbtn").forEach((t) => t.classList.toggle("active", t === tabBtn));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-intake"));
  }
  tabBtn.addEventListener("click", showIntake);
  // when any OTHER tab is clicked, make sure our tab/panel turn off
  document.querySelectorAll(".tabbtn").forEach((t) => {
    if (t !== tabBtn) t.addEventListener("click", () => {
      tabBtn.classList.remove("active");
      panel.classList.remove("active");
    });
  });

  return true;
}

/* ---------- render ---------- */
function contactLine(r) {
  return r.CLIENT_CONTACT_CLEAR ||
    [r.clientName && `Name: ${r.clientName}`, r.clientEmail && `Email: ${r.clientEmail}`,
     r.clientPhone && `Phone: ${r.clientPhone}`].filter(Boolean).join(" · ");
}

function mediaHtml(r){
  var photos = Array.isArray(r.mediaPhotoUrls) ? r.mediaPhotoUrls : [];
  var videos = Array.isArray(r.mediaVideoUrls) ? r.mediaVideoUrls : [];
  if (!photos.length && !videos.length) return "";
  var out = photos.map(function(u){ return '<a href="'+esc(u)+'" target="_blank" rel="noopener"><img src="'+esc(u)+'" style="width:66px;height:66px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0"></a>'; }).join("");
  out += videos.map(function(u,i){ return '<a href="'+esc(u)+'" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#2563eb;padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px">Video '+(i+1)+'</a>'; }).join("");
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 2px">'+out+'</div>';
}

const money = (n) => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- admin pricing block (joins the sub's quoteRequests doc) ---------- */
function pricingHtml(r) {
  const q = subQuotes[r.id];
  if (!q) return "";
  if (q.status === "awaiting_sub_quote") {
    return `<div class="qr-box qr-wait">⏳ Sent to your sub — waiting on their wholesale rate.</div>`;
  }
  const rate = Number(q.subRate);
  if (!(rate > 0)) {
    return `<div class="qr-box qr-wait">Sub responded, but no rate is on file yet.</div>`;
  }
  const p20 = rate * 1.2, p30 = rate * 1.3;
  const isSet = q.clientPrice != null && q.clientPrice !== "";
  const jobDone = q.status === "converted";
  return `<div class="qr-box qr-quoted" data-qid="${esc(q.id)}" data-rate="${rate}">
      <div class="qr-row"><span>Sub's wholesale rate</span><strong>${money(rate)}</strong></div>
      ${q.subNote ? `<div class="qr-note">📝 ${esc(q.subNote)}</div>` : ""}
      ${q.subAvailability ? `<div class="qr-note">📅 Available: ${esc(q.subAvailability)}</div>` : ""}
      <div class="qr-sub">Your price to the client (your service fee on top):</div>
      <div class="qr-chips">
        <button class="qr-chip" data-act="pick" data-val="${p20.toFixed(2)}">+20% → ${money(p20)}</button>
        <button class="qr-chip" data-act="pick" data-val="${p30.toFixed(2)}">+30% → ${money(p30)}</button>
      </div>
      <div class="qr-setrow">
        <span class="qr-cur">$</span>
        <input class="qr-price" type="number" min="0" step="0.01" value="${isSet ? Number(q.clientPrice).toFixed(2) : p30.toFixed(2)}">
        <button class="btn btn-outline" data-act="setPrice">${isSet ? "Update price" : "Set client price"}</button>
      </div>
      ${isSet ? `<div class="qr-row qr-final"><span>Client price set</span><strong>${money(q.clientPrice)}</strong></div>
        ${jobDone ? `<div class="qr-note" style="color:#166534;font-weight:700">✓ Job created at ${money(q.clientPrice)}</div>`
          : `<button class="btn" data-act="jobFromQuote" style="margin-top:6px">＋ Create job at ${money(q.clientPrice)}</button>`}` : ""}
    </div>`;
}

function card(r) {
  const title = r.serviceLabel || r.serviceType || "Quote request";
  const st = r.intakeStatus || r.status || "new";
  const summary = r.REQUEST_SUMMARY_CLEAR || r.summary || "";
  const layout = r.HOME_LAYOUT_CLEAR || r.PROPERTY_DETAILS_CLEAR || "";
  const addons = (r.SPECIALTY_ADDONS_CLEAR && r.SPECIALTY_ADDONS_CLEAR !== "None selected") ? r.SPECIALTY_ADDONS_CLEAR : "";
  const converted = st === "converted";
  return `
    <div class="intake-card" data-id="${esc(r.id)}">
      <div class="intake-top">
        <strong>${esc(title)}</strong>
        ${statusPill(st)}
        <span style="margin-left:auto;color:#94a3b8;font-size:12px">${esc(fmtDate(r.createdAt))}</span>
      </div>
      <div class="intake-meta">👤 ${esc(contactLine(r)) || "No contact captured"}</div>
      ${layout ? `<div class="intake-meta">🏠 ${esc(layout)}</div>` : ""}
      ${addons ? `<div class="intake-meta">✨ ${esc(addons)}</div>` : ""}
      ${summary ? `<div class="intake-sum">${esc(summary)}</div>` : ""}
      ${mediaHtml(r)}
      ${pricingHtml(r)}
      ${sentNames(r).length ? `<div class="sent-to">Sent to: <strong>${esc(sentNames(r).join(", "))}</strong>${passNames(r).length ? ` · Passed: ${esc(passNames(r).join(", "))}` : ""}</div>` : ""}
      <div class="intake-actions">
        <button class="btn btn-outline" data-act="sendToSub">${sentNames(r).length ? "＋ Send to another sub" : (r.subQuoteRequested ? "→ Send to a sub" : "→ Send to a sub for quote")}</button>
        <button class="btn btn-outline" data-act="createJob" ${converted ? "disabled" : ""}>${converted ? "✓ Job created" : "＋ Create Job"}</button>
        ${st === "new" ? `<button class="btn btn-outline" data-act="review">Mark reviewed</button>` : ""}
        <button class="btn btn-outline" data-act="archive">Archive</button>
      </div>
    </div>`;
}

let latest = [];
let subQuotes = {}; // keyed by intakeId -> quoteRequests doc

function draw(list) {
  const wrap = document.getElementById("listIntake");
  const count = document.getElementById("intakeCount");
  if (!wrap) return;
  const active = list.filter((r) => (r.intakeStatus || r.status) !== "archived");
  count.textContent = active.length
    ? `${active.length} quote request${active.length === 1 ? "" : "s"} — newest first`
    : "No quote requests yet. When someone submits an intake form, it will appear here.";
  wrap.innerHTML = active.length ? active.map(card).join("") : "";
  hookActions(wrap);
}

/* ---------- actions ---------- */
function hookActions(wrap) {
  wrap.querySelectorAll(".intake-card").forEach((el) => {
    const id = el.dataset.id;
    const rec = latest.find((r) => r.id === id);
    el.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        try {
          if (act === "review") {
            await updateDoc(doc(db, "intakeRequests", id), { intakeStatus: "reviewed", updatedAt: serverTimestamp() });
          } else if (act === "archive") {
            if (!confirm("Archive this request? It will be hidden from the inbox (not deleted).")) return;
            await updateDoc(doc(db, "intakeRequests", id), { intakeStatus: "archived", updatedAt: serverTimestamp() });
          } else if (act === "createJob") {
            if (!confirm("Create an open job from this request?")) return;
            await createJob(rec);
            await updateDoc(doc(db, "intakeRequests", id), { intakeStatus: "converted", updatedAt: serverTimestamp() });
          } else if (act === "sendToSub") {
            openPicker(rec);
            return;
          } else if (act === "pick") {
            const inp = el.querySelector(".qr-price");
            if (inp) inp.value = btn.dataset.val;
            return; // no DB write
          } else if (act === "setPrice") {
            const box = el.querySelector(".qr-box");
            const inp = el.querySelector(".qr-price");
            const qid = box?.dataset.qid;
            const val = Number(inp?.value);
            if (!qid || !(val > 0)) { alert("Enter a client price above $0 first."); return; }
            await updateDoc(doc(db, "quoteRequests", qid), { clientPrice: val, status: "priced", updatedAt: serverTimestamp() });
          } else if (act === "jobFromQuote") {
            const box = el.querySelector(".qr-box");
            const qid = box?.dataset.qid;
            const q = subQuotes[id];
            if (!q || !qid) { alert("No sub quote found for this request."); return; }
            if (!confirm(`Create a scheduled job at ${money(q.clientPrice)} (client price)? Your sub keeps ${money(q.subRate)}.`)) return;
            await createJobFromQuote(rec, q);
            await updateDoc(doc(db, "quoteRequests", qid), { status: "converted", updatedAt: serverTimestamp() });
            await updateDoc(doc(db, "intakeRequests", id), { intakeStatus: "converted", updatedAt: serverTimestamp() });
          }
        } catch (err) {
          alert("Sorry — that action was blocked (likely a Firestore rule). Details in the console.");
          console.warn("Intake action error:", err);
        }
      });
    });
  });
}

async function createJob(r) {
  const user = auth.currentUser;
  const payload = {
    status: "open",
    source: "intake",
    intakeId: r.id,
    serviceType: r.serviceType || "cleaning",
    serviceLabel: r.serviceLabel || "",
    summary: r.REQUEST_SUMMARY_CLEAR || r.summary || "",
    notes: r.SPECIALTY_ADDON_NOTES_CLEAR || r.notes || "",
    clientName: r.clientName || "",
    clientEmail: r.clientEmail || "",
    clientPhone: r.clientPhone || "",
    clientUid: r.clientUid || "",
    HOME_LAYOUT_CLEAR: r.HOME_LAYOUT_CLEAR || "",
    PROPERTY_DETAILS_CLEAR: r.PROPERTY_DETAILS_CLEAR || "",
    SPECIALTY_ADDONS_CLEAR: r.SPECIALTY_ADDONS_CLEAR || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user?.email || user?.uid || "admin"
  };
  await addDoc(collection(db, "jobs"), payload);
}

async function createJobFromQuote(r, q) {
  const user = auth.currentUser;
  const payload = {
    status: "assigned",
    source: "quote",
    intakeId: r.id,
    quoteRequestId: q.id,
    serviceType: r.serviceType || q.serviceType || "cleaning",
    serviceLabel: r.serviceLabel || q.serviceLabel || "",
    summary: r.REQUEST_SUMMARY_CLEAR || r.summary || q.scopeSummary || "",
    notes: r.SPECIALTY_ADDON_NOTES_CLEAR || r.notes || "",
    clientName: r.clientName || "",
    clientEmail: r.clientEmail || "",
    clientPhone: r.clientPhone || "",
    clientUid: r.clientUid || "",
    // pricing
    subRate: Number(q.subRate) || null,
    clientPrice: Number(q.clientPrice) || null,
    serviceFee: (Number(q.clientPrice) && Number(q.subRate)) ? Number((q.clientPrice - q.subRate).toFixed(2)) : null,
    // sub assignment (contractorIds lets the existing contractor dashboard pick it up)
    subUid: q.subUid || "",
    contractorIds: q.subUid ? [q.subUid] : [],
    HOME_LAYOUT_CLEAR: r.HOME_LAYOUT_CLEAR || "",
    PROPERTY_DETAILS_CLEAR: r.PROPERTY_DETAILS_CLEAR || "",
    SPECIALTY_ADDONS_CLEAR: r.SPECIALTY_ADDONS_CLEAR || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user?.email || user?.uid || "admin"
  };
  await addDoc(collection(db, "jobs"), payload);
}

/* ---------- sub quote request (privacy-safe: no client PII) ---------- */
function areaOf(r) {
  const d = r.intakeData || {};
  const zip = d.zip || d.zipcode || d.zip_code || r.zip || "";
  const city = d.city || r.city || "";
  return [zip, city].filter(Boolean).join(" · ");
}

async function createSubQuoteRequest(r, picked = []) {
  const user = auth.currentUser;
  const payload = {
    intakeId: r.id,
    offeredTo: picked.map((c) => c.id),
    offeredNames: picked.map((c) => c.name),
    status: "awaiting_sub_quote",
    serviceType: r.serviceType || "cleaning",
    serviceLabel: r.serviceLabel || "",
    scopeSummary: r.REQUEST_SUMMARY_CLEAR || r.summary || "",
    layout: r.HOME_LAYOUT_CLEAR || r.PROPERTY_DETAILS_CLEAR || "",
    addons: (r.SPECIALTY_ADDONS_CLEAR && r.SPECIALTY_ADDONS_CLEAR !== "None selected") ? r.SPECIALTY_ADDONS_CLEAR : "",
    area: areaOf(r),
    mediaPhotoUrls: Array.isArray(r.mediaPhotoUrls) ? r.mediaPhotoUrls : [],
    mediaVideoUrls: Array.isArray(r.mediaVideoUrls) ? r.mediaVideoUrls : [],
    subRate: null,
    subUid: "",
    subNote: "",
    clientPrice: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user?.email || user?.uid || "admin"
    // Intentionally NO clientName / clientEmail / clientPhone / address — the sub never sees client PII.
  };
  return addDoc(collection(db, "quoteRequests"), payload);
}

/* ---------- choosing which contractor gets a job ---------- */

// Every service a contractor can be approved for. home_reset is new.
const SERVICE_OPTIONS = [
  ["cleaning", "Cleaning"],
  ["organizing", "Organizing"],
  ["decor", "Decorating / Styling"],
  ["holiday", "Holiday Decorating"],
  ["staging", "Staging"],
  ["home_reset", "Home Reset"],
  ["virtual_design", "Virtual Design"]
];
const SERVICE_NAME = Object.fromEntries(SERVICE_OPTIONS);

// The same service can arrive under several names, from intake forms or applications.
function normService(v) {
  const s = String(v || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!s) return "";
  if (s.includes("reset") || s.includes("concierge")) return "home_reset";
  if (s.includes("virtual") || s.includes("design_e") || s.includes("edesign")) return "virtual_design";
  if (["clean", "cleaning", "deep_clean", "standard_clean", "move_in_out", "move_out", "move_in", "airbnb",
       "turnover", "commercial", "office", "post_construction", "carpet_upholstery_grout"].includes(s) || s.includes("clean")) return "cleaning";
  if (s.includes("organiz")) return "organizing";
  if (s.includes("holiday") || s.includes("christmas")) return "holiday";
  if (s.includes("stag")) return "staging";
  if (s.includes("decor") || s.includes("styl") || s.includes("interior") || s === "design") return "decor";
  return s;
}

const CONTRACTOR_ROLES = ["contractor", "organizer", "decorator", "stager", "team_lead",
  "cleaning_technician", "walkthrough_specialist", "admin_assistant"];

let contractors = [];

function contractorName(u) {
  return u.displayName || u.name || u.fullName || u.application?.fullName ||
    [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Contractor";
}

function contractorServicesOf(u) {
  const raw = u.approvedServiceTypes || u.approvedServices || u.serviceTypes || u.application?.serviceTypes || [];
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  return [...new Set(list.map(normService).filter(Boolean))];
}

function isApproved(u) {
  const c = u.compliance || {};
  return u.applicationStatus === "approved" || u.contractorStatus === "active" || u.status === "active" ||
    c.overallStatus === "active" || u.active === true;
}

function sentNames(r) {
  const q = subQuotes[r.id];
  return q && Array.isArray(q.offeredNames) ? q.offeredNames : [];
}

function passNames(r) {
  const q = subQuotes[r.id];
  if (!q || !Array.isArray(q.declinedBy)) return [];
  return q.declinedBy.map((uid) => {
    const c = contractors.find((x) => x.id === uid);
    return c ? c.name : "";
  }).filter(Boolean);
}

function listenContractors() {
  onSnapshot(
    query(collection(db, "users"), where("role", "in", CONTRACTOR_ROLES)),
    (snap) => {
      contractors = snap.docs.map((d) => {
        const u = { id: d.id, ...d.data() };
        return { id: u.id, name: contractorName(u), email: u.email || "", services: contractorServicesOf(u), approved: isApproved(u) };
      }).sort((a, b) => a.name.localeCompare(b.name));
    },
    (err) => console.warn("contractor list error:", err)
  );
}

function firstName(n) { return String(n || "").trim().split(/\s+/)[0] || "there"; }

function jobEmail(r, picked) {
  const service = SERVICE_NAME[normService(r.serviceType)] || r.serviceLabel || r.serviceType || "new";
  const layout = r.HOME_LAYOUT_CLEAR || r.PROPERTY_DETAILS_CLEAR || "";
  const addons = (r.SPECIALTY_ADDONS_CLEAR && r.SPECIALTY_ADDONS_CLEAR !== "None selected") ? r.SPECIALTY_ADDONS_CLEAR : "";
  const scope = r.REQUEST_SUMMARY_CLEAR || r.summary || "";
  const photos = (Array.isArray(r.mediaPhotoUrls) ? r.mediaPhotoUrls.length : 0) +
    (Array.isArray(r.mediaVideoUrls) ? r.mediaVideoUrls.length : 0);
  const hello = picked.length === 1 ? `Hi ${firstName(picked[0].name)},` : "Hi everyone,";
  const lines = [
    hello,
    "",
    `I have a new ${service} job I'd love for you to take a look at.`,
    "",
    areaOf(r) ? `Area: ${areaOf(r)}` : null,
    layout ? `Home: ${layout}` : null,
    addons ? `Add ons: ${addons}` : null,
    scope ? `What they're looking for: ${scope}` : null,
    photos ? `Photos and video: ${photos} in your portal` : null,
    "",
    "Sign in to your contractor portal and open Quote Requests. You can send me your rate and the days you're free, or tap Pass if it isn't a fit.",
    "https://www.thefinishingtouch-tx.com/contractor-dashboard.html",
    "",
    "Thank you so much!",
    "Richelle",
    "The Finishing Touch"
  ].filter((x) => x !== null).filter((x, i, a) => !(x === "" && a[i - 1] === ""));
  const subject = `New ${service} job for you to look at`;
  return { subject, body: lines.join("\n") };
}

function gmailComposeUrl(picked, subject, body) {
  const p = new URLSearchParams({ view: "cm", fs: "1", su: subject, body });
  const emails = picked.map((c) => c.email).filter(Boolean);
  if (emails.length === 1) p.set("to", emails[0]);
  else if (emails.length > 1) { p.set("to", "contact.thefinishingtouch.tx@gmail.com"); p.set("bcc", emails.join(",")); }
  return `https://mail.google.com/mail/?authuser=contact.thefinishingtouch.tx@gmail.com&${p}`;
}

function openPicker(r) {
  document.getElementById("subPicker")?.remove();
  const jobService = normService(r.serviceType || r.serviceLabel);
  const q = subQuotes[r.id];
  const already = new Set(q && Array.isArray(q.offeredTo) ? q.offeredTo : []);
  let showAll = false;

  const wrap = document.createElement("div");
  wrap.id = "subPicker";
  wrap.innerHTML = `
    <div class="sp-box" role="dialog" aria-label="Send to a sub">
      <h3>Send to a sub</h3>
      <p class="sp-sub">${esc(SERVICE_NAME[jobService] || r.serviceLabel || "Job")} · they'll see the job details and area, never the client's name or contact.</p>
      <label class="sp-toggle"><input type="checkbox" id="spAll"> Show everyone, not just ${esc(SERVICE_NAME[jobService] || "matching")} contractors</label>
      <div id="spList"></div>
      <div class="sp-msg" id="spMsg"></div>
      <div class="sp-actions">
        <button class="btn btn-outline" type="button" id="spCancel">Cancel</button>
        <button class="btn btn-solid" type="button" id="spSend">Send</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const listEl = wrap.querySelector("#spList");
  const msg = wrap.querySelector("#spMsg");

  function draw() {
    const approved = contractors.filter((c) => c.approved && !already.has(c.id));
    const shown = showAll ? approved : approved.filter((c) => c.services.includes(jobService));
    if (!shown.length) {
      listEl.innerHTML = `<div class="sp-empty">${approved.length
        ? `None of your approved contractors are set up for ${esc(SERVICE_NAME[jobService] || "this service")} yet. Tick "Show everyone" to pick someone and set their services.`
        : "No approved contractors yet. Once they sign up, approve them in Applications and they'll show here."}</div>`;
      return;
    }
    listEl.innerHTML = shown.map((c) => `
      <div class="sp-row" data-uid="${esc(c.id)}">
        <label class="sp-main">
          <input type="checkbox" class="sp-pick">
          <span><span class="sp-name">${esc(c.name)}</span><br><span class="sp-email">${esc(c.email || "No email on file")}</span></span>
          <button class="sp-edit" type="button">Services</button>
        </label>
        <div class="sp-chips">${c.services.length ? c.services.map((s) => `<span class="sp-chip">${esc(SERVICE_NAME[s] || s)}</span>`).join("") : '<span class="sp-email">No services set</span>'}</div>
        <div class="sp-svc">
          ${SERVICE_OPTIONS.map(([k, label]) => `<label><input type="checkbox" value="${k}" ${c.services.includes(k) ? "checked" : ""}> ${esc(label)}</label>`).join("")}
          <div><button class="btn btn-outline sp-save" type="button">Save services</button></div>
        </div>
      </div>`).join("");

    listEl.querySelectorAll(".sp-row").forEach((row) => {
      row.querySelector(".sp-edit").addEventListener("click", (e) => {
        e.preventDefault();
        row.querySelector(".sp-svc").classList.toggle("open");
      });
      row.querySelector(".sp-save").addEventListener("click", async () => {
        const chosen = [...row.querySelectorAll(".sp-svc input:checked")].map((x) => x.value);
        try {
          await updateDoc(doc(db, "users", row.dataset.uid), { approvedServiceTypes: chosen, updatedAt: serverTimestamp() });
          const c = contractors.find((x) => x.id === row.dataset.uid);
          if (c) c.services = chosen;
          msg.textContent = "Services saved.";
          draw();
        } catch (err) {
          console.warn(err);
          msg.textContent = "Couldn't save those services.";
        }
      });
    });
  }

  wrap.querySelector("#spAll").addEventListener("change", (e) => { showAll = e.target.checked; draw(); });
  wrap.querySelector("#spCancel").addEventListener("click", () => wrap.remove());
  wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });

  wrap.querySelector("#spSend").addEventListener("click", async () => {
    const ids = [...listEl.querySelectorAll(".sp-row")].filter((row) => row.querySelector(".sp-pick").checked).map((row) => row.dataset.uid);
    const picked = contractors.filter((c) => ids.includes(c.id));
    if (!picked.length) { msg.textContent = "Tick at least one name first."; return; }

    // Opened now, while the click still counts, or the browser blocks it as a popup.
    const mailTab = window.open("about:blank", "_blank");
    const btn = wrap.querySelector("#spSend");
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      if (q) {
        await updateDoc(doc(db, "quoteRequests", q.id), {
          offeredTo: arrayUnion(...picked.map((c) => c.id)),
          offeredNames: arrayUnion(...picked.map((c) => c.name)),
          updatedAt: serverTimestamp()
        });
      } else {
        await createSubQuoteRequest(r, picked);
      }
      await updateDoc(doc(db, "intakeRequests", r.id), { subQuoteRequested: true, updatedAt: serverTimestamp() });
      const { subject, body } = jobEmail(r, picked);
      const url = gmailComposeUrl(picked, subject, body);
      if (mailTab) mailTab.location.href = url; else window.open(url, "_blank");
      wrap.remove();
    } catch (err) {
      console.warn("send to sub error:", err);
      if (mailTab) mailTab.close();
      btn.disabled = false; btn.textContent = "Send";
      msg.textContent = "That didn't save. Try again in a moment.";
    }
  });

  draw();
}

/* ---------- boot (admin only) ---------- */
function boot() {
  onAuthStateChanged(auth, (user) => {
    if (!user) return; // dashboard's own guard will redirect
    if (!injectUI()) return;
    listenContractors();
    onSnapshot(
      query(collection(db, "intakeRequests"), orderBy("createdAt", "desc"), limit(300)),
      (snap) => { latest = snap.docs.map((d) => ({ id: d.id, ...d.data() })); draw(latest); },
      (err) => {
        console.warn("Intake Inbox listener error:", err);
        const count = document.getElementById("intakeCount");
        if (count) count.textContent = "Couldn't load requests — this is usually a Firestore rule blocking admin read of intakeRequests. Tell Claude and it's a quick fix.";
      }
    );
    // sub quote responses — joined onto each intake card so you can price + convert
    onSnapshot(
      query(collection(db, "quoteRequests"), orderBy("createdAt", "desc"), limit(300)),
      (snap) => {
        subQuotes = {};
        snap.docs.forEach((d) => { const q = { id: d.id, ...d.data() }; if (q.intakeId) subQuotes[q.intakeId] = q; });
        draw(latest);
      },
      (err) => { console.warn("quoteRequests listener error:", err); }
    );
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
