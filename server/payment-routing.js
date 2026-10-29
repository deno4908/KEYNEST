import { randomUUID, createHash } from "node:crypto";
import {
  createTingeeClient,
  tingeeReady,
  tingeeFailureCode,
  STATIC_MONITOR_MS,
} from "./tingee.js";
export const pay2sReady = (c) =>
  !!(c.pay2sWebhook && c.account && c.accountName);
export const bankSourceEnabled = (c, source) =>
  source === c.paymentProvider ||
  (c.paymentProvider === "tingee" && source === "pay2s" && pay2sReady(c));

export function createPaymentRouting({
  store,
  config,
  client = createTingeeClient(config.tingee),
  logger = console,
  monotonicNow = () => performance.now(),
}) {
  let running = false, nextCheckAt = 0, lastClaimAt = -Infinity;
  const rpc = (name, args) => store.query(store.client.rpc(name, args));
  async function prepare(payment) {
    if (!payment || config.mode === "demo") return null;
    if (Object.hasOwn(payment, "route")) {
      const route = Array.isArray(payment.route)
        ? payment.route[0]
        : payment.route;
      if (
        !route ||
        !["unassigned", "creating"].includes(route.state) ||
        payment.status !== "pending"
      )
        return route || null;
      if (
        route.state === "creating" &&
        Date.parse(route.lease_until) > Date.now()
      )
        return route;
    }
    const token = randomUUID();
    const [route] = await rpc("claim_payment_route", {
      p_id: payment.id,
      p_claim: token,
    });
    if (!route || route.claim_token !== token) return route || null;
    let result;
    let failure;
    if (
      config.paymentProvider === "tingee" &&
      route.attempts === 1 &&
      tingeeReady(config.tingee)
    ) {
      try {
        result = await client.generate(payment);
      } catch (error) {
        failure = tingeeFailureCode(error);
        logger.error(
          `Tingee QR creation failed (${failure}); attempting configured fallback.`,
        );
      }
    }
    if (!result) {
      const provider = config.paymentProvider === "sepay" ? "sepay" : "pay2s";
      const available =
        provider === "sepay"
          ? !!(config.webhook && config.account && config.accountName)
          : pay2sReady(config);
      result = available
        ? {
            provider,
            bank: config.bank,
            account: config.account,
            account_name: config.accountName,
            ...(failure ? { error: failure } : {}),
          }
        : { error: "payment_provider_unavailable" };
    }
    // An unknown result from the DB must never switch an already-published QR.
    await rpc("finish_payment_route", {
      p_id: payment.id,
      p_claim: token,
      p_data: result,
    });
    const [saved] = await rpc("claim_payment_route", {
      p_id: payment.id,
      p_claim: randomUUID(),
    });
    nextCheckAt = 0;
    lastClaimAt = monotonicNow();
    return saved || null;
  }
  async function tick() {
    if (running || monotonicNow() < nextCheckAt || config.mode !== "supabase" || !tingeeReady(config.tingee))
      return;
    running = true;
    try {
      const rows = await rpc("claim_tingee_polls");
      if (rows.length) lastClaimAt = monotonicNow();
      // No pending work recently: keep the timer cheap, query the DB at most
      // every 30s. Preparing a new QR wakes the local queue immediately.
      nextCheckAt = monotonicNow() + (rows.length || monotonicNow() - lastClaimAt < 60000 ? 5000 : 30000);
      // Bound request concurrency. Jobs are claimed durably across Node instances.
      for (let i = 0; i < rows.length; i += 4)
        await Promise.all(
          rows.slice(i, i + 4).map(async (route) => {
            let closed = false, failed = false, lastError = null;
            const polledAt = Number.isFinite(Date.parse(route.polled_at)) ? Date.parse(route.polled_at) : Date.now();
            try {
              if (route.qr_kind === 'static') {
                const transactions=await client.transactions(route);
                for (const tx of transactions) {
                  const id='tingee-static:'+createHash('sha256')
                    .update(JSON.stringify([route.bank_bin,route.account,tx.transactionId])).digest('hex');
                  await rpc('settle_tingee_static', {
                    p_transaction:id,p_code:route.payment.code,p_amount:tx.amount,
                    p_account:tx.accountNumber,p_bank:tx.bankBin,p_time:tx.transactionTime,
                  });
                }
                // A static QR cannot be disabled. Keep scanning paid/cancelled/
                // expired orders for seven days to flag extra or late transfers.
                closed = polledAt >= Date.parse(route.payment.expires_at) + STATIC_MONITOR_MS;
                lastError = transactions.length===0 && route.payment.status==='pending' ? 'tingee_no_matching_credit' : null;
                return;
              }
              const status = await client.status(route);
              if (
                status.status === "fully-paid" &&
                status.totalAmountPaid === route.payment.amount
              ) {
                const tx =
                  "tingee:" +
                  createHash("sha256").update(route.bill_id).digest("hex");
                const settlement = await rpc("settle_routed_payment", {
                  p_source: "tingee",
                  p_transaction: tx,
                  p_code: route.payment.code,
                  p_amount: status.totalAmountPaid,
                  p_bill: route.bill_id,
                });
                if (settlement?.ignored) {
                  // Keep polling when the database rejected the provider event;
                  // closing here would strand a paid bill as pending forever.
                  throw new Error("tingee_settlement_ignored");
                }
                if (settlement?.review) {
                  closed = true;
                  lastError = 'tingee_payment_review';
                  return;
                }
                if (settlement?.duplicate) {
                  closed = true;
                  lastError = 'tingee_duplicate_review';
                  return;
                }
                if (!settlement?.paid) {
                  throw new Error("tingee_settlement_unconfirmed");
                }
                closed = true;
              } else if (
                route.payment.status !== "pending" ||
                Date.parse(route.payment.expires_at) <= polledAt
              ) {
                // Read first, then disable. A final read catches money arriving during deletion.
                if (status.status !== "expired" && status.status !== "deleted")
                  await client.remove(route);
                const final = await client.status(route);
                if (final.totalAmountPaid > 0) {
                  const tx =
                    "tingee:" +
                    createHash("sha256").update(route.bill_id).digest("hex");
                  await rpc("settle_routed_payment", {
                    p_source: "tingee",
                    p_transaction: tx,
                    p_code: route.payment.code,
                    p_amount: final.totalAmountPaid,
                    p_bill: route.bill_id,
                  });
                }
                closed = true;
              }
            } catch (error) {
              failed = true;
              lastError = tingeeFailureCode(error);
              if (route.last_error !== lastError) logger.error(
                `Tingee status check deferred (${lastError}); retaining the original payment provider.`,
              );
            } finally {
              await rpc('finish_tingee_poll', { p_id: route.payment_id, p_claim: route.claim_token,
                p_error: lastError, p_closed: closed, p_failed: failed,
              }).catch(() => logger.error('Tingee poll acknowledgement unavailable; database lease retained.'));
            }
          }),
        );
    } catch {
      nextCheckAt = monotonicNow() + 30000;
      logger.error("Tingee payment queue unavailable; will retry.");
    } finally {
      running = false;
    }
  }
  return { prepare, tick };
}
