import { test, expect, type APIRequestContext } from '@playwright/test';

const headers = { Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest' };
async function register(request: APIRequestContext, label: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const response = await request.post('/api/auth/register', {
    headers, data: { email: `${label.toLowerCase().replaceAll(' ', '-')}-${suffix}@example.test`, name: `${label} ${suffix}`, password: 'StockBuyer123!' },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).user;
}
async function buyRemaining(request: APIRequestContext, variant: {id: string; stock: number; price: number}) {
  const payment = await (await request.post('/api/wallet/topup', {
    headers, data: { amount: Math.max(20000, variant.stock * variant.price) },
  })).json();
  expect((await request.post(`/api/demo/pay/${payment.id}`, {headers})).ok()).toBeTruthy();
  const bought = await request.post('/api/orders', {
    headers: {...headers, 'Idempotency-Key':crypto.randomUUID()},
    data: { items:[{variant_id:variant.id,quantity:variant.stock}], method:'wallet', coupon:'', customer_note:'' },
  });
  expect(bought.ok()).toBeTruthy();
}
test.beforeEach(async ({request}) => {
  await expect.poll(async () => {
    try { const r=await request.get('/api/health'); return r.ok() ? (await r.json()).mode : null; }
    catch { return null; }
  }, {timeout:30000}).toBe('demo');
});

test('another buyer selling out a variant updates open product, catalog and cart pages via SSE', async ({page,context,browser}) => {
  const viewer = await register(page.request,'Stock Viewer');
  const products = await (await page.request.get('/api/products')).json();
  const product = products.find((p:any)=>p.variants.some((v:any)=>v.delivery==='key'&&!v.unlimited&&v.stock>0&&v.stock<=10));
  const variant = product.variants.find((v:any)=>v.delivery==='key'&&!v.unlimited&&v.stock>0&&v.stock<=10);
  expect((await page.request.put('/api/cart',{headers,data:{user_id:viewer.id,items:[{variant_id:variant.id,quantity:1}]}})).ok()).toBeTruthy();
  await page.goto(`/products/${product.slug}`);
  const add = page.getByRole('button',{name:'Thêm vào giỏ',exact:true});
  await expect(add).toBeEnabled();
  const catalog = await context.newPage();
  await catalog.goto('/catalog');
  const card = catalog.locator('.product-card').filter({has:catalog.locator(`a[href="/products/${product.slug}"]`)});
  await expect(card).toBeVisible();
  const cart = await context.newPage();
  await cart.goto('/cart');
  const checkout = cart.getByRole('button',{name:'Đặt hàng & thanh toán',exact:true});
  await expect(checkout).toBeEnabled();
  const buyer = await browser.newContext();
  try {
    await register(buyer.request,'Stock Consumer');
    await buyRemaining(buyer.request,variant);
    await expect(add).toBeDisabled();
    await expect(card).toContainText('Hết hàng');
    await expect(checkout).toBeDisabled();
    await expect(cart.locator('.checkout-stock-error')).toBeVisible();
  } finally { await buyer.close(); }
});

test('stale product pages cannot add sold-out stock even when the live connection is unavailable', async ({page,browser}) => {
  await register(page.request,'Stale Viewer');
  const products = await (await page.request.get('/api/products')).json();
  const product = products.find((p:any)=>p.variants.some((v:any)=>v.delivery==='key'&&!v.unlimited&&v.stock>0&&v.stock<=10));
  const variant = product.variants.find((v:any)=>v.delivery==='key'&&!v.unlimited&&v.stock>0&&v.stock<=10);
  await page.route('**/api/products?live=1',route=>route.abort());
  await page.goto(`/products/${product.slug}`);
  const add = page.getByRole('button',{name:'Thêm vào giỏ',exact:true});
  await expect(add).toBeEnabled();
  const buyer = await browser.newContext();
  try {
    await register(buyer.request,'Stale Consumer');
    await buyRemaining(buyer.request,variant);
    await expect(add).toBeEnabled();
    await add.click();
    await expect(add).toBeDisabled();
    expect((await (await page.request.get('/api/cart')).json()).items).toEqual([]);
    await expect(page.getByRole('link',{name:'Giỏ hàng 0 sản phẩm',exact:true})).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/products/${product.slug}`);
  } finally { await buyer.close(); }
});
