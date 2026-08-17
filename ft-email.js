// === The Finishing Touch — Email sending admin add-on ===
// Two ways to send from the command center:
//   1. "Birthdays this month" — pick who gets a birthday note, send in one click.
//   2. "Send a special" — write a subject + message, choose an audience, send.
// Nothing is emailed directly from the browser. Every send writes a document to
// the `mail` collection; the Firebase "Trigger Email from Firestore" extension
// picks it up and delivers it from contact.thefinishingtouch.tx@gmail.com.
//
// Self-contained: injects an "Email" tab into admin-dashboard.html.
// Only change to admin-dashboard.html: add before </body>:
// <script type="module" src="ft-email.js"></script>

import { db, auth } from "./ft-firebase.js";
import {
collection, query, orderBy, limit, onSnapshot,
doc, updateDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

// ---------- business details used in every email ----------
const SITE = "https://www.thefinishingtouch-tx.com";
const BIZ_NAME = "The Finishing Touch";
const BIZ_LEGAL = "The Finishing Touch is a DBA of Johnnie and Jane Boutique LLC";
const BIZ_AREA = "Serving Galveston, Harris, and Brazoria County";
// CAN-SPAM requires a real postal address in commercial email. Fill this in.
const BIZ_ADDRESS = "";

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
{ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const firstName = (s) => String(s?.name || "").trim().split(/\s+/)[0] || "there";
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim());
const monthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

// ---------- email shell (branded wrapper every message goes inside) ----------
function unsubUrl(email) { return `${SITE}/unsubscribe.html?e=${encodeURIComponent(String(email || "").trim().toLowerCase())}`; }

function emailShell(innerHtml, toEmail) {
const addr = BIZ_ADDRESS ? `<div>${esc(BIZ_ADDRESS)}</div>` : "";
return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3efe8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe8;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border:1px solid #e8ded2;border-radius:14px;overflow:hidden;">
<tr><td style="padding:26px 30px 6px 30px;text-align:center;">
<div style="font-family:Georgia,'Playfair Display',serif;font-size:25px;color:#2b2622;letter-spacing:.01em;">The Finishing Touch</div>
<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a7d6f;margin-top:6px;">${esc(BIZ_AREA)}</div>
</td></tr>
<tr><td style="padding:14px 30px 26px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15.5px;line-height:1.65;color:#2b2622;">
${innerHtml}
</td></tr>
<tr><td style="padding:18px 30px 24px 30px;border-top:1px solid #eee5da;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.6;color:#8a7d6f;text-align:center;">
<div>${esc(BIZ_NAME)} &middot; <a href="${SITE}" style="color:#8a7d6f;">thefinishingtouch-tx.com</a></div>
<div>${esc(BIZ_LEGAL)}</div>
${addr}
<div style="margin-top:9px;">You're getting this because you asked to hear about specials and updates.<br>
<a href="${unsubUrl(toEmail)}" style="color:#8a7d6f;text-decoration:underline;">Unsubscribe</a></div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// paragraphs + {{name}} token, from a plain textarea
function bodyFromText(text, sub) {
return String(text || "")
.replace(/\{\{\s*name\s*\}\}/gi, firstName(sub))
.split(/\n{2,}/)
.map((p) => `<p style="margin:0 0 14px 0;">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
.join("");
}

function birthdayBody(sub) {
return `<p style="margin:0 0 14px 0;font-family:Georgia,serif;font-size:20px;color:#2b2622;">Happy birthday, ${esc(firstName(sub))}!</p>
<p style="margin:0 0 14px 0;">Everyone here at The Finishing Touch hopes your day is a good one — and that you get to spend it in a home that feels calm, cared for, and completely yours.</p>
<p style="margin:0 0 14px 0;">As a little gift, here's <strong>15% off any service</strong> booked this month. Just mention your birthday when you reach out and we'll take care of the rest.</p>
<p style="margin:0 0 18px 0;"><a href="${SITE}/contact.html" style="display:inline-block;background:#2b2622;color:#fffdf9;text-decoration:none;padding:11px 22px;border-radius:999px;font-size:14px;">Book your birthday treat</a></p>
<p style="margin:0;">Warmly,<br>Richelle &amp; the Finishing Touch team</p>`;
}

// ---------- UI ----------
function injectUI() {
const tabsWrap = document.querySelector(".tabs");
const panelsWrap = document.querySelector(".panels");
if (!tabsWrap || !panelsWrap || document.getElementById("panel-email")) return false;

const style = document.createElement("style");
style.textContent = `.tabbtn[data-tab="email"]::before{content:"\\2709\\FE0F"}
#panel-email .em-card{background:var(--card,#fff);border:1px solid var(--line,#e2e8f0);border-radius:14px;padding:16px 18px;margin-bottom:16px}
#panel-email .em-card h3{margin:0 0 4px 0;font-size:16px}
#panel-email .em-sub{font-size:13px;color:#64748b;margin-bottom:12px}
#panel-email .em-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
#panel-email label.em-lab{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin:10px 0 4px}
#panel-email input.em-in,#panel-email select.em-in,#panel-email textarea.em-in{width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box}
#panel-email textarea.em-in{min-height:150px;resize:vertical;line-height:1.55}
#panel-email .em-list{max-height:260px;overflow:auto;border:1px solid var(--line,#e2e8f0);border-radius:10px}
#panel-email .em-item{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line,#eef2f7);font-size:13.5px}
#panel-email .em-item:last-child{border-bottom:0}
#panel-email .em-item .em-when{margin-left:auto;color:#9d174d;font-weight:700;font-size:12.5px}
#panel-email .em-item.sent .em-when{color:#64748b;font-weight:600}
#panel-email .em-note{font-size:12.5px;color:#64748b;margin-top:8px;min-height:17px}
#panel-email .em-note.err{color:#b91c1c}
#panel-email .em-note.ok{color:#15803d}
#panel-email .em-warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:9px 12px;font-size:12.5px;margin-bottom:12px}
#panel-email table.em-log{width:100%;border-collapse:collapse;font-size:13px}
#panel-email table.em-log th,#panel-email table.em-log td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line,#e2e8f0)}
#panel-email table.em-log th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
#panel-email .em-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#475569}
#panel-email .em-pill.ok{background:#dcfce7;color:#166534}
#panel-email .em-pill.err{background:#fee2e2;color:#991b1b}
#panel-email .em-prev{border:1px solid var(--line,#e2e8f0);border-radius:10px;background:#f3efe8;padding:10px;margin-top:10px}
#panel-email .em-prev iframe{width:100%;height:340px;border:0;border-radius:8px;background:#fff}`;
document.head.appendChild(style);

const tabBtn = document.createElement("button");
tabBtn.className = "tabbtn";
tabBtn.dataset.tab = "email";
tabBtn.textContent = "Email";
tabsWrap.appendChild(tabBtn);

const panel = document.createElement("section");
panel.id = "panel-email";
panel.className = "panel";
panel.innerHTML = `
${BIZ_ADDRESS ? "" : `<div class="em-warn"><strong>Heads up:</strong> marketing email legally needs a real postal address in the footer. Open <code>ft-email.js</code> and fill in <code>BIZ_ADDRESS</code> (a PO box is fine).</div>`}

<div class="em-card">
<h3>Birthdays this month &mdash; ${esc(MONTHS[new Date().getMonth() + 1])}</h3>
<div class="em-sub">Everyone on the feed with a birthday this month. Already-sent people are unticked automatically.</div>
<div class="em-list" id="emBdayList"></div>
<div class="em-row" style="margin-top:12px">
<button class="btn" id="emBdaySend">Send birthday note</button>
<button class="btn btn-outline" id="emBdayPreview">Preview</button>
<button class="btn btn-outline" id="emBdayAll">Select all</button>
<button class="btn btn-outline" id="emBdayNone">Select none</button>
</div>
<div class="em-note" id="emBdayNote"></div>
<div class="em-prev" id="emBdayPrev" style="display:none"><iframe id="emBdayFrame" title="Birthday email preview"></iframe></div>
</div>

<div class="em-card">
<h3>Send a special</h3>
<div class="em-sub">Write it once, send it to the feed. Use <code>{{name}}</code> anywhere and it becomes their first name.</div>
<label class="em-lab" for="emAud">Who gets it</label>
<select class="em-in" id="emAud">
<option value="all">Everyone subscribed</option>
<option value="bday">Only birthdays this month</option>
<option value="me">Just me (test send)</option>
</select>
<label class="em-lab" for="emSubj">Subject</label>
<input class="em-in" id="emSubj" placeholder="A little something for spring cleaning season">
<label class="em-lab" for="emBody">Message</label>
<textarea class="em-in" id="emBody" placeholder="Hi {{name}},

We're opening up a few extra deep-clean slots this month...

Blank lines start a new paragraph."></textarea>
<div class="em-row" style="margin-top:12px">
<button class="btn" id="emSend">Send</button>
<button class="btn btn-outline" id="emPreview">Preview</button>
<span class="em-note" id="emCount" style="margin-top:0"></span>
</div>
<div class="em-note" id="emNote"></div>
<div class="em-prev" id="emPrev" style="display:none"><iframe id="emFrame" title="Email preview"></iframe></div>
</div>

<div class="em-card">
<h3>Recent sends</h3>
<div class="em-sub">Straight from the mail queue. "Delivered" means the email actually went out.</div>
<div id="emLogWrap"></div>
</div>`;
panelsWrap.appendChild(panel);

function show() {
document.querySelectorAll(".tabbtn").forEach((t) => t.classList.toggle("active", t === tabBtn));
document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-email"));
}
tabBtn.addEventListener("click", show);
document.querySelectorAll(".tabbtn").forEach((t) => { if (t !== tabBtn) t.addEventListener("click", () => { tabBtn.classList.remove("active"); panel.classList.remove("active"); }); });

document.getElementById("emBdaySend").addEventListener("click", sendBirthdays);
document.getElementById("emBdayPreview").addEventListener("click", previewBirthday);
document.getElementById("emBdayAll").addEventListener("click", () => toggleAll(true));
document.getElementById("emBdayNone").addEventListener("click", () => toggleAll(false));
document.getElementById("emSend").addEventListener("click", sendSpecial);
document.getElementById("emPreview").addEventListener("click", previewSpecial);
document.getElementById("emAud").addEventListener("change", updateCount);
return true;
}

// ---------- data ----------
let subs = [];

const subscribed = () => subs.filter((s) => s.subscribed !== false && validEmail(s.email));
const birthdayList = () => subscribed().filter((s) => Number(s.birthMonth) === new Date().getMonth() + 1)
.sort((a, b) => (Number(a.birthDay) || 99) - (Number(b.birthDay) || 99));

function drawBirthdays() {
const wrap = document.getElementById("emBdayList");
if (!wrap) return;
const list = birthdayList();
const mk = monthKey();
wrap.innerHTML = list.length ? list.map((s) => {
const already = s.lastBirthdayEmail === mk;
return `<label class="em-item ${already ? "sent" : ""}">
<input type="checkbox" data-id="${esc(s.id)}" ${already ? "" : "checked"}>
<span><strong>${esc(s.name) || esc(s.email)}</strong><br><span style="color:#64748b;font-size:12.5px">${esc(s.email)}</span></span>
<span class="em-when">${already ? "sent this month" : `${esc(MONTHS[Number(s.birthMonth)])} ${esc(s.birthDay || "")}`}</span>
</label>`;
}).join("") : `<div class="em-item" style="color:#64748b">No birthdays on the feed this month.</div>`;
updateCount();
}

function toggleAll(on) {
document.querySelectorAll("#emBdayList input[type=checkbox]").forEach((c) => { c.checked = on; });
}

function checkedBirthdays() {
const ids = [...document.querySelectorAll("#emBdayList input[type=checkbox]:checked")].map((c) => c.dataset.id);
return birthdayList().filter((s) => ids.includes(s.id));
}

function audienceList() {
const a = document.getElementById("emAud")?.value;
if (a === "bday") return birthdayList();
if (a === "me") {
const e = auth.currentUser?.email;
return validEmail(e) ? [{ id: "__me", email: e, name: "Test" }] : [];
}
return subscribed();
}

function updateCount() {
const el = document.getElementById("emCount");
if (el) { const n = audienceList().length; el.textContent = n === 1 ? "1 recipient" : `${n} recipients`; }
}

// ---------- sending ----------
function note(id, msg, kind) {
const el = document.getElementById(id);
if (!el) return;
el.textContent = msg;
el.className = `em-note${kind ? " " + kind : ""}`;
}

async function queue(recipients, subjectFor, htmlFor, campaign) {
// chunked so we stay well inside Firestore's 500-write batch limit
const seen = new Set();
const clean = recipients.filter((s) => {
const e = String(s.email || "").trim().toLowerCase();
if (!validEmail(e) || seen.has(e)) return false;
seen.add(e);
return true;
});
let sent = 0;
for (let i = 0; i < clean.length; i += 200) {
const batch = writeBatch(db);
clean.slice(i, i + 200).forEach((s) => {
batch.set(doc(collection(db, "mail")), {
to: String(s.email).trim().toLowerCase(),
message: { subject: subjectFor(s), html: htmlFor(s) },
_ftCampaign: campaign,
_ftName: s.name || "",
_ftCreatedAt: serverTimestamp()
});
});
await batch.commit();
sent += Math.min(200, clean.length - i);
}
return sent;
}

async function sendBirthdays() {
const list = checkedBirthdays();
if (!list.length) return note("emBdayNote", "Tick at least one person first.", "err");
if (!confirm(`Send the birthday note to ${list.length} ${list.length === 1 ? "person" : "people"}?`)) return;
const btn = document.getElementById("emBdaySend");
btn.disabled = true;
note("emBdayNote", "Queueing…");
try {
const n = await queue(list, () => `Happy birthday from The Finishing Touch 🎂`, (s) => emailShell(birthdayBody(s), s.email), "birthday");
note("emBdayNote", `Queued ${n} ${n === 1 ? "email" : "emails"}. They'll go out within a minute.`, "ok");
const mk = monthKey();
await Promise.all(list.map((s) => updateDoc(doc(db, "subscribers", s.id), { lastBirthdayEmail: mk }).catch(() => {})));
} catch (err) {
console.warn("Birthday send error:", err);
note("emBdayNote", "Couldn't queue those (check the Firestore rule for the mail collection).", "err");
}
btn.disabled = false;
}

async function sendSpecial() {
const subject = document.getElementById("emSubj").value.trim();
const body = document.getElementById("emBody").value.trim();
const list = audienceList();
if (!subject) return note("emNote", "Give it a subject line first.", "err");
if (!body) return note("emNote", "Write a message first.", "err");
if (!list.length) return note("emNote", "Nobody in that audience yet.", "err");
if (!confirm(`Send "${subject}" to ${list.length} ${list.length === 1 ? "person" : "people"}?`)) return;
const btn = document.getElementById("emSend");
btn.disabled = true;
note("emNote", "Queueing…");
try {
const n = await queue(list, () => subject, (s) => emailShell(bodyFromText(body, s), s.email), "special");
note("emNote", `Queued ${n} ${n === 1 ? "email" : "emails"}. They'll go out within a minute.`, "ok");
} catch (err) {
console.warn("Special send error:", err);
note("emNote", "Couldn't queue those (check the Firestore rule for the mail collection).", "err");
}
btn.disabled = false;
}

// ---------- previews ----------
function paint(frameId, wrapId, html) {
const wrap = document.getElementById(wrapId);
const frame = document.getElementById(frameId);
if (!wrap || !frame) return;
wrap.style.display = wrap.style.display === "none" ? "block" : "block";
frame.srcdoc = html;
}

function previewBirthday() {
const s = checkedBirthdays()[0] || birthdayList()[0] || { name: "Sample Client", email: "someone@example.com" };
paint("emBdayFrame", "emBdayPrev", emailShell(birthdayBody(s), s.email));
}

function previewSpecial() {
const body = document.getElementById("emBody").value.trim();
if (!body) return note("emNote", "Write a message first, then preview.", "err");
const s = audienceList()[0] || { name: "Sample Client", email: "someone@example.com" };
note("emNote", "");
paint("emFrame", "emPrev", emailShell(bodyFromText(body, s), s.email));
}

// ---------- recent sends log ----------
function drawLog(rows) {
const wrap = document.getElementById("emLogWrap");
if (!wrap) return;
if (!rows.length) { wrap.innerHTML = `<div class="em-sub" style="margin:0">Nothing sent yet.</div>`; return; }
wrap.innerHTML = `<table class="em-log">
<thead><tr><th>To</th><th>Subject</th><th>Status</th></tr></thead>
<tbody>${rows.map((r) => {
const st = r.delivery?.state || "queued";
const cls = st === "SUCCESS" ? "ok" : (st === "ERROR" ? "err" : "");
const label = st === "SUCCESS" ? "Delivered" : (st === "ERROR" ? "Failed" : (st === "PROCESSING" ? "Sending" : "Queued"));
return `<tr><td>${esc(r.to)}</td><td>${esc(r.message?.subject)}</td><td><span class="em-pill ${cls}">${label}</span></td></tr>`;
}).join("")}</tbody></table>`;
}

// ---------- boot ----------
function boot() {
onAuthStateChanged(auth, (user) => {
if (!user) return;
if (!injectUI()) return;

onSnapshot(
query(collection(db, "subscribers"), orderBy("updatedAt", "desc"), limit(2000)),
(snap) => { subs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); drawBirthdays(); },
(err) => { console.warn("Email/subscribers listener error:", err); note("emBdayNote", "Couldn't load the feed (Firestore rule).", "err"); }
);

onSnapshot(
query(collection(db, "mail"), orderBy("_ftCreatedAt", "desc"), limit(25)),
(snap) => drawLog(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
(err) => { console.warn("Mail log listener error:", err); const w = document.getElementById("emLogWrap"); if (w) w.innerHTML = `<div class="em-sub" style="margin:0">Send log unavailable (Firestore rule).</div>`; }
);
});
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
