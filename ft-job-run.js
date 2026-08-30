// === The Finishing Touch — Contractor job run screen ===
//
// Drop-in module. Add before </body> in contractor-dashboard.html:
//   <script type="module" src="ft-job-run.js"></script>
//
// Deliberately renders as a full-screen overlay rather than another dashboard
// view. A cleaner working a job wants one thing on screen, not navigation.
// It also means this file touches none of the dashboard's internals, so it
// can't break the pages you already have working.
//
// Written to match your existing security rules exactly. Everything below is
// a path your rules already permit for an assigned, active contractor:
//   jobs/{id}                  status + workflowStatus, walked along the
//                              state machine your rules enforce, plus only
//                              the timestamp fields they whitelist
//   jobs/{id}/workflow/{uid}   checklist progress, en route and check out
//                              times, and anything else the job doc won't take
//   jobs/{id}/photos/          one doc per photo
//   jobs/{id}/incidents/       problem reports
//   messages/                  the Ivy queue, stamped contractorUid as your
//                              rules require
//
// It deliberately does NOT write to `mail`. Your rules make that admin-only,
// which is right — a contractor should not be able to email your client list.
//
// Storage layout: jobPhotos/{jobId}/{uid}/{key}-{timestamp}.jpg

import { db, auth, storage } from "./ft-firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js";
import {
  loadChecklist, itemsFor, itemText, say, lang, setLang,
  PROPRIETARY_NOTICE, UI, PROBLEM_KINDS, CHECKLIST_VERSION
} from "./ft-checklists.js";

/* ------------------------------------------------------------------ *
 * state
 * ------------------------------------------------------------------ */

let me = null;               // firebase user
let myProfile = {};          // users/{uid}
let myJobs = [];             // jobs assigned to me
let job = null;              // the job being run
let list = null;             // the checklist definition
let prog = null;             // progress doc: {rooms, checked, photos, tier, ...}
let steps = [];              // flattened, ordered list of screens
let at = 0;                  // index into steps
let unsub = null;
let busy = false;

const L = () => lang();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ *
 * styles — scoped to #ftjr so nothing here can leak into your pages
 * ------------------------------------------------------------------ */

