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
    "left in silence.",
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
      }
    },
    required: ["mode", "message"]
  }
};

// Everything Ivy always needs to know.
const BASE_SECTIONS = [
  "identity", "writing_style", "hours", "service_area", "services", "add_ons",
  "important_distinctions", "the_intake_form", "photo_guidance", "payment",
  "first_time_clients", "supplies_and_access", "not_included", "policies",
  "escalation_rules", "negotiation_limits", "ivy_talks_to_both_sides", "contact"
];

// Only loaded when she is talking to the crew. A client conversation does not
// need Richelle's negotiating history with Maggie, and leaving it out keeps
// every client message cheaper and the instructions clearer.
const CREW_SECTIONS = [
  "contractor_rules", "subcontractor_voice", "crew_text_voice",
  "client_privacy_with_crew", "crew_quote_request_format", "crew_job_brief_template",
  "price_reference_technique", "commercial_pricing_note", "catch_ambiguous_answers",
  "clarify_scope_before_asking", "always_give_full_location", "day_of_operations",
  "access_requirements", "payment_questions_from_crew", "mid_job_questions",
  "weekly_schedule_to_crew", "maggie_confirmation_rhythm", "richelle_is_also_a_client",
  "crew_job_assignment_template", "photos_are_tied_to_payment", "crew_channels", "completion_check",
  "crew_voice_examples", "crew_common_friction", "voice_examples"
];

function knowledgeBlock(k, person) {
  const isCrew = person && person.kind === "contractor";
  const order = isCrew ? BASE_SECTIONS.concat(CREW_SECTIONS) : BASE_SECTIONS;
  return order
    .filter((key) => k[key])
    .map((key) => `## ${key.replace(/_/g, " ").toUpperCase()}\n${k[key]}`)
    .join("\n\n");
}

function whoBlock(person) {
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
 * Work out Ivy's response to one incoming message.
 * Returns { mode, message, holding_reply, reason, learned_name }.
 */
export async function decide({ knowledge, person, history, incoming }) {
  const system = [
    knowledgeBlock(knowledge, person),
    "",
    "## HOW TO ANSWER",
    "You are replying by text message. Be brief. Answer only from the knowledge above.",
    "If the knowledge does not cover it, escalate rather than inventing an answer.",
    "Always answer by calling the respond tool. Never reply with plain text."
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
      reason: "Ivy could not form a structured answer"
    };
  }

  const out = call.input || {};
  const mode = out.mode === "send" ? "send" : "escalate";
  return {
    mode,
    message: String(out.message || "").trim(),
    holding_reply: String(out.holding_reply || "").trim(),
    reason: String(out.reason || "").trim(),
    learned_name: String(out.learned_name || "").trim(),
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
