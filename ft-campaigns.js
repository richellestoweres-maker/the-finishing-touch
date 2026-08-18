// === The Finishing Touch — Automations admin add-on ===
// Set-and-forget email. Two things live here:
//   1. Birthday notes — sent automatically on the morning of someone's birthday.
//   2. Holiday campaigns — dated drafts that go out on their own each year.
// Nothing sends from this page. The daily Cloud Function (ftDailySend) wakes up
// at 8:00 AM Central, works out what's due, and writes to the `mail` collection.
// This tab is where you write the copy and decide what's turned on.
//
// Self-contained: injects an "Automations" tab into admin-dashboard.html.
// Only change to admin-dashboard.html: add before </body>:
// <script type="module" src="ft-campaigns.js"></script>

import { db, auth } from "./ft-firebase.js";
import {
collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
onSnapshot, query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
CONTACT, MONTHS, WEEKDAYS, esc, validEmail, renderMessage, DEFAULT_BIRTHDAY,
campaignDate, prettyDate, scheduleText, BIZ_ADDRESS
} from "./ft-email-template.js";

// The eleven drafts. Send dates have lead time built in — people book ahead.
const HOLIDAY_DRAFTS = [
{
name: "New Year — clean slate",
scheduleType: "fixed", month: 1, day: 2, offsetDays: 0,
subject: "A clean slate for the new year",
headline: "Start the year in a home that feels new",
body: `Hi {{name}},

There's something about the first week of January. The decorations come down, the house feels a little bare, and suddenly you notice everything you stopped seeing in December.

That's the best possible time for a deep clean. Baseboards, inside the cabinets, the corners that got skipped while you were hosting — all of it reset before the year really gets going.

We're booking January now, and the first two weeks go quickly.`,
ctaLabel: "Book a fresh-start clean", ctaHref: CONTACT
},
{
name: "Valentine's Day",
scheduleType: "fixed", month: 2, day: 7, offsetDays: 0,
subject: "Hosting someone special this Valentine's?",
headline: "You handle the dinner. We'll handle the house.",
body: `Hi {{name}},

If Valentine's Day at your place means cooking something nice and actually sitting down to enjoy it, the last thing you want to be doing that afternoon is scrubbing the kitchen.

A clean before, or a clean after — either one buys back the evening.

We have a few slots left the week of the 14th.`,
ctaLabel: "Reserve a slot", ctaHref: CONTACT
},
{
name: "Spring cleaning kickoff",
scheduleType: "fixed", month: 3, day: 1, offsetDays: 0,
subject: "Spring cleaning season is open",
headline: "The windows are open again",
body: `Hi {{name}},

March in the Houston area means the windows finally go up — and the light shows you every bit of winter still sitting in the house.

Our spring deep clean goes past the weekly routine: inside the windows, under and behind the furniture, ceiling fans, vents, baseboards, the tops of everything nobody looks at.

It's our busiest season, so the good weekend slots go first.`,
ctaLabel: "Book a spring deep clean", ctaHref: CONTACT
},
{
name: "Easter",
scheduleType: "easter", month: 0, day: 0, offsetDays: -14,
subject: "Getting the house ready for Easter",
headline: "Before everyone comes over",
body: `Hi {{name}},

Easter has a way of turning into a full house — family, a table that needs two leaves, kids in and out of the back door all afternoon.

A clean the week before means you get to actually enjoy the day instead of staying two steps ahead of it. And if you'd like the table and entry styled for spring, we do that too.

Two weeks out is the right time to get on the calendar.`,
ctaLabel: "Get on the Easter calendar", ctaHref: CONTACT
},
{
name: "Mother's Day",
scheduleType: "nth", month: 5, weekday: 0, nth: 2, offsetDays: -10,
subject: "A gift that actually helps",
headline: "Give her the afternoon back",
body: `Hi {{name}},

Flowers are lovely for about four days. A clean house is lovely for a month.

If you're shopping for your mom, your wife, or honestly yourself — a deep clean is the rare Mother's Day gift that removes work instead of adding a vase to wash.

We can schedule it for the week before, the day itself, or any time she'd rather have it.`,
ctaLabel: "Arrange a Mother's Day clean", ctaHref: CONTACT
},
{
name: "Fourth of July",
scheduleType: "fixed", month: 6, day: 25, offsetDays: 0,
subject: "Before the Fourth of July crowd arrives",
headline: "Cookout season is upon us",
body: `Hi {{name}},

If your house is where everyone ends up on the Fourth, you already know the drill: the inside gets as much traffic as the backyard, and the kitchen never really recovers.

Book a clean for the day before and the day after, and the whole thing gets a lot more fun.

We're filling the week of the Fourth now.`,
ctaLabel: "Book before the Fourth", ctaHref: CONTACT
},
{
name: "Back to school",
scheduleType: "fixed", month: 8, day: 1, offsetDays: 0,
subject: "Reset the house before school starts",
headline: "A calmer house for a busier season",
body: `Hi {{name}},

Once school starts, the mornings belong to somebody else. Whatever state the house is in going into August, that's roughly where it stays until October.

A reset now — playroom sorted, closets gone through, the whole place deep cleaned — makes the first month of the school year noticeably easier.

August fills up fast around here.`,
ctaLabel: "Book a back-to-school reset", ctaHref: CONTACT
},
{
name: "Halloween & fall décor",
scheduleType: "fixed", month: 10, day: 10, offsetDays: 0,
subject: "Fall décor, handled",
headline: "Pumpkins on the porch, without the trip to the attic",
body: `Hi {{name}},

Fall décor is the fun kind of work — right up until you're standing in the attic looking for the box with the good garland in it.

We style porches, entries, and mantels for the season: pumpkins, wreaths, the whole front-of-house. You come home and it's done.

Booking now for the second half of October.`,
ctaLabel: "Book fall styling", ctaHref: CONTACT
},
{
name: "Thanksgiving",
scheduleType: "nth", month: 11, weekday: 4, nth: 4, offsetDays: -14,
subject: "Two weeks until Thanksgiving",
headline: "The guest room, the good dishes, all of it",
body: `Hi {{name}},

Thanksgiving is two weeks out. If people are staying over, this is the week to think about the guest room and the bathroom nobody has used since last November.

We do the whole pre-holiday pass — guest spaces made up, kitchen deep cleaned before the cooking starts, table styled if you'd like it.

And we save a few post-Thanksgiving slots, which are honestly the most popular ones we offer.`,
ctaLabel: "Book before Thanksgiving", ctaHref: CONTACT
},
{
name: "Christmas décor booking",
scheduleType: "fixed", month: 11, day: 1, offsetDays: 0,
subject: "Holiday décor books up fast",
headline: "Let's get your install on the calendar",
body: `Hi {{name}},

Holiday décor is the one service where waiting genuinely costs you — the good install weekends in late November and early December go first, every single year.

Trees, mantels, entries, garland, the whole house if you want it. We bring it, we style it, and we come take it down in January so you never think about storage.

Tell us roughly what you're picturing and we'll hold a date.`,
ctaLabel: "Hold a décor date", ctaHref: CONTACT
},
{
name: "Christmas",
scheduleType: "fixed", month: 12, day: 12, offsetDays: 0,
subject: "One less thing before Christmas",
headline: "Merry Christmas from all of us",
body: `Hi {{name}},

The last two weeks of December are wonderful and completely full. If a clean house before the family arrives would help, we still have a little room.

And if not — thank you for letting us into your home this year. It genuinely means something to us.

Merry Christmas from Richelle and the whole Finishing Touch team.`,
ctaLabel: "See what's still open", ctaHref: CONTACT
}
];

