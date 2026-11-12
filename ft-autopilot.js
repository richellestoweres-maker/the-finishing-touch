// === The Finishing Touch — Ivy Autopilot (admin dashboard add-on) ===
//
// The controls and the view for Ivy's job pipeline (ivy/pipeline.js):
//   - turn the autopilot on or off
//   - choose which sub gets each kind of job (cleaning is Maggie)
//   - see every job Ivy is running and the step it is on
//   - a two week calendar of everything booked
//
// Self-contained: injects into the top of the Calendar panel.
// Only change to admin-dashboard.html: add before </body>:
//   <script type="module" src="ft-autopilot.js"></script>

import { db, auth } from "./ft-firebase.js";
import {
  collection, query, where, onSnapshot, doc, getDoc, setDoc, updateDoc, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

const SERVICES = [
  ["cleaning", "Cleaning"],
  ["home_reset", "Home Reset"],
  ["organizing", "Organizing"],
  ["holiday", "Holiday Decorating"],
  ["decor", "Decorating / Styling"],
  ["staging", "Staging"]
];
const WINDOWS = { morning: "Morning", midday: "Midday", afternoon: "Afternoon", evening: "Evening", anytime: "Anytime" };
const CONTRACTOR_ROLES = ["contractor", "organizer", "decorator", "stager", "team_lead", "cleaning_technician", "admin"];

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n == null || n === "") ? "" : "$" + Number(n).toFixed(2).replace(/\.00$/, "");
const nameOf = (u) => u.displayName || u.fullName || u.name || u.application?.fullName || u.email || "Contractor";
const short = (n) => { const p = String(n || "").trim().split(/\s+/).filter(Boolean); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : (p[0] || "Client"); };
const ms = (v) => v?.toMillis ? v.toMillis() : 0;

let settings = { autopilot: false, subsByService: {} };
let contractors = [];
let quotes = [];
let jobs = [];

function injectUI() {
  const panel = document.getElementById("panel-calendar");
  if (!panel || document.getElementById("autopilot")) return !!document.getElementById("autopilot");
  const style = document.createElement("style");
  style.textContent = `
    #autopilot .ap-card{border:1px solid var(--line,#e2e8f0);border-radius:16px;padding:16px 18px;margin-bottom:14px;background:var(--card,#fff)}
    #autopilot .ap-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
    #autopilot .ap-switch{display:inline-flex;align-items:center;gap:8px;font-weight:800;cursor:pointer}
    #autopilot .ap-switch input{width:20px;height:20px}
    #autopilot .ap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:12px}
    #autopilot label.ap-lab{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:800;color:#64748b}
    #autopilot select{padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;font-size:13.5px}
    #autopilot .ap-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13.5px}
    #autopilot .ap-row:last-child{border-bottom:0}
    #autopilot .ap-step{font-size:11px;font-weight:800;padding:3px 9px;border-radius:20px;background:#f1f5f9;color:#334155}
    #autopilot .ap-step.you{background:#fef3c7;color:#92400e}
    #autopilot .ap-step.done{background:#dcfce7;color:#166534}
    #autopilot .ap-step.wait{background:#e0e7ff;color:#3730a3}
    #autopilot .ap-step.stop{background:#fee2e2;color:#991b1b}
    #autopilot .ap-right{margin-left:auto;color:#64748b;font-size:12.5px}
    #autopilot .ap-cal{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
    #autopilot .ap-day{border:1px solid #e2e8f0;border-radius:12px;padding:8px;min-height:92px;background:#fff}
    #autopilot .ap-day.today{border-color:#b99a80;box-shadow:0 0 0 2px #efe4d7}
    #autopilot .ap-dh{font-size:12px;font-weight:800;color:#64748b;margin-bottom:6px}
    #autopilot .ap-ev{font-size:12px;border-radius:8px;padding:5px 7px;margin-bottom:5px;background:#f7f1eb;border-left:3px solid #b99a80}
    #autopilot .ap-ev strong{display:block;font-size:12.5px}
    #autopilot .ap-small{font-size:12px;color:#94a3b8}
    @media(max-width:760px){#autopilot .ap-cal{grid-template-columns:1fr}}`;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "autopilot";
  box.innerHTML = `
    <div class="ap-card">
      <div class="ap-top">
        <strong style="font-size:16px">Ivy Autopilot</strong>
        <label class="ap-switch"><input type="checkbox" id="apOn"> <span id="apOnLabel">Off</span></label>
      </div>
      <p class="ap-small" style="margin:6px 0 0">New intakes go to the sub you pick below. Ivy texts you each sub price for your markup, emails the client the quote, books the day, sends Sunday reminders, and texts you invoices at 4:30.</p>
      <div class="ap-grid" id="apSubs"></div>
      <div id="apMsg" class="ap-small" style="margin-top:8px"></div>
    </div>
    <div class="ap-card">
      <div class="ap-top"><strong>Jobs Ivy is running</strong><span class="ap-small" id="apCount"></span></div>
      <div id="apBoard"></div>
    </div>
    <div class="ap-card">
      <div class="ap-top"><strong>Calendar</strong>
        <span><button class="btn btn-outline" type="button" id="apPrev">‹</button>
        <span id="apRange" style="margin:0 8px;font-weight:800"></span>
        <button class="btn btn-outline" type="button" id="apNext">›</button></span></div>
      <div id="apCal" style="margin-top:10px"></div>
    </div>`;
  panel.insertBefore(box, panel.firstChild);

  document.getElementById("apOn").addEventListener("change", (e) => save({ autopilot: e.target.checked }));
  document.getElementById("apPrev").addEventListener("click", () => { weekOffset -= 1; drawCalendar(); });
  document.getElementById("apNext").addEventListener("click", () => { weekOffset += 1; drawCalendar(); });
  return true;
}

