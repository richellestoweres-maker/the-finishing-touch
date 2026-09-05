// === The Finishing Touch — website signup for "the feed" ===
// Adds a "Stay in the loop" block just above the site footer and writes the
// person into subscribers/{emailSlug}, the same collection the intake forms
// feed. That list is what the Automations tab sends holiday campaigns and
// birthday notes to.
//
// Until this existed the only way onto the list was to complete a full intake
// form, so browsers who were not ready to book had no way to hear from us.
//
// Include on a public page with:
//   <script type="module" src="ft-subscribe.js"></script>
// It injects itself, so there is no markup to copy onto each page.

import { auth, db } from "./ft-firebase.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim());
const slugFor = (email) => String(email).toLowerCase().replace(/[^a-z0-9]/gi, "_").slice(0, 60);

function styles() {
  const css = document.createElement("style");
  css.textContent = `
.ft-sub-wrap{background:#f3efe8;padding:44px 18px}
.ft-sub{max-width:620px;margin:0 auto;background:#fffdf9;border:1px solid #e8ded2;border-radius:16px;padding:26px 26px 24px;box-shadow:0 12px 30px rgba(0,0,0,.06)}
.ft-sub h3{margin:0 0 6px;font-family:"Playfair Display",Georgia,serif;font-size:1.45rem;color:#2e2a27;text-align:center}
.ft-sub .ft-sub-lede{margin:0 0 20px;text-align:center;font-family:"Manrope",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:.93rem;line-height:1.55;color:rgba(0,0,0,.6)}
.ft-sub-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ft-sub label{display:grid;gap:5px;font-family:"Manrope",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:.8rem;font-weight:600;color:#6c5f52;letter-spacing:.02em}
.ft-sub input[type=text],.ft-sub input[type=email],.ft-sub select{width:100%;box-sizing:border-box;border:1px solid #e3d9ce;border-radius:11px;padding:.72rem .85rem;background:#fff;font-size:16px;font-family:inherit;color:#2e2a27;outline:none;transition:border-color .18s ease,box-shadow .18s ease}
.ft-sub input:focus,.ft-sub select:focus{border-color:#d2bda9;box-shadow:0 0 0 1px rgba(210,189,169,.35)}
.ft-sub-bday{margin-top:14px}
.ft-sub-bday .ft-sub-pair{display:flex;gap:10px}
.ft-sub-bday .ft-sub-pair select{flex:1}
.ft-sub label.ft-sub-consent{display:flex;gap:10px;align-items:flex-start;margin-top:18px;font-family:"Manrope",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:.86rem;font-weight:400;line-height:1.5;color:#4a423b;cursor:pointer;letter-spacing:0}
.ft-sub label.ft-sub-consent input{margin-top:3px;width:16px;height:16px;flex:none}
.ft-sub-btn{margin-top:18px;width:100%;border:0;border-radius:999px;background:#2b2622;color:#fffdf9;padding:12px 22px;font-family:"Manrope",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:.95rem;font-weight:600;cursor:pointer;transition:opacity .16s ease}
.ft-sub-btn:hover{opacity:.88}
.ft-sub-btn:disabled{opacity:.5;cursor:default}
.ft-sub-note{margin:12px 0 0;text-align:center;font-family:"Manrope",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:.8rem;color:rgba(0,0,0,.5);min-height:18px}
.ft-sub-note.err{color:#b00020}
.ft-sub-note.ok{color:#0a7d33;font-weight:600}
.ft-sub-done{text-align:center;font-family:"Manrope",system-ui,-apple-system,"Segoe UI",sans-serif;color:#2e2a27}
.ft-sub-done strong{display:block;font-family:"Playfair Display",Georgia,serif;font-size:1.3rem;margin-bottom:6px}
@media(max-width:620px){.ft-sub-row{grid-template-columns:1fr}}`;
  document.head.appendChild(css);
}

