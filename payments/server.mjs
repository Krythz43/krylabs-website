// Invoice payments for krylabs.com/pay/, through Razorpay.
//
// The site is static files. Creating a Razorpay order needs the key secret, which must never
// reach a browser, so this small service holds it. Caddy proxies /pay/api/* here.
//
// Zero dependencies, like server.js: Node's built-in fetch and crypto cover everything.
// The browser only ever sees the key id and an order id, never anything that can move money.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CURRENCY, MIN_PAISE, MAX_PAISE, MAX_LENGTH, INVOICE, EMAIL, PHONE, rupees } from './rules.mjs';

const PORT = Number(process.env.PORT) || 3073;
const HOST = process.env.HOST || '127.0.0.1';
const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
// Under systemd the unit's StateDirectory wins, so the ledger is always somewhere the
// sandbox lets it write. DATA_DIR is for running it anywhere else, such as the tests.
const DATA_DIR = process.env.STATE_DIRECTORY || process.env.DATA_DIR || '/var/lib/krylabs-pay';
// Only the tests change this, to point at a stand-in for Razorpay.
const RZP = (process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1').replace(/\/+$/, '');

if (!KEY_ID || !KEY_SECRET) {
  console.error('FATAL: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set.');
  process.exit(1);
}
const MODE = KEY_ID.startsWith('rzp_test_') ? 'test' : 'live';

// ---------------------------------------------------------------- ledger
// One JSONL file: every order created, every verify attempt and every webhook. Enough to
// match a payment to an invoice by hand, and to rebuild the order list after a restart.
fs.mkdirSync(DATA_DIR, { recursive: true });
const LEDGER = path.join(DATA_DIR, 'invoice-payments.jsonl');

// Orders THIS server created. Razorpay's docs are explicit: verify the signature against
// the order id you hold, never the razorpay_order_id the browser sends back. Without this
// list, any valid (order, payment, signature) triple could be replayed against us.
const orders = new Map(); // order_id -> { id, amount, invoice, paid }

// Returns false when the line could not be written. An order is only handed to a payer once
// it is on disk, since the ledger is how this service remembers its orders across a restart.
function record(event, payload) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...payload });
  try {
    fs.appendFileSync(LEDGER, line + '\n');
    return true;
  } catch (err) {
    console.error('ledger write failed:', err.message);
    return false;
  }
}

try {
  for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      console.error('ledger: skipping a corrupt line'); // one bad line must not lose the rest
      continue;
    }
    if (e.event === 'order.created') orders.set(e.order_id, { id: e.order_id, amount: e.amount, invoice: e.invoice, paid: false });
    if (e.event === 'verify.ok' && orders.has(e.order_id)) orders.get(e.order_id).paid = true;
  }
  console.log(`replayed ${orders.size} orders from the ledger`);
} catch (err) {
  if (err.code !== 'ENOENT') console.error('ledger replay failed:', err.message);
}

// ---------------------------------------------------------------- helpers
function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

