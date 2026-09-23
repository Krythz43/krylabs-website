// Pulls each app's public App Store listing (version, release date, price, screenshots)
// into the repo so the site can show real product imagery without any runtime dependency.
//
//   npm run sync        # refresh src/assets/appstore/ (appstore.json + <slug>/*.webp)
//
// Which apps: every src/content/apps/<slug>.md with a `storeId:` in its frontmatter. The
// file name is the slug, so the content entry is the only place an app is declared.
//
// Everything it writes is committed: builds on the droplet never touch the network, and
// a listing change is a normal reviewable diff. Screenshot files are 640px WebP straight
// from Apple's CDN (the `640x0w.webp` size variant), which Astro then resizes per breakpoint.
//
// The run is all-or-nothing. The snapshot JSON lives inside the screenshot tree, so the
// whole result is one directory: it is built under .astro/ (gitignored, same filesystem),
// the old tree is moved aside, the new one renamed into place, and the old one put back
// if that rename fails. An interrupted run leaves either the old tree or the new one.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_DIR = path.join(ROOT, 'src/content/apps');
const OUT_DIR = path.join(ROOT, 'src/assets/appstore');
const STAGE = path.join(ROOT, '.astro/appstore-sync');
const NEW_DIR = path.join(STAGE, 'new');
const OLD_DIR = path.join(STAGE, 'old');
const COUNTRY = 'in';

async function exists(p) {
  return fs.access(p).then(() => true, () => false);
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

// slug → Apple track id, read from the content entries' frontmatter.
const APPS = {};
for (const file of (await fs.readdir(CONTENT_DIR)).filter((f) => f.endsWith('.md')).sort()) {
  const text = await fs.readFile(path.join(CONTENT_DIR, file), 'utf8');
  const m = text.match(/^storeId:\s*(\d+)\s*$/m);
  if (m) APPS[file.replace(/\.md$/, '')] = Number(m[1]);
}
if (Object.keys(APPS).length === 0) throw new Error(`no storeId found in ${CONTENT_DIR}`);

// A previous run that died between "old moved aside" and "new renamed in" leaves the old
// tree stranded here. Put it back before doing anything else.
if (!(await exists(OUT_DIR)) && (await exists(OLD_DIR))) {
  await fs.rename(OLD_DIR, OUT_DIR);
  console.warn('restored src/assets/appstore from an interrupted run');
}
await fs.rm(STAGE, { recursive: true, force: true });

const ids = Object.values(APPS).join(',');
const res = await fetch(`https://itunes.apple.com/lookup?id=${ids}&country=${COUNTRY}`);
if (!res.ok) throw new Error(`lookup failed: ${res.status}`);
const { results } = await res.json();
const byId = new Map(results.map((r) => [r.trackId, r]));

const apps = {};
try {
  for (const [slug, id] of Object.entries(APPS)) {
    const r = byId.get(id);
    if (!r) throw new Error(`no listing for ${slug} (${id})`);

    const dir = path.join(NEW_DIR, slug);
    await fs.mkdir(dir, { recursive: true });

    // The lookup hands back 320x480 JPEG thumbs; swapping the size segment for
    // `640x0w.webp` yields a 640px-wide WebP at the screenshot's native aspect ratio.
    const screenshots = r.screenshotUrls.map((_, i) => `${String(i + 1).padStart(2, '0')}.webp`);
    await Promise.all(
      r.screenshotUrls.map((url, i) =>
        download(url.replace(/\/[^/]+$/, '/640x0w.webp'), path.join(dir, screenshots[i])),
      ),
    );

    apps[slug] = {
      id,
      name: r.trackName,
      bundleId: r.bundleId,
      version: r.version,
      released: r.releaseDate.slice(0, 10),
      updated: r.currentVersionReleaseDate.slice(0, 10),
      minimumOs: r.minimumOsVersion,
      price: r.price,
      currency: r.currency,
      formattedPrice: r.formattedPrice,
      genres: r.genres,
      storeUrl: r.trackViewUrl.split('?')[0],
      screenshots,
    };
    console.log(`${slug}: v${r.version} (${apps[slug].updated}), ${screenshots.length} screenshots`);
  }

  // Everything fetched: the snapshot goes into the same tree, then one rename swaps it in.
  const snapshot = { syncedAt: new Date().toISOString().slice(0, 10), apps };
  await fs.writeFile(path.join(NEW_DIR, 'appstore.json'), JSON.stringify(snapshot, null, 2) + '\n');
  if (await exists(OUT_DIR)) await fs.rename(OUT_DIR, OLD_DIR);
  try {
    await fs.rename(NEW_DIR, OUT_DIR);
  } catch (e) {
    // Put the old tree back whatever happens, and report the original failure.
    try {
      if (await exists(OLD_DIR)) await fs.rename(OLD_DIR, OUT_DIR);
    } catch (restoreError) {
      console.error('could not restore the previous tree:', restoreError);
    }
    throw e;
  }
  console.log(`wrote ${path.relative(ROOT, OUT_DIR)}/`);
} finally {
  // Staging (including the old tree) goes only once the new tree is in place.
  if (await exists(OUT_DIR)) await fs.rm(STAGE, { recursive: true, force: true });
}
