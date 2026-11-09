// End-to-end tests for payments/server.mjs against a stand-in for Razorpay's API.
// Run with `npm test`. No network and no real keys: the server is started with
// RAZORPAY_API_BASE pointing at the stand-in below.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const KEY_ID = 'rzp_test_unit';
const KEY_SECRET = 'unit-secret';
const WEBHOOK_SECRET = 'unit-webhook-secret';
const sign = (payload, secret = KEY_SECRET) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

// ---- the stand-in for Razorpay: orders it was asked to create, payments it will report.
const created = [];
const payments = new Map();
let failOrders = false;
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const auth = Buffer.from(String(req.headers.authorization).replace(/^Basic /, ''), 'base64').toString();
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (auth !== `${KEY_ID}:${KEY_SECRET}`) return send(401, { error: { description: 'bad auth' } });
  if (req.method === 'POST' && req.url === '/orders') {
    if (failOrders) return send(500, { error: { description: 'down' } });
    const body = JSON.parse(Buffer.concat(chunks));
    const order = { id: `order_${created.length + 1}`, amount: body.amount, currency: body.currency, notes: body.notes };
    created.push(order);
    return send(200, order);
  }
  const m = req.url.match(/^\/payments\/([^/]+)$/);
  if (req.method === 'GET' && m && payments.has(m[1])) return send(200, payments.get(m[1]));
  return send(404, { error: { description: 'not found' } });
});

const freePort = () =>
  new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let base;
let proc;
let dataDir;
let env;

async function startServer() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}/pay/api`;
  proc = spawn(process.execPath, [SERVER], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => d.toString().includes('listening') && resolve());
    proc.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}
const stopServer = () => new Promise((resolve) => (proc.once('exit', resolve), proc.kill()));

before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krylabs-pay-'));
  env = {
    PATH: process.env.PATH,
    RAZORPAY_KEY_ID: KEY_ID,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_API_BASE: `http://127.0.0.1:${fake.address().port}`,
    DATA_DIR: dataDir,
  };
  await startServer();
});

