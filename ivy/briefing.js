// === Ivy: the morning briefing ===
//
// Once each weekday morning Ivy looks at everything the business runs on and
// tells Richelle, in one short text, what actually needs her today. The full
// version lands on the Briefing tab of the admin dashboard.
//
// Every source is checked on its own. If one is down or not connected yet,
// the briefing still goes out and says plainly what it could not check, so a
// quiet briefing never quietly means "I couldn't look".
//
// Read only throughout. Ivy notices and reminds. She does not send, pay,
// book or change anything from here.

import Anthropic from "@anthropic-ai/sdk";
import { db, FieldValue, getKnowledge, listPendingDrafts, listOpenThreads } from "./store.js";
import { inboxNeedingReply, draftsWaiting, eventsBetween, googleConfigured } from "./google.js";
import { bookingsBetween, openInvoices, squareConfigured } from "./square.js";

const TZ = "America/Chicago";
const MODEL = process.env.BRIEFING_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://www.thefinishingtouch-tx.com/admin-dashboard.html";

/* ------------------------------------------------------------------
   Dates in Richelle's time zone
   ------------------------------------------------------------------ */

function partsIn(date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

/** Midnight in Chicago, a given number of days from today, as a Date. */
export function chicagoMidnight(daysFromToday = 0, now = new Date()) {
  const t = partsIn(now);
  const guess = Date.UTC(t.y, t.m - 1, t.d + daysFromToday, 12); // noon avoids DST edges
  const g = partsIn(new Date(guess));
  const offset = Date.UTC(g.y, g.m - 1, g.d, g.h, g.min, g.s) - guess;
  return new Date(Date.UTC(g.y, g.m - 1, g.d) - offset);
}

function ymd(date) {
  const p = partsIn(date);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function clock(iso) {
  if (!iso || !iso.includes("T")) return "all day";
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

function dayName(iso) {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
}

function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v._seconds) return v._seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/* ------------------------------------------------------------------
   Gathering. One function per source, each allowed to fail alone.
   ------------------------------------------------------------------ */

async function fromWebsite() {
  // Single field queries only, sorted in memory, so no Firestore index is
  // ever needed. A missing index is exactly the kind of silent failure that
  // would make the briefing go quiet.
  const [intakes, openJobs, quotes] = await Promise.all([
    db.collection("intakeRequests").orderBy("createdAt", "desc").limit(60).get(),
    db.collection("jobs").where("status", "==", "open").limit(50).get(),
    db.collection("quoteRequests").limit(100).get().catch(() => ({ docs: [] }))
  ]);

  const newIntakes = intakes.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => {
      const st = r.intakeStatus || r.status || "new";
      return st === "new" || st === "submitted";
    })
    .map((r) => ({
      client: r.clientName || "",
      service: r.serviceLabel || r.serviceType || "",
      summary: String(r.REQUEST_SUMMARY_CLEAR || r.summary || "").slice(0, 200),
      received: new Date(toMillis(r.createdAt)).toISOString(),
      daysWaiting: Math.floor((Date.now() - toMillis(r.createdAt)) / 86400000)
    }));

  const unassignedJobs = openJobs.docs.map((d) => {
    const j = d.data();
    return {
      client: j.clientName || "",
      service: j.serviceLabel || j.serviceType || "",
      summary: String(j.summary || "").slice(0, 160)
    };
  });

  const allQuotes = quotes.docs.map((d) => d.data());
  const subQuotesToReview = allQuotes
    .filter((q) => q.status === "sub_quoted")
    .map((q) => ({ service: q.serviceLabel || q.serviceType || "", area: q.area || "", subRate: q.subRate || null }));
  const waitingOnSubQuotes = allQuotes.filter((q) => q.status === "awaiting_sub_quote").length;

  return { newIntakes, unassignedJobs, subQuotesToReview, waitingOnSubQuotes };
}

async function fromIvy() {
  const since = new Date(Date.now() - 36 * 3600 * 1000);
  const [drafts, threads, beside] = await Promise.all([
    listPendingDrafts(20),
    listOpenThreads(),
    db.collection("besideEvents").where("receivedAt", ">=", since).limit(50).get()
      .catch(() => ({ docs: [] }))
  ]);
  return {
    approvalsWaiting: drafts.map((d) => ({
      to: d.toName || d.toPhone || "",
      why: d.reason || "",
      draft: String(d.bodyEnglish || d.body || "").slice(0, 160)
    })),
    openConversations: threads.map((t) => ({
      who: t.personName || t.personPhone || "",
      about: t.summary || "",
      waitingOn: t.waitingOn || ""
    })),
    callsAndMessages: beside.docs
      .map((d) => d.data())
      .filter((e) => e.ivy && e.ivy.needs_richelle && e.direction !== "outbound")
      .map((e) => ({
        who: e.name || e.phone || "",
        kind: e.event || "call",
        summary: String(e.ivy.summary || "").slice(0, 200),
        next: e.ivy.for_richelle || ""
      }))
  };
}

async function fromGmail() {
  const [threads, drafts] = await Promise.all([inboxNeedingReply({ days: 4 }), draftsWaiting()]);
  return {
    peopleWaitingOnReply: threads.filter((t) => !t.automated).map((t) => ({
      from: t.from, subject: t.subject, snippet: t.snippet, received: t.date, unread: t.unread
    })),
    automatedNotices: threads.filter((t) => t.automated).map((t) => ({
      from: t.from, subject: t.subject, snippet: t.snippet.slice(0, 140)
    })),
    replyDraftsReadyToSend: drafts
  };
}

async function fromCalendar(now) {
  const start = chicagoMidnight(0, now).toISOString();
  const end = chicagoMidnight(2, now).toISOString();
  const events = await eventsBetween(start, end);
  const today = ymd(now);
  const tomorrow = ymd(chicagoMidnight(1, now));
  // An all day event's start is a bare date, which must not be read as UTC
  // midnight, or it lands on the evening before in Texas.
  const dayOf = (e) => (e.allDay ? String(e.start).slice(0, 10) : ymd(new Date(e.start)));
  return {
    today: events.filter((e) => dayOf(e) === today)
      .map((e) => ({ time: clock(e.start), title: e.title, calendar: e.calendar, location: e.location })),
    tomorrow: events.filter((e) => dayOf(e) === tomorrow)
      .map((e) => ({ time: clock(e.start), title: e.title, calendar: e.calendar }))
  };
}

async function fromSquare(now) {
  const start = chicagoMidnight(0, now).toISOString();
  const end = chicagoMidnight(8, now).toISOString();
  const [bookings, invoices] = await Promise.all([
    bookingsBetween(start, end),
    openInvoices(ymd(now))
  ]);
  const today = ymd(now);
  return {
    jobsToday: bookings.filter((b) => ymd(new Date(b.start)) === today)
      .map((b) => ({ time: clock(b.start), client: b.client, service: b.service, note: b.note })),
    jobsNextSevenDays: bookings.filter((b) => ymd(new Date(b.start)) !== today)
      .map((b) => ({ day: dayName(b.start), time: clock(b.start), client: b.client, service: b.service })),
    unpaidInvoices: invoices.unpaid,
    unsentInvoiceDrafts: invoices.drafts
  };
}

function deadlines(knowledge, now) {
  const list = Array.isArray(knowledge.deadlines) ? knowledge.deadlines : [];
  const today = Date.parse(ymd(now));
  return list
    .map((d) => ({ ...d, daysLeft: Math.round((Date.parse(d.date) - today) / 86400000) }))
    .filter((d) => d.daysLeft >= 0 && d.daysLeft <= (Number(d.warnDays) || 14))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map((d) => ({ date: d.date, what: d.what, daysLeft: d.daysLeft }));
}

async function attempt(name, fn, ready = true, notReadyDetail = "not connected yet") {
  if (!ready) return { name, ok: false, detail: notReadyDetail, data: null };
  try {
    return { name, ok: true, detail: "checked", data: await fn() };
  } catch (err) {
    console.error(`[ivy] briefing could not read ${name}:`, err.message);
    return { name, ok: false, detail: String(err.message).slice(0, 200), data: null };
  }
}

export async function gather(now = new Date()) {
  const knowledge = await getKnowledge().catch(() => ({}));
  const results = await Promise.all([
    attempt("Website (intakes, jobs, quotes)", fromWebsite),
    attempt("Ivy (texts, calls, approvals)", fromIvy),
    attempt("Gmail", fromGmail, googleConfigured()),
    attempt("Google Calendar", () => fromCalendar(now), googleConfigured()),
    attempt("Square", () => fromSquare(now), squareConfigured())
  ]);

  const facts = {
    today: new Date(now).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    upcomingDeadlines: deadlines(knowledge, now)
  };
  for (const r of results) if (r.ok) facts[r.name] = r.data;
  const sources = results.map((r) => ({ name: r.name, ok: r.ok, detail: r.detail }));
  return { facts, sources };
}

/* ------------------------------------------------------------------
   Writing it up
   ------------------------------------------------------------------ */

const BRIEF_TOOL = {
  name: "brief",
  description: "Richelle's morning briefing for The Finishing Touch.",
  input_schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "One warm sentence naming the shape of her day or the one thing that matters most."
      },
      top: {
        type: "array",
        description: "What actually needs Richelle today, most important first, at most 6. Leave out anything that does not.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short, in plain words, such as: Reply to Kris about Thursday" },
            why: { type: "string", description: "One sentence: what it is and why today." },
            where: { type: "string", description: "Where to do it, such as Gmail, Square, Ivy texts, dashboard Intake Inbox." }
          },
          required: ["title", "why", "where"]
        }
      },
      schedule: {
        type: "array",
        description: "Today's jobs and calendar events in time order.",
        items: {
          type: "object",
          properties: { time: { type: "string" }, what: { type: "string" } },
          required: ["time", "what"]
        }
      },
      waiting_on_others: {
        type: "array", items: { type: "string" },
        description: "Things in motion where someone else owes the next step. One short line each."
      },
      fyi: {
        type: "array", items: { type: "string" },
        description: "Worth knowing but no action today: this week's jobs, tomorrow, a deadline countdown. One short line each."
      },
      sms: {
        type: "string",
        description: "The text message version, under 600 characters. Opens with 'Good morning Richelle.' then a numbered list of the top items, then today's jobs in one line. No links."
      }
    },
    required: ["headline", "top", "schedule", "waiting_on_others", "fyi", "sms"]
  }
};

