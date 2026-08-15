// === The Finishing Touch — Contractor "Quote Requests" (contractor-dashboard add-on) ===
// Purpose: give a subcontractor a private screen where they see jobs The Finishing
// Touch sent them to price, and submit THEIR wholesale rate. The client's name,
// contact, and exact address are never included in these docs (privacy by design).
//
// Self-contained: injects its own nav button + view + logic. The only change to
// contractor-dashboard.html is adding, just before </body>:
//   <script type="module" src="ft-contractor-quotes.js"></script>

import { db, auth } from "./ft-firebase.js";
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

/* ---------- helpers ---------- */
const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const money = (n) => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

/* ---------- inject nav button + view ---------- */
function injectUI() {
  if (document.getElementById("view-quotes")) return true;
  const appScreen = document.getElementById("appScreen");
  const rail = document.querySelector(".rail-nav");
  if (!appScreen || !rail) return false;

  const style = document.createElement("style");
  style.textContent = `
    #view-quotes .qr-card{border:1px solid var(--line,#e8e0d8);border-radius:16px;padding:16px 18px;margin:12px 0;background:var(--card,#fffdf9)}
    #view-quotes .qr-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
    #view-quotes .qr-head strong{font-size:15px}
    #view-quotes .qr-pill{font-size:11px;font-weight:800;padding:3px 9px;border-radius:20px}
    #view-quotes .qr-open{color:#92400e;background:#fef3c7}
    #view-quotes .qr-done{color:#166534;background:#dcfce7}
    #view-quotes .qr-when{margin-left:auto;color:#98897b;font-size:12px}
    #view-quotes .qr-meta{color:#6c5f52;font-size:13px;margin:3px 0}
    #view-quotes .qr-scope{font-size:13.5px;margin:8px 0}
    #view-quotes .qr-media{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
    #view-quotes .qr-media img{width:74px;height:74px;object-fit:cover;border-radius:10px;border:1px solid #e8e0d8}
    #view-quotes .qr-vid{display:inline-flex;align-items:center;font-size:12px;font-weight:700;color:#2563eb;padding:8px 12px;border:1px solid #e8e0d8;border-radius:10px;text-decoration:none}
    #view-quotes .qr-form{margin-top:12px;padding-top:12px;border-top:1px dashed #e0d6cb;display:grid;gap:10px}
    #view-quotes .qr-lab{font-size:12px;font-weight:800;color:#6c5f52;display:block;margin-bottom:4px}
    #view-quotes .qr-rate{display:flex;align-items:center;gap:6px}
    #view-quotes .qr-rate span{font-weight:800;color:#6c5f52}
    #view-quotes .qr-rate input{width:130px;padding:9px 11px;border:1px solid #d8cdc0;border-radius:10px;font-size:15px;font-weight:700}
    #view-quotes textarea.qr-in{width:100%;min-height:52px;padding:9px 11px;border:1px solid #d8cdc0;border-radius:10px;font-size:13.5px;font-family:inherit}
    #view-quotes input.qr-in{width:100%;padding:9px 11px;border:1px solid #d8cdc0;border-radius:10px;font-size:13.5px}
    #view-quotes .qr-hint{font-size:12px;color:#98897b;background:#f7f2ec;border-radius:10px;padding:8px 11px}`;
  document.head.appendChild(style);

  // view section (inserted right after the Jobs view)
  const view = document.createElement("div");
  view.id = "view-quotes";
  view.className = "app-card appview";
  view.innerHTML = `
    <p class="mini-kicker">Quote Requests</p>
    <h2 class="screen-title">Jobs to price</h2>
    <p class="screen-copy">The Finishing Touch sent you these jobs to quote. Enter <strong>your</strong> rate — the price you'll do the job for. The client never sees your rate, and their name and contact details are kept private from this screen.</p>
    <div id="qrCount" class="screen-copy" style="font-weight:700"></div>
    <div id="qrOpenList"></div>
    <div id="qrMineWrap" style="margin-top:22px"></div>`;
  const jobsView = document.getElementById("view-jobs");
  if (jobsView && jobsView.nextSibling) appScreen.insertBefore(view, jobsView.nextSibling);
  else appScreen.appendChild(view);

  // rail nav button (after Jobs)
  const btn = document.createElement("button");
  btn.className = "navbtn";
  btn.dataset.view = "quotes";
  btn.innerHTML = `<span class="ico">Q</span>Quote Requests`;
  const jobsBtn = rail.querySelector('[data-view="jobs"]');
  if (jobsBtn && jobsBtn.nextSibling) rail.insertBefore(btn, jobsBtn.nextSibling);
  else rail.appendChild(btn);

  // mobile bottom-nav button
  let bbtn = null;
  const bottom = document.querySelector(".bottom-nav");
  if (bottom) {
    bbtn = document.createElement("button");
    bbtn.dataset.view = "quotes";
    bbtn.innerHTML = `<span class="bico"></span>Quotes`;
    const bj = bottom.querySelector('[data-view="jobs"]');
    if (bj && bj.nextSibling) bottom.insertBefore(bbtn, bj.nextSibling);
    else bottom.appendChild(bbtn);
  }

  // self-managed view switching (the dashboard's own setView handles turning us OFF
  // when another tab is clicked; we handle turning ourselves ON)
  function show() {
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === "quotes"));
    document.querySelectorAll(".appview").forEach((p) => p.classList.toggle("active", p.id === "view-quotes"));
    const t = document.getElementById("topTitle"); if (t) t.textContent = "Quote Requests";
  }
  [btn, bbtn].filter(Boolean).forEach((b) => b.addEventListener("click", show));
  return true;
}

