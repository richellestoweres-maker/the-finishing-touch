// === The Finishing Touch — Subscribers ("the feed") admin add-on ===
// Shows the marketing list captured from intake opt-ins: everyone who agreed to
// hear about specials, updates, and birthdays. Search, see this month's birthdays,
// export to a spreadsheet, and unsubscribe people. Sending emails comes later.
//
// Self-contained: injects a "Subscribers" tab into admin-dashboard.html.
// Only change to admin-dashboard.html: add before </body>:
//   <script type="module" src="ft-subscribers.js"></script>

import { db, auth } from "./ft-firebase.js";
import {
  collection, query, orderBy, limit, onSnapshot,
  doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const bdayText = (s) => (s.birthMonth ? `${MONTHS[Number(s.birthMonth)] || s.birthMonth} ${s.birthDay || ""}`.trim() : "");

function injectUI() {
  const tabsWrap = document.querySelector(".tabs");
  const panelsWrap = document.querySelector(".panels");
  if (!tabsWrap || !panelsWrap || document.getElementById("panel-subs")) return false;

  const style = document.createElement("style");
  style.textContent = `.tabbtn[data-tab="subs"]::before{content:"📣"}
    #panel-subs .subs-top{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    #panel-subs .subs-stat{background:var(--card,#fff);border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:10px 16px}
    #panel-subs .subs-stat b{font-size:20px;display:block}
    #panel-subs .subs-stat span{font-size:12px;color:#64748b}
    #panel-subs input.subs-search{flex:1;min-width:180px;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px}
    #panel-subs table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:6px}
    #panel-subs th,#panel-subs td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line,#e2e8f0);vertical-align:top}
    #panel-subs th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
    #panel-subs tr.unsub td{opacity:.5}
    #panel-subs .bday-hot{color:#9d174d;font-weight:700}
    #panel-subs .subs-btn{cursor:pointer;font-size:12px;font-weight:700;padding:5px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#fff}
    #panel-subs .subs-count{color:#64748b;font-size:13px;margin-bottom:10px}`;
  document.head.appendChild(style);

  const tabBtn = document.createElement("button");
  tabBtn.className = "tabbtn";
  tabBtn.dataset.tab = "subs";
  tabBtn.textContent = "Subscribers";
  tabsWrap.appendChild(tabBtn);

  const panel = document.createElement("section");
  panel.id = "panel-subs";
  panel.className = "panel";
  panel.innerHTML = `
    <div class="subs-top">
      <div class="subs-stat"><b id="subsTotal">0</b><span>On the feed</span></div>
      <div class="subs-stat"><b id="subsBdays">0</b><span>Birthdays this month</span></div>
      <input class="subs-search" id="subsSearch" placeholder="Search name, email, phone…">
      <button class="btn btn-outline" id="subsExport">⭳ Export CSV</button>
    </div>
    <div class="subs-count" id="subsCount"></div>
    <div id="subsTableWrap"></div>`;
  panelsWrap.appendChild(panel);

  function show() {
    document.querySelectorAll(".tabbtn").forEach((t) => t.classList.toggle("active", t === tabBtn));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-subs"));
  }
  tabBtn.addEventListener("click", show);
  document.querySelectorAll(".tabbtn").forEach((t) => { if (t !== tabBtn) t.addEventListener("click", () => { tabBtn.classList.remove("active"); panel.classList.remove("active"); }); });

  document.getElementById("subsSearch").addEventListener("input", draw);
  document.getElementById("subsExport").addEventListener("click", exportCsv);
  return true;
}

let subs = [];

function filtered() {
  const q = (document.getElementById("subsSearch")?.value || "").toLowerCase().trim();
  let list = subs.slice();
  if (q) list = list.filter((s) => `${s.name || ""} ${s.email || ""} ${s.phone || ""}`.toLowerCase().includes(q));
  return list;
}

function draw() {
  const wrap = document.getElementById("subsTableWrap");
  if (!wrap) return;
  const thisMonth = new Date().getMonth() + 1;
  const activeAll = subs.filter((s) => s.subscribed !== false);
  document.getElementById("subsTotal").textContent = activeAll.length;
  document.getElementById("subsBdays").textContent = activeAll.filter((s) => Number(s.birthMonth) === thisMonth).length;

  const list = filtered();
  document.getElementById("subsCount").textContent = list.length
    ? `${list.length} shown${list.length !== subs.length ? ` of ${subs.length}` : ""}`
    : "No subscribers yet. They'll appear here as people opt in on your intake forms.";

  wrap.innerHTML = list.length ? `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Birthday</th><th>Source</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${list.map((s) => {
          const hot = Number(s.birthMonth) === thisMonth;
          const unsub = s.subscribed === false;
          return `<tr class="${unsub ? "unsub" : ""}" data-id="${esc(s.id)}">
            <td>${esc(s.name) || "—"}</td>
            <td>${esc(s.email)}</td>
            <td>${esc(s.phone) || "—"}</td>
            <td class="${hot ? "bday-hot" : ""}">${esc(bdayText(s)) || "—"}${hot ? " 🎂" : ""}</td>
            <td>${esc(s.source) || "—"}</td>
            <td>${unsub ? "Unsubscribed" : "Subscribed"}</td>
            <td><button class="subs-btn" data-act="toggle">${unsub ? "Resubscribe" : "Unsubscribe"}</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>` : "";
  hook(wrap);
}

function hook(wrap) {
  wrap.querySelectorAll("[data-act='toggle']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.closest("tr")?.dataset.id;
      const s = subs.find((x) => x.id === id);
      if (!s) return;
      const next = s.subscribed === false; // resubscribe if currently off
      try {
        await updateDoc(doc(db, "subscribers", id), { subscribed: next, updatedAt: serverTimestamp() });
      } catch (err) { console.warn("Subscriber toggle error:", err); alert("Couldn't update that (permission rule)."); }
    });
  });
}

function exportCsv() {
  const list = filtered();
  const rows = [["Name", "Email", "Phone", "BirthdayMonth", "BirthdayDay", "Source", "Subscribed"]];
  list.forEach((s) => rows.push([s.name || "", s.email || "", s.phone || "", s.birthMonth || "", s.birthDay || "", s.source || "", s.subscribed === false ? "no" : "yes"]));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "the-finishing-touch-subscribers.csv";
  document.body.appendChild(a); a.click(); a.remove();
}

function boot() {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    if (!injectUI()) return;
    onSnapshot(
      query(collection(db, "subscribers"), orderBy("updatedAt", "desc"), limit(2000)),
      (snap) => { subs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); draw(); },
      (err) => {
        console.warn("Subscribers listener error:", err);
        const c = document.getElementById("subsCount");
        if (c) c.textContent = "Couldn't load subscribers (Firestore rule). Tell Claude and it's a quick fix.";
      }
    );
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
