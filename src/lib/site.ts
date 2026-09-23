// Facts about the studio that appear on more than one page. Change them here, not inline.
export const site = {
  name: 'Krylabs',
  url: 'https://krylabs.com',
  tagline: 'Small apps that do one thing well.',
  description:
    'Krylabs is a one-person app studio in Bengaluru. Krithick Santhosh designs, builds and ships iPhone apps (ReelMark, BubbleNest, BlockBud, CocoTree) and web products (GymWhiteBoard, LeadOven, Galentini, Comet), end to end.',
  email: 'info.krylabs@gmail.com',
  phone: '+91-8597165755',
  founder: {
    name: 'Krithick Santhosh',
    role: 'Founder and developer',
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

export const socials = [
  { label: 'LinkedIn', href: site.founder.linkedin },
  { label: 'GitHub', href: site.founder.github },
  { label: 'X', href: site.founder.x },
];

/** Absolute URL for a site path, for canonical links, OG tags and JSON-LD. */
export function absolute(path: string): string {
  return new URL(path, site.url).href;
}

/** "2026-08-10" → "August 2026". Month granularity is all a listing date needs. */
export function monthYear(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "2026-08-10" → "10 August 2026". */
export function longDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
