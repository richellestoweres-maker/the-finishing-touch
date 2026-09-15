// === Ivy ===
//
// The Finishing Touch's admin assistant. She lives on Cloud Run, receives
// texts from Twilio, answers the routine ones herself, and sends anything
// about money or scheduling to Richelle for approval first.
//
// Endpoints:
//   GET  /health            is she up
//   GET  /selftest          are her three connections working (no secrets shown)
//   POST /sms/inbound       Twilio posts incoming texts here
//   POST /tasks/drain-queue delivers the job notifications the crew has been
//                           generating all along, which nothing has ever sent
//
// Environment she expects:
//   ANTHROPIC_API_KEY       from Secret Manager: ivy-anthropic-api-key
//   TWILIO_AUTH_TOKEN       from Secret Manager: ivy-twilio-auth-token
//   TWILIO_ACCOUNT_SID      plain value, it is an identifier not a secret
//   TWILIO_FROM_NUMBER      the number Ivy texts from, E.164
//   OWNER_PHONE             Richelle's mobile, E.164, where approvals go
//   ANTHROPIC_MODEL         optional, defaults below
//   PUBLIC_URL              optional, this service's own https URL
//   TASK_KEY                optional shared secret for /tasks/* endpoints

import express from "express";
import {
  getKnowledge, identify, rememberContact, appendMessage, recentMessages,
  createDraft, listPendingDrafts, resolveDraft,
  queuedMessages, markQueuedMessage, firestoreCheck,
  appendLearning, listLearnings, removeLearning,
  listContacts
} from "./store.js";
import { decide, anthropicCheck } from "./brain.js";
import {
  sendSms, verifyTwilioSignature, normalizePhone, prettyPhone, twilioCheck, ownNumber
} from "./sms.js";

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded
app.use(express.json());

const OWNER_PHONE = normalizePhone(process.env.OWNER_PHONE || "");
const TASK_KEY = process.env.TASK_KEY || "";

const OPT_OUT = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "START", "UNSTOP", "HELP", "INFO"]);

/** Turn a language code into something readable in a text to Richelle. */
function languageName(code) {
  const names = { en: "English", es: "Spanish" };
  return names[String(code || "").toLowerCase()] || code || "another language";
}

/** Twilio wants XML back. An empty response means "I have nothing to say myself". */
function noReply(res) {
  res.set("Content-Type", "text/xml");
  res.send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
}

/**
 * Tell Richelle something. Used for approvals and, just as importantly, for
 * failures: if Ivy breaks, she says so instead of going quiet.
 */
async function notifyOwner(text) {
  if (!OWNER_PHONE) { console.error("[ivy] OWNER_PHONE not set, cannot notify:", text); return; }
  try {
    await sendSms(OWNER_PHONE, text);
  } catch (err) {
    console.error("[ivy] could not reach the owner:", err.message);
  }
}

/* ==================================================================
   Health and self test
   ================================================================== */

app.get("/health", (_req, res) => res.json({ ok: true, service: "ivy" }));

app.get("/selftest", async (_req, res) => {
  const [store, brain, sms] = await Promise.all([
    firestoreCheck(), anthropicCheck(), twilioCheck()
  ]);
  const ok = store.ok && brain.ok && sms.ok;
  res.status(ok ? 200 : 503).json({
    ok,
    firestore: store,
    anthropic: brain,
    twilio: sms,
    ownerPhoneSet: Boolean(OWNER_PHONE)
  });
});

/* ==================================================================
   Richelle's approval replies

   She replies Y to send, N to bin. That is the whole vocabulary, because
   typing on a phone between jobs should cost one keystroke.

   The only time she has to say more is when two drafts are waiting at
   once, since a bare Y would then be ambiguous and guessing wrong means
   the wrong message reaches a client. In that case Ivy numbers them and
   she replies Y1 or N2.
   ================================================================== */

function draftLine(draft, n) {
  const who = draft.toName || prettyPhone(draft.toPhone);
  // Richelle reads English. If the draft sends in Spanish, show her the English.
  const shown = draft.bodyEnglish || draft.body || "";
  const tag = draft.language && draft.language !== "en" ? ` [sends in ${draft.language}]` : "";
  return `${n}. ${who}${tag}: "${String(shown).slice(0, 90)}"`;
}

