// Reads Caddy's access log for krylabs.com and prints what the site needs to know: how many
// people visited, which pages, where they came from, and how often a contact or store link
// was pressed (the /e.gif?n=<name> requests the site's script sends, see src/layouts/Base.astro).
//
//   ssh leadoven 'cat /var/log/caddy/krylabs-website.log' | npm run --silent traffic
//   npm run --silent traffic -- --days 7 /var/log/caddy/krylabs-website.log   # on the droplet
//
// Rolled logs (*.log.gz) can be passed as files too. Nothing is stored or sent anywhere:
// addresses are only used in memory, to tell one visitor from another within a day.
//
// Who counts as a person: most requests for a page come from crawlers that send an ordinary
// browser's user agent, so the user agent alone proves nothing. A browser also fetches the
// page's stylesheet, script or fonts; a crawler reading the HTML does not. A visit is counted
// only when the same address and browser fetched one that day. Headless browsers (store
// review, link previews, SEO tools) still get through, so read the totals as a ceiling. This undercounts slightly
// (a returning visitor whose cache is still warm) and that is the right direction to err.
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const daysAt = args.indexOf('--days');
const days = daysAt >= 0 ? Number(args[daysAt + 1]) : 30;
const files = args.filter((a, i) => !a.startsWith('--') && i !== daysAt + 1);
if (!Number.isFinite(days) || days <= 0) throw new Error('--days needs a positive number');
if (files.length === 0 && process.stdin.isTTY) {
  console.error('Pass a log file, or pipe the log in. See the comment at the top of scripts/traffic.mjs.');
  process.exit(1);
}

const HOSTS = new Set(['krylabs.com', 'www.krylabs.com']);
// Anything that announces itself as automated, plus the libraries scripts are written with.
const BOT = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|go-http|java\/|headless|lighthouse|facebookexternalhit|whatsapp|scrapy|axios|node-fetch|okhttp|^$/i;
const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

const header = (req, name) => req.headers?.[name]?.[0] ?? '';
const bump = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
const visitorsOf = (map, key, who) => (map.get(key) ?? map.set(key, new Set()).get(key)).add(who);

const hits = []; // every page request that did not announce itself as a bot
const loaded = new Set(); // visitors (one address + browser per day) that fetched an asset
const clicks = new Map();
let declaredBots = 0;

function read(line) {
  const at = line.indexOf('{');
  if (at < 0) return;
  let entry;
  try {
    entry = JSON.parse(line.slice(at));
  } catch {
    return; // a line cut off mid-write
  }
  const req = entry.request;
  if (!req || !HOSTS.has(req.host)) return;
  const day = line.slice(0, 10).replaceAll('/', '-');
  if (day < since) return;
  const ua = header(req, 'User-Agent');
  const path = req.uri.split('?')[0];
  const who = createHash('sha256').update(`${day}|${header(req, 'Cf-Connecting-Ip') || req.remote_ip}|${ua}`).digest('base64');

  if (/\.(css|js|woff2?)$/.test(path)) return void loaded.add(who);
  if (path === '/e.gif') {
    const name = new URLSearchParams(req.uri.split('?')[1] ?? '').get('n');
    if (name && !BOT.test(ua)) bump(clicks, name);
    return;
  }
  const html = (entry.resp_headers?.['Content-Type']?.[0] ?? '').startsWith('text/html');
  if (req.method !== 'GET' || entry.status !== 200 || !html) return;
  if (BOT.test(ua)) return void declaredBots++;

  const ref = header(req, 'Referer');
  let from = 'direct or unknown';
  try {
    if (ref) from = new URL(ref).host;
  } catch {}
  hits.push({
    who,
    day,
    page: path.replace(/\/index\.html$/, '/').replace(/([^/])$/, '$1/'),
    country: header(req, 'Cf-Ipcountry') || 'unknown',
    from,
  });
}

async function readAll(stream) {
  for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) read(line);
}
if (files.length === 0) await readAll(process.stdin);
for (const file of files) {
  const raw = fs.createReadStream(file);
  await readAll(file.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw);
}

const pageVisitors = new Map();
const dayVisitors = new Map();
const allVisitors = new Set();
const referrers = new Map();
const countries = new Map();
let views = 0;
for (const hit of hits) {
  if (!loaded.has(hit.who)) continue;
  views++;
  allVisitors.add(hit.who);
  visitorsOf(dayVisitors, hit.day, hit.who);
  visitorsOf(pageVisitors, hit.page, hit.who);
  visitorsOf(countries, hit.country, hit.who);
  // A page reached from another page of the site says nothing about where the visit began.
  if (!HOSTS.has(hit.from)) visitorsOf(referrers, hit.from, hit.who);
}

const top = (map, n = 12) =>
  [...map]
    .map(([k, v]) => [k, v instanceof Set ? v.size : v])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
const table = (title, rows) => {
  console.log(`\n${title}`);
  if (rows.length === 0) return console.log('  none');
  const width = Math.max(...rows.map(([k]) => String(k).length));
  for (const [k, v] of rows) console.log(`  ${String(k).padEnd(width)}  ${v}`);
};

console.log(`krylabs.com, last ${days} days (since ${since})`);
console.log(`  ${allVisitors.size} visits (one per person per day), ${views} page views`);
console.log(`  left out: ${hits.length - views} page requests that never loaded the page's assets, ${declaredBots} from declared bots`);
table('Visits per day', [...dayVisitors].map(([d, s]) => [d, s.size]).sort());
table('Pages, by visits', top(pageVisitors));
table('Came from, by visits', top(referrers));
table('Countries, by visits', top(countries, 8));
table('Clicks on contact and store links', top(clicks, 30));
