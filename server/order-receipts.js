const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (value) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(
    Number(value),
  );
const day = (value) =>
  String(value || "")
    .split("-")
    .reverse()
    .join("/");

export function renderReceipt(order, origin) {
  const href = new URL(`/orders/${encodeURIComponent(order.id)}`, origin).href;
  const lines = order.items.map(
    (i) =>
      `${i.name} · ${i.variant_name} × ${i.quantity}: ${money(i.price * i.quantity)}${i.is_preorder ? ` — Đặt trước, dự kiến giao ${day(i.expected_delivery)}` : ""}`,
  );
  const textContent = [
    "KEYNEST — Biên nhận thanh toán",
    `Mã đơn: ${order.number}`,
    `Thanh toán: ${order.method === "wallet" ? "Số dư KEYNEST" : "Chuyển khoản ngân hàng"}`,
    ...lines,
    `Tạm tính: ${money(order.subtotal)}`,
    `Giảm giá: ${money(order.discount)}`,
    `Đã thanh toán: ${money(order.total)}`,
    `Xem đơn hàng: ${href}`,
    "Đây là biên nhận thanh toán, không phải hóa đơn điện tử thuế.",
  ].join("\n");
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:16px 0;border-bottom:1px solid #34363e"><strong>${escape(i.name)}</strong><br><span style="color:#b9bdc8">${escape(i.variant_name)} · SL ${escape(i.quantity)}</span>${i.is_preorder ? `<br><span style="color:#f3a078">Đặt trước · Dự kiến giao ${escape(day(i.expected_delivery))}</span>` : ""}</td><td align="right" style="padding:16px 0;border-bottom:1px solid #34363e">${escape(money(i.price * i.quantity))}</td></tr>`,
    )
    .join("");
  const htmlContent = `<!doctype html><html lang="vi"><meta charset="utf-8"><body style="margin:0;background:#101114;color:#f4f4f5;font:14px/1.7 Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:600px;background:#1a1b20;border:1px solid #34363e;border-radius:12px"><tr><td style="padding:28px"><b style="color:#f38b58">//</b> <b>KEYNEST</b><h1 style="font-size:24px">Đã nhận thanh toán</h1><p>Mã đơn: <strong>${escape(order.number)}</strong><br>Phương thức: ${order.method === "wallet" ? "Số dư KEYNEST" : "Chuyển khoản ngân hàng"}<br>Thời gian: ${escape(new Date(order.paid_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }))}</p><table width="100%" style="border-collapse:collapse">${rows}</table><p>Tạm tính: ${escape(money(order.subtotal))}<br>Giảm giá: ${escape(money(order.discount))}<br><strong>Đã thanh toán: ${escape(money(order.total))}</strong></p><p>Sản phẩm đặt trước sẽ được giao khi có hàng. Theo dõi tiến độ và thông tin nhận hàng trong tài khoản KEYNEST.</p><a href="${escape(href)}" style="display:inline-block;padding:12px 22px;border-radius:6px;background:#f38b58;color:#17120f;text-decoration:none;font-weight:bold">Xem đơn hàng</a><p style="color:#a5aab6;font-size:11px;margin-top:24px">Đây là biên nhận thanh toán, không phải hóa đơn điện tử thuế. Cần hỗ trợ? Mở đơn hàng để liên hệ cửa hàng.</p></td></tr></table></td></tr></table></body></html>`;
  return {
    subject: `KEYNEST · Biên nhận thanh toán ${order.number}`,
    htmlContent,
    textContent,
  };
}

export function createReceiptWorker({
  store,
  config,
  fetcher = fetch,
  logger = console,
}) {
  let running = false;
  async function tick() {
    if (running || config.mode !== "supabase" || !config.receipts.enabled)
      return;
    running = true;
    try {
      for (let n = 0; n < 10; n++) {
        const rows = await store.query(store.client.rpc("claim_order_receipt"));
        const job = rows?.[0];
        if (!job) break;
        let sent = false,
          error = "";
        try {
          const response = await fetcher(
            "https://api.brevo.com/v3/smtp/email",
            {
              method: "POST",
              signal: AbortSignal.timeout(15000),
              headers: {
                "api-key": config.receipts.apiKey,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                sender: { name: "KEYNEST", email: config.receipts.sender },
                to: [{ email: job.payload.email }],
                headers: { idempotencyKey: job.id },
                ...renderReceipt(job.payload, config.origin),
              }),
            },
          );
          const body = await response.json().catch(() => ({}));
          sent = response.ok || body.code === "duplicate_parameter";
          if (!sent) error = `provider_http_${response.status}`;
        } catch {
          error = "provider_network_or_timeout";
        }
        await store.query(
          store.client.rpc("finish_order_receipt", {
            p_id: job.id,
            p_claim: job.claim_token,
            p_sent: sent,
            p_error: error,
          }),
        );
        if (!sent) logger.error("Order receipt delivery deferred:", error);
      }
    } catch {
      logger.error("Order receipt queue unavailable; will retry.");
    } finally {
      running = false;
    }
  }
  return { tick };
}
