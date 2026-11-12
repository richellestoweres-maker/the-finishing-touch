// === Ivy: Square ===
//
// Ivy reads Square Appointments and Square Invoices so the briefing can say
// who is booked and who still owes money. The one thing she writes is a client
// invoice for a finished job, and only after Richelle has had the 4:30 text.
//
// Environment she expects:
//   SQUARE_ACCESS_TOKEN   from Secret Manager: ivy-square-token. The Production
//                         access token from developer.squareup.com for the app
//                         Richelle creates there. It is not her Square password.
//   SQUARE_VERSION        optional, the API version date

const BASE = "https://connect.squareup.com/v2";
const VERSION = process.env.SQUARE_VERSION || "2025-10-16";

export function squareConfigured() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN);
}

async function sq(path, { method = "GET", body } = {}) {
  if (!squareConfigured()) throw new Error("Square is not connected yet (SQUARE_ACCESS_TOKEN missing)");
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": VERSION,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.errors || []).map((e) => e.detail || e.code).join("; ");
    if (res.status === 401) throw new Error("Square rejected the access token. Make a new one and update ivy-square-token.");
    throw new Error(msg || `Square said ${res.status}`);
  }
  return data;
}

let locationCache = null;
async function locations() {
  if (locationCache) return locationCache;
  const data = await sq("/locations");
  locationCache = (data.locations || []).filter((l) => l.status === "ACTIVE");
  return locationCache;
}

function money(m) {
  if (!m || typeof m.amount !== "number") return "";
  return `$${(m.amount / 100).toFixed(2).replace(/\.00$/, "")}`;
}

const nameCache = new Map();
async function customerName(id) {
  if (!id) return "";
  if (nameCache.has(id)) return nameCache.get(id);
  let name = "";
  try {
    const { customer } = await sq(`/customers/${id}`);
    const first = customer?.given_name || "";
    const last = customer?.family_name || "";
    // First name and last initial, the way Richelle writes clients down.
    name = [first, last ? last[0] + "." : ""].filter(Boolean).join(" ") ||
      customer?.company_name || customer?.email_address || "";
  } catch { /* leave blank */ }
  nameCache.set(id, name);
  return name;
}

async function serviceNames(variationIds) {
  const ids = [...new Set(variationIds.filter(Boolean))];
  const names = {};
  if (!ids.length) return names;
  try {
    const data = await sq("/catalog/batch-retrieve", {
      method: "POST",
      body: { object_ids: ids, include_related_objects: true }
    });
    const items = {};
    for (const o of data.related_objects || []) {
      if (o.type === "ITEM") items[o.id] = o.item_data?.name || "";
    }
    for (const o of data.objects || []) {
      const v = o.item_variation_data || {};
      const itemName = items[v.item_id] || "";
      names[o.id] = [itemName, v.name && v.name !== "Regular" ? v.name : ""].filter(Boolean).join(", ");
    }
  } catch (err) {
    console.error("[ivy] could not read Square service names:", err.message);
  }
  return names;
}

/** Appointments between two times, cancelled ones left out. */
export async function bookingsBetween(startIso, endIso) {
  const locs = await locations();
  const raw = [];
  for (const loc of locs) {
    let cursor = "";
    do {
      const p = new URLSearchParams({
        start_at_min: startIso, start_at_max: endIso, location_id: loc.id, limit: "100"
      });
      if (cursor) p.set("cursor", cursor);
      const data = await sq(`/bookings?${p}`);
      raw.push(...(data.bookings || []));
      cursor = data.cursor || "";
    } while (cursor);
  }

  const live = raw.filter((b) => !/CANCELLED|DECLINED|NO_SHOW/.test(b.status || ""));
  const services = await serviceNames(
    live.flatMap((b) => (b.appointment_segments || []).map((s) => s.service_variation_id))
  );

  const out = [];
  for (const b of live) {
    out.push({
      start: b.start_at,
      client: await customerName(b.customer_id),
      service: (b.appointment_segments || []).map((s) => services[s.service_variation_id]).filter(Boolean).join(" + "),
      minutes: (b.appointment_segments || []).reduce((n, s) => n + (s.duration_minutes || 0), 0),
      status: b.status || "",
      note: (b.customer_note || "").slice(0, 200)
    });
  }
  out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return out;
}