after(async () => {
  await stopServer();
  fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let ip = 0;
// A different visitor per call, so the per-visitor limit only bites where a test wants it.
const post = (route, body, headers = { 'cf-connecting-ip': `10.0.0.${++ip}` }) =>
  fetch(`${base}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const good = { invoice: 'KRY-2026-014', amount_paise: 4_500_000, name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98450 12345' };

async function paidOrder(overrides = {}) {
  const { body: order } = await post('order', good);
  const paymentId = `pay_${crypto.randomBytes(4).toString('hex')}`;
  payments.set(paymentId, { id: paymentId, order_id: order.id, amount: order.amount, currency: 'INR', status: 'captured', method: 'upi', ...overrides });
  return { order, paymentId, signature: sign(`${order.id}|${paymentId}`) };
}

test('health says which keys it runs on', async () => {
  const r = await fetch(`${base}/health`).then((r) => r.json());
  assert.deepEqual(r, { ok: true, mode: 'test', webhook: true });
});

test('creates an order for the amount and invoice given, and hands back only what checkout needs', async () => {
  const r = await post('order', good);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['amount', 'currency', 'id', 'key_id']);
  assert.equal(r.body.key_id, KEY_ID);
  const sent = created.at(-1);
  assert.equal(sent.amount, 4_500_000);
  assert.equal(sent.currency, 'INR');
  assert.equal(sent.notes.invoice, 'KRY-2026-014');
  assert.equal(sent.notes.phone, '+919845012345');
});

test('turns away bad orders before Razorpay sees them', async () => {
  const before = created.length;
  const cases = [
    { amount_paise: 0 },
    { amount_paise: 99 },
    { amount_paise: 1500.5 },
    { amount_paise: '4500000' },
    { amount_paise: 5_00_000_01 },
    { invoice: '' },
    { invoice: '<script>' },
    { name: 'A' },
    { email: 'not-an-email' },
    { phone: '12' },
  ];
  for (const c of cases) {
    const r = await post('order', { ...good, ...c });
    assert.equal(r.status, 400, JSON.stringify(c));
    assert.ok(r.body.error);
  }
  assert.equal((await post('order', 'null')).status, 400);
  assert.equal((await post('order', '{nope')).status, 400);
  assert.equal(created.length, before);
});

test('a phone number is optional', async () => {
  assert.equal((await post('order', { ...good, phone: '' })).status, 200);
});

test('verifies a captured payment once, and refuses it a second time', async () => {
  const { order, paymentId, signature } = await paidOrder();
  const fields = { razorpay_order_id: order.id, razorpay_payment_id: paymentId, razorpay_signature: signature };
  const ok = await post('verify', fields);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.payment_id, paymentId);
  assert.equal(ok.body.invoice, 'KRY-2026-014');
  assert.equal((await post('verify', fields)).status, 409);
});

test('refuses a bad signature, an order it never created and missing fields', async () => {
  const { order, paymentId } = await paidOrder();
  assert.equal((await post('verify', { razorpay_order_id: order.id, razorpay_payment_id: paymentId, razorpay_signature: sign(`${order.id}|${paymentId}`, 'wrong') })).status, 400);
  assert.equal((await post('verify', { razorpay_order_id: 'order_x', razorpay_payment_id: paymentId, razorpay_signature: sign(`order_x|${paymentId}`) })).status, 400);
  assert.equal((await post('verify', { razorpay_order_id: order.id })).status, 400);
});

test('does not call a payment complete when Razorpay disagrees, and lets it verify once it settles', async () => {
  for (const wrong of [{ amount: 100 }, { status: 'failed' }, { currency: 'USD' }, { order_id: 'order_other' }]) {
    const { order, paymentId, signature } = await paidOrder(wrong);
    const r = await post('verify', { razorpay_order_id: order.id, razorpay_payment_id: paymentId, razorpay_signature: signature });
    assert.equal(r.status, 400, JSON.stringify(wrong));
  }
  const { order, paymentId, signature } = await paidOrder({ status: 'created' });
  const fields = { razorpay_order_id: order.id, razorpay_payment_id: paymentId, razorpay_signature: signature };
  assert.equal((await post('verify', fields)).status, 400);
  payments.get(paymentId).status = 'captured';
  assert.equal((await post('verify', fields)).status, 200);
});

test('says so when Razorpay cannot create the order', async () => {
  failOrders = true;
  try {
    assert.equal((await post('order', good)).status, 502);
  } finally {
    failOrders = false;
  }
});

test('limits how often one visitor can start a payment', async () => {
  const me = { 'cf-connecting-ip': '192.0.2.7' };
  const statuses = [];
  for (let i = 0; i < 9; i++) statuses.push((await post('order', { ...good, amount_paise: 100 }, me)).status);
  assert.deepEqual(statuses.slice(0, 8), Array(8).fill(200));
  assert.equal(statuses[8], 429);
});

test('accepts only signed webhooks, and files only the ones about its own orders', async () => {
  const hook = (evt, secret = WEBHOOK_SECRET) =>
    fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sign(evt, secret) }, body: evt }).then((r) => r.json().then((body) => ({ status: r.status, body })));
  const payment = (id, orderId) => JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id, order_id: orderId, amount: 100, status: 'captured' } } } });

  assert.equal((await hook(payment('pay_hook', 'order_1'), 'wrong')).status, 400);
  assert.deepEqual(await hook(payment('pay_hook', 'order_1')), { status: 200, body: { ok: true } });
  // Another product's subscription payment, and an event with no payment at all.
  assert.deepEqual(await hook(payment('pay_elsewhere', 'order_not_ours')), { status: 200, body: { ok: true, ignored: true } });
  assert.deepEqual(await hook(JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1' } } } })), { status: 200, body: { ok: true, ignored: true } });

  const ledger = fs.readFileSync(path.join(dataDir, 'invoice-payments.jsonl'), 'utf8');
  assert.match(ledger, /"event":"webhook".*"payment_id":"pay_hook".*"invoice":"KRY-2026-014"/);
  assert.doesNotMatch(ledger, /pay_elsewhere|sub_1/);
});

test('unknown routes are 404s', async () => {
  assert.equal((await fetch(`${base}/refund`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/order`)).status, 404);
});

test('a restart keeps open orders payable and confirmed ones confirmed', async () => {
  const open = await paidOrder();
  const done = await paidOrder();
  const doneFields = { razorpay_order_id: done.order.id, razorpay_payment_id: done.paymentId, razorpay_signature: done.signature };
  assert.equal((await post('verify', doneFields)).status, 200);

  await stopServer();
  await startServer();

  const r = await post('verify', { razorpay_order_id: open.order.id, razorpay_payment_id: open.paymentId, razorpay_signature: open.signature });
  assert.equal(r.status, 200);
  assert.equal((await post('verify', doneFields)).status, 409);
});
