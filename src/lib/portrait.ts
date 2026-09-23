// The founder's portrait as an absolute URL, for Person JSON-LD. 520px is the largest size
// Founder.astro renders, so this resolves to a file the pages already emit.
import { getImage } from 'astro:assets';
import photo from '../assets/krithick-santhosh.jpg';
import { absolute } from './site';

export async function portraitUrl(): Promise<string> {
  const img = await getImage({ src: photo, width: 520 });
  return absolute(img.src);
}