// ---------- UI ----------
let campaigns = [];
let birthday = { ...DEFAULT_BIRTHDAY };
let lastRunAt = null;
let editingId = null;

function injectUI() {
const tabsWrap = document.querySelector(".tabs");
const panelsWrap = document.querySelector(".panels");
if (!tabsWrap || !panelsWrap || document.getElementById("panel-autos")) return false;

const style = document.createElement("style");
style.textContent = `.tabbtn[data-tab="autos"]::before{content:"\\23F0"}
#panel-autos .au-card{background:var(--card,#fff);border:1px solid var(--line,#e2e8f0);border-radius:14px;padding:16px 18px;margin-bottom:16px}
#panel-autos .au-card h3{margin:0 0 4px 0;font-size:16px}
#panel-autos .au-sub{font-size:13px;color:#64748b;margin-bottom:12px}
#panel-autos .au-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
#panel-autos label.au-lab{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin:10px 0 4px}
#panel-autos input.au-in,#panel-autos select.au-in,#panel-autos textarea.au-in{width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box}
#panel-autos textarea.au-in{min-height:150px;resize:vertical;line-height:1.55}
#panel-autos .au-inline{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
#panel-autos .au-inline > div{flex:1;min-width:110px}
#panel-autos table.au-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
#panel-autos table.au-tbl th,#panel-autos table.au-tbl td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line,#e2e8f0);vertical-align:middle}
#panel-autos table.au-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
#panel-autos tr.off td{opacity:.5}
#panel-autos .au-when{color:#64748b;font-size:12.5px}
#panel-autos .au-next{font-weight:700}
#panel-autos .au-btn{cursor:pointer;font-size:12px;font-weight:700;padding:5px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;margin-right:4px}
#panel-autos .au-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#475569}
#panel-autos .au-pill.on{background:#dcfce7;color:#166534}
#panel-autos .au-pill.done{background:#e0e7ff;color:#3730a3}
#panel-autos .au-note{font-size:12.5px;color:#64748b;margin-top:8px;min-height:17px}
#panel-autos .au-note.err{color:#b91c1c}
#panel-autos .au-note.ok{color:#15803d}
#panel-autos .au-warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:9px 12px;font-size:12.5px;margin-bottom:12px}
#panel-autos .au-ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:10px;padding:9px 12px;font-size:12.5px;margin-bottom:12px}
#panel-autos .au-prev{border:1px solid var(--line,#e2e8f0);border-radius:10px;background:#f3efe8;padding:10px;margin-top:10px}
#panel-autos .au-prev iframe{width:100%;height:360px;border:0;border-radius:8px;background:#fff}
#panel-autos .au-switch{display:flex;gap:8px;align-items:center;font-size:14px}`;
document.head.appendChild(style);

const tabBtn = document.createElement("button");
tabBtn.className = "tabbtn";
tabBtn.dataset.tab = "autos";
tabBtn.textContent = "Automations";
tabsWrap.appendChild(tabBtn);

const panel = document.createElement("section");
panel.id = "panel-autos";
panel.className = "panel";
panel.innerHTML = `
<div id="auHealth"></div>

<div class="au-card">
<h3>Birthday notes</h3>
<div class="au-sub">Sent automatically at 8:00 AM Central on the morning of each subscriber's birthday. Everyone gets it once a year.</div>
<div class="au-switch"><input type="checkbox" id="auBdayOn"> <label for="auBdayOn">Send birthday notes automatically</label></div>
<label class="au-lab" for="auBdaySubj">Subject</label>
<input class="au-in" id="auBdaySubj">
<label class="au-lab" for="auBdayHead">Opening line</label>
<input class="au-in" id="auBdayHead">
<label class="au-lab" for="auBdayBody">Message</label>
<textarea class="au-in" id="auBdayBody"></textarea>
<div class="au-inline">
<div><label class="au-lab" for="auBdayCta">Button label</label><input class="au-in" id="auBdayCta"></div>
<div><label class="au-lab" for="auBdayHref">Button link</label><input class="au-in" id="auBdayHref"></div>
</div>
<div class="au-row" style="margin-top:12px">
<button class="btn" id="auBdaySave">Save</button>
<button class="btn btn-outline" id="auBdayPrev">Preview</button>
<button class="btn btn-outline" id="auBdayTest">Send test to me</button>
</div>
<div class="au-note" id="auBdayNote"></div>
<div class="au-prev" id="auBdayPrevWrap" style="display:none"><iframe id="auBdayFrame" title="Birthday preview"></iframe></div>
</div>

<div class="au-card">
<h3>Holiday campaigns</h3>
<div class="au-sub">Each one goes out on its own date every year, to everyone subscribed. Turn any of them off and it simply skips.</div>
<div id="auList"></div>
<div class="au-row" style="margin-top:12px">
<button class="btn" id="auNew">+ New campaign</button>
<button class="btn btn-outline" id="auSeed">Load the 11 holiday drafts</button>
</div>
<div class="au-note" id="auListNote"></div>
</div>

<div class="au-card" id="auEditor" style="display:none">
<h3 id="auEditTitle">Edit campaign</h3>
<div class="au-sub" id="auEditWhen"></div>
<label class="au-lab" for="auName">Name (just for you — not in the email)</label>
<input class="au-in" id="auName">
<label class="au-lab" for="auSubj">Subject</label>
<input class="au-in" id="auSubj">
<label class="au-lab" for="auHead">Opening line</label>
<input class="au-in" id="auHead">
<label class="au-lab" for="auBody">Message — use {{name}} for their first name</label>
<textarea class="au-in" id="auBody"></textarea>
<div class="au-inline">
<div><label class="au-lab" for="auCta">Button label</label><input class="au-in" id="auCta"></div>
<div><label class="au-lab" for="auHref">Button link</label><input class="au-in" id="auHref"></div>
</div>
<label class="au-lab">When it sends</label>
<div class="au-inline">
<div>
<select class="au-in" id="auType">
<option value="fixed">A fixed date</option>
<option value="nth">A weekday of a month</option>
<option value="easter">Relative to Easter</option>
</select>
</div>
<div id="auFixedWrap">
<div class="au-inline">
<div><select class="au-in" id="auMonth"></select></div>
<div><input class="au-in" id="auDay" type="number" min="1" max="31" placeholder="Day"></div>
</div>
</div>
<div id="auNthWrap" style="display:none">
<div class="au-inline">
<div><select class="au-in" id="auNth"></select></div>
<div><select class="au-in" id="auWeekday"></select></div>
<div><select class="au-in" id="auNthMonth"></select></div>
</div>
</div>
<div><input class="au-in" id="auOffset" type="number" placeholder="Days early/late"></div>
</div>
<div class="au-sub" style="margin-top:6px">Use a negative number to send ahead of the date — <code>-14</code> means two weeks before.</div>
<div class="au-switch" style="margin-top:10px"><input type="checkbox" id="auOn"> <label for="auOn">Turned on</label></div>
<div class="au-row" style="margin-top:12px">
<button class="btn" id="auSave">Save campaign</button>
<button class="btn btn-outline" id="auPrev">Preview</button>
<button class="btn btn-outline" id="auTest">Send test to me</button>
<button class="btn btn-outline" id="auCancel">Close</button>
<button class="au-btn" id="auDelete" style="margin-left:auto;color:#b91c1c">Delete</button>
</div>
<div class="au-note" id="auEditNote"></div>
<div class="au-prev" id="auPrevWrap" style="display:none"><iframe id="auFrame" title="Campaign preview"></iframe></div>
</div>`;
panelsWrap.appendChild(panel);

// month / weekday / nth pickers
const monthOpts = MONTHS.map((m, i) => i ? `<option value="${i}">${m}</option>` : "").join("");
document.getElementById("auMonth").innerHTML = monthOpts;
document.getElementById("auNthMonth").innerHTML = monthOpts;
document.getElementById("auWeekday").innerHTML = WEEKDAYS.map((w, i) => `<option value="${i}">${w}</option>`).join("");
document.getElementById("auNth").innerHTML = ["1st", "2nd", "3rd", "4th", "5th"].map((o, i) => `<option value="${i + 1}">${o}</option>`).join("");

function show() {
document.querySelectorAll(".tabbtn").forEach((t) => t.classList.toggle("active", t === tabBtn));
document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-autos"));
}
tabBtn.addEventListener("click", show);
document.querySelectorAll(".tabbtn").forEach((t) => { if (t !== tabBtn) t.addEventListener("click", () => { tabBtn.classList.remove("active"); panel.classList.remove("active"); }); });

document.getElementById("auBdaySave").addEventListener("click", saveBirthday);
document.getElementById("auBdayPrev").addEventListener("click", previewBirthday);
document.getElementById("auBdayTest").addEventListener("click", () => testSend(readBirthday(), "auBdayNote"));
document.getElementById("auNew").addEventListener("click", () => openEditor(null));
document.getElementById("auSeed").addEventListener("click", seedDrafts);
document.getElementById("auSave").addEventListener("click", saveCampaign);
document.getElementById("auPrev").addEventListener("click", previewCampaign);
document.getElementById("auTest").addEventListener("click", () => testSend(readEditor(), "auEditNote"));
document.getElementById("auCancel").addEventListener("click", () => { document.getElementById("auEditor").style.display = "none"; editingId = null; });
document.getElementById("auDelete").addEventListener("click", deleteCampaign);
document.getElementById("auType").addEventListener("change", syncTypeFields);
return true;
}

