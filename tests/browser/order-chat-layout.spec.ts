import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('chat composer stays visible and order chat trigger has space below it', async ({ page }) => {
  const css = ['styles','dark','member','storefront','payments','feedback','product-images','orders','admin','mobile-layout','seller','order-chat'].map(name => readFileSync(`src/${name}.css`, 'utf8')).join('\n');
  for (const [width,height] of [[360,740],[390,420],[1440,900]]) {
    await page.setViewportSize({width,height});
    await page.setContent(`<style>${css}</style><div class="modal-backdrop"><section class="modal order-chat-modal">
      <div class="modal-title"><h2>Deno90991</h2><button class="icon-button">×</button></div>
      <div class="order-chat-intro"><div><strong>KN-6F5B63331315 · Product</strong><p>Order conversation</p></div></div>
      <div class="order-chat-messages">${Array.from({length:30},(_,i)=>`<article class="chat-message"><strong>Buyer</strong><p>Message ${i}</p><small>12:20</small></article>`).join('')}</div>
      <form class="order-chat-composer"><textarea aria-label="Message" rows="1" placeholder="Message"></textarea><button class="button" type="button" aria-label="Send">➤</button></form>
      <div class="order-chat-tools"><button class="button button-outline">Request refund</button></div>
    </section></div>`);
    const input = page.getByRole('textbox');
    await input.fill('Hello');
    await expect(input).toHaveCSS('resize','none');
    const bounds = await input.boundingBox();
    const send = await page.getByRole('button',{name:'Send',exact:true}).boundingBox();
    expect(bounds!.width).toBeGreaterThan(180);
    expect(send!.x).toBeGreaterThanOrEqual(bounds!.x + bounds!.width);
    expect(send!.y + send!.height).toBeLessThan(height);
    await page.getByRole('button',{name:'Request refund'}).click({trial:true});
    expect(await page.locator('.order-chat-messages').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
    expect(await page.locator('.order-chat-modal').evaluate(el=>el.scrollHeight<=el.clientHeight)).toBe(true);
    if(width===360) await page.screenshot({path:'artifacts/order-chat-mobile.png'});
  }
  await page.setContent(`<style>${css}</style><div class="order-detail-page"><div class="order-delivery-item"><button class="button order-chat-trigger">Chat</button><div class="order-delivery-label">Product details</div></div></div>`);
  const button = await page.getByRole('button').boundingBox();
  const details = await page.locator('.order-delivery-label').boundingBox();
  expect(details!.y - button!.y - button!.height).toBeGreaterThanOrEqual(16);
});