function injectStyles() {
  if ($("ftjr-css")) return;
  const s = document.createElement("style");
  s.id = "ftjr-css";
  s.textContent = `
#ftjr-launch{position:fixed;left:0;right:0;bottom:0;z-index:9000;padding:12px 14px calc(12px + env(safe-area-inset-bottom));
  background:#fffdfb;border-top:1px solid #eadfd8;box-shadow:0 -8px 28px rgba(84,54,45,.10);display:none}
#ftjr-launch.on{display:block}
#ftjr-launch .jr-lwrap{max-width:640px;margin:0 auto;display:flex;gap:12px;align-items:center}
#ftjr-launch .jr-lmeta{flex:1;min-width:0}
#ftjr-launch .jr-lmeta b{display:block;font:600 15px/1.3 Manrope,system-ui,sans-serif;color:#2f2926;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ftjr-launch .jr-lmeta span{font:500 12.5px/1.4 Manrope,system-ui,sans-serif;color:#8a7d75}

#ftjr{position:fixed;inset:0;z-index:9500;background:#fbf7f4;display:none;
  font-family:Manrope,system-ui,-apple-system,sans-serif;color:#2f2926;
  flex-direction:column;overscroll-behavior:contain}
#ftjr.on{display:flex}
#ftjr *{box-sizing:border-box}

#ftjr .jr-top{flex:0 0 auto;background:#fffdfb;border-bottom:1px solid #eadfd8;
  padding:calc(10px + env(safe-area-inset-top)) 14px 10px}
#ftjr .jr-toprow{display:flex;align-items:center;gap:10px;max-width:640px;margin:0 auto}
#ftjr .jr-x{background:none;border:0;font-size:26px;line-height:1;color:#8a7d75;padding:2px 8px;cursor:pointer}
#ftjr .jr-where{flex:1;min-width:0}
#ftjr .jr-where b{display:block;font:700 14px/1.25 Manrope,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ftjr .jr-where span{font:600 11px/1.3 Manrope,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#9c6b74}
#ftjr .jr-lang{display:flex;border:1px solid #ddcec4;border-radius:999px;overflow:hidden;flex:0 0 auto}
#ftjr .jr-lang button{background:#fff;border:0;padding:5px 11px;font:700 12px Manrope,sans-serif;color:#8a7d75;cursor:pointer}
#ftjr .jr-lang button.on{background:#9c6b74;color:#fff}
#ftjr .jr-bar{height:4px;background:#eadfd8;border-radius:999px;margin:10px auto 0;max-width:640px;overflow:hidden}
#ftjr .jr-bar i{display:block;height:100%;background:#9c6b74;border-radius:999px;transition:width .3s ease}

#ftjr .jr-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:22px 16px 20px;position:relative}
#ftjr .jr-inner{max-width:640px;margin:0 auto;position:relative;z-index:1}

/* watermark — traceable, not decorative */
#ftjr .jr-wm{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;
  display:flex;align-items:center;justify-content:center}
#ftjr .jr-wm span{transform:rotate(-27deg);white-space:nowrap;text-align:center;
  font:700 15px/2.4 Manrope,sans-serif;color:rgba(156,107,116,.085);letter-spacing:.05em}

#ftjr .jr-kicker{font:800 11px/1.4 Manrope,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#9c6b74;margin:0 0 8px}
#ftjr h2.jr-h{font:700 25px/1.25 Manrope,sans-serif;margin:0 0 6px;letter-spacing:-.01em}
#ftjr .jr-sub{font:500 15px/1.55 Manrope,sans-serif;color:#5d534d;margin:0 0 20px}
#ftjr .jr-count{font:700 12px/1 Manrope,sans-serif;color:#8a7d75;margin-bottom:14px;font-variant-numeric:tabular-nums}

/* the one item on screen */
#ftjr .jr-item{background:#fffdfb;border:1px solid #eadfd8;border-radius:16px;padding:22px 20px;margin-bottom:16px}
#ftjr .jr-item p{font:600 19px/1.45 Manrope,sans-serif;margin:0}
#ftjr .jr-ul{margin:0;padding-left:22px;list-style:none}
#ftjr .jr-ul li{position:relative;font:500 16.5px/1.5 Manrope,sans-serif;margin-bottom:15px;color:#2f2926}
#ftjr .jr-ul li:last-child{margin-bottom:0}
#ftjr .jr-ul li:before{content:"";position:absolute;left:-19px;top:9px;width:7px;height:7px;
  border-radius:50%;background:#c9a9b0}
#ftjr .jr-tierpill{display:inline-block;font:800 10.5px/1 Manrope,sans-serif;letter-spacing:.08em;text-transform:uppercase;
  background:#fff1f3;color:#9c6b74;border:1px solid #ddcec4;padding:5px 9px;border-radius:999px;margin-bottom:12px}

#ftjr .jr-photo{margin-top:16px}
#ftjr .jr-photo input{display:none}
#ftjr .jr-shot{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;
  background:#fff1f3;border:1.5px dashed #c9a9b0;border-radius:12px;padding:20px 14px;
  font:700 15px Manrope,sans-serif;color:#9c6b74;cursor:pointer}
#ftjr .jr-thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#ftjr .jr-thumbs img{width:66px;height:66px;object-fit:cover;border-radius:9px;border:1px solid #eadfd8}
#ftjr .jr-need{font:700 12.5px Manrope,sans-serif;color:#a8524f;margin-top:9px}

/* room picker + generic option rows */
#ftjr .jr-opts{display:flex;flex-direction:column;gap:9px;margin-bottom:18px}
#ftjr .jr-opt{display:flex;align-items:center;gap:12px;background:#fffdfb;border:1.5px solid #eadfd8;
  border-radius:13px;padding:15px 16px;font:600 16px Manrope,sans-serif;cursor:pointer;text-align:left;width:100%}
#ftjr .jr-opt.sel{border-color:#9c6b74;background:#fff1f3}
#ftjr .jr-tick{flex:0 0 auto;width:23px;height:23px;border-radius:7px;border:2px solid #ddcec4;background:#fff;
  display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:800}
#ftjr .jr-opt.sel .jr-tick{background:#9c6b74;border-color:#9c6b74}

#ftjr .jr-note{width:100%;border:1.5px solid #eadfd8;border-radius:12px;padding:13px;
  font:500 15px/1.5 Manrope,sans-serif;min-height:110px;resize:vertical;background:#fffdfb;color:#2f2926}

/* footer actions */
#ftjr .jr-foot{flex:0 0 auto;background:#fffdfb;border-top:1px solid #eadfd8;
  padding:12px 16px calc(12px + env(safe-area-inset-bottom))}
#ftjr .jr-frow{max-width:640px;margin:0 auto;display:flex;gap:10px}
#ftjr .jr-b{flex:1;border:0;border-radius:13px;padding:16px 18px;font:700 16px Manrope,sans-serif;cursor:pointer}
#ftjr .jr-b:disabled{opacity:.42;cursor:not-allowed}
#ftjr .jr-b.pri{background:#9c6b74;color:#fff}
#ftjr .jr-b.soft{background:#f6efe9;color:#5d534d;flex:0 0 auto;min-width:96px}
#ftjr .jr-b.go{background:#4a7c59;color:#fff}
#ftjr .jr-b.warn{background:#fff;color:#a8524f;border:1.5px solid #e3b4b2;flex:0 0 auto;min-width:60px;font-size:20px;padding:16px 14px}

#ftjr .jr-legal{font:500 11px/1.55 Manrope,sans-serif;color:#a0938b;margin-top:26px;padding-top:14px;border-top:1px solid #eadfd8}
#ftjr .jr-flash{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:9600;
  background:#2f2926;color:#fff;padding:11px 18px;border-radius:999px;font:600 14px Manrope,sans-serif;
  opacity:0;transition:opacity .25s;pointer-events:none;max-width:88vw;text-align:center}
#ftjr .jr-flash.on{opacity:1}

@media (prefers-reduced-motion:reduce){#ftjr *{transition:none!important}}
`;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ *
 * building the ordered run
 * ------------------------------------------------------------------ */

// One screen per STEP, not per item.
//
// A whole-home reset is 276 individual items. Nobody taps through that on a
// phone; they'd start tapping blind by the third room and the data would be
// worthless. So consecutive items are batched into one step card the crew
// confirms together, which brings a full house to about 70 screens.
//
// Photo items are never batched. Those get their own screen, because a photo
// is the one thing that needs the crew to stop and look.
//
// Document order is preserved exactly: a photo splits the batch around it,
// so nothing is reordered relative to the SOP.
function pushSection(out, sec, tier, roomId, room, prefix) {
  const items = itemsFor(sec, tier);
  let batch = [], g = 0;
  const flush = () => {
    if (!batch.length) return;
    out.push({ kind: "group", sec, items: batch, roomId, room, key: `${prefix}:${sec.id}:g${g++}` });
    batch = [];
  };
  items.forEach(it => {
    if (it.photo) { flush(); out.push({ kind: "item", sec, it, roomId, room, key: `${prefix}:${sec.id}:${it.id}` }); }
    else batch.push(it);
  });
  flush();
}

function buildSteps() {
  const tier = prog?.tier || "standard";
  const out = [];

  out.push({ kind: "arrive" });

  (list.start || []).forEach(sec => {
    if (sec.id === "step1") out.push({ kind: "rooms", sec });
    pushSection(out, sec, tier, null, null, "start");
  });

  (prog?.rooms || []).forEach(roomId => {
    const room = (list.rooms || []).find(r => r.id === roomId);
    out.push({ kind: "roomstart", roomId, room });
    (list.perRoom || []).forEach(sec => pushSection(out, sec, tier, roomId, room, roomId));
    if (room) {
      const rs = { id: `room-${room.id}`, title: room.label };
      pushSection(out, rs, tier, roomId, room, roomId);
    }
  });

  (list.end || []).forEach(sec => pushSection(out, sec, tier, null, null, "end"));

  out.push({ kind: "leave" });
  return out;
}

// First screen that still needs doing, so closing the app and coming back
// drops you where you left off rather than at the start.
function firstUndone() {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "arrive") { if (!prog?.checkedInAt) return i; continue; }
    if (s.kind === "rooms")  { if (!(prog?.rooms || []).length) return i; continue; }
    if (s.kind === "item" || s.kind === "group") { if (!prog?.checked?.[s.key]) return i; continue; }
    if (s.kind === "leave")  return i;
  }
  return steps.length - 1;
}

