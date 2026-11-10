// Payments for krylabs.com/pay/, through Razorpay: the fixed-price offers in payments/rules.mjs.
//
// The site is static files. Creating a Razorpay order needs the key secret, which must never
// reach a browser, so this small service holds it. Caddy proxies /pay/api/* here.
//
// Zero dependencies, like server.js: Node's built-in fetch and crypto cover everything.
// The browser only ever sees the key id and an order id, never anything that can move money.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { CURRENCY, offerFor, tidy, problemWith } from './rules.mjs';

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
// One JSONL file: every order created, every confirmation and capture, every webhook. Enough to
// match a payment to its buyer by hand, and to rebuild the order list after a restart. (The name
// is from when the page took invoice payments; lines from then name an invoice, not an offer.)
fs.mkdirSync(DATA_DIR, { recursive: true });
const LEDGER = path.join(DATA_DIR, 'invoice-payments.jsonl');

// Orders THIS server created. Razorpay's docs are explicit: verify the signature against the
// order id you hold, never the razorpay_order_id the browser sends back. Without this list, any
// valid (order, payment, signature) triple could be replayed against us.
//   paid:     false, 'checking' while a confirmation is with Razorpay, or true once confirmed
//   captured: the id of the payment captured against it, so a second is never captured
const orders = new Map(); // order_id -> { id, amount, currency, offer, paid, captured, lock }
const newOrder = (id, amount, currency, offer) => ({ id, amount, currency, offer, paid: false, captured: null, lock: Promise.resolve() });