const SYSTEM = [
  "You are Ivy, the admin assistant for The Finishing Touch, a luxury interior services business on the Texas Gulf Coast",
  "(cleaning, organizing, staging, interior design and holiday decorating). Richelle Stowe owns it and runs it solo while",
  "raising a young son. She has a lot on her plate and forgets things, which is exactly why this briefing exists.",
  "",
  "You are given what Ivy found this morning, as JSON. Turn it into her briefing.",
  "",
  "How to decide what goes in 'top':",
  "- Real people waiting on a reply (clients, prospects, contractors, general contractors) come first, oldest first.",
  "- New intake forms nobody has reviewed. Every day an intake sits is a client who may book someone else.",
  "- Ivy's drafts waiting for her Y or N, since a client is on hold until she answers.",
  "- Overdue client invoices, and invoice drafts never sent.",
  "- Subcontractor quotes waiting for her approval.",
  "- Booking deadlines within a few days, framed as what to post or push today.",
  "- Anything on today's calendar that needs preparing.",
  "Leave out promotions, newsletters and routine automatic notices. A Square 'payment received' is good news, not a task.",
  "",
  "Business facts that change how you read things:",
  "- Clients are invoiced through Square. The subcontractor Maggie (Clean Fast House Cleaning) is paid through Square",
  "  Bill Pay, and Maggie never sends invoices, so never say Richelle is waiting on an invoice from Maggie.",
  "- The business works Monday through Friday only.",
  "- Ivy never decides money or scheduling. Flag those for Richelle; do not resolve them.",
  "",
  "Writing rules, all of them firm:",
  "- Never use em dashes, en dashes or any dash as punctuation or as a separator. Use commas, periods or colons.",
  "- Plain, warm, brief. Write like a sharp assistant handing her the day, not a report.",
  "- Only use what is in the JSON. Never invent a client, a time, an amount or a task.",
  "- Use first names and last initials the way they appear.",
  "- If a source is listed as not checked, add one fyi line saying what could not be checked, so silence never",
  "  looks like 'all clear'.",
  "- If nothing needs her, say so warmly in the headline and leave 'top' empty."
].join("\n");

