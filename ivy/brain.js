// === Ivy: the part that decides what to say ===
//
// One call to Claude per incoming message. She is given her knowledge base,
// who she is talking to, and the recent conversation, and must answer through
// a single tool so the result is always structured: either "send" this text,
// or "escalate" to Richelle with a reason.
//
// Forcing the tool is deliberate. It means Ivy can never trail off into
// free-form text that gets sent to a client by accident.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const MAX_TOKENS = Number(process.env.IVY_MAX_TOKENS || 700);

let anthropic = null;
function getClient() {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

const RESPOND_TOOL = {
  name: "respond",
  description:
    "Decide how to handle the message. Use mode 'send' for a routine reply you are confident in. " +
    "Use mode 'escalate' for anything about money, pricing, scheduling, invoices, complaints, or " +
    "anything you are not sure about. When escalating, 'message' is the draft reply Richelle will " +
    "approve, and 'holding_reply' is the short note sent to the person right now so they are not " +
    "left in silence. Always write 'message' and 'holding_reply' in the language the person wrote " +
    "to you in, and always fill in the English fields so Richelle can read the exchange.",
  input_schema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["send", "escalate"] },
      message: {
        type: "string",
        description: "The reply text. On 'send' this goes straight out. On 'escalate' this is the draft for Richelle."
      },
      holding_reply: {
        type: "string",
        description: "Only for 'escalate'. One short sentence sent immediately, such as letting them know you're checking with Richelle."
      },
      reason: {
        type: "string",
        description: "Only for 'escalate'. A few words telling Richelle why this needs her, such as 'asking for a price'."
      },
      learned_name: {
        type: "string",
        description: "If the person gave their name in this conversation and we did not already know it, put it here."
      },
      language: {
        type: "string",
        description: "The language you wrote 'message' in, as a two letter code. 'en' for English, 'es' for Spanish. Match the language the person wrote to you in."
      },
      message_english: {
        type: "string",
        description: "Required whenever language is not 'en'. A faithful English rendering of 'message', so Richelle can read what you are sending. Translate the meaning, not word for word."
      },
      holding_reply_english: {
        type: "string",
        description: "Required whenever language is not 'en' and you set a holding_reply. The English of that holding reply."
      },
      incoming_english: {
        type: "string",
        description: "Required whenever the person's own message was not in English. A faithful English rendering of what they said to you."
      }
    },
    required: ["mode", "message", "language"]
  }
};

// Everything Ivy always needs to know.
const BASE_SECTIONS = [
  "identity", "writing_style", "hours", "service_area", "services", "add_ons",
  "important_distinctions", "the_intake_form", "photo_guidance", "payment",
  "first_time_clients", "supplies_and_access", "not_included", "policies",
  "escalation_rules", "negotiation_limits", "ivy_talks_to_both_sides",
  "spanish_with_clients_too", "airbnb_and_short_term_rentals",
  "client_voice_examples", "tailored_form_guidance", "channel_length",
  "signature_block", "contact"
];

// Only loaded when she is talking to the crew. A client conversation does not
// need Richelle's negotiating history with Maggie, and leaving it out keeps
// every client message cheaper and the instructions clearer.
const CREW_SECTIONS = [
  "contractor_rules", "subcontractor_voice", "crew_text_voice",
  "client_privacy_with_crew", "crew_quote_request_format", "crew_job_brief_template",
  "price_reference_technique", "when_a_sub_quote_arrives",
  "commercial_pricing_note", "catch_ambiguous_answers",
  "clarify_scope_before_asking", "always_give_full_location", "day_of_operations",
  "access_requirements", "payment_questions_from_crew", "mid_job_questions",
  "weekly_schedule_to_crew", "maggie_confirmation_rhythm", "richelle_is_also_a_client",
  "crew_job_assignment_template", "client_preferences_block", "focus_areas",
  "maggie_capacity_and_coverage",
  "photos_are_tied_to_payment", "crew_channels", "completion_check",
  "crew_voice_examples", "crew_common_friction", "voice_examples"
];

// Commercial and post construction work behaves nothing like residential.
// It arrives from a general contractor's project manager, it is priced per
// square foot, and the worst thing Ivy can do is answer it with the
// residential intake form. These sections are loaded whenever the thread
// looks commercial, so she has the right playbook in front of her.
const COMMERCIAL_SECTIONS = [
  "commercial_arrives_by_email", "commercial_confirm_scope_before_quoting",
  "commercial_quote_email_template", "commercial_start_time_is_negotiable",
  "commercial_after_approval", "commercial_pricing_note"
];