function syncTypeFields() {
const t = document.getElementById("auType").value;
document.getElementById("auFixedWrap").style.display = t === "fixed" ? "block" : "none";
document.getElementById("auNthWrap").style.display = t === "nth" ? "block" : "none";
}

function note(id, msg, kind) {
const el = document.getElementById(id);
if (!el) return;
el.textContent = msg;
el.className = `au-note${kind ? " " + kind : ""}`;
}

// ---------- health banner ----------
function drawHealth() {
const el = document.getElementById("auHealth");
if (!el) return;
const bits = [];
if (!BIZ_ADDRESS) bits.push(`<div class="au-warn"><strong>Heads up:</strong> marketing email legally needs a real postal address in the footer. Open <code>ft-email-template.js</code> and fill in <code>BIZ_ADDRESS</code> (a PO box is fine).</div>`);
if (!lastRunAt) {
bits.push(`<div class="au-warn"><strong>The daily scheduler hasn't run yet.</strong> Nothing on this page will send on its own until the <code>ftDailySend</code> function and its 8:00 AM job are set up in Google Cloud. Until then you can still send manually from the Email tab.</div>`);
} else {
const when = lastRunAt.toDate ? lastRunAt.toDate() : new Date(lastRunAt);
const hrs = (Date.now() - when.getTime()) / 36e5;
const cls = hrs > 36 ? "au-warn" : "au-ok";
const label = hrs > 36 ? "The daily scheduler hasn't checked in since" : "Daily scheduler last ran";
bits.push(`<div class="${cls}">${label} ${esc(when.toLocaleString())}.</div>`);
}
el.innerHTML = bits.join("");
}

