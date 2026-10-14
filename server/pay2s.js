import { Router } from "express";
import { z } from "zod";
import { AppError, safeEqual } from "./security.js";
import { bankSourceEnabled } from './payment-routing.js';

const identifier = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String),
  z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9._:/-]+$/),
]);
const transactionSchema = z.object({
  id: identifier,
  gateway: z.string().min(1).max(40),
  accountNumber: z.string().min(1).max(80),
  content: z.string().max(5000),
  transferType: z.enum(["IN", "OUT"]),
  transferAmount: z.number().int().positive().max(1000000000000),
});
const normalizeBank = (value) => {
  const bank = value.toUpperCase().replace(/[\s_-]/g, "");
  return ["MBB", "MBBANK", "970422"].includes(bank) ? "MB" : bank;
};

// Technical docs describe {transactions: [...]}; the Create Hook guide also
// documents a single transaction body. Validate either format before settlement.
export function parsePay2SPayload(body, config) {
  const rows =
    body && Object.hasOwn(body, "transactions")
      ? z
          .object({ transactions: z.array(transactionSchema).min(1).max(100) })
          .parse(body).transactions
      : [transactionSchema.parse(body)];
  if (
    rows.some(
      (t) =>
        t.accountNumber !== config.account ||
        normalizeBank(t.gateway) !== normalizeBank(config.bank),
    )
  )
    throw new AppError("Sai ngân hàng hoặc tài khoản thụ hưởng.", 422);
  return rows.map((t) => ({
    id: t.id,
    account: t.accountNumber,
    content: t.content,
    direction: t.transferType === "IN" ? "in" : "out",
    amount: t.transferAmount,
    currency: "VND",
  }));
}

export function createPay2SRouter({ config, bankPayments, paymentIngress }) {
  const router = Router();
  router.post("/webhooks/pay2s", async (req, res) => {
    if (
      config.mode !== "supabase" ||
      !bankSourceEnabled(config, 'pay2s') ||
      !config.pay2sWebhook ||
      !config.account
    )
      throw new AppError("Webhook Pay2S chưa được cấu hình.", 503);
    if (!safeEqual(req.headers.authorization, `Bearer ${config.pay2sWebhook}`))
      throw new AppError("Webhook không hợp lệ.", 401);
    const transactions = parsePay2SPayload(req.body, config);
    try {
      if (paymentIngress)
        await paymentIngress.acceptBatch("pay2s", transactions);
      else
        for (const transaction of transactions)
          await bankPayments.accept("pay2s", transaction);
    } catch {
      // A partial batch is retried safely using the durable transaction IDs.
      // Never acknowledge before durable acceptance (Kafka or SQL), or leak data.
      throw new AppError("Chưa thể ghi nhận giao dịch. Vui lòng gửi lại.", 503);
    }
    bankPayments.received();
    res.json({ success: true });
  });
  return router;
}