/**
 * Invoices that still need money: unpaid or partly paid, with how many days
 * overdue each one is. Drafts are listed separately, since a draft that was
 * never sent is its own kind of forgotten.
 */
export async function openInvoices(todayIso) {
  const locs = await locations();
  const data = await sq("/invoices/search", {
    method: "POST",
    body: {
      query: {
        filter: { location_ids: locs.map((l) => l.id) },
        sort: { field: "INVOICE_SORT_DATE", order: "DESC" }
      },
      limit: 100
    }
  });

  const today = todayIso.slice(0, 10);
  const unpaid = [];
  const drafts = [];
  for (const inv of data.invoices || []) {
    const who = inv.primary_recipient
      ? [inv.primary_recipient.given_name, inv.primary_recipient.family_name ? inv.primary_recipient.family_name[0] + "." : ""]
          .filter(Boolean).join(" ") || inv.primary_recipient.company_name || ""
      : "";
    const req = (inv.payment_requests || [])[0] || {};
    const due = req.due_date || "";
    const base = {
      number: inv.invoice_number || "",
      client: who,
      title: inv.title || "",
      amount: money(req.computed_amount_money) || money(req.total_completed_amount_money),
      due,
      link: inv.public_url || ""
    };
    if (inv.status === "DRAFT") drafts.push(base);
    if (inv.status === "UNPAID" || inv.status === "PARTIALLY_PAID") {
      const daysOverdue = due && due < today
        ? Math.round((Date.parse(today) - Date.parse(due)) / 86400000)
        : 0;
      unpaid.push({ ...base, daysOverdue, partlyPaid: inv.status === "PARTIALLY_PAID" });
    }
  }
  unpaid.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { unpaid, drafts };
}

/**
 * Every invoice for one client, for their portal. Found by the email they
 * sign in with (and their phone, when their profile has one), since that is
 * how Square knows them. Drafts are left out: a client never sees an invoice
 * Richelle has not sent.
 */
export async function invoicesForCustomer({ emails = [], phone = "" }) {
  const ids = new Set();
  for (const email of emails.slice(0, 3)) {
    const data = await sq("/customers/search", {
      method: "POST",
      body: { query: { filter: { email_address: { exact: email } } }, limit: 10 }
    });
    (data.customers || []).forEach((c) => ids.add(c.id));
  }
  if (phone) {
    try {
      const data = await sq("/customers/search", {
        method: "POST",
        body: { query: { filter: { phone_number: { exact: phone } } }, limit: 10 }
      });
      (data.customers || []).forEach((c) => ids.add(c.id));
    } catch { /* phone search is a bonus, email is the main match */ }
  }
  if (!ids.size) return [];

  const locs = await locations();
  const out = [];
  // Square only takes one customer per invoice search.
  for (const id of [...ids].slice(0, 5)) {
    const data = await sq("/invoices/search", {
      method: "POST",
      body: {
        query: {
          filter: { location_ids: locs.map((l) => l.id), customer_ids: [id] },
          sort: { field: "INVOICE_SORT_DATE", order: "DESC" }
        },
        limit: 50
      }
    });
    for (const inv of data.invoices || []) {
      if (inv.status === "DRAFT") continue;
      const req = (inv.payment_requests || [])[0] || {};
      out.push({
        id: inv.id,
        number: inv.invoice_number || "",
        title: inv.title || "",
        status: inv.status || "",
        amount: money(req.computed_amount_money) || money(req.total_completed_amount_money),
        paid: money(req.total_completed_amount_money),
        due: req.due_date || "",
        sent: (inv.created_at || "").slice(0, 10),
        link: inv.public_url || ""
      });
    }
  }
  const seen = new Set();
  return out
    .filter((i) => (seen.has(i.id) ? false : seen.add(i.id)))
    .sort((a, b) => String(b.sent).localeCompare(String(a.sent)));
}

