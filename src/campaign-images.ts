import eldenSmall from './assets/campaigns/elden-ring-640.webp';
import eldenLarge from './assets/campaigns/elden-ring-1280.webp';
import eldenPreview from './assets/campaigns/elden-ring-preview.webp';
import wukongSmall from './assets/campaigns/black-myth-wukong-640.webp';
import wukongLarge from './assets/campaigns/black-myth-wukong-1280.webp';
import wukongPreview from './assets/campaigns/black-myth-wukong-preview.webp';
import cyberpunkSmall from './assets/campaigns/cyberpunk-2077-640.webp';
import cyberpunkLarge from './assets/campaigns/cyberpunk-2077-1280.webp';
import cyberpunkPreview from './assets/campaigns/cyberpunk-2077-preview.webp';

// Existing banner records keep their original URLs. Only these bundled game
// images are replaced; images uploaded or configured by an admin stay intact.
const gameArt = new Map([
  ['1245620', { small: eldenSmall, large: eldenLarge, preview: eldenPreview }],
  ['2358720', { small: wukongSmall, large: wukongLarge, preview: wukongPreview }],
  ['1091500', { small: cyberpunkSmall, large: cyberpunkLarge, preview: cyberpunkPreview }],
]);
export const campaignImageSizes = '(max-width: 700px) 100vw, (max-width: 1100px) 75vw, 1000px';

export function campaignImage(image: string) {
  const match = /^https:\/\/shared\.fastly\.steamstatic\.com\/store_item_assets\/steam\/apps\/(\d+)\/library_hero\.jpg(?:\?.*)?$/.exec(image);
  const art = match && gameArt.get(match[1]);
  return art ? { src: art.large, srcSet: `${art.small} 640w, ${art.large} 1280w`, fallback: art.small, preview: art.preview }
    : { src: image, srcSet: undefined, fallback: undefined, preview: undefined };
}
