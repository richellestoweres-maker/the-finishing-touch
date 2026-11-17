// === The Finishing Touch: contractor Walkthroughs (contractor-dashboard add-on) ===
// Richelle sends a sub on a walkthrough with a flat pay amount. The sub accepts or
// passes, then on site fills in the details, takes the photo checklist for that
// service, adds notes, and submits. There are no price fields: Richelle prices
// every job herself.
//
// Loaded on contractor-dashboard.html with:
//   <script type="module" src="ft-walkthroughs-sub.js"></script>

import { db, auth, storage } from "./ft-firebase.js";
import {
  collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

/* ---------- photo guidance ---------- */
const RULES = [
  "Take every photo before anything is moved or touched.",
  "Shoot each room wide first, then the close-ups.",
  "Use good light and check each photo is clear.",
  "Photograph any damage or concerns and let Richelle know.",
  "Keep people, mail, papers, medications, family photos and access codes out of the shot."
];

const SHOTS = {
  cleaning: [
    { key: "rooms", label: "Wide angle of every room" },
    { key: "fans", label: "Ceiling fans and light fixtures, close up" },
    { key: "corners", label: "Wall and ceiling corners, checking for cobwebs" },
    { key: "vents", label: "Air vents and returns" },
    { key: "baseboards", label: "Baseboards" },
    { key: "showers", label: "Showers and tubs, including grout and glass" },
    { key: "toilets", label: "Floor around and behind each toilet" },
    { key: "kitchen", label: "Kitchen: stovetop, cabinet fronts, and inside the oven or fridge if requested" },
    { key: "buildup", label: "Heavy buildup, stains or damage, close up" },
    { key: "walkvideo", label: "Walkthrough video starting at the front door", video: true }
  ],
  home_reset: [
    { key: "rooms", label: "Wide angle of each room or priority area" },
    { key: "kitchen", label: "Kitchen counters and sink" },
    { key: "living", label: "Playroom, living areas, entryway and bedrooms to reset" },
    { key: "laundry", label: "Laundry area and how much laundry is waiting" },
    { key: "fridge", label: "Fridge or pantry, if snack prep or a fridge tidy is wanted" },
    { key: "concerns", label: "Damage or concerns" }
  ],
  organizing: [
    { key: "spaces", label: "Wide angle of each space to organize" },
    { key: "inside", label: "Inside the cabinets, drawers, closets or pantry sections" },
    { key: "storage", label: "Current containers, shelving and storage" },
    { key: "concerns", label: "Damage or concerns" }
  ],
  holiday: [
    { key: "areas", label: "Each installation area, wide" },
    { key: "inventory", label: "The client's decorations and storage bins" },
    { key: "power", label: "Outlets, attachment points and cord paths" },
    { key: "damage", label: "Existing damage to decorations or surfaces" }
  ],
  decor: [
    { key: "rooms", label: "Wide angle of each room from the corners" },
    { key: "focal", label: "Each focal area, such as seating, dining, shelving or wall art" },
    { key: "pieces", label: "Furniture and pieces that are staying" },
    { key: "walls", label: "Walls and areas to style (add measurements in your notes)" },
    { key: "concerns", label: "Damage or concerns" }
  ],
  other: [
    { key: "areas", label: "Wide angle of each area" },
    { key: "details", label: "Close-ups of anything worth noting" }
  ]
};

const SERVICE_CHOICES = [
  ["cleaning", "Cleaning"], ["home_reset", "Home Reset"], ["organizing", "Organizing"],
  ["holiday", "Holiday Decor"], ["decor", "Design / Interior Styling"],
  ["staging", "Staging"], ["virtual_design", "Virtual Design"]
];

function shotsFor(service) {
  const s = String(service || "").toLowerCase();
  if (/reset|concierge/.test(s)) return SHOTS.home_reset;
  if (/organiz/.test(s)) return SHOTS.organizing;
  if (/holiday|christmas/.test(s)) return SHOTS.holiday;
  if (/decor|styl|design|interior|stag/.test(s)) return SHOTS.decor;
  if (/clean|move|airbnb|commercial|turnover/.test(s)) return SHOTS.cleaning;
  return SHOTS.other;
}

/* ---------- helpers ---------- */
const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const money = (n) => "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const cleanName = (n) => String(n || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
const serviceName = (w) => w.serviceLabel || (SERVICE_CHOICES.find((s) => s[0] === w.serviceType) || [, "Walkthrough"])[1];

function when(w) {
  if (w.appointment) return w.appointment;
  return "";
}

/* ---------- state ---------- */
let list = [];
let openId = null;
let busy = false;

function host() { return document.getElementById("view-walkthrough"); }

const FIELDS = [
  ["clientName", "Client name"],
  ["propertyAddress", "Service address", "full"],
  ["beds", "Bedrooms"],
  ["baths", "Bathrooms"],
  ["sqft", "Square footage"],
  ["stories", "Stories"],
  ["pets", "Pets"],
  ["addons", "Add-ons", "full"],
  ["schedulingNotes", "Scheduling and access notes", "full"],
  ["clientNotes", "Client notes", "area"],
  ["walkNotes", "Walkthrough notes", "area", "Anything the client mentioned that isn't on the form"]
];

/* ---------- list screen ---------- */
function section(title, rows, fn) {
  if (!rows.length) return "";
  return `<h3 class="ftw-sec">${esc(title)}</h3>` + rows.map(fn).join("");
}

function offerCard(w) {
  return `<div class="ftw-card" data-id="${esc(w.id)}">
    <div class="ftw-top"><strong>${esc(serviceName(w))}</strong><span class="ftw-pay">${money(w.pay)}</span></div>
    ${w.area ? `<div class="ftw-meta">Area: ${esc(w.area)}</div>` : ""}
    ${when(w) ? `<div class="ftw-meta">When: ${esc(when(w))}</div>` : ""}
    <div class="ftw-actions">
      <button class="btn btn-primary" data-act="accept" type="button">Accept</button>
      <button class="btn btn-soft" data-act="pass" type="button">Pass</button>
    </div>
  </div>`;
}

function activeCard(w) {
  return `<div class="ftw-card" data-id="${esc(w.id)}">
    <div class="ftw-top"><strong>${esc(serviceName(w))}</strong><span class="ftw-pay">${money(w.pay)}</span></div>
    ${w.clientName ? `<div class="ftw-meta">${esc(w.clientName)}</div>` : ""}
    ${w.propertyAddress ? `<div class="ftw-meta">${esc(w.propertyAddress)}</div>` : ""}
    ${when(w) ? `<div class="ftw-meta">When: ${esc(when(w))}</div>` : ""}
    <div class="ftw-actions"><button class="btn btn-primary" data-act="open" type="button">Start walkthrough</button></div>
  </div>`;
}

function doneCard(w) {
  const label = w.status === "reviewed" ? "Reviewed" : "Submitted";
  return `<div class="ftw-card" data-id="${esc(w.id)}">
    <div class="ftw-top"><strong>${esc(serviceName(w))}</strong><span class="ftw-tag">${label}</span></div>
    ${w.clientName ? `<div class="ftw-meta">${esc(w.clientName)}</div>` : ""}
    ${w.propertyAddress ? `<div class="ftw-meta">${esc(w.propertyAddress)}</div>` : ""}
  </div>`;
}

function listHtml() {
  const offered = list.filter((w) => w.offerStatus === "offered" && w.status === "draft");
  const active = list.filter((w) => w.offerStatus === "accepted" && w.status === "draft");
  const done = list.filter((w) => w.status !== "draft");
  return `<p class="mini-kicker">Walkthroughs</p>
    <h2 class="screen-title">Walkthroughs</h2>
    <p class="screen-copy">Accept or pass, then take the photos and notes on site.</p>
    ${section("New requests", offered, offerCard)}
    ${section("To do", active, activeCard)}
    ${section("Submitted", done, doneCard)}
    ${offered.length || active.length || done.length ? "" : `<div class="empty">No walkthroughs right now.</div>`}`;
}

/* ---------- walkthrough screen ---------- */
function thumbs(files) {
  return (files || []).map((f) => f.type === "video"
    ? `<a class="ftw-vid" href="${esc(f.url)}" target="_blank" rel="noopener">Video</a>`
    : `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt=""></a>`).join("");
}

function formHtml(w) {
  const shots = shotsFor(w.serviceType || w.serviceLabel);
  const saved = w.shots || {};
  const clientPics = [...(w.mediaPhotoUrls || []).map((url) => ({ url, type: "photo" })), ...(w.mediaVideoUrls || []).map((url) => ({ url, type: "video" }))];
  const field = ([k, label, kind, ph]) => kind === "area"
    ? `<label class="field full">${esc(label)}<textarea data-f="${k}" placeholder="${esc(ph || "")}">${esc(w[k] || "")}</textarea></label>`
    : `<label class="field${kind === "full" ? " full" : ""}">${esc(label)}<input data-f="${k}" value="${esc(w[k] || "")}"></label>`;
  const maps = w.propertyAddress ? `https://maps.google.com/?q=${encodeURIComponent(w.propertyAddress)}` : "";
  return `<button class="ftw-back" data-act="back" type="button">‹ All walkthroughs</button>
    <p class="mini-kicker">Walkthrough</p>
    <h2 class="screen-title">${esc(serviceName(w))}</h2>
    <p class="screen-copy">${esc(w.clientName || "")}${w.propertyAddress ? ` · ${maps ? `<a href="${maps}" target="_blank" rel="noopener">${esc(w.propertyAddress)}</a>` : esc(w.propertyAddress)}` : ""}${when(w) ? ` · ${esc(when(w))}` : ""} · Pay ${money(w.pay)}</p>
    <div class="ftw-rules"><strong>Photo guidelines</strong><ul>${RULES.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>
    <h3 class="ftw-sec">Details</h3>
    <div class="form-grid">
      <label class="field">Service<select data-f="serviceType">${SERVICE_CHOICES.map(([k, l]) => `<option value="${k}" ${k === w.serviceType ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      ${FIELDS.map(field).join("")}
    </div>
    ${clientPics.length ? `<h3 class="ftw-sec">Photos the client sent</h3><div class="ftw-thumbs">${thumbs(clientPics)}</div>` : ""}
    <h3 class="ftw-sec">Photo checklist</h3>
    ${shots.map((s) => {
      const files = saved[s.key] || [];
      return `<div class="ftw-shot${files.length ? " done" : ""}">
        <div class="ftw-shot-top"><span class="ftw-check">${files.length ? "✓" : ""}</span><span>${esc(s.label)}</span><span class="ftw-count">${files.length || ""}</span></div>
        <div class="ftw-thumbs">${thumbs(files)}</div>
        <label class="btn btn-soft ftw-add">${s.video ? "Add video" : "Add photos"}<input type="file" data-shot="${esc(s.key)}" accept="${s.video ? "video/*" : "image/*,video/*"}" ${s.video ? "" : "multiple"} hidden></label>
      </div>`;
    }).join("")}
    <div class="ftw-shot${(saved.extra || []).length ? " done" : ""}">
      <div class="ftw-shot-top"><span class="ftw-check">${(saved.extra || []).length ? "✓" : ""}</span><span>Anything else</span><span class="ftw-count">${(saved.extra || []).length || ""}</span></div>
      <div class="ftw-thumbs">${thumbs(saved.extra)}</div>
      <label class="btn btn-soft ftw-add">Add photos or videos<input type="file" data-shot="extra" accept="image/*,video/*" multiple hidden></label>
    </div>
    <div class="ftw-msg" id="ftwMsg"></div>
    <div class="ftw-actions">
      <button class="btn btn-soft" data-act="save" type="button">Save progress</button>
      <button class="btn btn-primary" data-act="submit" type="button">Submit walkthrough</button>
    </div>`;
}

function readFields(h) {
  const out = {};
  h.querySelectorAll("[data-f]").forEach((el) => { out[el.dataset.f] = el.value.trim(); });
  return out;
}

/* ---------- actions ---------- */
async function upload(w, key, file) {
  const uid = auth.currentUser.uid;
  const path = `users/${uid}/project-notes/walkthroughs/${w.id}/${key}-${Date.now()}-${cleanName(file.name)}`;
  const snap = await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(snap.ref);
  return { url, name: file.name, type: String(file.type || "").startsWith("video") ? "video" : "photo", path };
}

function msg(text) { const m = document.getElementById("ftwMsg"); if (m) m.textContent = text; }

function hook(h) {
  h.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-id]");
      const id = card ? card.dataset.id : openId;
      const w = list.find((x) => x.id === id);
      const act = btn.dataset.act;
      if (act === "back") { openId = null; render(); return; }
      if (act === "open") { openId = id; render(); window.scrollTo(0, 0); return; }
      if (!w || busy) return;
      busy = true;
      btn.disabled = true;
      try {
        if (act === "accept") {
          await updateDoc(doc(db, "walkthroughs", id), { offerStatus: "accepted", acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        } else if (act === "pass") {
          if (!confirm("Pass on this walkthrough?")) return;
          await updateDoc(doc(db, "walkthroughs", id), { offerStatus: "passed", passedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        } else if (act === "save") {
          await updateDoc(doc(db, "walkthroughs", id), { ...readFields(h), updatedAt: serverTimestamp() });
          msg("Saved.");
        } else if (act === "submit") {
          const shots = shotsFor(w.serviceType || w.serviceLabel);
          const missing = shots.filter((s) => !((w.shots || {})[s.key] || []).length);
          if (missing.length && !confirm(`${missing.length} checklist item${missing.length === 1 ? " has" : "s have"} no photos yet. Submit anyway?`)) return;
          await updateDoc(doc(db, "walkthroughs", id), {
            ...readFields(h),
            status: "pending_review",
            submittedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          openId = null;
        }
      } catch (err) {
        console.warn("walkthrough action error:", err);
        msg("That didn't save. Check your connection and try again.");
        if (!openId) alert("That didn't save. Please try again.");
      } finally {
        busy = false;
        btn.disabled = false;
      }
    });
  });

  h.querySelectorAll('input[type="file"][data-shot]').forEach((input) => {
    input.addEventListener("change", async () => {
      const w = list.find((x) => x.id === openId);
      const files = Array.from(input.files || []);
      if (!w || !files.length) return;
      const key = input.dataset.shot;
      const label = (shotsFor(w.serviceType || w.serviceLabel).find((x) => x.key === key) || { label: "Anything else" }).label;
      const current = [...((w.shots || {})[key] || [])];
      try {
        // Save typed details first so a re-render never wipes them.
        await updateDoc(doc(db, "walkthroughs", w.id), { ...readFields(h), updatedAt: serverTimestamp() });
        for (let i = 0; i < files.length; i++) {
          msg(`Uploading ${i + 1} of ${files.length}…`);
          current.push(await upload(w, key, files[i]));
          await updateDoc(doc(db, "walkthroughs", w.id), { ["shots." + key]: current, ["shotLabels." + key]: label, updatedAt: serverTimestamp() });
        }
        msg("");
      } catch (err) {
        console.warn("walkthrough upload error:", err);
        msg("An upload didn't finish. Try that one again.");
      }
    });
  });
}

function render() {
  const h = host();
  if (!h) return;
  if (!document.getElementById("ftwStyle")) {
    const st = document.createElement("style");
    st.id = "ftwStyle";
    st.textContent = `
      #view-walkthrough .ftw-sec{font-size:13px;letter-spacing:.14em;text-transform:uppercase;margin:22px 0 10px;color:#8c7564}
      #view-walkthrough .ftw-card{border:1px solid #e2d4c0;border-radius:12px;padding:16px;margin-bottom:10px;background:#fcf8f2}
      #view-walkthrough .ftw-top{display:flex;align-items:center;gap:10px;justify-content:space-between}
      #view-walkthrough .ftw-top strong{font-size:17px}
      #view-walkthrough .ftw-pay{font-weight:800}
      #view-walkthrough .ftw-tag{font-size:12px;padding:4px 10px;border-radius:999px;background:#f1e6d8}
      #view-walkthrough .ftw-meta{color:#5c4636;margin-top:4px}
      #view-walkthrough .ftw-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
      #view-walkthrough .ftw-back{all:unset;cursor:pointer;color:#5c4636;font-weight:600;margin-bottom:6px;display:inline-block}
      #view-walkthrough .ftw-rules{border:1px solid #e2d4c0;border-radius:12px;padding:14px 16px;background:#fcf8f2;margin-top:12px}
      #view-walkthrough .ftw-rules ul{margin:8px 0 0;padding-left:18px}
      #view-walkthrough .ftw-shot{border:1px solid #e2d4c0;border-radius:12px;padding:12px 14px;margin-bottom:8px;background:#fcf8f2}
      #view-walkthrough .ftw-shot.done{border-color:#b9a17f}
      #view-walkthrough .ftw-shot-top{display:flex;align-items:center;gap:10px;font-weight:600}
      #view-walkthrough .ftw-shot-top span:nth-child(2){flex:1}
      #view-walkthrough .ftw-check{width:22px;height:22px;border-radius:50%;border:1px solid #cdb9a3;display:inline-flex;align-items:center;justify-content:center;font-size:13px}
      #view-walkthrough .ftw-count{color:#8c7564;font-size:13px}
      #view-walkthrough .ftw-thumbs{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
      #view-walkthrough .ftw-thumbs img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #e2d4c0}
      #view-walkthrough .ftw-vid{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:8px;border:1px solid #e2d4c0;font-size:12px;font-weight:700;color:#2b1a10;text-decoration:none}
      #view-walkthrough .ftw-add{cursor:pointer}
      #view-walkthrough .ftw-msg{min-height:20px;margin-top:10px;color:#5c4636}`;
    document.head.appendChild(st);
  }
  const w = openId ? list.find((x) => x.id === openId) : null;
  if (w && w.offerStatus === "accepted" && w.status === "draft") {
    // Keep what the sub has typed when the list refreshes underneath them.
    const typed = h.querySelector("[data-f]") ? readFields(h) : null;
    h.innerHTML = formHtml(typed ? { ...w, ...typed } : w);
  } else {
    openId = null;
    h.innerHTML = listHtml();
  }
  hook(h);
}

window.FTWalkSub = { render };

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  onSnapshot(
    query(collection(db, "walkthroughs"), where("submittedByUid", "==", user.uid)),
    (snap) => {
      list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((w) => w.assignment)
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      render();
    },
    (err) => console.warn("walkthroughs listener error:", err)
  );
});
