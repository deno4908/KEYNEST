import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePay2SPayload } from '../server/pay2s.js';
import { webhookCode } from '../server/security.js';

test('Pay2S MBB matches MB configuration without relaxing recipient checks', () => {
  const transaction = {
    id: 123456, gateway: 'MBB', accountNumber: '00123456789',
    content: '123456-KN0123456789ABCDEF-CHUYEN TIEN-MOMO123456',
    transferType: 'IN', transferAmount: 10000,
  };
  for (const bank of ['MB', 'MBB', 'MBBank', '970422']) {
    const [parsed] = parsePay2SPayload({ transactions: [transaction] }, { bank, account: transaction.accountNumber });
    assert.equal(parsed.amount, 10000);
    assert.equal(webhookCode(parsed), 'KN0123456789ABCDEF');
  }
  assert.throws(() => parsePay2SPayload({ transactions: [transaction] }, { bank: 'MB', account: '00999999999' }), error => error.status === 422);
  assert.throws(() => parsePay2SPayload({ transactions: [{ ...transaction, gateway: 'VCB' }] }, { bank: 'MB', account: transaction.accountNumber }), error => error.status === 422);
});
