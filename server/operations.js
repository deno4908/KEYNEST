import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, digest } from "./security.js";

const paging = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});
const reason = z.string().trim().min(10).max(1000);
const shape = (items, total, f) => ({
  items,
  total,
  page: f.page,
  page_size: f.page_size,
  pages: Math.ceil(total / f.page_size),
});
const slice = (items, f) =>
  shape(
    items.slice((f.page - 1) * f.page_size, f.page * f.page_size),
    items.length,
    f,
  );
const listConfig = {
  customers: {
    table: "profiles",
    fields:
      "id,email,name,avatar_url,role,balance,access:account_controls(suspended,reason)",
    search: "email",
    sort: "id",
  },
  orders: {
    table: "orders",
    fields:
      "id,user_id,number,total,status,method,created_at,customer:profiles(id,name,email),items:order_items(id,name,variant_name,quantity,price)",
    search: "number",
    sort: "created_at",
  },
  tickets: {
    table: "tickets",
    fields:
      "id,user_id,subject,status,priority,kind,order_id,created_at,updated_at,customer:profiles(id,name,email)",
    search: "subject",
    sort: "created_at",
  },
};

export function createOperations(store) {
  const demo = !!store.db;
  if (demo) {
    store.db.account_controls ||= [];
    store.db.app_sessions ||= [];
    store.db.notifications ||= [];
  }
  const rows = (name) => store.db[name];
  const query = (q) => store.query(q);
  const now = () => new Date().toISOString();
  return {
    async deleteAnnouncement(actor, id) {
      if (demo) {
        store.db.store_announcements = (
          store.db.store_announcements || []
        ).filter((a) => a.id !== id);
        store.audit(actor, "delete_announcement", id);
        store.save();
        return;
      }
      await query(
        store.client.from("store_announcements").delete().eq("id", id),
      );
      await store.audit(actor, "delete_announcement", id);
    },
    async deleteCampaign(actor, id) {
      if (!demo)
        return query(
          store.client.rpc("delete_store_campaign", {
            p_id: id,
            p_actor: actor,
          }),
        );
      const campaign = (store.db.notification_campaigns || []).find(
        (c) => c.id === id,
      );
      if (campaign) campaign.deleted_at ||= now();
      store.db.notifications = rows("notifications").filter(
        (n) => !n.id.startsWith(`campaign:${id}:`),
      );
      store.audit(actor, "delete_notification", id);
      store.save();
    },
    async announcements(admin = false) {
      if (demo)
        return [...(store.db.store_announcements || [])]
          .filter((a) => admin || a.active)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, admin ? 50 : 5);
      let q = store.client
        .from("store_announcements")
        .select("id,title,body,active,created_at")
        .order("created_at", { ascending: false })
        .limit(admin ? 50 : 5);
      if (!admin) q = q.eq("active", true);
      return query(q);
    },
    async announcement(input) {
      if (demo) {
        store.db.store_announcements ||= [];
        const old = store.db.store_announcements.find((a) => a.id === input.id);
        if (old) Object.assign(old, input);
        else store.db.store_announcements.push({ ...input, created_at: now() });
        store.save();
        return;
      }
      await query(
        store.client
          .from("store_announcements")
          .upsert(input, { onConflict: "id" }),
      );
    },
    async campaigns() {
      if (demo)
        return [...(store.db.notification_campaigns || [])]
          .filter((c) => !c.deleted_at)
          .reverse()
          .slice(0, 50);
      return query(
        store.client
          .from("notification_campaigns")
          .select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(50),
      );
    },
    async sendNotification(actor, input) {
      if (!demo)
        return query(
          store.client.rpc("send_store_notification", {
            p_id: input.id,
            p_actor: actor,
            p_title: input.title,
            p_body: input.body,
            p_email: input.email || null,
          }),
        );
      store.db.notification_campaigns ||= [];
      const previous = store.db.notification_campaigns.find(
        (c) => c.id === input.id,
      );
      if (previous) {
        if (
          previous.actor !== actor ||
          previous.title !== input.title ||
          previous.body !== input.body ||
          previous.email !== input.email
        )
          throw new AppError("Mã gửi đã được sử dụng.", 409);
        return previous.recipients;
      }
      const users = rows("users").filter((u) =>
        input.email
          ? u.email.toLowerCase() === input.email.toLowerCase()
          : ["customer", "seller"].includes(u.role),
      );
      if (input.email && !users.length)
        throw new AppError("Không tìm thấy tài khoản.", 404);
      const created_at = now();
      for (const u of users)
        rows("notifications").push({
          id: `campaign:${input.id}:${u.id}`,
          user_id: u.id,
          title: input.title,
          body: input.body,
          href: "/account",
          created_at,
          read_at: null,
        });
      store.db.notification_campaigns.push({
        ...input,
        actor,
        recipients: users.length,
        created_at,
      });
      store.audit(actor, "send_notification", input.id);
      store.save();
      return users.length;
    },
    async checkAccess(uid) {
      const control = demo
        ? rows("account_controls").find((r) => r.user_id === uid)
        : await query(
            store.client
              .from("account_controls")
              .select("suspended")
              .eq("user_id", uid)
              .maybeSingle(),
          );
      if (control?.suspended)
        throw new AppError(
          "Tài khoản đang bị khóa. Vui lòng liên hệ hỗ trợ.",
          403,
        );
    },
    async authorize(req, token) {
      const uid = req.user.id;
      await this.checkAccess(uid);
      // Supabase token signature/user were already verified with getUser.
      // session_id survives access-token refresh, unlike the access-token hash.
      let identity = token;
      if (!demo) {
        try {
          identity = JSON.parse(
            Buffer.from(token.split(".")[1], "base64url").toString(),
          ).session_id;
        } catch {
          identity = null;
        }
        if (!z.uuid().safeParse(identity).success)
          throw new AppError("Phiên không hợp lệ.", 401);
      }
      const token_hash = digest(`${uid}:${identity}`);
      let session;
      if (demo) {
        session = rows("app_sessions").find((s) => s.token_hash === token_hash);
        if (!session) {
          session = {
            id: randomUUID(),
            user_id: uid,
            token_hash,
            demo_token_hash: digest(token),
            user_agent: (req.get("user-agent") || "").slice(0, 300),
            created_at: now(),
            revoked_at: null,
          };
          rows("app_sessions").push(session);
          store.save();
        }
        if (!session.demo_token_hash) {
          session.demo_token_hash = digest(token);
          store.save();
        }
      } else {
        session = await query(
          store.client.rpc("authorize_app_session", {
            p_user: uid, p_session: identity, p_hash: token_hash,
            p_agent: (req.get("user-agent") || "").slice(0, 300),
          }),
        );
        if (session?.status === "suspended")
          throw new AppError("Tài khoản đang bị khóa. Vui lòng liên hệ hỗ trợ.", 403);
        if (session?.status !== "ok")
          throw new AppError("Phiên đã bị thu hồi. Vui lòng đăng nhập lại.", 401);
      }
      if (session.revoked_at)
        throw new AppError("Phiên đã bị thu hồi. Vui lòng đăng nhập lại.", 401);
      req.sessionId = session.id;
    },
    async sessions(uid, current) {
      const data = demo
        ? rows("app_sessions").filter((s) => s.user_id === uid)
        : await query(
            store.client
              .from("app_sessions")
              .select("id,user_agent,created_at,revoked_at")
              .eq("user_id", uid)
              .order("created_at", { ascending: false })
              .limit(100),
          );
      return data
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 100)
        .map(({ id, user_agent, created_at, revoked_at }) => ({
          id,
          user_agent,
          created_at,
          revoked_at,
          current: id === current,
        }));
    },
    async revoke(uid, id, except, accessToken) {
      if (demo) {
        const selected = rows("app_sessions").filter(
          (s) => s.user_id === uid && (!id || s.id === id) && s.id !== except,
        );
        if (id && !selected.length)
          throw new AppError("Không tìm thấy phiên.", 404);
        for (const s of selected) s.revoked_at ||= now();
        const keep = rows("app_sessions").find(s => s.user_id === uid && s.id === except);
        // Remove the source sessions too, including those never registered by authorize.
        store.db.sessions = store.db.sessions.filter(s => {
          if (s.user_id !== uid) return true;
          // Demo tokens are stored as digests; app_sessions use the original cookie.
          const tracked = rows("app_sessions").find(a => a.user_id === uid && a.demo_token_hash === s.token);
          if (id) return !selected.some(a => a.id === tracked?.id);
          return !!keep && keep.demo_token_hash === s.token;
        });
        store.save();
      } else {
        const result = await query(store.client.rpc("revoke_app_sessions", {
          p_user: uid, p_id: id || null, p_except: except || null,
        }));
        if (!result)
          throw new AppError("Không tìm thấy phiên.", 404);
        // The DB cutoff remains effective even if the Auth provider is unavailable.
        if (!id && accessToken) {
          const { error } = await store.client.auth.admin.signOut(accessToken, except ? "others" : "global");
          if (error) throw new AppError("Đã chặn các phiên trên KEYNEST nhưng chưa đồng bộ được với dịch vụ đăng nhập. Hãy thử lại.", 503);
        }
      }
    },
    async access(actor, uid, input) {
      const user = await store.profile(uid);
      if (!user) throw new AppError("Không tìm thấy khách hàng.", 404);
      if (!["customer", "seller"].includes(user.role))
        throw new AppError("Chỉ thay đổi quyền truy cập của khách hàng.", 409);
      if (demo) {
        let control = rows("account_controls").find((c) => c.user_id === uid);
        if (!control) {
          control = { user_id: uid };
          rows("account_controls").push(control);
        }
        Object.assign(control, input, { updated_at: now() });
        if (input.suspended) {
          // Remove even sessions not yet registered by an authenticated request.
          store.db.sessions = store.db.sessions.filter(
            (s) => s.user_id !== uid,
          );
          for (const s of rows("app_sessions").filter((s) => s.user_id === uid))
            s.revoked_at ||= now();
        }
        store.audit(
          actor,
          "customer_access",
          `${uid}:${input.suspended}:${input.reason}`,
        );
        store.save();
      } else
        await query(
          store.client.rpc("set_customer_access", {
            p_actor: actor,
            p_user: uid,
            p_suspended: input.suspended,
            p_reason: input.reason,
          }),
        );
    },
    async list(kind, f) {
      const c = listConfig[kind];
      if (!demo) {
        let q = store.client.from(c.table).select(c.fields, { count: "exact" });
        if (f.q) q = q.ilike(c.search, `%${f.q.replace(/[\\%_]/g, "\\$&")}%`);
        for (const key of ["status", "user_id", "kind", "priority"])
          if (f[key]) q = q.eq(key, f[key]);
        if (kind === "customers") q = f.role ? q.eq("role", f.role) : q.in("role", ["customer", "seller"]);
        if (f.from) q = q.gte("created_at", f.from);
        if (f.to) q = q.lte("created_at", f.to);
        q = q.order(c.sort, { ascending: false });
        if (c.sort !== "id") q = q.order("id");
        const result = await q.range(
          (f.page - 1) * f.page_size,
          f.page * f.page_size - 1,
        );
        if (result.error)
          throw new AppError("Không thể tải danh sách quản trị.", 503);
        return shape(result.data, result.count, f);
      }
      let data = rows(kind === "customers" ? "users" : kind).filter(
        (r) => kind !== "customers" || (["customer", "seller"].includes(r.role) && (!f.role || r.role === f.role)),
      );
      data = data.filter(
        (r) =>
          (!f.q ||
            String(r[c.search]).toLowerCase().includes(f.q.toLowerCase())) &&
          ["status", "user_id", "kind", "priority"].every(
            (k) => !f[k] || r[k] === f[k],
          ) &&
          (!f.from || Date.parse(r.created_at) >= Date.parse(f.from)) &&
          (!f.to || Date.parse(r.created_at) <= Date.parse(f.to)),
      );
      data = data
        .map((r) => {
          if (kind === "customers")
            return {
              ...store.publicUser(r),
              access:
                rows("account_controls").find((a) => a.user_id === r.id) ||
                null,
            };
          const customer = store.publicUser(
            rows("users").find((u) => u.id === r.user_id),
          );
          const fields =
            kind === "orders"
              ? [
                  "id",
                  "user_id",
                  "number",
                  "total",
                  "status",
                  "method",
                  "created_at",
                ]
              : [
                  "id",
                  "user_id",
                  "subject",
                  "status",
                  "priority",
                  "kind",
                  "order_id",
                  "created_at",
                  "updated_at",
                ];
          const value = Object.fromEntries(fields.map((k) => [k, r[k]]));
          if (kind === "orders")
            value.items = r.items.map(
              ({ id, name, variant_name, quantity, price }) => ({
                id,
                name,
                variant_name,
                quantity,
                price,
              }),
            );
          return {
            ...value,
            customer: {
              id: customer.id,
              name: customer.name,
              email: customer.email,
            },
          };
        })
        .sort(
          (a, b) =>
            String(b[c.sort]).localeCompare(String(a[c.sort])) ||
            a.id.localeCompare(b.id),
        );
      return slice(data, f);
    },
    async discard(actor, id, why) {
      if (!demo)
        return query(
          store.client.rpc("discard_inventory", {
            p_actor: actor,
            p_id: id,
            p_reason: why,
          }),
        );
      const key = rows("inventory").find((i) => i.id === id);
      if (!key) throw new AppError("Không tìm thấy mã kho.", 404);
      if (key.order_id)
        throw new AppError("Mã đã gắn với đơn hàng, không thể loại bỏ.", 409);
      const variant = rows("products")
        .flatMap((p) => p.variants)
        .find((v) => v.id === key.variant_id);
      if (!variant || variant.stock < 1)
        throw new AppError("Tồn kho không hợp lệ.", 409);
      variant.stock--;
      store.db.inventory = rows("inventory").filter((i) => i.id !== id);
      store.audit(actor, "inventory_discard", `${id}:${why}`);
      store.save();
    },
    syncDemoNotifications(uid) {
      if (!demo) return;
      const add = (id, title, href, created_at) => {
        if (!rows("notifications").some((n) => n.id === id))
          rows("notifications").push({
            id,
            user_id: uid,
            title,
            href,
            created_at: created_at || now(),
            read_at: null,
          });
      };
      for (const o of rows("orders").filter((o) => o.user_id === uid))
        add(
          `order:${o.id}:${o.status}`,
          `Đơn ${o.number}: ${o.status}`,
          `/orders/${o.id}`,
          o.created_at,
        );
      for (const t of rows("tickets").filter((t) => t.user_id === uid))
        for (const m of t.messages || [])
          if (m.role === "admin")
            add(
              `reply:${m.id}`,
              "Có phản hồi mới cho yêu cầu hỗ trợ",
              "/support",
              m.created_at,
            );
      for (const p of rows("payments").filter(
        (p) => p.user_id === uid && !p.order_id && p.status === "paid",
      ))
        add(
          `topup:${p.id}`,
          `Nạp ví thành công: ${p.amount} VND`,
          "/wallet",
          p.created_at,
        );
      store.save();
    },
    async notifications(uid, f) {
      this.syncDemoNotifications(uid);
      if (demo) {
        const all = rows("notifications").filter((n) => n.user_id === uid);
        return {
          ...slice(
            all
              .filter((n) => (!f.unread || !n.read_at) && (!f.read || !!n.read_at))
              .sort(
                (a, b) =>
                  b.created_at.localeCompare(a.created_at) ||
                  a.id.localeCompare(b.id),
              ),
            f,
          ),
          unread_count: all.filter((n) => !n.read_at).length,
          unread_chat_count: all.filter((n) => !n.read_at && n.id.startsWith('seller-chat:')).length,
          unread_order_count: all.filter((n) => !n.read_at && (n.id.startsWith('seller-chat:') || n.id.startsWith('seller-refund:'))).length,
        };
      }
      let q = store.client
        .from("notifications")
        .select("id,title,body,href,created_at,read_at", { count: "exact" })
        .eq("user_id", uid);
      if (f.unread) q = q.is("read_at", null);
      if (f.read) q = q.not("read_at", "is", null);
      const [result, unread, unreadChat, unreadOrder] = await Promise.all([
        q
          .order("created_at", { ascending: false })
          .order("id")
          .range((f.page - 1) * f.page_size, f.page * f.page_size - 1),
        store.client
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .is("read_at", null),
        store.client.from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid).is("read_at", null).like("id", "seller-chat:%"),
        store.client.from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid).is("read_at", null).or("id.like.seller-chat:%,id.like.seller-refund:%"),
      ]);
      if (result.error || unread.error || unreadChat.error || unreadOrder.error)
        throw new AppError("Không thể tải thông báo.", 503);
      return {
        ...shape(result.data, result.count, f),
        unread_count: unread.count,
        unread_chat_count: unreadChat.count,
        unread_order_count: unreadOrder.count,
      };
    },
    async readNotification(uid, id) {
      this.syncDemoNotifications(uid);
      if (demo) {
        const selected = rows("notifications").filter(
          (n) => n.user_id === uid && (!id || n.id === id),
        );
        if (id && !selected.length)
          throw new AppError("Không tìm thấy thông báo.", 404);
        for (const n of selected) n.read_at ||= now();
        store.save();
      } else {
        let q = store.client
          .from("notifications")
          .update({ read_at: now() })
          .eq("user_id", uid);
        if (id) q = q.eq("id", id);
        const result = await query(q.select("id"));
        if (id && !result.length)
          throw new AppError("Không tìm thấy thông báo.", 404);
      }
    },
  };
}