// ---------- birthday ----------
function fillBirthday() {
const b = birthday;
document.getElementById("auBdayOn").checked = b.enabled !== false;
document.getElementById("auBdaySubj").value = b.subject || "";
document.getElementById("auBdayHead").value = b.headline || "";
document.getElementById("auBdayBody").value = b.body || "";
document.getElementById("auBdayCta").value = b.ctaLabel || "";
document.getElementById("auBdayHref").value = b.ctaHref || CONTACT;
}

function readBirthday() {
return {
enabled: document.getElementById("auBdayOn").checked,
subject: document.getElementById("auBdaySubj").value.trim(),
headline: document.getElementById("auBdayHead").value.trim(),
body: document.getElementById("auBdayBody").value.trim(),
ctaLabel: document.getElementById("auBdayCta").value.trim(),
ctaHref: document.getElementById("auBdayHref").value.trim() || CONTACT
};
}

async function saveBirthday() {
const b = readBirthday();
if (!b.subject || !b.body) return note("auBdayNote", "Subject and message are both required.", "err");
try {
await setDoc(doc(db, "settings", "automation"), { birthday: b, updatedAt: serverTimestamp() }, { merge: true });
note("auBdayNote", b.enabled ? "Saved. Birthday notes are on." : "Saved. Birthday notes are turned off.", "ok");
} catch (err) {
console.warn("Birthday settings save error:", err);
note("auBdayNote", "Couldn't save (Firestore rule for settings).", "err");
}
}

