// === Ivy: text messaging (Twilio) ===
//
// Everything that touches the phone network lives here: sending a text,
// checking that an incoming webhook really came from Twilio, and turning the
// many ways a phone number can be written into one canonical form.

import twilio from "twilio";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";

let client = null;
function getClient() {
  if (!client) {
    if (!ACCOUNT_SID || !AUTH_TOKEN) throw new Error("Twilio credentials are not configured");
    client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  }
  return client;
}

/* ------------------------------------------------------------------
   Phone numbers

   A client might be stored in the database as "9792644993", or
   "(979) 264-4993", or "+19792644993". We keep one canonical form for
   our own records (E.164, like +19792644993) and can also produce the
   common variants when searching older records that were typed by hand.
   ------------------------------------------------------------------ */

export function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).trim().startsWith("+")) return "+" + digits;
  return "+" + digits;
}

export function phoneVariants(raw) {
  const e164 = normalizePhone(raw);
  const digits = e164.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return [...new Set([e164, String(raw || "").trim()])].filter(Boolean);
  const a = ten.slice(0, 3), b = ten.slice(3, 6), c = ten.slice(6);
  return [...new Set([
    e164,
    ten,
    "1" + ten,
    `(${a}) ${b}-${c}`,
    `${a}-${b}-${c}`,
    `${a}.${b}.${c}`,
    `(${a})${b}-${c}`,
    `+1 ${a}-${b}-${c}`,
    String(raw || "").trim()
  ])].filter(Boolean).slice(0, 10); // Firestore "in" queries allow at most 10 values
}

/** Pretty form for showing a number back to a person. */
export function prettyPhone(raw) {
  const digits = normalizePhone(raw).replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw || "";
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/* ------------------------------------------------------------------
   Sending
   ------------------------------------------------------------------ */

/**
 * Send a text. Long messages are left whole: Twilio splits them into
 * segments itself, and each segment is billed separately, which is why
 * Ivy is told to keep replies short.
 */
export async function sendSms(to, body) {
  const dest = normalizePhone(to);
  if (!dest) throw new Error("No destination number");
  if (!FROM_NUMBER) throw new Error("TWILIO_FROM_NUMBER is not configured");

  // Never text ourselves.
  //
  // This matters most at porting time. Richelle's business line becomes Ivy's
  // own number, and anything already on file against it, a contact learned
  // while testing, an old queued job message, would make Ivy send to herself.
  // That arrives back through the webhook as a fresh inbound message, which
  // she would answer, forever.
  if (normalizePhone(to) === normalizePhone(FROM_NUMBER)) {
    throw new Error("refusing to send to Ivy's own number");
  }
  const trimmed = String(body || "").trim();
  if (!trimmed) throw new Error("Refusing to send an empty message");

  const msg = await getClient().messages.create({
    to: dest,
    from: FROM_NUMBER,
    body: trimmed.slice(0, 1500)
  });
  return { sid: msg.sid, to: dest, body: trimmed };
}

/* ------------------------------------------------------------------
   Webhook authenticity

   Anyone can POST to a public URL. This proves the request really came
   from Twilio before Ivy acts on it. Without this check, a stranger
   could impersonate a client and make Ivy answer them.
   ------------------------------------------------------------------ */

export function verifyTwilioSignature(req) {
  if (process.env.SKIP_TWILIO_SIGNATURE === "true") return true; // local testing only
  if (!AUTH_TOKEN) return false;

  const signature = req.header("X-Twilio-Signature");
  if (!signature) return false;

  // Cloud Run terminates TLS, so rebuild the URL Twilio actually signed.
  const base = process.env.PUBLIC_URL
    ? process.env.PUBLIC_URL.replace(/\/+$/, "")
    : `https://${req.header("X-Forwarded-Host") || req.header("Host")}`;
  const url = base + req.originalUrl;

  return twilio.validateRequest(AUTH_TOKEN, signature, url, req.body || {});
}

/** Does this look like a usable Twilio setup? Used by /selftest. */
export async function twilioCheck() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return { ok: false, detail: "credentials missing" };
  if (!FROM_NUMBER) return { ok: false, detail: "TWILIO_FROM_NUMBER missing" };
  try {
    const acct = await getClient().api.accounts(ACCOUNT_SID).fetch();
    return { ok: acct.status === "active", detail: `account ${acct.status}`, from: FROM_NUMBER };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/** Ivy's own number, so the inbound handler can recognise and drop self-messages. */
export function ownNumber() {
  return normalizePhone(FROM_NUMBER);
}
