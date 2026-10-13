// Executes the exact Supabase migration in an ephemeral PostgreSQL (WASM) instance.
// Supabase Auth is replaced only by a local users table and auth.uid() claim stub.
// No network credentials, persistent files or live databases are used.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const db = new PGlite({ extensions: { pgcrypto } });
const user = randomUUID(),
  other = randomUUID(),
  product = randomUUID(),
  variant = randomUUID(),
  manual = randomUUID();
let checks = 0;
const pass = (name) => {
  checks++;
  console.log(`PASS ${name}`);
};
async function scalar(sql, params = []) {
  return Object.values((await db.query(sql, params)).rows[0])[0];
}
async function fails(sql, params = []) {
  await assert.rejects(db.query(sql, params));
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; grant usage on schema auth,public to anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email text,encrypted_password text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant execute on function auth.uid() to anon,authenticated,service_role;`);
  for (const name of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  pass("migration compiles with pgcrypto and all functions");
  const recoveryUser = randomUUID();
  const recoveryId = randomUUID();
  const recoveryEmailHash = "a".repeat(64);
  const recoveryTicketHash = "b".repeat(64);
  const recoveryExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const recoveryNow = new Date().toISOString();
  await db.query("insert into auth.users(id,email) values($1,'recovery@example.test')", [recoveryUser]);
  await db.query(`insert into password_recovery_links(email_hash,recovery_id,expires_at,consumed_at)
    values($1,$2,$3,$4)`, [recoveryEmailHash, recoveryId, recoveryExpires, recoveryNow]);
  await db.query(`insert into password_recovery_tickets
    (ticket_hash,email_hash,recovery_id,user_id,encrypted_session,expires_at)
    values($1,$2,$3,$4,'encrypted-session',$5)`,
    [recoveryTicketHash, recoveryEmailHash, recoveryId, recoveryUser, recoveryExpires]);
  const firstClaim = await db.query("select * from claim_password_recovery_reset($1,$2)",
    [recoveryTicketHash, recoveryNow]);
  assert.equal(firstClaim.rows.length, 1);
  assert.equal(firstClaim.rows[0].user_id, recoveryUser);
  assert.deepEqual((await db.query("select * from claim_password_recovery_reset($1,$2)",
    [recoveryTicketHash, recoveryNow])).rows, []);
  const staleTicketHash = "c".repeat(64);
  await db.query(`insert into password_recovery_tickets
    (ticket_hash,email_hash,recovery_id,user_id,encrypted_session,expires_at)
    values($1,$2,$3,$4,'encrypted-session',$5)`,
    [staleTicketHash, recoveryEmailHash, recoveryId, recoveryUser, recoveryExpires]);
  await db.query("update password_recovery_links set recovery_id=$2, consumed_at=null where email_hash=$1",
    [recoveryEmailHash, randomUUID()]);
  assert.deepEqual((await db.query("select * from claim_password_recovery_reset($1,$2)",
    [staleTicketHash, recoveryNow])).rows, []);
  assert.equal(await scalar("select has_function_privilege('authenticated','claim_password_recovery_reset(text,timestamptz)','EXECUTE')"), false);
  assert.equal(await scalar("select has_function_privilege('service_role','claim_password_recovery_reset(text,timestamptz)','EXECUTE')"), true);
  pass("password recovery links/tickets expire, reject replay and stale generations, and only service_role can claim");
  const missingProfile = randomUUID(), existingProfile = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'existing-profile@example.test')", [existingProfile]);
  await db.query("update profiles set role='seller',balance=12345 where id=$1", [existingProfile]);
  await db.exec('drop trigger new_auth_user on auth.users');
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'missing-profile@example.test','{\"name\":\"Email Customer\",\"role\":\"admin\"}')", [missingProfile]);
  await db.exec(await readFile(new URL('../supabase/migrations/023_restore_customer_profiles.sql', import.meta.url), 'utf8'));
  assert.equal(await scalar('select role from profiles where id=$1', [missingProfile]), 'customer');
  assert.equal(await scalar('select name from profiles where id=$1', [missingProfile]), 'Email Customer');
  assert.equal(await scalar('select balance::int from profiles where id=$1', [existingProfile]), 12345);
  assert.equal(await scalar('select role from profiles where id=$1', [existingProfile]), 'seller');
  await db.query('delete from auth.users where id in ($1,$2)', [missingProfile, existingProfile]);
  pass('missing email customer profiles restored without changing existing roles or balances');
  await db.exec('begin');
  const registrationId = randomUUID();
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'Duplicate@example.test',$2)",
    [registrationId, JSON.stringify({ name: 'Reserved Name', registration_name: ' Reserved Name ' })]);
  assert.deepEqual(await scalar("select registration_conflicts('duplicate@EXAMPLE.test','reserved name')"), { email: true, name: true });
  await fails("insert into auth.users(id,email,raw_user_meta_data) values($1,'another@example.test',$2)",
    [randomUUID(), JSON.stringify({ name: 'reserved name', registration_name: 'RESERVED NAME' })]);
  await db.exec('rollback');
  pass('registration rejects normalized duplicate names in the database and detects existing emails');
  await db.exec('begin');
  await db.exec("insert into categories(id,name) values('phan-mem','Software')");
  const categoryProduct = randomUUID();
  await db.query("insert into products(id,slug,name,category,platform) values($1,'dynamic-category-test','Software','phan-mem','PC')", [categoryProduct]);
  await db.query("insert into variants(product_id,name,price,original_price,delivery,stock,region) values($1,'Standard',10000,10000,'manual',1,'Global')", [categoryProduct]);
  const categoryResult = await scalar("select catalog_search('{\"category\":\"phan-mem\"}'::jsonb)");
  assert.equal(categoryResult.total, 1);
  assert.equal(categoryResult.facets.categories['phan-mem'], 1);
  await db.exec('set local role authenticated');
  assert.equal(await scalar("select count(*)::int from categories where id='phan-mem'"), 1);
  await fails("update categories set name='Changed' where id='phan-mem'");
  await db.exec('rollback');
  pass('dynamic categories support catalog filters and prohibit direct customer edits');
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await scalar("select has_schema_privilege($1,'public','CREATE')", [role]), false);
    const writable = await db.query(`select c.relname from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p','v','m')
      and (has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege($1,c.oid,'INSERT,UPDATE,REFERENCES'))`, [role]);
    assert.deepEqual(writable.rows, [], `${role} must not write application tables`);
    const callable = await db.query(`select p.proname from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f'
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      and has_function_privilege($1,p.oid,'EXECUTE')`, [role]);
    assert.deepEqual(callable.rows, [], `${role} must not call business RPCs`);
  }
  assert.deepEqual((await db.query(`select c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity`)).rows, []);
  const forgedUser = randomUUID();
  await db.query(`insert into auth.users(id,email,raw_user_meta_data)
    values($1,'forged-role@example.test','{"name":"Forged","role":"admin","balance":999999999}')`, [forgedUser]);
  assert.deepEqual((await db.query('select role,balance::int from profiles where id=$1', [forgedUser])).rows,
    [{ role: 'customer', balance: 0 }]);
  await db.query('delete from profiles where id=$1', [forgedUser]);
  await db.query('delete from auth.users where id=$1', [forgedUser]);
  pass('browser roles cannot create objects, write tables, call business RPCs or forge administrator metadata');
  await db.exec(
    "insert into banners(title, image, href, cta, active) values ('Hidden banner','https://shared.fastly.steamstatic.com/test.jpg','/catalog','Browse',false)",
  );
  await db.exec("set role anon");
  assert.equal(Number(await scalar("select count(*) from banners")), 3);
  await fails("update banners set active=true");
  await fails(
    "insert into banners(title,image,href,cta) values ('Injected','https://shared.fastly.steamstatic.com/test.jpg','/catalog','Browse')",
  );
  await db.exec("reset role; set role authenticated");
  assert.equal(
    Number(await scalar("select count(*) from banners where active=false")),
    0,
  );
  await fails("delete from banners");
  await db.exec("reset role; set role service_role");
  assert.equal(Number(await scalar("select count(*) from banners")), 4);
  await db.exec("reset role");
  pass("banner RLS hides drafts and denies direct customer mutations");
  await db.query(
    "insert into auth.users(id,email,raw_user_meta_data) values($1,'buyer@example.test','{\"name\":\"Buyer\"}'),($2,'other@example.test','{}')",
    [user, other],
  );
  assert.equal(
    await scalar("select role from profiles where id=$1", [user]),
    "customer",
  );
  await db.query("update profiles set balance=1000000 where id=$1", [user]);
  await db.query(
    "insert into products(id,slug,name,category,platform) values($1,'test-game','Test Game','game','Steam')",
    [product],
  );
  await db.query(
    "insert into variants(id,product_id,name,price,original_price,delivery,stock,region) values($1,$2,'Standard',100000,150000,'key',0,'Global'),($3,$2,'Proxy',50000,50000,'manual',10,'SG')",
    [variant, product, manual],
  );
  await db.query("select import_keys($1,$2)", [
    variant,
    JSON.stringify(
      Array.from({ length: 5 }, (_, i) => ({
        secret: `encrypted-${i}`,
        hash: `hash-${i}`,
      })),
    ),
  ]);
  assert.equal(
    await scalar("select stock from variants where id=$1", [variant]),
    5,
  );
  pass(
    "auth trigger creates customer profile and inventory imports update stock",
  );
  await db.exec("begin");
  const catalogProduct = randomUUID(),
    hiddenProduct = randomUUID();
  await db.query(
    "insert into products(id,slug,name,category,platform,active) values ($1,'accent-test','Đường truyền đặc biệt','mmo','Proxy',true),($2,'hidden-test','Hidden item','gift','Hidden platform',false)",
    [catalogProduct, hiddenProduct],
  );
  await db.query(
    "insert into variants(product_id,name,price,original_price,delivery,stock,region) values ($1,'Cheap',50000,60000,'manual',0,'VN'),($1,'Available',500000,600000,'manual',2,'SG'),($2,'Hidden',10000,10000,'manual',1,'SECRET')",
    [catalogProduct, hiddenProduct],
  );
  await db.exec("set local role service_role");
  const search = (filters) =>
    scalar("select catalog_search($1)", [JSON.stringify(filters)]);
  const accentResult = await search({ q: "duong truyen dac biet" });
  assert.equal(accentResult.total, 1);
  assert.equal(accentResult.items[0].id, catalogProduct);
  assert.equal(accentResult.items[0].variants.length, 2);
  assert.equal(accentResult.items[0].review_count, 0);
  assert.equal("min_price" in accentResult.items[0], false);
  assert.equal(
    (await search({ q: "duong truyen", stock: "1", max: 100000 })).total,
    0,
  );
  assert.equal(
    (await search({ q: "duong truyen", stock: "1", region: "SG", sale: "1" }))
      .total,
    1,
  );
  const firstPage = await search({ sort: "asc", page_size: 1 });
  const nextPage = await search({ sort: "asc", page_size: 1, page: 2 });
  assert.notEqual(firstPage.items[0].id, nextPage.items[0].id);
  assert.equal((await search({ q: "Hidden item" })).total, 0);
  assert.equal(firstPage.facets.platforms.includes("Hidden platform"), false);
  assert.equal(firstPage.facets.regions.includes("SECRET"), false);
  const beyond = await search({ page: 9999, page_size: 1 });
  assert.equal(beyond.page, beyond.pages);
  await db.exec("set local role anon");
  assert.equal(
    await scalar(
      "select has_function_privilege('anon','catalog_search(jsonb)','execute')",
    ),
    false,
  );
  await db.exec("set local role authenticated");
  assert.equal(
    await scalar(
      "select has_function_privilege('authenticated','catalog_search(jsonb)','execute')",
    ),
    false,
  );
  await db.exec("rollback");
  pass(
    "catalog SQL handles Vietnamese search, same-variant filters, pagination, hidden products and RPC grants",
  );
  await fails("select import_keys($1,$2)", [
    variant,
    JSON.stringify([{ secret: "duplicate", hash: "hash-0" }]),
  ]);
  assert.equal(
    await scalar("select stock from variants where id=$1", [variant]),
    5,
  );
  pass("duplicate inventory rolls back stock mutation");
  const key = randomUUID();
  const payload = {
    items: [{ variant_id: variant, quantity: 1 }],
    method: "wallet",
    coupon: "WELCOME10",
    customer_note: "",
  };
  const order = await scalar("select create_order($1,$2,$3)", [
    user,
    JSON.stringify(payload),
    key,
  ]);
  assert.equal(
    Number(await scalar("select total from orders where id=$1", [order])),
    90000,
  );
  assert.equal(
    Number(await scalar("select balance from profiles where id=$1", [user])),
    910000,
  );
  assert.equal(
    await scalar("select create_order($1,$2,$3)", [
      user,
      JSON.stringify(payload),
      key,
    ]),
    order,
  );
  assert.equal(
    Number(await scalar("select balance from profiles where id=$1", [user])),
    910000,
  );
  await fails("select create_order($1,$2,$3)", [
    user,
    JSON.stringify({ ...payload, coupon: "" }),
    key,
  ]);
  pass("authoritative prices, coupon and idempotency debit exactly once");
  const balance = await scalar("select balance from profiles where id=$1", [
    user,
  ]);
  await fails("select create_order($1,$2,$3)", [
    user,
    JSON.stringify({
      ...payload,
      items: [{ variant_id: variant, quantity: 10 }],
    }),
    randomUUID(),
  ]);
  assert.equal(
    await scalar("select balance from profiles where id=$1", [user]),
    balance,
  );
  pass("overselling rolls back wallet/order changes");
  const topup = (
    await db.query(
      "insert into payments(user_id,amount) values($1,200000) returning *",
      [user],
    )
  ).rows[0];
  const result = await scalar("select settle_payment($1,$2,$3)", [
    "1001",
    topup.code,
    200000,
  ]);
  assert.equal(result.paid, true);
  assert.equal(
    (
      await scalar("select settle_payment($1,$2,$3)", [
        "1001",
        topup.code,
        200000,
      ])
    ).duplicate,
    true,
  );
  assert.equal(
    Number(await scalar("select balance from profiles where id=$1", [user])),
    1110000,
  );
  pass("webhook duplicate cannot double-credit wallet");
  const ledgerBeforeReplay = await scalar('select count(*)::int from wallet_ledger where user_id=$1', [user]);
  const noticesBeforeReplay = await scalar('select count(*)::int from notifications where user_id=$1', [user]);
  for (let i=0; i<20; i++) {
    assert.equal((await scalar('select settle_payment($1,$2,$3)', ['1001', topup.code, 200000])).duplicate, true);
  }
  assert.equal((await scalar('select settle_payment($1,$2,$3)', ['1001-alternate', topup.code, 200000])).review, true);
  const anotherTopup = (await db.query('insert into payments(user_id,amount) values($1,200000) returning *', [user])).rows[0];
  assert.equal((await scalar('select settle_payment($1,$2,$3)', ['1001', anotherTopup.code, 200000])).duplicate, true);
  assert.equal(await scalar('select status from payments where id=$1', [anotherTopup.id]), 'pending');
  assert.equal(Number(await scalar('select balance from profiles where id=$1', [user])), 1110000);
  assert.equal(await scalar('select count(*)::int from wallet_ledger where user_id=$1', [user]), ledgerBeforeReplay);
  assert.equal(await scalar('select count(*)::int from notifications where user_id=$1', [user]), noticesBeforeReplay);
  pass('20 replays, alternate transaction IDs for paid code and reused transaction ID for another code cannot auto-credit or notify twice');
  const unpaid = await scalar("select create_order($1,$2,$3)", [
    user,
    JSON.stringify({ ...payload, method: "sepay", coupon: "" }),
    randomUUID(),
  ]);
  const unpaidPayment = (
    await db.query("select * from payments where order_id=$1", [unpaid])
  ).rows[0];
  assert.equal(
    (
      await scalar("select settle_payment($1,$2,$3)", [
        "1002",
        unpaidPayment.code,
        123,
      ])
    ).review,
    true,
  );
  assert.equal(
    await scalar("select status from orders where id=$1", [unpaid]),
    "pending",
  );
  await db.query(
    "update payments set expires_at=now()-interval '1 second' where id=$1",
    [unpaidPayment.id],
  );
  await db.query("select expire_payments()");
  assert.equal(
    await scalar("select status from orders where id=$1", [unpaid]),
    "expired",
  );
  assert.equal(
    await scalar("select stock from variants where id=$1", [variant]),
    4,
  );
  assert.equal(
    (
      await scalar("select settle_payment($1,$2,$3)", [
        "1003",
        unpaidPayment.code,
        100000,
      ])
    ).review,
    true,
  );
  pass(
    "wrong amount and late payment require review; expired reservation releases stock",
  );
  await db.query("update profiles set role='admin' where id=$1", [other]);
  const beforeCredit = Number(
    await scalar("select balance from profiles where id=$1", [user]),
  );
  await db.query("select credit_reviewed_payment($1,$2,$3,$4)", [
    "1003",
    user,
    "Bank transfer matched to customer proof",
    other,
  ]);
  await fails("select credit_reviewed_payment($1,$2,$3,$4)", [
    "1003",
    user,
    "Duplicate credit must be refused",
    other,
  ]);
  await fails("select credit_reviewed_payment($1,$2,$3,$4)", [
    "1002",
    user,
    "Customer cannot approve this credit",
    user,
  ]);
  assert.equal(
    Number(await scalar("select balance from profiles where id=$1", [user])),
    beforeCredit + 100000,
  );
  pass(
    "reconciliation requires admin, uses received amount and cannot credit twice",
  );
  const servicePayload = {
    items: [{ variant_id: manual, quantity: 1 }],
    method: "wallet",
    coupon: "",
    customer_note: "SG proxy",
  };
  await fails("select create_order($1,$2,$3)", [
    user,
    JSON.stringify({ ...servicePayload, customer_note: "" }),
    randomUUID(),
  ]);
  const serviceOrder = await scalar("select create_order($1,$2,$3)", [
    user,
    JSON.stringify(servicePayload),
    randomUUID(),
  ]);
  assert.equal(
    await scalar("select status from orders where id=$1", [serviceOrder]),
    "processing",
  );
  await db.query("select fulfill_order($1,$2)", [
    serviceOrder,
    JSON.stringify([{ secret: "encrypted-result", hash: "result-hash" }]),
  ]);
  assert.equal(
    await scalar("select status from orders where id=$1", [serviceOrder]),
    "completed",
  );
  await fails("select fulfill_order($1,$2)", [
    serviceOrder,
    JSON.stringify([{ secret: "encrypted-result", hash: "result-hash" }]),
  ]);
  pass("manual service requires target and can be delivered only once");
  const beforeRefund = Number(
    await scalar("select balance from profiles where id=$1", [user]),
  );
  const refundKey = await scalar("select id from inventory where order_id=$1", [
    order,
  ]);
  const refundTicket = await scalar("select create_warranty($1,$2,$3,$4)", [
    user,
    order,
    [refundKey],
    "Defective code requires review",
  ]);
  const refundArgs = [
    order,
    refundTicket,
    other,
    "wallet",
    "Defective product verified by support",
    "",
  ];
  await db.query(
    "select resolve_warranty_refund($1,$2,$3,$4,$5,$6)",
    refundArgs,
  );
  await fails("select resolve_warranty_refund($1,$2,$3,$4,$5,$6)", refundArgs);
  assert.equal(
    Number(await scalar("select balance from profiles where id=$1", [user])),
    beforeRefund + 90000,
  );
  assert.equal(
    await scalar("select stock from variants where id=$1", [variant]),
    4,
  );
  pass("refund credits exactly once without returning used keys to stock");
  await db.exec("set role anon");
  assert.equal(Number(await scalar("select count(*) from products")), 1);
  await fails("select * from inventory");
  await fails("select * from profiles");
  await fails("select refund_order($1)", [order]);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.exec("set role authenticated");
  assert.equal(Number(await scalar("select count(*) from orders")), 0);
  assert.equal(Number(await scalar("select count(*) from profiles")), 1);
  await fails("update profiles set role='admin'");
  await fails("select create_order($1,$2,$3)", [
    user,
    JSON.stringify(payload),
    randomUUID(),
  ]);
  await fails("select credit_reviewed_payment($1,$2,$3,$4)", [
    "1002",
    other,
    "Direct RPC must not be allowed",
    other,
  ]);
  await db.exec("reset role");
  pass(
    "RLS/grants deny anonymous secrets, cross-user orders and direct role/RPC escalation",
  );
  await db.query(
    "insert into reviews(user_id,product_id,name,rating,comment) values($1,$3,'Buyer',5,'Excellent'),($2,$3,'Other',3,'Average')",
    [user, other, product],
  );
  await db.query(
    "insert into product_comments(user_id,product_id,name,body) values($1,$2,'Buyer','Product question')",
    [user, product],
  );
  await db.exec("set role service_role");
  const feedbackStats = (
    await db.query("select * from product_review_stats where product_id=$1", [
      product,
    ])
  ).rows[0];
  assert.equal(feedbackStats.review_count, 2);
  assert.equal(Number(feedbackStats.rating_average), 4);
  assert.deepEqual(feedbackStats.rating_counts, [0, 0, 1, 0, 1]);
  await fails(
    "insert into product_comments(user_id,product_id,name,body) values($1,$2,'Invalid','  ')",
    [user, product],
  );
  await db.exec("reset role; set role anon");
  assert.equal(
    Number(await scalar("select count(*) from product_comments")),
    1,
  );
  await fails("select * from product_review_stats");
  await fails(
    "insert into product_comments(user_id,product_id,name,body) values($1,$2,'Fake','Forged comment')",
    [user, product],
  );
  await db.exec("reset role; set role authenticated");
  await fails("update product_comments set name='Forged'");
  await fails("delete from product_comments");
  await db.exec("reset role");
  await db.query("update products set active=false where id=$1", [product]);
  await db.exec("set role anon");
  assert.equal(
    Number(await scalar("select count(*) from product_comments")),
    0,
  );
  await db.exec("reset role");
  pass(
    "feedback aggregates are exact; comments enforce RLS, grants and length constraints",
  );
  // Warranty policies are snapshots; only service-role RPC can create claims.
  await db.query("update products set active=true where id=$1", [product]);
  const savedVariant = {
    id: variant,
    name: "Standard",
    price: 100000,
    original_price: 150000,
    delivery: "key",
    stock: 0,
    region: "Global",
    warranty_days: 30,
  };
  await db.exec("set role service_role");
  await db.query("select save_variant($1,$2)", [
    product,
    JSON.stringify(savedVariant),
  ]);
  const warrantyOrder = await scalar("select create_order($1,$2,$3)", [
    user,
    JSON.stringify(payload),
    randomUUID(),
  ]);
  const warrantyItem = (
    await db.query("select * from order_items where order_id=$1", [
      warrantyOrder,
    ])
  ).rows[0];
  const warrantyKey = await scalar(
    "select id from inventory where order_id=$1",
    [warrantyOrder],
  );
  assert.equal(warrantyItem.warranty_days, 30);
  assert.ok(warrantyItem.delivered_at);
  assert.equal(warrantyItem.product_slug, "test-game");
  assert.ok(
    await scalar("select paid_at from orders where id=$1", [warrantyOrder]),
  );
  assert.ok(
    await scalar("select completed_at from orders where id=$1", [
      warrantyOrder,
    ]),
  );
  await db.query("select save_variant($1,$2)", [
    product,
    JSON.stringify({ ...savedVariant, warranty_days: 7 }),
  ]);
  assert.equal(
    await scalar("select warranty_days from order_items where id=$1", [
      warrantyItem.id,
    ]),
    30,
  );
  await fails("select save_variant($1,$2)", [
    product,
    JSON.stringify({ ...savedVariant, warranty_days: -1 }),
  ]);
  assert.equal(
    await scalar("select warranty_days from variants where id=$1", [variant]),
    7,
  );
  await fails("select create_warranty($1,$2,$3,$4)", [
    other,
    warrantyOrder,
    [warrantyKey],
    "Cannot claim another buyer's key",
  ]);
  await fails("select create_warranty($1,$2,$3,$4)", [
    user,
    warrantyOrder,
    [randomUUID()],
    "Foreign key must be refused",
  ]);
  await fails("select create_warranty($1,$2,$3,$4)", [
    user,
    warrantyOrder,
    [],
    "Empty keys must be refused",
  ]);
  await fails("select create_warranty($1,$2,$3,$4)", [
    user,
    warrantyOrder,
    [warrantyKey, warrantyKey],
    "Duplicates must be refused",
  ]);
  const claim = await scalar("select create_warranty($1,$2,$3,$4)", [
    user,
    warrantyOrder,
    [warrantyKey],
    "Activation failed with an error message",
  ]);
  assert.equal(
    await scalar("select kind from tickets where id=$1", [claim]),
    "warranty",
  );
  await fails("select create_warranty($1,$2,$3,$4)", [
    user,
    warrantyOrder,
    [warrantyKey],
    "Duplicate open ticket must be refused",
  ]);
  await db.query(
    "update tickets set status='closed',reply='Checked' where id=$1",
    [claim],
  );
  await db.query(
    "update order_items set delivered_at=now()-interval '31 days' where id=$1",
    [warrantyItem.id],
  );
  await fails("select create_warranty($1,$2,$3,$4)", [
    user,
    warrantyOrder,
    [warrantyKey],
    "Expired key must be refused",
  ]);
  await db.query(
    "update order_items set delivered_at=now(),warranty_days=0 where id=$1",
    [warrantyItem.id],
  );
  await fails("select create_warranty($1,$2,$3,$4)", [
    user,
    warrantyOrder,
    [warrantyKey],
    "No warranty must be refused",
  ]);
  await db.query(
    "update order_items set delivered_at=null,warranty_days=null where id=$1",
    [warrantyItem.id],
  );
  assert.ok(
    await scalar("select create_warranty($1,$2,$3,$4)", [
      user,
      warrantyOrder,
      [warrantyKey],
      "Legacy order needs manual verification",
    ]),
  );
  await db.query("update tickets set status='closed' where order_id=$1", [
    warrantyOrder,
  ]);
  await fails("select refund_order($1)", [warrantyOrder]);
  await db.query("select resolve_warranty_refund($1,$2,$3,$4,$5,$6)", [
    warrantyOrder,
    claim,
    other,
    "wallet",
    "Warranty verified before refund",
    "",
  ]);
  await fails("select create_warranty($1,$2,$3,$4)", [
    user,
    warrantyOrder,
    [warrantyKey],
    "Refunded order must be refused",
  ]);
  await db.exec("reset role; set role authenticated");
  await fails("select create_warranty($1,$2,$3,$4)", [
    user,
    warrantyOrder,
    [warrantyKey],
    "Direct RPC must be refused",
  ]);
  await fails("select save_variant($1,$2)", [
    product,
    JSON.stringify(savedVariant),
  ]);
  await fails("select save_variant_core($1,$2)", [
    product,
    JSON.stringify(savedVariant),
  ]);
  await fails("update order_items set warranty_days=3650");
  await fails(
    "insert into tickets(user_id,subject,message,kind,order_id) values($1,'Forged','Bypass','warranty',$2)",
    [user, warrantyOrder],
  );
  await db.exec("reset role");
  pass(
    "warranty snapshot, expiry, legacy verification, ownership, duplicate prevention and RPC grants",
  );

  const mixedPayload = {
    ...servicePayload,
    items: [
      { variant_id: variant, quantity: 1 },
      { variant_id: manual, quantity: 1 },
    ],
    method: "sepay",
  };
  const mixedOrder = await scalar("select create_order($1,$2,$3)", [
    user,
    JSON.stringify(mixedPayload),
    randomUUID(),
  ]);
  assert.equal(
    await scalar("select paid_at from orders where id=$1", [mixedOrder]),
    null,
  );
  assert.equal(
    await scalar(
      "select count(*)::int from order_items where order_id=$1 and delivered_at is not null",
      [mixedOrder],
    ),
    0,
  );
  const mixedPayment = (
    await db.query("select * from payments where order_id=$1", [mixedOrder])
  ).rows[0];
  await db.query("select settle_payment($1,$2,$3)", [
    "warranty-mixed",
    mixedPayment.code,
    mixedPayment.amount,
  ]);
  assert.ok(
    await scalar("select paid_at from orders where id=$1", [mixedOrder]),
  );
  assert.equal(
    await scalar("select completed_at from orders where id=$1", [mixedOrder]),
    null,
  );
  const autoDelivery = await scalar(
    "select delivered_at from order_items where order_id=$1 and delivery='key'",
    [mixedOrder],
  );
  assert.ok(autoDelivery);
  assert.equal(
    await scalar(
      "select delivered_at from order_items where order_id=$1 and delivery='manual'",
      [mixedOrder],
    ),
    null,
  );
  await db.query("select fulfill_order($1,$2)", [
    mixedOrder,
    JSON.stringify([
      { secret: "warranty-result", hash: "warranty-result-hash" },
    ]),
  ]);
  assert.ok(
    await scalar("select completed_at from orders where id=$1", [mixedOrder]),
  );
  assert.equal(
    String(
      await scalar(
        "select delivered_at from order_items where order_id=$1 and delivery='key'",
        [mixedOrder],
      ),
    ),
    String(autoDelivery),
  );
  assert.ok(
    await scalar(
      "select delivered_at from order_items where order_id=$1 and delivery='manual'",
      [mixedOrder],
    ),
  );
  pass(
    "bank payment and manual fulfillment stamp each delivery once at the correct stage",
  );
  await db.query("select import_keys($1,$2)", [
    variant,
    JSON.stringify(
      Array.from({ length: 8 }, (_, n) => ({
        secret: `admin-stock-${n}`,
        hash: `admin-stock-hash-${n}`,
      })),
    ),
  ]);
  await db.query(
    "insert into coupons(code,percent,max_discount,discount_type,fixed_amount,total_limit,per_user_limit,product_ids) values('LIMITED',10,100000,'fixed',25000,1,1,$1)",
    [[product]],
  );
  const limited = { ...payload, coupon: "LIMITED", method: "sepay" };
  const quoted = await scalar("select quote_coupon($1,$2,$3)", [
    user,
    "LIMITED",
    JSON.stringify(payload.items),
  ]);
  assert.equal(quoted.discount, 25000);
  const reservationKey = randomUUID();
  const reservedOrder = await scalar("select create_order($1,$2,$3)", [
    user,
    JSON.stringify(limited),
    reservationKey,
  ]);
  assert.equal(
    await scalar("select create_order($1,$2,$3)", [
      user,
      JSON.stringify(limited),
      reservationKey,
    ]),
    reservedOrder,
  );
  assert.equal(
    await scalar(
      "select reserved_count from coupon_usage_stats where code='LIMITED'",
    ),
    1,
  );
  await fails("select create_order($1,$2,$3)", [
    other,
    JSON.stringify(limited),
    randomUUID(),
  ]);
  await db.query("select cancel_order($1,$2)", [user, reservedOrder]);
  const expiringOrder = await scalar("select create_order($1,$2,$3)", [
    other,
    JSON.stringify(limited),
    randomUUID(),
  ]);
  await db.query(
    "update payments set expires_at=now()-interval '1 second' where order_id=$1",
    [expiringOrder],
  );
  await db.query("select expire_payments()");
  assert.equal(
    await scalar(
      "select reserved_count from coupon_usage_stats where code='LIMITED'",
    ),
    0,
  );
  const discountedOrder = await scalar("select create_order($1,$2,$3)", [
    user,
    JSON.stringify({ ...limited, method: "wallet" }),
    randomUUID(),
  ]);
  assert.equal(
    Number(
      await scalar("select discount from orders where id=$1", [
        discountedOrder,
      ]),
    ),
    25000,
  );
  assert.equal(
    await scalar(
      "select used_count from coupon_usage_stats where code='LIMITED'",
    ),
    1,
  );
  await db.query("update coupons set total_limit=10 where code='LIMITED'");
  await fails("select quote_coupon($1,$2,$3)", [
    user,
    "LIMITED",
    JSON.stringify(payload.items),
  ]);
  assert.ok(
    await scalar("select quote_coupon($1,$2,$3)", [
      other,
      "LIMITED",
      JSON.stringify(payload.items),
    ]),
  );
  await db.query(
    "update coupons set per_user_limit=null,category='mmo' where code='LIMITED'",
  );
  await fails("select quote_coupon($1,$2,$3)", [
    user,
    "LIMITED",
    JSON.stringify(payload.items),
  ]);
  await db.query(
    "update coupons set category='all',min_subtotal=1000000 where code='LIMITED'",
  );
  await fails("select quote_coupon($1,$2,$3)", [
    user,
    "LIMITED",
    JSON.stringify(payload.items),
  ]);
  await db.query(
    "update coupons set min_subtotal=0,first_order_only=true where code='LIMITED'",
  );
  await fails("select quote_coupon($1,$2,$3)", [
    user,
    "LIMITED",
    JSON.stringify(payload.items),
  ]);
  await db.query(
    "update coupons set first_order_only=false,starts_at=now()+interval '1 day' where code='LIMITED'",
  );
  await fails("select quote_coupon($1,$2,$3)", [
    user,
    "LIMITED",
    JSON.stringify(payload.items),
  ]);
  await fails(
    "update coupons set expires_at=now()-interval '1 day' where code='LIMITED'",
  );
  await db.query(
    "update coupons set starts_at=null,fixed_amount=100000000 where code='LIMITED'",
  );
  assert.equal(
    (
      await scalar("select quote_coupon($1,$2,$3)", [
        user,
        "LIMITED",
        JSON.stringify(payload.items),
      ])
    ).total,
    1000,
  );
  pass(
    "coupon fixed/percent rules, reservation release, idempotency, total/user limits and first-order scope",
  );

  const adminKey = await scalar("select id from inventory where order_id=$1", [
    discountedOrder,
  ]);
  const adminTicket = await scalar("select create_warranty($1,$2,$3,$4)", [
    user,
    discountedOrder,
    [adminKey],
    "Activation issue for support review",
  ]);
  await db.query("select add_ticket_message($1,$2,$3,$4,$5)", [
    other,
    adminTicket,
    "We are checking the activation problem.",
    "in_progress",
    "high",
  ]);
  await fails("select create_warranty($1,$2,$3,$4)", [
    user,
    discountedOrder,
    [adminKey],
    "Duplicate while processing is forbidden",
  ]);
  await db.query("select add_ticket_message($1,$2,$3)", [
    user,
    adminTicket,
    "Here is the activation error message.",
  ]);
  assert.equal(
    await scalar("select status from tickets where id=$1", [adminTicket]),
    "open",
  );
  assert.equal(
    Number(
      await scalar("select count(*) from ticket_messages where ticket_id=$1", [
        adminTicket,
      ]),
    ),
    2,
  );
  const beforeExternal = Number(
    await scalar("select balance from profiles where id=$1", [user]),
  );
  await db.exec("set role service_role");
  await fails("select resolve_warranty_refund($1,$2,$3,$4,$5,$6)", [
    discountedOrder,
    randomUUID(),
    other,
    "external",
    "External bank transfer already verified",
    "BANK-REF",
  ]);
  await fails("select resolve_warranty_refund($1,$2,$3,$4,$5,$6)", [
    discountedOrder,
    adminTicket,
    user,
    "external",
    "Customer cannot approve own refund",
    "BANK-REF",
  ]);
  const externalArgs = [
    discountedOrder,
    adminTicket,
    other,
    "external",
    "External bank transfer already verified",
    "BANK-REF",
  ];
  await db.query(
    "select resolve_warranty_refund($1,$2,$3,$4,$5,$6)",
    externalArgs,
  );
  await fails(
    "select resolve_warranty_refund($1,$2,$3,$4,$5,$6)",
    externalArgs,
  );
  assert.equal(
    Number(await scalar("select balance from profiles where id=$1", [user])),
    beforeExternal,
  );
  assert.equal(
    await scalar("select refund_method from orders where id=$1", [
      discountedOrder,
    ]),
    "external",
  );
  assert.equal(
    await scalar("select status from tickets where id=$1", [adminTicket]),
    "closed",
  );
  assert.equal(
    Number(
      await scalar("select count(*) from ticket_messages where ticket_id=$1", [
        adminTicket,
      ]),
    ),
    3,
  );
  await db.exec("reset role; set role authenticated");
  await fails("select quote_coupon($1,$2,$3)", [
    user,
    "LIMITED",
    JSON.stringify(payload.items),
  ]);
  await fails("select * from coupon_usage_stats");
  await fails("select add_ticket_message($1,$2,$3)", [
    other,
    adminTicket,
    "Forged admin reply",
  ]);
  await fails(
    "select resolve_warranty_refund($1,$2,$3,$4,$5,$6)",
    externalArgs,
  );
  await fails(
    "insert into ticket_messages(ticket_id,role,body) values($1,'admin','Forged reply')",
    [adminTicket],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  assert.equal(
    Number(
      await scalar("select count(*) from ticket_messages where ticket_id=$1", [
        adminTicket,
      ]),
    ),
    0,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  assert.equal(
    Number(
      await scalar("select count(*) from ticket_messages where ticket_id=$1", [
        adminTicket,
      ]),
    ),
    3,
  );
  await db.exec("reset role");
  pass(
    "support history RLS and warranty-linked external refunds do not credit wallet or execute twice",
  );
  assert.ok(
    Number(
      await scalar("select count(*) from notifications where user_id=$1", [
        user,
      ]),
    ) > 0,
  );
  assert.ok(
    Number(
      await scalar(
        "select count(*) from notifications where id like 'reply:%'",
      ),
    ) > 0,
  );
  const sid = randomUUID();
  await db.query(
    "insert into app_sessions(id,user_id,token_hash) values($1,$2,$3)",
    [sid, user, "test-session-hash"],
  );
  await fails("select set_customer_access($1,$2,true,'Unauthorized change')", [
    user,
    other,
  ]);
  await db.query(
    "select set_customer_access($1,$2,true,'Review account activity')",
    [other, user],
  );
  assert.equal(
    await scalar("select suspended from account_controls where user_id=$1", [
      user,
    ]),
    true,
  );
  assert.ok(
    await scalar("select revoked_at from app_sessions where id=$1", [sid]),
  );
  await db.query(
    "select set_customer_access($1,$2,false,'Review finished successfully')",
    [other, user],
  );
  assert.ok(
    await scalar("select revoked_at from app_sessions where id=$1", [sid]),
  );
  await fails("select set_customer_access($1,$2,true,'Cannot suspend admin')", [
    other,
    other,
  ]);
  pass(
    "notifications persist and account suspension revokes sessions without restoring old ones on unlock",
  );
  await db.query("select import_keys($1,$2)", [
    variant,
    JSON.stringify([{ secret: "discard-cipher", hash: "discard-hash" }]),
  ]);
  const discardId = await scalar(
    "select id from inventory where secret_hash='discard-hash'",
  );
  const stockBeforeDiscard = Number(
    await scalar("select stock from variants where id=$1", [variant]),
  );
  await db.query("select discard_inventory($1,$2,'Invalid supplier code')", [
    other,
    discardId,
  ]);
  assert.equal(
    Number(await scalar("select stock from variants where id=$1", [variant])),
    stockBeforeDiscard - 1,
  );
  await fails("select discard_inventory($1,$2,'Duplicate removal attempt')", [
    other,
    discardId,
  ]);
  await fails("select discard_inventory($1,$2,'Assigned code must remain')", [
    other,
    adminKey,
  ]);
  await db.exec("set role authenticated");
  for (const table of ["account_controls", "app_sessions", "notifications"])
    await fails(`select * from ${table}`);
  await fails("select discard_inventory($1,$2,'Forged inventory mutation')", [
    other,
    adminKey,
  ]);
  await fails(
    "select set_customer_access($1,$2,true,'Forged account mutation')",
    [other, user],
  );
  await db.exec("reset role");
  pass(
    "unused inventory removal is atomic; assigned stock and server-owned controls reject client mutation",
  );
  const avatarUser = randomUUID();
  const googleAvatar = "https://lh3.googleusercontent.com/a/test-photo";
  const discordAvatar = "https://cdn.discordapp.com/avatars/123/abc.png";
  await db.query(
    "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
    [
      avatarUser,
      "avatar@example.test",
      JSON.stringify({ name: "Avatar User", avatar_url: googleAvatar }),
    ],
  );
  assert.equal(
    await scalar("select avatar_url from profiles where id=$1", [avatarUser]),
    googleAvatar,
  );
  await db.query("update auth.users set raw_user_meta_data=$2 where id=$1", [
    avatarUser,
    JSON.stringify({ picture: discordAvatar }),
  ]);
  assert.equal(
    await scalar("select avatar_url from profiles where id=$1", [avatarUser]),
    discordAvatar,
  );
  for (const bad of [
    "javascript:alert(1)",
    "http://cdn.discordapp.com/a.png",
    "https://cdn.discordapp.com.evil.test/a.png",
    "https://cdn.discordapp.com@evil.test/a.png",
  ]) {
    assert.equal(
      await scalar("select oauth_avatar($1)", [
        JSON.stringify({ avatar_url: bad }),
      ]),
      null,
    );
  }
  await db.query("update auth.users set raw_user_meta_data=$2 where id=$1", [
    avatarUser,
    JSON.stringify({
      avatar_url: "https://evil.test/image",
      role: "admin",
      balance: 999999,
    }),
  ]);
  assert.equal(
    await scalar("select avatar_url from profiles where id=$1", [avatarUser]),
    null,
  );
  assert.equal(
    await scalar("select role from profiles where id=$1", [avatarUser]),
    "customer",
  );
  pass(
    "OAuth avatars sync on registration and metadata updates; unsafe URLs and privilege metadata are ignored",
  );
  const customAvatar = `/api/media/${randomUUID()}.webp`;
  await db.query(
    "update profiles set avatar_url=$2,avatar_source='upload' where id=$1",
    [avatarUser, customAvatar],
  );
  await db.query("update auth.users set raw_user_meta_data=$2 where id=$1", [
    avatarUser,
    JSON.stringify({ avatar_url: googleAvatar }),
  ]);
  assert.equal(
    await scalar("select avatar_url from profiles where id=$1", [avatarUser]),
    customAvatar,
  );
  pass("uploaded avatar persists when OAuth metadata changes");
  const campaign = randomUUID();
  const recipientEmail = await scalar(
    "select email from profiles where id=$1",
    [user],
  );
  const args = [
    campaign,
    other,
    "Thông báo cửa hàng",
    "Nội dung thử nghiệm",
    recipientEmail,
  ];
  assert.equal(
    await scalar("select send_store_notification($1,$2,$3,$4,$5)", args),
    1,
  );
  assert.equal(
    await scalar("select send_store_notification($1,$2,$3,$4,$5)", args),
    1,
  );
  assert.equal(
    await scalar("select count(*)::int from notifications where id like $1", [
      `campaign:${campaign}:%`,
    ]),
    1,
  );
  await fails("select send_store_notification($1,$2,$3,$4,$5)", [
    randomUUID(),
    user,
    "Không được gửi",
    "Nội dung thử nghiệm",
    recipientEmail,
  ]);
  await fails("select send_store_notification($1,$2,$3,$4,$5)", [
    campaign,
    other,
    "Tiêu đề khác",
    "Nội dung thử nghiệm",
    recipientEmail,
  ]);
  const completionCount = () =>
    scalar(
      "select count(*)::int from notifications where title in ('Yêu cầu bảo hành đã được xử lý','Yêu cầu hỗ trợ đã được xử lý')",
    );
  const beforeCompletion = await completionCount();
  await db.query("update tickets set status='in_progress' where id=$1", [
    adminTicket,
  ]);
  await db.query("update tickets set status='closed' where id=$1", [
    adminTicket,
  ]);
  assert.equal(await completionCount(), beforeCompletion + 1);
  await db.query("update tickets set status='closed' where id=$1", [
    adminTicket,
  ]);
  assert.equal(await completionCount(), beforeCompletion + 1);
  pass(
    "admin campaigns are authorized and idempotent; ticket completion notifies once per transition",
  );
  await fails("select delete_store_campaign($1,$2)", [campaign, user]);
  await db.query("select delete_store_campaign($1,$2)", [campaign, other]);
  assert.equal(
    await scalar("select count(*)::int from notifications where id like $1", [
      `campaign:${campaign}:%`,
    ]),
    0,
  );
  await scalar("select send_store_notification($1,$2,$3,$4,$5)", args);
  assert.equal(
    await scalar("select count(*)::int from notifications where id like $1", [
      `campaign:${campaign}:%`,
    ]),
    0,
  );
  assert.equal(
    await scalar(
      "select deleted_at is not null from notification_campaigns where id=$1",
      [campaign],
    ),
    true,
  );
  pass(
    "deleting a campaign removes recipient copies and prevents resend on retry",
  );
  const requestWalletTopup = async (uid, amount) => (await db.query('select * from create_wallet_topup($1,$2)', [uid, amount])).rows[0];
  const firstTopup = await requestWalletTopup(user, 17000);
  await fails('select create_wallet_topup($1,$2)', [user,10500]);
  const reusedTopup = await requestWalletTopup(user, 17000);
  assert.equal(reusedTopup.id, firstTopup.id);
  assert.equal(new Date(reusedTopup.expires_at).getTime(), new Date(firstTopup.expires_at).getTime());
  assert.notEqual((await requestWalletTopup(other, 17000)).id, firstTopup.id);
  assert.notEqual((await requestWalletTopup(user, 18000)).id, firstTopup.id);
  await db.query("update payments set expires_at=now()-interval '1 second' where id=$1", [firstTopup.id]);
  const freshTopup = await requestWalletTopup(user, 17000);
  assert.notEqual(freshTopup.id, firstTopup.id);
  assert.equal(await scalar('select count(*)::int from payments where id=$1', [firstTopup.id]), 1);
  await db.query("update payments set status='paid' where id=$1", [freshTopup.id]);
  assert.notEqual((await requestWalletTopup(user, 17000)).id, freshTopup.id);
  pass('wallet topups reuse only same-owner pending unexpired requests, preserve expiry and late-transfer records');
  {
  const sid = randomUUID();
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'seller-db@example.test','{\"name\":\"Seller DB\"}')",[sid]);
  const sellerCommand = (actor, action, data) => scalar('select seller_command($1,$2,$3)',[actor,action,JSON.stringify(data)]);
  await fails('select seller_command($1,$2,$3)',[user,'role',JSON.stringify({user_id:sid,role:'seller'})]);
  await sellerCommand(other,'role',{user_id:sid,role:'seller'});
  await fails('select require_seller($1)',[sid]);
  await sellerCommand(sid,'profile',{name:'Seller DB',terms_version:'2026-10-11-v1',fee_bps:700,accepted:true});
  const sellerProduct=await sellerCommand(sid,'product',{slug:'seller-db',name:'Seller DB product',category:'game',platform:'PC',subcategory:'',subtitle:'',description:'',image:'',active:true});
  const sellerVariant=randomUUID();
  await db.query("insert into variants(id,product_id,name,price,original_price,delivery,stock,region) values($1,$2,'Manual',100000,100000,'manual',20,'Global')",[sellerVariant,sellerProduct.id]);
  await fails('select seller_command($1,$2,$3)',[sid,'product',JSON.stringify({...sellerProduct,id:product})]);
  await fails('select seller_command($1,$2,$3)',[sid,'variant',JSON.stringify({product_id:sellerProduct.id,variant:{id:variant,name:'Forged',price:1000,original_price:1000,delivery:'key',region:'Global'}})]);
  await db.query('update profiles set balance=1000000 where id=$1',[user]);
  const sellerPayload={items:[{variant_id:sellerVariant,quantity:1}],method:'wallet',coupon:'',customer_note:'Player'};
  await fails('select create_order($1,$2,$3)',[sid,JSON.stringify(sellerPayload),randomUUID()]);
  const saleKey=randomUUID();
  const saleOrder=await scalar('select create_order($1,$2,$3)',[user,JSON.stringify(sellerPayload),saleKey]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),93000);
  await scalar('select create_order($1,$2,$3)',[user,JSON.stringify(sellerPayload),saleKey]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),93000);
  const bankSale=await scalar('select create_order($1,$2,$3)',[user,JSON.stringify({...sellerPayload,method:'sepay'}),randomUUID()]);
  await sellerCommand(other,'fee',{fee_bps:1000});
  const sellerPayment=(await db.query('select * from payments where order_id=$1',[bankSale])).rows[0];
  await scalar('select settle_payment($1,$2,$3)',['seller-bank-db',sellerPayment.code,100000]);
  await scalar('select settle_payment($1,$2,$3)',['seller-bank-db',sellerPayment.code,100000]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),186000);
  const withdrawData={amount:50000,bank:'VCB',account_name:'Seller DB',account_number:'123456789',idempotency:randomUUID()};
  const withdrawal=await sellerCommand(sid,'withdraw',withdrawData);
  assert.equal((await sellerCommand(sid,'withdraw',withdrawData)).id,withdrawal.id);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),136000);
  await fails('select seller_command($1,$2,$3)',[sid,'withdraw',JSON.stringify({...withdrawData,amount:60000})]);
  await sellerCommand(other,'withdrawal_review',{id:withdrawal.id,status:'rejected',reason:'Incorrect account',reference:''});
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),186000);
  await fails('select seller_command($1,$2,$3)',[other,'withdrawal_review',JSON.stringify({id:withdrawal.id,status:'rejected',reason:'Again',reference:''})]);
  const pendingWithdrawal=await sellerCommand(sid,'withdraw',{...withdrawData,idempotency:randomUUID()});
  // Exercise the exact status trigger used by the existing refund transaction.
  await db.query("update orders set status='refunded' where id=$1",[saleOrder]);
  assert.equal(await scalar('select status from seller_withdrawals where id=$1',[pendingWithdrawal.id]),'cancelled');
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),93000);
  await db.query('update profiles set balance=1000 where id=$1',[sid]);
  await db.query("update orders set status='refunded' where id=$1",[bankSale]);
  assert.equal(Number(await scalar('select seller_debt from profiles where id=$1',[sid])),92000);
  await scalar('select settle_seller_revenue($1)',[bankSale]);
  assert.equal(Number(await scalar('select seller_debt from profiles where id=$1',[sid])),92000);
  await scalar('select create_order($1,$2,$3)',[user,JSON.stringify(sellerPayload),randomUUID()]);
  assert.equal(Number(await scalar('select seller_debt from profiles where id=$1',[sid])),2000);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),0);
  await sellerCommand(other,'role',{user_id:sid,role:'customer'});
  assert.equal(await scalar('select active from products where id=$1',[sellerProduct.id]),false);
  await sellerCommand(other,'role',{user_id:sid,role:'seller'});
  await db.query('update products set active=true where id=$1',[sellerProduct.id]);
  const secondVariant=randomUUID();
  await db.query("insert into variants(id,product_id,name,price,original_price,delivery,stock,region) values($1,$2,'Second',100000,100000,'manual',5,'Global')",[secondVariant,sellerProduct.id]);
  const mixedOrder=await scalar('select create_order($1,$2,$3)',[user,JSON.stringify({...sellerPayload,items:[{variant_id:sellerVariant,quantity:1},{variant_id:secondVariant,quantity:1}]}),randomUUID()]);
  const ownItem=await scalar('select id from order_items where order_id=$1 and variant_id=$2',[mixedOrder,sellerVariant]);
  await sellerCommand(sid,'fulfill',{item_id:ownItem,keys:[{secret:'encrypted-seller-delivery',hash:randomUUID()}]});
  assert.equal(await scalar('select status from orders where id=$1',[mixedOrder]),'processing');
  await fails('select seller_command($1,$2,$3)',[sid,'fulfill',JSON.stringify({item_id:ownItem,keys:[{secret:'repeat',hash:randomUUID()}]})]);
  await scalar('select fulfill_order($1,$2)',[mixedOrder,JSON.stringify([{secret:'encrypted-admin-delivery',hash:randomUUID()}])]);
  assert.equal(await scalar('select status from orders where id=$1',[mixedOrder]),'completed');
  assert.equal(Number(await scalar('select count(*) from inventory where order_id=$1',[mixedOrder])),2);
  const finalWithdrawal=await sellerCommand(sid,'withdraw',{...withdrawData,idempotency:randomUUID()});
  const balanceBeforePaid=Number(await scalar('select balance from profiles where id=$1',[sid]));
  await sellerCommand(other,'withdrawal_review',{id:finalWithdrawal.id,status:'paid',reason:'Transfer completed',reference:'BANK-123'});
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balanceBeforePaid);
  assert.equal(await scalar('select status from seller_withdrawals where id=$1',[finalWithdrawal.id]),'paid');
  pass('seller ownership, terms, 7% settlement, immutable fees, duplicate callbacks, withdrawal holds and refund debt');
  }
  console.log(
    `${checks} PostgreSQL checks passed. Real multi-connection contention and hosted Supabase Auth still require integration testing.`,
  );
} finally {
  await db.close();
}