async function sendDraft(draft) {
  try {
    await sendSms(draft.toPhone, draft.body);
    await resolveDraft(draft.id, "sent");
    if (draft.conversationKey) {
      await appendMessage(draft.conversationKey, {
        direction: "out", channel: "sms", body: draft.body,
        meta: { approvedDraft: draft.id }
      });
    }
    return `Sent to ${draft.toName || prettyPhone(draft.toPhone)}.`;
  } catch (err) {
    await resolveDraft(draft.id, "failed", { error: err.message });
    return `That didn't send: ${err.message}`;
  }
}

const OWNER_KEY = "owner";

/**
 * Let Richelle see the client side from her own phone.
 *
 * Once her number is the owner number, every text she sends lands in her
 * working thread with Ivy, which is right but means she can no longer watch
 * what a stranger would actually receive. Rather than make her borrow a second
 * phone to check her own business, she can prefix a message with TEST and Ivy
 * runs it exactly as if it had arrived cold, then shows her the result.
 *
 * Nothing is sent to anyone, nothing is stored, no draft is queued. It is a
 * dry run and it says so.
 *
 *   test do you clean airbnbs
 *   test client can you come back thursday
 *   test crew what's the door code for the kemah job
 */
async function handleTestCommand(text) {
  const m = text.match(/^\s*test\b[:\s]*(?:(crew|contractor|client|prospect|new)\b[:\s]+)?([\s\S]*)$/i);
  if (!m) return null;

  const roleWord = (m[1] || "").toLowerCase();
  const pretend = (m[2] || "").trim();
  if (!pretend) return "Give me something to test, such as: test do you clean airbnbs";

  const person =
    roleWord === "crew" || roleWord === "contractor"
      ? { kind: "contractor", name: "Maggie", key: "test" }
      : roleWord === "client"
        ? { kind: "client", name: "", key: "test" }
        : { kind: "unknown", name: "", key: "test" };

  const label =
    person.kind === "contractor" ? "one of the crew"
      : person.kind === "client" ? "an existing client"
        : "someone new";

  const knowledge = await getKnowledge();
  const outcome = await decide({ knowledge, person, history: [], incoming: pretend });

  const body = outcome.message_english || outcome.message || "(nothing)";
  const langNote = outcome.language && outcome.language !== "en"
    ? ` (she'd write it in ${languageName(outcome.language)})`
    : "";

  if (outcome.mode === "send") {
    return `TEST, as ${label}. Nothing was sent.\n\nShe'd reply${langNote}:\n"${body}"`;
  }
  return `TEST, as ${label}. Nothing was sent.\n\n` +
    `She'd hold them with: "${outcome.holding_reply_english || outcome.holding_reply}"\n` +
    `Then ask you to approve${langNote}:\n"${body}"\n` +
    `Why: ${outcome.reason || "not sure"}`;
}

/**
 * Explicit ways for Richelle to manage what Ivy has learned.
 *
 * She can also just correct Ivy in plain language and Ivy will save it
 * herself. These are for when she wants to be certain, or wants to see or
 * undo what is in there.
 *
 *   remember we never quote commercial without Maggie pricing it first
 *   what have you learned
 *   forget 3
 */
async function handleLearningCommand(text) {
  const remember = text.match(/^\s*(?:remember|learn)\b[:\s]+([\s\S]+)$/i);
  if (remember) {
    const fact = remember[1].trim();
    if (!fact) return "Tell me what to remember, such as: remember we don't take Venmo anymore";
    const saved = await appendLearning(fact);
    return saved ? `Saved. I'll remember: "${saved.text}"` : "That didn't save, try again.";
  }

  if (/^\s*(what have you learned|what did you learn|what do you know|list learned|learned)\s*\??\s*$/i.test(text)) {
    const all = await listLearnings();
    if (!all.length) return "Nothing yet. Tell me something and I'll keep it, or say: remember <thing>";
    return `${all.length} thing${all.length === 1 ? "" : "s"} you've taught me:\n` +
      all.map((e, i) => `${i + 1}. ${e.text}`).join("\n") +
      `\nSay "forget 2" to drop one.`;
  }

  const forget = text.match(/^\s*forget\s+(\d{1,2})\s*$/i);
  if (forget) {
    const gone = await removeLearning(Number(forget[1]));
    return gone ? `Dropped it: "${gone.text}"` : `There's no number ${forget[1]}. Say "what have you learned" to see the list.`;
  }

  return null;
}

