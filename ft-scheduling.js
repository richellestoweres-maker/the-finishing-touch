// === The Finishing Touch — Scheduling Console (admin dashboard add-on) ===
// Purpose: the "middle" of scheduling that was missing — take an assigned job,
// capture the client's date preference (a specific date OR "flexible before X"),
// send it to the assigned sub, let the sub accept or propose their own slots, then
// confirm a final date/time that shows on every portal.
//
// This is the in-app backbone. Later, Ivy automates the back-and-forth messaging
// and Google Calendar / text reminders layer on top of this same data.
//
// Self-contained: injects into the admin dashboard's existing "Calendar" panel.
// Only change to admin-dashboard.html: add before </body>:
//   <script type="module" src="ft-scheduling.js"></script>

import { db, auth } from "./ft-firebase.js";
import {
  collection, query, where, orderBy, limit, onSnapshot,
  doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

/* ---------- shared vocab ---------- */
export const TIME_WINDOWS = [
  ["morning", "Morning (8–12)"],
  ["midday", "Midday (11–2)"],
  ["afternoon", "Afternoon (12–4)"],
  ["evening", "Evening (4–7)"],
  ["anytime", "Anytime that day"]
];
const windowLabel = (w) => (TIME_WINDOWS.find((x) => x[0] === w) || [w, w || ""])[1];

/* ---------- helpers ---------- */
const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
function prettyDate(d) {
  if (!d) return "";
  try {
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch { return d; }
}
const jobTitle = (j) => j.serviceLabel || j.serviceType || "Job";
const clientLine = (j) => [j.clientName, j.clientPhone, j.clientEmail].filter(Boolean).join(" · ") || "Client on file";

/* ---------- inject UI into the Calendar panel ---------- */
function injectUI() {
  const panel = document.getElementById("panel-calendar");
  if (!panel || document.getElementById("sched-console")) return false;

  const style = document.createElement("style");
  style.textContent = `
    #sched-console{margin-top:16px}
    #sched-console .sched-sec{margin:18px 0}
    #sched-console .sched-h{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-bottom:8px}
    #sched-console .sjob{border:1px solid var(--line,#e2e8f0);border-radius:14px;padding:14px 16px;margin-bottom:10px;background:var(--card,#fff)}
    #sched-console .sjob-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
    #sched-console .sjob-top strong{font-size:15px}
    #sched-console .spill{font-size:11px;font-weight:800;padding:3px 9px;border-radius:20px}
    #sched-console .sp-need{color:#92400e;background:#fef3c7}
    #sched-console .sp-wait{color:#3730a3;background:#e0e7ff}
    #sched-console .sp-prop{color:#9a3412;background:#ffedd5}
    #sched-console .sp-conf{color:#166534;background:#dcfce7}
    #sched-console .sp-decl{color:#991b1b;background:#fee2e2}
    #sched-console .sp-resc{color:#9d174d;background:#fce7f3}
    #sched-console .sjob-meta{color:#64748b;font-size:12.5px;margin:2px 0}
    #sched-console .sform{margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1;display:grid;gap:8px}
    #sched-console .srow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    #sched-console .sfield{display:flex;flex-direction:column;gap:3px}
    #sched-console .slab{font-size:11px;font-weight:800;color:#64748b}
    #sched-console input,#sched-console select,#sched-console textarea{padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;font-family:inherit}
    #sched-console textarea{min-height:38px;width:100%}
    #sched-console .schip{cursor:pointer;font-size:12.5px;font-weight:700;padding:7px 11px;border-radius:10px;border:1px solid #93c5fd;background:#eff6ff;color:#1e40af}
    #sched-console .schip:hover{background:#dbeafe}
    #sched-console .sconf-line{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700;color:#166534;margin-top:6px}
    #sched-console .smini{font-size:12px;color:#94a3b8}`;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "sched-console";
  box.innerHTML = `
    <div class="card">
      <div class="toprow"><strong>Scheduling Console</strong><span class="rolepill">In-platform · Ivy-ready</span></div>
      <p class="small">Set the client's date preference, send it to the assigned sub, and confirm the final time. Once confirmed it shows on the sub's and client's dashboards.</p>
      <div id="schedNeeds" class="sched-sec"></div>
      <div id="schedWaiting" class="sched-sec"></div>
      <div id="schedResponded" class="sched-sec"></div>
      <div id="schedConfirmed" class="sched-sec"></div>
    </div>`;
  panel.appendChild(box);
  return true;
}

/* ---------- state ---------- */
let jobs = [];

/* ---------- render ---------- */
function schedStatusOf(j) {
  return j.schedStatus || (j.scheduledAt ? "confirmed" : "unscheduled");
}

function needsForm(j) {
  return `
    <div class="sform" data-form="send">
      <div class="srow">
        <label class="sfield"><span class="slab">Client's date preference</span>
          <select class="s-mode">
            <option value="specific">Specific date (sub says yes/no)</option>
            <option value="flexible">Flexible — by a date (sub proposes times)</option>
          </select>
        </label>
        <label class="sfield s-specific-wrap"><span class="slab">Client wants this date</span>
          <input class="s-date" type="date">
        </label>
        <label class="sfield s-flexible-wrap" style="display:none"><span class="slab">Needs it by</span>
          <input class="s-bydate" type="date">
        </label>
        <label class="sfield"><span class="slab">Time window</span>
          <select class="s-window">${TIME_WINDOWS.map((w) => `<option value="${w[0]}">${w[1]}</option>`).join("")}</select>
        </label>
      </div>
      <label class="sfield"><span class="slab">Note for the sub (optional)</span>
        <textarea class="s-note" placeholder="Anything the sub should know to schedule — gate code timing, parking, etc."></textarea>
      </label>
      <div class="srow"><button class="btn btn-solid" data-act="sendToSub">→ Send to sub to schedule</button></div>
    </div>`;
}

function assignedSubNote(j) {
  const n = (j.contractorIds && j.contractorIds.length) ? `${j.contractorIds.length} assigned sub(s)` : "No sub assigned yet";
  return `<div class="sjob-meta">👷 ${esc(n)}</div>`;
}

function prefSummary(j) {
  const p = j.clientDatePref || {};
  if (p.mode === "specific") return `Client wants <strong>${esc(prettyDate(p.date))}</strong> · ${esc(windowLabel(p.window))}`;
  if (p.mode === "flexible") return `Flexible — <strong>by ${esc(prettyDate(p.byDate))}</strong> · ${esc(windowLabel(p.window))}`;
  return "";
}

function jobCard(j, kind) {
  const st = schedStatusOf(j);
  let pill = { unscheduled: ["Needs scheduling", "sp-need"], awaiting_sub: ["Waiting on sub", "sp-wait"],
    sub_proposed: ["Sub proposed times", "sp-prop"], sub_declined: ["Sub declined", "sp-decl"],
    confirmed: ["Confirmed", "sp-conf"], reschedule_requested: ["Reschedule asked", "sp-resc"] }[st] || ["", "sp-need"];

  let body = "";
  if (kind === "needs") {
    body = needsForm(j);
  } else if (kind === "waiting") {
    body = `<div class="sjob-meta">📨 Sent: ${prefSummary(j)}</div>
      ${j.subScheduleNote ? `<div class="sjob-meta">📝 To sub: ${esc(j.subScheduleNote)}</div>` : ""}
      <div class="smini">Waiting for the sub to accept or propose times…</div>`;
  } else if (kind === "responded") {
    if (st === "sub_declined") {
      body = `<div class="sjob-meta">${prefSummary(j)}</div>
        <div class="sjob-meta">❌ Sub can't make it${j.subResponseNote ? `: ${esc(j.subResponseNote)}` : "."}</div>
        ${needsForm(j)}`;
    } else {
      const slots = Array.isArray(j.subProposedSlots) ? j.subProposedSlots : [];
      body = `<div class="sjob-meta">${prefSummary(j)}</div>
        ${j.subResponseNote ? `<div class="sjob-meta">💬 Sub: ${esc(j.subResponseNote)}</div>` : ""}
        <div class="slab" style="margin-top:8px">Sub is available — pick one to confirm:</div>
        <div class="srow" style="margin-top:6px">
          ${slots.length ? slots.map((s, i) => `<button class="schip" data-act="confirmSlot" data-i="${i}">${esc(prettyDate(s.date))} · ${esc(windowLabel(s.window))}</button>`).join("")
            : `<span class="smini">Sub accepted the requested date.</span>`}
        </div>`;
    }
  } else if (kind === "confirmed") {
    body = `<div class="sconf-line"><span>✅ ${esc(prettyDate(j.scheduledDate))} · ${esc(windowLabel(j.scheduledWindow))}</span>
        <button class="btn btn-outline" data-act="reopen" style="font-size:12px">Change</button></div>`;
  }

  return `
    <div class="sjob" data-id="${esc(j.id)}">
      <div class="sjob-top">
        <strong>${esc(jobTitle(j))}</strong>
        <span class="spill ${pill[1]}">${pill[0]}</span>
        ${j.clientPrice ? `<span class="smini" style="margin-left:auto">$${esc(j.clientPrice)} client price</span>` : ""}
      </div>
      <div class="sjob-meta">👤 ${esc(clientLine(j))}</div>
      ${assignedSubNote(j)}
      ${body}
    </div>`;
}

function section(el, title, list, kind, emptyMsg) {
  if (!el) return;
  el.innerHTML = `<div class="sched-h">${esc(title)} ${list.length ? `(${list.length})` : ""}</div>` +
    (list.length ? list.map((j) => jobCard(j, kind)).join("") : `<div class="smini">${esc(emptyMsg)}</div>`);
  hookActions(el);
}

function draw() {
  const schedulable = jobs.filter((j) => Array.isArray(j.contractorIds) && j.contractorIds.length && j.status !== "cancelled");
  const byStatus = (s) => schedulable.filter((j) => schedStatusOf(j) === s);
  const needs = schedulable.filter((j) => ["unscheduled", undefined].includes(j.schedStatus) && !j.scheduledAt);

  section(document.getElementById("schedNeeds"), "Needs scheduling", needs, "needs", "Nothing waiting to be scheduled.");
  section(document.getElementById("schedWaiting"), "Sent to sub — waiting", byStatus("awaiting_sub"), "waiting", "");
  const responded = schedulable.filter((j) => ["sub_proposed", "sub_declined", "reschedule_requested"].includes(schedStatusOf(j)));
  section(document.getElementById("schedResponded"), "Sub responded — confirm a time", responded, "responded", "");
  const confirmed = byStatus("confirmed").sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
  section(document.getElementById("schedConfirmed"), "Confirmed / upcoming", confirmed, "confirmed", "No confirmed appointments yet.");
}

/* ---------- actions ---------- */
function hookActions(root) {
  root.querySelectorAll(".sjob").forEach((el) => {
    const id = el.dataset.id;
    const j = jobs.find((x) => x.id === id);
    if (!j) return;

    const modeSel = el.querySelector(".s-mode");
    if (modeSel) {
      const sync = () => {
        const spec = modeSel.value === "specific";
        const sw = el.querySelector(".s-specific-wrap"), fw = el.querySelector(".s-flexible-wrap");
        if (sw) sw.style.display = spec ? "" : "none";
        if (fw) fw.style.display = spec ? "none" : "";
      };
      modeSel.addEventListener("change", sync); sync();
    }

    el.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        try {
          if (act === "sendToSub") {
            const mode = el.querySelector(".s-mode").value;
            const window = el.querySelector(".s-window").value;
            const note = (el.querySelector(".s-note")?.value || "").trim();
            const pref = { mode, window };
            if (mode === "specific") {
              pref.date = el.querySelector(".s-date").value;
              if (!pref.date) { alert("Pick the client's requested date."); return; }
            } else {
              pref.byDate = el.querySelector(".s-bydate").value;
              if (!pref.byDate) { alert("Pick the 'needs it by' date."); return; }
            }
            await updateDoc(doc(db, "jobs", id), {
              schedStatus: "awaiting_sub", clientDatePref: pref, subScheduleNote: note,
              subProposedSlots: [], subDecision: "", subResponseNote: "", updatedAt: serverTimestamp()
            });
          } else if (act === "confirmSlot") {
            const i = Number(btn.dataset.i);
            const s = (j.subProposedSlots || [])[i];
            if (!s) return;
            await confirmTime(id, s.date, s.window);
          } else if (act === "reopen") {
            if (!confirm("Change this confirmed time? It will go back to 'needs scheduling'.")) return;
            await updateDoc(doc(db, "jobs", id), {
              schedStatus: "unscheduled", scheduledAt: null, scheduledDate: "", scheduledWindow: "",
              subDecision: "", subProposedSlots: [], updatedAt: serverTimestamp()
            });
          }
        } catch (err) {
          console.warn("Scheduling action error:", err);
          alert("That action was blocked (likely a Firestore rule). Details in the console.");
        }
      });
    });
  });
}

async function confirmTime(id, date, window) {
  await updateDoc(doc(db, "jobs", id), {
    schedStatus: "confirmed", status: "scheduled",
    scheduledDate: date, scheduledWindow: window,
    scheduledAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
}

/* ---------- boot ---------- */
function boot() {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    if (!injectUI()) {
      const t = setInterval(() => { if (injectUI()) { clearInterval(t); start(); } }, 700);
      setTimeout(() => clearInterval(t), 9000);
      return;
    }
    start();
  });
}

let started = false;
function start() {
  if (started) return;
  started = true;
  onSnapshot(
    query(collection(db, "jobs"), orderBy("createdAt", "desc"), limit(400)),
    (snap) => { jobs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); draw(); },
    (err) => { console.warn("Scheduling jobs listener error:", err); }
  );
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