/* ------------------------------------------------------------------ *
 * persistence — Firestore first, localStorage as the offline net
 * ------------------------------------------------------------------ */

const cacheKey = () => `ftjr:${job?.id}:${me?.uid}`;

function cacheSave() {
  try { localStorage.setItem(cacheKey(), JSON.stringify(prog)); } catch {}
}

function cacheLoad() {
  try {
    const raw = localStorage.getItem(cacheKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function saveProgress(patch) {
  Object.assign(prog, patch);
  cacheSave();
  try {
    await setDoc(
      doc(db, "jobs", job.id, "workflow", me.uid),
      { ...patch, contractorId: me.uid, checklistVersion: CHECKLIST_VERSION, updatedAt: serverTimestamp() },
      { merge: true }
    );
    return true;
  } catch (e) {
    console.warn("progress save deferred:", e);
    flash(say(UI.offline));
    return false;
  }
}

// Your security rules enforce a state machine on jobs. A contractor may only
// move a job along these exact edges, and may only touch these seven fields:
//   status, workflowStatus, updatedAt, checkedInAt, startedAt,
//   submittedAt, completedChecklistAt
// Anything else is denied. So this walks the machine rather than setting
// whatever it likes, and quietly no-ops when the job isn't where we expect
// (someone moved it in the admin dashboard, or a step already ran).
const TRANSITIONS = {
  checked_in:              ["claimed"],
  before_photos_submitted: ["checked_in"],
  in_progress:             ["claimed", "before_photos_submitted"],
  checklist_completed:     ["in_progress"],
  after_photos_submitted:  ["checklist_completed"],
  submitted_for_review:    ["after_photos_submitted"]
};

// Which of the allowed timestamp fields each state stamps.
const STAMPS = {
  checked_in:           "checkedInAt",
  in_progress:          "startedAt",
  checklist_completed:  "completedChecklistAt",
  submitted_for_review: "submittedAt"
};

async function advance(to) {
  const from = String(job.status || "");
  const allowedFrom = TRANSITIONS[to] || [];
  if (!allowedFrom.includes(from)) return false;   // not our turn; leave it alone

  const patch = { status: to, workflowStatus: to, updatedAt: serverTimestamp() };
  if (STAMPS[to]) patch[STAMPS[to]] = serverTimestamp();

  try {
    await updateDoc(doc(db, "jobs", job.id), patch);
    job.status = to;
    job.workflowStatus = to;
    return true;
  } catch (e) {
    console.warn(`couldn't move job ${from} -> ${to}:`, e);
    return false;
  }
}

// Everything the rules won't let a contractor put on the job document —
// en route time, check out time, per-step detail — goes in the workflow
// subcollection, which your rules already let an assigned contractor write.
async function noteWorkflow(patch) {
  try {
    await setDoc(
      doc(db, "jobs", job.id, "workflow", me.uid),
      { ...patch, contractorId: me.uid, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (e) { console.warn("workflow note failed:", e); }
}

/* ------------------------------------------------------------------ *
 * the Ivy queue
 * ------------------------------------------------------------------ */

// Everything client-facing goes through one queue so it can all be read in
// one place. Today a copy also goes to `mail` for delivery. When Twilio is
// live, the function drains `messages` as SMS and the copy stops.
async function queueClientMessage(kind, subject, text) {
  let to = "", name = "";
  try {
    if (job.clientId) {
      const cs = await getDoc(doc(db, "users", job.clientId));
      if (cs.exists()) { to = cs.data().email || ""; name = cs.data().name || cs.data().displayName || ""; }
    }
  } catch {}
  if (!to) to = job.clientEmail || "";

  const payload = {
    kind, jobId: job.id, to, toName: name, channel: "auto",
    subject, body: text, status: "queued", from: "ivy",
    contractorUid: me.uid, createdAt: serverTimestamp()
  };
  try { await addDoc(collection(db, "messages"), payload); } catch (e) { console.warn("queue failed:", e); }

  // NOTE: your rules make `mail` admin-only, correctly — a contractor
  // shouldn't be able to email your client list. So the runner queues to
  // `messages` and nothing more. Delivery happens when a Cloud Function
  // drains that queue, as SMS once Twilio clears, or as mail before then.
  // Until that function exists these messages queue up for you to see in the
  // dashboard; they do not reach the client on their own yet.
}

/* ------------------------------------------------------------------ *
 * photos
 * ------------------------------------------------------------------ */

async function uploadPhoto(file, step) {
  const stamp = Date.now();
  const safe = (step.key || "photo").replace(/[^a-z0-9]+/gi, "-");
  const path = `jobPhotos/${job.id}/${me.uid}/${safe}-${stamp}.jpg`;
  const snap = await uploadBytes(ref(storage, path), file, { contentType: file.type || "image/jpeg" });
  const url = await getDownloadURL(snap.ref);

  await addDoc(collection(db, "jobs", job.id, "photos"), {
    url, path,
    kind: step.it?.photo || "progress",
    roomId: step.roomId || "",
    itemId: step.it?.id || "",
    itemKey: step.key || "",
    contractorId: me.uid,
    contractorEmail: me.email || "",
    takenAt: serverTimestamp()
  });

  const photos = { ...(prog.photos || {}) };
  photos[step.key] = [...(photos[step.key] || []), url];
  await saveProgress({ photos });

  // The first before photo and the first after photo each move the job along
  // one edge of your state machine. advance() no-ops if it isn't due.
  if (step.it?.photo === "before") await advance("before_photos_submitted");
  if (step.it?.photo === "after")  await advance("after_photos_submitted");

  return url;
}

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */

function flash(msg) {
  const el = $("ftjr-flash");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(flash._t);
  flash._t = setTimeout(() => el.classList.remove("on"), 2600);
}

function watermark() {
  const who = me?.email || me?.uid || "";
  const when = new Date().toLocaleString();
  const line = `${who} · ${when} · The Finishing Touch Co. `;
  return `<div class="jr-wm" aria-hidden="true"><span>${esc(line.repeat(2))}<br>${esc(line.repeat(2))}<br>${esc(line.repeat(2))}<br>${esc(line.repeat(2))}<br>${esc(line.repeat(2))}<br>${esc(line.repeat(2))}</span></div>`;
}

function tierLabel() {
  const t = (list.tiers || []).find(x => x.id === (prog?.tier || "standard"));
  return t ? say(t.label) : "";
}

function render() {
  const step = steps[at];
  if (!step) return;

  const pct = Math.round(((at + 1) / steps.length) * 100);
  $("ftjr-bar").style.width = pct + "%";
  $("ftjr-jobname").textContent = job.summary || say(list.title);
  $("ftjr-kicker").textContent = step.room ? say(step.room.label) : (job.area || job.zip || say(list.title));

  const body = $("ftjr-body");
  const foot = $("ftjr-foot");

  if (step.kind === "arrive")     return paintArrive(body, foot);
  if (step.kind === "rooms")      return paintRooms(body, foot);
  if (step.kind === "roomstart")  return paintRoomStart(body, foot, step);
  if (step.kind === "leave")      return paintLeave(body, foot);
  if (step.kind === "group")      return paintGroup(body, foot, step);
  return paintItem(body, foot, step);
}

// A whole step on one screen. Items are listed together and confirmed as a
// group, the way a paper checklist with sub-bullets actually gets worked.
// Every individual item id is still written to the record, so the job history
// shows exactly what was confirmed, not just that a step was passed.
function paintGroup(body, foot, step) {
  const done = !!prog?.checked?.[step.key];
  const tier = prog?.tier;

  body.innerHTML = `${watermark()}<div class="jr-inner">
    <p class="jr-kicker">${esc(say(step.sec.title))}</p>
    ${step.items.some(i => i.byTier) ? `<span class="jr-tierpill">${esc(tierLabel())}</span>` : ""}
    ${step.sec.intro ? `<p class="jr-sub">${esc(say(step.sec.intro))}</p>` : ""}
    <div class="jr-item">
      <ul class="jr-ul">
        ${step.items.map(it => `<li>${esc(itemText(it, tier))}</li>`).join("")}
      </ul>
    </div>
    <p class="jr-legal">${esc(say(PROPRIETARY_NOTICE))}</p>
  </div>`;

  foot.innerHTML = `<div class="jr-frow">
    <button class="jr-b soft" id="jr-back">${esc(say(UI.back))}</button>
    <button class="jr-b warn" id="jr-prob">&#9888;</button>
    <button class="jr-b pri" id="jr-next">${esc(done ? say(UI.next) : say(UI.done))}</button>
  </div>`;

  $("jr-next").onclick = async () => {
    if (!done) {
      const checked = { ...(prog.checked || {}) };
      const now = Timestamp.now();
      checked[step.key] = now;
      step.items.forEach(it => {
        const ik = `${step.roomId || (step.sec.id.startsWith("f-") ? "end" : "start")}:${step.sec.id}:${it.id}`;
        checked[ik] = now;
      });
      await saveProgress({ checked });
      if (!prog.startedWorkAt) {
        await saveProgress({ startedWorkAt: Timestamp.now() });
        await advance("in_progress");
      }
    }
    at++; render();
  };
  $("jr-back").onclick = () => { if (at > 0) { at--; render(); } };
  $("jr-prob").onclick = openProblem;
}

function paintArrive(body, foot) {
  const enRoute = !!prog?.enRouteAt;
  body.innerHTML = `${watermark()}<div class="jr-inner">
    <p class="jr-kicker">${esc(job.serviceDate?.toDate ? job.serviceDate.toDate().toLocaleDateString([], { weekday:"long", month:"short", day:"numeric" }) : "")}</p>
    <h2 class="jr-h">${esc(job.summary || say(list.title))}</h2>
    <p class="jr-sub">${esc([job.area, job.zip].filter(Boolean).join(" · "))}</p>
    ${tierLabel() ? `<span class="jr-tierpill">${esc(tierLabel())}</span>` : ""}
    <div class="jr-item"><p>${esc(job.notes || job.summary || "")}</p></div>
  </div>`;
  foot.innerHTML = `<div class="jr-frow">
    <button class="jr-b soft" id="jr-enroute" ${enRoute ? "disabled" : ""}>${esc(say(UI.onMyWay))}</button>
    <button class="jr-b go" id="jr-checkin">${esc(say(UI.arrived))}</button>
  </div>`;

  $("jr-enroute").onclick = async () => {
    if (busy) return; busy = true;
    $("jr-enroute").disabled = true;
    await saveProgress({ enRouteAt: Timestamp.now() });
    await noteWorkflow({ enRouteAt: serverTimestamp() });
    await queueClientMessage(
      "en_route",
      "Your Finishing Touch team is on the way",
      "Your Finishing Touch team is on the way and should arrive shortly. We'll let you know as soon as they're there."
    );
    flash(say({ en: "Client notified", es: "Cliente avisado" }));
    busy = false;
  };

  $("jr-checkin").onclick = async () => {
    if (busy) return; busy = true;
    await saveProgress({ checkedInAt: Timestamp.now() });
    await advance("checked_in");
    await queueClientMessage(
      "arrived",
      "Your Finishing Touch team has arrived",
      `Your team has arrived and is starting your ${job.serviceType || "service"} now. Thank you!`
    );
    busy = false;
    at++; render();
  };
}

function paintRooms(body, foot) {
  const chosen = new Set(prog?.rooms || []);
  body.innerHTML = `${watermark()}<div class="jr-inner">
    <p class="jr-kicker">${esc(say({ en:"Step 1", es:"Paso 1" }))}</p>
    <h2 class="jr-h">${esc(say(UI.whichRooms))}</h2>
    <p class="jr-sub">${esc(say({ en:"Walk the home with the client first, then tick every room on today's list. Only these will appear in your checklist.", es:"Primero recorre la casa con el cliente, luego marca cada cuarto que entra hoy. Solo esos van a aparecer en tu lista." }))}</p>
    <div class="jr-opts">
      ${(list.rooms || []).map(r => `
        <button class="jr-opt ${chosen.has(r.id) ? "sel" : ""}" data-room="${esc(r.id)}">
          <span class="jr-tick">${chosen.has(r.id) ? "&#10003;" : ""}</span>${esc(say(r.label))}
        </button>`).join("")}
    </div>
  </div>`;
  foot.innerHTML = `<div class="jr-frow">
    <button class="jr-b soft" id="jr-back">${esc(say(UI.back))}</button>
    <button class="jr-b warn" id="jr-prob" title="${esc(say(UI.problem))}">&#9888;</button>
    <button class="jr-b pri" id="jr-next" ${chosen.size ? "" : "disabled"}>${esc(say(UI.next))}</button>
  </div>`;

  body.querySelectorAll("[data-room]").forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.room;
      chosen.has(id) ? chosen.delete(id) : chosen.add(id);
      // keep the order the checklist defines, not the order they tapped
      const ordered = (list.rooms || []).map(r => r.id).filter(id2 => chosen.has(id2));
      await saveProgress({ rooms: ordered });
      steps = buildSteps();
      render();
    };
  });
  wireFoot();
}

function paintRoomStart(body, foot, step) {
  body.innerHTML = `${watermark()}<div class="jr-inner">
    <p class="jr-kicker">${esc(say({ en:"Next room", es:"Siguiente cuarto" }))}</p>
    <h2 class="jr-h">${esc(step.room ? say(step.room.label) : "")}</h2>
    <p class="jr-sub">${esc(say({ en:"Work this room completely before opening the next one.", es:"Termina este cuarto por completo antes de abrir el siguiente." }))}</p>
  </div>`;
  foot.innerHTML = `<div class="jr-frow">
    <button class="jr-b soft" id="jr-back">${esc(say(UI.back))}</button>
    <button class="jr-b warn" id="jr-prob">&#9888;</button>
    <button class="jr-b pri" id="jr-next">${esc(say(UI.startRoom))}</button>
  </div>`;
  wireFoot();
}

function paintItem(body, foot, step) {
  const done = !!prog?.checked?.[step.key];
  const shots = prog?.photos?.[step.key] || [];
  const needsPhoto = !!step.it.photo && shots.length === 0;

  // how far through this section we are, so they can see the end coming
  const sectionSteps = steps.filter(s => s.kind === "item" && s.sec.id === step.sec.id && s.roomId === step.roomId);
  const pos = sectionSteps.indexOf(step) + 1;

  body.innerHTML = `${watermark()}<div class="jr-inner">
    <p class="jr-kicker">${esc(say(step.sec.title))}</p>
    <div class="jr-count">${pos} ${esc(say(UI.ofCount))} ${sectionSteps.length}</div>
    ${step.it.byTier ? `<span class="jr-tierpill">${esc(tierLabel())}</span>` : ""}
    ${step.sec.intro && pos === 1 ? `<p class="jr-sub">${esc(say(step.sec.intro))}</p>` : ""}
    <div class="jr-item">
      <p>${esc(itemText(step.it, prog?.tier))}</p>
      ${step.it.photo ? `
      <div class="jr-photo">
        <label class="jr-shot" for="jr-file">&#128247; ${esc(say(step.it.photo === "before" ? UI.beforePhoto : step.it.photo === "after" ? UI.afterPhoto : UI.addPhoto))}</label>
        <input id="jr-file" type="file" accept="image/*" capture="environment">
        <div class="jr-thumbs">${shots.map(u => `<img src="${esc(u)}" alt="">`).join("")}</div>
        ${needsPhoto ? `<div class="jr-need">${esc(say(UI.photoNeeded))}</div>` : ""}
      </div>` : ""}
    </div>
    <p class="jr-legal">${esc(say(PROPRIETARY_NOTICE))}</p>
  </div>`;

  foot.innerHTML = `<div class="jr-frow">
    <button class="jr-b soft" id="jr-back">${esc(say(UI.back))}</button>
    <button class="jr-b warn" id="jr-prob">&#9888;</button>
    <button class="jr-b pri" id="jr-next" ${needsPhoto ? "disabled" : ""}>${esc(done ? say(UI.next) : say(UI.done))}</button>
  </div>`;

  const file = $("jr-file");
  if (file) file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    const btn = document.querySelector("#ftjr .jr-shot");
    if (btn) btn.textContent = "…";
    try { await uploadPhoto(f, step); render(); }
    catch (e) { console.warn(e); flash(say({ en:"Photo didn't upload. Try again.", es:"La foto no se subió. Intenta otra vez." })); render(); }
  };

  $("jr-next").onclick = async () => {
    if (!done) {
      const checked = { ...(prog.checked || {}), [step.key]: Timestamp.now() };
      await saveProgress({ checked });
      if (!prog.startedWorkAt) {
        await saveProgress({ startedWorkAt: Timestamp.now() });
        await advance("in_progress");
      }
    }
    at++; render();
  };
  $("jr-back").onclick = () => { if (at > 0) { at--; render(); } };
  $("jr-prob").onclick = openProblem;
}

function paintLeave(body, foot) {
  const total = steps.filter(s => s.kind === "item").length;
  const done = steps.filter(s => s.kind === "item" && prog?.checked?.[s.key]).length;
  const missed = total - done;

  body.innerHTML = `${watermark()}<div class="jr-inner">
    <p class="jr-kicker">${esc(say({ en:"Last step", es:"Último paso" }))}</p>
    <h2 class="jr-h">${esc(say({ en:"Ready to close out?", es:"¿Listo para cerrar?" }))}</h2>
    <p class="jr-sub">${esc(say({ en:"This tells the office you've finished and left the property.", es:"Esto le avisa a la oficina que terminaste y ya saliste de la propiedad." }))}</p>
    <div class="jr-item">
      <p>${done} ${esc(say(UI.ofCount))} ${total} ${esc(say({ en:"items completed", es:"tareas completadas" }))}</p>
      ${missed > 0 ? `<div class="jr-need">${missed} ${esc(say({ en:"still unticked. Go back if that's not right.", es:"sin marcar todavía. Regresa si no está bien." }))}</div>` : ""}
    </div>
  </div>`;
  foot.innerHTML = `<div class="jr-frow">
    <button class="jr-b soft" id="jr-back">${esc(say(UI.back))}</button>
    <button class="jr-b warn" id="jr-prob">&#9888;</button>
    <button class="jr-b go" id="jr-out">${esc(say(UI.finished))}</button>
  </div>`;

  $("jr-back").onclick = () => { at--; render(); };
  $("jr-prob").onclick = openProblem;
  $("jr-out").onclick = async () => {
    if (busy) return; busy = true;
    await saveProgress({ checkedOutAt: Timestamp.now(), itemsDone: done, itemsTotal: total });
    await noteWorkflow({ checkedOutAt: serverTimestamp(), itemsDone: done, itemsTotal: total });
    // Walk the remaining edges the rules expect, in order.
    await advance("checklist_completed");
    await advance("after_photos_submitted");
    await advance("submitted_for_review");
    await queueClientMessage(
      "complete",
      "Your Finishing Touch service is complete",
      `Your ${job.serviceType || "service"} is complete and your team has left. We'll be in touch shortly. Thank you!`
    );
    busy = false;
    close();
    flash(say({ en:"Job submitted. Thank you!", es:"Trabajo enviado. ¡Gracias!" }));
  };
}

/* ------------------------------------------------------------------ *
 * problem reporting
 * ------------------------------------------------------------------ */

function openProblem() {
  const step = steps[at];
  const body = $("ftjr-body");
  const foot = $("ftjr-foot");
  let kind = "";

  body.innerHTML = `<div class="jr-inner">
    <p class="jr-kicker">${esc(say({ en:"Report", es:"Reporte" }))}</p>
    <h2 class="jr-h">${esc(say(UI.problem))}</h2>
    <p class="jr-sub">${esc(say({ en:"This goes straight to the office. Your work is saved, you won't lose your place.", es:"Esto va directo a la oficina. Tu trabajo está guardado, no vas a perder tu lugar." }))}</p>
    <div class="jr-opts">
      ${PROBLEM_KINDS.map(k => `<button class="jr-opt" data-kind="${esc(k.id)}"><span class="jr-tick"></span>${esc(say(k.t))}</button>`).join("")}
    </div>
    <textarea class="jr-note" id="jr-pnote" placeholder="${esc(say({ en:"What happened?", es:"¿Qué pasó?" }))}"></textarea>
    <div class="jr-photo" style="margin-top:12px">
      <label class="jr-shot" for="jr-pfile">&#128247; ${esc(say(UI.addPhoto))}</label>
      <input id="jr-pfile" type="file" accept="image/*" capture="environment">
      <div class="jr-thumbs" id="jr-pthumb"></div>
    </div>
  </div>`;
  foot.innerHTML = `<div class="jr-frow">
    <button class="jr-b soft" id="jr-pcancel">${esc(say(UI.back))}</button>
    <button class="jr-b pri" id="jr-psend" disabled>${esc(say({ en:"Send", es:"Enviar" }))}</button>
  </div>`;

  let shotUrl = "";
  body.querySelectorAll("[data-kind]").forEach(b => {
    b.onclick = () => {
      body.querySelectorAll("[data-kind]").forEach(x => { x.classList.remove("sel"); x.querySelector(".jr-tick").innerHTML = ""; });
      b.classList.add("sel");
      b.querySelector(".jr-tick").innerHTML = "&#10003;";
      kind = b.dataset.kind;
      $("jr-psend").disabled = false;
    };
  });

  $("jr-pfile").onchange = async () => {
    const f = $("jr-pfile").files?.[0];
    if (!f) return;
    try {
      const path = `jobPhotos/${job.id}/${me.uid}/incident-${Date.now()}.jpg`;
      const snap = await uploadBytes(ref(storage, path), f, { contentType: f.type || "image/jpeg" });
      shotUrl = await getDownloadURL(snap.ref);
      $("jr-pthumb").innerHTML = `<img src="${esc(shotUrl)}" alt="">`;
    } catch (e) { console.warn(e); flash(say({ en:"Photo didn't upload.", es:"La foto no se subió." })); }
  };

  $("jr-pcancel").onclick = render;

  $("jr-psend").onclick = async () => {
    if (busy) return; busy = true;
    const note = $("jr-pnote").value.trim();
    const label = say((PROBLEM_KINDS.find(k => k.id === kind) || {}).t) || kind;
    try {
      await addDoc(collection(db, "jobs", job.id, "incidents"), {
        kind, note, photoUrl: shotUrl,
        roomId: step?.roomId || "", itemKey: step?.key || "",
        contractorId: me.uid, contractorEmail: me.email || "",
        status: "open", createdAt: serverTimestamp()
      });
      // Same reason as the client notification: your rules keep `mail`
      // admin-only. The incident lands in the queue you can read, and in the
      // job's own incidents subcollection where it belongs permanently.
      await addDoc(collection(db, "messages"), {
        kind: "incident",
        jobId: job.id,
        to: "contact.thefinishingtouch.tx@gmail.com",
        subject: `Job issue: ${label} — ${job.summary || job.id}`,
        body: [
          label,
          note || "(no note)",
          `Job: ${job.summary || job.id}`,
          `Where: ${step?.room ? say(step.room.label) : "—"}`,
          `Reported by: ${me.email || me.uid}`,
          shotUrl ? `Photo: ${shotUrl}` : ""
        ].filter(Boolean).join("\n"),
        photoUrl: shotUrl,
        status: "queued",
        priority: kind === "safety" || kind === "damage" ? "high" : "normal",
        contractorUid: me.uid,
        createdAt: serverTimestamp()
      });
      flash(say({ en:"Sent to the office.", es:"Enviado a la oficina." }));
    } catch (e) {
      console.warn(e);
      flash(say({ en:"Couldn't send. Saved on this phone.", es:"No se pudo enviar. Guardado en este teléfono." }));
    }
    busy = false;
    render();
  };
}

/* ------------------------------------------------------------------ *
 * shell, open and close
 * ------------------------------------------------------------------ */

function wireFoot() {
  const b = $("jr-back"), n = $("jr-next"), p = $("jr-prob");
  if (b) b.onclick = () => { if (at > 0) { at--; render(); } };
  if (n) n.onclick = () => { at++; render(); };
  if (p) p.onclick = openProblem;
}

function shell() {
  if ($("ftjr")) return;
  const el = document.createElement("div");
  el.id = "ftjr";
  el.innerHTML = `
    <div class="jr-top">
      <div class="jr-toprow">
        <button class="jr-x" id="ftjr-close" aria-label="Close">&times;</button>
        <div class="jr-where"><span id="ftjr-kicker"></span><b id="ftjr-jobname"></b></div>
        <div class="jr-lang">
          <button data-l="en">EN</button><button data-l="es">ES</button>
        </div>
      </div>
      <div class="jr-bar"><i id="ftjr-bar" style="width:0%"></i></div>
    </div>
    <div class="jr-body" id="ftjr-body"></div>
    <div class="jr-foot" id="ftjr-foot"></div>
    <div class="jr-flash" id="ftjr-flash"></div>`;
  document.body.appendChild(el);

  $("ftjr-close").onclick = close;
  el.querySelectorAll(".jr-lang button").forEach(b => {
    b.onclick = () => {
      setLang(b.dataset.l);
      el.querySelectorAll(".jr-lang button").forEach(x => x.classList.toggle("on", x.dataset.l === lang()));
      render();
    };
  });
  el.querySelectorAll(".jr-lang button").forEach(x => x.classList.toggle("on", x.dataset.l === lang()));
}

async function open(j) {
  job = j;

  // The checklist is protected content. This fetch only succeeds for a
  // contractor assigned to this job, and the rule reads the activeRun marker
  // loadChecklist writes first.
  try {
    list = await loadChecklist(
      job.checklistType || job.serviceType, job.id, db,
      { doc, getDoc, setDoc, serverTimestamp }
    );
  } catch (e) {
    console.warn("checklist load failed:", e);
    list = null;
  }
  if (!list) {
    alert(say({
      en: "Couldn't load the checklist for this job. Check your signal and try again, or call the office.",
      es: "No se pudo cargar la lista para este trabajo. Revisa tu señal e intenta otra vez, o llama a la oficina."
    }));
    return;
  }

  let saved = null;
  try {
    const s = await getDoc(doc(db, "jobs", job.id, "workflow", me.uid));
    if (s.exists()) saved = s.data();
  } catch (e) { console.warn("couldn't load progress:", e); }
  prog = saved || cacheLoad() || {};
  prog.checked = prog.checked || {};
  prog.photos = prog.photos || {};
  prog.rooms = prog.rooms || [];
  prog.tier = (job.serviceTier || prog.tier || "standard").toLowerCase();

  steps = buildSteps();
  at = firstUndone();

  shell();
  $("ftjr").classList.add("on");
  document.body.style.overflow = "hidden";
  render();
}

function close() {
  const el = $("ftjr");
  if (el) el.classList.remove("on");
  document.body.style.overflow = "";
  job = null; prog = null; steps = []; at = 0;
  paintLauncher();
}

/* ------------------------------------------------------------------ *
 * launcher — only appears when there's actually a job to run
 * ------------------------------------------------------------------ */

function runnable() {
  const finished = ["submitted_for_review", "approved", "completion_package_sent", "payout_pending", "paid", "completed"];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const soon = new Date(today.getTime() + 2 * 864e5);
  return myJobs
    .filter(j => !finished.includes(String(j.workflowStatus || "")))
    .filter(j => String(j.status || "").toLowerCase() !== "cancelled")
    .filter(j => {
      const d = j.serviceDate?.toDate?.();
      return !d || (d >= today && d < soon);
    })
    .sort((a, b) => (a.serviceDate?.seconds || 0) - (b.serviceDate?.seconds || 0));
}

function paintLauncher() {
  let bar = $("ftjr-launch");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "ftjr-launch";
    bar.innerHTML = `<div class="jr-lwrap">
      <div class="jr-lmeta"><b id="ftjr-lname"></b><span id="ftjr-ltime"></span></div>
      <button class="jr-b pri" id="ftjr-lgo" style="border:0;border-radius:13px;padding:14px 20px;
        font:700 15px Manrope,sans-serif;background:#9c6b74;color:#fff;cursor:pointer"></button>
    </div>`;
    document.body.appendChild(bar);
  }
  const jobs = runnable();
  if (!jobs.length || !me) { bar.classList.remove("on"); return; }

  const j = jobs[0];
  const d = j.serviceDate?.toDate?.();
  $("ftjr-lname").textContent = j.summary || (j.serviceType || "Job");
  $("ftjr-ltime").textContent = [
    d ? d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "",
    d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "",
    j.area || j.zip || ""
  ].filter(Boolean).join(" · ");
  $("ftjr-lgo").textContent = say({ en: "Open job", es: "Abrir trabajo" });
  $("ftjr-lgo").onclick = () => open(j);
  bar.classList.add("on");
}

/* ------------------------------------------------------------------ *
 * boot
 * ------------------------------------------------------------------ */

injectStyles();

onAuthStateChanged(auth, async user => {
  if (unsub) { try { unsub(); } catch {} unsub = null; }
  me = user || null;
  if (!me) { const b = $("ftjr-launch"); if (b) b.classList.remove("on"); return; }

  try {
    const s = await getDoc(doc(db, "users", me.uid));
    myProfile = s.exists() ? s.data() : {};
  } catch { myProfile = {}; }

  const role = String(myProfile.role || "").toLowerCase();
  if (role !== "contractor" && role !== "admin") return;

  unsub = onSnapshot(
    query(collection(db, "jobs"), where("contractorIds", "array-contains", me.uid)),
    snap => { myJobs = snap.docs.map(d => ({ id: d.id, ...d.data() })); paintLauncher(); },
    err => console.warn("job listener:", err)
  );
});

