// === Ivy: Gmail and Google Calendar ===
//
// Read only. Ivy looks at the business inbox and calendar so the morning
// briefing can say what is waiting, but she never sends, deletes or changes
// anything there. Replies still go out from Richelle.
//
// How the connection works, in plain terms:
//   1. Richelle opens /google/connect once while signed in as the business
//      Google account and clicks Allow.
//   2. Google hands Ivy a long lived "refresh token". That is a key for these
//      two read only permissions and nothing else. It is not a password, and
//      Richelle can cancel it any time at myaccount.google.com/permissions.
//   3. Ivy keeps it in Firestore (ivyPrivate/google), which only the server
//      can read.
//
// Environment she expects:
//   GOOGLE_CLIENT_ID      plain value, from the OAuth client in Google Cloud
//   GOOGLE_CLIENT_SECRET  from Secret Manager: ivy-google-client-secret

import { db, FieldValue } from "./store.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email"
];

const TOKEN_DOC = db.collection("ivyPrivate").doc("google");

function clientId() { return process.env.GOOGLE_CLIENT_ID || ""; }
function clientSecret() { return process.env.GOOGLE_CLIENT_SECRET || ""; }

export function googleConfigured() {
  return Boolean(clientId() && clientSecret());
}

/** The page Google sends Richelle to, to click Allow. */
export function consentUrl(redirectUri, state) {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google always returns a refresh token even on a reconnect.
    prompt: "consent",
    include_granted_scopes: "true",
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Trade the one time code for the refresh token, and keep it. */
export async function finishConnect(code, redirectUri) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `Google said ${res.status}`);
  if (!data.refresh_token) {
    throw new Error("Google did not send a refresh token. Remove Ivy at myaccount.google.com/permissions and connect again.");
  }

  // Which account was connected, so the briefing can tell her own replies apart.
  let email = "";
  try {
    const who = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` }
    }).then((r) => r.json());
    email = who.email || "";
  } catch { /* not essential */ }

  await TOKEN_DOC.set({
    refreshToken: data.refresh_token,
    email,
    scopes: data.scope || SCOPES.join(" "),
    connectedAt: FieldValue.serverTimestamp()
  });
  cachedAccess = null;
  return { email };
}

let cachedAccess = null; // { token, expires, email }

async function accessToken() {
  if (cachedAccess && cachedAccess.expires > Date.now() + 60_000) return cachedAccess;
  if (!googleConfigured()) throw new Error("Google is not set up yet (GOOGLE_CLIENT_ID or secret missing)");

  const snap = await TOKEN_DOC.get();
  const saved = snap.exists ? snap.data() : null;
  if (!saved || !saved.refreshToken) throw new Error("Google is not connected yet. Open /google/connect once.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: saved.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await res.json();
  if (!res.ok) {
    // invalid_grant means the connection was cancelled or expired. Say so plainly.
    if (data.error === "invalid_grant") {
      throw new Error("The Google connection was cancelled or expired. Open /google/connect again.");
    }
    throw new Error(data.error_description || data.error || `Google said ${res.status}`);
  }
  cachedAccess = {
    token: data.access_token,
    expires: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    email: saved.email || ""
  };
  return cachedAccess;
}

async function gget(url) {
  const { token } = await accessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Google said ${res.status}`);
  return data;
}

/* ------------------------------------------------------------------
   Gmail
   ------------------------------------------------------------------ */

function header(msg, name) {
  const h = (msg.payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

function addressOf(from) {
  const m = String(from).match(/<([^>]+)>/);
  return (m ? m[1] : String(from)).trim().toLowerCase();
}

function nameOf(from) {
  const m = String(from).match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : addressOf(from);
}

/**
 * Real people waiting on a reply: inbox threads from the last few days where
 * the newest message is not from the business itself. Newsletters, promotions
 * and automatic notices are left out by Gmail's own categories.
 */
export async function inboxNeedingReply({ days = 4, max = 25 } = {}) {
  const me = (await accessToken()).email.toLowerCase();
  const q = `in:inbox newer_than:${days}d -category:promotions -category:social -category:forums`;
  const list = await gget(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${max}&q=${encodeURIComponent(q)}`
  );

  const out = [];
  for (const t of list.threads || []) {
    const thread = await gget(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata` +
      `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
    );
    const msgs = thread.messages || [];
    const last = msgs[msgs.length - 1];
    if (!last) continue;
    const from = header(last, "From");
    const fromAddr = addressOf(from);
    if (me && fromAddr === me) continue; // she already answered

    out.push({
      threadId: t.id,
      from: nameOf(from),
      fromAddress: fromAddr,
      subject: header(msgs[0], "Subject") || "(no subject)",
      snippet: (last.snippet || "").slice(0, 240),
      date: new Date(Number(last.internalDate || 0)).toISOString(),
      messages: msgs.length,
      unread: (last.labelIds || []).includes("UNREAD"),
      automated: /no-?reply|notifications?@|mailer|@squareup\.com|@stripe\.com|@formspree\.io/i.test(fromAddr),
      link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(me)}#all/${t.id}`
    });
  }
  return out;
}

/** How many reply drafts are sitting in Gmail waiting for her to send. */
export async function draftsWaiting() {
  const data = await gget("https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=50");
  return (data.drafts || []).length;
}

/* ------------------------------------------------------------------
   Google Calendar
   ------------------------------------------------------------------ */

/** Every event between two times, across every calendar the account shows. */
export async function eventsBetween(startIso, endIso) {
  const cals = await gget("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50");
  const events = [];
  for (const cal of cals.items || []) {
    if (cal.selected === false || cal.hidden) continue;
    const p = new URLSearchParams({
      timeMin: startIso, timeMax: endIso, singleEvents: "true", orderBy: "startTime", maxResults: "50"
    });
    try {
      const data = await gget(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${p}`
      );
      for (const e of data.items || []) {
        if (e.status === "cancelled") continue;
        events.push({
          calendar: cal.summaryOverride || cal.summary || cal.id,
          primary: Boolean(cal.primary),
          title: e.summary || "(no title)",
          start: e.start?.dateTime || e.start?.date || "",
          end: e.end?.dateTime || e.end?.date || "",
          allDay: Boolean(e.start?.date && !e.start?.dateTime),
          location: e.location || ""
        });
      }
    } catch (err) {
      console.error("[ivy] calendar read failed for", cal.id, err.message);
    }
  }
  events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return events;
}

export async function googleCheck() {
  if (!googleConfigured()) return { ok: false, detail: "not set up" };
  try {
    const t = await accessToken();
    return { ok: true, detail: `connected as ${t.email || "unknown"}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}