/* ---------- render ---------- */
function mediaHtml(q) {
  const photos = Array.isArray(q.mediaPhotoUrls) ? q.mediaPhotoUrls : [];
  const videos = Array.isArray(q.mediaVideoUrls) ? q.mediaVideoUrls : [];
  if (!photos.length && !videos.length) return "";
  let out = photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}"></a>`).join("");
  out += videos.map((u, i) => `<a class="qr-vid" href="${esc(u)}" target="_blank" rel="noopener">▶ Video ${i + 1}</a>`).join("");
  return `<div class="qr-media">${out}</div>`;
}

function openCard(q) {
  const title = q.serviceLabel || q.serviceType || "Job";
  return `
    <div class="qr-card" data-qid="${esc(q.id)}">
      <div class="qr-head">
        <strong>${esc(title)}</strong>
        <span class="qr-pill qr-open">Needs your rate</span>
        <span class="qr-when">${esc(fmtDate(q.createdAt))}</span>
      </div>
      ${q.area ? `<div class="qr-meta">📍 Area: ${esc(q.area)}</div>` : ""}
      ${q.layout ? `<div class="qr-meta">🏠 ${esc(q.layout)}</div>` : ""}
      ${q.addons ? `<div class="qr-meta">✨ ${esc(q.addons)}</div>` : ""}
      ${q.scopeSummary ? `<div class="qr-scope">${esc(q.scopeSummary)}</div>` : ""}
      ${mediaHtml(q)}
      <div class="qr-form">
        <div>
          <label class="qr-lab">Your rate for this job (what you'll do it for)</label>
          <div class="qr-rate"><span>$</span><input class="qr-in qr-rate-in" type="number" min="0" step="0.01" placeholder="0.00"></div>
        </div>
        <div>
          <label class="qr-lab">Your availability (days / times you can do it)</label>
          <input class="qr-in qr-avail-in" type="text" placeholder="e.g. Tue or Thu mornings, or Aug 20 after 1pm">
        </div>
        <div>
          <label class="qr-lab">Note for The Finishing Touch (optional)</label>
          <textarea class="qr-in qr-note-in" placeholder="Anything you want Richelle to know before she prices it for the client"></textarea>
        </div>
        <div class="qr-hint">Only The Finishing Touch sees your rate. Once you submit, it locks in and can't be changed here.</div>
        <div><button class="btn btn-primary qr-submit" type="button">Submit my rate</button></div>
      </div>
    </div>`;
}