/**
 * Teach Ivy who someone is, by text.
 *
 * These details stay out of the repo on purpose. The repo is public, and a
 * subcontractor's mobile number and personal email are not Richelle's to
 * publish. They go straight into the private contact store instead, which is
 * the first thing identify() checks, so the next text from that number is
 * recognised rather than treated as a stranger and sent the intake form.
 *
 *   crew Maggie 281-967-2543 fastcleaninghouston@gmail.com birthday July 15
 *   client Robert M 555-123-4567
 *   who do you know
 */
async function handleContactCommand(text) {
  const m = text.match(/^\s*(crew|contractor|sub|client)\b[:\s]+([\s\S]+)$/i);

  if (!m) {
    if (/^\s*(who do you know|contacts|list contacts)\s*\??\s*$/i.test(text)) {
      const all = await listContacts();
      if (!all.length) return "Nobody yet. Add someone with: crew Maggie 281-967-2543";
      return `${all.length} on file:\n` + all.map((c) =>
        `${c.name}${c.kind === "contractor" ? " (crew)" : ""} ${prettyPhone(c.phone || c.key)}${c.email ? " " + c.email : ""}`
      ).join("\n");
    }
    return null;
  }

  const word = m[1].toLowerCase();
  const kind = word === "client" ? "client" : "contractor";
  let rest = m[2].trim();

  const email = (rest.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || "";
  if (email) rest = rest.replace(email, " ");

  const bday = rest.match(/\bbirthday\b[:\s]*([A-Za-z]+\s*\d{1,2}|\d{1,2}[\/-]\d{1,2})/i);
  const birthday = bday ? bday[1].trim() : "";
  if (bday) rest = rest.replace(bday[0], " ");

  // The leading bracket has to be part of the match, or "(281) 967-2543"
  // leaves a stray "(" behind and the name comes out as "Maggie Gonzalez (".
  const phoneRaw = (rest.match(/\+?\(?\d[\d\s().-]{8,}\d\)?/) || [])[0] || "";
  if (phoneRaw) rest = rest.replace(phoneRaw, " ");
  const phone = normalizePhone(phoneRaw);

  const name = rest
    .replace(/\s+/g, " ")
    // Note the period is not stripped from the end: "Maggie G." is an initial,
    // not stray punctuation.
    .replace(/^[\s,.:;()-]+|[\s,:;()-]+$/g, "")
    .trim();

  if (!phone) return `I need a phone number to file someone under. Try: ${word} ${name || "Maggie"} 281-967-2543`;
  if (!name) return "I need a name too, such as: crew Maggie 281-967-2543";

  const patch = { kind, name };
  if (email) patch.email = email;
  if (birthday) patch.birthday = birthday;

  await rememberContact(phone, patch);

  const bits = [prettyPhone(phone)];
  if (email) bits.push(email);
  if (birthday) bits.push(`birthday ${birthday}`);
  return `Got it. ${name}${kind === "contractor" ? ", crew" : ", client"}: ${bits.join(", ")}.\n` +
    `I'll know it's ${name.split(" ")[0]} when they text.`;
}

async function handleOwnerCommand(body) {
  const text = String(body || "").trim();

  // Dry run first, so a test never gets mistaken for a real instruction.
  const test = await handleTestCommand(text);
  if (test) return test;

  const learning = await handleLearningCommand(text);
  if (learning) return learning;

  const contact = await handleContactCommand(text);
  if (contact) return contact;

  const m = text.match(/^\s*(y|yes|ok|send|n|no|nope)\s*(\d{1,2})?\s*$/i);

  // Anything that is not a bare approval is Richelle talking to Ivy. This is
  // their working thread, so Ivy answers it properly instead of reciting a list.
  if (!m) {
    const [knowledge, history, waiting] = await Promise.all([
      getKnowledge(),
      recentMessages(OWNER_KEY, 30),
      listPendingDrafts()
    ]);

    await appendMessage(OWNER_KEY, { direction: "in", channel: "sms", body: text });

    const outcome = await decide({
      knowledge,
      person: { kind: "owner", name: "Richelle" },
      history,
      incoming: text,
      ownerContext: { pendingDrafts: waiting }
    });

    let reply = outcome.message ||
      (waiting.length
        ? `${waiting.length} waiting.\n` + waiting.map((d, i) => draftLine(d, i + 1)).join("\n")
        : "Nothing waiting on you right now.");

    // She corrected Ivy in plain language, so write it down before it scrolls away.
    if (outcome.learn) {
      try {
        await appendLearning(outcome.learn);
      } catch (err) {
        console.error("[ivy] could not save a learning:", err.message);
        reply += "\n(I couldn't save that one, tell me again in a moment.)";
      }
    }

    await appendMessage(OWNER_KEY, { direction: "out", channel: "sms", body: reply });
    return reply;
  }

  const approve = /^(y|yes|ok|send)$/i.test(m[1]);
  const position = m[2] ? Number(m[2]) : null;
  const waiting = await listPendingDrafts();

  if (!waiting.length) return "Nothing is waiting on you right now.";

  let draft;
  if (position) {
    draft = waiting[position - 1];
    if (!draft) {
      return `There's no number ${position}. ${waiting.length} waiting:\n` +
        waiting.map((d, i) => draftLine(d, i + 1)).join("\n");
    }
  } else if (waiting.length === 1) {
    draft = waiting[0];
  } else {
    // Ambiguous, and sending the wrong thing to a client is worse than one extra text.
    return `${waiting.length} drafts are waiting, so I need to know which one.\n` +
      waiting.map((d, i) => draftLine(d, i + 1)).join("\n") +
      `\nReply ${approve ? "Y1, Y2" : "N1, N2"} and so on.`;
  }

  if (!approve) {
    await resolveDraft(draft.id, "rejected");
    return `Binned it. Nothing went to ${draft.toName || prettyPhone(draft.toPhone)}.`;
  }
  return await sendDraft(draft);
}

/* ==================================================================
   Incoming texts
   ================================================================== */

app.post("/sms/inbound", async (req, res) => {
  if (!verifyTwilioSignature(req)) {
    console.warn("[ivy] rejected a request that was not signed by Twilio");
    return res.status(403).send("bad signature");
  }

  const from = normalizePhone(req.body.From);
  const body = String(req.body.Body || "").trim();
  if (!from || !body) return noReply(res);

  // Carriers require opt-out keywords to be handled by Twilio itself.
  // Ivy stays out of the way rather than replying over the top of it.
  if (OPT_OUT.has(body.toUpperCase())) return noReply(res);

  // A message from our own number is either a loop or a spoof. Either way Ivy
  // has nothing to say to herself.
  if (from && from === ownNumber()) {
    console.warn("[ivy] dropped a message that came from Ivy's own number");
    return noReply(res);
  }

  try {
    // Richelle texting in is her own thread with Ivy: approvals, and anything else
    // she wants to ask. It is never treated as a client conversation.
    if (OWNER_PHONE && from === OWNER_PHONE) {
      const reply = await handleOwnerCommand(body);
      await sendSms(OWNER_PHONE, reply);
      return noReply(res);
    }

    const person = await identify(from);
    const key = person.key || from;

    const [knowledge, history] = await Promise.all([
      getKnowledge(),
      recentMessages(key, 16)
    ]);

    const outcome = await decide({
      knowledge,
      person,
      history,
      incoming: body
    });

    const lang = outcome.language || "en";
    const foreign = lang !== "en";

    // Stored after deciding, because that is when we learn what language it was
    // in and what it says in English.
    await appendMessage(key, {
      direction: "in", channel: "sms", body, from,
      language: lang, englishText: outcome.incoming_english || ""
    });

    if (outcome.learned_name && !person.name) {
      await rememberContact(from, { name: outcome.learned_name });
    }

    const who = person.name ? `${person.name} (${prettyPhone(from)})` : prettyPhone(from);

    if (outcome.mode === "send" && outcome.message) {
      await sendSms(from, outcome.message);
      await appendMessage(key, {
        direction: "out", channel: "sms", body: outcome.message,
        language: lang, englishText: outcome.message_english || ""
      });

      // Richelle asked to see every non-English exchange as it happens, in English,
      // so nothing is said on her behalf in a language she cannot read.
      if (foreign) {
        await notifyOwner(
          `Ivy handled this in ${languageName(lang)}. English copy:\n` +
          `${who} said: "${(outcome.incoming_english || body).slice(0, 300)}"\n` +
          `Ivy replied: "${(outcome.message_english || outcome.message).slice(0, 300)}"`
        );
      }
      return noReply(res);
    }

    // Escalation. Say something to the person now so they are not left hanging,
    // then put the real reply in front of Richelle.
    const holding = outcome.holding_reply ||
      "Thanks for reaching out. Let me check with Richelle and come right back to you.";
    await sendSms(from, holding);
    await appendMessage(key, {
      direction: "out", channel: "sms", body: holding, meta: { holding: true },
      language: lang, englishText: outcome.holding_reply_english || ""
    });

    await createDraft({
      toPhone: from,
      toName: person.name || "",
      body: outcome.message || "",
      reason: outcome.reason || "needs your call",
      conversationKey: key,
      incoming: body,
      language: lang,
      bodyEnglish: outcome.message_english || "",
      incomingEnglish: outcome.incoming_english || ""
    });

    // If this is the only thing waiting she can just say Y. If others are
    // already queued, tell her the number now so she does not have to ask.
    const waiting = await listPendingDrafts();
    const position = waiting.findIndex((d) => d.toPhone === from && d.status === "pending") + 1;
    const howToAnswer = waiting.length <= 1
      ? "Reply Y to send it, N to bin it."
      : `${waiting.length} are waiting now. Reply Y${position || waiting.length} to send this one, N${position || waiting.length} to bin it.`;

    const saidEn = outcome.incoming_english || body;
    const draftEn = outcome.message_english || outcome.message || "(none)";
    await notifyOwner(
      `Ivy needs you. ${who} said: "${saidEn.slice(0, 160)}"\n` +
      (foreign ? `(that was in ${languageName(lang)}; Ivy will reply in ${languageName(lang)})\n` : "") +
      `Why: ${outcome.reason || "not sure"}\n` +
      `Her draft: "${draftEn.slice(0, 400)}"\n` +
      howToAnswer
    );

    return noReply(res);
  } catch (err) {
    console.error("[ivy] inbound failed:", err);

    // The specific failure Richelle asked to never be silent: the API key.
    const isAuth = /401|authentication|invalid.*api.*key|expired/i.test(err.message || "");
    await notifyOwner(
      isAuth
        ? `Ivy's Claude API key is not working, so she can't answer texts. A text just came in from ${prettyPhone(from)} and went unanswered. Check the key in Secret Manager.`
        : `Ivy hit an error answering ${prettyPhone(from)} and that message went unanswered: ${String(err.message).slice(0, 200)}`
    );
    return noReply(res);
  }
});

/* ==================================================================
   The job notification queue

   ft-job-run.js writes here whenever the crew says on my way, arrived, or
   finished. Nothing has ever read it. This delivers them.
   ================================================================== */

app.post("/tasks/drain-queue", async (req, res) => {
  if (TASK_KEY && req.header("X-Task-Key") !== TASK_KEY) {
    return res.status(403).json({ ok: false, error: "bad task key" });
  }

  const results = { sent: 0, skipped: 0, failed: 0, details: [] };
  try {
    const items = await queuedMessages(25);
    for (const item of items) {
      const to = normalizePhone(item.toPhone || item.phone || "");
      const text = item.body || item.text || item.message || "";

      // Incidents are for Richelle, not the client.
      const destination = item.kind === "incident" ? OWNER_PHONE : to;

      if (!destination || !text) {
        await markQueuedMessage(item.id, "skipped", { skipReason: "no destination or no body" });
        results.skipped++;
        continue;
      }
      try {
        await sendSms(destination, text);
        await markQueuedMessage(item.id, "sent", { sentTo: destination });
        const key = normalizePhone(destination);
        await appendMessage(key, {
          direction: "out", channel: "sms", body: text,
          meta: { source: "job-queue", queueId: item.id, kind: item.kind || "" }
        });
        results.sent++;
      } catch (err) {
        await markQueuedMessage(item.id, "failed", { error: err.message });
        results.failed++;
        results.details.push({ id: item.id, error: err.message });
      }
    }
    res.json({ ok: true, ...results });
  } catch (err) {
    console.error("[ivy] drain failed:", err);
    res.status(500).json({ ok: false, error: err.message, ...results });
  }
});

/* ==================================================================
   Start
   ================================================================== */

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`[ivy] listening on ${port}`);
  console.log(`[ivy] owner phone ${OWNER_PHONE ? "set" : "NOT SET, approvals will be lost"}`);
});
