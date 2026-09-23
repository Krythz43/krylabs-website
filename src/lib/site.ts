// Facts about the studio that appear on more than one page. Change them here, not inline.
export const site = {
  name: 'Krylabs',
  url: 'https://krylabs.com',
  tagline: 'Small apps that do one thing well.',
  // Deliberately does not list the apps: the collections change, this string would not.
  description:
    'Krylabs is a one-person app studio in Bengaluru. Krithick Santhosh designs, builds and ships iPhone apps and web products, end to end.',
  email: 'info.krylabs@gmail.com',
  phone: '+91-8597165755',
  founder: {
    name: 'Krithick Santhosh',
    role: 'Founder and developer',
    education: 'IIT Kharagpur',
    /** Employers, most recent last, with what he worked on there. */
    previously: [
      { name: 'PhonePe', on: 'payments' },
      { name: 'Blinkit', on: 'quick commerce' },
    ],
    linkedin: 'https://www.linkedin.com/in/krithick-santhosh/',
    github: 'https://github.com/Krythz43',
    x: 'https://x.com/krithick_n',
  },
  address: {
    street: 'Palm 102, SJR Park Vista, Off Harlur Road',
    city: 'Bengaluru',
    region: 'Karnataka',
    postalCode: '560102',
    country: 'IN',
  },
} as const;

const list = new Intl.ListFormat('en', { type: 'conjunction' });

/** "Previously at PhonePe and Blinkit. IIT Kharagpur." */
export const credentials = `Previously at ${list.format(site.founder.previously.map((p) => p.name))}. ${site.founder.education}.`;

/** "payments at PhonePe and quick commerce at Blinkit", for prose. */
export const workHistory = list.format(site.founder.previously.map((p) => `${p.on} at ${p.name}`));

export const socials = [
  { label: 'LinkedIn', href: site.founder.linkedin },
  { label: 'GitHub', href: site.founder.github },
  { label: 'X', href: site.founder.x },
];

/** Absolute URL for a site path, for canonical links, OG tags and JSON-LD. */
export function absolute(path: string): string {
  return new URL(path, site.url).href;
}

/** A Date or an ISO "YYYY-MM-DD" string (a full timestamp is trimmed) → "YYYY-MM-DD". */
export function isoDate(d: Date | string): string {
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`not a date: ${JSON.stringify(d)}`);
  return s;
}

function fmt(d: Date | string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(isoDate(d) + 'T00:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

/** "2026-08-10" → "August 2026". Month granularity is all a listing date needs. */
export function monthYear(d: Date | string): string {
  return fmt(d, { month: 'long', year: 'numeric' });
}

/** "2026-08-10" → "10 August 2026". */
export function longDate(d: Date | string): string {
  return fmt(d, { day: 'numeric', month: 'long', year: 'numeric' });
}
