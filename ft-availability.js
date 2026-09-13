// === The Finishing Touch — Contractor Weekly Availability (contractor-dashboard add-on) ===
//
// Replaces the old free-text "Available Slots / Blocked Days" boxes with a real,
// machine-readable weekly grid so the office (and later Ivy) can actually schedule
// against it instead of reading a sentence.
//
// For each day of the week the sub sets:
//   - whether she works that day
//   - which time windows (morning / midday / afternoon / evening / anytime),
//     or exact start and end times if she prefers
//   - which ZIP codes she covers that day (any number of them)
// Plus a list of specific dates she is blocked off.
//
// Time-window keys deliberately match TIME_WINDOWS in ft-contractor-schedule.js
// so weekly availability and per-job slot proposals speak the same language.
//
// Self-contained: takes over the existing #view-availability panel and holds it
// (the dashboard re-renders that panel on auth, so we watch and re-assert).
// Only change to contractor-dashboard.html: add before </body>:
//   <script type="module" src="ft-availability.js"></script>
//
// Also exports mountAvailabilityEditor(el, uid, opts) so the admin dashboard can
// reuse the exact same editor for a given contractor later.

import { db, auth } from "./ft-firebase.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

/* ============================================================
   Constants
   ============================================================ */

const SCHEMA_VERSION = 2;

const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"]
];

// Keys match ft-contractor-schedule.js TIME_WINDOWS.
const WINDOWS = [
  ["morning", "Morning", "8am to 12pm"],
  ["midday", "Midday", "11am to 2pm"],
  ["afternoon", "Afternoon", "12pm to 4pm"],
  ["evening", "Evening", "4pm to 7pm"],
  ["anytime", "Anytime", "open all day"]
];

const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const todayStr = () => {
  const n = new Date();
  return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
};

