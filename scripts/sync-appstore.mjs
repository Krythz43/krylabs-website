// Pulls each app's public App Store listing (version, release date, price, screenshots)
// into the repo so the site can show real product imagery without any runtime dependency.
//
//   npm run sync        # refresh src/data/appstore.json and src/assets/appstore/<slug>/
//
// Everything it writes is committed: builds on the droplet never touch the network, and
// a listing change is a normal reviewable diff. Screenshot files are 640px WebP straight
// from Apple's CDN (the `640x0w.webp` size variant), which Astro then resizes per breakpoint.
//
// The run is all-or-nothing: every download lands in a temp directory first, and the
// committed files are only replaced once all of them succeeded.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_JSON = path.join(ROOT, 'src/data/appstore.json');
const OUT_DIR = path.join(ROOT, 'src/assets/appstore');
const COUNTRY = 'in';

// slug → Apple track id. The slug doubles as the content entry id and the URL path.
const APPS = {
  reelmark: 6758064805,
  bubblenest: 6743532224,
  blockbud: 6753329479,
  cocotree: 6475201153,
};

const ids = Object.values(APPS).join(',');
const res = await fetch(`https://itunes.apple.com/lookup?id=${ids}&country=${COUNTRY}`);
if (!res.ok) throw new Error(`lookup failed: ${res.status}`);
const { results } = await res.json();
const byId = new Map(results.map((r) => [r.trackId, r]));

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'appstore-'));
const apps = {};
try {
  for (const [slug, id] of Object.entries(APPS)) {
    const r = byId.get(id);
    if (!r) throw new Error(`no listing for ${slug} (${id})`);

    const dir = path.join(tmp, slug);
    await fs.mkdir(dir, { recursive: true });

    const screenshots = [];
    for (const [i, url] of r.screenshotUrls.entries()) {
      // The lookup hands back 320x480 JPEG thumbs; swapping the size segment for
      // `640x0w.webp` yields a 640px-wide WebP at the screenshot's native aspect ratio.
      const src = url.replace(/\/[^/]+$/, '/640x0w.webp');
      const img = await fetch(src);
      if (!img.ok) throw new Error(`screenshot ${i} for ${slug}: ${img.status}`);
      const file = `${String(i + 1).padStart(2, '0')}.webp`;
      await fs.writeFile(path.join(dir, file), Buffer.from(await img.arrayBuffer()));
      screenshots.push(file);
    }

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

  // Everything fetched: swap the directories in, then write the snapshot that describes them.
  for (const slug of Object.keys(APPS)) {
    const dest = path.join(OUT_DIR, slug);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.cp(path.join(tmp, slug), dest, { recursive: true });
  }
  const snapshot = { syncedAt: new Date().toISOString().slice(0, 10), apps };
  await fs.writeFile(OUT_JSON, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, OUT_JSON)}`);
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
