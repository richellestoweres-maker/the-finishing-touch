// === Ivy: answering the phone ===
//
// This is deliberately not Ivy holding a conversation. It is the floor: a
// professional greeting, a voicemail, and Richelle finding out immediately
// that someone called. Ivy talking to callers herself comes later.
//
// The floor matters now for two reasons. Calls to the business number
// currently reach the Beside app, which is still telling people the business
// takes Zelle and Venmo, and it has not for months. And the moment that
// number ports into Twilio the forwarding to Beside stops existing, so
// without this every caller would reach dead air.

/** Twilio speaks TwiML. Escape anything that goes inside it. */
function xmlEscape(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twiml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

/**
 * The greeting and the voicemail prompt.
 *
 * Both come from the knowledge base rather than from this file, so Richelle
 * can change what callers hear without waiting on a deploy. That was the whole
 * lesson of the Beside payment answer going stale.
 */
export function greetingTwiml(knowledge, { actionUrl, transcribeUrl }) {
  const k = knowledge || {};
  const greeting = k.voice_greeting ||
    "Thank you for calling The Finishing Touch. We're sorry we missed you.";
  const prompt = k.voice_voicemail_prompt ||
    "Please leave your name, number, and a little about the space you'd like cleaned, " +
    "and we'll get right back to you. You can also text this number any time.";

  // Polly voices sound like a person rather than a robot, which matters when
  // the whole brand is "boutique" rather than "call centre".
  const say = (t) => `<Say voice="Polly.Joanna-Neural">${xmlEscape(t)}</Say>`;

  return twiml(
    say(greeting) +
    say(prompt) +
    `<Record maxLength="180" playBeep="true" trim="trim-silence"` +
      ` action="${xmlEscape(actionUrl)}"` +
      ` transcribe="true" transcribeCallback="${xmlEscape(transcribeUrl)}" />` +
    say("It doesn't look like anything was recorded. Please text us instead and we'll come right back to you. Goodbye.")
  );
}

/** What the caller hears once they have left a message. */
export function thanksTwiml() {
  return twiml(
    `<Say voice="Polly.Joanna-Neural">Thank you. We've got that and we'll be in touch very soon. Goodbye.</Say><Hangup/>`
  );
}

/** Nothing to say, but Twilio still wants valid TwiML. */
export function emptyTwiml() {
  return twiml("");
}