function mineCard(q) {
  const title = q.serviceLabel || q.serviceType || "Job";
  const statusText = q.status === "converted" ? "Booked" : (q.clientPrice != null && q.clientPrice !== "" ? "Priced by TFT" : "Rate submitted");
  return `
    <div class="qr-card" data-qid="${esc(q.id)}">
      <div class="qr-head">
        <strong>${esc(title)}</strong>
        <span class="qr-pill qr-done">${esc(statusText)}</span>
        <span class="qr-when">${esc(fmtDate(q.createdAt))}</span>
      </div>
      ${q.area ? `<div class="qr-meta">📍 Area: ${esc(q.area)}</div>` : ""}
      <div class="qr-meta">Your rate: <strong>${money(q.subRate)}</strong></div>
      ${q.subAvailability ? `<div class="qr-meta">📅 You offered: ${esc(q.subAvailability)}</div>` : ""}
    </div>`;
}

let openList = [];
let mineList = [];

function draw() {
  const openWrap = document.getElementById("qrOpenList");
  const mineWrap = document.getElementById("qrMineWrap");
  const count = document.getElementById("qrCount");
  if (!openWrap) return;

  count.textContent = openList.length
    ? `${openList.length} job${openList.length === 1 ? "" : "s"} waiting for your rate`
    : "No jobs to price right now. New ones will appear here when The Finishing Touch sends them.";
  openWrap.innerHTML = openList.map(openCard).join("");
  hookSubmits(openWrap);

  if (mineWrap) {
    mineWrap.innerHTML = mineList.length
      ? `<h3 class="screen-title" style="font-size:1.1rem">Rates you've submitted</h3>` + mineList.map(mineCard).join("")
      : "";
  }
}

/* ---------- submit a rate ---------- */
function hookSubmits(wrap) {
  wrap.querySelectorAll(".qr-card").forEach((el) => {
    const qid = el.dataset.qid;
    const btn = el.querySelector(".qr-submit");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const rate = Number(el.querySelector(".qr-rate-in")?.value);
      const avail = (el.querySelector(".qr-avail-in")?.value || "").trim();
      const note = (el.querySelector(".qr-note-in")?.value || "").trim();
      if (!(rate > 0)) { alert("Please enter your rate (a number above 0) first."); return; }
      if (!confirm(`Submit ${money(rate)} as your rate for this job? This locks in and can't be changed here.`)) return;
      btn.disabled = true; btn.textContent = "Submitting…";
      try {
        const me = auth.currentUser;
        await updateDoc(doc(db, "quoteRequests", qid), {
          subRate: rate,
          subUid: me.uid,
          subNote: note,
          subAvailability: avail,
          status: "sub_quoted",
          updatedAt: serverTimestamp()
        });
        // onSnapshot will move it into "Rates you've submitted" automatically
      } catch (err) {
        console.warn("Submit rate error:", err);
        btn.disabled = false; btn.textContent = "Submit my rate";
        alert("Sorry — that didn't save (likely a permission rule). Details are in the console.");
      }
    });
  });
}

/* ---------- boot (signed-in contractors) ---------- */
function boot() {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    if (!injectUI()) {
      const t = setInterval(() => { if (injectUI()) { clearInterval(t); startListeners(user); } }, 600);
      setTimeout(() => clearInterval(t), 8000);
      return;
    }
    startListeners(user);
  });
}

let started = false;
function startListeners(user) {
  if (started) return;
  started = true;
  // open requests to bid on
  onSnapshot(
    query(collection(db, "quoteRequests"), where("status", "==", "awaiting_sub_quote")),
    (snap) => {
      openList = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      draw();
    },
    (err) => {
      console.warn("Open quoteRequests listener error:", err);
      const count = document.getElementById("qrCount");
      if (count) count.textContent = "Couldn't load jobs to price. If you just finished onboarding, this unlocks once your account is active.";
    }
  );
  // my submitted rates
  onSnapshot(
    query(collection(db, "quoteRequests"), where("subUid", "==", user.uid)),
    (snap) => {
      mineList = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      draw();
    },
    (err) => { console.warn("My quoteRequests listener error:", err); }
  );
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
