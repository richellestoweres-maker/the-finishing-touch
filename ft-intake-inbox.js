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
  collection, query, orderBy, limit, onSnapshot,
  doc, addDoc, updateDoc, serverTimestamp
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
    #panel-intake .qr-price{width:110px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-weight:600}`;
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
      <div class="intake-actions">
        <button class="btn btn-outline" data-act="sendToSub" ${r.subQuoteRequested ? "disabled" : ""}>${r.subQuoteRequested ? "✓ Sent to sub" : "→ Send to sub for quote"}</button>
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
            if (!confirm("Send this to your subcontractor pool for a quote? They'll see the job details, photos, and general area — but NOT the client's name, contact, or exact address.")) return;
            await createSubQuoteRequest(rec);
            await updateDoc(doc(db, "intakeRequests", id), { subQuoteRequested: true, updatedAt: serverTimestamp() });
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

async function createSubQuoteRequest(r) {
  const user = auth.currentUser;
  const payload = {
    intakeId: r.id,
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
  await addDoc(collection(db, "quoteRequests"), payload);
}

/* ---------- boot (admin only) ---------- */
function boot() {
  onAuthStateChanged(auth, (user) => {
    if (!user) return; // dashboard's own guard will redirect
    if (!injectUI()) return;
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
