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

const PORT = Number(process.env.PORT) || 3073;
const HOST = process.env.HOST || '127.0.0.1';
const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || '/var/lib/krylabs-pay';
// Only the tests change this, to point at a stand-in for Razorpay.
const RZP = (process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1').replace(/\/+$/, '');

const CURRENCY = 'INR';
const MIN_PAISE = 100; // ₹1, Razorpay's own minimum
const MAX_PAISE = 5_00_000_00; // ₹5,00,000 in one payment; larger invoices are split or paid by bank transfer
// Razorpay refunds an authorized payment that is never captured, so the ledger keeps the
// status and the dashboard is the place to check before treating "authorized" as money in.
const SETTLED = ['captured', 'authorized'];

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

function record(event, payload) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...payload });
  try {
    fs.appendFileSync(LEDGER, line + '\n');
  } catch (err) {
    console.error('ledger write failed:', err.message);
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

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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

// Order creation is open to anyone by nature, so it needs a ceiling or it becomes a free
// way to spam Razorpay on this key: a few per visitor a minute, and a cap for everyone.
const hits = new Map();
let allHits = [];
function rateLimited(ip, now = Date.now()) {
  const recent = (t) => now - t < 60_000;
  const mine = (hits.get(ip) || []).filter(recent);
  allHits = allHits.filter(recent);
  if (mine.length >= 8 || allHits.length >= 60) return true;
  mine.push(now);
  allHits.push(now);
  hits.set(ip, mine);
  return false;
}
setInterval(() => hits.clear(), 10 * 60_000).unref();

// Cloudflare names the visitor; everything else arrives from cloudflared on loopback.
const clientIp = (req) =>
  String(req.headers['cf-connecting-ip'] || '').trim() ||
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress;

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------------------------------------------------------------- routes

// POST /pay/api/order: { invoice, amount_paise, name, email, phone? } → a Razorpay order.
// The amount comes from the payer here on purpose: they are paying the total printed on an
// invoice we sent. The invoice reference rides along so the payment can be matched to it.
async function createOrder(req, res) {
  if (rateLimited(clientIp(req))) return json(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: 'Bad request.' });
  }

  const invoice = clean(body.invoice, 40);
  const name = clean(body.name, 80);
  const email = clean(body.email, 120);
  const phone = clean(body.phone, 20).replace(/[\s()-]/g, '');
  const amount = body.amount_paise;

  const problem =
    (!/^[A-Za-z0-9][A-Za-z0-9 #/._-]*$/.test(invoice) && 'Check the invoice number: letters, numbers, spaces and - / . _ # only.') ||
    ((!Number.isSafeInteger(amount) || amount < MIN_PAISE) && 'Enter the amount on your invoice, ₹1 or more.') ||
    (amount > MAX_PAISE && 'One payment can be up to ₹5,00,000. For more, write to us for bank transfer details.') ||
    (name.length < 2 && 'Add your name.') ||
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && 'Check your email address.') ||
    (phone && !/^\+?\d{8,15}$/.test(phone) && 'Check your phone number, or leave it empty.');
  if (problem) return json(res, 400, { error: problem });

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
    orders.set(order.id, { id: order.id, amount: order.amount, invoice, paid: false });
    record('order.created', { order_id: order.id, receipt, amount: order.amount, invoice, name, email, phone });
    return json(res, 200, { id: order.id, amount: order.amount, currency: order.currency, key_id: KEY_ID });
  } catch (err) {
    console.error('order failed:', err.message);
    record('order.failed', { invoice, amount, error: err.message });
    return json(res, 502, { error: 'Could not start the payment. Please try again in a minute.' });
  }
}

// POST /pay/api/verify: the checkout's success callback, checked before the page says "paid".
async function verify(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: 'Bad request.' });
  }
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') {
    return json(res, 400, { error: 'Missing payment details.' });
  }

  // The browser only names WHICH of our orders it means. An order we never created cannot
  // verify, and one that already has cannot verify twice.
  const known = orders.get(orderId);
  if (!known) {
    record('verify.unknown_order', { order_id: orderId, payment_id: paymentId });
    return json(res, 400, { error: 'This payment is not one this page started.' });
  }
  if (known.paid) {
    record('verify.replay', { order_id: orderId, payment_id: paymentId });
    return json(res, 409, { error: 'This payment has already been confirmed.' });
  }
  if (!safeEqual(hmac(`${known.id}|${paymentId}`, KEY_SECRET), signature)) {
    record('verify.bad_signature', { order_id: orderId, payment_id: paymentId });
    return json(res, 400, { error: 'The payment signature did not match.' });
  }

  // Claimed before the lookup, so two verifies racing on one order cannot both pass;
  // released again if this one does not.
  known.paid = true;

  // The signature proves the ids belong together. It does not prove the money settled for
  // the amount we asked, so ask Razorpay directly.
  try {
    const payment = await rzp(`/payments/${encodeURIComponent(paymentId)}`);
    const ok =
      payment.order_id === known.id &&
      payment.amount === known.amount &&
      payment.currency === CURRENCY &&
      SETTLED.includes(payment.status);
    const facts = { order_id: known.id, payment_id: paymentId, invoice: known.invoice, status: payment.status, amount: payment.amount, method: payment.method };
    if (!ok) {
      known.paid = false;
      record('verify.mismatch', facts);
      return json(res, 400, { error: 'Razorpay does not show this payment as complete yet.' });
    }
    record('verify.ok', facts);
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
  } catch {
    return json(res, 413, { error: 'Too large.' });
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
  record('webhook', {
    type: evt?.event,
    payment_id: p.id,
    order_id: known.id,
    invoice: known.invoice,
    amount: p.amount,
    status: p.status,
    refund_id: evt?.payload?.refund?.entity?.id,
  });
  return json(res, 200, { ok: true });
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const route = `${req.method} ${new URL(req.url, 'http://localhost').pathname}`;
  try {
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
