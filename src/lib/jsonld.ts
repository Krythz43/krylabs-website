// Structured data builders. Ratings are deliberately absent: the counts are too small to
// be meaningful, and a rating markup with two reviews reads worse than none.
import type { CollectionEntry } from 'astro:content';
import { site, absolute } from './site';
import type { Listing } from './appstore';

const ORG_ID = `${site.url}/#organization`;
const PERSON_ID = `${site.url}/#founder`;

export function organization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORG_ID,
    name: site.name,
    url: site.url,
    logo: absolute('/favicon.ico'),
    email: site.email,
    telephone: site.phone,
    founder: { '@id': PERSON_ID },
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      addressLocality: site.address.city,
      addressRegion: site.address.region,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },
    sameAs: [site.founder.linkedin, site.founder.github, site.founder.x],
  };
}

export function person() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': PERSON_ID,
    name: site.founder.name,
    jobTitle: 'Founder',
    worksFor: { '@id': ORG_ID },
    url: absolute('/about'),
    image: absolute('/og/about.png'),
    sameAs: [site.founder.linkedin, site.founder.github, site.founder.x],
    alumniOf: { '@type': 'CollegeOrUniversity', name: 'IIT Kharagpur' },
  };
}

export function website() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    url: site.url,
    publisher: { '@id': ORG_ID },
  };
}

export function softwareApplication(app: CollectionEntry<'apps'>, store: Listing | undefined, screenshotUrls: string[]) {
  const d = app.data;
  const os = d.platforms.map((p) => ({ iPhone: 'iOS', iPad: 'iPadOS', Mac: 'macOS', Android: 'Android' })[p] ?? p);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: d.name,
    url: absolute(`/${app.id}`),
    description: d.summary,
    applicationCategory: store?.genres?.[0] ? `${store.genres[0]}Application` : 'MobileApplication',
    operatingSystem: os.join(', '),
    image: absolute(`/og/${app.id}.png`),
    screenshot: screenshotUrls,
    author: { '@id': ORG_ID },
    ...(store
      ? {
          softwareVersion: store.version,
          dateModified: store.updated,
          datePublished: store.released,
          downloadUrl: store.storeUrl,
          offers: { '@type': 'Offer', price: store.price, priceCurrency: store.currency },
        }
      : {}),
  };
}

export function blogPosting(post: CollectionEntry<'posts'>) {
  const d = post.data;
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: d.title,
    description: d.description,
    datePublished: d.date.toISOString().slice(0, 10),
    ...(d.updated ? { dateModified: d.updated.toISOString().slice(0, 10) } : {}),
    author: { '@id': PERSON_ID },
    publisher: { '@id': ORG_ID },
    image: absolute(`/og/writing-${post.id}.png`),
    mainEntityOfPage: absolute(`/writing/${post.id}`),
  };
}