function prettyDate(d) {
  if (!d) return "";
  try {
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch { return d; }
}

function blankDay() {
  return { on: false, mode: "windows", windows: [], start: "", end: "", zips: [] };
}

function blankWeek() {
  const w = {};
  DAYS.forEach(([k]) => { w[k] = blankDay(); });
  return w;
}

/* ============================================================
   Styles
   ============================================================ */

function injectStyles() {
  if (document.getElementById("ftAvailStyles")) return;
  const style = document.createElement("style");
  style.id = "ftAvailStyles";
  style.textContent = `
    .fa-wrap{--fa-line:var(--line,#e8e0d8);--fa-card:var(--card,#fffdf9);--fa-ink:#3a322b;--fa-dim:#6c5f52;--fa-accent:#3d5a4c;--fa-accent-soft:#e6ede8}
    .fa-legacy{border:1px solid #e8d9b8;background:#fdf7e8;border-radius:12px;padding:12px 14px;margin:0 0 16px;font-size:13.5px;color:#6b5a32}
    .fa-legacy strong{display:block;margin-bottom:4px}
    .fa-legacy code{background:#fff;border:1px solid #eadfc4;border-radius:6px;padding:1px 6px;font-size:12.5px}
    .fa-bulk{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
    .fa-day{border:1px solid var(--fa-line);border-radius:14px;background:var(--fa-card);padding:14px 16px;margin:0 0 10px;transition:opacity .15s}
    .fa-day.off{opacity:.6}
    .fa-dayhead{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .fa-dayname{font-weight:800;font-size:15px;min-width:96px}
    .fa-toggle{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--fa-dim);cursor:pointer;user-select:none}
    .fa-toggle input{width:16px;height:16px;accent-color:var(--fa-accent);cursor:pointer}
    .fa-copyday{margin-left:auto;font-size:12px;color:var(--fa-accent);background:none;border:none;cursor:pointer;text-decoration:underline;padding:2px 0;font-family:inherit}
    .fa-body{margin-top:12px;display:none}
    .fa-day.on .fa-body{display:block}
    .fa-label{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#98897b;margin:0 0 7px;font-weight:700}
    .fa-chips{display:flex;flex-wrap:wrap;gap:7px}
    .fa-chip{border:1px solid var(--fa-line);background:#fff;border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer;font-family:inherit;color:var(--fa-ink);line-height:1.3;transition:background .12s,border-color .12s}
    .fa-chip small{display:block;font-size:10.5px;color:#98897b;margin-top:1px}
    .fa-chip[aria-pressed="true"]{background:var(--fa-accent);border-color:var(--fa-accent);color:#fff}
    .fa-chip[aria-pressed="true"] small{color:#cfe0d5}
    .fa-chip:focus-visible{outline:2px solid var(--fa-accent);outline-offset:2px}
    .fa-modeswitch{margin:12px 0 0;font-size:12.5px;color:var(--fa-dim)}
    .fa-modeswitch button{background:none;border:none;color:var(--fa-accent);text-decoration:underline;cursor:pointer;font-size:12.5px;padding:0;font-family:inherit}
    .fa-exact{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:4px}
    .fa-exact input[type=time]{padding:7px 9px;border:1px solid #d8cdc0;border-radius:9px;font-size:13.5px;font-family:inherit;background:#fff;color:var(--fa-ink)}
    .fa-sub{margin-top:14px}
    .fa-zipbox{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid #d8cdc0;border-radius:10px;padding:7px 9px;background:#fff;min-height:42px}
    .fa-zip{display:inline-flex;align-items:center;gap:5px;background:var(--fa-accent-soft);color:var(--fa-accent);border-radius:6px;padding:3px 4px 3px 8px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
    .fa-zip button{background:none;border:none;color:var(--fa-accent);cursor:pointer;font-size:15px;line-height:1;padding:0 4px;font-family:inherit}
    .fa-zipbox input{flex:1;min-width:96px;border:none;outline:none;font-size:13.5px;font-family:inherit;padding:4px 2px;background:transparent;color:var(--fa-ink)}
    .fa-hint{font-size:12px;color:#98897b;margin:5px 0 0}
    .fa-blocked{border:1px solid var(--fa-line);border-radius:14px;background:var(--fa-card);padding:16px;margin-top:20px}
    .fa-blockadd{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
    .fa-blockadd input[type=date]{padding:8px 10px;border:1px solid #d8cdc0;border-radius:10px;font-size:13.5px;font-family:inherit;background:#fff;color:var(--fa-ink)}
    .fa-blocklist{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
    .fa-blockpill{display:inline-flex;align-items:center;gap:6px;background:#f7f2ec;border-radius:8px;padding:5px 6px 5px 11px;font-size:13px}
    .fa-blockpill button{background:none;border:none;color:#9e4239;cursor:pointer;font-size:15px;line-height:1;padding:0 4px;font-family:inherit}
    .fa-note{width:100%;min-height:56px;padding:10px 12px;border:1px solid #d8cdc0;border-radius:10px;font-size:13.5px;font-family:inherit;margin-top:8px;background:#fff;color:var(--fa-ink)}
    .fa-save{position:sticky;bottom:0;background:var(--fa-card);border-top:1px solid var(--fa-line);padding:14px 0 12px;margin-top:18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
    .fa-saved{font-size:12.5px;color:#98897b}
    .fa-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:86px;background:#3a322b;color:#fff;padding:11px 20px;border-radius:999px;font-size:13.5px;z-index:9999;box-shadow:0 6px 22px rgba(0,0,0,.2)}
    @media (max-width:560px){
      .fa-dayname{min-width:0}
      .fa-copyday{margin-left:0;width:100%;text-align:left}
    }
    @media (prefers-reduced-motion:reduce){ .fa-day,.fa-chip{transition:none} }`;
  document.head.appendChild(style);
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "fa-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* ============================================================
   Load and normalize
   ============================================================ */

function normalize(raw) {
  const data = raw || {};
  const week = blankWeek();

  if (data.week && typeof data.week === "object") {
    DAYS.forEach(([k]) => {
      const d = data.week[k] || {};
      week[k] = {
        on: !!d.on,
        mode: d.mode === "exact" ? "exact" : "windows",
        windows: Array.isArray(d.windows) ? d.windows.filter((w) => WINDOWS.some((x) => x[0] === w)) : [],
        start: typeof d.start === "string" ? d.start : "",
        end: typeof d.end === "string" ? d.end : "",
        zips: Array.isArray(d.zips) ? d.zips.filter((z) => /^\d{5}$/.test(z)) : []
      };
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    week,
    blockedDates: Array.isArray(data.blockedDates)
      ? data.blockedDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
      : [],
    note: typeof data.note === "string" ? data.note : "",
    legacyAvailableSlots: typeof data.availableSlots === "string" ? data.availableSlots : (data.legacyAvailableSlots || ""),
    legacyBlockedDays: typeof data.blockedDays === "string" ? data.blockedDays : (data.legacyBlockedDays || ""),
    hasStructured: !!(data.week && typeof data.week === "object")
  };
}

async function loadAvailability(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "contractorSettings", "availability"));
    return normalize(snap.exists() ? snap.data() : null);
  } catch (err) {
    console.warn("[ft-availability] load failed", err);
    return normalize(null);
  }
}

/* ============================================================
   Markup
   ============================================================ */

function zipBoxHtml(dayKey, zips) {
  return `
    <div class="fa-zipbox" data-zipbox="${dayKey}">
      ${zips.map((z) => `<span class="fa-zip">${esc(z)}<button type="button" data-rmzip="${esc(z)}" aria-label="Remove ZIP ${esc(z)}">&times;</button></span>`).join("")}
      <input type="text" inputmode="numeric" maxlength="5" placeholder="${zips.length ? "Add another" : "Add a ZIP"}" aria-label="Add a ZIP code" data-zipinput="${dayKey}">
    </div>`;
}

function dayHtml(dayKey, dayName, d) {
  const windowsMode = d.mode !== "exact";
  return `
    <div class="fa-day ${d.on ? "on" : "off"}" data-day="${dayKey}">
      <div class="fa-dayhead">
        <span class="fa-dayname">${esc(dayName)}</span>
        <label class="fa-toggle">
          <input type="checkbox" data-dayon="${dayKey}" id="faOn-${dayKey}" ${d.on ? "checked" : ""}>
          ${d.on ? "Working this day" : "Not working"}
        </label>
        <button type="button" class="fa-copyday" data-copyday="${dayKey}">Copy this day to the rest of the week</button>
      </div>

      <div class="fa-body">
        <p class="fa-label">When</p>
        ${windowsMode ? `
          <div class="fa-chips">
            ${WINDOWS.map(([k, label, hint]) => `
              <button type="button" class="fa-chip" data-win="${k}" aria-pressed="${d.windows.includes(k) ? "true" : "false"}">
                ${esc(label)}<small>${esc(hint)}</small>
              </button>`).join("")}
          </div>
          <p class="fa-modeswitch">Need exact hours instead? <button type="button" data-mode="exact">Use start and end times</button></p>
        ` : `
          <div class="fa-exact">
            <input type="time" data-start value="${esc(d.start)}" aria-label="Start time">
            <span style="color:#98897b">to</span>
            <input type="time" data-end value="${esc(d.end)}" aria-label="End time">
          </div>
          <p class="fa-modeswitch">Prefer simple windows? <button type="button" data-mode="windows">Go back to windows</button></p>
        `}

        <div class="fa-sub">
          <p class="fa-label">ZIP codes covered this day</p>
          ${zipBoxHtml(dayKey, d.zips)}
          <p class="fa-hint">Type a ZIP and press enter. Add as many as you cover that day.</p>
        </div>
      </div>
    </div>`;
}

function shellHtml(state, opts) {
  const showLegacy = !state.hasStructured && (state.legacyAvailableSlots || state.legacyBlockedDays);
  return `
    <div class="fa-wrap">
      <p class="mini-kicker">Availability</p>
      <h2 class="screen-title">${opts.adminView ? "Availability for " + esc(opts.subjectName || "this contractor") : "Your weekly availability"}</h2>
      <p class="screen-copy">Set the days you work, the times you're free, and the ZIP codes you cover on each of those days. The office schedules against this, so keeping it current means fewer phone calls about what works.</p>

      ${showLegacy ? `
        <div class="fa-legacy">
          <strong>Your old notes, saved here so nothing is lost</strong>
          ${state.legacyAvailableSlots ? `Available slots: <code>${esc(state.legacyAvailableSlots)}</code><br>` : ""}
          ${state.legacyBlockedDays ? `Blocked days: <code>${esc(state.legacyBlockedDays)}</code>` : ""}
          <div style="margin-top:7px">Set them up below and this note goes away.</div>
        </div>` : ""}

      <div class="fa-bulk">
        <button type="button" class="btn btn-soft" data-preset="weekdays">Mark Monday to Friday as working</button>
        <button type="button" class="btn btn-soft" data-preset="clear">Clear the whole week</button>
      </div>

      <div id="faDays">
        ${DAYS.map(([k, name]) => dayHtml(k, name, state.week[k])).join("")}
      </div>

      <div class="fa-blocked">
        <p class="fa-label" style="margin-bottom:2px">Days off</p>
        <p class="fa-hint" style="margin:0">Specific dates you're not available, such as a vacation or an appointment. These override the weekly schedule above.</p>
        <div class="fa-blockadd">
          <input type="date" id="faBlockDate" min="${todayStr()}" aria-label="Date to block off">
          <button type="button" class="btn btn-outline" id="faBlockAdd">Add day off</button>
        </div>
        <div class="fa-blocklist" id="faBlockList"></div>
      </div>

      <div class="fa-blocked">
        <p class="fa-label" style="margin-bottom:2px">Anything else we should know</p>
        <p class="fa-hint" style="margin:0">Optional. For example, a longer drive time to certain areas, or a day you can start early with notice.</p>
        <textarea class="fa-note" id="faNote" placeholder="Optional note to the office">${esc(state.note)}</textarea>
      </div>

      <div class="fa-save">
        <button type="button" class="btn btn-primary" id="faSave">Save availability</button>
        <span class="fa-saved" id="faSaved"></span>
      </div>
    </div>`;
}

function blockListHtml(dates) {
  if (!dates.length) return `<span class="fa-hint" style="margin:0">No days off added yet.</span>`;
  return dates.map((d) => `
    <span class="fa-blockpill">${esc(prettyDate(d))}<button type="button" data-rmblock="${esc(d)}" aria-label="Remove ${esc(prettyDate(d))}">&times;</button></span>`).join("");
}

/* ============================================================
   Editor
   ============================================================ */

export function mountAvailabilityEditor(el, uid, opts = {}) {
  if (!el || !uid) return;
  injectStyles();

  let state = normalize(null);
  let dirty = false;

  const setSavedLabel = (txt) => {
    const s = el.querySelector("#faSaved");
    if (s) s.textContent = txt;
  };

  function repaintDay(dayKey, refocusZip) {
    const oldEl = el.querySelector(`[data-day="${dayKey}"]`);
    if (!oldEl) return;
    const name = (DAYS.find(([k]) => k === dayKey) || [])[1] || dayKey;
    const tmp = document.createElement("div");
    tmp.innerHTML = dayHtml(dayKey, name, state.week[dayKey]);
    oldEl.replaceWith(tmp.firstElementChild);
    // Keep the sub typing: adding a ZIP shouldn't cost her a tap to get back.
    if (refocusZip) {
      const next = el.querySelector(`[data-zipinput="${dayKey}"]`);
      if (next) next.focus();
    }
  }

  function repaintBlocks() {
    const list = el.querySelector("#faBlockList");
    if (list) list.innerHTML = blockListHtml(state.blockedDates);
  }

  function markDirty() {
    dirty = true;
    setSavedLabel("Unsaved changes");
  }

  function addZip(dayKey, value) {
    const zip = String(value || "").trim();
    if (!/^\d{5}$/.test(zip)) { toast("A ZIP code is five digits"); return false; }
    const day = state.week[dayKey];
    if (day.zips.includes(zip)) { toast(zip + " is already on this day"); return false; }
    day.zips.push(zip);
    day.zips.sort();
    markDirty();
    return true;
  }

  function wire() {
    // Day-level interactions, delegated so repaints don't lose handlers.
    el.addEventListener("click", (ev) => {
      const t = ev.target.closest("button");
      if (!t || !el.contains(t)) return;

      // Presets
      if (t.dataset.preset === "weekdays") {
        ["mon", "tue", "wed", "thu", "fri"].forEach((k) => { state.week[k].on = true; });
        DAYS.forEach(([k]) => repaintDay(k));
        markDirty();
        return;
      }
      if (t.dataset.preset === "clear") {
        state.week = blankWeek();
        DAYS.forEach(([k]) => repaintDay(k));
        markDirty();
        return;
      }

      const dayEl = t.closest("[data-day]");
      const dayKey = dayEl && dayEl.dataset.day;

      // Copy one day across the rest of the week
      if (t.dataset.copyday) {
        const src = state.week[t.dataset.copyday];
        DAYS.forEach(([k]) => {
          if (k === t.dataset.copyday) return;
          state.week[k] = {
            on: src.on,
            mode: src.mode,
            windows: src.windows.slice(),
            start: src.start,
            end: src.end,
            zips: src.zips.slice()
          };
        });
        DAYS.forEach(([k]) => repaintDay(k));
        markDirty();
        toast("Copied to the rest of the week");
        return;
      }

      if (dayKey) {
        // Time window chips
        if (t.dataset.win) {
          const day = state.week[dayKey];
          const key = t.dataset.win;
          if (key === "anytime") {
            day.windows = day.windows.includes("anytime") ? [] : ["anytime"];
          } else {
            day.windows = day.windows.filter((w) => w !== "anytime");
            day.windows = day.windows.includes(key)
              ? day.windows.filter((w) => w !== key)
              : day.windows.concat(key);
          }
          repaintDay(dayKey);
          markDirty();
          return;
        }

        // Windows vs exact times
        if (t.dataset.mode) {
          state.week[dayKey].mode = t.dataset.mode === "exact" ? "exact" : "windows";
          repaintDay(dayKey);
          markDirty();
          return;
        }

        // Remove a ZIP
        if (t.dataset.rmzip) {
          state.week[dayKey].zips = state.week[dayKey].zips.filter((z) => z !== t.dataset.rmzip);
          repaintDay(dayKey);
          markDirty();
          return;
        }
      }

      // Blocked dates
      if (t.id === "faBlockAdd") {
        const input = el.querySelector("#faBlockDate");
        const val = input && input.value;
        if (!val) { toast("Pick a date first"); return; }
        if (state.blockedDates.includes(val)) { toast("That day is already blocked"); return; }
        state.blockedDates.push(val);
        state.blockedDates.sort();
        input.value = "";
        repaintBlocks();
        markDirty();
        return;
      }
      if (t.dataset.rmblock) {
        state.blockedDates = state.blockedDates.filter((d) => d !== t.dataset.rmblock);
        repaintBlocks();
        markDirty();
        return;
      }

      // Save
      if (t.id === "faSave") { save(); return; }
    });

    // Working / not working toggle
    el.addEventListener("change", (ev) => {
      const cb = ev.target;
      if (cb && cb.dataset && cb.dataset.dayon) {
        const dayKey = cb.dataset.dayon;
        state.week[dayKey].on = cb.checked;
        repaintDay(dayKey);
        markDirty();
        return;
      }
      if (cb && (cb.hasAttribute("data-start") || cb.hasAttribute("data-end"))) {
        const dayEl = cb.closest("[data-day]");
        if (!dayEl) return;
        const day = state.week[dayEl.dataset.day];
        if (cb.hasAttribute("data-start")) day.start = cb.value; else day.end = cb.value;
        markDirty();
      }
    });

    // ZIP entry: enter, comma or space commits; blur commits too.
    el.addEventListener("keydown", (ev) => {
      const input = ev.target;
      if (!input || !input.dataset || !input.dataset.zipinput) return;
      if (ev.key === "Enter" || ev.key === "," || ev.key === " ") {
        ev.preventDefault();
        const dayKey = input.dataset.zipinput;
        const raw = input.value;
        // Enter on an empty box is just someone tabbing through. Say nothing.
        if (!raw.trim()) return;
        // Clear first: repainting removes this input, and a detached input still
        // fires focusout, which would re-submit the same ZIP as a duplicate.
        input.value = "";
        if (addZip(dayKey, raw)) repaintDay(dayKey, true);
        return;
      }
      if (ev.key === "Backspace" && input.value === "") {
        const dayKey = input.dataset.zipinput;
        const zips = state.week[dayKey].zips;
        if (zips.length) { zips.pop(); repaintDay(dayKey); markDirty(); }
      }
    });

    // Commit a half-typed ZIP when she taps away, but only for an input that is
    // still on the page. A detached input fires focusout too, with a stale value.
    el.addEventListener("focusout", (ev) => {
      const input = ev.target;
      if (!input || !input.dataset || !input.dataset.zipinput) return;
      if (!document.contains(input)) return;
      const raw = input.value.trim();
      if (!raw) return;
      const dayKey = input.dataset.zipinput;
      input.value = "";
      if (addZip(dayKey, raw)) repaintDay(dayKey);
    });

    el.addEventListener("input", (ev) => {
      if (ev.target && ev.target.id === "faNote") { state.note = ev.target.value; markDirty(); }
    });
  }

  async function save() {
    const btn = el.querySelector("#faSave");
    if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

    // Tidy up before writing: a day that is on but has nothing set is ambiguous.
    const problems = [];
    DAYS.forEach(([k, name]) => {
      const d = state.week[k];
      if (!d.on) return;
      if (d.mode === "windows" && !d.windows.length) problems.push(name + " has no times selected");
      if (d.mode === "exact" && (!d.start || !d.end)) problems.push(name + " needs a start and end time");
      if (d.mode === "exact" && d.start && d.end && d.start >= d.end) problems.push(name + " ends before it starts");
    });

    if (problems.length) {
      toast(problems[0]);
      if (btn) { btn.disabled = false; btn.textContent = "Save availability"; }
      return;
    }

    const payload = {
      schemaVersion: SCHEMA_VERSION,
      week: state.week,
      blockedDates: state.blockedDates,
      note: state.note,
      updatedAt: serverTimestamp(),
      updatedByUid: auth.currentUser ? auth.currentUser.uid : null,
      updatedByRole: opts.adminView ? "admin" : "contractor"
    };

    // Keep the old free-text values on the document rather than deleting them,
    // so nothing a sub typed before is ever lost.
    if (state.legacyAvailableSlots) payload.legacyAvailableSlots = state.legacyAvailableSlots;
    if (state.legacyBlockedDays) payload.legacyBlockedDays = state.legacyBlockedDays;

    try {
      await setDoc(doc(db, "users", uid, "contractorSettings", "availability"), payload, { merge: true });
      dirty = false;
      setSavedLabel("Saved just now");
      toast("Availability saved");
    } catch (err) {
      console.error("[ft-availability] save failed", err);
      toast("Could not save. Check your connection and try again.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Save availability"; }
    }
  }

  // Warn before losing edits
  window.addEventListener("beforeunload", (ev) => {
    if (!dirty) return;
    ev.preventDefault();
    ev.returnValue = "";
  });

  (async () => {
    state = await loadAvailability(uid);
    el.innerHTML = shellHtml(state, opts);
    repaintBlocks();
    setSavedLabel(state.hasStructured ? "Saved" : "");
    wire();
  })();
}

/* ============================================================
   Contractor dashboard auto-mount
   ============================================================ */

function takeOverAvailabilityPanel(uid) {
  const panel = document.getElementById("view-availability");
  if (!panel) return false;
  if (panel.dataset.ftAvail === "1") return true;

  panel.dataset.ftAvail = "1";
  mountAvailabilityEditor(panel, uid, { adminView: false });

  // The dashboard calls renderAvailability() whenever it re-renders the active
  // app, which would stomp this panel with the old text boxes. Watch for that
  // and take the panel back.
  const obs = new MutationObserver(() => {
    if (panel.querySelector("#availSlots") || panel.querySelector("#blockedDays")) {
      panel.dataset.ftAvail = "1";
      mountAvailabilityEditor(panel, uid, { adminView: false });
    }
  });
  obs.observe(panel, { childList: true });

  return true;
}

if (document.getElementById("view-availability") !== null || document.readyState !== "complete") {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    let tries = 0;
    const attempt = () => {
      if (takeOverAvailabilityPanel(user.uid)) return;
      if (++tries < 40) setTimeout(attempt, 150);
    };
    attempt();
  });
}
