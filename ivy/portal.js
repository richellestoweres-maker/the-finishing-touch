// === Ivy: the client portal ===
//
// Everything the client dashboard asks Ivy for. The browser proves who the
// client is with the Firebase sign in it already has, and every endpoint only
// ever reads or writes that one client's own records.
//
//   GET  /portal/profile        their saved details
//   POST /portal/profile        save their details
//   GET  /portal/messages       their conversation with Ivy
//   POST /portal/messages       send Ivy a message from the portal
//   GET  /portal/invoices       their Square invoices
//   POST /portal/request-alert  tell Richelle a scheduling request just came in
//
// The conversation is the same one Ivy keeps for texts. A client whose
// profile has their mobile number shares one thread across text and portal,
// so Ivy remembers Monday's text when they write in the portal on Thursday.

import {
  db, FieldValue, getKnowledge, appendMessage, recentMessages, createDraft,
  listPendingDrafts, listOpenThreads, openThread, rememberContact
} from "./store.js";
import { decide } from "./brain.js";
import { invoicesForCustomer } from "./square.js";
import { normalizePhone, prettyPhone } from "./sms.js";

const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyCfMOyKa2uT6BuMiST95Ry96Z7FUH_vYgQ";
const PORTAL_ORIGINS = new Set([
  "https://www.thefinishingtouch-tx.com",
  "https://thefinishingtouch-tx.com"
]);

// The only profile fields a client may set. Anything else in the request is
// ignored, so nobody can promote themselves or switch VIP on from the browser.
const TEXT_FIELDS = {
  fullName: 80,
  phone: 30,
  street: 120,
  unit: 40,
  city: 60,
  zip: 10,
  homeSize: 40,
  accessNotes: 600,
  parking: 300,
  pets: 300,
  preferences: 800,
  allergies: 300,
  birthday: 10
};
const CONTACT_PREFS = new Set(["text", "email", "call", "portal"]);

/** Who is signed in, from the Firebase ID token the browser sends. */
async function signedInUser(req) {
  const m = String(req.header("Authorization") || "").match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: m[1] })
  });
  if (!r.ok) return null;
  const data = await r.json();
  const u = (data.users || [])[0];
  if (!u || !u.localId) return null;
  return { uid: u.localId, email: String(u.email || "").toLowerCase() };
}

async function userDoc(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : {};
}

/** Text thread key when we know their mobile, otherwise a portal only key. */
function conversationKeyFor(uid, data) {
  return normalizePhone(data.phone || "") || `portal:${uid}`;
}

