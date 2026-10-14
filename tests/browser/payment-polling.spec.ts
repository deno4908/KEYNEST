import { test, expect } from '@playwright/test';

test('dynamic QR appears after preparation and updates to paid without reload', async ({page})=>{
  expect((await (await page.request.get('/api/health')).json()).mode).toBe('demo');
  await page.request.post('/api/auth/login', {headers:{Origin:'http://127.0.0.1:5173','X-App-Request':'keynest'},data:{email:'admin@keynest.local',password:'Admin123!'}});
  const now=Date.now();
  const pending={id:'dynamic-test',user_id:'test',order_id:null,code:'KN-DYNAMIC',amount:100000,status:'pending',
    demo:false,created_at:new Date(now).toISOString(),expires_at:new Date(now+14*60000).toISOString(),qr_url:null,
    provider:null,qr_state:'creating',bank:'',account:'',account_name:''};
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPfkAAAAASUVORK5CYII=';
  let phase='creating';
  await page.route('**/api/wallet',route=>route.fulfill({json:{balance:100000,ledger:[],payments:[phase==='creating'?pending:{...pending,
    provider:'tingee',qr_state:'ready',bill_id:'BILL-DYNAMIC-TEST',qr_url:png,bank:'970418',account:'QR-ACCOUNT-TEST',account_name:'KEYNEST',status:phase==='paid'?'paid':'pending'}]}}));
  await page.route('**/api/wallet/topup',route=>route.fulfill({status:201,json:pending}));
  await page.clock.install({time:now});
  await page.goto('/wallet');
  await page.getByRole('button',{name:'Tạo mã nạp tiền'}).click();
  const modal=page.locator('.payment-modal');
  await expect(modal).toContainText('Đang tạo mã QR');
  phase='ready';
  await page.clock.fastForward(4500);
  await expect(modal.locator('.payment-qr')).toHaveAttribute('src',png);
  await expect(modal).toContainText('BILL-DYNAMIC-TEST');
  await expect(modal).toContainText('QR-ACCOUNT-TEST');
  await expect(modal).not.toContainText('Giữ nguyên nội dung');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  phase='paid';
  await page.clock.fastForward(4500);
  await expect(modal.getByRole('heading',{name:'Đã nhận thanh toán.'})).toBeVisible();
});

test('wallet hides expired requests and removes pending requests as they expire', async ({ page }) => {
  expect((await (await page.request.get('/api/health')).json()).mode).toBe('demo');
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest' },
    data: { email: 'admin@keynest.local', password: 'Admin123!' },
  });
  expect(login.ok()).toBe(true);
  const now = Date.now();
  await page.clock.install({ time: now });
  const base = { amount: 10000, created_at: new Date(now).toISOString(), expires_at: new Date(now - 60000).toISOString() };
  await page.route('**/api/wallet', route => route.fulfill({ json: {
    balance: 10000, ledger: [], payments: [
      { ...base, id: 'expired', code: 'KN-EXPIRED', status: 'expired' },
      { ...base, id: 'stale', code: 'KN-STALE', status: 'pending' },
      { ...base, id: 'paid', code: 'KN-PAID', status: 'paid' },
      { ...base, id: 'pending', code: 'KN-PENDING', status: 'pending', expires_at: new Date(now + 30000).toISOString() },
    ],
  } }));
  await page.goto('/wallet');
  const list = page.locator('.wallet-requests');
  await expect(list.locator('tbody tr')).toHaveCount(2);
  await expect(list).not.toContainText('KN-EXPIRED');
  await expect(list).not.toContainText('KN-STALE');
  await expect(list).toContainText('KN-PENDING');
  await page.clock.fastForward(31000);
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await expect(list).toContainText('KN-PAID');
  await expect(list).not.toContainText('KN-PENDING');
});

test('payment polling waits for slow responses and stops after payment', async ({ page }) => {
  expect((await (await page.request.get('/api/health')).json()).mode).toBe('demo');
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest' },
    data: { email: 'admin@keynest.local', password: 'Admin123!' },
  });
  expect(login.ok()).toBe(true);
  await page.clock.install();
  await page.goto('/wallet');
  await page.getByRole('button', { name: 'Tạo mã nạp tiền' }).click();
  await expect(page.locator('.payment-modal')).toBeVisible();
  const wallet = await (await page.request.get('/api/wallet')).json();
  const pending = wallet.payments.find((p: { status: string }) => p.status === 'pending');
  expect(pending).toBeTruthy();
  let requests = 0;
  let release!: () => void;
  const slowResponse = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/wallet', async route => {
    requests++;
    if (requests === 1) await slowResponse;
    await route.fulfill({ json: {
      ...wallet,
      payments: wallet.payments.map((p: { id: string }) => p.id === pending.id ? { ...p, status: 'paid' } : p),
    } });
  });
  await page.clock.fastForward(4500);
  await expect.poll(() => requests).toBe(1);
  await page.clock.fastForward(16000);
  expect(requests).toBe(1);
  release();
  await expect(page.getByRole('heading', { name: 'Đã nhận thanh toán.' })).toBeVisible();
  // The success callback refreshes the shared wallet exactly once.
  await expect.poll(() => requests).toBe(2);
  await page.clock.fastForward(16000);
  expect(requests).toBe(2);
});