async function save(patch) {
  const msg = document.getElementById("apMsg");
  try {
    const next = { ...patch, updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email || "" };
    if (patch.autopilot === true && !settings.autopilot) next.autopilotSince = serverTimestamp();
    await setDoc(doc(db, "settings", "pipeline"), next, { merge: true });
    msg.textContent = "Saved.";
    setTimeout(() => { msg.textContent = ""; }, 2500);
  } catch (err) {
    console.warn("autopilot save:", err);
    msg.textContent = "Couldn't save: " + (err.message || err);
  }
}

function drawSettings() {
  const on = !!settings.autopilot;
  document.getElementById("apOn").checked = on;
  document.getElementById("apOnLabel").textContent = on ? "On" : "Off";
  const subs = settings.subsByService || {};
  document.getElementById("apSubs").innerHTML = SERVICES.map(([key, label]) => `
    <label class="ap-lab">${esc(label)}
      <select data-svc="${key}">
        <option value="">I'll handle these myself</option>
        ${contractors.map((c) => `<option value="${esc(c.id)}" ${subs[key] === c.id ? "selected" : ""}>${esc(nameOf(c))}</option>`).join("")}
      </select>
    </label>`).join("");
  document.querySelectorAll("#apSubs select").forEach((sel) => sel.addEventListener("change", () => {
    save({ subsByService: { ...(settings.subsByService || {}), [sel.dataset.svc]: sel.value } });
  }));
}

/* Where each job is, and whose move it is. */
function quoteStep(q) {
  if (q.status === "awaiting_sub_quote") return ["Waiting on sub's price", "wait"];
  if (q.status === "sub_quoted" && !q.markupPct) return [`Sub quoted ${money(q.subRate)}. Text Ivy your markup`, "you"];
  if (q.status === "priced" && q.quoteSentAt) return [`Quote sent, ${money(q.clientPrice)}`, "wait"];
  if (q.status === "priced") return [`Priced ${money(q.clientPrice)}, no client email`, "you"];
  if (q.status === "declined") return ["Client declined", "stop"];
  return [q.status || "", ""];
}
function jobStep(j) {
  const finished = ["submitted_for_review", "approved", "completion_package_sent", "payout_pending", "paid", "completed"];
  if (j.squareInvoiceId) return [`Invoiced ${money(j.clientPrice)}`, "done"];
  if (j.invoiceHold) return ["Invoice on hold", "you"];
  if (finished.includes(j.status) || finished.includes(j.workflowStatus)) return ["Done, invoice goes at 5 pm", "wait"];
  if (j.schedStatus === "confirmed") return [`Booked ${j.scheduledDate}`, "done"];
  if (j.schedStatus === "sub_proposed") return ["Client picking from sub's times", "wait"];
  if (j.schedStatus === "client_needs_call") return ["No time works. Call the client", "you"];
  if (j.schedStatus === "awaiting_sub") return ["Waiting on sub to pick a day", "wait"];
  return [j.schedStatus || j.status || "", ""];
}

