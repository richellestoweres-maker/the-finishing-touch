// /ft-briefing.js
// The "Today" tab on the admin dashboard.
//
// Shows the latest morning briefing Ivy wrote (Firestore settings/briefing),
// live, so it updates the moment Ivy finishes a new one. The Refresh button
// asks Ivy to build a fresh one right now.

import { db, auth } from "./ft-firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

const IVY_URL = "https://ivy-591177706994.us-central1.run.app";
const root = document.getElementById("briefingRoot");

const css = `
#briefingRoot{display:flex;flex-direction:column;gap:16px;max-width:860px;text-align:left}
#briefingRoot .card,#briefingRoot h3,#briefingRoot ol,#briefingRoot ul,#briefingRoot li,#briefingRoot div{text-align:left}
#briefingRoot .bf-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
#briefingRoot .bf-date{font-size:.85rem;color:var(--portal-muted);letter-spacing:.04em;text-transform:uppercase}
#briefingRoot .bf-headline{font-family:"Playfair Display",serif;font-size:1.55rem;line-height:1.25;color:var(--portal-ink);margin:4px 0 0}
#briefingRoot .bf-meta{font-size:.82rem;color:var(--portal-muted);margin-top:6px}
#briefingRoot h3{font-family:"Playfair Display",serif;font-size:1.12rem;margin:0;color:var(--portal-ink);padding-left:4px}
#briefingRoot ol,#briefingRoot ul{margin:0;padding-left:26px;display:flex;flex-direction:column;gap:10px}
#briefingRoot li{line-height:1.45;color:var(--portal-ink)}
#briefingRoot .bf-title{font-weight:600}
#briefingRoot .bf-why{color:var(--portal-muted);font-size:.93rem}
#briefingRoot .bf-where{display:inline-block;margin-top:3px;font-size:.78rem;padding:2px 9px;border-radius:999px;background:var(--portal-blush-soft);border:1px solid var(--portal-line);color:var(--portal-ink)}
#briefingRoot .bf-sched{display:grid;grid-template-columns:90px 1fr;gap:6px 14px;padding-left:4px}
#briefingRoot .bf-time{font-weight:600;color:var(--portal-ink)}
#briefingRoot .bf-src{display:flex;flex-wrap:wrap;gap:8px;padding-left:4px}
#briefingRoot .bf-chip{font-size:.8rem;padding:4px 10px;border-radius:999px;border:1px solid var(--portal-line);background:#fffdfb}
#briefingRoot .bf-chip.ok::before{content:"● ";color:#5d8a5f}
#briefingRoot .bf-chip.no::before{content:"○ ";color:#a08a7c}
#briefingRoot .bf-empty{color:var(--portal-muted);padding-left:4px}
#briefingRoot .bf-status{font-size:.85rem;color:var(--portal-muted);min-height:1.2em}
@media (max-width:640px){#briefingRoot .bf-headline{font-size:1.3rem}#briefingRoot .bf-sched{grid-template-columns:72px 1fr}}
`;
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function when(ts) {
  const ms = ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : 0);
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
}

function section(title, inner) {
  return `<div class="card"><h3>${esc(title)}</h3>${inner}</div>`;
}

function render(b) {
  if (!b) {
    root.innerHTML = `
      <div class="card">
        <div class="bf-head"><div><div class="bf-headline">No briefing yet</div>
        <div class="bf-meta">Press Refresh and Ivy will check everything now.</div></div>
        <button class="btn btn-solid" id="bfRefresh" type="button">Refresh</button></div>
        <div class="bf-status" id="bfStatus"></div>
      </div>`;
    wire();
    return;
  }

  const top = (b.top || []).length
    ? `<ol>${b.top.map((t) => `<li><div class="bf-title">${esc(t.title)}</div>
        <div class="bf-why">${esc(t.why)}</div>${t.where ? `<span class="bf-where">${esc(t.where)}</span>` : ""}</li>`).join("")}</ol>`
    : `<div class="bf-empty">Nothing needs you right now.</div>`;

  const sched = (b.schedule || []).length
    ? `<div class="bf-sched">${b.schedule.map((s) => `<div class="bf-time">${esc(s.time)}</div><div>${esc(s.what)}</div>`).join("")}</div>`
    : `<div class="bf-empty">Nothing on the schedule today.</div>`;

  const list = (items) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

  root.innerHTML = `
    <div class="card">
      <div class="bf-head">
        <div>
          <div class="bf-date">${esc(b.dateLabel || "")}</div>
          <div class="bf-headline">${esc(b.headline || "")}</div>
          <div class="bf-meta">Written by Ivy ${esc(when(b.generatedAt))}</div>
        </div>
        <button class="btn btn-solid" id="bfRefresh" type="button">Refresh</button>
      </div>
      <div class="bf-status" id="bfStatus"></div>
    </div>
    ${section("Needs you today", top)}
    ${section("Today's schedule", sched)}
    ${(b.waiting_on_others || []).length ? section("Waiting on someone else", list(b.waiting_on_others)) : ""}
    ${(b.fyi || []).length ? section("Good to know", list(b.fyi)) : ""}
    ${section("What Ivy checked", `<div class="bf-src">${(b.sources || []).map((s) =>
      `<span class="bf-chip ${s.ok ? "ok" : "no"}" title="${esc(s.detail)}">${esc(s.name)}${s.ok ? "" : ": " + esc(s.detail)}</span>`
    ).join("")}</div>`)}
  `;
  wire();
}

function wire() {
  const btn = document.getElementById("bfRefresh");
  const status = document.getElementById("bfStatus");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) { status.textContent = "Sign in first."; return; }
    btn.disabled = true;
    status.textContent = "Ivy is checking everything. This takes about a minute.";
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${IVY_URL}/briefing/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Ivy said ${res.status}`);
      // The new briefing arrives through the live listener below.
      status.textContent = "";
    } catch (err) {
      status.textContent = `That didn't work: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

if (root) {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    onSnapshot(
      doc(db, "settings", "briefing"),
      (snap) => render(snap.exists() ? snap.data() : null),
      (err) => {
        root.innerHTML = `<div class="card"><div class="bf-empty">Couldn't load the briefing: ${esc(err.message)}</div></div>`;
      }
    );
  });
}
