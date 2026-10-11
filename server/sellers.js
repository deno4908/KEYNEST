import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, encrypt } from "./security.js";
import { requireSeller } from "./seller-accounting.js";
import { SELLER_TERMS_VERSION, sellerTerms } from "../shared/seller-terms.js";

export function createSellers(store) {
  const demo = Boolean(store.db);
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
          user.seller_terms_accepted_at || new Date().toISOString(),
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
        item.delivered_at
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
      if (order.items.every((i) => i.delivered_at)) {
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
    async command(actor, action, data) {
      if (demo) return demoCommand(actor, action, data);
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
      const profile = await store.profile(uid);
      const products = (await store.products(true)).filter(
        (p) => p.seller_id === uid,
      );
      const sales = demo
        ? store.db.orders.flatMap((o) =>
            o.items
              .filter((i) => i.seller_id === uid)
              .map((i) => ({
                ...i,
                order: {
                  number: o.number,
                  status: o.status,
                  created_at: o.created_at,
                  customer_note:
                    i.delivery === "manual" && o.paid_at ? o.customer_note : "",
                },
              })),
          )
        : await store.query(
            store.client
              .from("order_items")
              .select(
                "*,order:orders!inner(number,status,created_at,customer_note)",
              )
              .eq("seller_id", uid)
              .order("id"),
          );
      for (const sale of sales) {
        if (
          sale.delivery !== "manual" ||
          !["processing", "completed"].includes(sale.order.status)
        )
          sale.order.customer_note = "";
      }
      const withdrawals = demo
        ? store.db.seller_withdrawals.filter((w) => w.user_id === uid)
        : await store.query(
            store.client
              .from("seller_withdrawals")
              .select("*")
              .eq("user_id", uid)
              .order("created_at", { ascending: false }),
          );
      return {
        profile,
        products,
        sales,
        withdrawals,
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
      return { sellers, withdrawals, fee_bps: await fee() };
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
    uuid = z.string().uuid();
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
  router.delete("/seller/products/:id", async (req, res) => {
    await store.deleteProduct(uuid.parse(req.params.id), req.user.id);
    res.json({ ok: true });
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
