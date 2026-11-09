import { test, expect } from '@playwright/test';
import { SELLER_TERMS_VERSION } from '../../shared/seller-terms.js';

test('withdrawal amount formats VND, preserves editing, validates limits and submits an integer once', async ({ page, request }) => {
  await expect.poll(async () => {
    try { return (await (await request.get('/api/health')).json()).mode; }
    catch { return null; }
  }).toBe('demo');
  const profile = { id: crypto.randomUUID(), name: 'Withdrawal seller', email: 'withdrawal@example.test', role: 'seller',
    balance: 250000, seller_debt: 0, seller_name: 'Withdrawal shop', seller_terms_version: SELLER_TERMS_VERSION,
    seller_terms_accepted_at: new Date().toISOString() };
  // Mock account data and payment writes; no balance changes or real withdrawal requests.
  await page.route('**/api/me', route => route.fulfill({ json: profile }));
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/seller/overview', route => route.fulfill({ json: {
    profile, products: [], sales: [], withdrawals: [], ledger: [], held: 0, fee_bps: 700,
  } }));
  const submitted: { amount: number; bank: string }[] = [];
  await page.route('**/api/seller/withdrawals', async route => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.goto('/seller?tab=withdrawals');
  const amount = page.getByLabel('Số tiền', { exact: true });
  await expect(amount).toBeEnabled();
  await amount.pressSequentially('100000');
  await expect(amount).toHaveValue('100.000');
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4));
  await amount.press('Backspace');
  await expect(amount).toHaveValue('10.000');
  await amount.fill('100000');
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 3));
  await amount.press('Delete');
  await expect(amount).toHaveValue('10.000');
  await amount.fill('200.000 ₫');
  await expect(amount).toHaveValue('200.000');
  await page.locator('select[name="bank"]').selectOption('MBBank');
  await page.locator('input[name="account_number"]').fill('0123456789');
  await page.locator('input[name="account_name"]').fill('NGUYEN MINH ANH');
  const submit = page.getByRole('button', { name: 'Gửi yêu cầu rút', exact: true });
  for (const value of ['49999', '250001', '0', '']) {
    await amount.fill(value);
    expect(await amount.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
    await submit.click();
    expect(submitted).toHaveLength(0);
  }
  await amount.fill('250000');
  expect(await amount.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(true);
  await submit.click();
  await expect(amount).toHaveValue('');
  expect(submitted).toHaveLength(1);
  expect(submitted[0].amount).toBe(250000);
  expect(submitted[0].bank).toBe('MBBank');
  profile.balance = 0;
  await page.reload();
  await expect(amount).toBeDisabled();
  await expect(submit).toBeDisabled();
  await expect(page.locator('#seller-withdraw-amount-hint')).toContainText('chưa đủ');
  expect(await amount.getAttribute('max')).toBeNull();
  profile.balance = 150000000;
  await page.reload();
  await expect(amount).toBeEnabled();
  await amount.fill('100000001');
  expect(await amount.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
  await amount.fill('100000000');
  expect(await amount.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(true);
  profile.seller_debt = 1000;
  await page.reload();
  await expect(amount).toBeDisabled();
  await expect(submit).toBeDisabled();
  expect(submitted).toHaveLength(1);
});
