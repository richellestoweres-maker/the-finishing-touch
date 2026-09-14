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
  createDraft, findPendingDraftByCode, resolveDraft,
  queuedMessages, markQueuedMessage, firestoreCheck
} from "./store.js";
import { decide, anthropicCheck } from "./brain.js";
import {
  sendSms, verifyTwilioSignature, normalizePhone, prettyPhone, twilioCheck
} from "./sms.js";

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded
app.use(express.json());

const OWNER_PHONE = normalizePhone(process.env.OWNER_PHONE || "");
const TASK_KEY = process.env.TASK_KEY || "";

const OPT_OUT = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "START", "UNSTOP", "HELP", "INFO"]);

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

   She gets a text like:  IVY needs you. Reply OK WXYZ to send.
   She answers "ok wxyz" or "no wxyz".
   ================================================================== */

async function handleOwnerCommand(body) {
  const m = String(body || "").trim().match(/^\s*(ok|yes|send|no|nope|stop it|reject)\s+([A-Za-z0-9]{4})\s*$/i);
  if (!m) {
    return "To approve a draft reply OK and the code, such as OK WXYZ. To bin it, NO WXYZ.";
  }
  const approve = /^(ok|yes|send)$/i.test(m[1]);
  const draft = await findPendingDraftByCode(m[2]);
  if (!draft) return `I can't find a waiting draft with code ${m[2].toUpperCase()}.`;

  if (!approve) {
    await resolveDraft(draft.id, "rejected");
    return `Binned it. Nothing was sent to ${draft.toName || prettyPhone(draft.toPhone)}.`;
  }

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

  try {
    // Richelle texting in is approvals, not a client conversation.
    if (OWNER_PHONE && from === OWNER_PHONE) {
      const reply = await handleOwnerCommand(body);
      await sendSms(OWNER_PHONE, reply);
      return noReply(res);
    }

    const person = await identify(from);
    const key = person.key || from;

    await appendMessage(key, { direction: "in", channel: "sms", body, from });

    const [knowledge, history] = await Promise.all([
      getKnowledge(),
      recentMessages(key, 16)
    ]);

    const outcome = await decide({
      knowledge,
      person,
      history: history.slice(0, -1), // the message we just stored is passed separately
      incoming: body
    });

    if (outcome.learned_name && !person.name) {
      await rememberContact(from, { name: outcome.learned_name });
    }

    if (outcome.mode === "send" && outcome.message) {
      await sendSms(from, outcome.message);
      await appendMessage(key, { direction: "out", channel: "sms", body: outcome.message });
      return noReply(res);
    }

    // Escalation. Say something to the person now so they are not left hanging,
    // then put the real reply in front of Richelle.
    const holding = outcome.holding_reply ||
      "Thanks for reaching out. Let me check with Richelle and come right back to you.";
    await sendSms(from, holding);
    await appendMessage(key, {
      direction: "out", channel: "sms", body: holding, meta: { holding: true }
    });

    const draft = await createDraft({
      toPhone: from,
      toName: person.name || "",
      body: outcome.message || "",
      reason: outcome.reason || "needs your call",
      conversationKey: key,
      incoming: body
    });

    const who = person.name ? `${person.name} (${prettyPhone(from)})` : prettyPhone(from);
    await notifyOwner(
      `Ivy needs you. ${who} said: "${body.slice(0, 160)}"\n` +
      `Why: ${outcome.reason || "not sure"}\n` +
      `Her draft: "${(outcome.message || "(none)").slice(0, 400)}"\n` +
      `Reply OK ${draft.code} to send it, or NO ${draft.code} to bin it.`
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