// Resolves to false when the line could not be written. An order is only handed to a payer once
// it is on disk, since the ledger is how this service remembers its orders across a restart.
async function record(event, payload) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...payload });
  try {
    await fs.promises.appendFile(LEDGER, line + '\n');
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
    // Lines from the invoice days carry no currency or offer: those orders were in rupees.
    if (e.event === 'order.created') orders.set(e.order_id, newOrder(e.order_id, e.amount, e.currency ?? 'INR', e.offer ?? `invoice ${e.invoice}`));
    const o = orders.get(e.order_id);
    if (!o) continue;
    if (e.event === 'verify.ok') o.paid = true;
    if (['verify.ok', 'webhook', 'webhook.capture'].includes(e.event) && e.status === 'captured') o.captured ??= e.payment_id;
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
const WINDOW = 60_000;
const hits = { order: new Map(), verify: new Map() };
const LIMITS = { order: 8, verify: 20 }; // per WINDOW
function rateLimited(kind, visitor, now = Date.now()) {
  const mine = (hits[kind].get(visitor) || []).filter((t) => now - t < WINDOW);
  if (mine.length >= LIMITS[kind]) return true;
  mine.push(now);
  hits[kind].set(visitor, mine);
  return false;
}
// Forget visitors whose latest attempt has aged out; everyone else keeps their window.
setInterval(() => {
  const now = Date.now();
  for (const map of Object.values(hits)) for (const [k, v] of map) if (now - v[v.length - 1] >= WINDOW) map.delete(k);
}, WINDOW).unref();

// Cloudflare names the visitor; everything else arrives from cloudflared on loopback. The header
// can be trusted because the origin is reachable only through the tunnel (the droplet's
// firewall admits SSH alone), so no one can send it straight to Caddy. An IPv6 address counts
// by its /64, the block one connection usually holds, so rotating addresses inside it does not
// buy more attempts. Anything that is not an address is used as given, cut short.
function visitorOf(req) {
  const ip = (
    String(req.headers['cf-connecting-ip'] || '').trim() ||
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    String(req.socket.remoteAddress || '')
  ).toLowerCase();
  if (!net.isIPv6(ip) || ip.startsWith('::ffff:')) return ip.slice(0, 64);
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const gap = ip.includes('::') ? Array(Math.max(0, 8 - left.length - right.length)).fill('0') : [];
  return [...left, ...gap, ...right].slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// ---------------------------------------------------------------- capture
const matchesOrder = (p, order) => p.order_id === order.id && p.amount === order.amount && p.currency === order.currency;

// Razorpay refunds an authorized payment that is never captured, so one that matches its order
// is captured here, by whichever of /verify and the webhook sees it first, rather than relying
// on the account's auto-capture setting. Captures for one order run one at a time, and an order
// that already has a captured payment never captures another: a second payment on the same
// order (a UPI request approved after the payer switched to a card) is left for Razorpay to
// refund. Resolves to the payment as it stands afterwards.
function captureIfAuthorized(payment, order) {
  if (payment.status === 'captured' && matchesOrder(payment, order)) order.captured ??= payment.id;
  if (payment.status !== 'authorized' || !matchesOrder(payment, order)) return Promise.resolve(payment);

  const run = order.lock.then(async () => {
    const route = `/payments/${encodeURIComponent(payment.id)}`;
    if (!order.captured) {
      const { items = [] } = await rzp(`/orders/${encodeURIComponent(order.id)}/payments`);
      order.captured = items.find((p) => p.status === 'captured')?.id ?? null;
    }
    if (order.captured && order.captured !== payment.id) {
      console.error(`not capturing ${payment.id}: ${order.id} already has ${order.captured} captured`);
      void record('capture.skipped', { order_id: order.id, payment_id: payment.id, offer: order.offer, captured: order.captured });
      return rzp(route);
    }
    let after;
    try {
      after = await rzp(`${route}/capture`, { method: 'POST', body: JSON.stringify({ amount: order.amount, currency: order.currency }) });
    } catch (err) {
      console.error(`capture of ${payment.id} failed:`, err.message); // often auto-capture got there first
      after = await rzp(route);
    }
    if (after.status === 'captured') order.captured = after.id;
    return after;
  });
  order.lock = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------- routes

// POST /pay/api/order: { offer, name, email, phone? } → a Razorpay order for that offer.
// The price is the offer's own, from rules.mjs: nothing the browser sends sets the amount.
// The offer and the buyer's details ride along in the order's notes, so the Razorpay
// dashboard shows who bought what.
async function createOrder(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return badBody(res, err);
  }

  // The page runs the same check (payments/rules.mjs) first; `field` lets it point at the one to fix.
  const d = tidy(body);
  const problem = problemWith(d);
  if (problem) return json(res, 400, { error: problem[1], field: problem[0] });

  // Counted only once the form is valid, so fixing a typo never uses up a payer's attempts.
  if (rateLimited('order', visitorOf(req))) return json(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });

  const { offer, name, email, phone } = d;
  const { cents: amount } = offerFor(offer);
  const receipt = `krylabs_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  try {
    const order = await rzp('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        currency: CURRENCY,
        receipt,
        notes: { source: 'krylabs.com/pay', offer, name, email, phone },
      }),
    });
    const facts = { order_id: order.id, receipt, offer, amount: order.amount, currency: order.currency, name, email, phone };
    if (!(await record('order.created', facts))) {
      return json(res, 503, { error: 'Payments are down for a moment. Please try again shortly.' });
    }
    orders.set(order.id, newOrder(order.id, order.amount, order.currency, offer));
    return json(res, 200, { id: order.id, amount: order.amount, currency: order.currency, key_id: KEY_ID });
  } catch (err) {
    console.error('order failed:', err.message);
    void record('order.failed', { offer, amount, error: err.message });
    return json(res, 502, { error: 'Could not start the payment. Please try again in a minute.' });
  }
}

// Razorpay's payment states that can still become "captured" without the payer doing anything.
const IN_FLIGHT = ['created', 'authorized'];

// POST /pay/api/verify: the checkout's success callback, checked before the page says "paid".
// 200 confirmed; 409 confirmed earlier; 503 not yet, try again; 400 never will be.
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
    void record('verify.bad_signature', { order_id: orderId, payment_id: paymentId });
    return json(res, 400, { error: 'The payment signature did not match.' });
  }
  if (known.paid === true) {
    void record('verify.replay', { order_id: orderId, payment_id: paymentId });
    return json(res, 409, { error: 'This payment has already been confirmed.' });
  }
  if (known.paid === 'checking') return json(res, 503, { error: 'This payment is being confirmed. Try again in a moment.' });

  // Claimed before the lookup, so two confirmations racing on one order cannot both pass;
  // released again if this one does not.
  known.paid = 'checking';

  // The signature proves the ids belong together. It does not prove the money arrived for the
  // amount we asked, so ask Razorpay directly. Only a captured payment counts.
  try {
    const payment = await captureIfAuthorized(await rzp(`/payments/${encodeURIComponent(paymentId)}`), known);
    const facts = { order_id: known.id, payment_id: paymentId, offer: known.offer, status: payment.status, amount: payment.amount, method: payment.method };
    if (matchesOrder(payment, known) && payment.status === 'captured') {
      known.paid = true;
      // The money is in either way, so the payer hears so; but without this line a restart would
      // forget the order was confirmed, so a failure here is worth shouting about.
      if (!(await record('verify.ok', facts))) console.error(`LEDGER: verify.ok for ${paymentId} (${known.offer}) was not written`);
      return json(res, 200, { ok: true, payment_id: paymentId, amount: payment.amount, currency: payment.currency, offer: known.offer });
    }
    known.paid = false;
    void record('verify.not_captured', facts);
    if (matchesOrder(payment, known) && IN_FLIGHT.includes(payment.status)) {
      return json(res, 503, { error: 'Razorpay is still processing this payment.' });
    }
    return json(res, 400, { error: 'Razorpay does not show this payment as complete.' });
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
  const known = p && orders.get(p.order_id);
  if (!known) return json(res, 200, { ok: true, ignored: true });
  const facts = { payment_id: p.id, order_id: known.id, offer: known.offer, amount: p.amount };
  void record('webhook', { type: evt.event, ...facts, status: p.status, refund_id: evt.payload?.refund?.entity?.id });
  json(res, 200, { ok: true });

  // A payer who closes the tab before the page confirms leaves an authorized payment that only
  // this event knows about. Capture it after answering, since Razorpay wants a fast reply.
  // A payment.captured event just teaches the order which payment it has.
  try {
    const after = await captureIfAuthorized(p, known);
    if (evt.event === 'payment.authorized') void record('webhook.capture', { ...facts, status: after.status });
  } catch (err) {
    console.error(`webhook capture of ${p.id} failed:`, err.message);
    void record('webhook.capture', { ...facts, error: err.message });
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
