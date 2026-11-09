import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, encrypt } from "./security.js";
import { requireSeller, releaseSellerFunds } from "./seller-accounting.js";
import { sellerConversation, conversationInput } from "./seller-conversations.js";
import { SELLER_TERMS_VERSION, sellerTerms } from "../shared/seller-terms.js";
import { createSellerNameRequests } from './seller-name-requests.js';

export function createSellers(store) {
  const demo = Boolean(store.db);
  const names = createSellerNameRequests(store);
  if (demo) store.db.seller_withdrawals ||= [];
  const fee = async () =>
    demo
      ? (store.db.seller_fee_bps ?? 700)
      : (
          await store.query(
            store.client
              .from("seller_settings")
              .select("fee_bps")
              .eq("id", true)
              .single(),
          )
        ).fee_bps;
  const ownProduct = (uid, id) => {
    const p = store.db.products.find((p) => p.id === id && p.seller_id === uid);
    if (!p) throw new AppError("Không có quyền quản lý sản phẩm này.", 403);
    return p;
  };
  const ledger = (uid, amount, description) =>
    store.db.ledger.unshift({
      id: randomUUID(),
      user_id: uid,
      amount,
      description,
      created_at: new Date().toISOString(),
    });
  function demoCommand(actor, action, data) {
    const user = store.db.users.find((u) => u.id === actor);
    if (["role", "fee", "withdrawal_review"].includes(action)) {
      if (user?.role !== "admin")
        throw new AppError("Cần quyền quản trị.", 403);
    } else if (action === "profile") {
      if (user?.role !== "seller")
        throw new AppError("Cần quyền người bán.", 403);
    } else requireSeller(user);
    let result = { ok: true };
    if (action === "profile") {
      if (user.seller_name && data.name !== user.seller_name) throw new AppError('Đổi tên gian hàng cần được admin duyệt.', 409);
      if (
        data.terms_version !== SELLER_TERMS_VERSION ||
        data.fee_bps !== (store.db.seller_fee_bps ?? 700)
      )
        throw new AppError(
          "Phí hoặc điều khoản đã thay đổi. Tải lại trang.",
          409,
        );
      Object.assign(user, {
        seller_name: data.name,
        seller_social_links: [],
        seller_terms_version: data.terms_version,
        seller_terms_accepted_at:
          user.seller_terms_version === data.terms_version
            ? user.seller_terms_accepted_at || new Date().toISOString()
            : new Date().toISOString(),
      });
    } else if (action === "role") {
      const target = store.db.users.find(
        (u) => u.id === data.user_id && u.role !== "admin",
      );
      if (!target)
        throw new AppError("Chỉ đổi vai trò khách hàng hoặc seller.", 409);
      target.role = data.role;
      if (data.role === "customer")
        for (const p of store.db.products.filter(
          (p) => p.seller_id === target.id,
        ))
          p.active = false;
    } else if (action === "fee") store.db.seller_fee_bps = data.fee_bps;
    else if (action === "product") {
      if (data.id) ownProduct(actor, data.id);
      result = store.saveProduct({
        ...data,
        seller_id: actor,
        featured: data.id ? ownProduct(actor, data.id).featured : false,
      });
    } else if (action === "variant") {
      ownProduct(actor, data.product_id);
      result = store.saveVariant(data.product_id, data.variant);
    } else if (action === "keys") {
      const p = store.db.products.find((p) =>
        p.variants.some((v) => v.id === data.variant_id),
      );
      ownProduct(actor, p?.id);
      result = store.importKeys(data.variant_id, data.secrets);
    } else if (action === "fulfill") {
      const order = store.db.orders.find((o) =>
        o.items.some((i) => i.id === data.item_id && i.seller_id === actor),
      );
      const item = order?.items.find((i) => i.id === data.item_id);
      if (
        !item ||
        order.status !== "processing" ||
        item.delivery !== "manual" ||
        item.delivered_at || item.refunded_at
      )
        throw new AppError("Không có gói đang chờ giao của bạn.", 409);
      if (data.secrets.length !== item.quantity)
        throw new AppError("Cần một kết quả cho mỗi đơn vị sản phẩm.");
      for (const secret of data.secrets)
        store.db.inventory.push({
          id: randomUUID(),
          variant_id: item.variant_id,
          order_id: order.id,
          item_id: item.id,
          secret: encrypt(secret, store.key),
        });
      item.delivered_at = new Date().toISOString();
      if (order.items.every((i) => i.delivered_at || i.refunded_at)) {
        order.status = "completed";
        store.stampDelivery(order);
      }
    } else if (action === "withdraw") {
      const old = store.db.seller_withdrawals.find(
        (w) => w.user_id === actor && w.idempotency === data.idempotency,
      );
      if (old) {
        if (
          ["amount", "bank", "account_number", "account_name"].some(
            (key) => old[key] !== data[key],
          )
        )
          throw new AppError("Mã yêu cầu đã được sử dụng.", 409);
        return old;
      }
      if (user.seller_debt > 0 || data.amount > user.balance)
        throw new AppError("Số dư không đủ hoặc còn khoản cần bù trừ.", 409);
      result = {
        ...data,
        id: randomUUID(),
        user_id: actor,
        status: "pending",
        reference: "",
        reason: "",
        created_at: new Date().toISOString(),
      };
      store.db.seller_withdrawals.unshift(result);
      user.balance -= data.amount;
      ledger(actor, -data.amount, `Giữ tiền yêu cầu rút ${result.id}`);
    } else if (action === "withdrawal_review") {
      const w = store.db.seller_withdrawals.find((w) => w.id === data.id);
      if (!w || w.status !== "pending")
        throw new AppError("Yêu cầu đã xử lý hoặc không tồn tại.", 409);
      if (data.status === "rejected") {
        store.db.users.find((u) => u.id === w.user_id).balance += w.amount;
        ledger(w.user_id, w.amount, `Trả tiền yêu cầu rút bị từ chối ${w.id}`);
      }
      Object.assign(w, data, {
        resolved_at: new Date().toISOString(),
        resolved_by: actor,
      });
    } else throw new AppError("Thao tác không hợp lệ.");
    store.audit(actor, `seller_${action}`, data.id || data.user_id || actor);
    store.save();
    return result;
  }
  return {
    fee,
    async support(uid, id = null, body = null) {
      if (!demo)
        return store.query(
          store.client.rpc("seller_support", {
            p_actor: uid,
            p_ticket: id,
            p_body: body,
          }),
        );
      const eligible = store.db.tickets.filter(
        (t) =>
          !t.deleted_at &&
          (!id || t.id === id) &&
          store.db.orders.some(
            (o) =>
              o.id === t.order_id &&
              o.items.length &&
              (t.refund_item_id ? o.items.some(i => i.id === t.refund_item_id && i.seller_id === uid) : o.items.every((i) => i.seller_id === uid)),
          ),
      );
      if (body !== null) {
        const ticket = eligible[0];
        if (!ticket)
          throw new AppError("Không tìm thấy yêu cầu của gian hàng.", 404);
        if (ticket.status === "closed")
          throw new AppError("Yêu cầu đã đóng.", 409);
        ticket.messages ||= [];
        ticket.messages.push({
          id: randomUUID(),
          role: "seller",
          author_id: uid,
          body,
          created_at: new Date().toISOString(),
        });
        ticket.updated_at = new Date().toISOString();
        store.db.notifications ||= [];
        store.db.notifications.push({
          id: `seller-reply:${randomUUID()}`,
          user_id: ticket.user_id,
          title: "Người bán đã phản hồi yêu cầu hỗ trợ",
          href: "/support",
          created_at: ticket.updated_at,
        });
        store.save();
        return { ok: true };
      }
      return eligible.map(
        ({
          id,
          subject,
          message,
          kind,
          status,
          created_at,
          updated_at,
          messages,
          order_id,
          refund_item_id,
        }) => ({
          id,
          subject,
          message,
          kind,
          status,
          created_at,
          updated_at,
          messages: messages || [],
          refund_item_id,
          refund: (() => { const d = store.db.seller_disputes?.find(d=>d.item_id===refund_item_id); return d ? {...d,response_due_at:new Date(Date.parse(d.created_at)+48*3600000).toISOString(),needs_admin:['open','agreed'].includes(d.status)&&Date.parse(d.created_at)+48*3600000<=Date.now()} : null; })(),
          order_number: store.db.orders.find((o) => o.id === order_id)?.number,
        }),
      );
    },
    async visibility(uid, id, active) {
      if (demo) {
        if (active && ownProduct(uid, id).review_status !== 'approved') throw new AppError('Sản phẩm cần được admin duyệt trước khi mở bán.', 409);
        ownProduct(uid, id).active = active;
        store.save();
      } else {
        const rows = await store.query(
          store.client
            .from("products")
            .update({ active })
            .eq("id", id)
            .eq("seller_id", uid)
            .select("id,active"),
        );
        if (!rows.length)
          throw new AppError("Không tìm thấy sản phẩm của bạn.", 404);
        if (active && !rows[0].active) throw new AppError('Sản phẩm cần được admin duyệt trước khi mở bán.', 409);
      }
      await store.audit(uid, "seller_visibility", `${id}:${active}`);
      return { ok: true };
    },
    async command(actor, action, data) {
      if (demo) return demoCommand(actor, action, data);
      if (action === 'variant') {
        const { shared_key, ...variant } = data.variant;
        data = { ...data, variant: { ...variant, ...(shared_key ? { shared_key: store.encrypted([shared_key])[0] } : {}) } };
      }
      if (data.secrets) {
        const { secrets, ...rest } = data;
        data = { ...rest, keys: store.encrypted(secrets) };
      }
      return store.query(
        store.client.rpc("seller_command", {
          p_actor: actor,
          p_action: action,
          p_data: data,
        }),
      );
    },
    async overview(uid) {
      if (demo) {
        releaseSellerFunds(store);
        store.save();
      } else
        await store.query(
          store.client.rpc("release_seller_funds", { p_seller: uid }),
        );
      const profile = await store.profile(uid);
      // Scope at the database before pagination, rather than loading every seller.
      const all = async (query) => {
        const result = [];
        for (let offset = 0; ; offset += 500) {
          const batch = await store.query(query().range(offset, offset + 499));
          result.push(...batch);
          if (batch.length < 500) return result;
        }
      };
      const products = demo
        ? store.products(true).filter((p) => p.seller_id === uid)
        : await all(() =>
            store.client
              .from("products")
              .select("*,variants(*)")
              .eq("seller_id", uid)
              .order("id"),
          );
      const sales = demo
        ? store.db.orders.flatMap((o) =>
            o.items
              .filter((i) => i.seller_id === uid)
              .map((i) => ({
                ...i,
                order_id: o.id,
                order: {
                  number: o.number,
                  status: o.status,
                  created_at: o.created_at,
                  customer_note:
                    i.delivery === "manual" && o.paid_at ? o.customer_note : "",
                },
              })),
          )
        : await all(() =>
            store.client
              .from("order_items")
              .select(
                "*,order:orders!inner(number,status,created_at,customer_note)",
              )
              .eq("seller_id", uid)
              .order("id"),
          );
      const orderIds = [...new Set(sales.map((s) => s.order_id))];
      const disputes = demo
        ? (store.db.seller_disputes || []).filter((d) =>
            orderIds.includes(d.order_id),
          )
        : orderIds.length
          ? await all(() =>
              store.client
                .from("seller_disputes")
                .select("order_id,item_id,status")
                .in("order_id", orderIds)
                .order("order_id"),
            )
          : [];
      for (const sale of sales) {
        sale.seller_frozen = disputes.some(
          (d) =>
            d.item_id === sale.id &&
            ["open", "agreed"].includes(d.status),
        );
        sale.seller_hold_until = sale.delivered_at
          ? new Date(Date.parse(sale.delivered_at) + 48 * 3600000).toISOString()
          : null;
        if (
          sale.delivery !== "manual" ||
          !["processing", "completed"].includes(sale.order.status)
        )
          sale.order.customer_note = "";
      }
      const withdrawals = demo
        ? store.db.seller_withdrawals.filter((w) => w.user_id === uid)
        : await all(() =>
            store.client
              .from("seller_withdrawals")
              .select("*")
              .eq("user_id", uid)
              .order("created_at", { ascending: false })
              .order("id"),
          );
      return {
        profile,
        name_request: await names.latest(uid),
        products,
        sales,
        withdrawals,
        held: sales
          .filter(
            (s) =>
              s.seller_gross != null &&
              !s.seller_settled_at &&
              !s.seller_reversed_at,
          )
          .reduce((n, s) => n + Number(s.seller_net || 0), 0),
        ledger: demo
          ? store.ledger(uid)
          : await all(() =>
              store.client
                .from("wallet_ledger")
                .select("id,amount,description,created_at")
                .eq("user_id", uid)
                .order("created_at", { ascending: false })
                .order("id"),
            ),
        fee_bps: await fee(),
        terms_version: SELLER_TERMS_VERSION,
        terms: sellerTerms,
      };
    },
    async adminOverview() {
      const sellers = demo
        ? store.db.users
            .filter((u) => u.role === "seller")
            .map(
              ({
                id,
                name,
                email,
                seller_name,
                seller_debt,
                seller_terms_accepted_at,
                balance,
              }) => ({
                id,
                name,
                email,
                seller_name,
                seller_debt,
                seller_terms_accepted_at,
                balance,
              }),
            )
        : await store.query(
            store.client
              .from("profiles")
              .select(
                "id,name,email,seller_name,seller_debt,seller_terms_accepted_at,balance",
              )
              .eq("role", "seller"),
          );
      const withdrawals = demo
        ? store.db.seller_withdrawals
        : await store.query(
            store.client
              .from("seller_withdrawals")
              .select("*")
              .order("created_at", { ascending: false }),
          );
      const disputes = demo
        ? store.db.seller_disputes || []
        : await store.query(
            store.client
              .from("seller_disputes")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(500),
          );
      return { sellers, withdrawals, disputes, name_requests: await names.pending(), fee_bps: await fee() };
    },
  };
}

