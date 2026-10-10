import { z } from "zod";
import { AppError, digest, webhookCode } from "./security.js";

export const bankTransaction = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9._:/-]+$/),
    account: z.string().min(1).max(80),
    direction: z.enum(["in", "out"]),
    currency: z.literal("VND"),
    amount: z.number().int().positive().max(1000000000000),
    content: z.string().max(5000),
    code: z.string().max(200).nullable().optional(),
  })
  .strict();

export function createBankPayments({ config, store }) {
  let lastReceivedAt = null;
  function status() {
    const key =
      config.paymentProvider === "pay2s" ? config.pay2sWebhook : config.webhook;
    const reason =
      config.mode === "demo"
        ? "demo"
        : !config.account || !config.accountName
          ? "bank_details_missing"
          : !key
            ? "webhook_key_missing"
            : null;
    return {
      provider: config.paymentProvider,
      configured: !reason,
      ready: !reason,
      reason,
      webhook_path: `/api/webhooks/${config.paymentProvider}`,
      last_received_at: lastReceivedAt,
    };
  }
  function assertReady() {
    if (config.mode !== "demo" && !status().ready)
      throw new AppError("Chuyển khoản ngân hàng chưa được cấu hình.", 503);
  }
  async function accept(source, input) {
    if (
      !["sepay", "pay2s"].includes(source) ||
      source !== config.paymentProvider
    )
      throw new AppError("Nguồn thanh toán không được bật.", 503);
    const transaction = bankTransaction.parse(input);
    if (transaction.account !== config.account)
      throw new AppError("Sai tài khoản thụ hưởng.", 422);
    if (transaction.direction === "out") return { ignored: true };
    // Preserve old SePay IDs; namespace Pay2S IDs by receiving account.
    const id =
      source === "sepay"
        ? transaction.id
        : `pay2s:${digest(transaction.account).slice(0, 12)}:${transaction.id}`;
    let code;
    try {
      code = webhookCode(transaction);
    } catch {
      code = `UNMATCHED:${id}`;
    }
    return store.settle(id, code, transaction.amount);
  }
  function received() {
    lastReceivedAt = new Date().toISOString();
  }
  return { status, assertReady, accept, received };
}
