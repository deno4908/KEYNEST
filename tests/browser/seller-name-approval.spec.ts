import { test, expect } from '@playwright/test';
import { accountLegal } from '../helpers/legal.js';
import { SELLER_TERMS_VERSION } from '../../shared/seller-terms.js';

const origin = 'http://127.0.0.1:5173';
const headers = { Origin: origin, 'X-App-Request': 'keynest' };

test('seller requests a name, admin rejects or approves, and only approval updates the storefront', async ({ page, browser, request }) => {
  test.setTimeout(90000);
  expect((await (await request.get('/api/health')).json()).mode).toBe('demo');
  const sellerContext = await browser.newContext({ baseURL: origin });
  const suffix = crypto.randomUUID().slice(0, 8);
  const original = `Original Shop ${suffix}`, rejected = `Rejected Shop ${suffix}`, approved = `Approved Shop ${suffix}`;
  try {
    const registered = await sellerContext.request.post('/api/auth/register', { headers, data: {
      legal: accountLegal, name: original, email: `name-review-${suffix}@example.test`, password: 'NameReview123!',
    } });
    expect(registered.ok(), await registered.text()).toBeTruthy();
    const id = (await registered.json()).user.id;
    expect((await page.request.post('/api/auth/login', { headers, data: { email: 'admin@keynest.local', password: 'Admin123!' } })).ok()).toBeTruthy();
    expect((await page.request.post('/api/admin/sellers/role', { headers, data: { user_id: id, role: 'seller' } })).ok()).toBeTruthy();
    expect((await sellerContext.request.post('/api/seller/profile', { headers, data: { name: original, accepted: true, terms_version: SELLER_TERMS_VERSION, fee_bps: 700 } })).ok()).toBeTruthy();
    const seller = await sellerContext.newPage();
    await seller.goto('/seller?tab=profile');
    await expect(seller.locator('.seller-current-shop')).toContainText(original);
    await seller.getByLabel('Tên gian hàng mới', { exact: true }).fill(rejected);
    await seller.getByRole('button', { name: 'Gửi yêu cầu đổi tên', exact: true }).click();
    await expect(seller.locator('.seller-name-notice')).toContainText('Đang chờ xét duyệt');
    await expect(seller.getByLabel('Tên gian hàng mới', { exact: true })).toHaveCount(0);
    expect((await (await sellerContext.request.get('/api/me')).json()).seller_name).toBe(original);
    await page.goto('/admin?tab=sellers');
    await page.locator('.seller-name-review-card').filter({ hasText: rejected }).getByRole('button', { name: 'Xét duyệt', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Kết quả xét duyệt').selectOption('rejected');
    await dialog.getByLabel('Lý do từ chối').fill('Tên cần rõ ràng hơn.');
    await dialog.getByRole('button', { name: 'Xác nhận xét duyệt' }).click();
    await expect(dialog).not.toBeVisible();
    await seller.reload();
    await expect(seller.locator('.seller-name-notice.is-rejected')).toContainText('Tên cần rõ ràng hơn.');
    await expect(seller.locator('.seller-current-shop')).toContainText(original);
    await seller.getByLabel('Tên gian hàng mới', { exact: true }).fill(approved);
    await seller.getByRole('button', { name: 'Gửi yêu cầu đổi tên', exact: true }).click();
    await expect(seller.locator('.seller-name-notice')).toContainText('Đang chờ xét duyệt');
    await page.reload();
    await page.locator('.seller-name-review-card').filter({ hasText: approved }).getByRole('button', { name: 'Xét duyệt', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Xác nhận xét duyệt' }).click();
    await expect(dialog).not.toBeVisible();
    await seller.reload();
    await expect(seller.locator('.seller-current-shop')).toContainText(approved);
    await expect(seller.getByLabel('Tên gian hàng mới', { exact: true })).toBeEnabled();
    expect((await (await sellerContext.request.get('/api/me')).json()).seller_name).toBe(approved);
    await seller.locator('.seller-profile-policy-details > summary').click();
    await expect(seller.locator('.seller-profile-policy-details .seller-terms')).toBeVisible();
    for (const width of [1440, 768, 390, 320]) {
      await seller.setViewportSize({ width, height: 900 });
      expect(await seller.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await sellerContext.close(); }
});
