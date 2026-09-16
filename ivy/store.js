// === Ivy: everything she reads and writes ===
//
// One place for all database access, so the rest of Ivy never talks to
// Firestore directly. Collections used:
//
//   settings/ivy              her knowledge base, editable from the dashboard
//   conversations/{key}       one per person, whatever channel they use
//   conversations/{key}/messages
//   ivyDrafts                 replies waiting for Richelle's approval
//   ivyContacts/{phone}       phone number to person, learned as she goes
//   messages                  the existing job notification queue (ft-job-run.js)
//   users, jobs, intakeRequests   read only, to work out who is texting
//
// IMPORTANT: this service uses the Firebase Admin credentials, which bypass
// your Firestore security rules completely. Rules protect the browser. They
// do not protect you from Ivy. Her limits are the ones written into her code.

import { Firestore, FieldValue } from "@google-cloud/firestore";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizePhone, phoneVariants } from "./sms.js";

// Read the seed as a plain file rather than a JSON import, so this runs on
// any recent Node without depending on import-attribute support.
const here = dirname(fileURLToPath(import.meta.url));
const defaultKnowledge = JSON.parse(
  readFileSync(join(here, "knowledge.json"), "utf8")
);

const db = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "the-finishing-touch-8ac71"
});

export { db, FieldValue };

/* ------------------------------------------------------------------
   Knowledge base
   ------------------------------------------------------------------ */

const KNOWLEDGE_DOC = db.collection("settings").doc("ivy");

/**
 * Ivy's knowledge lives in the database rather than in this code, so it can
 * be corrected from the admin dashboard in two minutes without a deploy.
 * That is the direct fix for the Beside problem, where the payment answer
 * went stale and kept being told to callers.
 */