function previewBirthday() {
const sample = { name: "Sample Client", email: "someone@example.com" };
paint("auBdayFrame", "auBdayPrevWrap", renderMessage(readBirthday(), sample));
}

// ---------- campaign list ----------
function nextSend(c) {
const y = new Date().getFullYear();
let d = campaignDate(c, y);
const today = new Date(); today.setHours(0, 0, 0, 0);
if (d < today) d = campaignDate(c, y + 1);
return d;
}

function drawList() {
const wrap = document.getElementById("auList");
if (!wrap) return;
if (!campaigns.length) {
wrap.innerHTML = `<div class="au-sub" style="margin:0">No campaigns yet. Load the drafts below and edit whichever ones you want.</div>`;
return;
}
const year = new Date().getFullYear();
const rows = campaigns.slice().sort((a, b) => nextSend(a) - nextSend(b));
wrap.innerHTML = `<table class="au-tbl">
<thead><tr><th>Campaign</th><th>When</th><th>Next send</th><th>Status</th><th></th></tr></thead>
<tbody>${rows.map((c) => {
const off = c.enabled === false;
const sentThisYear = Number(c.lastSentYear) === year;
const pill = off ? `<span class="au-pill">Off</span>` : (sentThisYear ? `<span class="au-pill done">Sent this year</span>` : `<span class="au-pill on">On</span>`);
return `<tr class="${off ? "off" : ""}" data-id="${esc(c.id)}">
<td><strong>${esc(c.name)}</strong><br><span class="au-when">${esc(c.subject)}</span></td>
<td class="au-when">${esc(scheduleText(c))}</td>
<td class="au-next">${esc(prettyDate(nextSend(c)))}</td>
<td>${pill}</td>
<td style="white-space:nowrap">
<button class="au-btn" data-act="edit">Edit</button>
<button class="au-btn" data-act="toggle">${off ? "Turn on" : "Turn off"}</button>
</td>
</tr>`;
}).join("")}</tbody></table>`;
wrap.querySelectorAll("[data-act='edit']").forEach((b) => b.addEventListener("click", () => openEditor(b.closest("tr").dataset.id)));
wrap.querySelectorAll("[data-act='toggle']").forEach((b) => b.addEventListener("click", async () => {
const id = b.closest("tr").dataset.id;
const c = campaigns.find((x) => x.id === id);
if (!c) return;
try { await updateDoc(doc(db, "campaigns", id), { enabled: c.enabled === false, updatedAt: serverTimestamp() }); }
catch (err) { console.warn("Campaign toggle error:", err); note("auListNote", "Couldn't update that (Firestore rule).", "err"); }
}));
}

