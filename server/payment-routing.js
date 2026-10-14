import { randomUUID, createHash } from "node:crypto";
import { createTingeeClient, tingeeReady } from "./tingee.js";
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
}) {
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
    if (
      config.paymentProvider === "tingee" &&
      route.attempts === 1 &&
      tingeeReady(config.tingee)
    ) {
      try {
        result = await client.generate(payment);
      } catch {
        logger.error(
          "Tingee QR creation failed; attempting configured fallback.",
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
    return saved || null;
  }
  let running = false;
  async function tick() {
    if (running || config.mode !== "supabase" || !tingeeReady(config.tingee))
      return;
    running = true;
    try {
      const rows = await rpc("claim_tingee_polls");
      // Bound request concurrency. Jobs are claimed durably across Node instances.
      for (let i = 0; i < rows.length; i += 4)
        await Promise.all(
          rows.slice(i, i + 4).map(async (route) => {
            try {
              const status = await client.status(route);
              if (
                status.status === "fully-paid" &&
                status.totalAmountPaid === route.payment.amount
              ) {
                const tx =
                  "tingee:" +
                  createHash("sha256").update(route.bill_id).digest("hex");
                await rpc("settle_routed_payment", {
                  p_source: "tingee",
                  p_transaction: tx,
                  p_code: route.payment.code,
                  p_amount: status.totalAmountPaid,
                  p_bill: route.bill_id,
                });
                await store.query(
                  store.client
                    .from("payment_routes")
                    .update({ remote_closed: true, last_error: null })
                    .eq("payment_id", route.payment_id),
                );
              } else if (
                route.payment.status !== "pending" ||
                Date.parse(route.payment.expires_at) <= Date.now()
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
                await store.query(
                  store.client
                    .from("payment_routes")
                    .update({ remote_closed: true, last_error: null })
                    .eq("payment_id", route.payment_id),
                );
              }
            } catch {
              logger.error(
                "Tingee status check deferred; retaining the original payment provider.",
              );
              await store
                .query(
                  store.client
                    .from("payment_routes")
                    .update({ last_error: "tingee_status_unavailable" })
                    .eq("payment_id", route.payment_id),
                )
                .catch(() => {});
            } finally {
              await store
                .query(
                  store.client
                    .from("payment_routes")
                    .update({
                      next_poll_at: new Date(Date.now() + 30000).toISOString(),
                    })
                    .eq("payment_id", route.payment_id),
                )
                .catch(() => {});
            }
          }),
        );
    } catch {
      logger.error("Tingee payment queue unavailable; will retry.");
    } finally {
      running = false;
    }
  }
  return { prepare, tick };
}