// Cheap, deterministic signals that this is trade work rather than someone's
// house. Deliberately generous: loading these on a residential thread costs a
// few hundred tokens, while missing them on a real one costs the job.
const COMMERCIAL_HINTS = /\b(sq\.? ?ft|square (?:feet|foot|footage)|floor ?plan|post[- ]construction|final clean(?:ing)?|punch ?list|general contractor|project manager|superintendent|job ?site|suite\b|build[- ]?out|tenant improvement|\bCOI\b|certificate of insurance|scope of work|work order|walk ?through with the gc)\b/i;

function looksCommercial(person, history, incoming) {
  if (person && (person.commercial === true || person.segment === "commercial")) return true;
  const text = [incoming || ""]
    .concat((history || []).slice(-6).map((m) => m && m.body ? m.body : ""))
    .join("\n");
  return COMMERCIAL_HINTS.test(text);
}

function knowledgeBlock(k, person, history, incoming) {
  const isOwner = person && person.kind === "owner";
  const isCrew = person && person.kind === "contractor";
  // Richelle gets everything. She is the one person Ivy never has to keep a
  // secret from, and half her questions will be about the crew or a quote.
  if (isOwner) {
    const all = BASE_SECTIONS.concat(CREW_SECTIONS, COMMERCIAL_SECTIONS);
    const seen = new Set();
    return all
      .filter((key) => k[key] && !seen.has(key) && seen.add(key))
      .map((key) => `## ${key.replace(/_/g, " ").toUpperCase()}\n${k[key]}`)
      .join("\n\n");
  }
  let order = isCrew ? BASE_SECTIONS.concat(CREW_SECTIONS) : BASE_SECTIONS.slice();
  if (looksCommercial(person, history, incoming)) {
    for (const key of COMMERCIAL_SECTIONS) {
      if (!order.includes(key)) order.push(key);
    }
  }
  return order
    .filter((key) => k[key])
    .map((key) => `## ${key.replace(/_/g, " ").toUpperCase()}\n${k[key]}`)
    .join("\n\n");
}

function whoBlock(person) {
  if (person && person.kind === "owner") {
    return "This is Richelle, the owner. She is your boss, not a client. Talk to her plainly.";
  }
  if (!person || person.kind === "unknown") {
    return "You do not recognise this number. Treat them as a new enquiry. Be warm, find out what they need, and get their name.";
  }
  const bits = [];
  if (person.name) bits.push(`Name: ${person.name}`);
  if (person.email) bits.push(`Email: ${person.email}`);
  if (person.kind === "contractor") {
    bits.push("This is one of your subcontractors or crew, not a client. Use the contractor rules.");
  } else if (person.kind === "prospect") {
    bits.push("They have submitted an intake form but are not a booked client yet.");
  } else {
    bits.push("This is an existing client.");
  }
  return bits.join("\n");
}

/**
 * What Ivy is told when the person texting her is Richelle herself.
 *
 * This thread is not client work. It is the two of them running the business,
 * so the rules that protect clients from a wrong answer do not apply the same
 * way: there is nobody to escalate to, and hedging at her wastes her time.
 */
function OWNER_INSTRUCTIONS(ctx) {
  const waiting = (ctx && ctx.pendingDrafts) || [];
  const lines = waiting.length
    ? waiting.map((d, i) =>
        `${i + 1}. to ${d.toName || d.toPhone}${d.language && d.language !== "en" ? " (sends in " + d.language + ")" : ""}: "${String(d.bodyEnglish || d.body || "").slice(0, 200)}" (reason: ${d.reason || "n/a"})`
      ).join("\n")
    : "(nothing waiting)";

  return [
    "## YOU ARE TEXTING RICHELLE",
    "This is your private work thread with the owner. Nobody else sees it.",
    "",
    "She is running a business between school runs and job sites, so be short and be useful.",
    "Answer the question she actually asked. No greeting, no sign off, no restating her question.",
    "If the answer is a number or a name, lead with it.",
    "",
    "You may ask her questions here, and you should when you genuinely need something:",
    "a price you cannot work out, a date only she can commit to, a judgement call about a client,",
    "or which of two things she meant. Ask one question at a time and make it easy to answer.",
    "Do not ask her to confirm things you can already see, and do not ask permission to do",
    "something routine that your knowledge already covers.",
    "",
    "Never escalate in this thread. She is who you escalate to. If you do not know something,",
    "say you do not know and say what you would need to find out.",
    "Never invent a fact about her business. If it is not in your knowledge and not in this",
    "thread, say so rather than guessing, because she will act on what you tell her.",
    "You may disagree with her. If she is about to quote below what the sub costs, or send",
    "something to a client that contradicts her own policy, say so before she sends it.",
    "",
    "Drafts currently waiting on her Y or N:",
    lines,
    "",
    "If she is clearly answering about a draft, tell her to reply Y or N, or Y1 or N2 when",
    "more than one is waiting. Do not approve or send anything yourself.",
    "",
    "Always answer by calling the respond tool, with mode 'send'. Never use 'escalate' here."
  ].join("\n");
}

