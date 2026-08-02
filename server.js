// Static file server for the built Astro site in ./dist.
//
// Astro is configured with `build.format: 'directory'`, so pages land at
// <route>/index.html. This resolves a request in three steps — exact file,
// then <path>/index.html, then <path>.html — which covers the Astro pages,
// the legacy pages copied into public/ at directory paths, and the mirrored
// blockbud/ + oneatatime/ sites that link to each other with bare filenames.
//
// Zero dependencies on purpose: the repo stays a static site with no runtime
// packages to keep patched. Node's stdlib is the only requirement.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 3070;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
};

// Astro fingerprints everything under /_astro, so those are safe to pin. HTML
// must stay revalidated or a deploy would not be visible until caches expire.
function cacheControl(urlPath, ext) {
  if (urlPath.startsWith('/_astro/')) return 'public, max-age=31536000, immutable';
  if (ext === '.html') return 'public, max-age=0, must-revalidate';
  return 'public, max-age=3600';
}

async function statFile(p) {
  try {
    const s = await fsp.stat(p);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

// Returns an absolute path inside ROOT, or null if it escapes / does not exist.
async function resolve(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const abs = path.resolve(ROOT, '.' + path.posix.normalize(decoded));
  // Containment check: `dist` itself, or anything genuinely beneath it.
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;

  return (
    ((await statFile(abs)) && abs) ||
    ((await statFile(path.join(abs, 'index.html'))) && path.join(abs, 'index.html')) ||
    ((await statFile(abs + '.html')) && abs + '.html') ||
    null
  );
}

function send(req, res, status, file, stat) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(status, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cacheControl(req.__urlPath || '', ext),
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }

  let urlPath;
  try {
    urlPath = new URL(req.url, 'http://localhost').pathname;
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  req.__urlPath = urlPath;

  try {
    const file = await resolve(urlPath);
    if (file) {
      send(req, res, 200, file, await fsp.stat(file));
      return;
    }

    // Astro emits dist/404.html; serve it with a real 404 so crawlers see it.
    const notFound = path.join(ROOT, '404.html');
    const nfStat = await statFile(notFound);
    if (nfStat) {
      send(req, res, 404, notFound, nfStat);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
  } catch (err) {
    console.error(`[krylabs-website] ${urlPath} ->`, err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Internal Server Error');
  }
});

if (!fs.existsSync(ROOT)) {
  console.error(`[krylabs-website] ${ROOT} is missing — run \`npm run build\` first.`);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`[krylabs-website] serving ${ROOT} on http://${HOST}:${PORT}`);
});