export function operationsRouter({ operations: ops, auth, admin, limiter }) {
  const router = Router();
  router.get("/announcements", async (req, res) =>
    res.json(await ops.announcements()),
  );
  router.get("/me/sessions", auth, async (req, res) =>
    res.json(await ops.sessions(req.user.id, req.sessionId)),
  );
  router.post("/me/sessions/revoke", auth, limiter(15), async (req, res) => {
    const { id, others } = z
      .object({ id: z.uuid().optional(), others: z.literal(true).optional() })
      .strict()
      .refine((v) => !!v.id !== !!v.others)
      .parse(req.body);
    await ops.revoke(req.user.id, id, others ? req.sessionId : undefined, req.authToken);
    res.json({ success: true });
  });
  router.get("/notifications", auth, async (req, res) =>
    res.set('Cache-Control', 'private, no-store').json(
      await ops.notifications(
        req.user.id,
        paging
          .extend({
            read: z.enum(["0", "1"]).default("0").transform(v => v === "1"),
            unread: z
              .enum(["0", "1"])
              .default("0")
              .transform((v) => v === "1"),
          })
          .strict()
          .parse(req.query),
      ),
    ),
  );
  router.post("/notifications/read", auth, limiter(60), async (req, res) => {
    const { id, all } = z
      .object({
        id: z.string().min(1).max(150).optional(),
        all: z.literal(true).optional(),
      })
      .strict()
      .refine((v) => !!v.id !== !!v.all)
      .parse(req.body);
    await ops.readNotification(req.user.id, id);
    res.json({ success: true });
  });
  router.use("/admin", auth, admin);
  router.delete("/admin/announcements/:id", async (req, res) => {
    await ops.deleteAnnouncement(req.user.id, z.uuid().parse(req.params.id));
    res.json({ success: true });
  });
  router.delete("/admin/notifications/:id", async (req, res) => {
    await ops.deleteCampaign(req.user.id, z.uuid().parse(req.params.id));
    res.json({ success: true });
  });
  router.get("/admin/announcements", async (req, res) =>
    res.json(await ops.announcements(true)),
  );
  router.post(
    "/admin/announcements",
    limiter(20, 60000, "announcements-write"),
    async (req, res) => {
      const input = z
        .object({
          id: z.uuid(),
          title: z.string().trim().min(3).max(150),
          body: z.string().trim().min(3).max(3000),
          active: z.boolean(),
        })
        .strict()
        .parse(req.body);
      await ops.announcement(input);
      res.json({ success: true });
    },
  );
  router.get("/admin/notifications", async (req, res) =>
    res.json(await ops.campaigns()),
  );
  router.post(
    "/admin/notifications",
    limiter(10, 60000, "admin-notifications"),
    async (req, res) => {
      const input = z
        .object({
          id: z.uuid(),
          title: z.string().trim().min(3).max(150),
          body: z.string().trim().min(3).max(3000),
          email: z.string().trim().email().max(254).optional(),
        })
        .strict()
        .parse(req.body);
      res.json({ recipients: await ops.sendNotification(req.user.id, input) });
    },
  );
  for (const kind of Object.keys(listConfig))
    router.get(`/admin/${kind}`, async (req, res) => {
      let schema = paging.extend({ q: z.string().trim().max(100).default("") });
      if (kind === "customers") schema = schema.extend({ role: z.enum(["customer", "seller"]).optional() });
      if (kind !== "customers")
        schema = schema.extend({
          user_id: z.uuid().optional(),
          from: z.iso.datetime().optional(),
          to: z.iso.datetime().optional(),
          status: z
            .enum(
              kind === "orders"
                ? [
                    "pending",
                    "processing",
                    "completed",
                    "expired",
                    "cancelled",
                    "refunded",
                  ]
                : ["open", "in_progress", "closed"],
            )
            .optional(),
        });
      if (kind === "tickets")
        schema = schema.extend({
          kind: z.enum(["support", "warranty"]).optional(),
          priority: z.enum(["low", "normal", "high"]).optional(),
        });
      const f = schema.strict().parse(req.query);
      if (f.from && f.to && Date.parse(f.from) > Date.parse(f.to))
        throw new AppError("Khoảng thời gian không hợp lệ.");
      res.json(await ops.list(kind, f));
    });
  router.post("/admin/customers/:id/access", async (req, res) => {
    await ops.access(
      req.user.id,
      z.uuid().parse(req.params.id),
      z.object({ suspended: z.boolean(), reason }).strict().parse(req.body),
    );
    res.json({ success: true });
  });
  router.post("/admin/inventory/:id/discard", async (req, res) => {
    const input = z.object({ reason }).strict().parse(req.body);
    await ops.discard(req.user.id, z.uuid().parse(req.params.id), input.reason);
    res.json({ success: true });
  });
  return router;
}