function noDashes(s) {
  return String(s || "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+-\s+/g, ", ")
    .replace(/,\s*,/g, ",")
    .trim();
}

function scrub(brief) {
  return {
    headline: noDashes(brief.headline),
    top: (brief.top || []).slice(0, 6).map((t) => ({ title: noDashes(t.title), why: noDashes(t.why), where: noDashes(t.where) })),
    schedule: (brief.schedule || []).map((s) => ({ time: noDashes(s.time), what: noDashes(s.what) })),
    waiting_on_others: (brief.waiting_on_others || []).map(noDashes),
    fyi: (brief.fyi || []).map(noDashes),
    sms: noDashes(brief.sms).slice(0, 900)
  };
}

let anthropic = null;
function client() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

async function writeWithClaude(facts, sources) {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [BRIEF_TOOL],
    tool_choice: { type: "tool", name: "brief" },
    messages: [{
      role: "user",
      content: `WHAT IVY FOUND THIS MORNING:\n${JSON.stringify(facts, null, 1)}\n\nSOURCES:\n${JSON.stringify(sources)}`
    }]
  });
  const call = res.content.find((c) => c.type === "tool_use");
  if (!call) throw new Error("Claude did not return a briefing");
  return scrub(call.input || {});
}

/**
 * If Claude is unreachable the briefing still goes out, built plainly from the
 * counts. A dull briefing is far better than none on the morning it matters.
 */
