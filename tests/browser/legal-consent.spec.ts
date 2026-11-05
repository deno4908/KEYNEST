import { test, expect } from '@playwright/test';
import { LEGAL_VERSION } from '../../shared/legal-content.js';
import { readFile } from 'node:fs/promises';

const headers = { Origin: 'http://127.0.0.1:5173', 'X-App-Request': 'keynest' };

test('mobile registration requires both unchecked confirmations; checkout resets agreement after edits and exports the accepted contract', async ({ page }, info) => {
  expect((await (await page.request.get('/api/health')).json()).mode).toBe('demo');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const auth = page.locator('.auth-dialog');
  await expect(auth.getByRole('button', { name: 'Đăng nhập bằng Google' })).toBeDisabled();
  const loginPassword = await auth.getByLabel('Mật khẩu', { exact: true }).boundingBox();
  const loginConsent = await auth.locator('.legal-consent').boundingBox();
  expect(loginConsent!.y).toBeGreaterThan(loginPassword!.y + loginPassword!.height);
  await auth.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  const checks = auth.getByRole('checkbox');
  await expect(checks).toHaveCount(2);
  await expect(checks.nth(0)).not.toBeChecked();
  await expect(checks.nth(1)).not.toBeChecked();
  const passwordPosition = await auth.getByLabel('Nhập lại mật khẩu', { exact: true }).boundingBox();
  const consentPosition = await auth.locator('.legal-consent').boundingBox();
  expect(consentPosition!.y).toBeGreaterThan(passwordPosition!.y + passwordPosition!.height);
  await expect(auth.getByRole('link', { name: 'Điều khoản dịch vụ' })).toHaveAttribute('target', '_blank');
  const create = auth.getByRole('button', { name: 'Tạo tài khoản', exact: true });
  await expect(create).toBeDisabled();
  const suffix = crypto.randomUUID().slice(0, 8);
  await auth.getByLabel('Tên của bạn').fill(`Legal Member ${suffix}`);
  await auth.getByLabel('Email', { exact: true }).fill(`legal-${suffix}@example.test`);
  await auth.getByLabel('Mật khẩu', { exact: true }).fill('LegalMember123!');
  await auth.getByLabel('Nhập lại mật khẩu', { exact: true }).fill('LegalMember123!');
  await checks.nth(0).check();
  await expect(create).toBeDisabled();
  await checks.nth(1).check();
  await expect(create).toBeEnabled();
  await auth.screenshot({ path: info.outputPath('registration-consent.png') });
  expect(await auth.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await create.click();
  await expect(auth).toHaveCount(0);
  const welcome = page.locator('.oauth-welcome');
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: /Tiếp tục vào cửa hàng/ }).click();
  const user = await (await page.request.get('/api/me')).json();
  const products = await (await page.request.get('/api/products')).json();
  const product = products.find((p: { slug: string }) => p.slug === 'hollow-knight');
  const variant = product.variants[0];
  const topup = await (await page.request.post('/api/wallet/topup', { headers, data: { amount: 1000000 } })).json();
  expect((await page.request.post(`/api/demo/pay/${topup.id}`, { headers })).ok()).toBeTruthy();
  expect((await page.request.put('/api/cart', { headers, data: { user_id: user.id, items: [{ variant_id: variant.id, quantity: 1 }] } })).ok()).toBeTruthy();
  await page.goto('/cart');
  const checkout = page.getByRole('button', { name: 'Đặt hàng & thanh toán', exact: true });
  const agreement = page.getByRole('checkbox', { name: /Tôi đã kiểm tra sản phẩm/ });
  await expect(agreement).not.toBeChecked();
  await expect(checkout).toBeDisabled();
  await agreement.check();
  await expect(checkout).toBeEnabled();
  await page.getByRole('button', { name: 'Tăng', exact: true }).click();
  await expect(agreement).not.toBeChecked();
  await expect(checkout).toBeDisabled();
  await agreement.check();
  await page.screenshot({ path: info.outputPath('checkout-consent.png'), fullPage: true });
  await checkout.click();
  await expect(page).toHaveURL(/\/orders$/);
  const orders = await (await page.request.get('/api/orders')).json();
  await page.goto(`/orders/${orders[0].id}`);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tải bản giao dịch' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/KEYNEST-giao-dich-.*\.txt$/);
  const document = await readFile((await download.path())!, 'utf8');
  expect(document).toContain(LEGAL_VERSION);
  expect(document).toContain('Khách hàng đã xác nhận');
  expect(document).toContain('ĐIỀU KHOẢN ÁP DỤNG');
});

test('legal pages show current version, rights, official sources and printable copies on desktop and mobile', async ({ page }) => {
  for (const [path, heading] of [['/terms', 'Điều khoản dịch vụ'], ['/privacy', 'Chính sách bảo mật']]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(page.locator('.legal-meta')).toContainText(LEGAL_VERSION);
    await expect(page.getByRole('button', { name: 'In / lưu chính sách' })).toBeVisible();
    expect(await page.locator('.legal-sources a').count()).toBe(3);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