export function sellersRouter({
  store,
  auth,
  admin,
  limiter,
  categoryStore,
  productSchema,
  variantSchema,
  secretsSchema,
}) {
  const router = Router(),
    sellers = createSellers(store),
    names = createSellerNameRequests(store),
    uuid = z.string().uuid();
  router.get(
    "/order-chat/:id",
    auth,
    limiter(120, 60000, "order-chat-read"),
    async (req, res) =>
      res.json(
        await sellerConversation(store, req.user.id, uuid.parse(req.params.id)),
      ),
  );
  router.post(
    "/order-chat/:id",
    auth,
    limiter(20, 60000, "order-chat-write"),
    async (req, res) => {
      const input = conversationInput.parse(req.body);
      res.json(
        await sellerConversation(
          store,
          req.user.id,
          uuid.parse(req.params.id),
          input.action,
          input.body,
          input.request_id,
        ),
      );
    },
  );
  router.use(
    "/seller",
    auth,
    (req, res, next) =>
      req.user.role === "seller"
        ? next()
        : next(new AppError("Cần quyền người bán.", 403)),
    limiter(60, 60000, "seller"),
  );
  router.get("/seller/overview", async (req, res) =>
    res.json(await sellers.overview(req.user.id)),
  );
  router.post("/seller/profile", async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(80),
        social_links: z.array(z.string().max(400)).max(5).optional(),
        terms_version: z.literal(SELLER_TERMS_VERSION),
        accepted: z.literal(true),
        fee_bps: z.number().int().min(0).max(10000),
      })
      .strict()
      .parse(req.body);
    if (req.user.seller_name && input.name !== req.user.seller_name) throw new AppError('Đổi tên gian hàng cần được admin duyệt.', 409);
    await sellers.command(req.user.id, "profile", input);
    res.json(await store.profile(req.user.id));
  });
  router.use("/seller", (req, res, next) => {
    try {
      requireSeller(req.user);
      next();
    } catch (e) {
      next(e);
    }
  });
  router.post("/seller/products", async (req, res) => {
    const input = productSchema.parse(req.body);
    await categoryStore.require(input.category);
    res.json(await sellers.command(req.user.id, "product", input));
  });
  router.post("/seller/profile/name", async (req, res) => {
    const { name } = z
      .object({ name: z.string().trim().min(2).max(80) })
      .strict()
      .parse(req.body);
    res.json(await names.submit(req.user.id, name));
  });
  router.get("/seller/support", async (req, res) =>
    res.json(await sellers.support(req.user.id)),
  );
  router.post("/seller/support/:id/messages", async (req, res) => {
    const { body } = z
      .object({ body: z.string().trim().min(3).max(3000) })
      .strict()
      .parse(req.body);
    res.json(
      await sellers.support(req.user.id, uuid.parse(req.params.id), body),
    );
  });
  router.delete("/seller/products/:id", async (req, res) => {
    await store.deleteProduct(uuid.parse(req.params.id), req.user.id);
    res.json({ ok: true });
  });
  router.post("/seller/products/:id/visibility", async (req, res) => {
    const { active } = z
      .object({ active: z.boolean() })
      .strict()
      .parse(req.body);
    res.json(
      await sellers.visibility(req.user.id, uuid.parse(req.params.id), active),
    );
  });
  router.post("/seller/products/:id/variants", async (req, res) =>
    res.json(
      await sellers.command(req.user.id, "variant", {
        product_id: uuid.parse(req.params.id),
        variant: variantSchema.parse(req.body),
      }),
    ),
  );
  router.delete("/seller/variants/:id", async (req, res) => {
    await store.deleteVariant(uuid.parse(req.params.id), req.user.id);
    res.json({ ok: true });
  });
  router.post("/seller/inventory/:id", async (req, res) =>
    res.json(
      await sellers.command(req.user.id, "keys", {
        variant_id: uuid.parse(req.params.id),
        ...secretsSchema.parse(req.body),
      }),
    ),
  );
  router.post("/seller/items/:id/fulfill", async (req, res) =>
    res.json(
      await sellers.command(req.user.id, "fulfill", {
        item_id: uuid.parse(req.params.id),
        ...secretsSchema.parse(req.body),
      }),
    ),
  );
  router.post("/seller/withdrawals", async (req, res) => {
    const input = z
      .object({
        amount: z.number().int().min(50000).max(100000000),
        bank: z.string().trim().min(2).max(100),
        account_number: z.string().regex(/^[0-9]{5,30}$/),
        account_name: z.string().trim().min(2).max(100),
        idempotency: uuid,
      })
      .strict()
      .parse(req.body);
    res.status(201).json(await sellers.command(req.user.id, "withdraw", input));
  });
  router.use(
    "/admin/sellers",
    auth,
    admin,
    limiter(60, 60000, "admin-sellers"),
  );
  router.get("/admin/sellers", async (req, res) =>
    res.json(await sellers.adminOverview()),
  );
  router.post('/admin/sellers/name-requests/:id', async (req, res) => {
    const input = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().trim().max(1000).default('') })
      .strict().refine(v => v.status !== 'rejected' || v.reason.length >= 3, 'Nhập lý do từ chối.').parse(req.body);
    res.json(await names.review(req.user.id, uuid.parse(req.params.id), input.status, input.reason));
  });
  router.post("/admin/sellers/role", async (req, res) =>
    res.json(
      await sellers.command(
        req.user.id,
        "role",
        z
          .object({ user_id: uuid, role: z.enum(["customer", "seller"]) })
          .strict()
          .parse(req.body),
      ),
    ),
  );
  router.post("/admin/sellers/fee", async (req, res) =>
    res.json(
      await sellers.command(
        req.user.id,
        "fee",
        z
          .object({ fee_bps: z.number().int().min(0).max(10000) })
          .strict()
          .parse(req.body),
      ),
    ),
  );
  router.post("/admin/sellers/withdrawals/:id", async (req, res) => {
    const input = z
      .object({
        status: z.enum(["paid", "rejected"]),
        reference: z.string().trim().max(200).default(""),
        reason: z.string().trim().min(3).max(1000),
      })
      .strict()
      .refine(
        (v) => v.status !== "paid" || v.reference.length >= 3,
        "Nhập mã giao dịch chuyển khoản.",
      )
      .parse(req.body);
    res.json(
      await sellers.command(req.user.id, "withdrawal_review", {
        ...input,
        id: uuid.parse(req.params.id),
      }),
    );
  });
  return router;
}
