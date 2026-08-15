// === The Finishing Touch — Contractor Scheduling (contractor-dashboard add-on) ===
// The sub's side of scheduling. For each assigned job that needs a time, the sub
// either ACCEPTS the client's specific date, or PROPOSES a few date/time slots that
// work with their outside schedule. Confirmed appointments show as "Upcoming".
//
// Self-contained: injects its own "Schedule" nav + view. Only change to
// contractor-dashboard.html: add before </body>:
//   <script type="module" src="ft-contractor-schedule.js"></script>

import { db, auth } from "./ft-firebase.js";
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

const TIME_WINDOWS = [
  ["morning", "Morning (8–12)"],
  ["midday", "Midday (11–2)"],
  ["afternoon", "Afternoon (12–4)"],
  ["evening", "Evening (4–7)"],
  ["anytime", "Anytime that day"]
];
const windowLabel = (w) => (TIME_WINDOWS.find((x) => x[0] === w) || [w, w || ""])[1];
const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
function prettyDate(d) {
  if (!d) return "";
  try { const dt = new Date(d + "T00:00:00"); if (isNaN(dt)) return d;
    return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); } catch { return d; }
}
const jobTitle = (j) => j.serviceLabel || j.serviceType || "Job";
const todayStr = () => { const n = new Date(); return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0"); };

/* ---------- inject nav + view ---------- */
function injectUI() {
  if (document.getElementById("view-schedule")) return true;
  const appScreen = document.getElementById("appScreen");
  const rail = document.querySelector(".rail-nav");
  if (!appScreen || !rail) return false;

  const style = document.createElement("style");
  style.textContent = `
    #view-schedule .sc-card{border:1px solid var(--line,#e8e0d8);border-radius:16px;padding:16px 18px;margin:12px 0;background:var(--card,#fffdf9)}
    #view-schedule .sc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
    #view-schedule .sc-head strong{font-size:15px}
    #view-schedule .sc-pill{font-size:11px;font-weight:800;padding:3px 9px;border-radius:20px}
    #view-schedule .sc-need{color:#92400e;background:#fef3c7}
    #view-schedule .sc-conf{color:#166534;background:#dcfce7}
    #view-schedule .sc-meta{color:#6c5f52;font-size:13px;margin:3px 0}
    #view-schedule .sc-ask{background:#f7f2ec;border-radius:12px;padding:10px 12px;margin:8px 0;font-size:13.5px}
    #view-schedule .sc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    #view-schedule .sc-slots{display:grid;gap:8px;margin-top:8px}
    #view-schedule .sc-slot{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    #view-schedule .sc-slot input,#view-schedule .sc-slot select,#view-schedule textarea.sc-in{padding:8px 10px;border:1px solid #d8cdc0;border-radius:10px;font-size:13.5px;font-family:inherit}
    #view-schedule textarea.sc-in{width:100%;min-height:44px}
    #view-schedule .sc-when{margin-left:auto;color:#98897b;font-size:12px}
    #view-schedule .sc-confline{font-size:15px;font-weight:800;color:#166534}`;
  document.head.appendChild(style);

  const view = document.createElement("div");
  view.id = "view-schedule";
  view.className = "app-card appview";
  view.innerHTML = `
    <p class="mini-kicker">Schedule</p>
    <h2 class="screen-title">Your schedule</h2>
    <p class="screen-copy">When The Finishing Touch sends you a job to schedule, accept the client's date or offer a few times that work with your own calendar. Confirmed jobs show under Upcoming.</p>
    <div id="scNeeds"></div>
    <div id="scUpcoming" style="margin-top:22px"></div>`;
  const jobsView = document.getElementById("view-jobs");
  if (jobsView && jobsView.nextSibling) appScreen.insertBefore(view, jobsView.nextSibling);
  else appScreen.appendChild(view);

  const mkBtn = (cls) => { const b = document.createElement("button"); b.className = cls; b.dataset.view = "schedule"; return b; };
  const railBtn = mkBtn("navbtn");
  railBtn.innerHTML = `<span class="ico">S</span>Schedule`;
  const jobsBtn = rail.querySelector('[data-view="jobs"]');
  if (jobsBtn && jobsBtn.nextSibling) rail.insertBefore(railBtn, jobsBtn.nextSibling); else rail.appendChild(railBtn);

  let bBtn = null;
  const bottom = document.querySelector(".bottom-nav");
  if (bottom) { bBtn = mkBtn(""); bBtn.innerHTML = `<span class="bico"></span>Sched`;
    const bj = bottom.querySelector('[data-view="jobs"]'); if (bj && bj.nextSibling) bottom.insertBefore(bBtn, bj.nextSibling); else bottom.appendChild(bBtn); }

  function show() {
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === "schedule"));
    document.querySelectorAll(".appview").forEach((p) => p.classList.toggle("active", p.id === "view-schedule"));
    const t = document.getElementById("topTitle"); if (t) t.textContent = "Schedule";
  }
  [railBtn, bBtn].filter(Boolean).forEach((b) => b.addEventListener("click", show));
  return true;
}

/* ---------- render ---------- */
function slotRow(idx) {
  return `<div class="sc-slot">
      <input type="date" class="sc-sdate" min="${todayStr()}">
      <select class="sc-swin">${TIME_WINDOWS.map((w) => `<option value="${w[0]}">${w[1]}</option>`).join("")}</select>
    </div>`;
}

