// Open Graph images, rendered at build time. satori lays out a small element tree with
// the site's own typefaces, resvg rasterises the SVG, and the endpoint in
// src/pages/og/[slug].png.ts serves the PNG. No browser involved, so it runs on the droplet.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import palette from './palette.json';
// The same latin subsets the stylesheet uses, as WOFF (satori reads TTF/OTF/WOFF, not
// WOFF2), inlined by Vite so rendering depends on no file path or working directory.
import interRegular from '@fontsource/inter/files/inter-latin-400-normal.woff?inline';
import interSemiBold from '@fontsource/inter/files/inter-latin-600-normal.woff?inline';
import serifRegular from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff?inline';

export interface OgSpec {
  /** Small line above the title. */
  kicker: string;
  title: string;
  /** One sentence under the title; at most four lines beside a strip, two without. */
  description?: string;
  /** Path on disk of an app icon (PNG or JPEG) to show at the top left. */
  iconPath?: string;
  /** Up to three phone screenshots (WebP bytes) for the right-hand strip. */
  screenshots?: Buffer[];
}

// "data:font/woff;base64,..." → ArrayBuffer, once per font.
function font(dataUri: string): ArrayBuffer {
  const b = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
const FONTS = [
  { name: 'Inter', data: font(interRegular), weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: font(interSemiBold), weight: 600 as const, style: 'normal' as const },
  { name: 'Instrument Serif', data: font(serifRegular), weight: 400 as const, style: 'normal' as const },
];

// resvg decodes PNG and JPEG, not WebP. Screenshots are opaque, so JPEG is fine; icons
// can have transparent corners, so they stay PNG (JPEG would paint those black). Each
// encode is remembered for the build, since the home card reuses the app cards' shots.
const encoded = new Map<string, Promise<string>>();
function remember(key: string, make: () => Promise<Buffer>, mime: string): Promise<string> {
  let p = encoded.get(key);
  if (!p) {
    p = make().then((buf) => `data:${mime};base64,${buf.toString('base64')}`);
    encoded.set(key, p);
  }
  return p;
}
function jpegUri(bytes: Buffer, width: number): Promise<string> {
  const key = `jpeg:${width}:${bytes.length}:${bytes.subarray(0, 64).toString('hex')}`;
  return remember(key, () => sharp(bytes).resize({ width }).jpeg({ quality: 82 }).toBuffer(), 'image/jpeg');
}
function pngUri(file: string, width: number): Promise<string> {
  return remember(`png:${width}:${file}`, () => sharp(file).resize({ width }).png().toBuffer(), 'image/png');
}

// satori takes React-shaped element objects; a tiny helper keeps the tree readable.
// A childless element must get `undefined`, not `[]`: satori treats any non-string,
// truthy `children` on a <div> as "has children" and then demands display: flex.
type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, props: Record<string, unknown>, ...children: unknown[]): Node => ({
  type,
  props: {
    ...props,
    children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
  },
});

export async function renderOg(spec: OgSpec): Promise<Buffer> {
  const [shots, icon] = await Promise.all([
    Promise.all((spec.screenshots ?? []).slice(0, 3).map((b) => jpegUri(b, 300))),
    spec.iconPath ? pngUri(spec.iconPath, 160) : null,
  ]);
  const hasStrip = shots.length > 0;
  // With a strip, the text column stops where the phones start (three 200px shots with
  // 20px gaps, hanging 40px off the right edge, begin at x = 600).
  const columnWidth = hasStrip ? 580 : 1200;
  const textWidth = columnWidth - 72 - 20;

  const tree = h(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        background: palette.paper,
        color: palette.ink,
        fontFamily: 'Inter',
        position: 'relative',
        overflow: 'hidden',
      },
    },
    // Text column
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          width: columnWidth,
          padding: '64px 0 56px 72px',
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        icon
          ? h('img', { src: icon, width: 80, height: 80, style: { borderRadius: 18, marginBottom: 28 } })
          : h('div', { style: { fontSize: 24, fontWeight: 600, marginBottom: 28 } }, 'Krylabs'),
        h('div', { style: { fontSize: 24, color: palette.muted, marginBottom: 18, maxWidth: textWidth } }, spec.kicker),
        h(
          'div',
          {
            style: {
              fontFamily: 'Instrument Serif',
              fontSize: spec.title.length > 34 ? 66 : 80,
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
              maxWidth: hasStrip ? textWidth : 1000,
            },
          },
          spec.title,
        ),
        spec.description
          ? h(
              'div',
              {
                style: {
                  fontSize: 26,
                  lineHeight: 1.4,
                  color: palette.ink2,
                  marginTop: 26,
                  maxWidth: hasStrip ? textWidth : 900,
                  // Four lines beside a strip, two on a wide card; the height cap is the
                  // guarantee, the clamp adds the ellipsis when satori applies it.
                  lineClamp: hasStrip ? 4 : 2,
                  maxHeight: Math.round(26 * 1.4 * (hasStrip ? 4 : 2)),
                  overflow: 'hidden',
                },
              },
              spec.description,
            )
          : null,
      ),
    ),
    // Footer, pinned so a long description can never push into it.
    h(
      'div',
      { style: { position: 'absolute', left: 72, bottom: 56, display: 'flex', alignItems: 'center', fontSize: 22, color: palette.muted } },
      h('div', { style: { width: 10, height: 10, borderRadius: 10, background: palette.accent, marginRight: 14 } }),
      'krylabs.com',
    ),
    // Screenshot strip: three phones, overlapping the bottom edge so they read as a peek.
    hasStrip
      ? h(
          'div',
          {
            style: {
              position: 'absolute',
              right: -40,
              top: 84,
              display: 'flex',
              gap: 20,
              alignItems: 'flex-start',
            },
          },
          ...shots.map((src, i) =>
            h('img', {
              src,
              width: 200,
              style: {
                borderRadius: 26,
                border: `1px solid ${palette.lineStrong}`,
                marginTop: i === 1 ? 54 : 0,
                boxShadow: '0 24px 60px rgba(23,22,15,0.18)',
              },
            }),
          ),
        )
      : null,
  );

  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
