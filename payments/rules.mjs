// What krylabs.com/pay sells, and what a buyer must give. payments/server.mjs enforces this; the
// script on src/pages/pay.astro imports the same module, so the page shows the price the server
// charges, catches a mistake next to its field with the same words, and the two never disagree.
//
// Only these fixed-price offers are paid here. Anything else is quoted and invoiced by hand.

export const CURRENCY = 'USD';

/** The offers, by the id the page sends. `cents` is what is charged; `was` is shown struck through. */
export const OFFERS = {
  audit: { name: 'iOS App Audit', cents: 200_00 },
  call: { name: '30-minute call', cents: 79_00, was: 99_00 },
};

export const MAX_LENGTH = { name: 80, email: 120, phone: 20 };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?\d{8,15}$/;

/** The offer with this id, or null. Own keys only, so "constructor" or "__proto__" is not an offer. */
export const offerFor = (id) => (typeof id === 'string' && Object.hasOwn(OFFERS, id) ? OFFERS[id] : null);

/** 20000 → "$200", 7950 → "$79.50". */
export const dollars = (cents) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);

/** The buyer's details as they are checked and stored: spaces collapsed, the phone's formatting removed. */
export function tidy(raw) {
  const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  return {
    offer: text(raw.offer),
    name: text(raw.name),
    email: text(raw.email),
    phone: text(raw.phone).replace(/[\s()-]/g, ''),
  };
}

/** `[field, message]` for the first thing wrong with tidied details, or null when they will do. */
export function problemWith(d) {
  if (!offerFor(d.offer)) return ['offer', 'Pick the audit or the call.'];
  const long = Object.keys(MAX_LENGTH).find((k) => d[k].length > MAX_LENGTH[k]);
  if (long) return [long, `Keep this to ${MAX_LENGTH[long]} characters.`];
  if (d.name.length < 2) return ['name', 'Add your name.'];
  if (!EMAIL.test(d.email)) return ['email', 'Check your email address.'];
  if (d.phone && !PHONE.test(d.phone)) return ['phone', 'Check your phone number, or leave it empty.'];
  return null;
}