function proposeBlock() {
  return `
    <div class="sc-slots" data-propose>
      ${slotRow(0)}${slotRow(1)}${slotRow(2)}
      <textarea class="sc-in sc-pnote" placeholder="Optional note back to The Finishing Touch"></textarea>
      <div class="sc-actions"><button class="btn btn-primary" data-act="propose">Send these times</button></div>
    </div>`;
}

function needCard(j) {
  const p = j.clientDatePref || {};
  const specific = p.mode === "specific";
  const ask = specific
    ? `Client wants <strong>${esc(prettyDate(p.date))}</strong> — ${esc(windowLabel(p.window))}.`
    : `Client is flexible — needs it done <strong>by ${esc(prettyDate(p.byDate))}</strong>, ${esc(windowLabel(p.window))}.`;
  return `
    <div class="sc-card" data-id="${esc(j.id)}">
      <div class="sc-head"><strong>${esc(jobTitle(j))}</strong><span class="sc-pill sc-need">Needs a time</span></div>
      ${j.area ? `<div class="sc-meta">📍 ${esc(j.area)}</div>` : ""}
      <div class="sc-ask">🗓️ ${ask}${j.subScheduleNote ? `<br><span style="color:#6c5f52">📝 ${esc(j.subScheduleNote)}</span>` : ""}</div>
      ${specific ? `
        <div class="sc-actions">
          <button class="btn btn-primary" data-act="accept" data-date="${esc(p.date)}" data-window="${esc(p.window)}">✓ Accept ${esc(prettyDate(p.date))}</button>
          <button class="btn btn-outline" data-act="showPropose">Offer different times</button>
        </div>
        <div class="sc-hideprop" style="display:none">${proposeBlock()}</div>
      ` : proposeBlock()}
    </div>`;
}

function upcomingCard(j) {
  return `
    <div class="sc-card" data-id="${esc(j.id)}">
      <div class="sc-head"><strong>${esc(jobTitle(j))}</strong><span class="sc-pill sc-conf">Confirmed</span>
        <span class="sc-when">${esc(j.area || "")}</span></div>
      <div class="sc-confline">🗓️ ${esc(prettyDate(j.scheduledDate))} · ${esc(windowLabel(j.scheduledWindow))}</div>
    </div>`;
}

let mine = [];
function draw() {
  const needsWrap = document.getElementById("scNeeds");
  const upWrap = document.getElementById("scUpcoming");
  if (!needsWrap) return;
  const needs = mine.filter((j) => ["awaiting_sub", "reschedule_requested"].includes(j.schedStatus));
  const upcoming = mine.filter((j) => j.schedStatus === "confirmed" && j.scheduledDate)
    .sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));

  needsWrap.innerHTML = needs.length
    ? `<h3 class="screen-title" style="font-size:1.1rem">Jobs to schedule (${needs.length})</h3>` + needs.map(needCard).join("")
    : `<p class="screen-copy">Nothing to schedule right now.</p>`;
  hookActions(needsWrap);

  upWrap.innerHTML = upcoming.length
    ? `<h3 class="screen-title" style="font-size:1.1rem">Upcoming</h3>` + upcoming.map(upcomingCard).join("")
    : "";
}

/* ---------- actions ---------- */
function readSlots(el) {
  const slots = [];
  el.querySelectorAll(".sc-slot").forEach((row) => {
    const d = row.querySelector(".sc-sdate")?.value;
    const w = row.querySelector(".sc-swin")?.value;
    if (d) slots.push({ date: d, window: w });
  });
  return slots;
}

function hookActions(root) {
  root.querySelectorAll(".sc-card").forEach((el) => {
    const id = el.dataset.id;
    el.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        try {
          if (act === "showPropose") {
            const w = el.querySelector(".sc-hideprop"); if (w) w.style.display = "";
            btn.style.display = "none";
            return;
          }
          if (act === "accept") {
            if (!confirm(`Accept ${btn.dataset.date}? This confirms the appointment.`)) return;
            await updateDoc(doc(db, "jobs", id), {
              schedStatus: "confirmed", subDecision: "accepted",
              scheduledDate: btn.dataset.date, scheduledWindow: btn.dataset.window,
              scheduledAt: serverTimestamp(), updatedAt: serverTimestamp()
            });
          } else if (act === "propose") {
            const scope = btn.closest("[data-propose]") || el;
            const slots = readSlots(scope);
            const note = (scope.querySelector(".sc-pnote")?.value || "").trim();
            if (!slots.length) { alert("Add at least one date you can do."); return; }
            await updateDoc(doc(db, "jobs", id), {
              schedStatus: "sub_proposed", subDecision: "proposed",
              subProposedSlots: slots, subResponseNote: note, updatedAt: serverTimestamp()
            });
          }
        } catch (err) {
          console.warn("Contractor schedule error:", err);
          alert("That didn't save (likely a permission rule). Details in the console.");
        }
      });
    });
  });
}

/* ---------- boot ---------- */
function boot() {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    if (!injectUI()) {
      const t = setInterval(() => { if (injectUI()) { clearInterval(t); start(user); } }, 700);
      setTimeout(() => clearInterval(t), 9000);
      return;
    }
    start(user);
  });
}

let started = false;
function start(user) {
  if (started) return;
  started = true;
  onSnapshot(
    query(collection(db, "jobs"), where("contractorIds", "array-contains", user.uid)),
    (snap) => { mine = snap.docs.map((d) => ({ id: d.id, ...d.data() })); draw(); },
    (err) => {
      console.warn("Contractor schedule listener error:", err);
      const w = document.getElementById("scNeeds");
      if (w) w.innerHTML = `<p class="screen-copy">Couldn't load your schedule. If you just activated, refresh in a moment.</p>`;
    }
  );
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
