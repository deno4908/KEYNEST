import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseStep } from '../scripts/database-sql.js';
import { PGlite } from '@electric-sql/pglite';
import { deleteAdminRecord } from '../server/admin-deletion.js';

test('admin deletion protects related records and permissions in demo mode', async () => {
  const store = {
    db: { users: [{id:'admin',role:'admin'}, {id:'seller',role:'seller'}], categories:[{id:'game'}], products:[{category:'game'}], coupons:[{code:'SALE',category:'game'}], orders:[{coupon:'SALE'}], banners:[{id:'banner'}] },
    audit: () => {}, save: () => {},
  };
  await assert.rejects(deleteAdminRecord(store,'seller','banner','banner'), /quản trị/);
  await assert.rejects(deleteAdminRecord(store,'admin','category','game'), /còn sản phẩm/);
  await assert.rejects(deleteAdminRecord(store,'admin','coupon','SALE'), /đơn hàng/);
  store.db.orders=[];
  await deleteAdminRecord(store,'admin','coupon','SALE');
  store.db.products=[];
  await deleteAdminRecord(store,'admin','category','game');
  await deleteAdminRecord(store,'admin','banner','banner');
  assert.equal(store.db.categories.length + store.db.coupons.length + store.db.banners.length,0);
  await assert.rejects(deleteAdminRecord(store,'admin','banner','banner'), /Không tìm thấy/);
});

test('SQL deletion enforces admin access, dependencies, audit and service-only access', async () => {
  const db = new PGlite();
  const admin='00000000-0000-4000-8000-000000000001';
  const seller='00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table profiles(id uuid primary key,role text);
      create table categories(id text primary key);
      create table products(category text references categories);
      create table coupons(code text primary key,category text);
      create table orders(coupon text);
      create table banners(id uuid primary key);
      create table audit_logs(user_id uuid,action text,target text);
      insert into profiles values('${admin}','admin'),('${seller}','seller');
      insert into categories values('game'); insert into products values('game');
      insert into coupons values('SALE','game'); insert into orders values('SALE');
      insert into banners values('${admin}');`);
    await db.exec(databaseStep('026_admin_deletion'));
    const remove=(actor,kind,id)=>db.query('select delete_admin_record($1,$2,$3)',[actor,kind,id]);
    await assert.rejects(remove(seller,'banner',admin),/quản trị/);
    await assert.rejects(remove(admin,'category','game'),/còn sản phẩm/);
    await assert.rejects(remove(admin,'coupon','SALE'),/đơn hàng/);
    await db.exec('delete from orders; delete from products;');
    await assert.rejects(remove(admin,'category','game'),/mã giảm giá/);
    await remove(admin,'coupon','SALE'); await remove(admin,'category','game'); await remove(admin,'banner',admin);
    assert.equal((await db.query('select * from audit_logs')).rows.length,3);
    await assert.rejects(remove(admin,'banner',admin),/Không tìm thấy/);
    assert.equal((await db.query("select has_function_privilege('authenticated','delete_admin_record(uuid,text,text)','execute') as allowed")).rows[0].allowed,false);
  } finally { await db.close(); }
});