function writePlain(facts, sources) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const top = [];
  const w = facts["Website (intakes, jobs, quotes)"];
  const i = facts["Ivy (texts, calls, approvals)"];
  const g = facts.Gmail;
  const s = facts.Square;
  if (g?.peopleWaitingOnReply?.length) top.push({ title: `${n(g.peopleWaitingOnReply.length, "email", "emails")} waiting on a reply`, why: g.peopleWaitingOnReply.slice(0, 3).map((t) => t.from).join(", "), where: "Gmail" });
  if (w?.newIntakes?.length) top.push({ title: n(w.newIntakes.length, "new intake form", "new intake forms"), why: w.newIntakes.slice(0, 3).map((r) => r.client || r.service).join(", "), where: "Dashboard, Intake Inbox" });
  if (i?.approvalsWaiting?.length) top.push({ title: `${n(i.approvalsWaiting.length, "Ivy draft needs", "Ivy drafts need")} your Y or N`, why: i.approvalsWaiting.map((d) => d.to).join(", "), where: "Ivy texts" });
  if (s?.unpaidInvoices?.some((x) => x.daysOverdue > 0)) top.push({ title: "Overdue invoices", why: s.unpaidInvoices.filter((x) => x.daysOverdue > 0).map((x) => `${x.client} ${x.amount}`).join(", "), where: "Square" });
  if (w?.subQuotesToReview?.length) top.push({ title: `${n(w.subQuotesToReview.length, "sub quote", "sub quotes")} to review`, why: "Waiting on your approval.", where: "Dashboard, Quote Queue" });
  for (const d of facts.upcomingDeadlines || []) top.push({ title: d.what, why: `${d.daysLeft} days left.`, where: "Marketing" });

  const schedule = (s?.jobsToday || []).map((j) => ({ time: j.time, what: `${j.client} ${j.service}`.trim() }))
    .concat((facts["Google Calendar"]?.today || []).map((e) => ({ time: e.time, what: e.title })));
  const fyi = sources.filter((x) => !x.ok).map((x) => `Couldn't check ${x.name}: ${x.detail}`);

  const sms = ["Good morning Richelle."]
    .concat(top.slice(0, 5).map((t, n) => `${n + 1}. ${t.title}`))
    .concat(schedule.length ? [`Today: ${schedule.map((x) => `${x.time} ${x.what}`).join("; ")}`] : [])
    .join("\n");

  return scrub({
    headline: top.length ? `${top.length} things need you today.` : "Nothing urgent this morning.",
    top, schedule, waiting_on_others: [], fyi, sms
  });
}

/* ------------------------------------------------------------------
   Running it
   ------------------------------------------------------------------ */

const LATEST_DOC = db.collection("settings").doc("briefing");

/**
 * Build today's briefing and save it for the dashboard.
 * Returns the briefing plus the text to send. Sending is the caller's job.
 */
export async function runBriefing({ trigger = "schedule", now = new Date() } = {}) {
  const { facts, sources } = await gather(now);

  let brief;
  let writer = "claude";
  try {
    brief = await writeWithClaude(facts, sources);
  } catch (err) {
    console.error("[ivy] briefing fell back to plain:", err.message);
    brief = writePlain(facts, sources);
    writer = "plain";
    brief.fyi.push(`Ivy wrote this one plainly because Claude was unreachable: ${String(err.message).slice(0, 120)}`);
  }

  const missing = sources.filter((x) => !x.ok).map((x) => x.name);
  let sms = brief.sms || brief.headline;
  if (missing.length) sms += `\nCouldn't check: ${missing.join(", ")}.`;
  sms += `\nFull list: ${DASHBOARD_URL}`;

  const record = {
    ...brief,
    smsSent: sms,
    sources,
    writer,
    trigger,
    dateKey: ymd(now),
    dateLabel: facts.today,
    generatedAt: FieldValue.serverTimestamp()
  };

  await LATEST_DOC.set(record);
  await db.collection("ivyBriefings").doc(ymd(now)).set(record).catch((err) =>
    console.error("[ivy] could not keep briefing history:", err.message));

  return { brief, sms, sources, writer };
}
