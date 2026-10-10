import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { catalog } from "../shared/catalog.js";
import { productImages } from "../shared/product-images.js";
import { warrantyInfo } from "./warranty.js";
import { calculateCoupon, couponStats } from "./coupons.js";
import { defaultBanners, subcategories } from "../shared/storefront.js";
import { writeDemoSnapshot } from "./demo-persistence.js";
import { searchCatalog } from "./catalog.js";
import { AppError, encrypt, decrypt, hashPassword } from "./security.js";
export class DemoStore {
  constructor(key, path = ".data/demo.json") {
    this.path = path;
    mkdirSync(".data", { recursive: true });
    if (existsSync(path)) this.db = JSON.parse(readFileSync(path, "utf8"));
    else {
      const users = [
        ["student@keynest.local", "Student123!", "customer", "Minh Anh"],
        ["admin@keynest.local", "Admin123!", "admin", "Quản trị viên"],
      ].map(([email, password, role, name]) => ({
        id: randomUUID(),
        email,
        password_hash: hashPassword(password),
        role,
        name,
        balance: role === "admin" ? 0 : 1500000,
      }));
      const products = catalog.map((p, i) => ({
        ...p,
        id: randomUUID(),
        active: true,
        sort_order: i,
        variants: p.variants.map((v) => ({ ...v, id: randomUUID() })),
      }));
      this.db = {
        key,
        users,
        products,
        inventory: [],
        orders: [],
        payments: [],
        events: [],
        ledger: [],
        tickets: [],
        reviews: [],
        audit: [],
        sessions: [],
        coupons: [
          {
            code: "WELCOME10",
            percent: 10,
            max_discount: 100000,
            active: true,
          },
        ],
      };
      for (const p of products)
        for (const v of p.variants)
          if (v.delivery === "key")
            for (let i = 0; i < v.stock; i++)
              this.db.inventory.push({
                id: randomUUID(),
                variant_id: v.id,
                secret: encrypt(
                  `DEMO-${p.slug.toUpperCase()}-${randomBytes(5).toString("hex").toUpperCase()}`,
                  key,
                ),
                order_id: null,
              });
      this.save();
    }
    this.key = this.db.key;
    this.db.events ||= [];
    this.db.product_comments ||= [];
    let upgraded = false;
    for (const p of this.db.products)
      for (const v of p.variants) {
        if (v.warranty_days === undefined) {
          v.warranty_days = 30;
          upgraded = true;
        }
      }
    if (!this.db.banners) {
      this.db.banners = defaultBanners.map((b) => ({ ...b, id: randomUUID() }));
      upgraded = true;
    }
    for (const p of this.db.products)
      if (p.subcategory === undefined) {
        p.subcategory = subcategories[p.slug] || p.platform;
        upgraded = true;
      }
    if (upgraded) this.save();
  }
  banners(admin = false) {
    return this.db.banners
      .filter((b) => admin || b.active)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  }
  saveBanner(data) {
    const existing = data.id
      ? this.db.banners.find((b) => b.id === data.id)
      : null;
    if (data.id && !existing) throw new AppError("Không tìm thấy banner.", 404);
    if (existing) Object.assign(existing, data);
    else this.db.banners.push({ ...data, id: randomUUID() });
    this.save();
    return existing || this.db.banners.at(-1);
  }
  save() {
    writeDemoSnapshot(this.path, this.db);
  }
  publicUser(u) {
    if (!u) return null;
    const { password_hash, ...result } = u;
    return result;
  }
  products(admin = false) {
    return this.db.products
      .filter((p) => admin || p.active)
      .map((p) => {
        const reviews = this.db.reviews.filter((r) => r.product_id === p.id);
        return {
          ...p,
          image: p.image || productImages[p.slug] || "",
          review_count: reviews.length,
          rating_average: reviews.length
            ? Math.round(
                (reviews.reduce((sum, r) => sum + r.rating, 0) /
                  reviews.length) *
                  10,
              ) / 10
            : 0,
          rating_counts: [1, 2, 3, 4, 5].map(
            (n) => reviews.filter((r) => r.rating === n).length,
          ),
        };
      });
  }
  catalog(filters) {
    const result = searchCatalog(this.products(), filters);
    for (const c of this.db.categories || []) result.facets.categories[c.id] ??= 0;
    return result;
  }
  product(identifier) {
    return (
      this.products().find(
        (p) => p.id === identifier || p.slug === identifier,
      ) || null
    );
  }
  profile(id) {
    return this.publicUser(this.db.users.find((u) => u.id === id));
  }
  register(email, password, name) {
    const normalizedName = name.trim().toLowerCase();
    if (this.db.users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
      throw new AppError("Email đã được sử dụng.", 409);
    if (this.db.users.some((u) => (u.registration_name || u.name).trim().toLowerCase() === normalizedName || u.name.trim().toLowerCase() === normalizedName))
      throw new AppError("Tên đăng ký đã được sử dụng.", 409);
    const u = {
      id: randomUUID(),
      email,
      name,
      registration_name: normalizedName,
      role: "customer",
      balance: 0,
      password_hash: hashPassword(password),
    };
    this.db.users.push(u);
    this.save();
    return this.publicUser(u);
  }
  updateProfile(id, data) {
    Object.assign(
      this.db.users.find((u) => u.id === id),
      data,
    );
    this.save();
    return this.profile(id);
  }
  audit(user_id, action, target) {
    this.db.audit.unshift({
      id: randomUUID(),
      user_id,
      action,
      target,
      created_at: new Date().toISOString(),
    });
    this.save();
  }
  expire() {
    const now = Date.now();
    for (const p of this.db.payments)
      if (p.status === "pending" && Date.parse(p.expires_at) < now) {
        p.status = "expired";
        if (p.order_id) {
          const o = this.db.orders.find((x) => x.id === p.order_id);
          if (o.status === "pending") {
            o.status = "expired";
            this.release(o);
          }
        }
      }
    this.save();
  }
  release(order) {
    for (const item of order.items) {
      const v = this.db.products
        .flatMap((p) => p.variants)
        .find((v) => v.id === item.variant_id);
      v.stock += item.quantity;
    }
    for (const inv of this.db.inventory)
      if (inv.order_id === order.id) inv.order_id = null;
  }
  payment(user_id, amount, order_id = null) {
    const p = {
      id: randomUUID(),
      user_id,
      amount,
      order_id,
      code: `KN${randomBytes(8).toString("hex").toUpperCase()}`,
      status: "pending",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
    };
    this.db.payments.unshift(p);
    return p;
  }
  createOrder(uid, payload, idempotency) {
    this.expire();
    const existing = this.db.orders.find(
      (o) => o.user_id === uid && o.idempotency === idempotency,
    );
    if (existing) {
      if (existing.fingerprint !== JSON.stringify(payload))
        throw new AppError("Mã yêu cầu đã được dùng cho giỏ hàng khác.", 409);
      return existing;
    }
    const user = this.db.users.find((u) => u.id === uid);
    const items = [];
    let subtotal = 0;
    for (const line of payload.items) {
      const p = this.db.products.find(
        (p) => p.active && p.variants.some((v) => v.id === line.variant_id),
      );
      const v = p?.variants.find((v) => v.id === line.variant_id);
      if (!v || v.stock < line.quantity)
        throw new AppError("Sản phẩm không đủ tồn kho.", 409);
      if (v.delivery === "manual" && !payload.customer_note.trim())
        throw new AppError("Vui lòng nhập UID / thông tin dịch vụ.");
      if (
        v.delivery === "key" &&
        this.db.inventory.filter((i) => i.variant_id === v.id && !i.order_id)
          .length < line.quantity
      )
        throw new AppError("Kho mã không đủ.", 409);
      items.push({
        id: randomUUID(),
        variant_id: v.id,
        product_id: p.id,
        name: p.name,
        variant_name: v.name,
        price: v.price,
        quantity: line.quantity,
        delivery: v.delivery,
        warranty_days: v.warranty_days,
        product_image: p.image || productImages[p.slug] || "",
        product_slug: p.slug,
        category: p.category,
      });
      subtotal += v.price * line.quantity;
    }
    const coupon = payload.coupon
      ? this.db.coupons.find(
          (c) =>
            c.code === payload.coupon &&
            c.active &&
            (!c.expires_at || Date.parse(c.expires_at) > Date.now()),
        )
      : null;
    if (payload.coupon && !coupon)
      throw new AppError("Mã giảm giá không hợp lệ.");
    const discount = coupon
      ? calculateCoupon(coupon, uid, items, this.db.orders).discount
      : 0;
    const total = subtotal - discount;
    if (payload.method === "wallet" && user.balance < total)
      throw new AppError("Số dư ví không đủ.", 409);
    const o = {
      id: randomUUID(),
      user_id: uid,
      number: `KN-${Date.now().toString(36).toUpperCase()}`,
      items,
      subtotal,
      discount,
      total,
      method: payload.method,
      customer_note: payload.customer_note,
      coupon: payload.coupon,
      idempotency,
      fingerprint: JSON.stringify(payload),
      status:
        payload.method === "wallet"
          ? items.some((i) => i.delivery === "manual")
            ? "processing"
            : "completed"
          : "pending",
      created_at: new Date().toISOString(),
    };
    for (const item of items) {
      const v = this.db.products
        .flatMap((p) => p.variants)
        .find((v) => v.id === item.variant_id);
      v.stock -= item.quantity;
      for (const inv of this.db.inventory
        .filter((i) => i.variant_id === v.id && !i.order_id)
        .slice(0, item.delivery === "key" ? item.quantity : 0)) {
        inv.order_id = o.id;
        inv.item_id = item.id;
      }
    }
    if (o.method === "wallet") {
      o.paid_at = o.created_at;
      this.stampDelivery(o);
      user.balance -= total;
      this.db.ledger.unshift({
        id: randomUUID(),
        user_id: uid,
        amount: -total,
        description: `Thanh toán ${o.number}`,
        created_at: o.created_at,
      });
    } else this.payment(uid, total, o.id);
    this.db.orders.unshift(o);
    this.save();
    return o;
  }
  createTopup(uid, amount) {
    this.expire();
    const p = this.payment(uid, amount);
    this.save();
    return p;
  }
  settle(transaction_id, code, amount) {
    this.expire();
    if (
      this.db.events.some((e) => e.transaction_id === String(transaction_id)) ||
      this.db.payments.some((p) => p.transaction_id === String(transaction_id))
    )
      return { duplicate: true };
    const event = {
      transaction_id: String(transaction_id),
      code,
      amount,
      outcome: "received",
      created_at: new Date().toISOString(),
    };
    this.db.events.unshift(event);
    const p = this.db.payments.find((p) => p.code === code);
    if (!p || p.status !== "pending" || p.amount !== amount) {
      event.outcome = "needs_review";
      this.db.audit.unshift({
        id: randomUUID(),
        action: "payment_needs_review",
        target: code,
        amount,
        transaction_id,
        created_at: new Date().toISOString(),
      });
      this.save();
      return { review: true };
    }
    p.status = "paid";
    event.outcome = "paid";
    p.transaction_id = String(transaction_id);
    if (p.order_id) {
      const o = this.db.orders.find((o) => o.id === p.order_id);
      o.status = o.items.some((i) => i.delivery === "manual")
        ? "processing"
        : "completed";
      o.paid_at = new Date().toISOString();
      this.stampDelivery(o);
    } else {
      this.db.users.find((u) => u.id === p.user_id).balance += amount;
      this.db.ledger.unshift({
        id: randomUUID(),
        user_id: p.user_id,
        amount,
        description: `Nạp ví ${p.code}`,
        created_at: new Date().toISOString(),
      });
    }
    this.save();
    return { paid: true };
  }
  stampDelivery(o) {
    const now = new Date().toISOString();
    if (o.status === "completed") o.completed_at ||= now;
    for (const i of o.items)
      if (
        o.status === "completed" ||
        (o.status === "processing" && i.delivery === "key")
      )
        i.delivered_at ||= now;
  }
  orders(uid, admin = false, id) {
    this.expire();
    return this.db.orders
      .filter((o) => (admin || o.user_id === uid) && (!id || o.id === id))
      .map((o) => ({
        ...o,
        payment: this.db.payments.find((p) => p.order_id === o.id),
        items: [...o.items]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((i) => ({
            ...i,
            key_ids: ["processing", "completed"].includes(o.status)
              ? this.db.inventory
                  .filter((k) => k.order_id === o.id && k.item_id === i.id)
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .map((k) => k.id)
              : [],
            keys: !["pending", "expired", "cancelled", "refunded"].includes(
              o.status,
            )
              ? this.db.inventory
                  .filter((k) => k.order_id === o.id && k.item_id === i.id)
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .map((k) => decrypt(k.secret, this.key))
              : [],
          })),
      }));
  }
  payments(uid) {
    this.expire();
    return this.db.payments.filter((p) => p.user_id === uid);
  }
  ledger(uid) {
    return this.db.ledger.filter((l) => l.user_id === uid);
  }
  tickets(uid, admin = false, id) {
    return this.db.tickets
      .filter((t) => (admin || t.user_id === uid) && (!id || t.id === id))
      .map((t) => ({
        ...t,
        messages:
          t.messages ||
          (t.reply
            ? [
                {
                  id: `legacy-${t.id}`,
                  role: "admin",
                  body: t.reply,
                  created_at: null,
                },
              ]
            : []),
      }));
  }
  createTicket(uid, data) {
    const t = {
      id: randomUUID(),
      user_id: uid,
      ...data,
      status: "open",
      priority: "normal",
      messages: [],
      reply: "",
      created_at: new Date().toISOString(),
    };
    this.db.tickets.unshift(t);
    this.save();
    return t;
  }
  createWarranty(uid, id, data) {
    const o = this.orders(uid, false, id)[0];
    if (!o) throw new AppError("Không tìm thấy đơn hàng.", 404);
    if (
      this.db.tickets.some(
        (t) =>
          t.order_id === id &&
          t.kind === "warranty" &&
          ["open", "in_progress"].includes(t.status),
      )
    )
      throw new AppError("Đơn này đã có yêu cầu bảo hành đang xử lý.", 409);
    for (const key of data.key_ids) {
      const item = o.items.find((i) => i.key_ids.includes(key));
      if (
        !item ||
        !["active", "verify"].includes(
          warrantyInfo(item, o.status).warranty_status,
        )
      )
        throw new AppError(
          "Sản phẩm không thuộc đơn hoặc chưa đủ điều kiện / đã hết hạn bảo hành.",
          400,
        );
    }
    return this.createTicket(uid, {
      subject: `Bảo hành đơn ${o.number}`,
      message: data.message,
      kind: "warranty",
      order_id: id,
      warranty_key_ids: data.key_ids,
    });
  }
  replyTicket(id, reply, actor, status = "closed", priority = "normal") {
    const t = this.db.tickets.find((t) => t.id === id);
    if (!t) throw new AppError("Không tìm thấy yêu cầu.", 404);
    if (
      status !== "closed" &&
      t.kind === "warranty" &&
      this.db.tickets.some(
        (x) =>
          x.id !== t.id &&
          x.order_id === t.order_id &&
          x.kind === "warranty" &&
          ["open", "in_progress"].includes(x.status),
      )
    )
      throw new AppError("Đơn này có yêu cầu bảo hành khác đang mở.", 409);
    t.messages ||= t.reply
      ? [
          {
            id: `legacy-${t.id}`,
            role: "admin",
            body: t.reply,
            created_at: null,
          },
        ]
      : [];
    t.messages.push({
      id: randomUUID(),
      role: "admin",
      author_id: actor || null,
      body: reply,
      created_at: new Date().toISOString(),
    });
    t.reply = reply;
    if (status === "closed" && t.status !== "closed") {
      this.db.notifications ||= [];
      this.db.notifications.push({
        id: randomUUID(),
        user_id: t.user_id,
        title:
          t.kind === "warranty"
            ? "Yêu cầu bảo hành đã được xử lý"
            : "Yêu cầu hỗ trợ đã được xử lý",
        body: `${t.subject} — Mở yêu cầu để xem kết quả và phản hồi.`,
        href: "/support",
        created_at: new Date().toISOString(),
        read_at: null,
      });
    }
    t.status = status;
    t.priority = priority;
    t.updated_at = new Date().toISOString();
    this.save();
    return t;
  }
  addTicketMessage(uid, id, body) {
    const t = this.db.tickets.find((t) => t.id === id && t.user_id === uid);
    if (!t) throw new AppError("Không tìm thấy yêu cầu hỗ trợ.", 404);
    if (
      t.kind === "warranty" &&
      this.db.tickets.some(
        (x) =>
          x.id !== t.id &&
          x.order_id === t.order_id &&
          x.kind === "warranty" &&
          ["open", "in_progress"].includes(x.status),
      )
    )
      throw new AppError(
        "Đơn này có yêu cầu bảo hành khác đang mở. Vui lòng tiếp tục trong yêu cầu đó.",
        409,
      );
    t.messages ||= t.reply
      ? [
          {
            id: `legacy-${t.id}`,
            role: "admin",
            body: t.reply,
            created_at: null,
          },
        ]
      : [];
    t.messages.push({
      id: randomUUID(),
      author_id: uid,
      role: "customer",
      body,
      created_at: new Date().toISOString(),
    });
    t.status = "open";
    t.updated_at = new Date().toISOString();
    this.save();
    return t;
  }
  reviews(product_id, page = 1) {
    return this.db.reviews
      .filter((r) => r.product_id === product_id)
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      )
      .slice((page - 1) * 20, page * 20);
  }
  comments(product_id, page = 1) {
    const rows = this.db.product_comments
      .filter((c) => c.product_id === product_id)
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
    return {
      items: rows.slice((page - 1) * 20, page * 20),
      total: rows.length,
    };
  }
  createComment(uid, data) {
    if (!this.db.products.some((p) => p.id === data.product_id && p.active))
      throw new AppError("Sản phẩm không có sẵn.", 404);
    const row = {
      ...data,
      id: randomUUID(),
      user_id: uid,
      name: this.profile(uid).name,
      created_at: new Date().toISOString(),
    };
    this.db.product_comments.unshift(row);
    this.save();
    return row;
  }
  deleteComment(uid, admin, id) {
    const row = this.db.product_comments.find((c) => c.id === id);
    if (!row || (!admin && row.user_id !== uid))
      throw new AppError("Không tìm thấy bình luận.", 404);
    this.db.product_comments = this.db.product_comments.filter(
      (c) => c.id !== id,
    );
    this.save();
    return { success: true };
  }
  createReview(uid, data) {
    if (
      !this.db.orders.some(
        (o) =>
          o.user_id === uid &&
          o.status === "completed" &&
          o.items.some((i) => i.product_id === data.product_id),
      )
    )
      throw new AppError("Chỉ đánh giá sản phẩm đã mua và nhận.", 403);
    if (
      this.db.reviews.some(
        (r) => r.user_id === uid && r.product_id === data.product_id,
      )
    )
      throw new AppError("Bạn đã đánh giá sản phẩm.");
    const r = {
      id: randomUUID(),
      user_id: uid,
      name: this.profile(uid).name,
      ...data,
      created_at: new Date().toISOString(),
    };
    this.db.reviews.unshift(r);
    this.save();
    return r;
  }
  saveProduct(data) {
    const { variants, ...p } = data;
    if (this.db.products.some((x) => x.slug === p.slug && x.id !== p.id))
      throw new AppError("Slug sản phẩm đã tồn tại.", 409);
    const existing = p.id ? this.db.products.find((x) => x.id === p.id) : null;
    if (p.id && !existing) throw new AppError("Không tìm thấy sản phẩm.", 404);
    if (existing) Object.assign(existing, p);
    else
      this.db.products.push({
        ...p,
        id: randomUUID(),
        sort_order: this.db.products.length,
        variants: [],
      });
    this.save();
    return existing || this.db.products.at(-1);
  }
  saveVariant(product_id, data) {
    const p = this.db.products.find((x) => x.id === product_id);
    if (!p) throw new AppError("Không tìm thấy sản phẩm.", 404);
    const old = data.id ? p.variants.find((v) => v.id === data.id) : null;
    if (data.id && !old) throw new AppError("Không tìm thấy gói.", 404);
    if (old && old.delivery !== data.delivery)
      throw new AppError("Không đổi kiểu giao của gói đang tồn tại.");
    if (old)
      Object.assign(old, {
        ...data,
        stock: old.delivery === "key" ? old.stock : data.stock,
      });
    else
      p.variants.push({
        ...data,
        id: randomUUID(),
        stock: data.delivery === "key" ? 0 : data.stock,
        warranty_days: data.warranty_days ?? 30,
      });
    this.save();
    return p;
  }
  inventory(variant_id, filters) {
    const variant = this.db.products
      .flatMap((p) => p.variants)
      .find((v) => v.id === variant_id);
    if (!variant) throw new AppError("Không tìm thấy gói sản phẩm.", 404);
    const rows = this.db.inventory
      .filter(
        (k) =>
          k.variant_id === variant_id &&
          (filters.state === "all" ||
            (filters.state === "assigned" ? !!k.order_id : !k.order_id)),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      total: rows.length,
      page: filters.page,
      page_size: filters.page_size,
      items: rows
        .slice(
          (filters.page - 1) * filters.page_size,
          filters.page * filters.page_size,
        )
        .map(({ id, variant_id, order_id = null, item_id = null }) => ({
          id,
          variant_id,
          order_id,
          item_id,
        })),
    };
  }
  importKeys(variant_id, secrets) {
    const v = this.db.products
      .flatMap((p) => p.variants)
      .find((v) => v.id === variant_id);
    if (!v || v.delivery !== "key")
      throw new AppError("Gói phải giao mã tự động.");
    const distinct = [...new Set(secrets)];
    if (distinct.length !== secrets.length)
      throw new AppError("Danh sách có mã trùng.");
    for (const s of secrets)
      if (
        this.db.inventory.some(
          (i) =>
            i.variant_id === variant_id && decrypt(i.secret, this.key) === s,
        )
      )
        throw new AppError("Mã đã có trong kho.");
    for (const s of secrets)
      this.db.inventory.push({
        id: randomUUID(),
        variant_id,
        secret: encrypt(s, this.key),
        order_id: null,
      });
    v.stock += secrets.length;
    this.save();
    return { count: secrets.length };
  }
  fulfill(id, secrets) {
    const o = this.db.orders.find((o) => o.id === id);
    if (o?.status !== "processing")
      throw new AppError("Đơn không chờ xử lý.", 409);
    const manual = o.items
      .filter((i) => i.delivery === "manual")
      .sort((a, b) => a.id.localeCompare(b.id));
    if (secrets.length !== manual.reduce((n, i) => n + i.quantity, 0))
      throw new AppError("Cần một kết quả cho mỗi đơn vị dịch vụ.");
    let n = 0;
    for (const i of manual)
      for (let j = 0; j < i.quantity; j++)
        this.db.inventory.push({
          id: randomUUID(),
          variant_id: i.variant_id,
          item_id: i.id,
          order_id: id,
          secret: encrypt(secrets[n++], this.key),
        });
    o.status = "completed";
    this.stampDelivery(o);
    this.save();
    return o;
  }
  refund(id, options) {
    const o = this.db.orders.find((o) => o.id === id);
    if (!o || !["processing", "completed"].includes(o.status))
      throw new AppError("Đơn không thể hoàn tiền.", 409);
    const ticket = this.db.tickets.find(
      (t) =>
        t.id === options?.ticket_id &&
        t.order_id === id &&
        t.user_id === o.user_id &&
        t.kind === "warranty",
    );
    if (!ticket)
      throw new AppError(
        "Hoàn tiền cần gắn với yêu cầu bảo hành của đơn.",
        400,
      );
    if (
      !this.db.users.some((u) => u.id === options.actor && u.role === "admin")
    )
      throw new AppError("Cần quyền quản trị.", 403);
    if (!["wallet", "external"].includes(options.method))
      throw new AppError("Phương thức hoàn tiền không hợp lệ.");
    if (options.method === "wallet") {
      this.db.users.find((u) => u.id === o.user_id).balance += o.total;
      this.db.ledger.unshift({
        id: randomUUID(),
        user_id: o.user_id,
        amount: o.total,
        description: `Hoàn tiền ${o.number}`,
        created_at: new Date().toISOString(),
      });
    }
    o.status = "refunded";
    Object.assign(o, {
      refunded_at: new Date().toISOString(),
      refund_method: options.method,
      refund_reason: options.reason,
      refund_reference: options.reference || "",
      refund_ticket_id: ticket.id,
      refunded_by: options.actor,
    });
    this.replyTicket(
      ticket.id,
      `${options.method === "wallet" ? "Đã hoàn toàn bộ tiền vào ví KEYNEST." : `Đã xác nhận hoàn tiền bên ngoài. Mã giao dịch: ${options.reference}.`} ${options.reason}`,
      options.actor,
    );
    this.audit(options.actor, `refund_${options.method}`, id);
    this.save();
    return o;
  }
  cancel(uid, id) {
    const o = this.db.orders.find((o) => o.id === id && o.user_id === uid);
    if (!o) throw new AppError("Không tìm thấy đơn.", 404);
    if (o.status !== "pending")
      throw new AppError("Chỉ hủy đơn chưa thanh toán.", 409);
    o.status = "cancelled";
    this.release(o);
    const p = this.db.payments.find((p) => p.order_id === id);
    p.status = "cancelled";
    this.save();
    return o;
  }
  overview() {
    return {
      users: this.db.users.map((u) => this.publicUser(u)),
      orders: this.orders(null, true),
      tickets: this.tickets(null, true),
      payments: this.db.payments,
      events: this.db.events,
      coupons: couponStats(this.db.coupons, this.db.orders),
      audit: this.db.audit.slice(0, 100),
    };
  }
  promotions() {
    this.expire();
    return couponStats(this.db.coupons, this.db.orders)
      .filter(
        (c) =>
          c.active && (!c.expires_at || Date.parse(c.expires_at) > Date.now()),
      )
      .filter(
        (c) =>
          (!c.starts_at || Date.parse(c.starts_at) <= Date.now()) &&
          (c.total_limit === null ||
            c.used_count + c.reserved_count < c.total_limit),
      );
  }
  quoteCoupon(uid, code, lines) {
    this.expire();
    const items = lines.map((line) => {
      const p = this.db.products.find(
        (p) => p.active && p.variants.some((v) => v.id === line.variant_id),
      );
      const v = p?.variants.find((v) => v.id === line.variant_id);
      if (!v) throw new AppError("Sản phẩm không còn bán.");
      return {
        product_id: p.id,
        category: p.category,
        price: v.price,
        quantity: line.quantity,
      };
    });
    return calculateCoupon(
      this.db.coupons.find((c) => c.code === code),
      uid,
      items,
      this.db.orders,
    );
  }
  saveCoupon(data) {
    if (
      data.product_ids?.some((id) => !this.db.products.some((p) => p.id === id))
    )
      throw new AppError("Sản phẩm áp dụng không tồn tại.");
    const c = this.db.coupons.find((c) => c.code === data.code);
    if (c) Object.assign(c, data);
    else this.db.coupons.push(data);
    this.save();
    return data;
  }
  reconcile(transaction, user_id, reason, admin_id) {
    const e = this.db.events.find((e) => e.transaction_id === transaction);
    if (e?.outcome !== "needs_review")
      throw new AppError("Giao dịch không chờ đối soát hoặc đã xử lý.", 409);
    const user = this.db.users.find((u) => u.id === user_id);
    if (!user) throw new AppError("Không tìm thấy khách.", 404);
    user.balance += e.amount;
    e.outcome = "credited";
    e.credited_user_id = user_id;
    e.reason = reason;
    e.credited_at = new Date().toISOString();
    this.db.ledger.unshift({
      id: randomUUID(),
      user_id,
      amount: e.amount,
      description: `Đối soát giao dịch ${transaction}`,
      created_at: e.credited_at,
    });
    this.audit(admin_id, "credit_reviewed_payment", transaction);
    return { ok: true };
  }
}