/* ------------------------------------------------------------------
   Sending invoices

   The one place Ivy writes to Square. A client invoice for a finished job:
   find or create the customer, build a one line order named for the
   service (so the QuickBooks sync maps it like the invoices Richelle makes
   by hand), then publish the invoice so Square emails it with a Pay button
   and an optional tip. Each step uses an idempotency key built from the job
   id, so a retry never makes a second invoice.
   ------------------------------------------------------------------ */

async function ensureCustomer({ email, name, phone, jobId }) {
  if (email) {
    const found = await sq("/customers/search", {
      method: "POST",
      body: { query: { filter: { email_address: { exact: email } } }, limit: 1 }
    });
    if ((found.customers || [])[0]) return found.customers[0].id;
  }
  const [given, ...rest] = String(name || "").trim().split(/\s+/);
  const { customer } = await sq("/customers", {
    method: "POST",
    body: {
      idempotency_key: `ivy-cust-${jobId}`,
      given_name: given || undefined,
      family_name: rest.join(" ") || undefined,
      email_address: email || undefined,
      phone_number: phone || undefined,
      note: "Added by Ivy for a website booking"
    }
  });
  return customer.id;
}

export async function sendJobInvoice({ jobId, email, name, phone, service, description, amount, dueDate }) {
  const cents = Math.round(Number(amount) * 100);
  if (!cents || cents < 100) throw new Error("No client price on this job");
  if (!email) throw new Error("No client email on this job");
  const locs = await locations();
  const locationId = locs[0]?.id;
  if (!locationId) throw new Error("No active Square location");

  const customerId = await ensureCustomer({ email, name, phone, jobId });
  const { order } = await sq("/orders", {
    method: "POST",
    body: {
      idempotency_key: `ivy-order-${jobId}`,
      order: {
        location_id: locationId,
        customer_id: customerId,
        reference_id: jobId.slice(0, 40),
        line_items: [{
          name: String(service || "Service").slice(0, 500),
          quantity: "1",
          base_price_money: { amount: cents, currency: "USD" }
        }]
      }
    }
  });
  const { invoice } = await sq("/invoices", {
    method: "POST",
    body: {
      idempotency_key: `ivy-inv-${jobId}`,
      invoice: {
        location_id: locationId,
        order_id: order.id,
        primary_recipient: { customer_id: customerId },
        payment_requests: [{ request_type: "BALANCE", due_date: dueDate, tipping_enabled: true }],
        delivery_method: "EMAIL",
        title: String(service || "Service").slice(0, 255),
        description: String(description || "Thank you for choosing The Finishing Touch!").slice(0, 65536),
        accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false, buy_now_pay_later: false, cash_app_pay: false }
      }
    }
  });
  const published = await sq(`/invoices/${invoice.id}/publish`, {
    method: "POST",
    body: { version: invoice.version, idempotency_key: `ivy-pub-${jobId}` }
  });
  const inv = published.invoice || invoice;
  return { id: inv.id, number: inv.invoice_number || "", url: inv.public_url || "", status: inv.status || "" };
}

/** Which permissions the key has, so we know invoices will work before 4:30. */
export async function squareScopes() {
  const data = await sq("/../oauth2/token/status", { method: "POST", body: {} });
  const scopes = data.scopes || [];
  const need = ["CUSTOMERS_READ", "CUSTOMERS_WRITE", "ORDERS_WRITE", "INVOICES_READ", "INVOICES_WRITE"];
  return { scopes, missing: need.filter((s) => !scopes.includes(s)), expires: data.expires_at || "" };
}

export async function squareCheck() {
  if (!squareConfigured()) return { ok: false, detail: "not set up" };
  try {
    const locs = await locations();
    return { ok: true, detail: `${locs.length} active location${locs.length === 1 ? "" : "s"}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}
