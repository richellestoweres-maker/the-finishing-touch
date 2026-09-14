# Ivy

The Finishing Touch's admin assistant. She runs as a small always-on service
on Google Cloud Run, separate from the website, because she needs to be
listening when a text arrives at 9pm and she needs secret keys that can never
go in a web page.

This folder is her whole brain and body. The website in the folder above does
not change.

---

## What she does today

- Receives texts sent to the business number
- Works out who is texting: an existing client, a prospect who filled out the
  intake form, one of the crew, or someone new
- Answers routine questions herself from her knowledge base
- Escalates anything about money, pricing, scheduling, invoices or complaints
  to Richelle, who approves by replying to a text
- Keeps one conversation per person, so a thread continues across days
- Delivers the job notifications the crew has been generating all along
  (on my way, arrived, finished), which until now have gone nowhere
- Texts Richelle if she herself breaks, rather than going quiet

## What she does not do yet

Voice calls, email, calendars, and subcontractor job assignment. Those are
later phases. See the build plan.

---

## The green light and yellow light rule

This is the heart of it, and it lives in `knowledge.json` under
`escalation_rules`, so it can be edited without touching code.

**She sends herself:** answering a question she has an answer for, sending the
intake form with the explanation of why it's required, taking a message,
telling a client what's already booked, day-before reminders.

**She drafts and waits:** anything with a number in it, booking or moving an
appointment, committing to a date, invoices and payment status, an unhappy
client, and anything she isn't confident about.

When she escalates, the client gets an immediate short note so they are not
left in silence, and Richelle gets a text like:

```
Ivy needs you. Glenda Cates (979) 264-4993 said: "what would a deep clean run me?"
Why: asking for a price
Her draft: "Richelle puts together every quote after seeing the space..."
Reply OK WXYZ to send it, or NO WXYZ to bin it.
```

Replying `OK WXYZ` sends it. Replying `NO WXYZ` bins it. Nothing goes to a
client without that.

---

## Editing what Ivy knows

Her knowledge lives in Firestore at `settings/ivy`. The file
`knowledge.json` is only used to create that document the first time she
runs. After that, **edit the Firestore document, not this file.**

That is deliberate. The Beside problem was that her answers went stale, still
telling callers about payment methods the business had stopped taking, because
updating her meant digging through a settings screen. Now it's a document you
can fix in two minutes, and she's current on the very next message.

---

## Deploying her

### 1. Turn on the services (once)

In the Google Cloud console for project `the-finishing-touch-8ac71`, make sure
these are enabled: Cloud Run, Cloud Build, Secret Manager, Firestore.

### 2. Deploy from this repo

Cloud Run, then **Create service**, then **Continuously deploy from a
repository**, then set up with Cloud Build:

- Repository: `richellestoweres-maker/the-finishing-touch`
- Branch: `main`
- Build type: **Google Cloud Buildpacks**
- **Source location: `/ivy`** (this matters, otherwise it tries to build the website)

Service settings:

- Region: `us-south1` if offered, to sit beside the database, otherwise `us-central1`
- Authentication: **Allow unauthenticated invocations** (Twilio has to be able to reach her)
- Minimum instances: 0

### 3. Give her the secrets and settings

Under Variables & Secrets:

**Secrets** (Reference a secret, expose as environment variable, latest version):

| Variable | Secret |
|---|---|
| `ANTHROPIC_API_KEY` | `ivy-anthropic-api-key` |
| `TWILIO_AUTH_TOKEN` | `ivy-twilio-auth-token` |

**Plain environment variables:**

| Variable | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | your Account SID, starts with `AC`, on the Twilio dashboard |
| `TWILIO_FROM_NUMBER` | `+12812146968` (the sandbox number) |
| `OWNER_PHONE` | Richelle's mobile, like `+1281XXXXXXX` |
| `ANTHROPIC_MODEL` | leave unset at first, see step 4 |

The service account Cloud Run uses needs the **Secret Manager Secret
Accessor** role on both secrets, and **Cloud Datastore User** so she can read
and write Firestore.

### 4. Check she is wired up

Open `https://<your-service-url>/selftest` in a browser. It shows no secrets,
just whether each connection works:

```json
{
  "ok": true,
  "firestore": { "ok": true },
  "anthropic": { "ok": true, "configuredModel": "...", "modelAvailable": true,
                 "availableModels": ["..."] },
  "twilio": { "ok": true },
  "ownerPhoneSet": true
}
```

If `modelAvailable` is false, pick one from `availableModels` and set
`ANTHROPIC_MODEL` to it.

### 5. Point the phone number at her

Twilio console, Phone Numbers, Manage, Active numbers, click the sandbox
number. Under Messaging, "A message comes in":

- Webhook, `HTTPS POST`
- URL: `https://<your-service-url>/sms/inbound`

### 6. Test

Text the sandbox number pretending to be a new client. Try:

- "do you clean airbnbs?" — she should answer herself
- "how much for a deep clean?" — she should stall politely and text Richelle
- Reply `OK <code>` from Richelle's phone and the answer should land

---

## The job notification queue

`POST /tasks/drain-queue` delivers anything sitting in the `messages`
collection. Set up Cloud Scheduler to hit it every few minutes once you are
happy with it. If you set a `TASK_KEY` environment variable, the request must
carry the same value in an `X-Task-Key` header.

---

## Things worth knowing

**She bypasses your security rules.** This service uses admin credentials, so
Firestore rules do not constrain her. Rules protect the browser. Ivy's limits
are the ones written into her code and knowledge base.

**Opt-out keywords are left to Twilio.** STOP, HELP and the rest are handled at
the carrier level. Ivy deliberately says nothing over the top of them.

**Twilio requests are verified.** Every inbound webhook is checked against the
Twilio signature, so a stranger cannot post to the public URL and impersonate
a client.

**The API key expires in December 2026.** If it stops working, Ivy texts
Richelle rather than failing silently. The longer term plan is to replace the
key with workload identity federation and delete it.

---

## Files

| File | What it is |
|---|---|
| `server.js` | The endpoints and the flow of an incoming text |
| `brain.js` | The one call to Claude, forced through a structured tool |
| `store.js` | Every read and write to Firestore |
| `sms.js` | Sending texts, verifying Twilio, tidying phone numbers |
| `knowledge.json` | Her starting knowledge, seeded once into Firestore |