/**
 * Work out Ivy's response to one incoming message.
 * Returns { mode, message, holding_reply, reason, learned_name }.
 */
export async function decide({ knowledge, person, history, incoming, ownerContext }) {
  const isOwner = person && person.kind === "owner";
  const system = [
    knowledgeBlock(knowledge, person, history, incoming),
    "",
    isOwner ? OWNER_INSTRUCTIONS(ownerContext) : "",
    isOwner ? "" : "## HOW TO ANSWER",
    "You are replying by text message. Be brief. Answer only from the knowledge above.",
    "If the knowledge does not cover it, escalate rather than inventing an answer.",
    "Always answer by calling the respond tool. Never reply with plain text.",
    "",
    "## LANGUAGE",
    "Reply in whatever language the person wrote to you in. This applies to clients and to the crew",
    "alike. Parts of the cleaning crew speak Spanish, and making them read English is a good way to",
    "have an instruction misunderstood in someone's home.",
    "If they write in Spanish, write back in natural Texas Spanish, not a stiff translation, and keep the",
    "same warmth and brevity you would use in English. If they mix the two, follow their lead.",
    "Mirror, never pre-empt. Do not switch someone into Spanish because of their name, their employer",
    "or anything you assume about them. Maggie herself writes in English almost all the time. Go by the",
    "message in front of you and nothing else.",
    "Set 'language' to the code you wrote in. Whenever that is not 'en', you must also fill in",
    "'message_english', 'holding_reply_english' if you set a holding reply, and 'incoming_english'.",
    "Richelle does not read Spanish, so those English fields are the only way she can follow the",
    "conversation or approve a draft. A missing English field means she is approving something she",
    "cannot read, which is worse than a slow reply. Never leave them out."
  ].join("\n");

  const messages = [];
  for (const m of history) {
    messages.push({
      role: m.direction === "in" ? "user" : "assistant",
      content: m.body || ""
    });
  }
  // Collapse any same-role runs so the API gets a clean alternating transcript.
  const clean = [];
  for (const m of messages) {
    if (!m.content.trim()) continue;
    const last = clean[clean.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content;
    else clean.push({ ...m });
  }
  if (clean.length && clean[0].role === "assistant") clean.shift();

  const finalUser = `WHO YOU ARE TEXTING WITH:\n${whoBlock(person)}\n\nTHEIR MESSAGE:\n${incoming}`;
  if (clean.length && clean[clean.length - 1].role === "user") {
    clean[clean.length - 1].content += "\n\n" + finalUser;
  } else {
    clean.push({ role: "user", content: finalUser });
  }

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    tools: [RESPOND_TOOL],
    tool_choice: { type: "tool", name: "respond" },
    messages: clean
  });

  const call = res.content.find((c) => c.type === "tool_use");
  if (!call) {
    // Should not happen with a forced tool, but never guess on a client's behalf.
    return {
      mode: "escalate",
      message: "",
      holding_reply: "Thanks for reaching out. Let me check with Richelle and come right back to you.",
      reason: "Ivy could not form a structured answer",
      language: "en",
      message_english: "",
      holding_reply_english: "",
      incoming_english: ""
    };
  }

  const out = call.input || {};
  // In the owner thread there is nobody above her to escalate to, so a model that
  // picks "escalate" out of habit must still produce a reply she can read.
  const mode = isOwner ? "send" : (out.mode === "send" ? "send" : "escalate");
  return {
    mode,
    message: String(out.message || "").trim(),
    holding_reply: String(out.holding_reply || "").trim(),
    reason: String(out.reason || "").trim(),
    learned_name: String(out.learned_name || "").trim(),
    language: (String(out.language || "en").trim().toLowerCase() || "en").slice(0, 5),
    message_english: String(out.message_english || "").trim(),
    holding_reply_english: String(out.holding_reply_english || "").trim(),
    incoming_english: String(out.incoming_english || "").trim(),
    usage: res.usage || null
  };
}

/** Used by /selftest: proves the key works and tells us which models it can see. */
export async function anthropicCheck() {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, detail: "ANTHROPIC_API_KEY missing" };
  try {
    const list = await getClient().models.list({ limit: 20 });
    const ids = (list.data || []).map((m) => m.id);
    return {
      ok: true,
      configuredModel: MODEL,
      modelAvailable: ids.includes(MODEL),
      availableModels: ids
    };
  } catch (err) {
    return { ok: false, detail: err.message, configuredModel: MODEL };
  }
}