// ---------- editor ----------
function openEditor(id) {
editingId = id;
const c = id ? campaigns.find((x) => x.id === id) : null;
const base = c || { name: "", subject: "", headline: "", body: "", ctaLabel: "Book with us", ctaHref: CONTACT, scheduleType: "fixed", month: 1, day: 1, weekday: 0, nth: 1, offsetDays: 0, enabled: true };
document.getElementById("auEditTitle").textContent = c ? `Edit — ${c.name}` : "New campaign";
document.getElementById("auEditWhen").textContent = c ? `Next send: ${prettyDate(nextSend(c))}` : "";
document.getElementById("auName").value = base.name || "";
document.getElementById("auSubj").value = base.subject || "";
document.getElementById("auHead").value = base.headline || "";
document.getElementById("auBody").value = base.body || "";
document.getElementById("auCta").value = base.ctaLabel || "";
document.getElementById("auHref").value = base.ctaHref || CONTACT;
document.getElementById("auType").value = base.scheduleType || "fixed";
document.getElementById("auMonth").value = String(base.month || 1);
document.getElementById("auNthMonth").value = String(base.month || 1);
document.getElementById("auDay").value = base.day || 1;
document.getElementById("auWeekday").value = String(base.weekday || 0);
document.getElementById("auNth").value = String(base.nth || 1);
document.getElementById("auOffset").value = base.offsetDays || 0;
document.getElementById("auOn").checked = base.enabled !== false;
document.getElementById("auDelete").style.display = c ? "block" : "none";
syncTypeFields();
note("auEditNote", "");
document.getElementById("auPrevWrap").style.display = "none";
const ed = document.getElementById("auEditor");
ed.style.display = "block";
ed.scrollIntoView({ behavior: "smooth", block: "start" });
}

function readEditor() {
const type = document.getElementById("auType").value;
return {
name: document.getElementById("auName").value.trim(),
subject: document.getElementById("auSubj").value.trim(),
headline: document.getElementById("auHead").value.trim(),
body: document.getElementById("auBody").value.trim(),
ctaLabel: document.getElementById("auCta").value.trim(),
ctaHref: document.getElementById("auHref").value.trim() || CONTACT,
scheduleType: type,
month: Number(type === "nth" ? document.getElementById("auNthMonth").value : document.getElementById("auMonth").value) || 1,
day: Number(document.getElementById("auDay").value) || 1,
weekday: Number(document.getElementById("auWeekday").value) || 0,
nth: Number(document.getElementById("auNth").value) || 1,
offsetDays: Number(document.getElementById("auOffset").value) || 0,
enabled: document.getElementById("auOn").checked
};
}

