// === Ivy: Square ===
//
// Read only. Ivy looks at Square Appointments and Square Invoices so the
// briefing can say who is booked and who still owes money. She never creates,
// changes or cancels anything in Square.
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

export async function squareCheck() {
  if (!squareConfigured()) return { ok: false, detail: "not set up" };
  try {
    const locs = await locations();
    return { ok: true, detail: `${locs.length} active location${locs.length === 1 ? "" : "s"}` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}