function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v._seconds) return v._seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function registerPortal(app, { notifyOwner }) {
  app.use("/portal", (req, res, next) => {
    const origin = req.header("Origin") || "";
    if (PORTAL_ORIGINS.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  // Every portal route needs a signed in user.
  app.use("/portal", async (req, res, next) => {
    try {
      req.portalUser = await signedInUser(req);
    } catch { req.portalUser = null; }
    if (!req.portalUser) return res.status(401).json({ ok: false, error: "Please sign in again." });
    next();
  });

  /* ---------------- Profile ---------------- */

  app.get("/portal/profile", async (req, res) => {
    try {
      const d = await userDoc(req.portalUser.uid);
      const p = d.profile || {};
      const out = {};
      for (const k of Object.keys(TEXT_FIELDS)) out[k] = p[k] || "";
      out.fullName = p.fullName || d.fullName || d.displayName || "";
      out.phone = p.phone || d.phone || "";
      out.contactPref = p.contactPref || "";
      out.vip = Boolean(d.vip);
      out.vipSince = millis(d.vipSince) || null;
      res.json({ ok: true, email: req.portalUser.email, profile: out });
    } catch (err) {
      console.error("[ivy] portal profile read failed:", err);
      res.status(500).json({ ok: false, error: "Could not load your profile." });
    }
  });

  app.post("/portal/profile", async (req, res) => {
    const { uid, email } = req.portalUser;
    const body = req.body || {};
    const profile = {};
    for (const [k, max] of Object.entries(TEXT_FIELDS)) {
      if (body[k] != null) profile[k] = String(body[k]).trim().slice(0, max);
    }
    if (profile.birthday && !/^\d{2}-\d{2}$/.test(profile.birthday)) profile.birthday = "";
    if (body.contactPref != null) {
      profile.contactPref = CONTACT_PREFS.has(body.contactPref) ? body.contactPref : "";
    }
    const phone = normalizePhone(profile.phone || "");
    if (profile.phone && phone.replace(/\D/g, "").length < 11) {
      return res.status(400).json({ ok: false, error: "That phone number looks short. Please include the area code." });
    }

    try {
      const patch = {
        profile: { ...profile, updatedAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp()
      };
      if (profile.fullName) patch.fullName = profile.fullName;
      if (profile.phone != null) patch.phone = phone;
      await db.collection("users").doc(uid).set(patch, { merge: true });

      // Now Ivy knows this number belongs to this client, so their texts and
      // their portal messages land in the same conversation.
      if (phone) {
        await rememberContact(phone, {
          kind: "client", uid, email, name: profile.fullName || ""
        });
        // Carry any portal only messages over to the shared thread.
        await mergeThreads(`portal:${uid}`, phone);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[ivy] portal profile save failed:", err);
      res.status(500).json({ ok: false, error: "Could not save just now. Please try again." });
    }
  });

  /* ---------------- Messages ---------------- */

  app.get("/portal/messages", async (req, res) => {
    try {
      const d = await userDoc(req.portalUser.uid);
      const key = conversationKeyFor(req.portalUser.uid, d);
      const list = await recentMessages(key, 60);
      res.json({
        ok: true,
        messages: list
          .filter((m) => m.body)
          .map((m) => ({
            from: m.direction === "in" ? "me" : "ivy",
            body: m.body,
            channel: m.channel || "sms",
            at: millis(m.at)
          }))
      });
    } catch (err) {
      console.error("[ivy] portal messages read failed:", err);
      res.status(500).json({ ok: false, error: "Could not load messages." });
    }
  });

  app.post("/portal/messages", async (req, res) => {
    const { uid, email } = req.portalUser;
    const text = String((req.body || {}).text || "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ ok: false, error: "Type a message first." });

    let key = "";
    let name = "";
    try {
      const d = await userDoc(uid);
      key = conversationKeyFor(uid, d);
      name = (d.profile && d.profile.fullName) || d.fullName || d.displayName || "";
      const person = { kind: "client", key, uid, name, email };

      const [knowledge, history, openThreads] = await Promise.all([
        getKnowledge(), recentMessages(key, 16), listOpenThreads(key)
      ]);
      const outcome = await decide({ knowledge, person, history, incoming: text, openThreads, channel: "portal" });
      const lang = outcome.language || "en";
      const foreign = lang !== "en";

      await appendMessage(key, {
        direction: "in", channel: "portal", body: text, from: email,
        language: lang, englishText: outcome.incoming_english || ""
      });
      await db.collection("conversations").doc(key).set({ portalUid: uid, portalEmail: email }, { merge: true });

      const who = name ? `${name} (portal)` : `${email} (portal)`;

      if (outcome.mode === "send" && outcome.message) {
        await appendMessage(key, {
          direction: "out", channel: "portal", body: outcome.message,
          language: lang, englishText: outcome.message_english || ""
        });
        if (foreign) {
          await notifyOwner(
            `Ivy handled this in the portal in ${lang}. English copy:\n` +
            `${who} said: "${(outcome.incoming_english || text).slice(0, 300)}"\n` +
            `Ivy replied: "${(outcome.message_english || outcome.message).slice(0, 300)}"`
          );
        }
        return res.json({ ok: true, reply: outcome.message });
      }

      // Needs Richelle. Answer the client now so they are not left waiting,
      // then put the real reply in front of her.
      const holding = outcome.holding_reply ||
        "Thanks so much! Let me check with Richelle and I'll be right back with you here.";
      await appendMessage(key, {
        direction: "out", channel: "portal", body: holding, meta: { holding: true },
        language: lang, englishText: outcome.holding_reply_english || ""
      });

      const { id } = await createDraft({
        toPhone: key.startsWith("+") ? key : "",
        toName: name || email,
        body: outcome.message || "",
        reason: outcome.reason || "needs your call",
        conversationKey: key,
        incoming: text,
        language: lang,
        bodyEnglish: outcome.message_english || "",
        incomingEnglish: outcome.incoming_english || "",
        noteForRichelle: outcome.note_for_richelle || "",
        channel: "portal"
      });

      if (!openThreads.length) {
        try {
          await openThread({
            conversationKey: key, personPhone: key.startsWith("+") ? key : "",
            personName: name || email, summary: outcome.reason || text.slice(0, 80), waitingOn: "richelle"
          });
        } catch (err) { console.error("[ivy] could not open a thread:", err.message); }
      }

      const waiting = await listPendingDrafts();
      const position = waiting.findIndex((dft) => dft.id === id) + 1;
      const howToAnswer = waiting.length <= 1
        ? "Reply Y to send it, N to bin it."
        : `${waiting.length} are waiting now. Reply Y${position || waiting.length} to send this one, N${position || waiting.length} to bin it.`;

      await notifyOwner(
        `Ivy needs you. ${who} said: "${(outcome.incoming_english || text).slice(0, 160)}"\n` +
        `Why: ${outcome.reason || "not sure"}\n` +
        (outcome.note_for_richelle ? `Ivy says: ${outcome.note_for_richelle.slice(0, 200)}\n` : "") +
        `To send them in the portal: "${(outcome.message_english || outcome.message || "(none)").slice(0, 400)}"\n` +
        howToAnswer
      );
      return res.json({ ok: true, reply: holding, waitingOnRichelle: true });
    } catch (err) {
      console.error("[ivy] portal message failed:", err);
      const isAuth = /401|authentication|invalid.*api.*key|expired/i.test(err.message || "");
      await notifyOwner(
        isAuth
          ? `Ivy's Claude API key is not working, so a portal message from ${name || email} went unanswered. Check the key in Secret Manager.`
          : `Ivy hit an error on a portal message from ${name || email}: ${String(err.message).slice(0, 200)}`
      );
      if (key) {
        try {
          await appendMessage(key, { direction: "in", channel: "portal", body: text, from: email });
        } catch { /* already reported */ }
      }
      return res.status(500).json({ ok: false, error: "Ivy could not answer just now, but Richelle has your message and will reply." });
    }
  });

  /* ---------------- Invoices ---------------- */

  app.get("/portal/invoices", async (req, res) => {
    try {
      const d = await userDoc(req.portalUser.uid);
      const emails = [req.portalUser.email, d.email, d.profile && d.profile.billingEmail]
        .map((e) => String(e || "").trim().toLowerCase()).filter(Boolean);
      const phone = normalizePhone(d.phone || "");
      const invoices = await invoicesForCustomer({ emails: [...new Set(emails)], phone });
      res.json({ ok: true, invoices });
    } catch (err) {
      console.error("[ivy] portal invoices failed:", err);
      res.status(500).json({ ok: false, error: "Could not load invoices just now." });
    }
  });

  /* ---------------- Scheduling request alert ---------------- */

  app.post("/portal/request-alert", async (req, res) => {
    const { uid, email } = req.portalUser;
    const id = String((req.body || {}).requestId || "");
    if (!id) return res.status(400).json({ ok: false });
    try {
      const snap = await db.collection("bookingRequests").doc(id).get();
      if (!snap.exists) return res.status(404).json({ ok: false });
      const r = snap.data();
      if (r.clientUid !== uid || r.alertedAt) return res.json({ ok: true });
      const d = await userDoc(uid);
      const name = (d.profile && d.profile.fullName) || d.fullName || d.displayName || email;
      const vip = d.vip ? "VIP " : "";
      const kind = String(r.requestType || "scheduling").replaceAll("_", " ");
      const service = String(r.serviceType || "").replaceAll("_", " ");
      await notifyOwner(
        `New ${vip}scheduling request in the portal from ${name}: ${kind}${service ? `, ${service}` : ""}` +
        `${r.preferredDate ? `, prefers ${r.preferredDate}` : ""}${r.preferredWindow ? ` ${r.preferredWindow}` : ""}.` +
        `${r.notes ? `\nNotes: "${String(r.notes).slice(0, 200)}"` : ""}` +
        `${d.phone ? `\nPhone: ${prettyPhone(d.phone)}` : ""}`
      );
      await snap.ref.set({ alertedAt: FieldValue.serverTimestamp(), vip: Boolean(d.vip) }, { merge: true });
      res.json({ ok: true });
    } catch (err) {
      console.error("[ivy] request alert failed:", err);
      res.status(500).json({ ok: false });
    }
  });
}

/**
 * When a client adds their phone, move anything they wrote in the portal
 * before that into the shared thread, so there is one history, not two.
 */
async function mergeThreads(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const fromRef = db.collection("conversations").doc(fromKey);
  const msgs = await fromRef.collection("messages").get();
  if (msgs.empty) return;
  const toRef = db.collection("conversations").doc(toKey);
  const batch = db.batch();
  msgs.docs.forEach((m) => {
    batch.set(toRef.collection("messages").doc(m.id), m.data());
    batch.delete(m.ref);
  });
  const parent = await fromRef.get();
  if (parent.exists) {
    const p = parent.data();
    batch.set(toRef, {
      portalUid: p.portalUid || "", portalEmail: p.portalEmail || "",
      messageCount: FieldValue.increment(msgs.size),
      lastMessageAt: FieldValue.serverTimestamp()
    }, { merge: true });
    batch.delete(fromRef);
  }
  await batch.commit();
  // Drafts still waiting on Richelle should follow the thread too.
  const drafts = await db.collection("ivyDrafts").where("conversationKey", "==", fromKey).get();
  for (const dft of drafts.docs) await dft.ref.set({ conversationKey: toKey, toPhone: toKey }, { merge: true });
}
