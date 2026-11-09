// What an invoice payment must look like. payments/server.mjs enforces these; src/pages/pay.astro
// reads the same values at build time, so the page points at a mistake before anything is sent
// and the two can never disagree.

export const CURRENCY = 'INR';
/** ₹1, Razorpay's own minimum. */
export const MIN_PAISE = 100;
/** ₹5,00,000 in one payment. Larger invoices are split, or paid some other way by arrangement. */
export const MAX_PAISE = 5_00_000_00;

export const MAX_LENGTH = { invoice: 40, name: 80, email: 120, phone: 20 };
export const INVOICE = /^[A-Za-z0-9][A-Za-z0-9 #/._-]*$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Checked after spaces, brackets and dashes are taken out. */
export const PHONE = /^\+?\d{8,15}$/;

/** 50000000 → "₹5,00,000", 4500050 → "₹45,000.50". */
export const rupees = (paise) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: CURRENCY, minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(paise / 100);
