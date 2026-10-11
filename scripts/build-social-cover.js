// Rebuild the share graphic from the store's typography and existing artwork.
// Run locally: node scripts/build-social-cover.js
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const asset = async (path, mime) => `data:${mime};base64,${(await readFile(new URL(path, import.meta.url))).toString('base64')}`;
const font = await asset('../node_modules/@fontsource/be-vietnam-pro/files/be-vietnam-pro-vietnamese-800-normal.woff2', 'font/woff2');
const regular = await asset('../node_modules/@fontsource/be-vietnam-pro/files/be-vietnam-pro-vietnamese-400-normal.woff2', 'font/woff2');
const pictures = await Promise.all([
  asset('../public/images/products/steam-wallet.png', 'image/png'),
  asset('../public/images/products/valorant.png', 'image/png'),
  asset('../public/images/products/genshin-impact.jpg', 'image/jpeg'),
]);
const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="vi"><meta charset="utf-8"><style>
  @font-face{font-family:Brand;src:url('${font}');font-weight:800}
  @font-face{font-family:Brand;src:url('${regular}');font-weight:400}
  *{box-sizing:border-box}body{margin:0;background:#101114;color:#f1f1f3;font-family:Brand,Arial;overflow:hidden}
  header{position:absolute;left:56px;right:56px;top:38px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #303137;padding-bottom:28px}
  .logo{display:flex;align-items:center;gap:16px;font-size:29px;font-weight:800;letter-spacing:-1.5px}.mark{font-size:44px;line-height:1;color:#f07947;letter-spacing:-4px;transform:skew(-8deg);margin-right:10px}.domain{font-size:17px;color:#9399a6}
  main{position:absolute;left:56px;top:188px;width:550px}.kicker{font-size:12px;letter-spacing:3px;color:#e99b73;font-weight:800}
  h1{font-size:55px;line-height:1.25;letter-spacing:-2.8px;margin:22px 0 24px;font-weight:800}h1 span{color:#f2a278}p{font-size:17px;line-height:1.9;color:#a4aab7;margin:0}
  .cards{position:absolute;left:632px;top:180px;display:flex;gap:16px;align-items:flex-start}
  .card{width:158px;flex:none;background:#202127;border:1px solid #3a3c43;border-radius:9px;overflow:hidden;box-shadow:0 16px 28px #0005}.card:nth-child(1){margin-top:64px}.card:nth-child(2){margin-top:32px}
  .card img{display:block;width:100%;height:230px;object-fit:cover}.card:nth-child(3) img{object-position:60% center}.caption{padding:15px 12px;font-size:12px;font-weight:800}.caption small{display:block;font-size:10px;font-weight:400;color:#939ba8;margin-top:6px}
  footer{position:absolute;left:56px;right:56px;bottom:34px;display:flex;gap:22px;align-items:center;border-top:1px solid #303137;padding-top:24px;color:#b1b5bf;font-size:13px}footer i{width:4px;height:4px;border-radius:50%;background:#626672}footer b{margin-left:auto;color:#e99b73;font-size:18px}
  </style><header><div class="logo"><span class="mark">//</span>KEYNEST</div><span class="domain">keynest.store</span></header>
  <main><div class="kicker">CỬA HÀNG SỐ CỦA BẠN</div><h1>Game hay.<br><span>Trải nghiệm mới.</span></h1><p>Khám phá game, nạp thẻ và dịch vụ số.<br>Mọi lựa chọn, cùng KEYNEST.</p></main>
  <div class="cards">${pictures.map((src, i) => `<div class="card"><img src="${src}"><div class="caption">${['Steam Wallet','VALORANT','Genshin Impact'][i]}<small>${['Gift card','Nạp game','Nạp game'][i]}</small></div></div>`).join('')}</div>
  <footer><span>Game key</span><i></i><span>Gift card</span><i></i><span>Nạp game</span><i></i><span>MMO & Proxy</span><b>↗</b></footer></html>`);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode())); });
  await mkdir(new URL('../public/images/share/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../public/images/share/keynest-v2.jpg', import.meta.url)), type: 'jpeg', quality: 94 });
} finally { await browser.close(); }