function drawBoard() {
  const jobQuoteIds = new Set(jobs.map((j) => j.quoteRequestId));
  const openQuotes = quotes.filter((q) => !jobQuoteIds.has(q.id) && q.status !== "converted");
  const rows = [
    ...openQuotes.map((q) => ({ t: ms(q.updatedAt) || ms(q.createdAt), label: `${q.serviceLabel || q.serviceType}${q.area ? `, ${q.area}` : ""}`, step: quoteStep(q), right: q.offeredNames?.[0] || "" })),
    ...jobs.map((j) => ({ t: ms(j.updatedAt) || ms(j.createdAt), label: `${short(j.clientName)}, ${j.serviceLabel || j.serviceType}`, step: jobStep(j), right: money(j.clientPrice), job: j }))
  ].sort((a, b) => b.t - a.t).slice(0, 40);
  document.getElementById("apCount").textContent = rows.length ? `${rows.length} active` : "";
  document.getElementById("apBoard").innerHTML = rows.length
    ? rows.map((r) => `<div class="ap-row"><span class="ap-step ${r.step[1]}">${esc(r.step[0])}</span><span>${esc(r.label)}</span>
        ${r.job?.invoiceHold && !r.job?.squareInvoiceId ? `<button class="btn btn-outline" type="button" data-unhold="${esc(r.job.id)}">Release hold</button>` : ""}
        <span class="ap-right">${esc(r.right)}</span></div>`).join("")
    : `<div class="ap-small">Nothing yet. Turn the autopilot on and new intakes will show here.</div>`;
  document.querySelectorAll("[data-unhold]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try { await updateDoc(doc(db, "jobs", b.dataset.unhold), { invoiceHold: false }); }
    catch (err) { alert("Couldn't update: " + err.message); b.disabled = false; }
  }));
}

/* Two weeks, Monday to Friday. */
let weekOffset = 0;
let booked = [];
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay() || 7;
  x.setDate(x.getDate() - wd + 1);
  return x;
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function drawCalendar() {
  const start = mondayOf(new Date());
  start.setDate(start.getDate() + weekOffset * 7);
  const today = iso(new Date());
  const weeks = [0, 1].map((w) => [0, 1, 2, 3, 4].map((i) => { const d = new Date(start); d.setDate(d.getDate() + w * 7 + i); return d; }));
  const last = weeks[1][4];
  document.getElementById("apRange").textContent =
    `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} to ${last.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  document.getElementById("apCal").innerHTML = weeks.map((days) => `<div class="ap-cal" style="margin-bottom:8px">${days.map((d) => {
    const key = iso(d);
    const evs = booked.filter((j) => j.scheduledDate === key)
      .sort((a, b) => String(a.arrivalTime || a.scheduledWindow).localeCompare(String(b.arrivalTime || b.scheduledWindow)));
    return `<div class="ap-day ${key === today ? "today" : ""}"><div class="ap-dh">${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
      ${evs.map((j) => `<div class="ap-ev"><strong>${esc(short(j.clientName))}</strong>${esc(j.serviceLabel || j.serviceType || "")}<br>${esc(j.arrivalTime || WINDOWS[j.scheduledWindow] || "")}${j.area ? ` · ${esc(j.area)}` : ""}</div>`).join("")}
    </div>`;
  }).join("")}</div>`).join("");
}

function start() {
  onSnapshot(doc(db, "settings", "pipeline"), (snap) => {
    settings = { autopilot: false, subsByService: {}, ...(snap.exists() ? snap.data() : {}) };
    drawSettings();
  }, (err) => { document.getElementById("apMsg").textContent = "Couldn't load autopilot settings: " + err.message; });

  onSnapshot(query(collection(db, "users"), where("role", "in", CONTRACTOR_ROLES)), (snap) => {
    contractors = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u.role !== "admin" || u.serviceTypes?.length)
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    drawSettings();
  }, (err) => console.warn("autopilot contractors:", err));

  onSnapshot(query(collection(db, "quoteRequests"), where("ivyManaged", "==", true), limit(100)), (snap) => {
    quotes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    drawBoard();
  }, (err) => console.warn("autopilot quotes:", err));

  onSnapshot(query(collection(db, "jobs"), where("ivyManaged", "==", true), limit(200)), (snap) => {
    jobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    drawBoard();
  }, (err) => console.warn("autopilot jobs:", err));

  onSnapshot(query(collection(db, "jobs"), where("schedStatus", "==", "confirmed"), limit(400)), (snap) => {
    booked = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((j) => j.scheduledDate);
    drawCalendar();
  }, (err) => console.warn("autopilot calendar:", err));
}

let started = false;
onAuthStateChanged(auth, (user) => {
  if (!user || started) return;
  const go = () => { if (injectUI()) { started = true; start(); drawCalendar(); return true; } return false; };
  if (!go()) {
    const t = setInterval(() => { if (go()) clearInterval(t); }, 700);
    setTimeout(() => clearInterval(t), 10000);
  }
});
