import { SELLER_TERMS_VERSION } from '../shared/seller-terms.js';
import { LEGAL_VERSION } from '../shared/legal-content.js';
import { consentProof } from '../server/legal-consent.js';
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
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default now());
 create table auth.refresh_tokens(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);
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
  {
    await db.exec('begin');
    const fingerprint = () => scalar('select public.catalog_live_version()');
    const initial = await fingerprint();
    assert.match(initial, /^[a-f0-9]{32}$/);
    assert.equal(await fingerprint(), initial);
    await db.query('update variants set stock=stock+1 where id=$1', [variant]);
    const changedStock = await fingerprint();
    assert.notEqual(changedStock, initial);
    await db.query("update products set description='Changed catalog content' where id=$1", [product]);
    const changedProduct = await fingerprint();
    assert.notEqual(changedProduct, changedStock);
    await db.query('update products set seller_id=$2 where id=$1', [product, other]);
    await db.query("update products set active=true,review_status='approved' where id=$1", [product]);
    const sellerProduct = await fingerprint();
    await db.query("update profiles set seller_name='New storefront name' where id=$1", [other]);
    const changedSeller = await fingerprint();
    assert.notEqual(changedSeller, sellerProduct);
    await db.query('update profiles set balance=balance+1 where id=$1', [other]);
    assert.equal(await fingerprint(), changedSeller, 'private balances do not change public catalog fingerprint');
    await db.query("insert into reviews(user_id,product_id,name,rating,comment) values($1,$2,'Buyer',5,'Good product')", [user, product]);
    const changedReview = await fingerprint();
    assert.notEqual(changedReview, changedSeller);
    await db.query('update variants set active=false where id=$1', [variant]);
    assert.notEqual(await fingerprint(), changedReview);
    for (const role of ['anon', 'authenticated'])
      assert.equal(await scalar('select has_function_privilege($1,$2,$3)', [role, 'catalog_live_version()', 'EXECUTE']), false);
    assert.equal(await scalar("select has_function_privilege('service_role','catalog_live_version()','EXECUTE')"), true);
    await db.exec('rollback');
    pass('catalog fingerprint detects stock, product, seller, rating and visibility changes; excludes private balances; service-only access');
  }
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
  await db.exec('begin');
  await scalar("select import_keys($1,$2)", [
    variant,
    JSON.stringify([{ secret: "duplicate", hash: "hash-0" }, { secret: "duplicate", hash: "hash-0" }]),
  ]);
  assert.equal(
    await scalar("select stock from variants where id=$1", [variant]),
    7,
  );
  assert.equal(Number(await scalar("select count(*) from inventory where variant_id=$1 and secret_hash='hash-0'", [variant])),3);
  await db.exec('rollback');
  pass("repeated inventory contents create distinct stock units, including existing hashes");
  await db.exec('begin');
  const cartItems = [{ variant_id: variant, quantity: 3 }, { variant_id: manual, quantity: 2 }];
  await db.query('insert into account_carts(user_id,items) values($1,$3),($2,$3)', [user, other, JSON.stringify(cartItems)]);
  const cartPayload = { items: [{ variant_id: variant, quantity: 1 }], method: 'wallet', coupon: '', customer_note: '',
    legal: consentProof({ version: LEGAL_VERSION, terms: true }, 'order') };
  const cartKey = randomUUID();
  const cartOrder = await scalar('select create_order($1,$2,$3)', [user, JSON.stringify(cartPayload), cartKey]);
  assert.deepEqual(await scalar('select fingerprint->\'legal\' from orders where id=$1', [cartOrder]), cartPayload.legal);
  assert.ok(await scalar('select created_at is not null from orders where id=$1', [cartOrder]));
  pass('checkout persists exact policy version and hashes with database timestamp in the same transaction');
  const savedCart = uid => scalar('select items from account_carts where user_id=$1', [uid]);
  assert.deepEqual(await savedCart(user), [{ variant_id: variant, quantity: 2 }, cartItems[1]]);
  assert.deepEqual(await savedCart(other), cartItems);
  await db.query('update account_carts set items=$2 where user_id=$1', [user, JSON.stringify([{ variant_id: variant, quantity: 1 }, cartItems[1]])]);
  assert.equal(await scalar('select create_order($1,$2,$3)', [user, JSON.stringify(cartPayload), cartKey]), cartOrder);
  assert.deepEqual(await savedCart(user), [{ variant_id: variant, quantity: 1 }, cartItems[1]], 'replaying an old order must retain newly added items');
  await scalar('select create_order($1,$2,$3)', [user, JSON.stringify({ ...cartPayload, method: 'sepay' }), randomUUID()]);
  assert.deepEqual(await savedCart(user), [cartItems[1]], 'accepted QR order consumes only its purchased line');
  await scalar('select create_order($1,$2,$3)', [user, JSON.stringify({ ...cartPayload, items: [cartItems[1]], customer_note: 'Cart service delivery' }), randomUUID()]);
  assert.deepEqual(await savedCart(user), []);
  const failedCart = [{ variant_id: variant, quantity: 6 }];
  await db.query('update account_carts set items=$2 where user_id=$1', [user, JSON.stringify(failedCart)]);
  // Force inventory allocation to fail after the order line and cart trigger ran.
  await db.query('update variants set stock=10 where id=$1', [variant]);
  const ordersBeforeFailure = await scalar('select count(*) from orders where user_id=$1', [user]);
  const balanceBeforeFailure = await scalar('select balance from profiles where id=$1', [user]);
  await db.exec('savepoint failed_cart_checkout');
  await fails('select create_order($1,$2,$3)', [user, JSON.stringify({ ...cartPayload, items: failedCart }), randomUUID()]);
  await db.exec('rollback to savepoint failed_cart_checkout');
  assert.deepEqual(await savedCart(user), failedCart, 'failed checkout must roll back cart consumption');
  assert.equal(await scalar('select count(*) from orders where user_id=$1', [user]), ordersBeforeFailure);
  assert.equal(await scalar('select balance from profiles where id=$1', [user]), balanceBeforeFailure);
  assert.equal(await scalar("select has_function_privilege('authenticated','consume_order_item_cart()','EXECUTE')"), false);
  assert.equal(await scalar("select has_function_privilege('anon','consume_order_item_cart()','EXECUTE')"), false);
  await db.exec('rollback');
  pass('checkout atomically subtracts purchased cart quantities, isolates accounts, preserves unrelated items, rolls back failure and ignores replay');
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
  await fails("select * from orders");
  await fails("select * from profiles");
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
  await fails("select * from ticket_messages where ticket_id=$1", [adminTicket]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await fails("select * from ticket_messages where ticket_id=$1", [adminTicket]);
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
  await sellerCommand(sid,'profile',{name:'Seller DB',terms_version:SELLER_TERMS_VERSION,fee_bps:700,accepted:true});
  const sellerProduct=await sellerCommand(sid,'product',{slug:'seller-db',name:'Seller DB product',category:'game',platform:'PC',subcategory:'',subtitle:'',description:'',image:'',active:true});
  const sellerVariant=randomUUID();
  await db.query("insert into variants(id,product_id,name,price,original_price,delivery,stock,region) values($1,$2,'Manual',100000,100000,'manual',20,'Global')",[sellerVariant,sellerProduct.id]);
  await fails('select seller_command($1,$2,$3)',[sid,'product',JSON.stringify({...sellerProduct,id:product})]);
  await fails('select seller_command($1,$2,$3)',[sid,'variant',JSON.stringify({product_id:sellerProduct.id,variant:{id:variant,name:'Forged',price:1000,original_price:1000,delivery:'key',region:'Global'}})]);
  await db.query('update profiles set balance=1000000 where id=$1',[user]);
  const reviewProduct = async id => db.query('select review_seller_product($1,$2,(select review_version from products where id=$2),true,$3)',[other,id,'']);
  assert.equal(await scalar('select active from products where id=$1',[sellerProduct.id]),false);
  await db.query('update products set active=true where id=$1',[sellerProduct.id]);
  assert.equal(await scalar('select active from products where id=$1',[sellerProduct.id]),false);
  await fails('select review_seller_product($1,$2,2,true,$3)',[sid,sellerProduct.id,'']);
  await reviewProduct(sellerProduct.id);
  const reviewedVersion = await scalar('select review_version from products where id=$1',[sellerProduct.id]);
  const reviewNoticeCount = () => scalar("select count(*)::int from notifications where user_id=$1 and id like $2",[sid,`seller-review:${sellerProduct.id}:%`]);
  assert.equal(await reviewNoticeCount(),1);
  await reviewProduct(sellerProduct.id);
  assert.equal(await reviewNoticeCount(),1);
  await db.query('select review_seller_product($1,$2,(select review_version from products where id=$2),false,$3)',[other,sellerProduct.id,'Please correct product details']);
  assert.equal(await reviewNoticeCount(),2);
  assert.ok((await scalar("select body from notifications where user_id=$1 and title like 'Sản phẩm bị từ chối%' order by created_at desc limit 1",[sid])).includes('Please correct product details'));
  await reviewProduct(sellerProduct.id);
  assert.equal(await reviewNoticeCount(),3);
  await db.query('update variants set price=price+1 where id=$1',[sellerVariant]);
  assert.equal(await scalar('select active from products where id=$1',[sellerProduct.id]),false);
  await fails('select review_seller_product($1,$2,$3,true,$4)',[other,sellerProduct.id,reviewedVersion,'']);
  await db.query('update variants set price=price-1 where id=$1',[sellerVariant]);
  await reviewProduct(sellerProduct.id);
  pass('seller listings require admin approval and changed variants invalidate stale approvals');
  const sellerPayload={items:[{variant_id:sellerVariant,quantity:1}],method:'wallet',coupon:'',customer_note:'Player'};
  await fails('select create_order($1,$2,$3)',[sid,JSON.stringify(sellerPayload),randomUUID()]);
  const saleKey=randomUUID();
  const saleOrder=await scalar('select create_order($1,$2,$3)',[user,JSON.stringify(sellerPayload),saleKey]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),0);
  const mature = async oid => {
    await db.query("update order_items set delivered_at=clock_timestamp()-interval '49 hours' where order_id=$1",[oid]);
    await scalar('select release_seller_funds($1)',[sid]);
  };
  await mature(saleOrder);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),93000);
  await scalar('select create_order($1,$2,$3)',[user,JSON.stringify(sellerPayload),saleKey]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),93000);
  const bankSale=await scalar('select create_order($1,$2,$3)',[user,JSON.stringify({...sellerPayload,method:'sepay'}),randomUUID()]);
  await sellerCommand(other,'fee',{fee_bps:1000});
  const sellerPayment=(await db.query('select * from payments where order_id=$1',[bankSale])).rows[0];
  await scalar('select settle_payment($1,$2,$3)',['seller-bank-db',sellerPayment.code,100000]);
  await scalar('select settle_payment($1,$2,$3)',['seller-bank-db',sellerPayment.code,100000]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),93000);
  await mature(bankSale);
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
  await mature(await scalar('select create_order($1,$2,$3)',[user,JSON.stringify(sellerPayload),randomUUID()]));
  assert.equal(Number(await scalar('select seller_debt from profiles where id=$1',[sid])),2000);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),0);
  await sellerCommand(other,'role',{user_id:sid,role:'customer'});
  assert.equal(await scalar('select active from products where id=$1',[sellerProduct.id]),false);
  await sellerCommand(other,'role',{user_id:sid,role:'seller'});
  await db.query('update products set active=true where id=$1',[sellerProduct.id]);
  const secondVariant=randomUUID();
  await db.query("insert into variants(id,product_id,name,price,original_price,delivery,stock,region) values($1,$2,'Second',100000,100000,'manual',5,'Global')",[secondVariant,sellerProduct.id]);
  await reviewProduct(sellerProduct.id);
  const mixedOrder=await scalar('select create_order($1,$2,$3)',[user,JSON.stringify({...sellerPayload,items:[{variant_id:sellerVariant,quantity:1},{variant_id:secondVariant,quantity:1}]}),randomUUID()]);
  const ownItem=await scalar('select id from order_items where order_id=$1 and variant_id=$2',[mixedOrder,sellerVariant]);
  await sellerCommand(sid,'fulfill',{item_id:ownItem,keys:[{secret:'encrypted-seller-delivery',hash:randomUUID()}]});
  assert.equal(await scalar('select status from orders where id=$1',[mixedOrder]),'processing');
  await fails('select seller_command($1,$2,$3)',[sid,'fulfill',JSON.stringify({item_id:ownItem,keys:[{secret:'repeat',hash:randomUUID()}]})]);
  await scalar('select fulfill_order($1,$2)',[mixedOrder,JSON.stringify([{secret:'encrypted-admin-delivery',hash:randomUUID()}])]);
  assert.equal(await scalar('select status from orders where id=$1',[mixedOrder]),'completed');
  assert.equal(Number(await scalar('select count(*) from inventory where order_id=$1',[mixedOrder])),2);
  await mature(mixedOrder);
  const finalWithdrawal=await sellerCommand(sid,'withdraw',{...withdrawData,idempotency:randomUUID()});
  const balanceBeforePaid=Number(await scalar('select balance from profiles where id=$1',[sid]));
  await sellerCommand(other,'withdrawal_review',{id:finalWithdrawal.id,status:'paid',reason:'Transfer completed',reference:'BANK-123'});
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balanceBeforePaid);
  assert.equal(await scalar('select status from seller_withdrawals where id=$1',[finalWithdrawal.id]),'paid');
  pass('seller ownership, terms, 7% settlement, immutable fees, duplicate callbacks, withdrawal holds and refund debt');
  const newSale = () => scalar('select create_order($1,$2,$3)',[user,JSON.stringify(sellerPayload),randomUUID()]);
  const chat = (actor,item,action='read',body='',request=null) => scalar('select seller_conversation($1,$2,$3,$4,$5)',[actor,item,action,body,request]);
  await db.query('update profiles set balance=2000000 where id=$1',[user]);
  const escrowOrder = await newSale();
  const escrowItem = await scalar('select id from order_items where order_id=$1',[escrowOrder]);
  const balance = Number(await scalar('select balance from profiles where id=$1',[sid]));
  await scalar('select release_seller_funds($1)',[sid]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balance);
  await fails('select seller_command($1,$2,$3)',[sid,'withdraw',JSON.stringify({...withdrawData,amount:balance+90000,idempotency:randomUUID()})]);
  const outsider = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'chat-outsider@example.test')",[outsider]);
  await fails('select seller_conversation($1,$2)',[outsider,escrowItem]);
  const messageId = randomUUID();
  await chat(user,escrowItem,'message','Need help with delivery',messageId);
  await chat(user,escrowItem,'message','Need help with delivery',messageId);
  assert.equal((await chat(sid,escrowItem)).messages.length,1);
  assert.equal(Number(await scalar("select count(*) from notifications where id like 'seller-chat:%' and user_id=$1",[sid])),1);
  await fails('select seller_conversation($1,$2,$3,$4,$5)',[user,escrowItem,'message','Changed body',messageId]);
  await chat(sid,escrowItem,'message','We are checking the delivery',randomUUID());
  assert.equal(Number(await scalar("select count(*) from notifications where id like 'seller-chat:%' and user_id=$1 and read_at is null",[sid])),0);
  assert.equal(Number(await scalar("select count(*) from notifications where id like 'seller-chat:%' and user_id=$1 and read_at is null",[user])),1);
  // Replaying the buyer's old send does not acknowledge the seller's new reply.
  await chat(user,escrowItem,'message','Need help with delivery',messageId);
  assert.equal(Number(await scalar("select count(*) from notifications where id like 'seller-chat:%' and user_id=$1 and read_at is null",[user])),1);
  assert.equal((await chat(user,escrowItem)).messages.length,2);
  await db.query("update profiles set role='admin' where id=$1",[user]);
  assert.equal((await chat(user,escrowItem)).can_message,true);
  assert.equal((await chat(user,escrowItem)).viewer_role,'customer');
  const adminBuyerMessage = await chat(user,escrowItem,'message','Admin buyer message',randomUUID());
  assert.equal(adminBuyerMessage.messages.at(-1).role,'customer');
  assert.equal(Number(await scalar("select count(*) from notifications where id like 'seller-chat:%' and user_id=$1 and read_at is null",[user])),0);
  await db.query("update profiles set role='customer' where id=$1",[user]);
  assert.equal((await chat(other,escrowItem)).can_message,false);
  await fails('select seller_conversation($1,$2,$3,$4,$5)',[other,escrowItem,'message','Unrelated admin',randomUUID()]);
  await sellerCommand(sid,'fulfill',{item_id:escrowItem,keys:[{secret:'escrow-test-delivered',hash:randomUUID()}]});
  await scalar('select release_seller_funds($1)',[sid]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balance);
  await fails('select seller_conversation($1,$2,$3,$4)',[other,escrowItem,'request','Observer cannot request a refund']);
  await db.query("update profiles set role='admin' where id=$1",[user]);
  assert.equal((await chat(user,escrowItem)).can_request,true);
  const disputed = await chat(user,escrowItem,'request','The delivered product cannot be used');
  await db.query("update profiles set role='customer' where id=$1",[user]);
  assert.equal(disputed.dispute.status,'open');
  const refundNotice = await scalar("select row_to_json(n) from notifications n where id=$1",['seller-refund:'+escrowItem]);
  assert.equal(refundNotice.user_id,sid);
  assert.equal(refundNotice.read_at,null);
  assert.equal(refundNotice.href,'/seller?tab=sales');
  await scalar('select seller_support($1,$2,$3)',[sid,disputed.dispute.ticket_id,'Seller support reply for the buyer']);
  assert.equal((await scalar('select seller_support($1)',[sid])).find(t=>t.id===disputed.dispute.ticket_id).messages.at(-1).role,'seller');
  await fails('select seller_support($1,$2,$3)',[outsider,disputed.dispute.ticket_id,'Not my support request']);
  await fails('select seller_conversation($1,$2,$3)',[user,escrowItem,'agree']);
  await mature(escrowOrder);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balance);
  assert.equal((await chat(user,escrowItem)).dispute.status,'open');
  await fails('select seller_conversation($1,$2,$3,$4)',[sid,escrowItem,'reject','Cannot self resolve this dispute']);
  const buyerBalance = Number(await scalar('select balance from profiles where id=$1',[user]));
  for (const participant of [user, sid]) {
    for (const action of ['refund', 'reject']) {
      await fails('select seller_conversation($1,$2,$3,$4)', [participant, escrowItem, action, 'Participant cannot resolve their own dispute']);
      assert.equal(Number(await scalar('select balance from profiles where id=$1', [user])), buyerBalance);
      assert.equal(Number(await scalar('select balance from profiles where id=$1', [sid])), balance);
      assert.equal((await chat(user, escrowItem)).dispute.status, 'open');
    }
  }
  await chat(sid,escrowItem,'agree');
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[user])),buyerBalance+100000);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balance);
  assert.equal((await chat(user,escrowItem)).dispute.status,'refunded');
  await fails('select seller_conversation($1,$2,$3,$4)',[other,escrowItem,'refund','Duplicate refund should never credit']);
  for (const actor of [user,sid]) {
    await fails('select seller_conversation($1,$2,$3)',[actor,escrowItem,'agree']);
    await fails('select seller_conversation($1,$2,$3,$4)',[actor,escrowItem,'request','Cannot refund the same product twice']);
    assert.equal(Number(await scalar('select balance from profiles where id=$1',[user])),buyerBalance+100000);
  }
  await scalar('select release_seller_funds($1)',[sid]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balance);
  const rejectedOrder = await newSale();
  const rejectedItem = await scalar('select id from order_items where order_id=$1',[rejectedOrder]);
  await chat(sid,rejectedItem,'request','Seller requests a review before delivery');
  assert.equal((await chat(user,rejectedItem)).dispute.can_agree,true);
  await chat(other,rejectedItem,'reject','Evidence confirms delivery can proceed');
  await db.query("update order_items set delivered_at=clock_timestamp()-interval '47 hours 59 minutes' where id=$1",[rejectedItem]);
  await scalar('select release_seller_funds($1)',[sid]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balance);
  await mature(rejectedOrder);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balance+90000);
  await scalar('select release_seller_funds($1)',[sid]);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[sid])),balance+90000);
  await sellerCommand(other,'role',{user_id:outsider,role:'seller'});
  await sellerCommand(outsider,'profile',{name:'Other shop',terms_version:SELLER_TERMS_VERSION,fee_bps:1000,accepted:true});
  const otherProduct=await sellerCommand(outsider,'product',{slug:'other-seller-chat',name:'Other shop product',category:'game',platform:'PC',subcategory:'',subtitle:'',description:'',image:'',active:true});
  const otherVariant=randomUUID();
  await db.query("insert into variants(id,product_id,name,price,original_price,delivery,stock) values($1,$2,'Manual',100000,100000,'manual',2)",[otherVariant,otherProduct.id]);
  await reviewProduct(otherProduct.id);
  const multiSellerOrder=await scalar('select create_order($1,$2,$3)',[user,JSON.stringify({...sellerPayload,items:[{variant_id:sellerVariant,quantity:1},{variant_id:otherVariant,quantity:1}]}),randomUUID()]);
  const privateItem=await scalar('select id from order_items where order_id=$1 and seller_id=$2',[multiSellerOrder,outsider]);
  const siblingItem=await scalar('select id from order_items where order_id=$1 and seller_id=$2',[multiSellerOrder,sid]);
  await chat(user,privateItem,'message','Private other-shop conversation',randomUUID());
  await fails('select seller_conversation($1,$2)',[sid,privateItem]);
  await chat(outsider,privateItem,'request','Private refund reason for the other shop');
  const redacted=await chat(sid,siblingItem);
  assert.equal(redacted.messages.length,0);
  assert.equal(redacted.dispute,null);
  assert.equal((await scalar('select seller_support($1)',[sid])).some(t=>t.order_number===redacted.order_number),false);
  await mature(multiSellerOrder);
  assert.ok(await scalar('select seller_settled_at from order_items where id=$1',[siblingItem]));
  await chat(other,privateItem,'refund','Refund all items after reviewing both shops');
  assert.notEqual(await scalar('select status from orders where id=$1',[multiSellerOrder]),'refunded');
  assert.equal(Number(await scalar('select refund_amount from order_items where id=$1',[privateItem])),100000);
  assert.equal(Number(await scalar('select refund_amount from order_items where id=$1',[siblingItem])),0);
  const failsInTransaction=async (...args)=>{
    await db.exec('savepoint expected_failure');
    await fails(...args);
    await db.exec('rollback to savepoint expected_failure');
  };
  await db.exec('begin');
  const itemOrder = await scalar('select create_order($1,$2,$3)', [user, JSON.stringify({...sellerPayload,items:[{variant_id:sellerVariant,quantity:1},{variant_id:secondVariant,quantity:1}]}),randomUUID()]);
  // Exercise a discount that cannot be split evenly between the two items.
  await db.query('update orders set total=199999,discount=1 where id=$1',[itemOrder]);
  const itemIds=(await db.query('select id from order_items where order_id=$1 order by id',[itemOrder])).rows.map(i=>i.id);
  const beforeItems=Number(await scalar('select balance from profiles where id=$1',[user]));
  await chat(sid,itemIds[0],'request','Seller proposes refund of this product only');
  await chat(user,itemIds[1],'request','Buyer requests refund of the second product');
  assert.equal((await scalar('select seller_support($1)',[sid])).filter(t=>t.refund_item_id && itemIds.includes(t.refund_item_id)).length,2);
  await chat(user,itemIds[0],'agree');
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[user])),beforeItems+99999);
  assert.equal(await scalar('select refunded_at from order_items where id=$1',[itemIds[1]]),null);
  await failsInTransaction('select seller_conversation($1,$2,$3)',[user,itemIds[0],'agree']);
  await db.query("update seller_disputes set created_at=now()-interval '49 hours' where item_id=$1",[itemIds[1]]);
  const overdue=await chat(sid,itemIds[1]);
  assert.equal(overdue.dispute.needs_admin,true);
  assert.equal(overdue.dispute.can_agree,false);
  await failsInTransaction('select seller_conversation($1,$2,$3)',[sid,itemIds[1],'agree']);
  await failsInTransaction('select resolve_warranty_refund($1,$2,$3,$4,$5,$6)',[itemOrder,overdue.dispute.ticket_id,other,'wallet','Must not convert item request into whole order refund','']);
  await chat(other,itemIds[1],'refund','Admin resolves the overdue product request');
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[user])),beforeItems+199999);
  assert.equal(await scalar('select status from orders where id=$1',[itemOrder]),'refunded');
  await db.exec('rollback');
  await db.exec('begin');
  const partialOrder=await scalar('select create_order($1,$2,$3)',[user,JSON.stringify({...sellerPayload,items:[{variant_id:sellerVariant,quantity:1},{variant_id:secondVariant,quantity:1}]}),randomUUID()]);
  const partialItems=(await db.query('select id from order_items where order_id=$1 order by id',[partialOrder])).rows.map(i=>i.id);
  const beforePartial=Number(await scalar('select balance from profiles where id=$1',[user]));
  await chat(user,partialItems[0],'request','Refund first product before delivery');
  await chat(other,partialItems[0],'refund','Admin can intervene before the response deadline');
  await scalar('select fulfill_order($1,$2)',[partialOrder,JSON.stringify([{secret:'remaining-only',hash:randomUUID()}])]);
  assert.equal(Number(await scalar('select count(*) from inventory where item_id=$1',[partialItems[0]])),0);
  const remainingTicket=randomUUID();
  await db.query("insert into tickets(id,user_id,order_id,kind,subject,message) values($1,$2,$3,'warranty','Remaining order refund','Review remaining purchase')",[remainingTicket,user,partialOrder]);
  await scalar('select resolve_warranty_refund($1,$2,$3,$4,$5,$6)',[partialOrder,remainingTicket,other,'wallet','Refund the remaining paid amount only','']);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[user])),beforePartial+200000);
  await db.exec('rollback');
  await db.exec('set role service_role');
  await fails('select complete_item_refund($1,$2,$3)',[privateItem,other,'Cannot call internal refund helper directly']);
  await db.exec('reset role');
  pass('item refunds isolate same-seller products, allocate discount rounding, credit once, escalate after 48h, allow early admin intervention and refund only the remaining order balance');
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await fails('select * from seller_chat_messages');
    await fails('select * from seller_disputes');
    await fails('select seller_conversation($1,$2)',[user,escrowItem]);
    await fails('select release_seller_funds()');
    await db.exec('reset role');
  }
  pass('seller chat ownership/idempotency and 48h escrow: no early withdrawal, disputes freeze, bilateral consent, admin-only refund/rejection, exactly-once release and browser denial');
  }
  // Browser credentials cannot bypass Node MFA/suspension via PostgREST.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("select set_config('request.jwt.claim.aal','aal1',false)");
  await db.query("update account_controls set suspended=true where user_id=$1", [user]);
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['profiles','orders','order_items','payments','wallet_ledger','tickets','ticket_messages']) {
      assert.equal(await scalar('select has_any_column_privilege($1,$2,\'SELECT\')', [role, table]), false);
      await db.exec(`set role ${role}`);
      await fails(`select * from ${table}`);
      await db.exec('reset role');
    }
  }
  await db.exec('set role service_role');
  assert.ok(Number(await scalar('select count(*) from tickets where user_id=$1', [user])) > 0);
  await db.exec('reset role');
  pass('private tables deny browser SELECT including column grants, suspended owners and AAL1; backend retains access');

  const sessionUser = randomUUID(), currentAuth = randomUUID(), dormantAuth = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'session-cutoff@example.test')", [sessionUser]);
  await db.query("insert into auth.sessions(id,user_id,created_at) values($1,$3,now()-interval '1 hour'),($2,$3,now()-interval '1 hour')", [currentAuth,dormantAuth,sessionUser]);
  const authorizeSession = (session, hash = session, uid = sessionUser) => scalar(
    'select authorize_app_session($1,$2,$3,$4)', [uid,session,hash,'Regression browser']);
  await db.exec('set role service_role');
  const currentSession = await authorizeSession(currentAuth);
  assert.equal(currentSession.status, 'ok');
  assert.equal((await authorizeSession(dormantAuth,dormantAuth,other)).status, 'revoked');
  assert.equal(await scalar('select revoke_app_sessions($1,null,$2)', [sessionUser,currentSession.id]), true);
  assert.equal((await authorizeSession(currentAuth)).status, 'ok');
  assert.equal((await authorizeSession(dormantAuth)).status, 'revoked');
  assert.equal((await authorizeSession(dormantAuth)).status, 'revoked');
  assert.equal(Number(await scalar('select count(*) from app_sessions where user_id=$1', [sessionUser])), 1);
  await db.exec('reset role');
  const freshAuth = randomUUID();
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [freshAuth,sessionUser]);
  const unaffectedAuth = randomUUID(), unrelatedAuth = randomUUID();
  await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)', [unaffectedAuth,sessionUser,unrelatedAuth,other]);
  for (const sessionId of [freshAuth, unaffectedAuth, unrelatedAuth])
    await db.query('insert into auth.refresh_tokens(id,session_id) values($1,$2)', [randomUUID(), sessionId]);
  await db.exec('set role service_role');
  const freshSession = await authorizeSession(freshAuth);
  assert.equal(freshSession.status, 'ok');
  assert.equal(await scalar('select revoke_app_sessions($1,$2,null)', [other,freshSession.id]), false);
  assert.equal(await scalar('select revoke_app_sessions($1,null,$2)', [sessionUser,freshSession.id]), true);
  assert.equal((await authorizeSession(currentAuth)).status, 'revoked');
  assert.equal((await authorizeSession(freshAuth)).status, 'ok');
  assert.equal(await scalar('select revoke_app_sessions($1,$2,null)', [sessionUser,freshSession.id]), true);
  assert.equal((await authorizeSession(freshAuth)).status, 'revoked');
  await db.exec('reset role');
  assert.equal(Number(await scalar('select count(*) from auth.sessions where id=$1', [freshAuth])), 0,
    'Revoking one device must remove its provider session, not only deny the Node API');
  assert.equal(Number(await scalar('select count(*) from auth.refresh_tokens where session_id=$1', [freshAuth])), 0);
  for (const sessionId of [unaffectedAuth, unrelatedAuth]) {
    assert.equal(Number(await scalar('select count(*) from auth.sessions where id=$1', [sessionId])), 1);
    assert.equal(Number(await scalar('select count(*) from auth.refresh_tokens where session_id=$1', [sessionId])), 1);
  }
  assert.equal(await scalar('select revoke_app_sessions($1,$2,null)', [sessionUser, freshSession.id]), true);
  const legacySession = randomUUID();
  await db.query('insert into app_sessions(id,user_id,token_hash) values($1,$2,$3)', [legacySession, sessionUser, 'legacy-unmapped']);
  await fails('select revoke_app_sessions($1,$2,null)', [sessionUser, legacySession]);
  assert.equal(await scalar('select revoked_at from app_sessions where id=$1', [legacySession]), null);
  // Migration cleanup only touches previously revoked sessions with a matching owner.
  const cleanupAuth = randomUUID(), cleanupApp = randomUUID();
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [cleanupAuth,sessionUser]);
  await db.query('insert into app_sessions(id,user_id,token_hash,auth_session_id,revoked_at) values($1,$2,$3,$4,now())',
    [cleanupApp, sessionUser, 'previously-revoked', cleanupAuth]);
  await db.exec(await readFile(new URL('../supabase/migrations/034_revoke_provider_session.sql', import.meta.url), 'utf8'));
  assert.equal(Number(await scalar('select count(*) from auth.sessions where id=$1', [cleanupAuth])), 0);
  assert.equal(Number(await scalar('select count(*) from auth.sessions where id=$1', [unrelatedAuth])), 1);
  pass('single-device revocation removes provider session and refresh tokens, preserves unrelated devices, rejects unmapped legacy records and cleans up old revocations');
  const suspendedAuth = randomUUID();
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [suspendedAuth,sessionUser]);
  const pendingRevoker = randomUUID();
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [pendingRevoker,sessionUser]);
  const pendingSession = await authorizeSession(pendingRevoker);
  await db.query('update account_controls set suspended=true where user_id=$1', [sessionUser]);
  assert.equal(await scalar('select revoke_app_sessions($1,null,$2)', [sessionUser,pendingSession.id]), false);
  assert.equal((await authorizeSession(suspendedAuth)).status, 'suspended');
  await db.query('update account_controls set suspended=false where user_id=$1', [sessionUser]);
  assert.equal((await authorizeSession(suspendedAuth)).status, 'revoked');
  assert.equal((await authorizeSession(pendingRevoker)).status, 'revoked');
  const finalAuth = randomUUID();
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [finalAuth,sessionUser]);
  assert.equal((await authorizeSession(finalAuth)).status, 'ok');
  assert.equal(await scalar('select revoke_app_sessions($1)', [sessionUser]), true);
  assert.equal((await authorizeSession(finalAuth)).status, 'revoked');
  assert.equal((await authorizeSession(randomUUID())).status, 'revoked');
  pass('session cutoff rejects unregistered/old sessions, preserves current, allows new login, blocks cross-owner and suspension revival');
  // Preorders reserve capacity, collect payment now and preserve the promise
  // made at checkout; no inventory secret or service UID is required.
  await db.exec('reset role');
  await db.exec('begin');
  const sharedUser=randomUUID(), sharedProduct=randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'shared@example.test')",[sharedUser]);
  await db.query('update profiles set balance=1000000 where id=$1',[sharedUser]);
  await db.query("insert into products(id,slug,name,category,platform) values($1,'shared-fixture','Shared library','game','PC')",[sharedProduct]);
  const sharedData={name:'Unlimited',price:10000,original_price:10000,delivery:'key',stock:0,region:'Global',unlimited:true,shared_key:{secret:'cipher-one',hash:'shared-one'}};
  await db.query("update products set product_kind='source' where id=$1",[sharedProduct]);
  const sharedVariant=await scalar('select save_variant($1,$2)',[sharedProduct,JSON.stringify(sharedData)]);
  const sharedPayload={items:[{variant_id:sharedVariant,quantity:2}],method:'wallet',coupon:'',customer_note:''};
  const sharedRequest=randomUUID();
  const sharedOrder=await scalar('select create_order($1,$2,$3)',[sharedUser,JSON.stringify(sharedPayload),sharedRequest]);
  assert.equal(await scalar('select create_order($1,$2,$3)',[sharedUser,JSON.stringify(sharedPayload),sharedRequest]),sharedOrder);
  assert.equal(Number(await scalar('select count(*) from inventory where order_id=$1',[sharedOrder])),2);
  assert.equal(await scalar('select product_kind from order_items where order_id=$1 limit 1',[sharedOrder]),'source');
  await db.query("update products set product_kind='account' where id=$1",[sharedProduct]);
  assert.equal(await scalar('select product_kind from order_items where order_id=$1 limit 1',[sharedOrder]),'source');
  await db.exec('savepoint invalid_product_kind');
  await fails("update products set product_kind='invalid' where id=$1",[sharedProduct]);
  await db.exec('rollback to savepoint invalid_product_kind');
  pass('product classification is snapshotted into orders and rejects unsupported types');

  assert.equal(Number(await scalar('select stock from variants where id=$1',[sharedVariant])),100000);
  await db.exec('set constraints all immediate; set constraints all deferred');
  const sharedReceipt=await scalar('select payload from order_receipts where order_id=$1',[sharedOrder]);
  assert.deepEqual(sharedReceipt.items[0].encrypted_keys,['cipher-one','cipher-one']);
  await scalar('select save_variant($1,$2)',[sharedProduct,JSON.stringify({...sharedData,id:sharedVariant,shared_key:{secret:'cipher-two',hash:'shared-two'}})]);
  assert.equal(await scalar('select secret from inventory where order_id=$1 limit 1',[sharedOrder]),'cipher-one');
  const sharedPending=await scalar('select create_order($1,$2,$3)',[sharedUser,JSON.stringify({...sharedPayload,method:'sepay'}),randomUUID()]);
  assert.equal(await scalar('select secret from inventory where order_id=$1 limit 1',[sharedPending]),'cipher-two');
  await scalar('select cancel_order($1,$2)',[sharedUser,sharedPending]);
  assert.equal(Number(await scalar('select count(*) from inventory where order_id=$1',[sharedPending])),0);
  assert.equal(Number(await scalar('select stock from variants where id=$1',[sharedVariant])),100000);
  await db.exec('savepoint shared_reject');
  await fails('select import_keys($1,$2)',[sharedVariant,JSON.stringify([{secret:'wrong',hash:'wrong'}])]);
  await db.exec('rollback to shared_reject');
  await db.exec('set local role authenticated');
  await fails('select * from variant_shared_keys');
  await db.exec('rollback');
  pass('unlimited key stock, encrypted receipt snapshots, key rotation, cancellation and access protection');
  const preorderUser = randomUUID(), preorderProduct = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'preorder@example.test')", [preorderUser]);
  await db.query('update profiles set balance=1000000 where id=$1', [preorderUser]);
  await db.query("insert into products(id,slug,name,category,platform) values($1,'preorder-fixture','Upcoming game','game','Steam')", [preorderProduct]);
  const expectedDelivery = await scalar("select ((now() at time zone 'Asia/Ho_Chi_Minh')::date+7)::text");
  const preorderVariant = await scalar('select save_variant($1,$2)', [preorderProduct, JSON.stringify({ name:'Preorder',price:10000,original_price:10000,delivery:'manual',stock:3,region:'Global',is_preorder:true,expected_delivery:expectedDelivery })]);
  await fails('select save_variant($1,$2)', [preorderProduct, JSON.stringify({name:'Bad',price:10000,original_price:10000,delivery:'key',stock:0,region:'Global',is_preorder:true,expected_delivery:expectedDelivery})]);
  const preorderPayload = { items:[{variant_id:preorderVariant,quantity:1}],method:'wallet',coupon:'',customer_note:'' };
  const preorderRequest = randomUUID();
  const preorderOrder = await scalar('select create_order($1,$2,$3)', [preorderUser,JSON.stringify(preorderPayload),preorderRequest]);
  assert.equal(await scalar('select status from orders where id=$1',[preorderOrder]),'processing');
  assert.equal(await scalar('select delivered_at from order_items where order_id=$1',[preorderOrder]),null);
  assert.equal(Number(await scalar('select count(*) from inventory where order_id=$1',[preorderOrder])),0);
  assert.equal(Number(await scalar('select stock from variants where id=$1',[preorderVariant])),2);
  assert.equal(await scalar('select create_order($1,$2,$3)',[preorderUser,JSON.stringify(preorderPayload),preorderRequest]),preorderOrder);
  await db.query("update variants set expected_delivery=expected_delivery+1 where id=$1",[preorderVariant]);
  assert.equal(await scalar('select expected_delivery::text from order_items where order_id=$1',[preorderOrder]),expectedDelivery);
  const receipt = (await db.query('select * from order_receipts where order_id=$1',[preorderOrder])).rows[0];
  assert.equal(receipt.payload.items.length,1);
  assert.equal(receipt.payload.items[0].is_preorder,true);
  assert.equal(receipt.payload.items[0].expected_delivery,expectedDelivery);
  assert.equal(receipt.payload.email,'preorder@example.test');
  assert.equal(receipt.payload.total,10000);
  assert.equal('keys' in receipt.payload.items[0],false);
  await scalar('select fulfill_order($1,$2)',[preorderOrder,JSON.stringify([{secret:'encrypted-preorder-result',hash:randomUUID()}])]);
  assert.equal(await scalar('select status from orders where id=$1',[preorderOrder]),'completed');
  assert.equal(Number(await scalar('select count(*) from order_receipts where order_id=$1',[preorderOrder])),2);
  const deliveryReceipt = (await db.query("select payload from order_receipts where order_id=$1 and kind='delivery'",[preorderOrder])).rows[0].payload;
  assert.deepEqual(deliveryReceipt.items[0].encrypted_keys,['encrypted-preorder-result']);
  assert.ok(deliveryReceipt.items[0].delivered_at);
  await db.query('update order_items set delivered_at=delivered_at where order_id=$1',[preorderOrder]);
  assert.equal(Number(await scalar('select count(*) from order_receipts where order_id=$1',[preorderOrder])),2);
  await db.query('update variants set active=false where id=$1',[preorderVariant]);
  const beforeHiddenPurchase = await scalar('select balance from profiles where id=$1',[preorderUser]);
  await fails('select create_order($1,$2,$3)',[preorderUser,JSON.stringify(preorderPayload),randomUUID()]);
  assert.equal(await scalar('select balance from profiles where id=$1',[preorderUser]),beforeHiddenPurchase);
  const hiddenCatalog = await scalar('select catalog_search($1)',[JSON.stringify({q:'Upcoming game'})]);
  assert.ok(!JSON.stringify(hiddenCatalog.items).includes(preorderVariant));
  await db.query('update variants set active=true where id=$1',[preorderVariant]);
  const bankPreorder = await scalar('select create_order($1,$2,$3)', [preorderUser,JSON.stringify({...preorderPayload,method:'sepay'}),randomUUID()]);
  assert.equal(Number(await scalar('select count(*) from order_receipts where order_id=$1',[bankPreorder])),0);
  const bankReceiptPayment = (await db.query('select * from payments where order_id=$1',[bankPreorder])).rows[0];
  await scalar('select settle_payment($1,$2,$3)',['preorder-bank-payment',bankReceiptPayment.code,10000]);
  await scalar('select settle_payment($1,$2,$3)',['preorder-bank-payment',bankReceiptPayment.code,10000]);
  assert.equal(Number(await scalar('select count(*) from order_receipts where order_id=$1',[bankPreorder])),1);
  await db.exec('begin');
  await db.query('update variants set stock=2 where id=$1',[preorderVariant]);
  const repeatedOrder = await scalar('select create_order($1,$2,$3)', [preorderUser,JSON.stringify({...preorderPayload,items:[{variant_id:preorderVariant,quantity:2}]}),randomUUID()]);
  const repeatedData = JSON.stringify([{secret:'same-data',hash:'same-hash'},{secret:'same-data',hash:'same-hash'}]);
  await scalar('select fulfill_order($1,$2)',[repeatedOrder,repeatedData]);
  assert.equal(Number(await scalar('select count(distinct id) from inventory where order_id=$1',[repeatedOrder])),2);
  await fails('select fulfill_order($1,$2)',[repeatedOrder,repeatedData]);
  await db.exec('rollback');
  await db.query('update variants set stock=0 where id=$1',[preorderVariant]);
  await fails('select create_order($1,$2,$3)',[preorderUser,JSON.stringify(preorderPayload),randomUUID()]);
  await db.query("update variants set stock=1,expected_delivery=current_date-1 where id=$1",[preorderVariant]);
  await fails('select create_order($1,$2,$3)',[preorderUser,JSON.stringify(preorderPayload),randomUUID()]);
  pass('preorders accept wallet/bank payment without keys, retain delivery date, enforce capacity and fulfillment; receipts queue once only after payment');
  // Isolate one job; simulated crash, lease reclaim and stale acknowledgements.
  await db.query("update order_receipts set status='sent' where id<>$1",[receipt.id]);
  const claimedReceipt = (await db.query('select * from claim_order_receipt()')).rows[0];
  assert.equal(claimedReceipt.id,receipt.id);
  assert.equal((await db.query('select * from claim_order_receipt()')).rows.length,0);
  await db.query("update order_receipts set lease_until=now()-interval '1 second' where id=$1",[receipt.id]);
  const reclaimedReceipt = (await db.query('select * from claim_order_receipt()')).rows[0];
  assert.notEqual(reclaimedReceipt.claim_token,claimedReceipt.claim_token);
  assert.equal(await scalar('select finish_order_receipt($1,$2,true)',[receipt.id,claimedReceipt.claim_token]),false);
  assert.equal(await scalar('select finish_order_receipt($1,$2,false,$3)',[receipt.id,reclaimedReceipt.claim_token,'provider_http_503']),true);
  assert.equal((await db.query('select * from claim_order_receipt()')).rows.length,0);
  await db.query("update order_receipts set available_at=now() where id=$1",[receipt.id]);
  const retryReceipt = (await db.query('select * from claim_order_receipt()')).rows[0];
  assert.equal(await scalar('select finish_order_receipt($1,$2,true)',[receipt.id,retryReceipt.claim_token]),true);
  await db.exec('set role authenticated');
  await fails('select * from order_receipts');
  await fails('select * from claim_order_receipt()');
  await fails('select finish_order_receipt($1,$2,true)',[receipt.id,retryReceipt.claim_token]);
  await db.exec('reset role');
  pass('receipt queue leases, crash retry, backoff, stale acknowledgement protection and browser access denial');
  {
  const routeUser=randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'routing@example.test')",[routeUser]);
  const paymentId=await scalar('select id from create_wallet_topup($1,33000)',[routeUser]);
  const paymentCode=await scalar('select code from payments where id=$1',[paymentId]);
  const claimA=randomUUID(),claimB=randomUUID();
  const claim=(id,token)=>db.query('select * from claim_payment_route($1,$2)',[id,token]);
  assert.equal((await claim(paymentId,claimA)).rows[0].claim_token,claimA);
  assert.equal((await claim(paymentId,claimB)).rows[0].claim_token,claimA);
  const routeData={provider:'tingee',bill_id:'TEST-BILL-001',qr_account:'TEST-QR',qr_image:'data:image/png;base64,TEST',
    bank:'970418',bank_bin:'970418',va_account:'TEST-VA',account:'TEST-QR',account_name:'TEST',expires_at:new Date(Date.now()+10*60000).toISOString()};
  assert.equal(await scalar('select finish_payment_route($1,$2,$3)',[paymentId,claimB,JSON.stringify(routeData)]),false);
  assert.equal(await scalar('select finish_payment_route($1,$2,$3)',[paymentId,claimA,JSON.stringify(routeData)]),true);
  assert.equal(await scalar('select finish_payment_route($1,$2,$3)',[paymentId,claimA,JSON.stringify({provider:'pay2s'})]),false);
  assert.equal((await claim(paymentId,claimB)).rows[0].provider,'tingee');
  assert.ok(Date.parse(await scalar('select expires_at from payments where id=$1',[paymentId]))<=Date.parse(routeData.expires_at));
  assert.equal((await scalar('select settle_routed_payment($1,$2,$3,$4)', ['pay2s','wrong-provider',paymentCode,33000])).ignored,true);
  assert.equal((await scalar('select settle_routed_payment($1,$2,$3,$4,$5)', ['tingee','wrong-bill',paymentCode,33000,'OTHER'])).ignored,true);
  assert.equal((await scalar('select settle_routed_payment($1,$2,$3,$4,$5)', ['tingee','wrong-amount',paymentCode,32000,routeData.bill_id])).review,true);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[routeUser])),0);
  const polls=await db.query('select * from claim_tingee_polls()');
  assert.equal(polls.rows.length,1);assert.equal((await db.query('select * from claim_tingee_polls()')).rows.length,0);
  {
    await db.exec('begin');
    let job = Object.values(polls.rows[0])[0];
    assert.ok(job.claim_token && job.polled_at);
    assert.equal(job.qr_image, undefined);
    assert.ok(!JSON.stringify(job).includes(routeData.qr_image));
    const ack = (token, error = null, closed = false, failed = false) =>
      scalar('select finish_tingee_poll($1,$2,$3,$4,$5)', [paymentId, token, error, closed, failed]);
    assert.equal(await ack(randomUUID()), false);
    // Even a legacy worker writing a past VPS timestamp cannot steal the lease.
    await db.query("update payment_routes set next_poll_at=now()-interval '1 day' where payment_id=$1", [paymentId]);
    assert.equal((await db.query('select * from claim_tingee_polls()')).rows.length, 0);
    const stale = job.claim_token;
    await db.query("update payment_routes set lease_until=now()-interval '1 second' where payment_id=$1", [paymentId]);
    job = Object.values((await db.query('select * from claim_tingee_polls()')).rows[0])[0];
    assert.notEqual(job.claim_token, stale);
    assert.equal(await ack(stale), false);
    assert.equal(await ack(job.claim_token), true);
    let seconds = Number(await scalar('select extract(epoch from next_poll_at-clock_timestamp()) from payment_routes where payment_id=$1', [paymentId]));
    assert.ok(seconds > 3 && seconds <= 5, `healthy pending delay ${seconds}`);
    for (const minimum of [14, 29, 59]) {
      await db.query("update payment_routes set next_poll_at=now()-interval '1 second' where payment_id=$1", [paymentId]);
      job = Object.values((await db.query('select * from claim_tingee_polls()')).rows[0])[0];
      assert.equal(await ack(job.claim_token, 'tingee_timeout', true, true), true);
      seconds = Number(await scalar('select extract(epoch from next_poll_at-clock_timestamp()) from payment_routes where payment_id=$1', [paymentId]));
      assert.ok(seconds > minimum && seconds <= minimum + 1, `failure delay ${seconds}`);
      assert.equal(await scalar('select remote_closed from payment_routes where payment_id=$1', [paymentId]), false);
    }
    // Recovery resets retry count. Terminal static routes remain monitored, slowly.
    await db.query("update payment_routes set qr_kind='static',next_poll_at=now()-interval '1 second' where payment_id=$1", [paymentId]);
    await db.query("update payments set status='expired' where id=$1", [paymentId]);
    job = Object.values((await db.query('select * from claim_tingee_polls()')).rows[0])[0];
    assert.equal(await ack(job.claim_token), true);
    seconds = Number(await scalar('select extract(epoch from next_poll_at-clock_timestamp()) from payment_routes where payment_id=$1', [paymentId]));
    assert.ok(seconds > 598 && seconds <= 600);
    assert.equal(await scalar('select poll_failures from payment_routes where payment_id=$1', [paymentId]), 0);
    for (const role of ['anon', 'authenticated'])
      assert.equal(await scalar('select has_function_privilege($1,$2,$3)', [role, 'finish_tingee_poll(uuid,uuid,text,boolean,boolean)', 'EXECUTE']), false);
    assert.equal(await scalar("select has_function_privilege('service_role','finish_tingee_poll(uuid,uuid,text,boolean,boolean)','EXECUTE')"), true);
    await db.exec('rollback');
    pass('Tingee polling omits QR blobs, leases reject stale workers, DB-time scheduling enforces retry/backoff, errors never close routes and RPC is service-only');
  }
  assert.equal((await scalar('select settle_routed_payment($1,$2,$3,$4,$5)', ['tingee','tingee-paid',paymentCode,33000,routeData.bill_id])).paid,true);
  assert.equal((await scalar('select settle_routed_payment($1,$2,$3,$4,$5)', ['tingee','tingee-paid',paymentCode,33000,routeData.bill_id])).duplicate,true);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[routeUser])),33000);
  assert.equal(await scalar("select outcome from payment_events where transaction_id='wrong-provider'"),'provider_mismatch');
  await fails('select credit_reviewed_payment($1,$2,$3,$4)', ['wrong-provider',routeUser,'Must not double credit',other]);
  pass('dynamic QR claims are exclusive, expiry is aligned, source/bill/amount mismatches cannot credit, polling and settlement deduplicate');
  const backupId=await scalar('select id from create_wallet_topup($1,34000)',[routeUser]);
  const backupCode=await scalar('select code from payments where id=$1',[backupId]);
  await claim(backupId,claimA);
  await db.query("update payment_routes set lease_until=now()-interval '1 second' where payment_id=$1",[backupId]);
  assert.equal((await claim(backupId,claimB)).rows[0].attempts,2);
  assert.equal(await scalar('select finish_payment_route($1,$2,$3)',[backupId,claimA,JSON.stringify(routeData)]),false);
  assert.equal(await scalar('select finish_payment_route($1,$2,$3)',[backupId,claimB,JSON.stringify({provider:'pay2s',bank:'MB',account:'BACKUP',account_name:'TEST'})]),true);
  assert.equal((await scalar('select settle_routed_payment($1,$2,$3,$4,$5)', ['tingee','stale-tingee',backupCode,34000,'UNKNOWN-BILL'])).ignored,true);
  assert.equal((await scalar('select settle_routed_payment($1,$2,$3,$4)', ['pay2s','backup-paid',backupCode,34000])).paid,true);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[routeUser])),67000);
  const lateId=await scalar('select id from create_wallet_topup($1,35000)',[routeUser]);
  const lateCode=await scalar('select code from payments where id=$1',[lateId]);
  await claim(lateId,claimA);
  await scalar('select finish_payment_route($1,$2,$3)',[lateId,claimA,JSON.stringify({...routeData,bill_id:'LATE-BILL'})]);
  await db.query("update payments set expires_at=now()-interval '1 second' where id=$1",[lateId]);
  assert.equal((await scalar('select settle_routed_payment($1,$2,$3,$4,$5)', ['tingee','late-paid',lateCode,35000,'LATE-BILL'])).review,true);
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[routeUser])),67000);
  const staticLateId=await scalar('select id from create_wallet_topup($1,36000)',[routeUser]);
  const staticLateCode=await scalar('select code from payments where id=$1',[staticLateId]);
  const staticClaim=randomUUID();
  await claim(staticLateId,staticClaim);
  const staticRoute={...routeData,qr_kind:'static',bill_id:null,bank:'MBBank',bank_bin:'970422',
    qr_account:'STATIC-VA',va_account:'STATIC-VA',account:'STATIC-VA',
    expires_at:new Date(Date.now()+10*60000).toISOString()};
  assert.equal(await scalar('select finish_payment_route($1,$2,$3)',[staticLateId,staticClaim,JSON.stringify(staticRoute)]),true);
  await db.query("update payments set created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes' where id=$1",[staticLateId]);
  const staticTx='tingee-static:'+'a'.repeat(64);
  await db.query("insert into payment_events(transaction_id,code,amount,outcome) values($1,$2,36000,'needs_review')",[staticTx,staticLateCode]);
  const staticPaid=await scalar('select settle_tingee_static($1,$2,$3,$4,$5,$6)',[
    staticTx,staticLateCode,36000,'STATIC-VA','970422',
    await scalar('select expires_at-interval \'1 minute\' from payments where id=$1',[staticLateId]),
  ]);
  assert.equal(staticPaid.paid,true);
  assert.equal((await scalar('select settle_tingee_static($1,$2,$3,$4,$5,$6)',[
    staticTx,staticLateCode,36000,'STATIC-VA','970422',
    await scalar('select expires_at-interval \'1 minute\' from payments where id=$1',[staticLateId]),
  ])).duplicate,true);
  assert.equal(await scalar('select status from payments where id=$1',[staticLateId]),'paid');
  assert.equal(await scalar('select outcome from payment_events where transaction_id=$1',[staticTx]),'paid');
  assert.equal(Number(await scalar('select balance from profiles where id=$1',[routeUser])),103000);
  await db.exec('set role authenticated');
  await fails('select * from payment_routes');
  await fails('select * from claim_payment_route($1,$2)',[lateId,claimA]);
  await fails('select * from claim_tingee_polls()');
  await fails('select settle_routed_payment($1,$2,$3,$4,$5)', ['tingee','forged-paid',lateCode,35000,'LATE-BILL']);
  await db.exec('reset role');
  pass('payment route pinning, late-order review, pre-expiry static wallet credit, idempotency and browser access denial');
  }
  {
    await db.exec("set role service_role; insert into public.account_carts(user_id,items) select id,'[]'::jsonb from public.profiles limit 1; reset role;");
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await fails('select * from public.account_carts');
      await fails("update public.account_carts set items='[]'");
      await db.exec('reset role');
    }
    pass('account carts are service-only and deny direct browser reads and writes');
  }
  {
    const aid = randomUUID(), secondAdmin = randomUUID(), suspendedAdmin = randomUUID();
    const buyer = randomUUID(), seller = randomUUID(), pid = randomUUID(), vid = randomUUID();
    await db.exec('begin');
    for (const [id, role] of [[aid, 'admin'], [secondAdmin, 'admin'], [suspendedAdmin, 'admin'], [buyer, 'customer'], [seller, 'seller']]) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@admin-notice.test`]);
      await db.query('update profiles set role=$2,balance=1000000 where id=$1', [id, role]);
    }
    await db.query('insert into account_controls(user_id,suspended) values($1,true)', [suspendedAdmin]);
    const notice = key => scalar('select count(*)::int from notifications where id=$1', [`admin:${key}:${aid}`]);
    const flush = () => db.exec('set constraints all immediate; set constraints all deferred');
    const ticket = await scalar("insert into tickets(user_id,subject,message) values($1,'Need support','Please help with my purchase') returning id", [buyer]);
    assert.equal(await notice(`ticket:${ticket}`), 1);
    assert.equal(await scalar('select count(*)::int from notifications where user_id=$1 and id=$2', [secondAdmin, `admin:ticket:${ticket}:${secondAdmin}`]), 1);
    assert.equal(await scalar("select count(*)::int from notifications where user_id in($1,$2) and id like 'admin:%'", [suspendedAdmin, buyer]), 0);
    await db.query('update notifications set read_at=now() where id=$1', [`admin:ticket:${ticket}:${aid}`]);
    await db.query("select add_ticket_message($1,$2,'Additional customer information')", [buyer, ticket]);
    const mid = await scalar("select id from ticket_messages where ticket_id=$1 and role='customer'", [ticket]);
    assert.equal(await notice(`ticket-message:${mid}`), 1);
    assert.ok(await scalar('select read_at from notifications where id=$1', [`admin:ticket:${ticket}:${aid}`]));
    assert.equal(await scalar('select read_at from notifications where id=$1', [`admin:ticket:${ticket}:${secondAdmin}`]), null);
    const beforeReply = await scalar("select count(*)::int from notifications where user_id=$1 and id like 'admin:%'", [aid]);
    await db.query("select add_ticket_message($1,$2,'Admin reply to customer','closed','normal')", [aid, ticket]);
    assert.equal(await scalar("select count(*)::int from notifications where user_id=$1 and id like 'admin:%'", [aid]), beforeReply);

    await db.query("insert into products(id,slug,name,category,platform) values($1,$2,'Upcoming product','game','PC')", [pid, `admin-events-${pid}`]);
    await db.query("insert into variants(id,product_id,name,price,original_price,stock,delivery,is_preorder,expected_delivery) values($1,$2,'Preorder',10000,10000,10,'manual',true,current_date+7)", [vid, pid]);
    const payload = { items: [{ variant_id: vid, quantity: 1 }], method: 'wallet', coupon: '', customer_note: '' };
    const requestId = randomUUID();
    const walletOrder = await scalar('select create_order($1,$2,$3)', [buyer, JSON.stringify(payload), requestId]);
    await flush();
    assert.equal(await notice(`order-paid:${walletOrder}`), 1);
    assert.equal(await notice(`preorder:${walletOrder}`), 0);
    assert.match(await scalar('select title from notifications where id=$1', [`admin:order-paid:${walletOrder}:${aid}`]), /Đơn đặt trước đã thanh toán/);
    await scalar('select create_order($1,$2,$3)', [buyer, JSON.stringify(payload), requestId]);
    await flush();
    assert.equal(await notice(`order-paid:${walletOrder}`), 1);
    const bankOrder = await scalar('select create_order($1,$2,$3)', [buyer, JSON.stringify({ ...payload, method: 'sepay' }), randomUUID()]);
    await flush();
    assert.equal(await notice(`preorder:${bankOrder}`), 1);
    assert.equal(await notice(`order-paid:${bankOrder}`), 0);
    const paymentCode = await scalar('select code from payments where order_id=$1', [bankOrder]);
    await scalar('select settle_payment($1,$2,10000)', [`admin-test-${randomUUID()}`, paymentCode]);
    await flush();
    assert.equal(await notice(`order-paid:${bankOrder}`), 1);
    await db.query("update orders set customer_note='Non-status edit' where id=$1", [bankOrder]);
    await flush();
    assert.equal(await notice(`order-paid:${bankOrder}`), 1);
    await db.query('update variants set is_preorder=false where id=$1', [vid]);
    const ordinary = { ...payload, customer_note: 'Service information' };
    // Triggers still work for backend writes although manual helper execution is revoked.
    await db.exec('set local role service_role');
    const ordinaryOrder = await scalar('select create_order($1,$2,$3)', [buyer, JSON.stringify(ordinary), randomUUID()]);
    await flush();
    await db.exec('reset role');
    assert.equal(await notice(`order-paid:${ordinaryOrder}`), 1);
    assert.match(await scalar('select title from notifications where id=$1', [`admin:order-paid:${ordinaryOrder}:${aid}`]), /^Đơn hàng đã thanh toán/);
    assert.match(await scalar('select body from notifications where id=$1', [`admin:order-paid:${ordinaryOrder}:${aid}`]), /giao thủ công/);
    const ordinaryPending = await scalar('select create_order($1,$2,$3)', [buyer, JSON.stringify({ ...ordinary, method: 'sepay' }), randomUUID()]);
    await flush();
    assert.equal(await notice(`preorder:${ordinaryPending}`), 0);
    assert.equal(await notice(`order-paid:${ordinaryPending}`), 0);

    const sp = await scalar("insert into products(slug,name,category,platform,seller_id) values($1,'Seller listing','game','PC',$2) returning id", [`notice-seller-${pid}`, seller]);
    await flush();
    assert.equal(await notice(`product-review:${sp}:1`), 1);
    await db.query("update products set description='Updated offering' where id=$1", [sp]);
    await flush();
    assert.equal(await notice(`product-review:${sp}:2`), 1);
    await db.query("update products set description='Updated again' where id=$1", [sp]);
    await db.query("update products set subtitle='Final offering' where id=$1", [sp]);
    await flush();
    assert.equal(await notice(`product-review:${sp}:3`), 0);
    assert.equal(await notice(`product-review:${sp}:4`), 1);
    const wid = await scalar("insert into seller_withdrawals(user_id,amount,bank,account_number,account_name,idempotency) values($1,50000,'LAB','PRIVATE_BANK_ACCOUNT','Seller',$2) returning id", [seller, randomUUID()]);
    assert.equal(await notice(`withdrawal:${wid}`), 1);
    const item = await scalar('select id from order_items where order_id=$1', [bankOrder]);
    const disputeTicket = await scalar("insert into tickets(user_id,order_id,refund_item_id,kind,subject,message) values($1,$2,$3,'warranty','Refund product','Please refund this product') returning id", [buyer, bankOrder, item]);
    await db.query('insert into seller_disputes(order_id,item_id,requested_by,seller_id,ticket_id,reason,amount) values($1,$2,$3,$4,$5,$6,10000)', [bankOrder, item, buyer, seller, disputeTicket, 'Private refund reason']);
    assert.equal(await notice(`dispute:${item}`), 1);
    assert.equal(await notice(`ticket:${disputeTicket}`), 0);
    const tx = `notice-${randomUUID()}`;
    await db.query("insert into payment_events(transaction_id,code,amount,outcome) values($1,'LAB',10000,'needs_review')", [tx]);
    await flush();
    const txhash = await scalar('select md5($1)', [tx]);
    assert.equal(await notice(`payment-review:${txhash}`), 1);
    const transientTx = `transient-${randomUUID()}`;
    await db.query("insert into payment_events(transaction_id,code,amount,outcome) values($1,'LAB',10000,'needs_review')", [transientTx]);
    await db.query("update payment_events set outcome='paid' where transaction_id=$1", [transientTx]);
    await flush();
    assert.equal(await notice(`payment-review:${await scalar('select md5($1)', [transientTx])}`), 0);
    const serializedNotices = JSON.stringify((await db.query("select * from notifications where user_id=$1 and id like 'admin:%'", [aid])).rows);
    assert.ok(!serializedNotices.includes('PRIVATE_BANK_ACCOUNT'));
    for (const role of ['anon', 'authenticated', 'service_role'])
      for (const fn of ['notify_admin_business_event()', 'notify_admin_order(uuid)', 'notify_active_admins(text,text,text,text,timestamptz,uuid)'])
        assert.equal(await scalar('select has_function_privilege($1,$2,$3)', [role, fn, 'EXECUTE']), false);

    // Re-run just the deployment backfill: read receipts stay read and no row duplicates.
    const migration = await readFile(new URL('../supabase/migrations/054_admin_event_notifications.sql', import.meta.url), 'utf8');
    const backfill = migration.slice(migration.indexOf('do $$\ndeclare t public.tickets;')).replace(/commit;\s*$/, '');
    await db.query("update tickets set status='open' where id=$1", [ticket]);
    const newAdmin = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [newAdmin, `${newAdmin}@backfill.test`]);
    await db.query("update profiles set role='admin' where id=$1", [newAdmin]);
    assert.equal(await scalar("select count(*)::int from notifications where user_id=$1", [newAdmin]), 0);
    await db.exec(backfill);
    for (const key of [`ticket:${ticket}`, `order-paid:${walletOrder}`, `product-review:${sp}:4`, `withdrawal:${wid}`, `dispute:${item}`, `payment-review:${txhash}`])
      assert.equal(await scalar('select count(*)::int from notifications where id=$1', [`admin:${key}:${newAdmin}`]), 1, `backfill ${key}`);
    const previousCount = await scalar("select count(*)::int from notifications where user_id=$1", [aid]);
    await db.exec(backfill);
    assert.equal(await scalar("select count(*)::int from notifications where user_id=$1", [aid]), previousCount);
    assert.ok(await scalar('select read_at from notifications where id=$1', [`admin:ticket:${ticket}:${aid}`]));
    await db.exec('savepoint rollback_notice');
    const rolledBackTicket = await scalar("insert into tickets(user_id,subject,message) values($1,'Rolled back','This request must not persist') returning id", [buyer]);
    assert.equal(await notice(`ticket:${rolledBackTicket}`), 1);
    await db.exec('rollback to rollback_notice');
    assert.equal(await notice(`ticket:${rolledBackTicket}`), 0);
    await db.exec('rollback');
    pass('admin events cover support/replies, paid and pending preorders, seller review/withdrawals, refunds and payment review; recipients, independent read receipts, deduplication, rollback and trigger privileges');
  }
  console.log(
    `${checks} PostgreSQL checks passed. Real multi-connection contention and hosted Supabase Auth still require integration testing.`,
  );
} finally {
  await db.close();
}
