// Structured data builders. Ratings are deliberately absent: the counts are too small to
// be meaningful, and a rating markup with two reviews reads worse than none.
import type { CollectionEntry } from 'astro:content';
import { site, absolute, isoDate } from './site';
import type { Listing } from './appstore';

const ORG_ID = `${site.url}/#organization`;
const PERSON_ID = `${site.url}/#founder`;

// App Store genres → the schema.org applicationCategory values Google recognises.
const CATEGORY: Record<string, string> = {
  Productivity: 'UtilitiesApplication',
  Utilities: 'UtilitiesApplication',
  Lifestyle: 'LifestyleApplication',
  'Food & Drink': 'LifestyleApplication',
  'Social Networking': 'SocialNetworkingApplication',
  'Health & Fitness': 'HealthApplication',
  Entertainment: 'EntertainmentApplication',
  'Photo & Video': 'MultimediaApplication',
  Music: 'MultimediaApplication',
  Education: 'EducationalApplication',
  Business: 'BusinessApplication',
  Finance: 'FinanceApplication',
  Travel: 'TravelApplication',
  Shopping: 'ShoppingApplication',
  Games: 'GameApplication',
  Reference: 'ReferenceApplication',
};

const OS: Record<string, string> = { iPhone: 'iOS', iPad: 'iPadOS', Mac: 'macOS', Android: 'Android' };

export function organization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORG_ID,
    name: site.name,
    url: site.url,
    logo: absolute('/logo.png'),
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

/** @param image absolute URL of the founder's portrait (see src/lib/portrait.ts). */
export function person(image: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': PERSON_ID,
    name: site.founder.name,
    jobTitle: 'Founder',
    worksFor: { '@id': ORG_ID },
    url: absolute('/about/'),
    image,
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
  const genre = store?.genres?.find((g) => CATEGORY[g]);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: d.name,
    url: absolute(`/${app.id}/`),
    description: d.summary,
    // Apps without a listing yet are all planners or tools, so Utilities is the honest default.
    applicationCategory: genre ? CATEGORY[genre] : 'UtilitiesApplication',
    operatingSystem: d.platforms.map((p) => OS[p] ?? p).join(', '),
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
    datePublished: isoDate(d.date),
    ...(d.updated ? { dateModified: isoDate(d.updated) } : {}),
    author: { '@id': PERSON_ID },
    publisher: { '@id': ORG_ID },
    image: absolute(`/og/writing-${post.id}.png`),
    mainEntityOfPage: absolute(`/writing/${post.id}/`),
  };
}