function build() {
  const monthOpts = ['<option value="">Month</option>']
    .concat(MONTHS.map((m, i) => `<option value="${i + 1}">${esc(m)}</option>`)).join("");
  const dayOpts = ['<option value="">Day</option>']
    .concat(Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`)).join("");

  const wrap = document.createElement("section");
  wrap.className = "ft-sub-wrap";
  wrap.id = "ft-sub-wrap";
  wrap.innerHTML = `
<div class="ft-sub">
  <h3>Stay in the loop</h3>
  <p class="ft-sub-lede">Seasonal specials, a few home tips, and a little something on your birthday. A couple of emails a month, never more.</p>
  <form id="ftSubForm" novalidate>
    <div class="ft-sub-row">
      <label>First name
        <input type="text" id="ftSubName" autocomplete="given-name" placeholder="Richelle">
      </label>
      <label>Email
        <input type="email" id="ftSubEmail" autocomplete="email" placeholder="you@example.com" required>
      </label>
    </div>
    <div class="ft-sub-bday">
      <label>Birthday (optional)
        <span class="ft-sub-pair">
          <select id="ftSubMonth">${monthOpts}</select>
          <select id="ftSubDay">${dayOpts}</select>
        </span>
      </label>
    </div>
    <label class="ft-sub-consent">
      <input type="checkbox" id="ftSubConsent">
      <span>Yes, send me seasonal specials and updates from The Finishing Touch. You can unsubscribe any time.</span>
    </label>
    <button class="ft-sub-btn" type="submit" id="ftSubBtn">Sign me up</button>
    <p class="ft-sub-note" id="ftSubNote"></p>
  </form>
</div>`;
  return wrap;
}

function note(msg, kind) {
  const el = document.getElementById("ftSubNote");
  if (!el) return;
  el.textContent = msg || "";
  el.className = `ft-sub-note${kind ? " " + kind : ""}`;
}

async function save(payload) {
  const ref = doc(db, "subscribers", slugFor(payload.email));
  try {
    await setDoc(ref, payload, { merge: true });
  } catch (err) {
    // Some rule setups want a signed-in user, even an anonymous one.
    try { await signInAnonymously(auth); } catch (e) { throw err; }
    await setDoc(ref, payload, { merge: true });
  }
}

async function submit(ev) {
  ev.preventDefault();
  const name = document.getElementById("ftSubName").value.trim();
  const email = document.getElementById("ftSubEmail").value.trim();
  const month = document.getElementById("ftSubMonth").value;
  const day = document.getElementById("ftSubDay").value;
  const consent = document.getElementById("ftSubConsent").checked;

  if (!validEmail(email)) return note("That email address doesn't look right.", "err");
  if (!consent) return note("Tick the box so we know it's okay to email you.", "err");

  const btn = document.getElementById("ftSubBtn");
  btn.disabled = true;
  note("Adding you…");

  const payload = {
    email,
    name,
    marketingConsent: true,
    subscribed: true,
    source: "website_signup",
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  };
  if (month) payload.birthMonth = month;
  if (day) payload.birthDay = day;

  try {
    await save(payload);
    const card = document.querySelector("#ft-sub-wrap .ft-sub");
    if (card) {
      card.innerHTML = `<div class="ft-sub-done">
        <strong>You're on the list${name ? ", " + esc(name.split(/\s+/)[0]) : ""}.</strong>
        Watch your inbox for seasonal specials${month && day ? ", and something on your birthday" : ""}.
      </div>`;
    }
  } catch (err) {
    console.warn("Subscribe failed:", err);
    btn.disabled = false;
    note("Something went wrong on our end. Try again in a moment, or email us.", "err");
  }
}

function boot() {
  if (document.getElementById("ft-sub-wrap")) return;
  const footer = document.querySelector("footer.site-footer");
  const block = build();
  styles();
  if (footer && footer.parentElement) footer.parentElement.insertBefore(block, footer);
  else document.body.appendChild(block);
  document.getElementById("ftSubForm").addEventListener("submit", submit);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
