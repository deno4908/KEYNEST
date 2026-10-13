import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { productImages } from "../shared/product-images.js";
import { sellerPublic } from './seller-accounting.js';
import { AppError, encrypt, decrypt, digest } from "./security.js";
export const makeAuthClient = ({ timeoutMs } = {}) =>
  createClient(config.url, config.anon, {
    ...(timeoutMs ? { global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }) } } : {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
export class SupabaseStore {
  constructor() {
    this.client = createClient(config.url, config.service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.key = config.encryption;
  }
  async query(q) {
    const { data, error } = await q;
    if (error) {
      console.error("Database operation failed:", error.code);
      throw new AppError(
        error.code === "P0001"
          ? error.message
          : error.code === "23505"
            ? "Dữ liệu trùng lặp."
            : "Không thể xử lý dữ liệu.",
        error.code === "23505" ? 409 : 400,
      );
    }
    return data;
  }
  async products(admin = false, identifier) {
    let q = this.client
      .from("products")
      .select("*,variants(*)")
      .order("sort_order");
    if (!admin) q = q.eq("active", true);
    if (identifier)
      q = q.eq(
        /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(identifier) ? "id" : "slug",
        identifier,
      );
    const [products, stats] = await Promise.all([
      this.query(q),
      this.query(this.client.from("product_review_stats").select("*")),
    ]);
    const byProduct = new Map(stats.map((s) => [s.product_id, s]));
    const withSellers = await this.attachSellers(products);
    return withSellers.map((p) => {
      const s = byProduct.get(p.id);
      return {
        ...p,
        image: p.image || productImages[p.slug] || "",
        review_count: s?.review_count || 0,
        rating_average: Number(s?.rating_average || 0),
        rating_counts: s?.rating_counts || [0, 0, 0, 0, 0],
      };
    });
  }
  async catalog(filters) {
    const result = await this.query(
      this.client.rpc("catalog_search", { p_filters: filters }),
    );
    result.items = (await this.attachSellers(result.items)).map((p) => ({
      ...p,
      image: p.image || productImages[p.slug] || "",
    }));
    return result;
  }
  async attachSellers(products) {
    const ids = [...new Set(products.map(p => p.seller_id).filter(Boolean))];
    if (!ids.length) return products;
    const sellers = await this.query(this.client.from('profiles').select('id,name,seller_name').in('id', ids));
    return products.map(p => ({ ...p, seller: sellerPublic(sellers.find(s => s.id === p.seller_id)) }));
  }
  async product(identifier) {
    return (await this.products(false, identifier))[0] || null;
  }
  async banners(admin = false) {
    let q = this.client
      .from("banners")
      .select("*")
      .order("sort_order")
      .order("id");
    if (!admin) q = q.eq("active", true);
    return this.query(q);
  }
  async saveBanner(data) {
    const { id, ...fields } = data;
    return this.query(
      id
        ? this.client
            .from("banners")
            .update(fields)
            .eq("id", id)
            .select()
            .single()
        : this.client.from("banners").insert(fields).select().single(),
    );
  }
  async profile(id) {
    return this.query(
      this.client.from("profiles").select("*").eq("id", id).single(),
    );
  }
  async updateProfile(id, data) {
    return this.query(
      this.client.from("profiles").update(data).eq("id", id).select().single(),
    );
  }
  async audit(user_id, action, target) {
    return this.query(
      this.client.from("audit_logs").insert({ user_id, action, target }),
    );
  }
  async expire() {
    await this.query(this.client.rpc("expire_payments"));
    return this.query(this.client.rpc("release_seller_funds"));
  }
  async createOrder(uid, payload, idempotency) {
    const id = await this.query(
      this.client.rpc("create_order", {
        p_user: uid,
        p_payload: payload,
        p_idempotency: idempotency,
      }),
    );
    return (await this.orders(uid, false, id))[0];
  }
  async createTopup(uid, amount) {
    return this.query(
      this.client.rpc('create_wallet_topup', { p_user: uid, p_amount: amount }).single(),
    );
  }
  async settle(transaction_id, code, amount) {
    return this.query(
      this.client
        .rpc("settle_payment", {
          p_transaction: String(transaction_id),
          p_code: code,
          p_amount: amount,
        })
        .abortSignal(AbortSignal.timeout(20000)),
    );
  }
  async orders(uid, admin = false, id) {
    await this.expire();
    let q = this.client
      .from("orders")
      .select("*,items:order_items(*),payment:payments(*)")
      .order("created_at", { ascending: false });
    if (!admin) q = q.eq("user_id", uid);
    if (id) q = q.eq("id", id);
    const orders = await this.query(q);
    const paid = orders
      .filter((o) => ["completed", "processing"].includes(o.status))
      .map((o) => o.id);
    const inv = paid.length
      ? await this.query(
          this.client
            .from("inventory")
            .select("id,order_id,item_id,secret")
            .in("order_id", paid)
            .order("id"),
        )
      : [];
    return orders.map((o) => ({
      ...o,
      payment: Array.isArray(o.payment) ? o.payment[0] : o.payment,
      items: [...o.items]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((i) => ({
          ...i,
          key_ids: inv
            .filter((k) => k.order_id === o.id && k.item_id === i.id)
            .map((k) => k.id),
          keys: inv
            .filter((k) => k.order_id === o.id && k.item_id === i.id)
            .map((k) => decrypt(k.secret, this.key)),
        })),
    }));
  }
  async payments(uid) {
    await this.expire();
    return this.query(
      this.client
        .from("payments")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false }),
    );
  }
  async ledger(uid) {
    return this.query(
      this.client
        .from("wallet_ledger")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false }),
    );
  }
  async tickets(uid, admin = false, id) {
    let q = this.client
      .from("tickets")
      .select("*,messages:ticket_messages(*)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (!admin) q = q.eq("user_id", uid);
    if (id) q = q.eq("id", id);
    const rows = await this.query(q);
    return rows.map((t) => ({
      ...t,
      messages: t.messages.sort(
        (a, b) =>
          (a.created_at || "").localeCompare(b.created_at || "") ||
          a.id.localeCompare(b.id),
      ),
    }));
  }
  async deleteTicket(id) {
    await this.query(this.client.from('tickets').update({ deleted_at: new Date().toISOString(), status: 'closed' }).eq('id', id));
  }
  async createTicket(uid, data) {
    return this.query(
      this.client
        .from("tickets")
        .insert({ user_id: uid, ...data })
        .select()
        .single(),
    );
  }
  async createWarranty(uid, id, data) {
    const ticket = await this.query(
      this.client.rpc("create_warranty", {
        p_user: uid,
        p_order: id,
        p_keys: data.key_ids,
        p_message: data.message,
      }),
    );
    return this.query(
      this.client
        .from("tickets")
        .select("*")
        .eq("id", ticket)
        .eq("user_id", uid)
        .single(),
    );
  }
  async replyTicket(id, reply, actor, status = "closed", priority = "normal") {
    return this.query(
      this.client.rpc("add_ticket_message", {
        p_actor: actor,
        p_ticket: id,
        p_body: reply,
        p_status: status,
        p_priority: priority,
      }),
    );
  }
  async addTicketMessage(uid, id, body) {
    return this.query(
      this.client.rpc("add_ticket_message", {
        p_actor: uid,
        p_ticket: id,
        p_body: body,
      }),
    );
  }
  async reviews(product_id, page = 1) {
    return this.query(
      this.client
        .from("reviews")
        .select("*")
        .eq("product_id", product_id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range((page - 1) * 20, page * 20 - 1),
    );
  }
  async comments(product_id, page = 1) {
    const result = await this.client
      .from("product_comments")
      .select("*", { count: "exact" })
      .eq("product_id", product_id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * 20, page * 20 - 1);
    const items = await this.query(Promise.resolve(result));
    return { items, total: result.count || 0 };
  }
  async createComment(uid, data) {
    const product = await this.query(
      this.client
        .from("products")
        .select("id")
        .eq("id", data.product_id)
        .eq("active", true)
        .maybeSingle(),
    );
    if (!product) throw new AppError("Sản phẩm không có sẵn.", 404);
    return this.query(
      this.client
        .from("product_comments")
        .insert({ ...data, user_id: uid, name: (await this.profile(uid)).name })
        .select()
        .single(),
    );
  }
  async deleteComment(uid, admin, id) {
    let query = this.client.from("product_comments").delete().eq("id", id);
    if (!admin) query = query.eq("user_id", uid);
    const rows = await this.query(query.select("id"));
    if (!rows.length) throw new AppError("Không tìm thấy bình luận.", 404);
    return { success: true };
  }
  async createReview(uid, data) {
    const orders = await this.orders(uid);
    if (
      !orders.some(
        (o) =>
          o.status === "completed" &&
          o.items.some((i) => i.product_id === data.product_id),
      )
    )
      throw new AppError("Chỉ đánh giá sản phẩm đã mua và nhận.", 403);
    return this.query(
      this.client
        .from("reviews")
        .insert({ user_id: uid, name: (await this.profile(uid)).name, ...data })
        .select()
        .single(),
    );
  }
  async saveProduct(data) {
    const { id, ...fields } = data;
    return this.query(
      id
        ? this.client
            .from("products")
            .update(fields)
            .eq("id", id)
            .select()
            .single()
        : this.client.from("products").insert(fields).select().single(),
    );
  }
  async saveVariant(product_id, data) {
    return this.query(
      this.client.rpc("save_variant", { p_product: product_id, p_data: data }),
    );
  }
  async deleteProduct(id, actor) {
    return this.query(
      this.client.rpc("delete_catalog_product", {
        p_actor: actor,
        p_product: id,
      }),
    );
  }
  async deleteVariant(id, actor) {
    return this.query(
      this.client.rpc("delete_catalog_variant", {
        p_actor: actor,
        p_variant: id,
      }),
    );
  }
  encrypted(secrets) {
    return secrets.map((secret) => ({
      secret: encrypt(secret, this.key),
      hash: digest(secret),
    }));
  }
  async inventory(variant_id, filters) {
    const variant = await this.query(
      this.client
        .from("variants")
        .select("id")
        .eq("id", variant_id)
        .maybeSingle(),
    );
    if (!variant) throw new AppError("Không tìm thấy gói sản phẩm.", 404);
    let query = this.client
      .from("inventory")
      .select("id,variant_id,order_id,item_id", { count: "exact" })
      .eq("variant_id", variant_id)
      .order("id");
    if (filters.state === "available") query = query.is("order_id", null);
    if (filters.state === "assigned") query = query.not("order_id", "is", null);
    const { data, error, count } = await query.range(
      (filters.page - 1) * filters.page_size,
      filters.page * filters.page_size - 1,
    );
    if (error) throw new AppError("Không thể tải danh sách kho.", 503);
    return {
      items: data,
      total: count,
      page: filters.page,
      page_size: filters.page_size,
    };
  }
  async importKeys(variant_id, secrets) {
    await this.query(
      this.client.rpc("import_keys", {
        p_variant: variant_id,
        p_keys: this.encrypted(secrets),
      }),
    );
    return { count: secrets.length };
  }
  async fulfill(id, secrets) {
    return this.query(
      this.client.rpc("fulfill_order", {
        p_order: id,
        p_results: this.encrypted(secrets),
      }),
    );
  }
  async refund(id, options) {
    return this.query(
      this.client.rpc("resolve_warranty_refund", {
        p_order: id,
        p_ticket: options.ticket_id,
        p_actor: options.actor,
        p_method: options.method,
        p_reason: options.reason,
        p_reference: options.reference || "",
      }),
    );
  }
  async cancel(uid, id) {
    return this.query(
      this.client.rpc("cancel_order", { p_user: uid, p_order: id }),
    );
  }
  async overview() {
    const [users, orders, tickets, payments, audit, events, coupons] =
      await Promise.all([
        this.query(this.client.from("profiles").select("*")),
        this.orders(null, true),
        this.tickets(null, true),
        this.query(
          this.client
            .from("payments")
            .select("*")
            .order("created_at", { ascending: false }),
        ),
        this.query(
          this.client
            .from("audit_logs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100),
        ),
        this.query(
          this.client
            .from("payment_events")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(200),
        ),
        this.query(this.client.from("coupons").select("*").order("code")),
      ]);
    const stats = await this.query(
      this.client.from("coupon_usage_stats").select("*"),
    );
    return {
      users,
      orders,
      tickets,
      payments,
      audit,
      events,
      coupons: coupons.map((c) => ({
        ...c,
        ...stats.find((s) => s.code === c.code),
      })),
    };
  }
  async promotions() {
    await this.expire();
    const coupons = await this.query(
      this.client
        .from("coupons")
        .select("*")
        .eq("active", true)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
    );
    const stats = await this.query(
      this.client.from("coupon_usage_stats").select("*"),
    );
    return coupons
      .map((c) => ({ ...c, ...stats.find((s) => s.code === c.code) }))
      .filter(
        (c) =>
          (!c.starts_at || Date.parse(c.starts_at) <= Date.now()) &&
          (c.total_limit === null ||
            c.used_count + c.reserved_count < c.total_limit),
      );
  }
  async quoteCoupon(uid, code, items) {
    await this.expire();
    return this.query(
      this.client.rpc("quote_coupon", {
        p_user: uid,
        p_code: code,
        p_items: items,
      }),
    );
  }
  async saveCoupon(data) {
    if (data.product_ids?.length) {
      const products = await this.query(
        this.client.from("products").select("id").in("id", data.product_ids),
      );
      if (products.length !== new Set(data.product_ids).size)
        throw new AppError("Sản phẩm áp dụng không tồn tại.");
    }
    return this.query(
      this.client.from("coupons").upsert(data).select().single(),
    );
  }
  async reconcile(transaction, user_id, reason, admin_id) {
    return this.query(
      this.client.rpc("credit_reviewed_payment", {
        p_transaction: transaction,
        p_user: user_id,
        p_reason: reason,
        p_admin: admin_id,
      }),
    );
  }
}