export async function getKnowledge() {
  const snap = await KNOWLEDGE_DOC.get();

  if (!snap.exists) {
    await KNOWLEDGE_DOC.set({
      ...defaultKnowledge,
      seededAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return defaultKnowledge;
  }

  const stored = snap.data() || {};

  // Version gate.
  //
  // Firestore is the live copy, so normally it wins and edits made there take
  // effect on the next message. But that means a correction committed to
  // knowledge.json would never reach Ivy once the document exists, which is a
  // silent failure: the file looks right, Ivy keeps saying the old thing.
  //
  // So when the file's version is newer than the stored one, the file wins for
  // every section it defines, and the result is written back. Sections that
  // exist only in Firestore are kept, so hand edits to anything the file does
  // not mention survive a deploy.
  const fileVersion = Number(defaultKnowledge.version || 0);
  const storedVersion = Number(stored.version || 0);

  if (fileVersion > storedVersion) {
    const merged = { ...stored, ...defaultKnowledge };
    await KNOWLEDGE_DOC.set(
      { ...merged, updatedAt: FieldValue.serverTimestamp(), reseededFromFileAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    console.log(`[ivy] knowledge reseeded from file: v${storedVersion} -> v${fileVersion}`);
    return merged;
  }

  return { ...defaultKnowledge, ...stored };
}

/* ------------------------------------------------------------------
   What Richelle has taught her

   Corrections she sends by text used to live only in the conversation
   history, which is a rolling window, so anything she taught Ivy scrolled
   away and was forgotten. These are written into the knowledge document
   instead, under a key that knowledge.json deliberately does not define,
   so the version gate never overwrites them on a deploy.
   ------------------------------------------------------------------ */

/** Add something Richelle taught Ivy. Returns the saved entry. */
export async function appendLearning(text) {
  const clean = String(text || "").trim();
  if (!clean) return null;

  const entry = { text: clean, at: new Date().toISOString() };
  await KNOWLEDGE_DOC.set(
    {
      learned: FieldValue.arrayUnion(entry),
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  return entry;
}

/** Everything she has been taught, oldest first. */
export async function listLearnings() {
  const snap = await KNOWLEDGE_DOC.get();
  const raw = (snap.exists && snap.data().learned) || [];
  return raw
    .filter((e) => e && e.text)
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

/**
 * Drop one learned item by its position in that list, 1 based, which is how
 * Ivy shows them to Richelle.
 */
export async function removeLearning(position) {
  const all = await listLearnings();
  const target = all[position - 1];
  if (!target) return null;
  await KNOWLEDGE_DOC.set(
    { learned: all.filter((e) => e !== target), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return target;
}

/* ------------------------------------------------------------------
   Who is this?

   Best effort. Numbers in older records were typed by hand in all sorts of
   formats, so we check the common ones. Once we identify someone we write
   it to ivyContacts, and the next text from that number is instant.
   ------------------------------------------------------------------ */

export async function identify(phone) {
  const key = normalizePhone(phone);
  if (!key) return { key: "", kind: "unknown" };

  const cached = await db.collection("ivyContacts").doc(key).get();
  if (cached.exists) return { key, ...cached.data() };

  const variants = phoneVariants(phone);
  let found = null;

  // A contractor or client with a phone on their user record.
  for (const field of ["phone", "phoneNumber", "mobile"]) {
    if (found) break;
    try {
      const q = await db.collection("users").where(field, "in", variants).limit(1).get();
      if (!q.empty) {
        const u = q.docs[0];
        const d = u.data();
        const role = d.role || "client";
        found = {
          kind: ["contractor", "team_lead"].includes(role) ? "contractor" : "client",
          uid: u.id,
          name: d.displayName || d.name || "",
          email: d.email || "",
          role
        };
      }
    } catch { /* field may not exist or be indexed; try the next one */ }
  }

  // A client we have a job for.
  //
  // No orderBy here either, for the same reason as listPendingDrafts: pairing
  // it with the where() makes it a composite query that needs an index, and
  // because this one is inside a try/catch it would fail silently forever,
  // quietly never recognising a real client. A few of their jobs are fetched
  // and the newest picked in memory instead.
  if (!found) {
    try {
      const q = await db.collection("jobs")
        .where("clientPhone", "in", variants)
        .limit(20)
        .get();
      if (!q.empty) {
        const millis = (v) => {
          if (!v) return 0;
          if (typeof v.toMillis === "function") return v.toMillis();
          if (v._seconds) return v._seconds * 1000;
          const t = new Date(v).getTime();
          return Number.isFinite(t) ? t : 0;
        };
        const newest = q.docs
          .map((doc) => ({ id: doc.id, data: doc.data() }))
          .sort((a, b) => millis(b.data.createdAt) - millis(a.data.createdAt))[0];
        const d = newest.data;
        found = {
          kind: "client",
          uid: d.clientUid || d.clientId || "",
          name: d.clientName || "",
          email: d.clientEmail || "",
          lastJobId: newest.id
        };
      }
    } catch (err) {
      console.error("[ivy] jobs lookup failed:", err.message);
    }
  }

  // Someone who filled out an intake form.
  if (!found) {
    try {
      const q = await db.collection("intakeRequests")
        .where("clientPhone", "in", variants).limit(1).get();
      if (!q.empty) {
        const d = q.docs[0].data();
        found = {
          kind: "prospect",
          uid: d.clientUid || "",
          name: d.clientName || "",
          email: d.clientEmail || "",
          intakeId: q.docs[0].id
        };
      }
    } catch { /* ignore */ }
  }

  const person = found || { kind: "unknown", name: "", email: "" };
  await db.collection("ivyContacts").doc(key).set(
    { ...person, phone: key, learnedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { key, ...person };
}

/** Everyone Ivy has been told about explicitly, newest first. */
export async function listContacts(limit = 50) {
  const snap = await db.collection("ivyContacts").limit(limit).get();
  return snap.docs
    .map((d) => ({ key: d.id, ...d.data() }))
    .filter((c) => c.name)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

/**
 * Take someone off the books.
 *
 * Deleting the record is the right move rather than blanking the fields,
 * because identify() treats "no cached contact" as a cue to go and look them
 * up properly again. A half empty record would just pin them as a stranger
 * forever.
 */
export async function removeContact(phone) {
  const key = normalizePhone(phone);
  if (!key) return null;
  const ref = db.collection("ivyContacts").doc(key);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const was = { key, ...snap.data() };
  await ref.delete();
  return was;
}

/** Find a saved contact by name, for when she says "remove Maggie". */
export async function findContactsByName(name) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return [];
  const all = await listContacts(200);
  return all.filter((c) => String(c.name || "").toLowerCase().includes(needle));
}

/** Attach a name to a number once we learn it mid-conversation. */
export async function rememberContact(phone, patch) {
  const key = normalizePhone(phone);
  if (!key) return;
  await db.collection("ivyContacts").doc(key).set(
    { ...patch, phone: key, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

/* ------------------------------------------------------------------
   Conversations

   One thread per person, not per channel. Someone who texts on Monday and
   uses the portal on Thursday is a single conversation, and Ivy remembers
   Monday. The channel is recorded on each message, not on the thread.
   ------------------------------------------------------------------ */

export async function appendMessage(key, { direction, channel, body, from, meta, language, englishText }) {
  const convo = db.collection("conversations").doc(key);
  await convo.set(
    {
      lastMessageAt: FieldValue.serverTimestamp(),
      lastDirection: direction,
      lastChannel: channel,
      messageCount: FieldValue.increment(1)
    },
    { merge: true }
  );
  await convo.collection("messages").add({
    direction,           // "in" from them, "out" from us
    channel,             // "sms" for now; "email" and "portal" later
    body: String(body || "").slice(0, 8000),
    // When the exchange was not in English, englishText carries the translation so
    // Richelle can read the thread back without needing Ivy to re-translate it.
    language: language || "en",
    englishText: String(englishText || "").slice(0, 8000),
    from: from || "",
    meta: meta || {},
    at: FieldValue.serverTimestamp()
  });
}

export async function recentMessages(key, limit = 16) {
  const snap = await db.collection("conversations").doc(key)
    .collection("messages").orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data()).reverse();
}

/* ------------------------------------------------------------------
   The approval queue

   Anything about money or scheduling gets written here and texted to
   Richelle with a short code. She replies "ok <code>" to send it, or
   "no <code>" to bin it. Approve from the dashboard works the same way.
   ------------------------------------------------------------------ */

export async function createDraft({
  toPhone, toName, body, reason, conversationKey, incoming,
  language, bodyEnglish, incomingEnglish
}) {
  const ref = await db.collection("ivyDrafts").add({
    status: "pending",
    toPhone: normalizePhone(toPhone),
    toName: toName || "",
    body,
    // body is what actually sends. bodyEnglish is what Richelle reads before saying Y,
    // so a Spanish draft is never approved sight unseen.
    language: language || "en",
    bodyEnglish: bodyEnglish || "",
    reason: reason || "",
    conversationKey: conversationKey || "",
    incoming: incoming || "",
    incomingEnglish: incomingEnglish || "",
    channel: "sms",
    createdAt: FieldValue.serverTimestamp()
  });
  return { id: ref.id };
}

/**
 * Everything waiting on Richelle, oldest first.
 *
 * Order matters: she approves by replying Y, and when more than one is
 * waiting she replies Y1 or Y2. Those numbers are positions in this list,
 * so the ordering has to be stable and obvious. Oldest first means the
 * numbering does not shuffle under her while she is reading it.
 */
export async function listPendingDrafts(limit = 5) {
  // Deliberately no orderBy in the query.
  //
  // where(status) + orderBy(createdAt) is a composite query, and Firestore
  // refuses it until someone builds a matching index. That failed in
  // production and cost a client an answer, because this runs on the path
  // that tells Richelle a draft is waiting.
  //
  // The pending queue is a handful of documents at most, so a single equality
  // filter and an in-memory sort gives the same result with nothing to
  // maintain and nothing to forget. Oldest first still holds, which is what
  // keeps the Y1 / Y2 numbering stable while she is reading it.
  try {
    const q = await db.collection("ivyDrafts")
      .where("status", "==", "pending")
      .limit(50)
      .get();

    const toMillis = (d) => {
      const v = d && d.createdAt;
      if (!v) return 0;
      if (typeof v.toMillis === "function") return v.toMillis();
      if (v._seconds) return v._seconds * 1000;
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    return q.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => toMillis(a) - toMillis(b))
      .slice(0, limit);
  } catch (err) {
    // Never let the approval queue take down a reply to a client.
    console.error("[ivy] could not list pending drafts:", err.message);
    return [];
  }
}

export async function resolveDraft(id, status, extra = {}) {
  await db.collection("ivyDrafts").doc(id).set(
    { status, resolvedAt: FieldValue.serverTimestamp(), ...extra },
    { merge: true }
  );
}

/* ------------------------------------------------------------------
   The job notification queue

   ft-job-run.js has been writing here every time a crew member says
   "on my way", "arrived" or "finished". Nothing has ever read it, so
   none of those have reached a client. This is what drains it.
   ------------------------------------------------------------------ */

export async function queuedMessages(limit = 25) {
  const snap = await db.collection("messages")
    .where("status", "==", "queued")
    .limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function markQueuedMessage(id, status, extra = {}) {
  await db.collection("messages").doc(id).set(
    { status, processedAt: FieldValue.serverTimestamp(), ...extra },
    { merge: true }
  );
}

/** Used by /selftest to prove Ivy can reach the database at all. */
export async function firestoreCheck() {
  try {
    await db.collection("settings").doc("ivy").get();
    return { ok: true, detail: "reachable" };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}
