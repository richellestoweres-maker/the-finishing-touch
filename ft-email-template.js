// === The Finishing Touch — shared email template ===
// One place for the business details and the branded wrapper every email
// goes inside. ft-email.js (manual sends) and ft-campaigns.js (automations)
// both import from here, so changing the address or the footer once changes
// it everywhere.
//
// NOTE: the daily Cloud Function (ftDailySend) has its own copy of emailShell
// because it runs on a server and can't import this file. If you change the
// wrapper here, change it there too.

export const SITE = "https://www.thefinishingtouch-tx.com";
export const BIZ_NAME = "The Finishing Touch";
export const BIZ_LEGAL = "The Finishing Touch is a DBA of Johnnie and Jane Boutique LLC";
export const BIZ_AREA = "Serving Galveston, Harris, and Brazoria County";
// CAN-SPAM requires a real postal address in commercial email. Fill this in.
export const BIZ_ADDRESS = "";

export const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"']/g, (c) => (
{ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
export const firstName = (s) => String(s?.name || "").trim().split(/\s+/)[0] || "there";
export const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim());

export function unsubUrl(email) {
return `${SITE}/unsubscribe.html?e=${encodeURIComponent(String(email || "").trim().toLowerCase())}`;
}

export function emailShell(innerHtml, toEmail) {
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
export function bodyFromText(text, sub) {
return String(text || "")
.replace(/\{\{\s*name\s*\}\}/gi, firstName(sub))
.split(/\n{2,}/)
.map((p) => `<p style="margin:0 0 14px 0;">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
.join("");
}

// a big serif opening line, then normal paragraphs — used by the holiday drafts
export function headline(text) {
return `<p style="margin:0 0 14px 0;font-family:Georgia,serif;font-size:20px;color:#2b2622;">${esc(text)}</p>`;
}

export function button(label, href) {
return `<p style="margin:0 0 18px 0;"><a href="${href}" style="display:inline-block;background:#2b2622;color:#fffdf9;text-decoration:none;padding:11px 22px;border-radius:999px;font-size:14px;">${esc(label)}</a></p>`;
}

export const CONTACT = `${SITE}/contact.html`;

// The one place a message becomes HTML: opening line, paragraphs, button.
// `c` is a campaign-shaped object: { subject, headline, body, ctaLabel, ctaHref }
export function renderMessage(c, sub) {
const h = c.headline ? headline(String(c.headline).replace(/\{\{\s*name\s*\}\}/gi, firstName(sub))) : "";
const b = bodyFromText(c.body, sub);
const btn = c.ctaLabel ? button(c.ctaLabel, c.ctaHref || CONTACT) : "";
return emailShell(h + b + btn, sub?.email);
}

// Used until she saves her own wording in the Automations tab.
export const DEFAULT_BIRTHDAY = {
enabled: true,
subject: "Happy birthday from The Finishing Touch 🎂",
headline: "Happy birthday, {{name}}!",
body: `Everyone here at The Finishing Touch hopes your day is a good one — and that you get to spend it in a home that feels calm, cared for, and completely yours.

As a little gift, here's 15% off any service booked this month. Just mention your birthday when you reach out and we'll take care of the rest.

Warmly,
Richelle & the Finishing Touch team`,
ctaLabel: "Book your birthday treat",
ctaHref: CONTACT
};

// ---------- date rules shared by the campaign editor and the daily function ----------

// Anonymous Gregorian algorithm. Returns a Date for Easter Sunday in `year`.
export function easterSunday(year) {
const a = year % 19, b = Math.floor(year / 100), c = year % 100;
const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
const m = Math.floor((a + 11 * h + 22 * l) / 451);
const month = Math.floor((h + l - 7 * m + 114) / 31);
const day = ((h + l - 7 * m + 114) % 31) + 1;
return new Date(year, month - 1, day);
}

// nth weekday of a month, e.g. nthWeekday(2026, 5, 0, 2) = 2nd Sunday of May
export function nthWeekday(year, month, weekday, nth) {
const first = new Date(year, month - 1, 1);
const shift = (weekday - first.getDay() + 7) % 7;
return new Date(year, month - 1, 1 + shift + (nth - 1) * 7);
}

// Resolve a campaign's schedule to an actual Date in a given year.
export function campaignDate(c, year) {
let base;
if (c.scheduleType === "easter") base = easterSunday(year);
else if (c.scheduleType === "nth") base = nthWeekday(year, Number(c.month), Number(c.weekday), Number(c.nth));
else base = new Date(year, Number(c.month) - 1, Number(c.day));
if (Number(c.offsetDays)) base.setDate(base.getDate() + Number(c.offsetDays));
return base;
}

export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function prettyDate(d) {
return `${MONTHS_SHORT[d.getMonth() + 1]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Human description of when a campaign fires, e.g. "10 days before the 2nd Sunday of May"
export function scheduleText(c) {
const off = Number(c.offsetDays) || 0;
const lead = off < 0 ? `${Math.abs(off)} days before ` : (off > 0 ? `${off} days after ` : "");
if (c.scheduleType === "easter") return `${lead}Easter Sunday`;
if (c.scheduleType === "nth") {
const ord = ["", "1st", "2nd", "3rd", "4th", "5th"][Number(c.nth)] || `${c.nth}th`;
return `${lead}the ${ord} ${WEEKDAYS[Number(c.weekday)]} of ${MONTHS[Number(c.month)]}`;
}
return `${lead}${MONTHS[Number(c.month)]} ${c.day}`;
}