// Past the limit the rest of the body is read and dropped rather than the socket torn down, so
// the sender still gets its 413 instead of a connection reset.
function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size <= limit) return chunks.push(c);
      over = true;
      chunks.length = 0;
      reject(Object.assign(new Error('body too large'), { tooLarge: true }));
    });
    req.on('end', () => over || resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const badBody = (res, err) =>
  err?.tooLarge ? json(res, 413, { error: 'Too large.' }) : json(res, 400, { error: 'Bad request.' });

// JSON that parses to null, a number or a string is still a bad body.
async function readJson(req) {
  const raw = await readBody(req);
  const body = raw.length ? JSON.parse(raw) : {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
  return body;
}

const hmac = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

// Constant-time compare, so a signature cannot be guessed a byte at a time.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function rzp(route, init = {}) {
  const res = await fetch(RZP + route, {
    ...init,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.description || `razorpay ${res.status}`);
  return body;
}

// Both routes are open to anyone by nature, so each visitor gets a ceiling: on orders so the
// key cannot be used to spam Razorpay, on confirmations so nobody can grind the ledger.
// There is deliberately no cap across all visitors, which one attacker could fill for everyone.
const hits = { order: new Map(), verify: new Map() };
const LIMITS = { order: 8, verify: 20 }; // a minute
function rateLimited(kind, visitor, now = Date.now()) {
  const mine = (hits[kind].get(visitor) || []).filter((t) => now - t < 60_000);
  if (mine.length >= LIMITS[kind]) return true;
  mine.push(now);
  hits[kind].set(visitor, mine);
  return false;
}
setInterval(() => Object.values(hits).forEach((m) => m.clear()), 10 * 60_000).unref();

// Cloudflare names the visitor; everything else arrives from cloudflared on loopback. The header
// can be trusted because the origin is reachable only through the tunnel (the droplet's
// firewall admits SSH alone), so no one can send it straight to Caddy. An IPv6
// address counts by its /64, the block one connection usually holds, so rotating addresses
// inside it does not buy more attempts.
function visitorOf(req) {
  const ip =
    String(req.headers['cf-connecting-ip'] || '').trim() ||
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    String(req.socket.remoteAddress || '');
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------------------------------------------------------------- routes

// POST /pay/api/order: { invoice, amount_paise, name, email, phone? } → a Razorpay order.
// The amount comes from the payer here on purpose: they are paying the total printed on an
// invoice we sent. The invoice reference rides along so the payment can be matched to it.
async function createOrder(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return badBody(res, err);
  }

  const invoice = clean(body.invoice, MAX_LENGTH.invoice);
  const name = clean(body.name, MAX_LENGTH.name);
  const email = clean(body.email, MAX_LENGTH.email);
  const phone = clean(body.phone, MAX_LENGTH.phone).replace(/[\s()-]/g, '');
  const amount = body.amount_paise;

  // The page checks the same rules (payments/rules.mjs) first; `field` lets it point at the one to fix.
  const problem =
    (!INVOICE.test(invoice) && ['invoice', 'Check the invoice number: letters, numbers, spaces and - / . _ # only.']) ||
    ((!Number.isSafeInteger(amount) || amount < MIN_PAISE) && ['amount', `Enter the total on your invoice, ${rupees(MIN_PAISE)} or more.`]) ||
    (amount > MAX_PAISE && ['amount', `One payment can be up to ${rupees(MAX_PAISE)}. Write to us for more.`]) ||
    (name.length < 2 && ['name', 'Add your name.']) ||
    (!EMAIL.test(email) && ['email', 'Check your email address.']) ||
    (phone && !PHONE.test(phone) && ['phone', 'Check your phone number, or leave it empty.']);
  if (problem) return json(res, 400, { error: problem[1], field: problem[0] });

  // Counted only once the form is valid, so fixing a typo never uses up a payer's attempts.
  if (rateLimited('order', visitorOf(req))) return json(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });

  const receipt = `krylabs_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  try {
    const order = await rzp('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        currency: CURRENCY,
        receipt,
        notes: { source: 'krylabs.com/pay', invoice, name, email, phone },
      }),
    });
    if (!record('order.created', { order_id: order.id, receipt, amount: order.amount, invoice, name, email, phone })) {
      return json(res, 503, { error: 'Payments are down for a moment. Please try again shortly.' });
    }
    orders.set(order.id, { id: order.id, amount: order.amount, invoice, paid: false });
    return json(res, 200, { id: order.id, amount: order.amount, currency: order.currency, key_id: KEY_ID });
  } catch (err) {
    console.error('order failed:', err.message);
    record('order.failed', { invoice, amount, error: err.message });
    return json(res, 502, { error: 'Could not start the payment. Please try again in a minute.' });
  }
}

const matchesOrder = (p, order) => p.order_id === order.id && p.amount === order.amount && p.currency === CURRENCY;

// Razorpay refunds an authorized payment that is never captured, so one that matches its order
// is captured here, whichever of /verify and the webhook sees it first, rather than relying on
// the account's auto-capture setting. Returns the payment as it stands afterwards.
async function captureIfAuthorized(payment, order) {
  if (payment.status !== 'authorized' || !matchesOrder(payment, order)) return payment;
  const route = `/payments/${encodeURIComponent(payment.id)}`;
  try {
    return await rzp(`${route}/capture`, { method: 'POST', body: JSON.stringify({ amount: order.amount, currency: CURRENCY }) });
  } catch (err) {
    console.error(`capture of ${payment.id} failed:`, err.message); // usually someone else got there first
    return rzp(route);
  }
}

// POST /pay/api/verify: the checkout's success callback, checked before the page says "paid".
async function verify(req, res) {
  if (rateLimited('verify', visitorOf(req))) return json(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return badBody(res, err);
  }
  // Shape-checked before anything is looked up or written, so the ledger only ever holds
  // short, well-formed ids.
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  if (!/^order_[A-Za-z0-9]{1,40}$/.test(orderId) || !/^pay_[A-Za-z0-9]{1,40}$/.test(paymentId) || !/^[a-f0-9]{64}$/.test(signature)) {
    return json(res, 400, { error: 'Missing payment details.' });
  }

  // The browser only names WHICH of our orders it means. An order we never created cannot
  // verify (and is not worth a ledger line), and one that already has cannot verify twice.
  const known = orders.get(orderId);
  if (!known) return json(res, 400, { error: 'This payment is not one this page started.' });
  if (!safeEqual(hmac(`${known.id}|${paymentId}`, KEY_SECRET), signature)) {
    record('verify.bad_signature', { order_id: orderId, payment_id: paymentId });
    return json(res, 400, { error: 'The payment signature did not match.' });
  }
  // `paid` is false, 'checking' while a confirmation is with Razorpay, or true. The page
  // retries on 503 and takes 409 to mean an earlier try of its own got through.
  if (known.paid === true) {
    record('verify.replay', { order_id: orderId, payment_id: paymentId });
    return json(res, 409, { error: 'This payment has already been confirmed.' });
  }
  if (known.paid === 'checking') return json(res, 503, { error: 'This payment is being confirmed. Try again in a moment.' });

  // Claimed before the lookup, so two verifies racing on one order cannot both pass;
  // released again if this one does not.
  known.paid = 'checking';

  // The signature proves the ids belong together. It does not prove the money settled for
  // the amount we asked, so ask Razorpay directly. Only a captured payment counts.
  try {
    const payment = await captureIfAuthorized(await rzp(`/payments/${encodeURIComponent(paymentId)}`), known);
    const ok = matchesOrder(payment, known) && payment.status === 'captured';
    const facts = { order_id: known.id, payment_id: paymentId, invoice: known.invoice, status: payment.status, amount: payment.amount, method: payment.method };
    if (!ok) {
      known.paid = false;
      record('verify.mismatch', facts);
      return json(res, 400, { error: 'Razorpay does not show this payment as complete yet.' });
    }
    // The money is in either way, so the payer hears so; but without this line a restart would
    // forget the order was confirmed, so a failure here is worth shouting about.
    known.paid = true;
    if (!record('verify.ok', facts)) console.error(`LEDGER: verify.ok for ${paymentId} (invoice ${known.invoice}) was not written`);
    return json(res, 200, { ok: true, payment_id: paymentId, amount: payment.amount, invoice: known.invoice });
  } catch (err) {
    known.paid = false;
    console.error('verify lookup failed:', err.message);
    return json(res, 502, { error: 'Could not reach Razorpay to confirm the payment.' });
  }
}

// POST /pay/api/webhook: Razorpay's own record of each payment. It still arrives when the
// payer closes the tab before the success callback runs. Off until a webhook secret is set.
async function webhook(req, res) {
  if (!WEBHOOK_SECRET) return json(res, 503, { error: 'Webhook not configured.' });
  let raw;
  try {
    raw = await readBody(req, 256 * 1024);
  } catch (err) {
    return badBody(res, err);
  }
  const sig = req.headers['x-razorpay-signature'];
  if (!sig || !safeEqual(hmac(raw, WEBHOOK_SECRET), sig)) return json(res, 400, { error: 'Bad signature.' });

  let evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: 'Bad payload.' });
  }
  // Webhooks are account-wide: other products' subscriptions, payment links and dashboard
  // payments arrive here too. Only payments against an order this page created are filed;
  // the rest are acknowledged and dropped. Either way the answer is a fast 200, or Razorpay retries.
  const p = evt?.payload?.payment?.entity;
  const known = orders.get(p?.order_id);
  if (!known) return json(res, 200, { ok: true, ignored: true });
  const facts = { payment_id: p.id, order_id: known.id, invoice: known.invoice, amount: p.amount };
  record('webhook', { type: evt?.event, ...facts, status: p.status, refund_id: evt?.payload?.refund?.entity?.id });
  json(res, 200, { ok: true });

  // A payer who closes the tab before the page confirms leaves an authorized payment that only
  // this event knows about. Capture it after answering, since Razorpay wants a fast reply.
  if (evt?.event === 'payment.authorized') {
    try {
      const after = await captureIfAuthorized(p, known);
      record('webhook.capture', { ...facts, status: after.status });
    } catch (err) {
      console.error(`webhook capture of ${p.id} failed:`, err.message);
      record('webhook.capture', { ...facts, error: err.message });
    }
  }
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  try {
    const route = `${req.method} ${new URL(req.url, 'http://localhost').pathname}`;
    switch (route) {
      case 'GET /pay/api/health':
        return json(res, 200, { ok: true, mode: MODE, webhook: Boolean(WEBHOOK_SECRET) });
      case 'POST /pay/api/order':
        return await createOrder(req, res);
      case 'POST /pay/api/verify':
        return await verify(req, res);
      case 'POST /pay/api/webhook':
        return await webhook(req, res);
      default:
        return json(res, 404, { error: 'Not found.' });
    }
  } catch (err) {
    console.error('unhandled:', err);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`krylabs payments listening on ${HOST}:${PORT} [${MODE} keys]`);
});
