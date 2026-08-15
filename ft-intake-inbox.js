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
    #panel-intake .intake-count{color:#64748b;font-size:13px;margin-bottom:12px}`;
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
      <div class="intake-actions">
        <button class="btn btn-outline" data-act="sendToSub" ${r.subQuoteRequested ? "disabled" : ""}>${r.subQuoteRequested ? "✓ Sent to sub" : "→ Send to sub for quote"}</button>
        <button class="btn btn-outline" data-act="createJob" ${converted ? "disabled" : ""}>${converted ? "✓ Job created" : "＋ Create Job"}</button>
        ${st === "new" ? `<button class="btn btn-outline" data-act="review">Mark reviewed</button>` : ""}
        <button class="btn btn-outline" data-act="archive">Archive</button>
      </div>
    </div>`;
}

let latest = [];

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
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
