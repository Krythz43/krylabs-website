// What an invoice payment must look like, and what a payer is told when it does not.
// payments/server.mjs enforces this; the script on src/pages/pay.astro imports the same module,
// so the page catches a mistake next to its field before anything is sent, with the same words,
// and the two can never disagree.

export const CURRENCY = 'INR';
/** ₹1, Razorpay's own minimum. */
export const MIN_PAISE = 100;
/** ₹5,00,000 in one payment. Larger invoices are split, or paid some other way by arrangement. */
export const MAX_PAISE = 5_00_000_00;
export const MAX_LENGTH = { invoice: 40, name: 80, email: 120, phone: 20 };

const INVOICE = /^[A-Za-z0-9][A-Za-z0-9 #/._-]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?\d{8,15}$/;

/** 50000000 → "₹5,00,000", 4500050 → "₹45,000.50". */
export const rupees = (paise) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);

/** A total as an invoice prints it ("45000", "45,000.00", "₹ 45,000/-", "INR 45,000", "Rs. 45,000") in paise, else NaN. */
export function parseRupees(text) {
  const s = String(text ?? '')
    .trim()
    .replace(/\/-$/, '')
    .replace(/^(?:inr|rs\.?|₹)\s*/i, '')
    .replace(/[,\s]/g, '');
  return /^\d{1,9}(\.\d{1,2})?$/.test(s) ? Math.round(parseFloat(s) * 100) : NaN;
}

/** The payer's details as they are checked and stored: spaces collapsed, the phone's formatting removed. */
export function tidy(raw) {
  const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  return {
    invoice: text(raw.invoice),
    amount_paise: raw.amount_paise,
    name: text(raw.name),
    email: text(raw.email),
    phone: text(raw.phone).replace(/[\s()-]/g, ''),
  };
}

/** `[field, message]` for the first thing wrong with tidied details, or null when they will do. */
export function problemWith(d) {
  const long = Object.keys(MAX_LENGTH).find((k) => d[k].length > MAX_LENGTH[k]);
  if (long) return [long, `Keep this to ${MAX_LENGTH[long]} characters.`];
  if (!d.invoice) return ['invoice', 'Add the invoice number.'];
  if (!INVOICE.test(d.invoice)) return ['invoice', 'Check the invoice number: letters, numbers, spaces and - / . _ # only.'];
  const paise = d.amount_paise;
  if (!Number.isSafeInteger(paise) || paise < MIN_PAISE) return ['amount', 'Enter the total on the invoice, like 45000.'];
  if (paise > MAX_PAISE) return ['amount', `One payment can be up to ${rupees(MAX_PAISE)}. Write to us for more.`];
  if (d.name.length < 2) return ['name', 'Add your name.'];
  if (!EMAIL.test(d.email)) return ['email', 'Check your email address.'];
  if (d.phone && !PHONE.test(d.phone)) return ['phone', 'Check your phone number, or leave it empty.'];
  return null;
}
