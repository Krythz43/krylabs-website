// The founder's portrait as an absolute URL, for Person JSON-LD. Goes through the image
// pipeline so it is the same optimised file the pages render, not the source JPEG.
import { getImage } from 'astro:assets';
import photo from '../assets/krithick-santhosh.jpg';
import { absolute } from './site';

export async function portraitUrl(): Promise<string> {
  const img = await getImage({ src: photo, width: 800 });
  return absolute(img.src);
}