async function saveCampaign() {
const c = readEditor();
if (!c.name) return note("auEditNote", "Give it a name so you can find it later.", "err");
if (!c.subject || !c.body) return note("auEditNote", "Subject and message are both required.", "err");
try {
if (editingId) await updateDoc(doc(db, "campaigns", editingId), { ...c, updatedAt: serverTimestamp() });
else {
const ref = await addDoc(collection(db, "campaigns"), { ...c, lastSentYear: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
editingId = ref.id;
}
note("auEditNote", `Saved. Next send: ${prettyDate(nextSend(c))}.`, "ok");
document.getElementById("auEditWhen").textContent = `Next send: ${prettyDate(nextSend(c))}`;
} catch (err) {
console.warn("Campaign save error:", err);
note("auEditNote", "Couldn't save (Firestore rule for campaigns).", "err");
}
}

async function deleteCampaign() {
if (!editingId) return;
const c = campaigns.find((x) => x.id === editingId);
if (!confirm(`Delete "${c?.name || "this campaign"}"? This can't be undone.`)) return;
try {
await deleteDoc(doc(db, "campaigns", editingId));
editingId = null;
document.getElementById("auEditor").style.display = "none";
} catch (err) {
console.warn("Campaign delete error:", err);
note("auEditNote", "Couldn't delete that (Firestore rule).", "err");
}
}

function previewCampaign() {
const sample = { name: "Sample Client", email: "someone@example.com" };
paint("auFrame", "auPrevWrap", renderMessage(readEditor(), sample));
}

function paint(frameId, wrapId, html) {
const wrap = document.getElementById(wrapId);
const frame = document.getElementById(frameId);
if (!wrap || !frame) return;
wrap.style.display = "block";
frame.srcdoc = html;
}

// ---------- test send ----------
async function testSend(c, noteId) {
const me = auth.currentUser?.email;
if (!validEmail(me)) return note(noteId, "Couldn't work out your own email address.", "err");
if (!c.subject || !c.body) return note(noteId, "Subject and message are both required.", "err");
const sub = { name: "Sample Client", email: me };
try {
await addDoc(collection(db, "mail"), {
to: me,
message: { subject: `[test] ${c.subject}`, html: renderMessage(c, sub) },
_ftCampaign: "test",
_ftCreatedAt: serverTimestamp()
});
note(noteId, `Test queued to ${me}. It should land within a minute.`, "ok");
} catch (err) {
console.warn("Test send error:", err);
note(noteId, "Couldn't queue the test (Firestore rule for the mail collection).", "err");
}
}

// ---------- seed ----------
async function seedDrafts() {
const existing = new Set(campaigns.map((c) => c.name));
const toAdd = HOLIDAY_DRAFTS.filter((d) => !existing.has(d.name));
if (!toAdd.length) return note("auListNote", "All eleven drafts are already loaded.", "ok");
if (!confirm(`Add ${toAdd.length} holiday draft${toAdd.length === 1 ? "" : "s"}? They'll be turned off until you switch them on.`)) return;
try {
const batch = writeBatch(db);
toAdd.forEach((d) => batch.set(doc(collection(db, "campaigns")), {
...d, enabled: false, lastSentYear: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
}));
await batch.commit();
note("auListNote", `Added ${toAdd.length}. They're all switched off — read through them, then turn on the ones you want.`, "ok");
} catch (err) {
console.warn("Seed error:", err);
note("auListNote", "Couldn't add those (Firestore rule for campaigns).", "err");
}
}

// ---------- boot ----------
function boot() {
onAuthStateChanged(auth, (user) => {
if (!user) return;
if (!injectUI()) return;
fillBirthday();
drawHealth();
drawList();

onSnapshot(doc(db, "settings", "automation"),
(snap) => {
const d = snap.data() || {};
if (d.birthday) birthday = { ...DEFAULT_BIRTHDAY, ...d.birthday };
lastRunAt = d.lastRunAt || null;
fillBirthday();
drawHealth();
},
(err) => { console.warn("Automation settings listener error:", err); }
);

onSnapshot(query(collection(db, "campaigns"), orderBy("month", "asc")),
(snap) => { campaigns = snap.docs.map((d) => ({ id: d.id, ...d.data() })); drawList(); },
(err) => {
console.warn("Campaigns listener error:", err);
note("auListNote", "Couldn't load campaigns (Firestore rule).", "err");
}
);
});
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

