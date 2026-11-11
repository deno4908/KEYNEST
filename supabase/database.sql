-- KEYNEST canonical application database SQL.
-- The only maintained SQL source: supabase/database.sql.
-- Fresh Supabase project: execute this whole file once in SQL Editor.
-- Existing project: apply only missing numbered steps; see README.md.
-- This defines the schema/RPCs/RLS; it is not a backup of live customer data.
-- Supabase manages auth and storage schemas separately.
-- Keep step order and identifiers stable. Add future changes at the end.

-- KEYNEST STEP 001_store BEGIN
-- Run once in Supabase SQL Editor on a fresh project.
create extension if not exists pgcrypto;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text not null, name text not null default '', role text not null default 'customer' check(role in ('customer','admin')), balance bigint not null default 0 check(balance>=0));
create function public.handle_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into profiles(id,email,name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'name','')); return new; end $$;
create trigger new_auth_user after insert on auth.users for each row execute function public.handle_user();
create table public.products(id uuid primary key default gen_random_uuid(),slug text unique not null,name text not null,category text not null check(category in ('game','gift','topup','mmo')),platform text not null,subtitle text not null default '',description text not null default '',image text not null default '',featured boolean not null default false,active boolean not null default true,sort_order integer not null default 0);
create table public.variants(id uuid primary key default gen_random_uuid(),product_id uuid not null references products(id),name text not null,price bigint not null check(price>0),original_price bigint not null check(original_price>0),delivery text not null check(delivery in ('key','manual')),stock integer not null default 0 check(stock>=0),region text not null default 'Global');
create table public.coupons(code text primary key,percent integer not null check(percent between 1 and 100),max_discount bigint not null check(max_discount>0),active boolean not null default true,expires_at timestamptz);
insert into coupons values('WELCOME10',10,100000,true,null);
create table public.orders(id uuid primary key default gen_random_uuid(),user_id uuid not null references profiles(id),number text unique not null default ('KN-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),subtotal bigint not null,discount bigint not null default 0,total bigint not null check(total>=0),method text not null check(method in ('wallet','sepay')),status text not null check(status in ('pending','processing','completed','expired','cancelled','refunded')),customer_note text not null default '',coupon text not null default '',idempotency uuid not null,fingerprint jsonb not null,created_at timestamptz not null default now(),unique(user_id,idempotency));
create table public.order_items(id uuid primary key default gen_random_uuid(),order_id uuid not null references orders(id),variant_id uuid not null references variants(id),product_id uuid not null references products(id),name text not null,variant_name text not null,price bigint not null,quantity integer not null check(quantity between 1 and 10),delivery text not null);
create table public.inventory(id uuid primary key default gen_random_uuid(),variant_id uuid not null references variants(id),secret text not null,secret_hash text not null,order_id uuid references orders(id),item_id uuid references order_items(id),unique(variant_id,secret_hash));
create table public.payments(id uuid primary key default gen_random_uuid(),user_id uuid not null references profiles(id),order_id uuid unique references orders(id),amount bigint not null check(amount>0),code text unique not null default ('KN'||upper(encode(gen_random_bytes(8),'hex'))),status text not null default 'pending' check(status in ('pending','paid','expired','cancelled')),transaction_id text unique,created_at timestamptz not null default now(),expires_at timestamptz not null default (now()+interval '15 minutes'));
create table public.wallet_ledger(id uuid primary key default gen_random_uuid(),user_id uuid not null references profiles(id),amount bigint not null,description text not null,created_at timestamptz not null default now());
create table public.payment_events(transaction_id text primary key,code text not null,amount bigint not null,outcome text not null,created_at timestamptz not null default now());
create table public.tickets(id uuid primary key default gen_random_uuid(),user_id uuid not null references profiles(id),subject text not null,message text not null,status text not null default 'open',reply text not null default '',created_at timestamptz not null default now());
create table public.reviews(id uuid primary key default gen_random_uuid(),user_id uuid not null references profiles(id),product_id uuid not null references products(id),name text not null,rating integer not null check(rating between 1 and 5),comment text not null,created_at timestamptz not null default now(),unique(user_id,product_id));
create table public.audit_logs(id uuid primary key default gen_random_uuid(),user_id uuid references profiles(id),action text not null,target text not null,created_at timestamptz not null default now());
create index on orders(user_id,created_at desc);
create index on inventory(variant_id) where order_id is null;
create index on order_items(order_id);
create index on payments(status,expires_at);
create index on wallet_ledger(user_id,created_at desc);

-- All money, inventory and order mutations go through service-only transactions.
create function public.release_order(p_order uuid) returns void language plpgsql set search_path=public as $$ declare i record; begin
 for i in select * from order_items where order_id=p_order order by variant_id loop update variants set stock=stock+i.quantity where id=i.variant_id; end loop;
 update inventory set order_id=null,item_id=null where order_id=p_order;
end $$;
create function public.expire_payments() returns void language plpgsql set search_path=public as $$ declare p record; o orders; begin
 for p in select * from payments where status='pending' and expires_at<now() order by id for update skip locked loop
  if p.order_id is not null then select * into o from orders where id=p.order_id for update; if o.status='pending' then perform release_order(o.id); update orders set status='expired' where id=o.id; end if; end if;
  update payments set status='expired' where id=p.id;
 end loop;
end $$;
create function public.create_order(p_user uuid,p_payload jsonb,p_idempotency uuid) returns uuid language plpgsql set search_path=public as $$
declare u profiles; o orders; v variants; pr products; line jsonb; c coupons; sub bigint:=0; disc bigint:=0; oid uuid; iid uuid; inv uuid; n integer; method text:=p_payload->>'method'; has_manual boolean:=false;
begin
 perform expire_payments(); select * into u from profiles where id=p_user for update; if not found then raise exception 'Tài khoản không tồn tại'; end if;
 select * into o from orders where user_id=p_user and idempotency=p_idempotency;
 if found then if o.fingerprint<>p_payload then raise exception 'Mã yêu cầu đã dùng cho giỏ hàng khác'; end if; return o.id; end if;
 if method not in ('wallet','sepay') or jsonb_array_length(p_payload->'items') not between 1 and 20 then raise exception 'Giỏ hàng không hợp lệ'; end if;
 for line in select value from jsonb_array_elements(p_payload->'items') order by value->>'variant_id' loop
  select * into v from variants where id=(line->>'variant_id')::uuid for update;
  if not found then raise exception 'Không tìm thấy gói'; end if;
  select * into pr from products where id=v.product_id and active;
  n:=(line->>'quantity')::integer; if not found or n not between 1 and 10 or v.stock<n then raise exception 'Không đủ tồn kho'; end if;
  if v.delivery='manual' then has_manual:=true; if length(trim(p_payload->>'customer_note'))=0 then raise exception 'Cần UID hoặc thông tin dịch vụ'; end if; end if;
  sub:=sub+v.price*n;
 end loop;
 if coalesce(p_payload->>'coupon','')<>'' then select * into c from coupons where code=p_payload->>'coupon' and active and (expires_at is null or expires_at>now()); if not found then raise exception 'Mã giảm giá không hợp lệ'; end if; disc:=least(sub*c.percent/100,c.max_discount); end if;
 if method='wallet' and u.balance<sub-disc then raise exception 'Số dư ví không đủ'; end if;
 insert into orders(user_id,subtotal,discount,total,method,status,customer_note,coupon,idempotency,fingerprint) values(p_user,sub,disc,sub-disc,method,case when method='sepay' then 'pending' when has_manual then 'processing' else 'completed' end,coalesce(p_payload->>'customer_note',''),coalesce(p_payload->>'coupon',''),p_idempotency,p_payload) returning id into oid;
 for line in select value from jsonb_array_elements(p_payload->'items') order by value->>'variant_id' loop
  select * into v from variants where id=(line->>'variant_id')::uuid; select * into pr from products where id=v.product_id; n:=(line->>'quantity')::integer;
  insert into order_items(order_id,variant_id,product_id,name,variant_name,price,quantity,delivery) values(oid,v.id,pr.id,pr.name,v.name,v.price,n,v.delivery) returning id into iid;
  update variants set stock=stock-n where id=v.id;
  if v.delivery='key' then for j in 1..n loop
   select id into inv from inventory where variant_id=v.id and order_id is null order by id limit 1 for update skip locked;
   if inv is null then raise exception 'Kho mã không đủ'; end if;
   update inventory set order_id=oid,item_id=iid where id=inv;
  end loop; end if;
 end loop;
 if method='wallet' then update profiles set balance=balance-(sub-disc) where id=p_user; insert into wallet_ledger(user_id,amount,description) values(p_user,-(sub-disc),'Thanh toán '||(select number from orders where id=oid));
 else insert into payments(user_id,order_id,amount) values(p_user,oid,sub-disc); end if;
 return oid;
end $$;

create function public.settle_payment(p_transaction text,p_code text,p_amount bigint) returns jsonb language plpgsql set search_path=public as $$ declare p payments; o orders; begin
 perform expire_payments();
 insert into payment_events(transaction_id,code,amount,outcome) values(p_transaction,p_code,p_amount,'received') on conflict do nothing;
 if not found then return jsonb_build_object('duplicate',true); end if;
 select * into p from payments where code=p_code for update;
 if not found or p.status<>'pending' or p.amount<>p_amount then
  update payment_events set outcome='needs_review' where transaction_id=p_transaction;
  insert into audit_logs(action,target) values('payment_needs_review',p_code); return jsonb_build_object('review',true);
 end if;
 if p.order_id is not null then
  select * into o from orders where id=p.order_id for update;
  if o.status<>'pending' then raise exception 'Trạng thái đơn không hợp lệ'; end if;
  update orders set status=case when exists(select 1 from order_items where order_id=o.id and delivery='manual') then 'processing' else 'completed' end where id=o.id;
 else
  update profiles set balance=balance+p_amount where id=p.user_id;
  insert into wallet_ledger(user_id,amount,description) values(p.user_id,p_amount,'Nạp ví '||p_code);
 end if;
 update payments set status='paid',transaction_id=p_transaction where id=p.id;
 update payment_events set outcome='paid' where transaction_id=p_transaction; return jsonb_build_object('paid',true);
end $$;
create function public.cancel_order(p_user uuid,p_order uuid) returns void language plpgsql set search_path=public as $$ declare o orders; p payments; begin
 -- Lock payment first, same order as settlement/expiry, to prevent deadlocks.
 select * into p from payments where order_id=p_order for update;
 select * into o from orders where id=p_order and user_id=p_user for update;
 if not found or o.status<>'pending' then raise exception 'Chỉ hủy đơn chưa thanh toán của bạn'; end if;
 perform release_order(o.id); update orders set status='cancelled' where id=o.id; update payments set status='cancelled' where id=p.id;
end $$;
create function public.refund_order(p_order uuid) returns void language plpgsql set search_path=public as $$ declare o orders; uid uuid; begin
 select user_id into uid from orders where id=p_order; perform 1 from profiles where id=uid for update;
 select * into o from orders where id=p_order for update;
 if not found or o.status not in ('completed','processing') then raise exception 'Đơn không thể hoàn tiền'; end if;
 update profiles set balance=balance+o.total where id=o.user_id;
 insert into wallet_ledger(user_id,amount,description) values(o.user_id,o.total,'Hoàn tiền '||o.number); update orders set status='refunded' where id=o.id;
 -- Delivered codes never return to sale stock.
end $$;
create function public.import_keys(p_variant uuid,p_keys jsonb) returns void language plpgsql set search_path=public as $$ declare v variants; k jsonb; begin
 select * into v from variants where id=p_variant for update; if not found or v.delivery<>'key' then raise exception 'Gói không giao mã'; end if;
 for k in select value from jsonb_array_elements(p_keys) loop insert into inventory(variant_id,secret,secret_hash) values(p_variant,k->>'secret',k->>'hash'); end loop;
 update variants set stock=stock+jsonb_array_length(p_keys) where id=p_variant;
end $$;
create function public.fulfill_order(p_order uuid,p_results jsonb) returns void language plpgsql set search_path=public as $$ declare o orders; i record; n integer:=0; k jsonb; begin
 select * into o from orders where id=p_order for update; if not found or o.status<>'processing' then raise exception 'Đơn không chờ xử lý'; end if;
 if jsonb_array_length(p_results)<>(select coalesce(sum(quantity),0) from order_items where order_id=p_order and delivery='manual') then raise exception 'Cần một kết quả mỗi đơn vị dịch vụ'; end if;
 for i in select * from order_items where order_id=p_order and delivery='manual' order by id loop for j in 1..i.quantity loop
 k:=p_results->n; insert into inventory(variant_id,secret,secret_hash,order_id,item_id) values(i.variant_id,k->>'secret',k->>'hash',o.id,i.id); n:=n+1;
 end loop; end loop; update orders set status='completed' where id=o.id;
end $$;
create function public.save_variant(p_product uuid,p_data jsonb) returns uuid language plpgsql set search_path=public as $$ declare v variants; vid uuid; begin
 if p_data->>'id' is not null then
  select * into v from variants where id=(p_data->>'id')::uuid and product_id=p_product for update;
  if not found then raise exception 'Không tìm thấy gói'; end if;
  if v.delivery<>p_data->>'delivery' then raise exception 'Không đổi kiểu giao của gói'; end if;
  update variants set name=p_data->>'name',price=(p_data->>'price')::bigint,original_price=(p_data->>'original_price')::bigint,region=p_data->>'region',stock=case when v.delivery='key' then v.stock else (p_data->>'stock')::integer end where id=v.id; return v.id;
 end if;
 insert into variants(product_id,name,price,original_price,delivery,region,stock) values(p_product,p_data->>'name',(p_data->>'price')::bigint,(p_data->>'original_price')::bigint,p_data->>'delivery',p_data->>'region',case when p_data->>'delivery'='key' then 0 else (p_data->>'stock')::integer end) returning id into vid;return vid;
end $$;

-- Explicit grants + RLS. Browser cannot edit money, roles, inventory or orders.
do $$ declare t text; begin for t in select tablename from pg_tables where schemaname='public' and tablename in ('profiles','products','variants','coupons','orders','order_items','inventory','payments','wallet_ledger','payment_events','tickets','reviews','audit_logs') loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;
grant select on products,variants,reviews to anon,authenticated;
grant select on profiles,orders,order_items,payments,wallet_ledger,tickets to authenticated;
create policy products_public on products for select using(active);
create policy variants_public on variants for select using(exists(select 1 from products where products.id=variants.product_id and active));
create policy reviews_public on reviews for select using(true);
create policy profile_owner on profiles for select to authenticated using(id=auth.uid());
create policy orders_owner on orders for select to authenticated using(user_id=auth.uid());
create policy items_owner on order_items for select to authenticated using(exists(select 1 from orders where orders.id=order_items.order_id and user_id=auth.uid()));
create policy payments_owner on payments for select to authenticated using(user_id=auth.uid());
create policy ledger_owner on wallet_ledger for select to authenticated using(user_id=auth.uid());
create policy tickets_owner on tickets for select to authenticated using(user_id=auth.uid());
revoke all on function public.handle_user() from public,anon,authenticated;
revoke all on function public.release_order(uuid),public.expire_payments(),public.create_order(uuid,jsonb,uuid),public.settle_payment(text,text,bigint),public.cancel_order(uuid,uuid),public.refund_order(uuid),public.import_keys(uuid,jsonb),public.fulfill_order(uuid,jsonb),public.save_variant(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.release_order(uuid),public.expire_payments(),public.create_order(uuid,jsonb,uuid),public.settle_payment(text,text,bigint),public.cancel_order(uuid,uuid),public.refund_order(uuid),public.import_keys(uuid,jsonb),public.fulfill_order(uuid,jsonb),public.save_variant(uuid,jsonb) to service_role;
-- KEYNEST STEP 001_store END

-- KEYNEST STEP 002_reconciliation BEGIN
alter table public.payment_events add column credited_user_id uuid references public.profiles(id);
alter table public.payment_events add column credited_at timestamptz;
alter table public.payment_events add column reason text;
create function public.credit_reviewed_payment(p_transaction text,p_user uuid,p_reason text,p_admin uuid) returns void language plpgsql set search_path=public as $$ declare e payment_events; begin
 if not exists(select 1 from profiles where id=p_admin and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 if length(trim(p_reason))<10 then raise exception 'Cần lý do đối soát'; end if;
 perform 1 from profiles where id=p_user for update; if not found then raise exception 'Không tìm thấy khách hàng'; end if;
 select * into e from payment_events where transaction_id=p_transaction for update;
 if not found or e.outcome<>'needs_review' then raise exception 'Giao dịch không chờ đối soát hoặc đã xử lý'; end if;
 update profiles set balance=balance+e.amount where id=p_user;
 insert into wallet_ledger(user_id,amount,description) values(p_user,e.amount,'Đối soát giao dịch '||p_transaction);
 update payment_events set outcome='credited',credited_user_id=p_user,credited_at=now(),reason=p_reason where transaction_id=p_transaction;
 insert into audit_logs(user_id,action,target) values(p_admin,'credit_reviewed_payment',p_transaction);
end $$;
revoke all on function public.credit_reviewed_payment(text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.credit_reviewed_payment(text,uuid,text,uuid) to service_role;
-- KEYNEST STEP 002_reconciliation END

-- KEYNEST STEP 003_storefront BEGIN
-- Storefront content; customers can read published banners, only the backend can write.
alter table public.products add column if not exists subcategory text not null default '' check (char_length(subcategory) <= 60);
update public.products set subcategory = case slug
  when 'elden-ring' then 'Hành động & nhập vai'
  when 'black-myth-wukong' then 'Hành động & nhập vai'
  when 'cyberpunk-2077' then 'Thế giới mở'
  when 'red-dead-redemption-2' then 'Thế giới mở'
  when 'hollow-knight' then 'Indie & phiêu lưu'
  when 'stardew-valley' then 'Mô phỏng & thư giãn'
  when 'steam-wallet' then 'Steam Wallet'
  when 'xbox-gift-card' then 'Xbox Gift Card'
  when 'valorant' then 'Valorant'
  when 'genshin-impact' then 'Genshin Impact'
  when 'residential-proxy' then 'Proxy dân cư'
  when 'private-proxy' then 'Proxy IPv4 riêng'
  else platform end where subcategory = '';
create index if not exists products_category_subcategory_idx on public.products(category, subcategory);
create table public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 100),
  eyebrow text not null default '' check (char_length(eyebrow) <= 60),
  description text not null default '' check (char_length(description) <= 240),
  image text not null check (image ~ '^https://shared[.]fastly[.]steamstatic[.]com/[a-zA-Z0-9_./-]+$'),
  href text not null check (href ~ '^/(products/[a-z0-9-]+|catalog([?][^[:space:]\\#]*)?|promotions|guide|wallet|support)$'),
  cta text not null check (char_length(cta) between 2 and 40),
  active boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 999)
);
alter table public.banners enable row level security;
revoke all on public.banners from anon, authenticated;
grant select on public.banners to anon, authenticated;
grant all on public.banners to service_role;
create policy banners_published on public.banners for select to anon, authenticated using (active = true);
insert into public.banners(title,eyebrow,description,image,href,cta,active,sort_order) values
('Bước vào Lands Between','ELDEN RING / STEAM','Chọn phiên bản, kiểm tra khu vực và bắt đầu hành trình của bạn.','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/library_hero.jpg','/products/elden-ring','Khám phá Elden Ring',true,0),
('Viết tiếp truyền thuyết','BLACK MYTH: WUKONG','Một hành trình hành động nhập vai lấy cảm hứng từ Tây Du Ký.','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2358720/library_hero.jpg','/products/black-myth-wukong','Xem các phiên bản',true,1),
('Night City đang chờ','CYBERPUNK 2077 / PC','Khám phá thế giới mở của Cyberpunk 2077 trên tài khoản Steam của bạn.','https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/library_hero.jpg','/products/cyberpunk-2077','Xem game',true,2);
-- KEYNEST STEP 003_storefront END

-- KEYNEST STEP 004_product_feedback BEGIN
-- Public discussion is separate from purchase-verified ratings.
create table public.product_comments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  name text not null,
  body text not null check (char_length(btrim(body)) between 3 and 1000),
  created_at timestamptz not null default now()
);
create index product_comments_product_created on public.product_comments(product_id, created_at desc, id desc);
create index reviews_product_created on public.reviews(product_id, created_at desc, id desc);
alter table public.product_comments enable row level security;
revoke all on public.product_comments from anon, authenticated;
grant select on public.product_comments to anon, authenticated;
grant all on public.product_comments to service_role;
create policy comments_public on public.product_comments for select
  using (exists(select 1 from public.products p where p.id = product_id and p.active));

-- Backend-only aggregate: customer mutations never supply rating totals.
create view public.product_review_stats as
select product_id, count(*)::integer as review_count,
  round(avg(rating)::numeric, 1) as rating_average,
  jsonb_build_array(
    count(*) filter(where rating=1), count(*) filter(where rating=2),
    count(*) filter(where rating=3), count(*) filter(where rating=4),
    count(*) filter(where rating=5)
  ) as rating_counts
from public.reviews group by product_id;
revoke all on public.product_review_stats from public, anon, authenticated;
grant select on public.product_review_stats to service_role;
-- KEYNEST STEP 004_product_feedback END

-- KEYNEST STEP 005_order_warranty BEGIN
alter table public.variants add column warranty_days integer not null default 30 check(warranty_days between 0 and 3650);
alter table public.orders add column paid_at timestamptz, add column completed_at timestamptz;
-- Historic orders retain NULL: their delivery time / purchase-time policy is unknown.
alter table public.order_items add column warranty_days integer check(warranty_days between 0 and 3650),
  add column delivered_at timestamptz, add column product_image text not null default '', add column product_slug text not null default '';
alter table public.tickets add column kind text not null default 'support' check(kind in ('support','warranty')),
  add column order_id uuid references public.orders(id), add column warranty_key_ids uuid[] not null default '{}';
create unique index one_open_warranty_per_order on public.tickets(order_id) where kind='warranty' and status='open';

create function public.stamp_order_times() returns trigger language plpgsql set search_path=public as $$ begin
 if new.status in ('processing','completed') then
  if tg_op='INSERT' then new.paid_at:=coalesce(new.paid_at,now());
  elsif old.status='pending' then new.paid_at:=coalesce(new.paid_at,now()); end if;
 end if;
 if new.status='completed' then new.completed_at:=coalesce(new.completed_at,now()); end if;
 return new;
end $$;
create trigger order_times before insert or update of status on public.orders for each row execute function public.stamp_order_times();
create function public.snapshot_order_item() returns trigger language plpgsql set search_path=public as $$ declare v variants; p products; o orders; begin
 select * into v from variants where id=new.variant_id;
 select * into p from products where id=new.product_id;
 select * into o from orders where id=new.order_id;
 new.warranty_days:=v.warranty_days; new.product_image:=p.image; new.product_slug:=p.slug;
 if o.status='completed' or (o.status='processing' and new.delivery='key') then new.delivered_at:=coalesce(o.paid_at,now()); end if;
 return new;
end $$;
create trigger order_item_snapshot before insert on public.order_items for each row execute function public.snapshot_order_item();
create function public.stamp_item_delivery() returns trigger language plpgsql set search_path=public as $$ begin
 if new.status in ('processing','completed') then
  update order_items set delivered_at=coalesce(delivered_at,now()) where order_id=new.id and (new.status='completed' or delivery='key');
 end if;
 return new;
end $$;
create trigger item_delivery after update of status on public.orders for each row when(old.status is distinct from new.status) execute function public.stamp_item_delivery();

alter function public.save_variant(uuid,jsonb) rename to save_variant_core;
create function public.save_variant(p_product uuid,p_data jsonb) returns uuid language plpgsql set search_path=public as $$ declare vid uuid; begin
 vid:=save_variant_core(p_product,p_data);
 if p_data ? 'warranty_days' then update variants set warranty_days=(p_data->>'warranty_days')::integer where id=vid; end if;
 return vid;
end $$;

create function public.create_warranty(p_user uuid,p_order uuid,p_keys uuid[],p_message text) returns uuid language plpgsql set search_path=public as $$
declare o orders; k uuid; i order_items; tid uuid; begin
 select * into o from orders where id=p_order and user_id=p_user for update;
 if not found then raise exception 'Không tìm thấy đơn hàng'; end if;
 if o.status not in ('processing','completed') then raise exception 'Chỉ gửi bảo hành cho sản phẩm đã nhận, chưa hoàn tiền'; end if;
 if cardinality(p_keys) is null or cardinality(p_keys) not between 1 and 200 or cardinality(p_keys)<>(select count(distinct x) from unnest(p_keys) x) then raise exception 'Chọn sản phẩm bảo hành hợp lệ'; end if;
 if char_length(btrim(p_message)) not between 10 and 3000 then raise exception 'Mô tả cần từ 10 đến 3000 ký tự'; end if;
 if exists(select 1 from tickets where order_id=o.id and kind='warranty' and status='open') then raise exception 'Đơn này đã có yêu cầu bảo hành đang xử lý'; end if;
 foreach k in array p_keys loop
  select oi.* into i from order_items oi join inventory inv on inv.item_id=oi.id where inv.id=k and inv.order_id=o.id and oi.order_id=o.id;
  if not found or (i.delivery='manual' and o.status<>'completed') then raise exception 'Sản phẩm chưa được giao hoặc không thuộc đơn này'; end if;
  if i.warranty_days=0 then raise exception 'Gói sản phẩm không áp dụng bảo hành theo ngày'; end if;
  if i.warranty_days is not null and i.delivered_at is not null and now()>=i.delivered_at+make_interval(days=>i.warranty_days) then raise exception 'Sản phẩm đã hết thời hạn bảo hành'; end if;
 end loop;
 insert into tickets(user_id,subject,message,kind,order_id,warranty_key_ids)
 values(p_user,'Bảo hành đơn '||o.number,btrim(p_message),'warranty',o.id,p_keys) returning id into tid;
 return tid;
end $$;
revoke all on function public.stamp_order_times(),public.snapshot_order_item(),public.stamp_item_delivery(),public.save_variant(uuid,jsonb),public.create_warranty(uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.save_variant(uuid,jsonb),public.create_warranty(uuid,uuid,uuid[],text) to service_role;
-- KEYNEST STEP 005_order_warranty END

-- KEYNEST STEP 006_admin_operations BEGIN
-- Uploaded images are public storefront content, served by Node after sanitizing.
-- Browser roles cannot upload directly to this private bucket.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('store-assets','store-assets',false,8388608,array['image/webp'])
  on conflict(id) do nothing;
 end if;
end $$;

alter table tickets add column priority text not null default 'normal' check(priority in ('low','normal','high')),
 add column updated_at timestamptz,
 add constraint ticket_status check(status in ('open','in_progress','closed'));
update tickets set updated_at=created_at;
alter table tickets alter column updated_at set default now(), alter column updated_at set not null;
drop index one_open_warranty_per_order;
create unique index one_open_warranty_per_order on tickets(order_id) where kind='warranty' and status in ('open','in_progress');
create table ticket_messages(
 id uuid primary key default gen_random_uuid(),ticket_id uuid not null references tickets(id),
 author_id uuid references profiles(id),role text not null check(role in ('admin','customer')),
 body text not null check(char_length(btrim(body)) between 3 and 3000),created_at timestamptz default now()
);
insert into ticket_messages(ticket_id,role,body,created_at) select id,'admin',reply,null from tickets where char_length(btrim(reply))>=3;
alter table ticket_messages enable row level security;
revoke all on ticket_messages from public,anon,authenticated;
grant all on ticket_messages to service_role;
grant select on ticket_messages to authenticated;
create policy ticket_messages_owner on ticket_messages for select to authenticated using(exists(select 1 from tickets where tickets.id=ticket_id and tickets.user_id=auth.uid()));
create index on ticket_messages(ticket_id,created_at);

create function add_ticket_message(p_actor uuid,p_ticket uuid,p_body text,p_status text default 'closed',p_priority text default 'normal') returns void language plpgsql set search_path=public as $$
declare t tickets; actor profiles; begin
 select * into actor from profiles where id=p_actor;
 select * into t from tickets where id=p_ticket for update;
 if not found or (actor.role<>'admin' and t.user_id<>p_actor) or actor.id is null then raise exception 'Không tìm thấy yêu cầu hỗ trợ'; end if;
 if actor.role<>'admin' then p_status:='open'; p_priority:=t.priority; end if;
 if p_status not in ('open','in_progress','closed') or p_priority not in ('low','normal','high') then raise exception 'Trạng thái không hợp lệ'; end if;
 if t.kind='warranty' and p_status<>'closed' and exists(select 1 from tickets where order_id=t.order_id and id<>t.id and kind='warranty' and status in ('open','in_progress')) then raise exception 'Đơn này có yêu cầu bảo hành khác đang mở. Vui lòng tiếp tục trong yêu cầu đó'; end if;
 insert into ticket_messages(ticket_id,author_id,role,body) values(t.id,actor.id,actor.role,btrim(p_body));
 update tickets set status=p_status,priority=p_priority,updated_at=now(),reply=case when actor.role='admin' then btrim(p_body) else reply end where id=t.id;
end $$;
revoke all on function add_ticket_message(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function add_ticket_message(uuid,uuid,text,text,text) to service_role;

alter table orders add column refunded_at timestamptz,
 add column refund_method text check(refund_method in ('wallet','external')),
 add column refund_reference text not null default '', add column refund_reason text not null default '',
 add column refund_ticket_id uuid references tickets(id),add column refunded_by uuid references profiles(id);
update orders set refund_method='wallet' where status='refunded';
create function resolve_warranty_refund(p_order uuid,p_ticket uuid,p_actor uuid,p_method text,p_reason text,p_reference text) returns void language plpgsql set search_path=public as $$
declare o orders; t tickets; uid uuid; reply_text text; begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Cần quyền quản trị'; end if;
 if p_method is null or p_reason is null or p_method not in ('wallet','external') or char_length(btrim(p_reason)) not between 10 and 2000 or (p_method='external' and char_length(btrim(p_reference)) not between 3 and 200) then raise exception 'Nhập phương thức, lý do và mã giao dịch hoàn tiền hợp lệ'; end if;
 select user_id into uid from orders where id=p_order;
 perform 1 from profiles where id=uid for update;
 select * into o from orders where id=p_order for update;
 if not found or o.status not in ('processing','completed') then raise exception 'Đơn không thể hoàn tiền hoặc đã hoàn trước đó'; end if;
 select * into t from tickets where id=p_ticket and order_id=o.id and user_id=o.user_id and kind='warranty' for update;
 if not found then raise exception 'Hoàn tiền cần gắn với yêu cầu bảo hành của đơn'; end if;
 if p_method='wallet' then
  update profiles set balance=balance+o.total where id=o.user_id;
  insert into wallet_ledger(user_id,amount,description) values(o.user_id,o.total,'Hoàn tiền '||o.number);
 end if;
 update orders set status='refunded',refunded_at=now(),refund_method=p_method,refund_reference=coalesce(p_reference,''),refund_reason=btrim(p_reason),refund_ticket_id=t.id,refunded_by=p_actor where id=o.id;
 reply_text:=case when p_method='wallet' then 'Đã hoàn toàn bộ tiền vào ví KEYNEST. ' else 'Đã xác nhận hoàn tiền bên ngoài. Mã giao dịch: '||p_reference||'. ' end||btrim(p_reason);
 insert into ticket_messages(ticket_id,author_id,role,body) values(t.id,p_actor,'admin',reply_text);
 update tickets set status='closed',reply=reply_text,updated_at=now() where id=t.id;
 insert into audit_logs(user_id,action,target) values(p_actor,'refund_'||p_method,o.id::text);
end $$;
revoke all on function refund_order(uuid) from service_role;
revoke all on function resolve_warranty_refund(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function resolve_warranty_refund(uuid,uuid,uuid,text,text,text) to service_role;

alter table coupons add column discount_type text not null default 'percent' check(discount_type in ('percent','fixed')),
 add column fixed_amount bigint not null default 0 check(fixed_amount between 0 and 100000000),
 add column min_subtotal bigint not null default 0 check(min_subtotal between 0 and 100000000),
 add column total_limit integer check(total_limit between 1 and 1000000),
 add column per_user_limit integer check(per_user_limit between 1 and 1000000),
 add column starts_at timestamptz,
 add column product_ids uuid[] not null default '{}',
 add column category text not null default 'all' check(category in ('all','game','gift','topup','mmo')),
 add column first_order_only boolean not null default false,
 add constraint coupon_dates check(starts_at is null or expires_at is null or starts_at<expires_at),
 add constraint coupon_fixed_amount check(discount_type<>'fixed' or fixed_amount>0);
create index orders_coupon_usage on orders(coupon,user_id) where status in ('pending','processing','completed','refunded');
create view coupon_usage_stats as select c.code,
 count(o.id) filter(where o.status in ('processing','completed','refunded'))::integer as used_count,
 count(o.id) filter(where o.status='pending')::integer as reserved_count
 from coupons c left join orders o on o.coupon=c.code group by c.code;
revoke all on coupon_usage_stats from public,anon,authenticated;
grant select on coupon_usage_stats to service_role;

create function quote_coupon(p_user uuid,p_code text,p_items jsonb) returns jsonb language plpgsql set search_path=public as $$
declare c coupons; sub bigint; eligible bigint; disc bigint; used integer; own_used integer; begin
 select * into c from coupons where code=p_code and active and (starts_at is null or starts_at<=now()) and (expires_at is null or expires_at>now());
 if not found then raise exception 'Mã giảm giá chưa có hiệu lực hoặc đã hết hạn'; end if;
 select count(*),count(*) filter(where user_id=p_user) into used,own_used from orders where coupon=c.code and status in ('pending','processing','completed','refunded');
 if c.total_limit is not null and used>=c.total_limit then raise exception 'Mã giảm giá đã hết lượt sử dụng'; end if;
 if c.per_user_limit is not null and own_used>=c.per_user_limit then raise exception 'Bạn đã dùng hết lượt của mã giảm giá này'; end if;
 if c.first_order_only and exists(select 1 from orders where user_id=p_user and status in ('pending','processing','completed','refunded')) then raise exception 'Mã chỉ dành cho đơn hàng đầu tiên'; end if;
 if jsonb_array_length(p_items)<>(select count(*) from jsonb_array_elements(p_items) l join variants v on v.id=(l->>'variant_id')::uuid join products p on p.id=v.product_id and p.active) then raise exception 'Sản phẩm không còn bán'; end if;
 select sum(v.price*(l->>'quantity')::integer),coalesce(sum(v.price*(l->>'quantity')::integer) filter(where (c.category='all' or p.category=c.category) and (cardinality(c.product_ids)=0 or p.id=any(c.product_ids))),0)
 into sub,eligible from jsonb_array_elements(p_items) l join variants v on v.id=(l->>'variant_id')::uuid join products p on p.id=v.product_id and p.active;
 if sub<c.min_subtotal then raise exception 'Đơn hàng chưa đạt giá trị tối thiểu để dùng mã'; end if;
 if eligible<=0 then raise exception 'Mã không áp dụng cho sản phẩm trong giỏ hàng'; end if;
 disc:=least(eligible,greatest(sub-1000,0),case when c.discount_type='fixed' then c.fixed_amount else least(eligible*c.percent/100,c.max_discount) end);
 if disc<=0 then raise exception 'Giá trị đơn chưa đủ để áp dụng mã giảm giá'; end if;
 return jsonb_build_object('code',c.code,'subtotal',sub,'discount',disc,'total',sub-disc);
end $$;
revoke all on function quote_coupon(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function quote_coupon(uuid,text,jsonb) to service_role;


create or replace function public.create_order(p_user uuid,p_payload jsonb,p_idempotency uuid) returns uuid language plpgsql set search_path=public as $$
declare u profiles; o orders; v variants; pr products; line jsonb; c coupons; sub bigint:=0; disc bigint:=0; oid uuid; iid uuid; inv uuid; n integer; method text:=p_payload->>'method'; has_manual boolean:=false;
begin
 perform expire_payments(); select * into u from profiles where id=p_user for update; if not found then raise exception 'Tài khoản không tồn tại'; end if;
 select * into o from orders where user_id=p_user and idempotency=p_idempotency;
 if found then if o.fingerprint<>p_payload then raise exception 'Mã yêu cầu đã dùng cho giỏ hàng khác'; end if; return o.id; end if;
 if method not in ('wallet','sepay') or jsonb_array_length(p_payload->'items') not between 1 and 20 then raise exception 'Giỏ hàng không hợp lệ'; end if;
 for line in select value from jsonb_array_elements(p_payload->'items') order by value->>'variant_id' loop
  select * into v from variants where id=(line->>'variant_id')::uuid for update;
  if not found then raise exception 'Không tìm thấy gói'; end if;
  select * into pr from products where id=v.product_id and active;
  n:=(line->>'quantity')::integer; if not found or n not between 1 and 10 or v.stock<n then raise exception 'Không đủ tồn kho'; end if;
  if v.delivery='manual' then has_manual:=true; if length(trim(p_payload->>'customer_note'))=0 then raise exception 'Cần UID hoặc thông tin dịch vụ'; end if; end if;
  sub:=sub+v.price*n;
 end loop;
 if coalesce(p_payload->>'coupon','')<>'' then
  perform 1 from coupons where code=p_payload->>'coupon' for update;
  disc:=(quote_coupon(p_user,p_payload->>'coupon',p_payload->'items')->>'discount')::bigint;
 end if;
 if method='wallet' and u.balance<sub-disc then raise exception 'Số dư ví không đủ'; end if;
 insert into orders(user_id,subtotal,discount,total,method,status,customer_note,coupon,idempotency,fingerprint) values(p_user,sub,disc,sub-disc,method,case when method='sepay' then 'pending' when has_manual then 'processing' else 'completed' end,coalesce(p_payload->>'customer_note',''),coalesce(p_payload->>'coupon',''),p_idempotency,p_payload) returning id into oid;
 for line in select value from jsonb_array_elements(p_payload->'items') order by value->>'variant_id' loop
  select * into v from variants where id=(line->>'variant_id')::uuid; select * into pr from products where id=v.product_id; n:=(line->>'quantity')::integer;
  insert into order_items(order_id,variant_id,product_id,name,variant_name,price,quantity,delivery) values(oid,v.id,pr.id,pr.name,v.name,v.price,n,v.delivery) returning id into iid;
  update variants set stock=stock-n where id=v.id;
  if v.delivery='key' then for j in 1..n loop
   select id into inv from inventory where variant_id=v.id and order_id is null order by id limit 1 for update skip locked;
   if inv is null then raise exception 'Kho mã không đủ'; end if;
   update inventory set order_id=oid,item_id=iid where id=inv;
  end loop; end if;
 end loop;
 if method='wallet' then update profiles set balance=balance-(sub-disc) where id=p_user; insert into wallet_ledger(user_id,amount,description) values(p_user,-(sub-disc),'Thanh toán '||(select number from orders where id=oid));
 else insert into payments(user_id,order_id,amount) values(p_user,oid,sub-disc); end if;
 return oid;
end $$;


create or replace function public.create_warranty(p_user uuid,p_order uuid,p_keys uuid[],p_message text) returns uuid language plpgsql set search_path=public as $$
declare o orders; k uuid; i order_items; tid uuid; begin
 select * into o from orders where id=p_order and user_id=p_user for update;
 if not found then raise exception 'Không tìm thấy đơn hàng'; end if;
 if o.status not in ('processing','completed') then raise exception 'Chỉ gửi bảo hành cho sản phẩm đã nhận, chưa hoàn tiền'; end if;
 if cardinality(p_keys) is null or cardinality(p_keys) not between 1 and 200 or cardinality(p_keys)<>(select count(distinct x) from unnest(p_keys) x) then raise exception 'Chọn sản phẩm bảo hành hợp lệ'; end if;
 if char_length(btrim(p_message)) not between 10 and 3000 then raise exception 'Mô tả cần từ 10 đến 3000 ký tự'; end if;
 if exists(select 1 from tickets where order_id=o.id and kind='warranty' and status in ('open','in_progress')) then raise exception 'Đơn này đã có yêu cầu bảo hành đang xử lý'; end if;
 foreach k in array p_keys loop
  select oi.* into i from order_items oi join inventory inv on inv.item_id=oi.id where inv.id=k and inv.order_id=o.id and oi.order_id=o.id;
  if not found or (i.delivery='manual' and o.status<>'completed') then raise exception 'Sản phẩm chưa được giao hoặc không thuộc đơn này'; end if;
  if i.warranty_days=0 then raise exception 'Gói sản phẩm không áp dụng bảo hành theo ngày'; end if;
  if i.warranty_days is not null and i.delivered_at is not null and now()>=i.delivered_at+make_interval(days=>i.warranty_days) then raise exception 'Sản phẩm đã hết thời hạn bảo hành'; end if;
 end loop;
 insert into tickets(user_id,subject,message,kind,order_id,warranty_key_ids)
 values(p_user,'Bảo hành đơn '||o.number,btrim(p_message),'warranty',o.id,p_keys) returning id into tid;
 return tid;
end $$;
-- KEYNEST STEP 006_admin_operations END

-- KEYNEST STEP 007_catalog_backend BEGIN
-- Service-only catalog search. No inventory secrets or customer data are exposed.
create function public.catalog_normalize(value text) returns text
language sql immutable strict set search_path=public as $$
  select btrim(lower(replace(replace(
    regexp_replace(normalize(value, NFD), '[' || chr(768) || '-' || chr(879) || ']', '', 'g'),
    'đ', 'd'), 'Đ', 'd')))
$$;

create function public.catalog_search(p_filters jsonb) returns jsonb
language plpgsql stable set search_path=public as $$
declare
  per_page integer := coalesce((p_filters->>'page_size')::integer,12);
  requested_page integer := coalesce((p_filters->>'page')::integer,1);
  category_filter text := coalesce(p_filters->>'category','all');
  sort_mode text := coalesce(p_filters->>'sort','featured');
  result jsonb;
begin
  if per_page not between 1 and 48 or requested_page not between 1 and 10000
    or category_filter not in ('all','game','gift','topup','mmo')
    or sort_mode not in ('featured','asc','desc','name') then
    raise exception 'Bộ lọc không hợp lệ';
  end if;
  with active as materialized (
    select p.*, coalesce(nullif(p.subcategory,''),nullif(p.platform,''),'Khác') as group_name
    from products p where p.active
  ), scoped as materialized (
    select * from active where category_filter='all' or category=category_filter
  ), filtered as (
    select p.*, (select min(v.price) from variants v where v.product_id=p.id) as min_price
    from scoped p
    where position(catalog_normalize(coalesce(p_filters->>'q','')) in
      catalog_normalize(p.name || ' ' || p.platform || ' ' || p.description || ' ' || p.group_name))>0
      and (coalesce(p_filters->>'sub','')='' or p.group_name=p_filters->>'sub')
      and (coalesce(p_filters->>'platform','')='' or p.platform=p_filters->>'platform')
      and exists(select 1 from variants v where v.product_id=p.id
        and v.price >= coalesce((p_filters->>'min')::bigint,0)
        and v.price <= coalesce((p_filters->>'max')::bigint,100000000)
        and (coalesce(p_filters->>'stock','0')<>'1' or v.stock>0)
        and (coalesce(p_filters->>'sale','0')<>'1' or v.original_price>v.price)
        and (coalesce(p_filters->>'delivery','')='' or v.delivery=p_filters->>'delivery')
        and (coalesce(p_filters->>'region','')='' or v.region=p_filters->>'region'))
  ), ranked as materialized (
    select *,row_number() over(order by
      case when sort_mode='asc' then min_price end asc,
      case when sort_mode='desc' then min_price end desc,
      case when sort_mode='name' then name end asc,
      case when sort_mode='featured' then featured end desc,
      case when sort_mode='featured' then sort_order end asc,id asc) as rank
    from filtered
  ), totals as (
    select count(*)::integer as total, greatest(1,ceil(count(*)::numeric/per_page)::integer) as pages from ranked
  ), pagination as (
    select *,least(requested_page,pages) as page from totals
  ), selected as (
    select r.* from ranked r cross join pagination pg
    where r.rank > (pg.page-1)*per_page and r.rank <= pg.page*per_page
  ), items as (
    select (to_jsonb(p)-'group_name'-'min_price'-'rank') || jsonb_build_object(
      'variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.price,v.id) from variants v where v.product_id=p.id),'[]'::jsonb),
      'review_count',coalesce(s.review_count,0),
      'rating_average',coalesce(s.rating_average,0),
      'rating_counts',coalesce(s.rating_counts,'[0,0,0,0,0]'::jsonb)) as item,p.rank
    from selected p left join product_review_stats s on s.product_id=p.id
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(item order by rank) from items),'[]'::jsonb),
    'total',pg.total,'page',pg.page,'page_size',per_page,'pages',pg.pages,
    'facets',jsonb_build_object(
      'groups',coalesce((select jsonb_agg(g order by g) from (select distinct group_name g from scoped) x),'[]'::jsonb),
      'platforms',coalesce((select jsonb_agg(g order by g) from (select distinct platform g from scoped) x),'[]'::jsonb),
      'regions',coalesce((select jsonb_agg(g order by g) from (select distinct v.region g from variants v join scoped s on s.id=v.product_id) x),'[]'::jsonb),
      'categories',(select jsonb_object_agg(c,(select count(*) from active where c='all' or category=c))
        from unnest(array['all','game','gift','topup','mmo']) c))) into result from pagination pg;
  return result;
end $$;
revoke all on function public.catalog_normalize(text),public.catalog_search(jsonb) from public,anon,authenticated;
grant execute on function public.catalog_normalize(text),public.catalog_search(jsonb) to service_role;
-- KEYNEST STEP 007_catalog_backend END

-- KEYNEST STEP 008_operations BEGIN
-- Server-owned account controls, session revocation and customer notifications.
create table account_controls (
 user_id uuid primary key references profiles(id), suspended boolean not null default false,
 reason text not null default '', updated_at timestamptz not null default now()
);
create table app_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id),
 token_hash text not null unique, user_agent text not null default '',
 created_at timestamptz not null default now(), revoked_at timestamptz
);
create index on app_sessions(user_id,created_at desc);
create table notifications (
 id text primary key, user_id uuid not null references profiles(id),
 title text not null, href text not null, created_at timestamptz not null default now(), read_at timestamptz
);
create index on notifications(user_id,created_at desc);
alter table account_controls enable row level security;
alter table app_sessions enable row level security;
alter table notifications enable row level security;
revoke all on account_controls,app_sessions,notifications from public,anon,authenticated;
grant all on account_controls,app_sessions,notifications to service_role;

create function notify_store_event() returns trigger language plpgsql set search_path=public as $$
declare uid uuid;
begin
 if TG_TABLE_NAME='orders' then
  if TG_OP='UPDATE' then if new.status=old.status then return new; end if; end if;
  insert into notifications(id,user_id,title,href)
   values('order:'||new.id||':'||new.status,new.user_id,'Đơn '||new.number||': '||new.status,'/orders/'||new.id) on conflict do nothing;
 elsif TG_TABLE_NAME='ticket_messages' then
  if new.role='admin' then
   select user_id into uid from tickets where id=new.ticket_id;
   insert into notifications(id,user_id,title,href)
    values('reply:'||new.id,uid,'Có phản hồi mới cho yêu cầu hỗ trợ','/support') on conflict do nothing;
  end if;
 elsif TG_TABLE_NAME='payments' then
  if new.status='paid' and new.order_id is null and old.status is distinct from new.status then
   insert into notifications(id,user_id,title,href)
    values('topup:'||new.id,new.user_id,'Nạp ví thành công: '||new.amount||' VND','/wallet') on conflict do nothing;
  end if;
 end if;
 return new;
end $$;
create trigger order_notification after insert or update on orders for each row execute function notify_store_event();
create trigger ticket_notification after insert on ticket_messages for each row execute function notify_store_event();
create trigger topup_notification after update on payments for each row execute function notify_store_event();
revoke all on function notify_store_event() from public,anon,authenticated;

create function set_customer_access(p_actor uuid,p_user uuid,p_suspended boolean,p_reason text) returns void
language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 perform 1 from profiles where id=p_user and role='customer' for update;
 if not found then raise exception 'Chỉ thay đổi quyền truy cập của khách hàng'; end if;
 insert into account_controls(user_id,suspended,reason) values(p_user,p_suspended,p_reason)
 on conflict(user_id) do update set suspended=excluded.suspended,reason=excluded.reason,updated_at=now();
 if p_suspended then update app_sessions set revoked_at=now() where user_id=p_user and revoked_at is null; end if;
 insert into audit_logs(user_id,action,target) values(p_actor,'customer_access',p_user||':'||p_suspended||':'||p_reason);
end $$;
revoke all on function set_customer_access(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function set_customer_access(uuid,uuid,boolean,text) to service_role;

create function discard_inventory(p_actor uuid,p_id uuid,p_reason text) returns void
language plpgsql set search_path=public as $$
declare vid uuid; row_inventory inventory;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 select variant_id into vid from inventory where id=p_id;
 if vid is null then raise exception 'Không tìm thấy mã kho'; end if;
 -- Same variant -> inventory lock order as checkout/import.
 perform 1 from variants where id=vid for update;
 select * into row_inventory from inventory where id=p_id for update;
 if not found or row_inventory.order_id is not null then raise exception 'Chỉ loại mã chưa được giữ cho đơn hàng'; end if;
 update variants set stock=stock-1 where id=vid and stock>0;
 if not found then raise exception 'Tồn kho không hợp lệ'; end if;
 delete from inventory where id=p_id;
 insert into audit_logs(user_id,action,target) values(p_actor,'inventory_discard',p_id||':'||p_reason);
end $$;
revoke all on function discard_inventory(uuid,uuid,text) from public,anon,authenticated;
grant execute on function discard_inventory(uuid,uuid,text) to service_role;
-- KEYNEST STEP 008_operations END

-- KEYNEST STEP 009_oauth_avatar BEGIN
alter table public.profiles add column avatar_url text;

-- Provider metadata is user-controlled: accept only HTTPS image CDN URLs.
create function public.oauth_avatar(metadata jsonb) returns text
language sql immutable set search_path=public as $$
 select value from (values (1,metadata->>'avatar_url'),(2,metadata->>'picture')) as candidates(priority,value)
 where length(value) <= 2048
 and value ~ '^https://([a-zA-Z0-9-]+[.]googleusercontent[.]com|cdn[.]discordapp[.]com|media[.]discordapp[.]net)/[^[:space:]]+$'
 order by priority limit 1
$$;
revoke all on function public.oauth_avatar(jsonb) from public,anon,authenticated;
grant execute on function public.oauth_avatar(jsonb) to service_role;

create or replace function public.handle_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,email,name,avatar_url)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'name',''),public.oauth_avatar(new.raw_user_meta_data));
 return new;
end $$;

create function public.sync_oauth_avatar() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 update public.profiles set avatar_url=public.oauth_avatar(new.raw_user_meta_data)
 where id=new.id and avatar_url is distinct from public.oauth_avatar(new.raw_user_meta_data);
 return new;
end $$;
revoke all on function public.sync_oauth_avatar() from public,anon,authenticated;
create trigger sync_user_avatar after update of raw_user_meta_data on auth.users
for each row execute function public.sync_oauth_avatar();

-- Existing OAuth accounts also receive their current provider image.
update public.profiles p set avatar_url=public.oauth_avatar(u.raw_user_meta_data)
from auth.users u where u.id=p.id;
-- KEYNEST STEP 009_oauth_avatar END

-- KEYNEST STEP 010_avatar_upload BEGIN
alter table public.profiles add column avatar_source text not null default 'oauth'
 check (avatar_source in ('oauth','upload'));

-- A user-selected photo must survive subsequent social sign-ins.
create or replace function public.sync_oauth_avatar() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 update public.profiles set avatar_url=public.oauth_avatar(new.raw_user_meta_data)
 where id=new.id and avatar_source='oauth'
 and avatar_url is distinct from public.oauth_avatar(new.raw_user_meta_data);
 return new;
end $$;
-- KEYNEST STEP 010_avatar_upload END

-- KEYNEST STEP 011_admin_notifications BEGIN
alter table public.notifications add column body text not null default '';
create table public.notification_campaigns (
 id uuid primary key, actor uuid not null references public.profiles(id),
 title text not null, body text not null, email text, recipients integer not null default 0,
 created_at timestamptz not null default now()
);
alter table public.notification_campaigns enable row level security;
revoke all on public.notification_campaigns from public,anon,authenticated;
grant all on public.notification_campaigns to service_role;

create function public.send_store_notification(p_id uuid,p_actor uuid,p_title text,p_body text,p_email text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer; existing notification_campaigns;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 if length(trim(p_title)) not between 3 and 150 or length(trim(p_body)) not between 3 and 3000 then raise exception 'Nội dung không hợp lệ'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into existing from notification_campaigns where id=p_id;
 if found then
  if existing.actor<>p_actor or existing.title<>p_title or existing.body<>p_body or existing.email is distinct from p_email then raise exception 'Mã gửi đã được sử dụng'; end if;
  return existing.recipients;
 end if;
 insert into notification_campaigns(id,actor,title,body,email) values(p_id,p_actor,p_title,p_body,p_email);
 insert into notifications(id,user_id,title,body,href)
 select 'campaign:'||p_id||':'||id,id,p_title,p_body,'/account'
 from profiles where (p_email is null and role='customer') or (p_email is not null and lower(email)=lower(p_email));
 get diagnostics n=row_count;
 if p_email is not null and n=0 then raise exception 'Không tìm thấy tài khoản'; end if;
 update notification_campaigns set recipients=n where id=p_id;
 insert into audit_logs(user_id,action,target) values(p_actor,'send_notification',p_id::text);
 return n;
end $$;
revoke all on function public.send_store_notification(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.send_store_notification(uuid,uuid,text,text,text) to service_role;

create function public.notify_ticket_completed() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='closed' and old.status is distinct from new.status then
  insert into notifications(id,user_id,title,body,href)
  values(gen_random_uuid()::text,new.user_id,
   case when new.kind='warranty' then 'Yêu cầu bảo hành đã được xử lý' else 'Yêu cầu hỗ trợ đã được xử lý' end,
   new.subject||' — Mở yêu cầu để xem kết quả và phản hồi.', '/support');
 end if;
 return new;
end $$;
create trigger ticket_completed_notification after update of status on public.tickets for each row execute function public.notify_ticket_completed();
revoke all on function public.notify_ticket_completed() from public,anon,authenticated;
-- KEYNEST STEP 011_admin_notifications END

-- KEYNEST STEP 012_announcements BEGIN
create table public.store_announcements (
 id uuid primary key, title text not null check(length(title) between 3 and 150),
 body text not null check(length(body) between 3 and 3000),
 active boolean not null default true, created_at timestamptz not null default now()
);
alter table public.store_announcements enable row level security;
revoke all on public.store_announcements from public,anon,authenticated;
grant all on public.store_announcements to service_role;
create index on public.store_announcements(active,created_at desc);
-- KEYNEST STEP 012_announcements END

-- KEYNEST STEP 013_notification_deletion BEGIN
alter table public.notification_campaigns add column deleted_at timestamptz;
create function public.delete_store_campaign(p_id uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 -- Retain the campaign ID so retries cannot send a deleted campaign again.
 update notification_campaigns set deleted_at=now() where id=p_id and deleted_at is null;
 delete from notifications where id like 'campaign:'||p_id||':%';
 insert into audit_logs(user_id,action,target) values(p_actor,'delete_notification',p_id::text);
end $$;
revoke all on function public.delete_store_campaign(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_store_campaign(uuid,uuid) to service_role;
-- KEYNEST STEP 013_notification_deletion END

-- KEYNEST STEP 014_coupon_pin BEGIN
alter table public.coupons add column pinned boolean not null default false;
-- KEYNEST STEP 014_coupon_pin END

-- KEYNEST STEP 015_permission_hardening BEGIN
-- Browser roles may read only where earlier grants and RLS allow it.
-- All application writes and business RPCs must pass through the Node API.
revoke create on schema public from public, anon, authenticated;

do $$ declare r record; begin
 for r in
  select c.oid, c.relname, c.relkind from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','S')
  and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
 loop
  if r.relkind='S' then
   execute format('revoke all on sequence public.%I from public,anon,authenticated',r.relname);
  else
   execute format('revoke insert,update,delete,truncate,references,trigger on table public.%I from public,anon,authenticated',r.relname);
   -- Table-level REVOKE does not remove explicit column grants.
   execute (select format('revoke insert (%s),update (%s),references (%s) on public.%I from public,anon,authenticated',
    string_agg(quote_ident(attname),','),string_agg(quote_ident(attname),','),string_agg(quote_ident(attname),','),r.relname)
    from pg_attribute where attrelid=r.oid and attnum>0 and not attisdropped);
   if r.relkind in ('r','p') then
    execute format('alter table public.%I enable row level security',r.relname);
   end if;
  end if;
 end loop;
 for r in
  select p.oid::regprocedure as signature from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 loop
  execute format('revoke execute on function %s from public,anon,authenticated',r.signature);
 end loop;
end $$;

-- Defaults apply to objects created by the role running this migration.
-- New migrations must still explicitly grant access and enable RLS.
alter default privileges revoke execute on functions from public,anon,authenticated;
alter default privileges revoke all on tables from public,anon,authenticated;
alter default privileges revoke all on sequences from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke all on tables from public,anon,authenticated;
alter default privileges in schema public revoke all on sequences from public,anon,authenticated;
-- KEYNEST STEP 015_permission_hardening END

-- KEYNEST STEP 016_categories BEGIN
begin;
create table public.categories (
 id text primary key check(id ~ '^[a-z][a-z0-9-]{0,39}$' and id not in ('all','constructor','prototype')),
 name text not null check(length(btrim(name)) between 2 and 60),
 sort_order integer not null default 0 check(sort_order between 0 and 9999)
);
insert into public.categories(id,name,sort_order) values
 ('game','Game key',0),('gift','Gift card',1),('topup','Nạp game',2),('mmo','MMO & Proxy',3);
alter table public.categories enable row level security;
revoke all on public.categories from public,anon,authenticated;
grant select on public.categories to anon,authenticated;
grant all on public.categories to service_role;
create policy categories_public on public.categories for select to anon,authenticated using(true);
alter table public.products drop constraint products_category_check;
alter table public.products add constraint products_category_fkey foreign key(category) references public.categories(id);
alter table public.coupons drop constraint coupons_category_check;
alter table public.coupons add constraint coupons_category_check check(category ~ '^[a-z][a-z0-9-]{0,39}$');

create or replace function public.catalog_search(p_filters jsonb) returns jsonb
language plpgsql stable set search_path=public as $$
declare
  per_page integer := coalesce((p_filters->>'page_size')::integer,12);
  requested_page integer := coalesce((p_filters->>'page')::integer,1);
  category_filter text := coalesce(p_filters->>'category','all');
  sort_mode text := coalesce(p_filters->>'sort','featured');
  result jsonb;
begin
  if per_page not between 1 and 48 or requested_page not between 1 and 10000
    or category_filter !~ '^[a-z][a-z0-9-]{0,39}$'
    or sort_mode not in ('featured','asc','desc','name') then
    raise exception 'Bộ lọc không hợp lệ';
  end if;
  with active as materialized (
    select p.*, coalesce(nullif(p.subcategory,''),nullif(p.platform,''),'Khác') as group_name
    from products p where p.active
  ), scoped as materialized (
    select * from active where category_filter='all' or category=category_filter
  ), filtered as (
    select p.*, (select min(v.price) from variants v where v.product_id=p.id) as min_price
    from scoped p
    where position(catalog_normalize(coalesce(p_filters->>'q','')) in
      catalog_normalize(p.name || ' ' || p.platform || ' ' || p.description || ' ' || p.group_name))>0
      and (coalesce(p_filters->>'sub','')='' or p.group_name=p_filters->>'sub')
      and (coalesce(p_filters->>'platform','')='' or p.platform=p_filters->>'platform')
      and exists(select 1 from variants v where v.product_id=p.id
        and v.price >= coalesce((p_filters->>'min')::bigint,0)
        and v.price <= coalesce((p_filters->>'max')::bigint,100000000)
        and (coalesce(p_filters->>'stock','0')<>'1' or v.stock>0)
        and (coalesce(p_filters->>'sale','0')<>'1' or v.original_price>v.price)
        and (coalesce(p_filters->>'delivery','')='' or v.delivery=p_filters->>'delivery')
        and (coalesce(p_filters->>'region','')='' or v.region=p_filters->>'region'))
  ), ranked as materialized (
    select *,row_number() over(order by
      case when sort_mode='asc' then min_price end asc,
      case when sort_mode='desc' then min_price end desc,
      case when sort_mode='name' then name end asc,
      case when sort_mode='featured' then featured end desc,
      case when sort_mode='featured' then sort_order end asc,id asc) as rank
    from filtered
  ), totals as (
    select count(*)::integer as total, greatest(1,ceil(count(*)::numeric/per_page)::integer) as pages from ranked
  ), pagination as (
    select *,least(requested_page,pages) as page from totals
  ), selected as (
    select r.* from ranked r cross join pagination pg
    where r.rank > (pg.page-1)*per_page and r.rank <= pg.page*per_page
  ), items as (
    select (to_jsonb(p)-'group_name'-'min_price'-'rank') || jsonb_build_object(
      'variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.price,v.id) from variants v where v.product_id=p.id),'[]'::jsonb),
      'review_count',coalesce(s.review_count,0),
      'rating_average',coalesce(s.rating_average,0),
      'rating_counts',coalesce(s.rating_counts,'[0,0,0,0,0]'::jsonb)) as item,p.rank
    from selected p left join product_review_stats s on s.product_id=p.id
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(item order by rank) from items),'[]'::jsonb),
    'total',pg.total,'page',pg.page,'page_size',per_page,'pages',pg.pages,
    'facets',jsonb_build_object(
      'groups',coalesce((select jsonb_agg(g order by g) from (select distinct group_name g from scoped) x),'[]'::jsonb),
      'platforms',coalesce((select jsonb_agg(g order by g) from (select distinct platform g from scoped) x),'[]'::jsonb),
      'regions',coalesce((select jsonb_agg(g order by g) from (select distinct v.region g from variants v join scoped s on s.id=v.product_id) x),'[]'::jsonb),
      'categories',(select jsonb_object_agg(c,(select count(*) from active where c='all' or category=c))
        from (select 'all' as c union all select id from public.categories) category_rows))) into result from pagination pg;
  return result;
end $$;
revoke all on function public.catalog_normalize(text),public.catalog_search(jsonb) from public,anon,authenticated;
grant execute on function public.catalog_normalize(text),public.catalog_search(jsonb) to service_role;
commit;
-- KEYNEST STEP 016_categories END

-- KEYNEST STEP 017_registration BEGIN
begin;
-- Separate the reserved registration name from editable/OAuth display names.
alter table public.profiles add column registration_name text;
create unique index profiles_registration_name_unique on public.profiles(registration_name);
-- Preserve existing accounts even if they already share a display name.
with names as (
 select id, lower(btrim(name)) as normalized,
 row_number() over(partition by lower(btrim(name)) order by id) as n
 from public.profiles where btrim(name)<>''
)
update public.profiles p set registration_name=n.normalized
from names n where p.id=n.id and n.n=1;

create or replace function public.handle_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,email,name,avatar_url,registration_name)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'name',''),
 public.oauth_avatar(new.raw_user_meta_data),
 nullif(lower(btrim(new.raw_user_meta_data->>'registration_name')),''));
 return new;
end $$;
revoke all on function public.handle_user() from public,anon,authenticated;

create function public.registration_conflicts(p_email text,p_name text) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'email',exists(select 1 from auth.users where lower(email)=lower(btrim(p_email))),
 'name',exists(select 1 from public.profiles where registration_name=lower(btrim(p_name))
 or lower(btrim(name))=lower(btrim(p_name))))
$$;
revoke all on function public.registration_conflicts(text,text) from public,anon,authenticated;
grant execute on function public.registration_conflicts(text,text) to service_role;
commit;
-- KEYNEST STEP 017_registration END

-- KEYNEST STEP 018_product_usage_notes BEGIN
-- Public product instructions; never store passwords or delivery keys here.
alter table public.products
  add column usage_notes text not null default ''
  check (length(usage_notes) <= 10000);
-- KEYNEST STEP 018_product_usage_notes END

-- KEYNEST STEP 019_reuse_wallet_topups BEGIN
-- Keep expired rows for late bank transfers and reconciliation.
create or replace function public.create_wallet_topup(p_user uuid, p_amount bigint)
returns public.payments language plpgsql security definer set search_path=public as $$
declare result public.payments;
begin
  if p_amount is null or p_amount < 10000 or p_amount > 50000000 then
    raise exception 'Số tiền nạp không hợp lệ';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet-topup:' || p_user::text || ':' || p_amount::text, 0));
  select * into result from public.payments
    where user_id=p_user and amount=p_amount and order_id is null
      and status='pending' and expires_at > clock_timestamp()
    order by created_at desc, id limit 1 for update;
  if found and result.expires_at > clock_timestamp() then return result; end if;
  insert into public.payments(user_id, amount) values(p_user,p_amount) returning * into result;
  return result;
end $$;
revoke all on function public.create_wallet_topup(uuid,bigint) from public,anon,authenticated;
grant execute on function public.create_wallet_topup(uuid,bigint) to service_role;
create index if not exists payments_pending_wallet_lookup
  on public.payments(user_id,amount,created_at desc) where order_id is null and status='pending';
-- KEYNEST STEP 019_reuse_wallet_topups END

-- KEYNEST STEP 020_wallet_topup_amount_step BEGIN
-- Enforce the displayed 1,000 VND step even for direct API/RPC calls.
create or replace function public.create_wallet_topup(p_user uuid, p_amount bigint)
returns public.payments language plpgsql security definer set search_path=public as $$
declare result public.payments;
begin
  if p_amount is null or p_amount < 10000 or p_amount > 50000000 or p_amount % 1000 <> 0 then
    raise exception 'Số tiền nạp không hợp lệ';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet-topup:' || p_user::text || ':' || p_amount::text, 0));
  select * into result from public.payments
    where user_id=p_user and amount=p_amount and order_id is null
      and status='pending' and expires_at > clock_timestamp()
    order by created_at desc, id limit 1 for update;
  if found and result.expires_at > clock_timestamp() then return result; end if;
  insert into public.payments(user_id, amount) values(p_user,p_amount) returning * into result;
  return result;
end $$;
revoke all on function public.create_wallet_topup(uuid,bigint) from public,anon,authenticated;
grant execute on function public.create_wallet_topup(uuid,bigint) to service_role;
-- KEYNEST STEP 020_wallet_topup_amount_step END

-- KEYNEST STEP 021_ticket_deletion BEGIN
-- Retain support/warranty history while removing deleted requests from the inbox.
alter table public.tickets add column deleted_at timestamptz;
-- KEYNEST STEP 021_ticket_deletion END

-- KEYNEST STEP 022_sellers BEGIN
-- Seller ownership, immutable purchase-time fees, transactional wallet settlement.
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check check(role in ('customer','admin','seller'));
alter table profiles add column seller_name text not null default '',
 add column seller_social_links jsonb not null default '[]',
 add column seller_terms_version text,
 add column seller_terms_accepted_at timestamptz,
 add column seller_debt bigint not null default 0 check(seller_debt>=0);
alter table ticket_messages drop constraint ticket_messages_role_check;
alter table ticket_messages add constraint ticket_messages_role_check check(role in ('admin','customer','seller'));
alter table products add column seller_id uuid references profiles(id);
create index on products(seller_id);
alter table order_items add column seller_id uuid references profiles(id),
 add column seller_name text, add column seller_fee_bps integer check(seller_fee_bps between 0 and 10000),
 add column seller_gross bigint, add column seller_fee bigint, add column seller_net bigint,
 add column seller_settled_at timestamptz, add column seller_reversed_at timestamptz;
create index on order_items(seller_id,order_id);
create table seller_settings(id boolean primary key default true check(id), fee_bps integer not null check(fee_bps between 0 and 10000));
insert into seller_settings values(true,700);
create table seller_withdrawals(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references profiles(id),
 amount bigint not null check(amount between 50000 and 100000000),
 bank text not null, account_number text not null, account_name text not null,
 status text not null default 'pending' check(status in ('pending','paid','rejected','cancelled')),
 reference text not null default '',reason text not null default '',
 created_at timestamptz not null default now(),resolved_at timestamptz,resolved_by uuid references profiles(id),
 idempotency uuid not null,unique(user_id,idempotency));
alter table seller_settings enable row level security;
alter table seller_withdrawals enable row level security;
grant all on seller_settings,seller_withdrawals to service_role;

create function require_seller(p_user uuid) returns void language plpgsql set search_path=public as $$ begin
 perform 1 from profiles where id=p_user and role='seller' and seller_terms_version='2026-10-11-v1'
 and jsonb_array_length(seller_social_links)>0 for update;
 if not found then raise exception 'Cần hoàn tất hồ sơ và điều khoản người bán'; end if;
 if exists(select 1 from account_controls where user_id=p_user and suspended) then raise exception 'Người bán đang bị khóa'; end if;
end $$;
create function snapshot_seller_item() returns trigger language plpgsql set search_path=public as $$ declare sid uuid; begin
 select seller_id into sid from products where id=new.product_id;
 if sid is not null then
  perform require_seller(sid);
  if sid=(select user_id from orders where id=new.order_id) then raise exception 'Không thể mua sản phẩm của chính mình'; end if;
  new.seller_id:=sid;
  select coalesce(nullif(seller_name,''),name) into new.seller_name from profiles where id=sid;
  select fee_bps into new.seller_fee_bps from seller_settings where id;
 end if;
 return new;
end $$;
create trigger seller_item_snapshot before insert on order_items for each row execute function snapshot_seller_item();

create function settle_seller_revenue(p_order uuid) returns void language plpgsql set search_path=public as $$
declare o orders; i order_items; u profiles; w seller_withdrawals; cumulative numeric:=0; previous numeric; gross bigint; fee bigint; net bigint; offset_amount bigint; credited bigint;
begin
 select * into o from orders where id=p_order for update;
 if o.status not in ('processing','completed','refunded') then return; end if;
 -- Lock seller balances consistently, and serialize payouts/refunds/withdrawals.
 perform 1 from profiles where id in (select seller_id from order_items where order_id=o.id) order by id for update;
 for i in select * from order_items where order_id=o.id order by id for update loop
  previous:=cumulative; cumulative:=cumulative+i.price::numeric*i.quantity;
  if i.seller_id is null then continue; end if;
  select * into u from profiles where id=i.seller_id;
  if o.status='refunded' then
   if i.seller_settled_at is null or i.seller_reversed_at is not null then continue; end if;
   for w in select * from seller_withdrawals where user_id=u.id and status='pending' order by id for update loop
    update seller_withdrawals set status='cancelled',reason='Hủy để đối soát hoàn tiền đơn hàng',resolved_at=now() where id=w.id;
    update profiles set balance=balance+w.amount where id=u.id;
    insert into wallet_ledger(user_id,amount,description) values(u.id,w.amount,'Hủy yêu cầu rút '||w.id||' để đối soát');
   end loop;
   select * into u from profiles where id=i.seller_id;
   credited:=least(u.balance,i.seller_net);
   update profiles set balance=balance-credited,seller_debt=seller_debt+i.seller_net-credited where id=u.id;
   update order_items set seller_reversed_at=now() where id=i.id;
   insert into wallet_ledger(user_id,amount,description) values(u.id,-credited,'Thu hồi doanh thu '||o.number||' · '||i.name);
  elsif i.seller_settled_at is null then
   gross:=case when o.subtotal=0 then 0 else floor(cumulative*o.total/o.subtotal)-floor(previous*o.total/o.subtotal) end;
   fee:=floor(gross::numeric*i.seller_fee_bps/10000); net:=gross-fee;
   offset_amount:=least(u.seller_debt,net); credited:=net-offset_amount;
   update profiles set balance=balance+credited,seller_debt=seller_debt-offset_amount where id=u.id;
   update order_items set seller_gross=gross,seller_fee=fee,seller_net=net,seller_settled_at=now() where id=i.id;
   insert into wallet_ledger(user_id,amount,description) values(u.id,credited,'Doanh thu sau phí / bù trừ '||o.number||' · '||i.name);
  end if;
 end loop;
end $$;
-- Wallet orders are already paid when inserted, but items do not exist yet.
alter function create_order(uuid,jsonb,uuid) rename to create_order_before_sellers;
create function create_order(p_user uuid,p_payload jsonb,p_idempotency uuid) returns uuid language plpgsql set search_path=public as $$ declare oid uuid; begin
 oid:=create_order_before_sellers(p_user,p_payload,p_idempotency);
 perform settle_seller_revenue(oid); return oid;
end $$;
create function seller_order_status() returns trigger language plpgsql set search_path=public as $$ begin
 perform settle_seller_revenue(new.id); return new;
end $$;
create trigger seller_order_settlement after update of status on orders for each row when(old.status is distinct from new.status) execute function seller_order_status();

-- One service-only transaction boundary for ownership-sensitive writes.
create function seller_command(p_actor uuid,p_action text,p_data jsonb) returns jsonb language plpgsql set search_path=public as $$
declare u profiles; pr products; v variants; i order_items; o orders; w seller_withdrawals; target uuid; result_id uuid; k jsonb; keys jsonb; amount bigint;
begin
 select * into u from profiles where id=p_actor for update;
 if u.id is null then raise exception 'Tài khoản không tồn tại'; end if;
 if p_action in ('role','fee','withdrawal_review') then
  if u.role<>'admin' then raise exception 'Cần quyền quản trị'; end if;
 elsif p_action='profile' then
  if u.role<>'seller' then raise exception 'Cần quyền người bán'; end if;
 else perform require_seller(p_actor);
 end if;
 if p_action='profile' then
  if p_data->>'terms_version'<>'2026-10-11-v1' or (p_data->>'fee_bps')::int<>(select fee_bps from seller_settings where id) then raise exception 'Điều khoản hoặc phí đã thay đổi. Tải lại trang'; end if;
  if char_length(btrim(p_data->>'name')) not between 2 and 80 or jsonb_array_length(p_data->'social_links') not between 1 and 5 then raise exception 'Hồ sơ không hợp lệ'; end if;
  update profiles set seller_name=btrim(p_data->>'name'),seller_social_links=p_data->'social_links',seller_terms_version=p_data->>'terms_version',seller_terms_accepted_at=coalesce(seller_terms_accepted_at,now()) where id=p_actor;
 elsif p_action='role' then
  target:=(p_data->>'user_id')::uuid;
  if p_data->>'role' not in ('customer','seller') then raise exception 'Vai trò không hợp lệ'; end if;
  perform 1 from profiles where id=target and role<>'admin' for update;
  if not found then raise exception 'Chỉ đổi vai trò tài khoản khách hoặc seller'; end if;
  update profiles set role=p_data->>'role' where id=target;
  if p_data->>'role'='customer' then update products set active=false where seller_id=target; end if;
 elsif p_action='fee' then
  update seller_settings set fee_bps=(p_data->>'fee_bps')::int where id;
 elsif p_action='product' then
  target:=nullif(p_data->>'id','')::uuid;
  if target is not null then
   select * into pr from products where id=target and seller_id=p_actor for update;
   if not found then raise exception 'Không có quyền sửa sản phẩm'; end if;
   update products set slug=p_data->>'slug',name=p_data->>'name',category=p_data->>'category',platform=p_data->>'platform',subcategory=p_data->>'subcategory',subtitle=p_data->>'subtitle',description=p_data->>'description',usage_notes=coalesce(p_data->>'usage_notes',''),image=p_data->>'image',active=(p_data->>'active')::boolean where id=target;
  else
   insert into products(seller_id,slug,name,category,platform,subcategory,subtitle,description,usage_notes,image,active,featured)
   values(p_actor,p_data->>'slug',p_data->>'name',p_data->>'category',p_data->>'platform',p_data->>'subcategory',p_data->>'subtitle',p_data->>'description',coalesce(p_data->>'usage_notes',''),p_data->>'image',(p_data->>'active')::boolean,false) returning id into target;
  end if;
  insert into audit_logs(user_id,action,target) values(p_actor,'seller_product',target::text);
  return (select to_jsonb(p) from products p where id=target);
 elsif p_action in ('variant','keys') then
  if p_action='variant' then target:=(p_data->>'product_id')::uuid;
  else select product_id into target from variants where id=(p_data->>'variant_id')::uuid; end if;
  perform 1 from products where id=target and seller_id=p_actor;
  if not found then raise exception 'Không có quyền quản lý kho này'; end if;
  if p_action='variant' then result_id:=save_variant(target,p_data->'variant');
  else perform import_keys((p_data->>'variant_id')::uuid,p_data->'keys'); end if;
 elsif p_action='fulfill' then
  target:=(p_data->>'item_id')::uuid;
  select orders.* into o from orders join order_items oi on oi.order_id=orders.id where oi.id=target for update of orders;
  select * into i from order_items where id=target and seller_id=p_actor for update;
  if i.id is null or o.status<>'processing' or i.delivery<>'manual' or i.delivered_at is not null then raise exception 'Không có gói đang chờ giao của bạn'; end if;
  keys:=p_data->'keys';
  if jsonb_array_length(keys)<>i.quantity then raise exception 'Cần một kết quả cho mỗi đơn vị sản phẩm'; end if;
  for k in select value from jsonb_array_elements(keys) loop
   insert into inventory(variant_id,order_id,item_id,secret,secret_hash) values(i.variant_id,o.id,i.id,k->>'secret',k->>'hash');
  end loop;
  update order_items set delivered_at=now() where id=i.id;
  if not exists(select 1 from order_items where order_id=o.id and delivered_at is null) then update orders set status='completed' where id=o.id; end if;
 elsif p_action='withdraw' then
  select * into w from seller_withdrawals where user_id=p_actor and idempotency=(p_data->>'idempotency')::uuid;
  if found then
   if w.amount<>(p_data->>'amount')::bigint or w.bank<>p_data->>'bank' or w.account_number<>p_data->>'account_number' or w.account_name<>p_data->>'account_name' then raise exception 'Mã yêu cầu đã được sử dụng'; end if;
   return to_jsonb(w);
  end if;
  amount:=(p_data->>'amount')::bigint;
  if u.seller_debt>0 or amount<50000 or amount>u.balance then raise exception 'Số dư không đủ hoặc còn khoản cần bù trừ'; end if;
  insert into seller_withdrawals(user_id,amount,bank,account_number,account_name,idempotency) values(p_actor,amount,p_data->>'bank',p_data->>'account_number',p_data->>'account_name',(p_data->>'idempotency')::uuid) returning * into w;
  update profiles set balance=balance-amount where id=p_actor;
  insert into wallet_ledger(user_id,amount,description) values(p_actor,-amount,'Giữ tiền yêu cầu rút '||w.id);
  insert into audit_logs(user_id,action,target) values(p_actor,'seller_withdraw',w.id::text);
  return to_jsonb(w);
 elsif p_action='withdrawal_review' then
  target:=(p_data->>'id')::uuid;
  -- Match settlement lock order: profile before withdrawal.
  perform 1 from profiles where id=(select user_id from seller_withdrawals where id=target) for update;
  select * into w from seller_withdrawals where id=target for update;
  if not found or w.status<>'pending' then raise exception 'Yêu cầu đã xử lý hoặc không tồn tại'; end if;
  if p_data->>'status' not in ('paid','rejected') then raise exception 'Trạng thái không hợp lệ'; end if;
  if p_data->>'status'='paid' and char_length(btrim(p_data->>'reference'))<3 then raise exception 'Cần mã giao dịch chuyển khoản'; end if;
  if p_data->>'status'='rejected' then
   update profiles set balance=balance+w.amount where id=w.user_id;
   insert into wallet_ledger(user_id,amount,description) values(w.user_id,w.amount,'Trả tiền yêu cầu rút bị từ chối '||w.id);
  end if;
  update seller_withdrawals set status=p_data->>'status',reference=p_data->>'reference',reason=p_data->>'reason',resolved_at=now(),resolved_by=p_actor where id=w.id;
 else raise exception 'Thao tác không hợp lệ';
 end if;
 insert into audit_logs(user_id,action,target) values(p_actor,'seller_'||p_action,coalesce(target::text,p_actor::text));
 return jsonb_build_object('ok',true);
end $$;

-- Admin delivers only the remaining items after a seller has delivered their part.
do $$ declare definition text; begin
 select pg_get_functiondef('fulfill_order(uuid,jsonb)'::regprocedure) into definition;
 execute replace(definition,'delivery=''manual''','delivery=''manual'' and delivered_at is null');
end $$;
revoke all on function require_seller(uuid),snapshot_seller_item(),settle_seller_revenue(uuid),create_order(uuid,jsonb,uuid),seller_order_status(),seller_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function require_seller(uuid),snapshot_seller_item(),settle_seller_revenue(uuid),create_order(uuid,jsonb,uuid),seller_order_status(),seller_command(uuid,text,jsonb) to service_role;

-- Existing support and account controls also apply to sellers as customers.
do $$ declare definition text; begin
 select pg_get_functiondef('set_customer_access(uuid,uuid,boolean,text)'::regprocedure) into definition;
 execute replace(definition,'role=''customer''','role in (''customer'',''seller'')');
end $$;
-- KEYNEST STEP 022_sellers END

-- KEYNEST STEP 023_restore_customer_profiles BEGIN
begin;
-- Auth accounts created before the profile trigger was installed must also
-- appear in the admin customer list. Never overwrite existing roles or money.
insert into public.profiles(id,email,name,avatar_url)
select u.id,u.email,coalesce(u.raw_user_meta_data->>'name',u.raw_user_meta_data->>'full_name',''),
 public.oauth_avatar(u.raw_user_meta_data)
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- Reattach the existing registration handler if the trigger was removed.
drop trigger if exists new_auth_user on auth.users;
create trigger new_auth_user after insert on auth.users
for each row execute function public.handle_user();
commit;
-- KEYNEST STEP 023_restore_customer_profiles END

-- KEYNEST STEP 024_seller_without_social BEGIN
begin;
-- Keep existing installations compatible: social contacts are no longer required.
update profiles set seller_social_links='[]'::jsonb where seller_social_links<>'[]'::jsonb;
create or replace function require_seller(p_user uuid) returns void language plpgsql set search_path=public as $$ begin
 perform 1 from profiles where id=p_user and role='seller' and seller_terms_version='2026-10-11-v1' for update;
 if not found then raise exception 'Cần hoàn tất hồ sơ và điều khoản người bán'; end if;
 if exists(select 1 from account_controls where user_id=p_user and suspended) then raise exception 'Người bán đang bị khóa'; end if;
end $$;
do $$ declare definition text; begin
 select pg_get_functiondef('seller_command(uuid,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,' or jsonb_array_length(p_data->''social_links'') not between 1 and 5','');
 definition:=replace(definition,'seller_social_links=p_data->''social_links''','seller_social_links=''[]''::jsonb');
 if position('jsonb_array_length(p_data->''social_links'')' in definition)>0
    or position('seller_social_links=p_data->''social_links''' in definition)>0 then
  raise exception 'Could not remove seller social link requirements from seller_command';
 end if;
 execute definition;
end $$;
commit;
-- KEYNEST STEP 024_seller_without_social END

-- KEYNEST STEP 025_catalog_deletion BEGIN
begin;

-- Delete catalog records only when they have no purchase or customer-feedback history.
-- Unassigned inventory is removed with its variant/product; assigned codes are retained.
create function public.delete_catalog_product(p_actor uuid, p_product uuid)
returns void language plpgsql set search_path=public as $$
declare actor_role text; owner_id uuid;
begin
  select role into actor_role from profiles where id=p_actor for update;
  if actor_role is null then raise exception 'Tài khoản không tồn tại'; end if;
  if actor_role not in ('admin','seller') then raise exception 'Cần quyền quản lý sản phẩm'; end if;
  if actor_role='seller' then perform require_seller(p_actor); end if;

  select seller_id into owner_id from products where id=p_product for update;
  if not found then raise exception 'Không tìm thấy sản phẩm'; end if;
  if actor_role='seller' and owner_id is distinct from p_actor then
    raise exception 'Không có quyền xóa sản phẩm này';
  end if;

  perform 1 from variants where product_id=p_product order by id for update;
  if exists(select 1 from order_items where product_id=p_product)
     or exists(select 1 from order_items oi join variants v on v.id=oi.variant_id where v.product_id=p_product)
     or exists(select 1 from inventory i join variants v on v.id=i.variant_id where v.product_id=p_product and (i.order_id is not null or i.item_id is not null))
     or exists(select 1 from reviews where product_id=p_product)
     or exists(select 1 from product_comments where product_id=p_product) then
    raise exception 'Sản phẩm đã có lịch sử đơn hàng, đánh giá hoặc bình luận; hãy tắt “Đang bán” thay vì xóa';
  end if;

  delete from inventory where variant_id in (select id from variants where product_id=p_product)
    and order_id is null and item_id is null;
  delete from variants where product_id=p_product;
  delete from products where id=p_product;
  insert into audit_logs(user_id,action,target) values(p_actor,'delete_product',p_product::text);
end $$;

create function public.delete_catalog_variant(p_actor uuid, p_variant uuid)
returns void language plpgsql set search_path=public as $$
declare actor_role text; owner_id uuid; product_key uuid;
begin
  select role into actor_role from profiles where id=p_actor for update;
  if actor_role is null then raise exception 'Tài khoản không tồn tại'; end if;
  if actor_role not in ('admin','seller') then raise exception 'Cần quyền quản lý gói'; end if;
  if actor_role='seller' then perform require_seller(p_actor); end if;

  select product_id into product_key from variants where id=p_variant;
  if product_key is null then raise exception 'Không tìm thấy gói sản phẩm'; end if;
  select seller_id into owner_id from products where id=product_key for update;
  if not found then raise exception 'Không tìm thấy sản phẩm'; end if;
  if actor_role='seller' and owner_id is distinct from p_actor then
    raise exception 'Không có quyền xóa gói này';
  end if;
  perform 1 from variants where id=p_variant and product_id=product_key for update;
  if not found then raise exception 'Gói sản phẩm đã thay đổi; hãy tải lại trang'; end if;

  if exists(select 1 from order_items where variant_id=p_variant)
     or exists(select 1 from inventory where variant_id=p_variant and (order_id is not null or item_id is not null)) then
    raise exception 'Gói đã có lịch sử đơn hàng; hãy tắt sản phẩm thay vì xóa gói';
  end if;

  delete from inventory where variant_id=p_variant and order_id is null and item_id is null;
  delete from variants where id=p_variant;
  insert into audit_logs(user_id,action,target) values(p_actor,'delete_variant',p_variant::text);
end $$;

revoke all on function public.delete_catalog_product(uuid,uuid), public.delete_catalog_variant(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.delete_catalog_product(uuid,uuid), public.delete_catalog_variant(uuid,uuid)
  to service_role;

commit;
-- KEYNEST STEP 025_catalog_deletion END

-- KEYNEST STEP 026_admin_deletion BEGIN
begin;
create function delete_admin_record(p_actor uuid, p_kind text, p_id text)
returns void language plpgsql set search_path=public as $$
begin
 perform 1 from profiles where id=p_actor and role='admin' for update;
 if not found then raise exception 'Cần quyền quản trị.'; end if;
 if p_kind='category' then
  perform 1 from categories where id=p_id for update;
  if not found then raise exception 'Không tìm thấy danh mục.'; end if;
  if exists(select 1 from products where category=p_id) or exists(select 1 from coupons where category=p_id) then
   raise exception 'Danh mục còn sản phẩm hoặc mã giảm giá. Hãy chuyển chúng sang danh mục khác trước khi xóa.';
  end if;
  delete from categories where id=p_id;
 elsif p_kind='coupon' then
  perform 1 from coupons where code=p_id for update;
  if not found then raise exception 'Không tìm thấy mã giảm giá.'; end if;
  if exists(select 1 from orders where coupon=p_id) then
   raise exception 'Mã đã gắn với đơn hàng. Hãy tắt mã để giữ lịch sử sử dụng.';
  end if;
  delete from coupons where code=p_id;
 elsif p_kind='banner' then
  delete from banners where id=p_id::uuid;
  if not found then raise exception 'Không tìm thấy banner.'; end if;
 else raise exception 'Thao tác không hợp lệ.';
 end if;
 insert into audit_logs(user_id,action,target) values(p_actor,'delete_'||p_kind,p_id);
end $$;
revoke all on function delete_admin_record(uuid,text,text) from public,anon,authenticated;
grant execute on function delete_admin_record(uuid,text,text) to service_role;
commit;
-- KEYNEST STEP 026_admin_deletion END

-- KEYNEST STEP 027_password_recovery_links BEGIN
begin;

create table public.password_recovery_links (
  email_hash text primary key check (email_hash ~ '^[a-f0-9]{64}$'),
  recovery_id uuid not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.password_recovery_tickets (
  ticket_hash text primary key check (ticket_hash ~ '^[a-f0-9]{64}$'),
  email_hash text not null,
  recovery_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_session text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (email_hash) references public.password_recovery_links(email_hash)
    on update cascade on delete cascade
);

alter table public.password_recovery_links enable row level security;
alter table public.password_recovery_tickets enable row level security;
revoke all on public.password_recovery_links, public.password_recovery_tickets
  from public, anon, authenticated;
grant select, insert, update, delete on public.password_recovery_links,
  public.password_recovery_tickets to service_role;

create function public.claim_password_recovery_reset(
  p_ticket_hash text,
  p_now timestamptz
)
returns table(user_id uuid, encrypted_session text)
language plpgsql
security definer
set search_path = public
as $$
declare
  found_ticket public.password_recovery_tickets%rowtype;
begin
  select t.* into found_ticket
  from public.password_recovery_tickets t
  join public.password_recovery_links l
    on l.email_hash = t.email_hash
   and l.recovery_id = t.recovery_id
   and l.consumed_at is not null
   and l.expires_at > p_now
  where t.ticket_hash = p_ticket_hash
    and t.consumed_at is null
    and t.expires_at > p_now
  for update of t, l;

  if not found then return; end if;

  update public.password_recovery_tickets t
  set consumed_at = p_now
  where t.ticket_hash = p_ticket_hash
  returning t.user_id, t.encrypted_session
    into user_id, encrypted_session;

  return next;
end;
$$;

revoke all on function public.claim_password_recovery_reset(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_password_recovery_reset(text, timestamptz)
  to service_role;

commit;
-- KEYNEST STEP 027_password_recovery_links END

-- KEYNEST STEP 028_password_recovery_delivery BEGIN
begin;

-- Keep the last delivered generation until the provider accepts the next email.
create table public.password_recovery_sends (
  email_hash text primary key,
  recovery_id uuid not null,
  requested_at timestamptz not null default now()
);
alter table public.password_recovery_sends enable row level security;
revoke all on public.password_recovery_sends from public, anon, authenticated;
grant all on public.password_recovery_sends to service_role;

create function public.reserve_password_recovery(p_email_hash text, p_recovery_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed uuid;
begin
  insert into password_recovery_sends(email_hash, recovery_id) values(p_email_hash, p_recovery_id)
  on conflict(email_hash) do update
    set recovery_id = excluded.recovery_id, requested_at = now()
    where password_recovery_sends.requested_at <= now() - interval '90 seconds'
  returning recovery_id into claimed;
  return claimed is not null;
end;
$$;

create function public.finish_password_recovery(p_email_hash text, p_recovery_id uuid, p_sent boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare sent_at timestamptz;
begin
  select requested_at into sent_at from password_recovery_sends
    where email_hash = p_email_hash and recovery_id = p_recovery_id for update;
  if not found then return false; end if;
  if not p_sent then
    delete from password_recovery_sends where email_hash = p_email_hash;
    return true;
  end if;
  insert into password_recovery_links(email_hash, recovery_id, expires_at, consumed_at)
    values(p_email_hash, p_recovery_id, sent_at + interval '10 minutes', null)
  on conflict(email_hash) do update set recovery_id = excluded.recovery_id,
    expires_at = excluded.expires_at, consumed_at = null, created_at = sent_at;
  return true;
end;
$$;

-- Consumption and ticket persistence must either both succeed or both roll back.
create function public.redeem_password_recovery(p_ticket jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare deadline timestamptz;
begin
  update password_recovery_links set consumed_at=now()
    where email_hash=p_ticket->>'email_hash'
      and recovery_id=(p_ticket->>'recovery_id')::uuid
      and consumed_at is null and expires_at > now()
    returning expires_at into deadline;
  if not found then return false; end if;
  insert into password_recovery_tickets(ticket_hash,email_hash,recovery_id,user_id,encrypted_session,expires_at)
    values(p_ticket->>'ticket_hash',p_ticket->>'email_hash',(p_ticket->>'recovery_id')::uuid,
      (p_ticket->>'user_id')::uuid,p_ticket->>'encrypted_session',deadline);
  return true;
end;
$$;

revoke all on function public.redeem_password_recovery(jsonb) from public, anon, authenticated;
grant execute on function public.redeem_password_recovery(jsonb) to service_role;
revoke all on function public.reserve_password_recovery(text, uuid),
  public.finish_password_recovery(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.reserve_password_recovery(text, uuid),
  public.finish_password_recovery(text, uuid, boolean) to service_role;
commit;
-- KEYNEST STEP 028_password_recovery_delivery END

-- KEYNEST STEP 029_password_history BEGIN
begin;

-- Keep only salted hashes. Current passwords remain managed by Supabase Auth.
create table public.password_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  password_hash text not null,
  retired_at timestamptz not null default now()
);
create index password_history_user_time on public.password_history(user_id, retired_at);
alter table public.password_history enable row level security;
revoke all on public.password_history from public, anon, authenticated;
grant select, delete on public.password_history to service_role;

create function public.record_password_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.encrypted_password is distinct from new.encrypted_password
     and coalesce(old.encrypted_password, '') <> '' then
    insert into public.password_history(user_id, password_hash, retired_at)
      values(old.id, old.encrypted_password, now());
    delete from public.password_history where user_id = old.id
      and retired_at <= now() - interval '30 days';
  end if;
  return new;
end;
$$;
revoke all on function public.record_password_history() from public, anon, authenticated;
create trigger keynest_password_history after update of encrypted_password on auth.users
  for each row execute function public.record_password_history();

-- Serialize password changes across application instances while Auth updates.
create table public.password_change_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lock_id uuid not null,
  expires_at timestamptz not null
);
alter table public.password_change_locks enable row level security;
revoke all on public.password_change_locks from public, anon, authenticated;

create function public.begin_password_change(p_user_id uuid, p_lock_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare claimed uuid; current_hash text; old_hashes jsonb;
begin
  insert into public.password_change_locks values(p_user_id, p_lock_id, now() + interval '2 minutes')
  on conflict(user_id) do update set lock_id = excluded.lock_id, expires_at = excluded.expires_at
    where public.password_change_locks.expires_at <= now()
  returning lock_id into claimed;
  if claimed is null then return null; end if;
  select encrypted_password into current_hash from auth.users where id = p_user_id;
  delete from public.password_history where user_id = p_user_id and retired_at <= now() - interval '30 days';
  select coalesce(jsonb_agg(password_hash), '[]'::jsonb) into old_hashes
    from public.password_history where user_id = p_user_id and retired_at > now() - interval '30 days';
  return jsonb_build_object('current_hash', current_hash, 'history', old_hashes);
end;
$$;
create function public.finish_password_change(p_user_id uuid, p_lock_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.password_change_locks where user_id = p_user_id and lock_id = p_lock_id;
$$;
revoke all on function public.begin_password_change(uuid, uuid), public.finish_password_change(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_password_change(uuid, uuid), public.finish_password_change(uuid, uuid) to service_role;

-- Inspect before enforcing the password policy. A rejected password must not
-- consume the reset ticket; the existing claim function still consumes once.
create function public.inspect_password_recovery_reset(p_ticket_hash text)
returns table(user_id uuid)
language sql security definer set search_path = '' as $$
  select t.user_id from public.password_recovery_tickets t
  join public.password_recovery_links l on l.email_hash = t.email_hash
    and l.recovery_id = t.recovery_id and l.consumed_at is not null
    and l.expires_at > now()
  where t.ticket_hash = p_ticket_hash and t.consumed_at is null and t.expires_at > now();
$$;
revoke all on function public.inspect_password_recovery_reset(text) from public, anon, authenticated;
grant execute on function public.inspect_password_recovery_reset(text) to service_role;
commit;
-- KEYNEST STEP 029_password_history END

-- KEYNEST STEP 030_password_request_nonces BEGIN
begin;

create table public.password_request_nonces (
  nonce_hash text primary key check(nonce_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null
);
create index password_request_nonces_expiry on public.password_request_nonces(expires_at);
alter table public.password_request_nonces enable row level security;
revoke all on public.password_request_nonces from public, anon, authenticated;

create function public.consume_password_request_nonce(p_nonce_hash text, p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed text;
begin
  if p_expires_at is null or p_expires_at <= clock_timestamp()
     or p_expires_at > clock_timestamp() + interval '125 seconds' then
    return false;
  end if;
  delete from public.password_request_nonces where expires_at <= clock_timestamp();
  insert into public.password_request_nonces(nonce_hash, expires_at)
    values(p_nonce_hash, p_expires_at)
    on conflict(nonce_hash) do nothing returning nonce_hash into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.consume_password_request_nonce(text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_password_request_nonce(text, timestamptz) to service_role;
commit;
-- KEYNEST STEP 030_password_request_nonces END

-- KEYNEST STEP 031_private_data_sessions BEGIN
begin;

-- Private data is served by Node, which enforces MFA, suspension and sessions.
do $$ declare t text; columns text; begin
  foreach t in array array['profiles','orders','order_items','payments','wallet_ledger','tickets','ticket_messages'] loop
    execute format('revoke all on public.%I from public,anon,authenticated', t);
    select string_agg(quote_ident(attname), ',') into columns from pg_attribute
      where attrelid=format('public.%I',t)::regclass and attnum>0 and not attisdropped;
    execute format('revoke select (%s) on public.%I from public,anon,authenticated', columns,t);
  end loop;
end $$;

alter table public.account_controls add column sessions_revoked_before timestamptz;
alter table public.account_controls add column session_exception uuid;
alter table public.app_sessions add column auth_session_id uuid;

-- All session decisions serialize on the profile row, including set_customer_access.
-- Use Auth's original creation time, never the refreshed JWT's iat.
create function public.authorize_app_session(p_user uuid,p_session uuid,p_hash text,p_agent text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare control public.account_controls%rowtype; original_time timestamptz; tracked public.app_sessions%rowtype;
begin
  perform 1 from public.profiles where id=p_user for update;
  if not found then return jsonb_build_object('status','revoked'); end if;
  select * into control from public.account_controls where user_id=p_user;
  if control.suspended then return jsonb_build_object('status','suspended'); end if;
  select created_at into original_time from auth.sessions where id=p_session and user_id=p_user;
  if original_time is null or (original_time <= control.sessions_revoked_before
      and p_session is distinct from control.session_exception) then
    return jsonb_build_object('status','revoked');
  end if;
  insert into public.app_sessions(user_id,token_hash,user_agent,auth_session_id,created_at)
    values(p_user,p_hash,left(coalesce(p_agent,''),300),p_session,original_time)
    on conflict(token_hash) do nothing;
  select * into tracked from public.app_sessions where token_hash=p_hash and user_id=p_user;
  if not found or tracked.revoked_at is not null then return jsonb_build_object('status','revoked'); end if;
  update public.app_sessions set auth_session_id=p_session where id=tracked.id;
  return jsonb_build_object('status','ok','id',tracked.id);
end $$;

create function public.revoke_app_sessions(p_user uuid,p_id uuid default null,p_except uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare keep_session uuid; cutoff timestamptz;
begin
  perform 1 from public.profiles where id=p_user for update;
  if not found then return false; end if;
  if exists(select 1 from public.account_controls where user_id=p_user and suspended) then return false; end if;
  if p_except is not null then
    select auth_session_id into keep_session from public.app_sessions
      where id=p_except and user_id=p_user and revoked_at is null;
    if keep_session is null then return false; end if;
  end if;
  cutoff := clock_timestamp();
  if p_id is null then
    insert into public.account_controls(user_id,sessions_revoked_before,session_exception)
      values(p_user,cutoff,keep_session)
      on conflict(user_id) do update set sessions_revoked_before=excluded.sessions_revoked_before,
        session_exception=excluded.session_exception;
  end if;
  update public.app_sessions set revoked_at=coalesce(revoked_at,cutoff)
    where user_id=p_user and (p_id is null or id=p_id) and id is distinct from p_except;
  return p_id is null or found;
end $$;

-- Unblocking an account must not resurrect unregistered sessions from before suspension.
create function public.suspend_session_cutoff() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.suspended then
    new.sessions_revoked_before := clock_timestamp();
    new.session_exception := null;
  end if;
  return new;
end $$;
create trigger suspend_session_cutoff before insert or update of suspended on public.account_controls
  for each row execute function public.suspend_session_cutoff();
update public.account_controls set suspended=suspended where suspended;

revoke all on function public.authorize_app_session(uuid,uuid,text,text),
  public.revoke_app_sessions(uuid,uuid,uuid),public.suspend_session_cutoff() from public,anon,authenticated;
grant execute on function public.authorize_app_session(uuid,uuid,text,text),
  public.revoke_app_sessions(uuid,uuid,uuid) to service_role;
commit;
-- KEYNEST STEP 031_private_data_sessions END

-- KEYNEST STEP 032_seller_support BEGIN
begin;
-- A shared order conversation can contain another seller's delivery secrets.
-- Only conversations for orders fulfilled entirely by this seller are exposed.
create function public.seller_support(p_actor uuid,p_ticket uuid default null,p_body text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_ticket public.tickets%rowtype;
begin
  perform public.require_seller(p_actor);
  if p_body is not null then
    if char_length(btrim(p_body)) not between 3 and 3000 then raise exception 'Nội dung phải có 3–3000 ký tự'; end if;
    select * into target_ticket from public.tickets where id=p_ticket and deleted_at is null for update;
    if not found or target_ticket.order_id is null or not exists(select 1 from public.order_items where order_id=target_ticket.order_id and seller_id=p_actor)
      or exists(select 1 from public.order_items where order_id=target_ticket.order_id and seller_id is distinct from p_actor)
      then raise exception 'Không tìm thấy yêu cầu của gian hàng'; end if;
    if target_ticket.status='closed' then raise exception 'Yêu cầu đã đóng'; end if;
    insert into public.ticket_messages(ticket_id,author_id,role,body) values(target_ticket.id,p_actor,'seller',btrim(p_body));
    update public.tickets set updated_at=now() where id=target_ticket.id;
    insert into public.notifications(id,user_id,title,href)
      values('seller-reply:'||gen_random_uuid(),target_ticket.user_id,'Người bán đã phản hồi yêu cầu hỗ trợ','/support');
    return jsonb_build_object('ok',true);
  end if;
  return coalesce((select jsonb_agg(result order by result->>'updated_at' desc) from (
    select jsonb_build_object('id',t.id,'subject',t.subject,'message',t.message,'kind',t.kind,
      'status',t.status,'created_at',t.created_at,'updated_at',t.updated_at,'order_number',o.number,
      'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'role',m.role,'body',m.body,'created_at',m.created_at) order by m.created_at)
        from public.ticket_messages m where m.ticket_id=t.id),'[]'::jsonb)) result
    from public.tickets t join public.orders o on o.id=t.order_id
    where t.deleted_at is null and (p_ticket is null or t.id=p_ticket)
      and exists(select 1 from public.order_items where order_id=t.order_id and seller_id=p_actor)
      and not exists(select 1 from public.order_items where order_id=t.order_id and seller_id is distinct from p_actor)
  ) rows),'[]'::jsonb);
end $$;
revoke all on function public.seller_support(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.seller_support(uuid,uuid,text) to service_role;
commit;
-- KEYNEST STEP 032_seller_support END

-- KEYNEST STEP 033_seller_escrow_chat BEGIN
begin;

alter table public.order_items add column seller_hold_until timestamptz;
create index seller_unreleased on public.order_items(order_id) where seller_id is not null and seller_settled_at is null and seller_reversed_at is null;
create table public.seller_chat_messages (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.order_items(id),
 author_id uuid not null references public.profiles(id), body text not null check(char_length(btrim(body)) between 1 and 3000),
 request_id uuid not null, created_at timestamptz not null default now(), unique(author_id,request_id)
);
create index on public.seller_chat_messages(item_id,created_at,id);
-- Refunds use the existing whole-order refund workflow. One dispute per order.
create table public.seller_disputes (
 order_id uuid primary key references public.orders(id), item_id uuid not null references public.order_items(id),
 requested_by uuid not null references public.profiles(id), seller_id uuid not null references public.profiles(id),
 ticket_id uuid not null references public.tickets(id), reason text not null,
 status text not null default 'open' check(status in ('open','agreed','rejected','refunded')),
 resolution text not null default '', created_at timestamptz not null default now(), resolved_at timestamptz
);
alter table public.seller_chat_messages enable row level security;
alter table public.seller_disputes enable row level security;
revoke all on public.seller_chat_messages, public.seller_disputes from public,anon,authenticated;
grant all on public.seller_chat_messages, public.seller_disputes to service_role;

-- Existing credited revenue is left intact; uncredited revenue is escrowed.
create or replace function public.settle_seller_revenue(p_order uuid) returns void language plpgsql set search_path=public as $$
declare o orders; i order_items; u profiles; w seller_withdrawals; cumulative numeric:=0; previous numeric; gross bigint; fee bigint; net bigint; offset_amount bigint; credited bigint; deadline timestamptz;
begin
 select * into o from orders where id=p_order for update;
 if o.status not in ('processing','completed','refunded') then return; end if;
 perform 1 from profiles where id in (select seller_id from order_items where order_id=o.id) order by id for update;
 for i in select * from order_items where order_id=o.id order by id for update loop
  previous:=cumulative; cumulative:=cumulative+i.price::numeric*i.quantity;
  if i.seller_id is null or i.seller_reversed_at is not null then continue; end if;
  select * into u from profiles where id=i.seller_id;
  if o.status='refunded' then
   if i.seller_settled_at is null then
    update order_items set seller_reversed_at=now() where id=i.id;
    continue;
   end if;
   for w in select * from seller_withdrawals where user_id=u.id and status='pending' order by id for update loop
    update seller_withdrawals set status='cancelled',reason='Hủy để đối soát hoàn tiền đơn hàng',resolved_at=now() where id=w.id;
    update profiles set balance=balance+w.amount where id=u.id;
    insert into wallet_ledger(user_id,amount,description) values(u.id,w.amount,'Hủy yêu cầu rút '||w.id||' để đối soát');
   end loop;
   select * into u from profiles where id=i.seller_id;
   credited:=least(u.balance,i.seller_net);
   update profiles set balance=balance-credited,seller_debt=seller_debt+i.seller_net-credited where id=u.id;
   update order_items set seller_reversed_at=now() where id=i.id;
   insert into wallet_ledger(user_id,amount,description) values(u.id,-credited,'Thu hồi doanh thu '||o.number||' · '||i.name);
  elsif i.seller_settled_at is null then
   gross:=case when o.subtotal=0 then 0 else floor(cumulative*o.total/o.subtotal)-floor(previous*o.total/o.subtotal) end;
   fee:=floor(gross::numeric*i.seller_fee_bps/10000); net:=gross-fee;
   deadline:=i.delivered_at+interval '48 hours';
   update order_items set seller_gross=gross,seller_fee=fee,seller_net=net,seller_hold_until=deadline where id=i.id;
   if deadline is null or deadline>clock_timestamp() or exists(select 1 from seller_disputes where order_id=o.id and status in ('open','agreed')) then continue; end if;
   offset_amount:=least(u.seller_debt,net); credited:=net-offset_amount;
   update profiles set balance=balance+credited,seller_debt=seller_debt-offset_amount where id=u.id;
   update order_items set seller_settled_at=now() where id=i.id;
   insert into wallet_ledger(user_id,amount,description) values(u.id,credited,'Giải ngân sau 48 giờ / bù trừ '||o.number||' · '||i.name);
  end if;
 end loop;
 if o.status='refunded' then update seller_disputes set status='refunded',resolved_at=now() where order_id=o.id; end if;
end $$;

create function public.release_seller_funds(p_seller uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare oid uuid;
begin
 for oid in select o.id from public.orders o where o.status in ('processing','completed') and exists(
  select 1 from public.order_items i where i.order_id=o.id and i.seller_id is not null
   and (p_seller is null or i.seller_id=p_seller) and i.seller_settled_at is null and i.seller_reversed_at is null
   and i.delivered_at + interval '48 hours' <= clock_timestamp()
   and not exists(select 1 from public.seller_disputes d where d.order_id=o.id and d.status in ('open','agreed'))
 ) order by o.id for update of o skip locked limit 200 loop
  perform public.settle_seller_revenue(oid);
 end loop;
end $$;

create function public.seller_conversation(p_actor uuid,p_item uuid,p_action text default 'read',p_body text default '',p_request uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.order_items; o public.orders; d public.seller_disputes; tid uuid; actor_role text; old_message public.seller_chat_messages; message_id uuid;
begin
 select role into actor_role from public.profiles where id=p_actor;
 if actor_role is null or exists(select 1 from public.account_controls where user_id=p_actor and suspended) then raise exception 'Không có quyền truy cập'; end if;
 select * into i from public.order_items where id=p_item;
 if i.seller_id is null or exists(select 1 from public.profiles where id=i.seller_id and role='admin') then raise exception 'Sản phẩm này được hỗ trợ qua KEYNEST'; end if;
 -- Lock buyer before order, matching the existing refund transaction.
 if p_action='read' then
  select * into o from public.orders where id=i.order_id;
 else
  perform 1 from public.profiles where id=(select user_id from public.orders where id=i.order_id) for update;
  select * into o from public.orders where id=i.order_id for update;
  -- Re-read after acquiring the order lock: a release may have just committed.
  select * into i from public.order_items where id=p_item;
 end if;
 if p_actor not in (o.user_id,i.seller_id) and actor_role<>'admin' then raise exception 'Không có quyền truy cập cuộc trò chuyện'; end if;
 if p_action='message' then
  if actor_role='admin' or char_length(btrim(p_body)) not between 1 and 3000 or p_request is null then raise exception 'Tin nhắn không hợp lệ'; end if;
  select * into old_message from public.seller_chat_messages where author_id=p_actor and request_id=p_request;
  if found and (old_message.item_id<>p_item or old_message.body<>btrim(p_body)) then raise exception 'Mã gửi đã được sử dụng'; end if;
  insert into public.seller_chat_messages(item_id,author_id,body,request_id) values(p_item,p_actor,btrim(p_body),p_request) on conflict(author_id,request_id) do nothing returning id into message_id;
  if message_id is not null then
   insert into public.notifications(id,user_id,title,href) values('seller-chat:'||message_id,
    case when p_actor=o.user_id then i.seller_id else o.user_id end,
    'Tin nhắn mới · '||o.number||' · '||i.name,
    case when p_actor=o.user_id then '/seller?tab=sales' else '/orders/'||o.id end);
  end if;
 elsif p_action='request' then
  if actor_role='admin' or char_length(btrim(p_body)) not between 10 and 2000 or o.status not in ('processing','completed') then raise exception 'Không thể yêu cầu hoàn tiền'; end if;
  -- The order lock serializes the request against release, including deadline races.
  if i.seller_settled_at is not null or i.seller_reversed_at is not null or (i.delivered_at is not null and i.delivered_at+interval '48 hours'<=clock_timestamp()) then raise exception 'Đã hết thời gian giữ tiền. Liên hệ Trung tâm hỗ trợ'; end if;
  if exists(select 1 from public.seller_disputes where order_id=o.id) then raise exception 'Đơn đã có yêu cầu hoàn tiền. Tiếp tục trao đổi với hỗ trợ'; end if;
  select id into tid from public.tickets where order_id=o.id and kind='warranty' and status in ('open','in_progress') limit 1;
  if tid is null then
   insert into public.tickets(user_id,order_id,kind,subject,message) values(o.user_id,o.id,'warranty','Yêu cầu hoàn tiền '||o.number,btrim(p_body)) returning id into tid;
  end if;
  insert into public.seller_disputes(order_id,item_id,requested_by,seller_id,ticket_id,reason) values(o.id,i.id,p_actor,i.seller_id,tid,btrim(p_body));
 elsif p_action in ('agree','reject','refund') then
  select * into d from public.seller_disputes where order_id=o.id and item_id=p_item for update;
  if not found or d.status not in ('open','agreed') then raise exception 'Yêu cầu đã xử lý hoặc không tồn tại'; end if;
  if p_action='agree' then
   if p_actor=d.requested_by or p_actor not in (o.user_id,d.seller_id) then raise exception 'Chỉ bên còn lại được xác nhận đồng ý'; end if;
   update public.seller_disputes set status='agreed' where order_id=o.id;
  else
   if actor_role<>'admin' or char_length(btrim(p_body)) not between 10 and 2000 then raise exception 'Cần quản trị viên và lý do xử lý'; end if;
   if p_action='refund' then
    perform public.resolve_warranty_refund(o.id,d.ticket_id,p_actor,'wallet',btrim(p_body),'');
   end if;
   update public.seller_disputes set status=case when p_action='refund' then 'refunded' else 'rejected' end,resolution=btrim(p_body),resolved_at=now() where order_id=o.id;
   insert into public.audit_logs(user_id,action,target) values(p_actor,'seller_dispute_'||p_action,o.id::text);
  end if;
 elsif p_action<>'read' then raise exception 'Thao tác không hợp lệ'; end if;
 return jsonb_build_object('item_id',i.id,'name',i.name,'seller_name',i.seller_name,'order_number',o.number,'order_status',o.status,'order_total',o.total,
  'seller_hold_until',i.delivered_at+interval '48 hours','seller_settled_at',i.seller_settled_at,
  'can_request',p_actor in(o.user_id,i.seller_id) and o.status in('processing','completed') and i.seller_settled_at is null and i.seller_reversed_at is null and (i.delivered_at is null or i.delivered_at+interval '48 hours'>clock_timestamp()),
  'dispute',(select case when s.item_id=p_item or actor_role='admin' or p_actor=o.user_id then to_jsonb(s)||jsonb_build_object('can_agree',s.item_id=p_item and p_actor<>s.requested_by and p_actor in(o.user_id,s.seller_id)) else jsonb_build_object('status',s.status,'can_agree',false) end from public.seller_disputes s where s.order_id=o.id),
  'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (
   select id,body,created_at,case when author_id=o.user_id then 'customer' else 'seller' end as role from public.seller_chat_messages where item_id=p_item order by created_at desc,id desc limit 200
  ) m),'[]'::jsonb));
end $$;
revoke all on function public.release_seller_funds(uuid),public.seller_conversation(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.release_seller_funds(uuid),public.seller_conversation(uuid,uuid,text,text,uuid) to service_role;

-- A changed payout policy requires one acceptance of the new version.
do $$ declare definition text; signature text; begin
 foreach signature in array array['public.require_seller(uuid)','public.seller_command(uuid,text,jsonb)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  definition:=replace(definition,'2026-10-11-v1','2026-10-14-v2');
  definition:=replace(definition,'seller_terms_accepted_at=coalesce(seller_terms_accepted_at,now())',
   'seller_terms_accepted_at=case when seller_terms_version=p_data->>''terms_version'' then coalesce(seller_terms_accepted_at,now()) else now() end');
  execute definition;
 end loop;
end $$;
commit;
-- KEYNEST STEP 033_seller_escrow_chat END

-- KEYNEST STEP 034_revoke_provider_session BEGIN
begin;

-- A locally revoked device must also lose access to Supabase Auth endpoints.
-- No browser grants on auth.sessions: deletion stays inside this service RPC.
create or replace function public.revoke_app_sessions(p_user uuid,p_id uuid default null,p_except uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare keep_session uuid; target_session uuid; cutoff timestamptz;
begin
  perform 1 from public.profiles where id=p_user for update;
  if not found then return false; end if;
  if exists(select 1 from public.account_controls where user_id=p_user and suspended) then return false; end if;
  if p_except is not null then
    select auth_session_id into keep_session from public.app_sessions
      where id=p_except and user_id=p_user and revoked_at is null;
    if keep_session is null then return false; end if;
  end if;
  cutoff := clock_timestamp();
  if p_id is not null then
    select auth_session_id into target_session from public.app_sessions
      where id=p_id and user_id=p_user and id is distinct from p_except for update;
    if not found then return false; end if;
    if target_session is null then
      raise exception 'Phiên cũ chưa có mã thiết bị. Hãy dùng Thu hồi các phiên khác';
    end if;
    update public.app_sessions set revoked_at=coalesce(revoked_at,cutoff)
      where id=p_id and user_id=p_user;
    -- Auth rejects a missing session_id; dependent refresh tokens are removed
    -- by Auth's foreign-key cascade. Never delete by a client-supplied Auth ID.
    delete from auth.sessions where id=target_session and user_id=p_user;
    return true;
  end if;
  insert into public.account_controls(user_id,sessions_revoked_before,session_exception)
    values(p_user,cutoff,keep_session)
    on conflict(user_id) do update set sessions_revoked_before=excluded.sessions_revoked_before,
      session_exception=excluded.session_exception;
  update public.app_sessions set revoked_at=coalesce(revoked_at,cutoff)
    where user_id=p_user and id is distinct from p_except;
  -- Bulk provider revocation continues through Auth's signOut API in Node.
  return true;
end $$;

revoke all on function public.revoke_app_sessions(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_app_sessions(uuid,uuid,uuid) to service_role;

-- Close the same gap for previously revoked, identified devices.
delete from auth.sessions s using public.app_sessions a
  where a.auth_session_id=s.id and a.user_id=s.user_id and a.revoked_at is not null;

commit;
-- KEYNEST STEP 034_revoke_provider_session END

-- KEYNEST STEP 035_preorders BEGIN
begin;
-- Preorders use paid/manual fulfillment. stock counts remaining reservations.
alter table public.variants add column is_preorder boolean not null default false,
  add column expected_delivery date,
  add constraint preorder_delivery check(not is_preorder or (delivery='manual' and expected_delivery is not null));
alter table public.order_items add column is_preorder boolean not null default false,
  add column expected_delivery date;
create or replace function public.save_variant(p_product uuid,p_data jsonb) returns uuid
language plpgsql set search_path=public as $$ declare vid uuid; begin
 vid:=save_variant_core(p_product,p_data);
 if p_data ? 'warranty_days' then update variants set warranty_days=(p_data->>'warranty_days')::integer where id=vid; end if;
 if p_data ? 'is_preorder' then
  update variants set is_preorder=(p_data->>'is_preorder')::boolean,
   expected_delivery=case when (p_data->>'is_preorder')::boolean then (p_data->>'expected_delivery')::date else null end where id=vid;
 end if;
 return vid;
end $$;
create function public.snapshot_preorder() returns trigger language plpgsql set search_path='' as $$
declare v public.variants;
begin
 select * into v from public.variants where id=new.variant_id;
 new.is_preorder:=v.is_preorder; new.expected_delivery:=v.expected_delivery;
 if v.is_preorder and v.expected_delivery < (now() at time zone 'Asia/Ho_Chi_Minh')::date then
  raise exception 'Đợt đặt trước đã hết hạn. Vui lòng chờ cửa hàng cập nhật ngày giao';
 end if;
 return new;
end $$;
create trigger preorder_snapshot before insert on public.order_items for each row execute function public.snapshot_preorder();
do $$ declare definition text; old_check text := 'if length(trim(p_payload->>''customer_note''))=0 then'; begin
 select pg_get_functiondef('public.create_order_before_sellers(uuid,jsonb,uuid)'::regprocedure) into definition;
 if position(old_check in definition)=0 then raise exception 'Unexpected create_order implementation'; end if;
 execute replace(definition,old_check,'if not v.is_preorder and length(trim(p_payload->>''customer_note''))=0 then');
end $$;
revoke all on function public.snapshot_preorder() from public,anon,authenticated;
commit;
-- KEYNEST STEP 035_preorders END

-- KEYNEST STEP 036_order_receipts BEGIN
begin;
create table public.order_receipts (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references public.orders(id),
 payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_until timestamptz,
 claim_token uuid,
 last_error text,
 sent_at timestamptz,
 created_at timestamptz not null default now()
);
create index order_receipts_pending on public.order_receipts(available_at) where status in ('pending','sending');
alter table public.order_receipts enable row level security;
revoke all on public.order_receipts from public,anon,authenticated;
grant select,insert,update on public.order_receipts to service_role;

-- Deferred until items and wallet/bank payment changes have all committed.
-- No old orders are backfilled. Unique order_id deduplicates repeated webhooks.
create function public.queue_order_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; recipient text;
begin
 select * into o from public.orders where id=new.id;
 if o.paid_at is null or o.status not in ('processing','completed') then return null; end if;
 select email into recipient from auth.users where id=o.user_id;
 if recipient is null or recipient='' then return null; end if;
 insert into public.order_receipts(order_id,payload) values(o.id,jsonb_build_object(
  'id',o.id,'number',o.number,'email',recipient,'paid_at',o.paid_at,'method',o.method,
  'subtotal',o.subtotal,'discount',o.discount,'total',o.total,
  'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.name,'variant_name',i.variant_name,
   'price',i.price,'quantity',i.quantity,'is_preorder',i.is_preorder,'expected_delivery',i.expected_delivery) order by i.id)
   from public.order_items i where i.order_id=o.id),'[]'::jsonb))) on conflict(order_id) do nothing;
 return null;
end $$;
create constraint trigger order_receipt_paid after insert or update of status on public.orders
 deferrable initially deferred for each row execute function public.queue_order_receipt();

create function public.claim_order_receipt() returns setof public.order_receipts language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 update public.order_receipts set status='failed',last_error='worker_lease_exhausted',claim_token=null,lease_until=null
  where status='sending' and lease_until<=now() and attempts>=8;
 select id into target from public.order_receipts
 where attempts<8 and ((status='pending' and available_at<=now()) or (status='sending' and lease_until<=now()))
 order by available_at,id for update skip locked limit 1;
 if target is null then return; end if;
 return query update public.order_receipts set status='sending',attempts=attempts+1,
  lease_until=now()+interval '2 minutes',claim_token=gen_random_uuid() where id=target returning *;
end $$;
create function public.finish_order_receipt(p_id uuid,p_claim uuid,p_sent boolean,p_error text default '') returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.order_receipts set status=case when p_sent then 'sent' when attempts>=8 then 'failed' else 'pending' end,
  sent_at=case when p_sent then now() else null end,lease_until=null,claim_token=null,
  last_error=case when p_sent then null else left(p_error,100) end,
  available_at=now()+make_interval(secs=>least(3600,30*(2^attempts)::int))
 where id=p_id and claim_token=p_claim and status='sending';
 return found;
end $$;
revoke all on function public.queue_order_receipt(),public.claim_order_receipt(),public.finish_order_receipt(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_order_receipt(),public.finish_order_receipt(uuid,uuid,boolean,text) to service_role;
commit;
-- KEYNEST STEP 036_order_receipts END

-- KEYNEST STEP 037_tingee_payments BEGIN
begin;
-- Existing payments retain their original transfer instructions. New payments
-- cannot be credited by a provider until routing is durably committed.
create table public.payment_routes (
 payment_id uuid primary key references public.payments(id),
 provider text check(provider in ('tingee','pay2s','sepay')),
 state text not null default 'unassigned' check(state in ('unassigned','creating','ready','failed')),
 claim_token uuid, lease_until timestamptz, attempts integer not null default 0,
 bill_id text unique, qr_account text, qr_image text, qr_expires_at timestamptz,
 bank text, account text, account_name text,
 bank_bin text, va_account text,
 next_poll_at timestamptz not null default now(), remote_closed boolean not null default false,
 last_error text, created_at timestamptz not null default now()
);
create index payment_routes_poll on public.payment_routes(next_poll_at) where provider='tingee' and state='ready' and not remote_closed;
alter table public.payment_routes enable row level security;
revoke all on public.payment_routes from public,anon,authenticated;
grant select,insert,update on public.payment_routes to service_role;
create function public.new_payment_route() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.payment_routes(payment_id) values(new.id); return new; end $$;
create trigger new_payment_route after insert on public.payments for each row execute function public.new_payment_route();

create function public.claim_payment_route(p_id uuid,p_claim uuid) returns setof public.payment_routes
language plpgsql security definer set search_path='' as $$
begin
 -- Same lock order as settlement/expiry: payment, then route.
 perform 1 from public.payments where id=p_id and status='pending' and expires_at>now() for update;
 if found then
  update public.payment_routes set state='creating',claim_token=p_claim,lease_until=now()+interval '45 seconds',attempts=attempts+1
  where payment_id=p_id and (state='unassigned' or (state='creating' and lease_until<=now()));
 end if;
 return query select * from public.payment_routes where payment_id=p_id;
end $$;
create function public.finish_payment_route(p_id uuid,p_claim uuid,p_data jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.payments where id=p_id and status='pending' and expires_at>now() for update;
 if not found then return false; end if;
 if p_data->>'provider'='tingee' and (coalesce(p_data->>'bill_id','')='' or coalesce(p_data->>'qr_account','')='' or coalesce(p_data->>'qr_image','')='') then raise exception 'Missing dynamic QR'; end if;
 update public.payment_routes set state=case when p_data->>'provider' is null then 'failed' else 'ready' end,
  provider=p_data->>'provider',bill_id=p_data->>'bill_id',qr_account=p_data->>'qr_account',qr_image=p_data->>'qr_image',
  bank=p_data->>'bank',account=p_data->>'account',account_name=p_data->>'account_name',
  bank_bin=p_data->>'bank_bin',va_account=p_data->>'va_account',qr_expires_at=(p_data->>'expires_at')::timestamptz,
  last_error=p_data->>'error',claim_token=null,lease_until=null
 where payment_id=p_id and state='creating' and claim_token=p_claim;
 if not found then return false; end if;
 if p_data->>'provider'='tingee' then
  update public.payments set expires_at=least(expires_at,(p_data->>'expires_at')::timestamptz) where id=p_id;
 end if;
 return true;
end $$;

create function public.claim_tingee_polls() returns setof jsonb language plpgsql security definer set search_path='' as $$
declare r public.payment_routes; p public.payments;
begin
 for r in select * from public.payment_routes where provider='tingee' and state='ready' and not remote_closed
  and next_poll_at<=now() order by next_poll_at,payment_id for update skip locked limit 20 loop
  -- Lease covers all five batches, each with up to three 8-second API calls.
  update public.payment_routes set next_poll_at=now()+interval '3 minutes' where payment_id=r.payment_id;
  select * into p from public.payments where id=r.payment_id;
  return next to_jsonb(r)||jsonb_build_object('payment',to_jsonb(p));
 end loop;
end $$;

-- Only authenticated provider data can reach this service-only RPC. Guard
-- source and amount at the same time as settlement, including fallback races.
create function public.settle_routed_payment(p_source text,p_transaction text,p_code text,p_amount bigint,p_bill text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payments; r public.payment_routes;
begin
 perform public.expire_payments();
 select * into p from public.payments where code=p_code for update;
 if found then
  select * into r from public.payment_routes where payment_id=p.id;
  if (found and (r.state<>'ready' or r.provider is distinct from p_source or (p_source='tingee' and r.bill_id is distinct from p_bill)))
     or (not found and p_source='tingee') then
   -- A second provider can report the same bank transfer. Never offer that
   -- report for manual credit while the assigned provider is reconciling it.
   insert into public.payment_events(transaction_id,code,amount,outcome) values(p_transaction,p_code,p_amount,'provider_mismatch') on conflict do nothing;
   return jsonb_build_object('ignored',true);
  end if;
 end if;
 if p_source not in ('tingee','pay2s','sepay') then raise exception 'Invalid payment source'; end if;
 return public.settle_payment(p_transaction,p_code,p_amount);
end $$;
revoke all on function public.new_payment_route(),public.claim_payment_route(uuid,uuid),public.finish_payment_route(uuid,uuid,jsonb),public.claim_tingee_polls(),public.settle_routed_payment(text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.claim_payment_route(uuid,uuid),public.finish_payment_route(uuid,uuid,jsonb),public.claim_tingee_polls(),public.settle_routed_payment(text,text,text,bigint,text) to service_role;
commit;
-- KEYNEST STEP 037_tingee_payments END

-- KEYNEST STEP 038_tingee_static_qr BEGIN
begin;
-- Existing dynamic bills keep their original reconciliation path.
alter table public.payment_routes add column if not exists qr_kind text not null default 'dynamic' check(qr_kind in ('static','dynamic'));

create or replace function public.finish_payment_route(p_id uuid,p_claim uuid,p_data jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.payments where id=p_id and status='pending' and expires_at>now() for update;
 if not found then return false; end if;
 if coalesce(p_data->>'qr_kind','dynamic') not in ('static','dynamic') then raise exception 'Invalid QR kind'; end if;
 if p_data->>'provider'='tingee' and ((coalesce(p_data->>'qr_kind','dynamic')='dynamic' and coalesce(p_data->>'bill_id','')='') or coalesce(p_data->>'qr_account','')='' or coalesce(p_data->>'qr_image','')='') then raise exception 'Missing QR'; end if;
 update public.payment_routes set state=case when p_data->>'provider' is null then 'failed' else 'ready' end,
  qr_kind=coalesce(p_data->>'qr_kind','dynamic'),provider=p_data->>'provider',bill_id=p_data->>'bill_id',qr_account=p_data->>'qr_account',qr_image=p_data->>'qr_image',
  bank=p_data->>'bank',account=p_data->>'account',account_name=p_data->>'account_name',
  bank_bin=p_data->>'bank_bin',va_account=p_data->>'va_account',qr_expires_at=(p_data->>'expires_at')::timestamptz,
  last_error=p_data->>'error',claim_token=null,lease_until=null
 where payment_id=p_id and state='creating' and claim_token=p_claim;
 if not found then return false; end if;
 if p_data->>'provider'='tingee' then
  update public.payments set expires_at=least(expires_at,(p_data->>'expires_at')::timestamptz) where id=p_id;
 end if;
 return true;
end $$;

create or replace function public.settle_routed_payment(p_source text,p_transaction text,p_code text,p_amount bigint,p_bill text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payments; r public.payment_routes;
begin
 perform public.expire_payments();
 select * into p from public.payments where code=p_code for update;
 if found then
  select * into r from public.payment_routes where payment_id=p.id;
  if (found and (r.state<>'ready' or r.provider is distinct from p_source or (p_source='tingee' and (r.qr_kind<>'dynamic' or r.bill_id is distinct from p_bill))))
     or (not found and p_source='tingee') then
   -- A second provider can report the same bank transfer. Never offer that
   -- report for manual credit while the assigned provider is reconciling it.
   insert into public.payment_events(transaction_id,code,amount,outcome) values(p_transaction,p_code,p_amount,'provider_mismatch') on conflict do nothing;
   return jsonb_build_object('ignored',true);
  end if;
 end if;
 if p_source not in ('tingee','pay2s','sepay') then raise exception 'Invalid payment source'; end if;
 return public.settle_payment(p_transaction,p_code,p_amount);
end $$;

-- Only server-verified CREDIT transactions from the signed history API reach here.
-- Persist source identity so retries and two payments cannot spend the same transfer.
create function public.settle_tingee_static(p_transaction text,p_code text,p_amount bigint,p_account text,p_bank text,p_time timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payments; r public.payment_routes;
begin
 perform public.expire_payments();
 select * into p from public.payments where code=p_code for update;
 if not found then return jsonb_build_object('ignored',true); end if;
 select * into r from public.payment_routes where payment_id=p.id;
 if not found or r.provider is distinct from 'tingee' or r.state<>'ready' or r.qr_kind<>'static'
   or p_account is distinct from r.account or p_bank is distinct from r.bank_bin
   or p_time is null or p_time < date_trunc('second',p.created_at) or p_time > clock_timestamp()+interval '5 minutes'
   or p_transaction is null or p_transaction !~ '^tingee-static:[a-f0-9]{64}$' or p_amount is null or p_amount<=0 then
  return jsonb_build_object('ignored',true);
 end if;
 if p_time > p.expires_at then
  insert into public.payment_events(transaction_id,code,amount,outcome) values(p_transaction,p_code,p_amount,'needs_review') on conflict do nothing;
  return jsonb_build_object('review',true);
 end if;
 return public.settle_payment(p_transaction,p_code,p_amount);
end $$;
revoke all on function public.settle_tingee_static(text,text,bigint,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_tingee_static(text,text,bigint,text,text,timestamptz) to service_role;
commit;
-- KEYNEST STEP 038_tingee_static_qr END

-- KEYNEST STEP 039_tingee_late_wallet_credit BEGIN
begin;

-- Tingee may expose a bank credit only after a static QR's payment deadline.
-- A verified wallet top-up received before that deadline is safe to credit
-- even if polling observes it later. Expired orders still require review since
-- their reserved inventory may already have been released.
create or replace function public.settle_tingee_static(
  p_transaction text,
  p_code text,
  p_amount bigint,
  p_account text,
  p_bank text,
  p_time timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
  r public.payment_routes;
  e public.payment_events;
begin
  perform public.expire_payments();

  select * into p
  from public.payments
  where code = p_code
  for update;
  if not found then return jsonb_build_object('ignored', true); end if;

  select * into r
  from public.payment_routes
  where payment_id = p.id
  for update;
  if not found
     or r.provider is distinct from 'tingee'
     or r.state <> 'ready'
     or r.qr_kind <> 'static'
     or p_account is distinct from r.account
     or p_bank is distinct from r.bank_bin
     or p_time is null
     or p_time < date_trunc('second', p.created_at)
     or p_time > clock_timestamp() + interval '5 minutes'
     or p_transaction is null
     or p_transaction !~ '^tingee-static:[a-f0-9]{64}$'
     or p_amount is null
     or p_amount <= 0 then
    return jsonb_build_object('ignored', true);
  end if;

  if p_time > p.expires_at then
    insert into public.payment_events(transaction_id, code, amount, outcome)
    values (p_transaction, p_code, p_amount, 'needs_review')
    on conflict (transaction_id) do nothing;
    return jsonb_build_object('review', true);
  end if;

  -- For wallet top-ups, timestamp and exact amount prove that the transfer
  -- was made in time. Handle pending or expired rows directly because the
  -- shared settle_payment() intentionally rejects expired payments.
  if p.order_id is null
     and p.status in ('pending', 'expired')
     and p.amount = p_amount then
    select * into e
    from public.payment_events
    where transaction_id = p_transaction
    for update;

    if found then
      if e.code is distinct from p_code or e.amount is distinct from p_amount then
        return jsonb_build_object('ignored', true);
      end if;
      if e.outcome in ('paid', 'credited') then
        return jsonb_build_object('duplicate', true);
      end if;
      if e.outcome not in ('received', 'needs_review') then
        return jsonb_build_object('ignored', true);
      end if;
      update public.payment_events
      set outcome = 'received', reason = null
      where transaction_id = p_transaction;
    else
      insert into public.payment_events(transaction_id, code, amount, outcome)
      values (p_transaction, p_code, p_amount, 'received')
      on conflict (transaction_id) do nothing;

      if not found then
        select * into e
        from public.payment_events
        where transaction_id = p_transaction
        for update;
        if not found
           or e.code is distinct from p_code
           or e.amount is distinct from p_amount then
          return jsonb_build_object('ignored', true);
        end if;
        if e.outcome in ('paid', 'credited') then
          return jsonb_build_object('duplicate', true);
        end if;
        if e.outcome not in ('received', 'needs_review') then
          return jsonb_build_object('ignored', true);
        end if;
        update public.payment_events
        set outcome = 'received', reason = null
        where transaction_id = p_transaction;
      end if;
    end if;

    update public.profiles
    set balance = balance + p_amount
    where id = p.user_id;
    if not found then raise exception 'Payment owner profile is missing'; end if;

    insert into public.wallet_ledger(user_id, amount, description)
    values (p.user_id, p_amount, 'Nạp ví ' || p_code);

    update public.payments
    set status = 'paid', transaction_id = p_transaction
    where id = p.id;

    update public.payment_events
    set outcome = 'paid'
    where transaction_id = p_transaction;

    return jsonb_build_object('paid', true);
  end if;

  -- Preserve the standard path for in-deadline orders and route all other
  -- cases (late transfer, wrong amount, cancelled payment) to review.
  return public.settle_payment(p_transaction, p_code, p_amount);
end;
$$;

revoke all on function public.settle_tingee_static(text, text, bigint, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.settle_tingee_static(text, text, bigint, text, text, timestamptz)
  to service_role;

commit;
-- KEYNEST STEP 039_tingee_late_wallet_credit END

-- KEYNEST STEP 040_variant_visibility_delivery_receipts BEGIN
begin;
alter table public.variants add column active boolean not null default true;
do $$ declare definition text; begin
 select pg_get_functiondef('public.save_variant(uuid,jsonb)'::regprocedure) into definition;
 execute replace(definition,'return vid;', 'if p_data ? ''active'' then update public.variants set active=(p_data->>''active'')::boolean where id=vid; end if; return vid;');
 select pg_get_functiondef('public.snapshot_preorder()'::regprocedure) into definition;
 execute replace(definition,'new.is_preorder:=v.is_preorder;', 'if not v.active then raise exception ''Gói sản phẩm đã ngừng bán''; end if; new.is_preorder:=v.is_preorder;');
 select pg_get_functiondef('public.catalog_search(jsonb)'::regprocedure) into definition;
 execute replace(definition,'v.product_id=p.id','v.product_id=p.id and v.active');
end $$;

alter table public.order_receipts drop constraint order_receipts_order_id_key;
alter table public.order_receipts add column kind text not null default 'payment' check(kind in ('payment','delivery'));
alter table public.order_receipts add constraint order_receipts_order_kind_key unique(order_id,kind);

-- Snapshots contain encrypted inventory only. Decryption happens in the email worker.
do $$ declare definition text; begin
 select pg_get_functiondef('public.queue_order_receipt()'::regprocedure) into definition;
 definition:=replace(definition,'''expected_delivery'',i.expected_delivery)', '''expected_delivery'',i.expected_delivery,''delivered_at'',i.delivered_at,''encrypted_keys'',coalesce((select jsonb_agg(k.secret order by k.id) from public.inventory k where k.order_id=o.id and k.item_id=i.id),''[]''::jsonb))');
 definition:=replace(definition,'on conflict(order_id)', 'on conflict(order_id,kind)');
 execute definition;
end $$;

create function public.queue_delivery_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; recipient text;
begin
 select * into o from public.orders where id=new.order_id;
 if o.paid_at is null or o.status not in ('processing','completed') then return null; end if;
 if not exists(select 1 from public.order_items where order_id=o.id and delivery='manual')
   or exists(select 1 from public.order_items where order_id=o.id and delivered_at is null) then return null; end if;
 select email into recipient from auth.users where id=o.user_id;
 if recipient is null or recipient='' then return null; end if;
 insert into public.order_receipts(order_id,kind,payload) values(o.id,'delivery',jsonb_build_object(
  'id',o.id,'number',o.number,'email',recipient,'paid_at',o.paid_at,'method',o.method,'kind','delivery',
  'subtotal',o.subtotal,'discount',o.discount,'total',o.total,
  'items',(select jsonb_agg(jsonb_build_object('name',i.name,'variant_name',i.variant_name,'quantity',i.quantity,'price',i.price,
    'is_preorder',i.is_preorder,'expected_delivery',i.expected_delivery,'delivered_at',i.delivered_at,
    'encrypted_keys',coalesce((select jsonb_agg(k.secret order by k.id) from public.inventory k where k.order_id=o.id and k.item_id=i.id),'[]'::jsonb)) order by i.id)
    from public.order_items i where i.order_id=o.id))) on conflict(order_id,kind) do nothing;
 return null;
end $$;
create constraint trigger order_delivery_receipt after update of delivered_at on public.order_items
 deferrable initially deferred for each row execute function public.queue_delivery_receipt();
revoke all on function public.queue_delivery_receipt() from public,anon,authenticated;
commit;
-- KEYNEST STEP 040_variant_visibility_delivery_receipts END

-- KEYNEST STEP 041_allow_repeated_inventory_data BEGIN
begin;
-- Each inventory row is one sellable unit, even when its contents match
-- another row. Allocation and warranty tracking continue to use inventory.id.
alter table public.inventory drop constraint inventory_variant_id_secret_hash_key;
commit;
-- KEYNEST STEP 041_allow_repeated_inventory_data END

-- KEYNEST STEP 042_unlimited_shared_key BEGIN
begin;
alter table public.variants add column unlimited boolean not null default false;
alter table public.variants add constraint unlimited_key_only check(not unlimited or (delivery='key' and not is_preorder));
create table public.variant_shared_keys (
 variant_id uuid primary key references public.variants(id) on delete cascade,
 secret text not null,
 secret_hash text not null
);
alter table public.variant_shared_keys enable row level security;
revoke all on public.variant_shared_keys from public,anon,authenticated;
grant select,insert,update,delete on public.variant_shared_keys to service_role;

create or replace function public.save_variant(p_product uuid,p_data jsonb) returns uuid
language plpgsql set search_path=public as $$ declare vid uuid; old public.variants; unlimited_mode boolean; begin
 if p_data->>'id' is not null then
  select * into old from variants where id=(p_data->>'id')::uuid and product_id=p_product for update;
  if not found then raise exception 'Không tìm thấy gói'; end if;
 end if;
 unlimited_mode:=coalesce((p_data->>'unlimited')::boolean,old.unlimited,false);
 if old.id is not null and old.unlimited<>unlimited_mode then raise exception 'Hãy tạo gói mới để đổi chế độ kho'; end if;
 if unlimited_mode and (p_data->>'delivery'<>'key' or coalesce((p_data->>'is_preorder')::boolean,false)) then raise exception 'Gói dùng chung key phải giao mã tự động'; end if;
 if unlimited_mode and old.id is null and coalesce(p_data->'shared_key'->>'secret','')='' then raise exception 'Cần nhập key dùng chung'; end if;
 vid:=save_variant_core(p_product,p_data);
 if p_data ? 'warranty_days' then update variants set warranty_days=(p_data->>'warranty_days')::integer where id=vid; end if;
 if p_data ? 'is_preorder' then update variants set is_preorder=(p_data->>'is_preorder')::boolean,
 expected_delivery=case when (p_data->>'is_preorder')::boolean then (p_data->>'expected_delivery')::date else null end where id=vid; end if;
 if p_data ? 'active' then update variants set active=(p_data->>'active')::boolean where id=vid; end if;
 -- Availability compatibility for existing catalog/cart clients. Never decremented.
 update variants set unlimited=unlimited_mode,stock=case when unlimited_mode then 100000 else stock end where id=vid;
 if unlimited_mode and coalesce(p_data->'shared_key'->>'secret','')<>'' then
  insert into variant_shared_keys(variant_id,secret,secret_hash) values(vid,p_data->'shared_key'->>'secret',p_data->'shared_key'->>'hash')
  on conflict(variant_id) do update set secret=excluded.secret,secret_hash=excluded.secret_hash;
 end if;
 return vid;
end $$;

do $$ declare definition text; needle text; begin
 select pg_get_functiondef('public.create_order_before_sellers(uuid,jsonb,uuid)'::regprocedure) into definition;
 needle:='update variants set stock=stock-n where id=v.id;';
 if position(needle in definition)=0 then raise exception 'Unexpected checkout implementation'; end if;
 definition:=replace(definition,needle,'if not v.unlimited then update variants set stock=stock-n where id=v.id; end if;');
 needle:='if v.delivery=''key'' then for j in 1..n loop';
 if position(needle in definition)=0 then raise exception 'Unexpected key allocation implementation'; end if;
 definition:=replace(definition,needle,'if v.unlimited then
   if not exists(select 1 from public.variant_shared_keys where variant_id=v.id) then raise exception ''Chưa cấu hình key dùng chung''; end if;
   insert into public.inventory(variant_id,secret,secret_hash,order_id,item_id)
    select v.id,k.secret,k.secret_hash,oid,iid from public.variant_shared_keys k cross join generate_series(1,n) where k.variant_id=v.id;
  elsif v.delivery=''key'' then for j in 1..n loop');
 execute definition;
 select pg_get_functiondef('public.release_order(uuid)'::regprocedure) into definition;
 definition:=replace(definition,'where id=i.variant_id;', 'where id=i.variant_id and not unlimited;');
 definition:=replace(definition,'update inventory set order_id=null,item_id=null where order_id=p_order;', 'delete from public.inventory k using public.variants v where k.variant_id=v.id and v.unlimited and k.order_id=p_order; update inventory set order_id=null,item_id=null where order_id=p_order;');
 execute definition;
 select pg_get_functiondef('public.import_keys(uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'v.delivery<>''key''', '(v.delivery<>''key'' or v.unlimited)');
 execute definition;
end $$;
commit;
-- KEYNEST STEP 042_unlimited_shared_key END

-- KEYNEST STEP 043_product_delivery_kind BEGIN
begin;
alter table public.products add column product_kind text not null default 'key'
  check (product_kind in ('key','account','source','product','service'));
alter table public.order_items add column product_kind text not null default 'key'
  check (product_kind in ('key','account','source','product','service'));

-- Preserve the purchased classification independently of later catalog edits.
create function public.snapshot_product_kind() returns trigger
language plpgsql set search_path='' as $$
begin
  select p.product_kind into new.product_kind from public.products p where p.id=new.product_id;
  return new;
end $$;
create trigger order_product_kind before insert on public.order_items
  for each row execute function public.snapshot_product_kind();
revoke all on function public.snapshot_product_kind() from public,anon,authenticated;

-- Seller edits use the same field and existing ownership checks.
do $$ declare definition text; marker text; begin
  select pg_get_functiondef('public.seller_command(uuid,text,jsonb)'::regprocedure) into definition;
  marker := 'insert into audit_logs(user_id,action,target) values(p_actor,''seller_product'',target::text);';
  if strpos(definition,marker)=0 then raise exception 'seller product marker not found'; end if;
  execute replace(definition,marker,
    'if p_data ? ''product_kind'' then update products set product_kind=p_data->>''product_kind'' where id=target; end if; ' || marker);
end $$;
commit;
-- KEYNEST STEP 043_product_delivery_kind END

-- KEYNEST STEP 044_account_carts BEGIN
begin;
create table public.account_carts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  items jsonb not null default '[]' check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=20),
  updated_at timestamptz not null default now()
);
alter table public.account_carts enable row level security;
revoke all on public.account_carts from public,anon,authenticated;
grant select,insert,update,delete on public.account_carts to service_role;
commit;
-- KEYNEST STEP 044_account_carts END

-- KEYNEST STEP 045_seller_product_review BEGIN
begin;
alter table public.products
 add column review_status text not null default 'pending' check(review_status in ('pending','approved','rejected')),
 add column review_reason text not null default '',
 add column review_version integer not null default 1;
-- Existing seller listings also require inspection; purchased orders are unchanged.
update public.products set active=false where seller_id is not null;
create function public.guard_product_review() returns trigger language plpgsql set search_path='' as $$
begin
 if new.seller_id is null then return new; end if;
 if tg_op='INSERT' then new.review_status:='pending'; new.review_version:=1;
 elsif (to_jsonb(new)-array['active','featured','sort_order','review_status','review_reason','review_version']) is distinct from
       (to_jsonb(old)-array['active','featured','sort_order','review_status','review_reason','review_version']) then
  new.review_status:='pending'; new.review_reason:=''; new.review_version:=old.review_version+1;
 end if;
 if new.review_status<>'approved' then new.active:=false; end if;
 return new;
end $$;
create trigger guard_product_review before insert or update on public.products for each row execute function public.guard_product_review();

create function public.invalidate_product_review() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
 if tg_table_name='variants' then
  if tg_op='UPDATE' and (to_jsonb(new)-'stock')=(to_jsonb(old)-'stock') then return null; end if;
  if tg_op='DELETE' then pid:=old.product_id; else pid:=new.product_id; end if;
 else
  -- Allocating inventory to paid orders does not change the reviewed offering.
  if tg_table_name='inventory' then
   if new.order_id is not null then return null; end if;
  end if;
  select product_id into pid from public.variants where id=new.variant_id;
 end if;
 update public.products set review_status='pending',review_reason='',review_version=review_version+1,active=false
 where id=pid and seller_id is not null;
 return null;
end $$;
create trigger variant_product_review after insert or update or delete on public.variants for each row execute function public.invalidate_product_review();
create trigger inventory_product_review after insert on public.inventory for each row execute function public.invalidate_product_review();
create trigger shared_key_product_review after insert or update on public.variant_shared_keys for each row execute function public.invalidate_product_review();

create function public.review_seller_product(p_actor uuid,p_product uuid,p_version integer,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare p public.products;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin')
 or exists(select 1 from public.account_controls where user_id=p_actor and suspended) then raise exception 'Cần quyền quản trị'; end if;
 select * into p from public.products where id=p_product and seller_id is not null for update;
 if not found or p.review_version<>p_version then raise exception 'Sản phẩm đã thay đổi. Tải lại để kiểm tra trước khi duyệt'; end if;
 if not p_approve and char_length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Nhập lý do từ chối ít nhất 10 ký tự'; end if;
 if p_approve and not exists(select 1 from public.variants where product_id=p.id and active) then raise exception 'Cần ít nhất một gói đang hoạt động'; end if;
 update public.products set review_status=case when p_approve then 'approved' else 'rejected' end,
 review_reason=btrim(coalesce(p_reason,'')),active=p_approve,review_version=review_version+1 where id=p.id;
 insert into public.audit_logs(user_id,action,target) values(p_actor,case when p_approve then 'seller_product_approved' else 'seller_product_rejected' end,p.id::text);
end $$;
revoke all on function public.guard_product_review(),public.invalidate_product_review(),public.review_seller_product(uuid,uuid,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.review_seller_product(uuid,uuid,integer,boolean,text) to service_role;
commit;
-- KEYNEST STEP 045_seller_product_review END

-- KEYNEST STEP 046_seller_review_notifications BEGIN
begin;
create function public.notify_seller_product_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.seller_id is null or new.review_status not in ('approved','rejected') then return null; end if;
 if new.review_status=old.review_status and new.review_reason=old.review_reason then return null; end if;
 insert into public.notifications(id,user_id,title,body,href)
 values('seller-review:'||new.id||':'||new.review_version,new.seller_id,
  case when new.review_status='approved' then 'Sản phẩm đã được duyệt · ' else 'Sản phẩm bị từ chối · ' end||new.name,
  case when new.review_status='approved' then 'Admin đã duyệt sản phẩm của bạn và mở bán trên cửa hàng.'
   else 'Lý do: '||new.review_reason||E'\nChỉnh sửa sản phẩm để admin kiểm tra lại.' end,
  '/seller?tab=products') on conflict(id) do nothing;
 return null;
end $$;
create trigger seller_product_review_notification after update on public.products
for each row execute function public.notify_seller_product_review();
revoke all on function public.notify_seller_product_review() from public,anon,authenticated;
commit;
-- KEYNEST STEP 046_seller_review_notifications END

-- KEYNEST STEP 047_chat_viewer_permissions BEGIN
begin;
do $$ declare definition text; begin
 select pg_get_functiondef('public.seller_conversation(uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 if strpos(definition,'''item_id'',i.id')=0 then raise exception 'Conversation return marker missing'; end if;
 definition:=replace(definition,'''item_id'',i.id',
  '''can_message'',actor_role<>''admin'',''viewer_role'',case when actor_role=''admin'' then ''admin'' when p_actor=o.user_id then ''customer'' else ''seller'' end,''item_id'',i.id');
 definition:=replace(definition,'if actor_role=''admin'' or char_length(btrim(p_body)) not between 1 and 3000 or p_request is null then',
  'if actor_role=''admin'' then raise exception ''Quản trị viên chỉ được xem cuộc trò chuyện. Hãy phản hồi qua yêu cầu hỗ trợ''; end if; if p_body is null or char_length(btrim(p_body)) not between 1 and 3000 or p_request is null then');
 execute definition;
end $$;
commit;
-- KEYNEST STEP 047_chat_viewer_permissions END

-- KEYNEST STEP 048_admin_buyer_chat BEGIN
begin;
do $$ declare definition text; begin
 select pg_get_functiondef('public.seller_conversation(uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 if strpos(definition,'''can_message'',actor_role<>''admin''')=0 then raise exception 'Apply migration 047 before 048'; end if;
 definition:=replace(definition,
  'if actor_role=''admin'' then raise exception ''Quản trị viên chỉ được xem cuộc trò chuyện. Hãy phản hồi qua yêu cầu hỗ trợ'';',
  'if actor_role=''admin'' and p_actor<>o.user_id then raise exception ''Quản trị viên chỉ được xem cuộc trò chuyện. Hãy phản hồi qua yêu cầu hỗ trợ'';');
 definition:=replace(definition,'''can_message'',actor_role<>''admin''',
  '''can_message'',(p_actor=o.user_id or (p_actor=i.seller_id and actor_role<>''admin''))');
 definition:=replace(definition,
  'case when actor_role=''admin'' then ''admin'' when p_actor=o.user_id then ''customer'' else ''seller'' end',
  'case when p_actor=o.user_id then ''customer'' when actor_role=''admin'' then ''admin'' else ''seller'' end');
 execute definition;
end $$;
commit;
-- KEYNEST STEP 048_admin_buyer_chat END

-- KEYNEST STEP 049_admin_buyer_refund_request BEGIN
begin;
-- An administrator purchasing from a seller has the same request rights as a buyer.
-- Observer administrators cannot open a dispute for someone else's order.
do $$
declare definition text; marker text;
begin
 select pg_get_functiondef('public.seller_conversation(uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 marker := 'if actor_role=''admin'' or char_length(btrim(p_body)) not between 10 and 2000 or o.status';
 if strpos(definition,marker)=0 then raise exception 'Refund request guard not found'; end if;
 definition := replace(definition,marker,
  'if (actor_role=''admin'' and p_actor<>o.user_id) or p_body is null or char_length(btrim(p_body)) not between 10 and 2000 or o.status');
 execute definition;
end $$;
commit;
-- KEYNEST STEP 049_admin_buyer_refund_request END

-- KEYNEST STEP 050_chat_reply_marks_read BEGIN
begin;
do $$
declare definition text; marker text;
begin
 select pg_get_functiondef('public.seller_conversation(uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 marker := 'if message_id is not null then';
 if strpos(definition,marker)=0 then raise exception 'Chat message insert marker not found'; end if;
 -- Only a newly accepted reply acknowledges incoming messages in this conversation.
 -- Retrying an old request must not clear notifications for newer messages.
 definition := replace(definition,marker,marker || '
   update public.notifications n set read_at=now()
   where n.user_id=p_actor and n.read_at is null and exists (
    select 1 from public.seller_chat_messages m
    where m.item_id=p_item and m.author_id<>p_actor and n.id=''seller-chat:''||m.id
   );');
 execute definition;
end $$;
commit;
-- KEYNEST STEP 050_chat_reply_marks_read END

-- KEYNEST STEP 051_seller_refund_notifications BEGIN
begin;
create function public.notify_seller_refund_request() returns trigger
language plpgsql security definer set search_path='' as $$
declare o public.orders; i public.order_items;
begin
 select * into o from public.orders where id=new.order_id;
 select * into i from public.order_items where id=new.item_id;
 insert into public.notifications(id,user_id,title,body,href)
 values('seller-refund:'||new.order_id,
  case when new.requested_by=o.user_id then new.seller_id else o.user_id end,
  'Yêu cầu hoàn tiền · '||o.number||' · '||i.name,new.reason,
  case when new.requested_by=o.user_id then '/seller?tab=sales' else '/orders/'||o.id end)
 on conflict(id) do nothing;
 return null;
end $$;
create trigger seller_refund_request_notification after insert on public.seller_disputes
 for each row execute function public.notify_seller_refund_request();
revoke all on function public.notify_seller_refund_request() from public,anon,authenticated;
-- Surface still-pending requests created before this migration, too.
insert into public.notifications(id,user_id,title,body,href)
select 'seller-refund:'||d.order_id,
 case when d.requested_by=o.user_id then d.seller_id else o.user_id end,
 'Yêu cầu hoàn tiền · '||o.number||' · '||i.name,d.reason,
 case when d.requested_by=o.user_id then '/seller?tab=sales' else '/orders/'||o.id end
from public.seller_disputes d join public.orders o on o.id=d.order_id
join public.order_items i on i.id=d.item_id where d.status='open'
on conflict(id) do nothing;
commit;
-- KEYNEST STEP 051_seller_refund_notifications END

-- KEYNEST STEP 052_item_refunds BEGIN
begin;
alter table public.order_items add column refund_amount bigint not null default 0 check(refund_amount>=0), add column refunded_at timestamptz;
alter table public.tickets add column refund_item_id uuid references public.order_items(id);
alter table public.seller_disputes drop constraint seller_disputes_pkey;
alter table public.seller_disputes add primary key(item_id);
create index seller_disputes_order on public.seller_disputes(order_id);
alter table public.seller_disputes add column amount bigint not null default 0 check(amount>=0), add column agreed_by uuid references public.profiles(id);
-- Use the same discount allocation and rounding as seller settlement.
create function public.item_paid_amount(p_item uuid) returns bigint language sql stable set search_path='' as $$
 select case when o.subtotal=0 then 0 else
  floor((select sum(x.price::numeric*x.quantity) from public.order_items x where x.order_id=o.id and x.id<=i.id)*o.total/o.subtotal)
  -floor(coalesce((select sum(x.price::numeric*x.quantity) from public.order_items x where x.order_id=o.id and x.id<i.id),0)*o.total/o.subtotal) end::bigint
 from public.order_items i join public.orders o on o.id=i.order_id where i.id=p_item
$$;
revoke all on function public.item_paid_amount(uuid) from public,anon,authenticated;
update public.seller_disputes set amount=public.item_paid_amount(item_id);
update public.tickets t set refund_item_id=d.item_id from public.seller_disputes d where d.ticket_id=t.id;
drop index public.one_open_warranty_per_order;
create unique index one_open_warranty_per_order on public.tickets(order_id) where kind='warranty' and status in ('open','in_progress') and refund_item_id is null;
create unique index one_open_refund_per_item on public.tickets(refund_item_id) where status in ('open','in_progress');

-- Internal only: the chat function locks buyer, order, item and dispute first.
create function public.complete_item_refund(p_item uuid,p_actor uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare i public.order_items; o public.orders; d public.seller_disputes; uid uuid;
begin
 select * into i from public.order_items where id=p_item;
 perform 1 from public.profiles where id=(select user_id from public.orders where id=i.order_id) for update;
 select * into o from public.orders where id=i.order_id for update;
 select * into i from public.order_items where id=p_item for update;
 select * into d from public.seller_disputes where item_id=p_item for update;
 if d.item_id is null or d.status not in ('open','agreed') or i.refunded_at is not null or i.seller_reversed_at is not null
  or i.seller_settled_at is not null or o.status not in ('processing','completed') or o.paid_at is null
  or d.amount<>public.item_paid_amount(p_item) then raise exception 'Sản phẩm không thể hoàn tiền hoặc đã hoàn trước đó'; end if;
 if ((d.agreed_by=p_actor and p_actor<>d.requested_by and p_actor in(o.user_id,i.seller_id) and d.requested_by in(o.user_id,i.seller_id))
  or (p_actor not in(o.user_id,i.seller_id) and exists(select 1 from public.profiles where id=p_actor and role='admin'))) is not true
  or exists(select 1 from public.account_controls where user_id=p_actor and suspended) then raise exception 'Không có quyền hoàn tiền sản phẩm'; end if;
 update public.profiles set balance=balance+d.amount where id=o.user_id;
 insert into public.wallet_ledger(user_id,amount,description) values(o.user_id,d.amount,'Hoàn sản phẩm '||o.number||' · '||i.name||' · '||i.id);
 update public.order_items set refund_amount=d.amount,refunded_at=now(),seller_reversed_at=now() where id=i.id;
 update public.seller_disputes set status='refunded',resolution=p_reason,resolved_at=now() where item_id=i.id;
 if not exists(select 1 from public.order_items where order_id=o.id and refunded_at is null) then
  update public.orders set status='refunded',refunded_at=now(),refund_method='wallet',refund_reason=p_reason,refund_ticket_id=d.ticket_id,refunded_by=p_actor where id=o.id;
 elsif o.status='processing' and not exists(select 1 from public.order_items where order_id=o.id and refunded_at is null and delivered_at is null) then
  update public.orders set status='completed' where id=o.id;
 end if;
 update public.tickets set status='closed',reply=p_reason,updated_at=now() where id=d.ticket_id;
 insert into public.audit_logs(user_id,action,target) values(p_actor,'refund_item_wallet',i.id::text);
 update public.notifications set read_at=coalesce(read_at,now()) where id='seller-refund:'||i.id or id='seller-refund:'||o.id;
 foreach uid in array array[o.user_id,i.seller_id] loop
  insert into public.notifications(id,user_id,title,body,href) values('seller-refund:done:'||i.id||':'||uid,uid,
   'Đã hoàn tiền sản phẩm · '||o.number,i.name||' · '||d.amount||' ₫ đã hoàn vào ví người mua.',
   case when uid=o.user_id then '/orders/'||o.id else '/seller?tab=sales' end) on conflict(id) do nothing;
 end loop;
end $$;
revoke all on function public.complete_item_refund(uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.seller_conversation(p_actor uuid,p_item uuid,p_action text default 'read',p_body text default '',p_request uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.order_items; o public.orders; d public.seller_disputes; tid uuid; actor_role text; old_message public.seller_chat_messages; message_id uuid; eligible boolean; participant boolean;
begin
 select role into actor_role from public.profiles where id=p_actor;
 if actor_role is null or exists(select 1 from public.account_controls where user_id=p_actor and suspended) then raise exception 'Không có quyền truy cập'; end if;
 select * into i from public.order_items where id=p_item;
 if i.id is null or i.seller_id is null or exists(select 1 from public.profiles where id=i.seller_id and role='admin') then raise exception 'Sản phẩm này được hỗ trợ qua KEYNEST'; end if;
 if p_action='read' then select * into o from public.orders where id=i.order_id;
 else
  perform 1 from public.profiles where id=(select user_id from public.orders where id=i.order_id) for update;
  select * into o from public.orders where id=i.order_id for update;
  select * into i from public.order_items where id=p_item for update;
 end if;
 participant:=p_actor in(o.user_id,i.seller_id);
 if not participant and actor_role<>'admin' then raise exception 'Không có quyền truy cập cuộc trò chuyện'; end if;
 select * into d from public.seller_disputes where item_id=i.id;
 eligible:=participant and o.paid_at is not null and o.status in('processing','completed') and i.seller_settled_at is null and i.seller_reversed_at is null and i.refunded_at is null and (i.delivered_at is null or i.delivered_at+interval '48 hours'>clock_timestamp());
 if p_action='message' then
  if not participant then raise exception 'Quản trị viên chỉ được xem cuộc trò chuyện. Hãy phản hồi qua yêu cầu hỗ trợ'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 3000 or p_request is null then raise exception 'Tin nhắn không hợp lệ'; end if;
  select * into old_message from public.seller_chat_messages where author_id=p_actor and request_id=p_request;
  if found and (old_message.item_id<>p_item or old_message.body<>btrim(p_body)) then raise exception 'Mã gửi đã được sử dụng'; end if;
  insert into public.seller_chat_messages(item_id,author_id,body,request_id) values(p_item,p_actor,btrim(p_body),p_request) on conflict(author_id,request_id) do nothing returning id into message_id;
  if message_id is not null then
   update public.notifications n set read_at=now() where n.user_id=p_actor and n.read_at is null and exists(select 1 from public.seller_chat_messages m where m.item_id=p_item and m.author_id<>p_actor and n.id='seller-chat:'||m.id);
   insert into public.notifications(id,user_id,title,href) values('seller-chat:'||message_id,case when p_actor=o.user_id then i.seller_id else o.user_id end,'Tin nhắn mới · '||o.number||' · '||i.name,case when p_actor=o.user_id then '/seller?tab=sales' else '/orders/'||o.id end);
  end if;
 elsif p_action='request' then
  if not eligible or d.item_id is not null or p_body is null or char_length(btrim(p_body)) not between 10 and 2000 then raise exception 'Không thể yêu cầu hoàn tiền sản phẩm'; end if;
  insert into public.tickets(user_id,order_id,refund_item_id,kind,subject,message) values(o.user_id,o.id,i.id,'warranty','Hoàn tiền sản phẩm · '||i.name||' · '||o.number,btrim(p_body)) returning id into tid;
  insert into public.seller_disputes(order_id,item_id,requested_by,seller_id,ticket_id,reason,amount) values(o.id,i.id,p_actor,i.seller_id,tid,btrim(p_body),public.item_paid_amount(i.id));
 elsif p_action in('agree','reject','refund') then
  if p_action in('reject','refund') and (actor_role<>'admin' or participant) then raise exception 'Cần quản trị viên không tham gia đơn hàng'; end if;
  select * into d from public.seller_disputes where item_id=p_item for update;
  if not found or d.status not in('open','agreed') then raise exception 'Yêu cầu đã xử lý hoặc không tồn tại'; end if;
  if p_action='agree' then
   if not participant or p_actor=d.requested_by then raise exception 'Chỉ bên còn lại được xác nhận đồng ý'; end if;
   if d.created_at+interval '48 hours'<=clock_timestamp() then raise exception 'Yêu cầu quá 48 giờ, vui lòng chờ admin xử lý'; end if;
   update public.seller_disputes set agreed_by=p_actor,status='agreed' where item_id=i.id;
   perform public.complete_item_refund(i.id,p_actor,'Hai bên đã đồng ý. Đã hoàn tiền sản phẩm vào ví người mua.');
  else
   if p_body is null or char_length(btrim(p_body)) not between 10 and 2000 then raise exception 'Nhập lý do xử lý từ 10 đến 2000 ký tự'; end if;
   if p_action='refund' then perform public.complete_item_refund(i.id,p_actor,btrim(p_body));
   else
    update public.seller_disputes set status='rejected',resolution=btrim(p_body),resolved_at=now() where item_id=i.id;
    update public.tickets set status='closed',reply=btrim(p_body),updated_at=now() where id=d.ticket_id;
   end if;
   insert into public.audit_logs(user_id,action,target) values(p_actor,'seller_dispute_'||p_action,i.id::text);
  end if;
 elsif p_action<>'read' then raise exception 'Thao tác không hợp lệ'; end if;
 select * into d from public.seller_disputes where item_id=i.id;
 select * into o from public.orders where id=o.id;
 return jsonb_build_object('item_id',i.id,'name',i.name,'variant_name',i.variant_name,'quantity',i.quantity,'seller_name',i.seller_name,'order_number',o.number,'order_status',o.status,'order_total',o.total,'refund_amount',coalesce(d.amount,public.item_paid_amount(i.id)),
 'can_message',participant,'viewer_role',case when p_actor=o.user_id then 'customer' when p_actor=i.seller_id then 'seller' else 'admin' end,
 'seller_hold_until',i.delivered_at+interval '48 hours','seller_settled_at',i.seller_settled_at,'can_request',eligible and d.item_id is null,
 'dispute',case when d.item_id is null then null else to_jsonb(d)||jsonb_build_object('response_due_at',d.created_at+interval '48 hours','needs_admin',d.status in('open','agreed') and d.created_at+interval '48 hours'<=clock_timestamp(),'can_resolve',actor_role='admin' and not participant,'can_agree',participant and p_actor<>d.requested_by and d.status='open' and d.created_at+interval '48 hours'>clock_timestamp()) end,
 'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (select id,body,created_at,case when author_id=o.user_id then 'customer' else 'seller' end as role from public.seller_chat_messages where item_id=p_item order by created_at desc,id desc limit 200) m),'[]'::jsonb));
end $$;

create or replace function public.notify_seller_refund_request() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; i public.order_items;
begin
 select * into o from public.orders where id=new.order_id;
 select * into i from public.order_items where id=new.item_id;
 insert into public.notifications(id,user_id,title,body,href) values('seller-refund:'||new.item_id,
 case when new.requested_by=o.user_id then new.seller_id else o.user_id end,'Yêu cầu hoàn tiền · '||o.number||' · '||i.name,new.reason,
 case when new.requested_by=o.user_id then '/seller?tab=sales' else '/orders/'||o.id end) on conflict(id) do nothing;
 return null;
end $$;

-- Release unrelated products normally, and never pay out a refunded product.
do $$ declare definition text; begin
 select pg_get_functiondef('public.settle_seller_revenue(uuid)'::regprocedure) into definition;
 definition:=replace(definition,'where order_id=o.id and status in (''open'',''agreed'')','where item_id=i.id and status in (''open'',''agreed'')');
 execute definition;
 select pg_get_functiondef('public.release_seller_funds(uuid)'::regprocedure) into definition;
 definition:=replace(definition,'where d.order_id=o.id and d.status','where d.item_id=i.id and d.status');
 execute definition;
 select pg_get_functiondef('public.seller_command(uuid,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'or i.delivered_at is not null then','or i.delivered_at is not null or i.refunded_at is not null then');
 definition:=replace(definition,'where order_id=o.id and delivered_at is null','where order_id=o.id and delivered_at is null and refunded_at is null');
 execute definition;
 -- A later whole-order admin refund must only return the remaining paid balance.
 select pg_get_functiondef('public.resolve_warranty_refund(uuid,uuid,uuid,text,text,text)'::regprocedure) into definition;
 definition:=replace(definition,'if p_method=''wallet'' then', 'if t.refund_item_id is not null then raise exception ''Yêu cầu này chỉ hoàn sản phẩm. Xử lý tại trao đổi sản phẩm''; end if; if p_method=''wallet'' then');
 definition:=replace(definition,'reply_text text;', 'reply_text text; remaining bigint;');
 definition:=replace(definition,'if p_method=''wallet'' then', 'remaining:=o.total-coalesce((select sum(refund_amount) from order_items where order_id=o.id),0); if remaining<0 then raise exception ''Invalid remaining refund''; end if; if p_method=''wallet'' then');
 definition:=replace(definition,'balance=balance+o.total','balance=balance+remaining');
 definition:=replace(definition,'values(o.user_id,o.total,','values(o.user_id,remaining,');
 execute definition;
 select pg_get_functiondef('public.fulfill_order(uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'and delivered_at is null','and delivered_at is null and refunded_at is null');
 execute definition;
 select pg_get_functiondef('public.create_warranty(uuid,uuid,uuid[],text)'::regprocedure) into definition;
 definition:=replace(definition,'where order_id=o.id and kind=''warranty''', 'where order_id=o.id and refund_item_id is null and kind=''warranty''');
 definition:=replace(definition,'if i.warranty_days=0 then', 'if i.refunded_at is not null then raise exception ''Sản phẩm đã hoàn tiền''; end if; if i.warranty_days=0 then');
 execute definition;
 select pg_get_functiondef('public.stamp_item_delivery()'::regprocedure) into definition;
 definition:=replace(definition,'where order_id=new.id and', 'where order_id=new.id and refunded_at is null and');
 execute definition;
end $$;
-- Keep item-specific support private to its seller, including mixed-seller orders.
do $$ declare definition text; begin
 select pg_get_functiondef('public.seller_support(uuid,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,
  'or exists(select 1 from public.order_items where order_id=target_ticket.order_id and seller_id is distinct from p_actor)',
  'or (target_ticket.refund_item_id is not null and not exists(select 1 from public.order_items where id=target_ticket.refund_item_id and seller_id=p_actor)) or (target_ticket.refund_item_id is null and exists(select 1 from public.order_items where order_id=target_ticket.order_id and seller_id is distinct from p_actor))');
 definition:=replace(definition,
  'and not exists(select 1 from public.order_items where order_id=t.order_id and seller_id is distinct from p_actor)',
  'and ((t.refund_item_id is not null and exists(select 1 from public.order_items where id=t.refund_item_id and seller_id=p_actor)) or (t.refund_item_id is null and not exists(select 1 from public.order_items where order_id=t.order_id and seller_id is distinct from p_actor)))');
 definition:=replace(definition,'''status'',t.status,',
  '''refund_item_id'',t.refund_item_id,''refund'',(select to_jsonb(d)||jsonb_build_object(''response_due_at'',d.created_at+interval ''48 hours'',''needs_admin'',d.status in(''open'',''agreed'') and d.created_at+interval ''48 hours''<=clock_timestamp()) from public.seller_disputes d where d.item_id=t.refund_item_id),''status'',t.status,');
 execute definition;
end $$;
commit;
-- KEYNEST STEP 052_item_refunds END

-- KEYNEST STEP 053_checkout_cart BEGIN
begin;

-- Consume each newly created order line in the same transaction as checkout.
-- An idempotent retry reuses existing lines, so it cannot consume the cart twice.
create function public.consume_order_item_cart() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.account_carts c
 set items=coalesce((
  select jsonb_agg(
   case when entry.value->>'variant_id'=new.variant_id::text then
    jsonb_set(entry.value,'{quantity}',to_jsonb((entry.value->>'quantity')::integer-new.quantity))
   else entry.value end order by entry.ordinality
  )
  from jsonb_array_elements(c.items) with ordinality as entry(value,ordinality)
  where entry.value->>'variant_id' is distinct from new.variant_id::text
   or (entry.value->>'quantity')::integer>new.quantity
 ),'[]'::jsonb), updated_at=now()
 where c.user_id=(select o.user_id from public.orders o where o.id=new.order_id)
  and exists(select 1 from jsonb_array_elements(c.items) as entry(value)
   where entry.value->>'variant_id'=new.variant_id::text);
 return new;
end $$;

create trigger consume_order_item_cart after insert on public.order_items
 for each row execute function public.consume_order_item_cart();
revoke all on function public.consume_order_item_cart() from public,anon,authenticated,service_role;

commit;
-- KEYNEST STEP 053_checkout_cart END

-- KEYNEST STEP 054_admin_event_notifications BEGIN
begin;

-- Only trusted triggers create operational inbox entries. No inventory secrets,
-- payment credentials or bank account details are copied into notifications.
create function public.notify_active_admins(p_key text,p_title text,p_body text,p_href text,
 p_time timestamptz default now(),p_exclude uuid default null) returns void
language sql security definer set search_path='' as $$
 insert into public.notifications(id,user_id,title,body,href,created_at)
 select 'admin:'||p_key||':'||p.id,p.id,p_title,p_body,p_href,coalesce(p_time,now())
 from public.profiles p where p.role='admin' and p.id is distinct from p_exclude
 and not exists(select 1 from public.account_controls c where c.user_id=p.id and c.suspended)
 on conflict(id) do nothing
$$;

create function public.notify_admin_order(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; preorder boolean; manual_pending boolean;
begin
 select * into o from public.orders where id=p_order;
 if not found then return; end if;
 select bool_or(i.is_preorder),bool_or(i.delivery='manual' and i.delivered_at is null and i.refunded_at is null)
 into preorder,manual_pending from public.order_items i where i.order_id=o.id;
 if preorder and o.status='pending' then
  perform public.notify_active_admins('preorder:'||o.id,'Đơn đặt trước mới · '||o.number,
   'Khách đã đặt trước, đang chờ thanh toán.','/admin?tab=orders&order='||o.id,o.created_at);
 end if;
 if o.paid_at is not null and o.status in('processing','completed') then
  perform public.notify_active_admins('order-paid:'||o.id,
   case when preorder then 'Đơn đặt trước đã thanh toán' else 'Đơn hàng đã thanh toán' end||' · '||o.number,
   case when manual_pending then 'Có sản phẩm cần giao thủ công. Kiểm tra thông tin và thời gian giao hàng.'
    else 'Đơn hàng đã được ghi nhận thanh toán.' end,'/admin?tab=orders&order='||o.id,o.paid_at);
 end if;
end $$;

create function public.notify_admin_business_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.tickets; p public.products; e public.payment_events;
begin
 if tg_table_name='orders' then
  perform public.notify_admin_order(new.id);
 elsif tg_table_name='order_items' then
  perform public.notify_admin_order(new.order_id);
 elsif tg_table_name='tickets' then
  if new.deleted_at is null and new.refund_item_id is null and new.status in('open','in_progress') then
   perform public.notify_active_admins('ticket:'||new.id,
    case when new.kind='warranty' then 'Yêu cầu bảo hành mới' else 'Yêu cầu hỗ trợ mới' end||' · '||new.subject,
    'Có yêu cầu cần kiểm tra và phản hồi.','/admin?tab=tickets&ticket='||new.id,new.created_at);
  end if;
 elsif tg_table_name='ticket_messages' then
  select * into t from public.tickets where id=new.ticket_id;
  if new.role in('customer','seller') and t.deleted_at is null then
   perform public.notify_active_admins('ticket-message:'||new.id,'Phản hồi hỗ trợ mới · '||t.subject,
    'Khách hàng hoặc người bán vừa gửi thêm trao đổi.','/admin?tab=tickets&ticket='||t.id,new.created_at,new.author_id);
  end if;
 elsif tg_table_name='products' then
  -- Deferred: read the final version after variant/inventory changes in the same
  -- transaction. Multiple invalidations must produce just one review notice.
  select * into p from public.products where id=new.id;
  if p.seller_id is not null and p.review_status='pending' then
   perform public.notify_active_admins('product-review:'||p.id||':'||p.review_version,'Sản phẩm chờ duyệt · '||p.name,
    'Người bán đã gửi sản phẩm hoặc cập nhật nội dung cần kiểm tra lại.','/admin?tab=products');
  end if;
 elsif tg_table_name='seller_withdrawals' then
  if new.status='pending' then
   perform public.notify_active_admins('withdrawal:'||new.id,'Yêu cầu rút tiền của người bán',
    new.amount||' ₫ đang chờ xét duyệt.','/admin?tab=sellers',new.created_at);
  end if;
 elsif tg_table_name='seller_disputes' then
  if new.status in('open','agreed') then
   perform public.notify_active_admins('dispute:'||new.item_id,'Yêu cầu hoàn tiền sản phẩm',
    'Hai bên đang trao đổi. Admin có thể can thiệp sớm; cần kiểm tra nếu quá 48 giờ.','/admin?tab=sellers',new.created_at);
  end if;
 elsif tg_table_name='payment_events' then
  select * into e from public.payment_events where transaction_id=new.transaction_id;
  if e.outcome='needs_review' then
   perform public.notify_active_admins('payment-review:'||md5(e.transaction_id),'Thanh toán cần đối soát',
    e.amount||' ₫ chưa được tự động đối soát. Kiểm tra trước khi ghi có.','/admin?tab=payments',e.created_at);
  end if;
 end if;
 return null;
end $$;

-- Orders are inserted before their items. Defer until COMMIT so preorder/manual
-- snapshots and final wallet/bank payment status are available and rollback-safe.
create constraint trigger admin_order_notification after insert or update on public.orders
 deferrable initially deferred for each row execute function public.notify_admin_business_event();
create constraint trigger admin_order_item_notification after insert on public.order_items
 deferrable initially deferred for each row execute function public.notify_admin_business_event();
create constraint trigger admin_product_review_notification after insert or update on public.products
 deferrable initially deferred for each row execute function public.notify_admin_business_event();
create trigger admin_ticket_notification after insert on public.tickets
 for each row execute function public.notify_admin_business_event();
create trigger admin_ticket_message_notification after insert on public.ticket_messages
 for each row execute function public.notify_admin_business_event();
create trigger admin_withdrawal_notification after insert on public.seller_withdrawals
 for each row execute function public.notify_admin_business_event();
create trigger admin_dispute_notification after insert on public.seller_disputes
 for each row execute function public.notify_admin_business_event();
create constraint trigger admin_payment_review_notification after insert or update on public.payment_events
 deferrable initially deferred for each row execute function public.notify_admin_business_event();
revoke all on function public.notify_active_admins(text,text,text,text,timestamptz,uuid),
 public.notify_admin_order(uuid),public.notify_admin_business_event() from public,anon,authenticated,service_role;

-- Surface existing work that still needs attention when installing the migration.
do $$
declare t public.tickets; o public.orders; p public.products; w public.seller_withdrawals;
 d public.seller_disputes; e public.payment_events;
begin
 for t in select * from public.tickets where deleted_at is null and refund_item_id is null and status in('open','in_progress') loop
  perform public.notify_active_admins('ticket:'||t.id,
   case when t.kind='warranty' then 'Yêu cầu bảo hành mới' else 'Yêu cầu hỗ trợ mới' end||' · '||t.subject,
   'Có yêu cầu cần kiểm tra và phản hồi.','/admin?tab=tickets&ticket='||t.id,t.created_at);
 end loop;
 for o in select * from public.orders where status in('pending','processing') loop
  perform public.notify_admin_order(o.id);
 end loop;
 for p in select * from public.products where seller_id is not null and review_status='pending' loop
  perform public.notify_active_admins('product-review:'||p.id||':'||p.review_version,'Sản phẩm chờ duyệt · '||p.name,
   'Người bán đã gửi sản phẩm hoặc cập nhật nội dung cần kiểm tra lại.','/admin?tab=products');
 end loop;
 for w in select * from public.seller_withdrawals where status='pending' loop
  perform public.notify_active_admins('withdrawal:'||w.id,'Yêu cầu rút tiền của người bán',w.amount||' ₫ đang chờ xét duyệt.','/admin?tab=sellers',w.created_at);
 end loop;
 for d in select * from public.seller_disputes where status in('open','agreed') loop
  perform public.notify_active_admins('dispute:'||d.item_id,'Yêu cầu hoàn tiền sản phẩm',
   'Hai bên đang trao đổi. Admin có thể can thiệp sớm; cần kiểm tra nếu quá 48 giờ.','/admin?tab=sellers',d.created_at);
 end loop;
 for e in select * from public.payment_events where outcome='needs_review' loop
  perform public.notify_active_admins('payment-review:'||md5(e.transaction_id),'Thanh toán cần đối soát',
   e.amount||' ₫ chưa được tự động đối soát. Kiểm tra trước khi ghi có.','/admin?tab=payments',e.created_at);
 end loop;
end $$;
commit;
-- KEYNEST STEP 054_admin_event_notifications END

-- KEYNEST STEP 055_catalog_live_version BEGIN
begin;

-- Return a small fingerprint instead of streaming unchanged descriptions and
-- variants back to the VPS every few seconds. No writes or global lock row.
-- Hash only the tables/columns used by the public catalog, never inventory keys.
create function public.catalog_live_version() returns text
language sql stable security definer set search_path='' as $$
 with visible as materialized (select * from public.products where active),
 parts as (
  select 'p' as kind,p.id::text as id,md5(to_jsonb(p)::text) as hash from visible p
  union all
  select 'v',v.id::text,md5(to_jsonb(v)::text) from public.variants v
   join visible p on p.id=v.product_id where v.active
  union all
  select 'r',s.product_id::text,md5(to_jsonb(s)::text) from public.product_review_stats s
   join visible p on p.id=s.product_id
  union all
  select 's',s.id::text,md5(jsonb_build_array(s.id,s.name,s.seller_name)::text)
   from public.profiles s where exists(select 1 from visible p where p.seller_id=s.id)
 )
 select md5(coalesce(string_agg(kind||id||hash,'' order by kind,id),'')) from parts
$$;
revoke all on function public.catalog_live_version() from public,anon,authenticated;
grant execute on function public.catalog_live_version() to service_role;

commit;
-- KEYNEST STEP 055_catalog_live_version END

-- KEYNEST STEP 056_tingee_poll_budget BEGIN
begin;

alter table public.payment_routes add column poll_failures integer not null default 0 check(poll_failures>=0);

-- Keep the lease in database time and return only reconciliation inputs, never
-- the base64 QR image. A claim token prevents an old worker rescheduling a newer job.
create or replace function public.claim_tingee_polls() returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare r public.payment_routes; p public.payments;
begin
 for r in select * from public.payment_routes where provider='tingee' and state='ready' and not remote_closed
  and next_poll_at<=now() and (lease_until is null or lease_until<=now())
  order by next_poll_at,payment_id for update skip locked limit 20 loop
  update public.payment_routes set next_poll_at=now()+interval '3 minutes',
   lease_until=now()+interval '3 minutes',claim_token=pg_catalog.gen_random_uuid()
   where payment_id=r.payment_id returning * into r;
  select * into p from public.payments where id=r.payment_id;
  return next jsonb_build_object(
   'payment_id',r.payment_id,'claim_token',r.claim_token,'polled_at',now(),
   'qr_kind',r.qr_kind,'bill_id',r.bill_id,'qr_account',r.qr_account,
   'bank_bin',r.bank_bin,'account',r.account,'va_account',r.va_account,
   'last_error',r.last_error,'poll_failures',r.poll_failures,
   'payment',jsonb_build_object('id',p.id,'code',p.code,'amount',p.amount,
    'status',p.status,'created_at',p.created_at,'expires_at',p.expires_at));
 end loop;
end $$;

-- One acknowledgement replaces status/error PATCH + a second schedule PATCH.
-- The VPS supplies no absolute timestamp. Successful pending dynamic bills keep
-- a 5s cadence; failed checks back off and never change the pinned provider.
create function public.finish_tingee_poll(p_id uuid,p_claim uuid,p_error text default null,
 p_closed boolean default false,p_failed boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.payment_routes; p public.payments; failures integer; delay_seconds integer; active boolean;
begin
 if char_length(p_error)>120 then raise exception 'Invalid poll diagnostic'; end if;
 select * into p from public.payments where id=p_id;
 select * into r from public.payment_routes where payment_id=p_id and provider='tingee'
  and state='ready' and claim_token=p_claim for update;
 if not found or p.id is null then return false; end if;
 active:=p.status='pending' and p.expires_at>clock_timestamp();
 failures:=case when p_failed then least(r.poll_failures+1,10) else 0 end;
 delay_seconds:=case when r.qr_kind='static' and not active then 600
  when r.qr_kind='static' then 30 when not active then 30 else 5 end;
 if p_failed then
  delay_seconds:=greatest(delay_seconds,case when active then
   least(300,15*power(2,least(failures-1,5)))::integer
   else least(3600,60*power(2,least(failures-1,6)))::integer end);
 end if;
 update public.payment_routes set next_poll_at=clock_timestamp()+make_interval(secs=>delay_seconds),
  remote_closed=remote_closed or (coalesce(p_closed,false) and not coalesce(p_failed,false)),
  last_error=p_error,poll_failures=failures,claim_token=null,lease_until=null
  where payment_id=p_id;
 return true;
end $$;
revoke all on function public.claim_tingee_polls(),public.finish_tingee_poll(uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_tingee_polls(),public.finish_tingee_poll(uuid,uuid,text,boolean,boolean) to service_role;

commit;
-- KEYNEST STEP 056_tingee_poll_budget END

-- KEYNEST STEP 057_seller_name_approval BEGIN
begin;

create table public.seller_name_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 current_name text not null,
 requested_name text not null check(char_length(requested_name) between 2 and 80 and requested_name=btrim(requested_name)),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reason text not null default '' check(char_length(reason)<=1000),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 resolved_by uuid references public.profiles(id),
 check((status='pending' and resolved_at is null and resolved_by is null)
    or (status<>'pending' and resolved_at is not null and resolved_by is not null)),
 check(status<>'rejected' or char_length(btrim(reason))>=3)
);
create unique index seller_name_one_pending on public.seller_name_requests(user_id) where status='pending';
create index seller_name_history on public.seller_name_requests(user_id,created_at desc,id);
alter table public.seller_name_requests enable row level security;
revoke all on public.seller_name_requests from public,anon,authenticated;
grant all on public.seller_name_requests to service_role;

-- Name changes from onboarding, profile updates or older API versions must also
-- pass approval. Only the matching, resolved request authorizes this transition.
create function public.guard_seller_name_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.seller_name is not distinct from old.seller_name or coalesce(old.seller_name,'')='' then return new; end if;
 if not exists(select 1 from public.seller_name_requests r join public.profiles a on a.id=r.resolved_by
   where r.id::text=current_setting('keynest.seller_name_request',true) and r.user_id=old.id
   and r.status='approved' and r.current_name=old.seller_name and r.requested_name=new.seller_name and a.role='admin'
   and not exists(select 1 from public.account_controls c where c.user_id=a.id and c.suspended)) then
  raise exception 'Đổi tên gian hàng cần được admin duyệt';
 end if;
 return new;
end $$;
create trigger seller_name_approval_guard before update of seller_name on public.profiles
 for each row execute function public.guard_seller_name_change();

create function public.request_seller_name(p_actor uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.profiles; r public.seller_name_requests;
begin
 perform public.require_seller(p_actor);
 select * into u from public.profiles where id=p_actor for update;
 if exists(select 1 from public.account_controls c where c.user_id=p_actor and c.suspended) then raise exception 'Tài khoản đang bị khóa'; end if;
 if p_name is null or char_length(btrim(p_name)) not between 2 and 80 then raise exception 'Tên gian hàng cần từ 2 đến 80 ký tự'; end if;
 p_name:=btrim(p_name);
 select * into r from public.seller_name_requests where user_id=p_actor and status='pending';
 if found then
  if r.requested_name=p_name then return to_jsonb(r); end if;
  raise exception 'Bạn đã có yêu cầu đổi tên đang chờ duyệt';
 end if;
 if p_name=coalesce(nullif(u.seller_name,''),u.name) then raise exception 'Tên mới trùng với tên đang hiển thị'; end if;
 insert into public.seller_name_requests(user_id,current_name,requested_name)
 values(p_actor,coalesce(nullif(u.seller_name,''),u.name),p_name) returning * into r;
 perform public.notify_active_admins('seller-name:'||r.id,'Yêu cầu đổi tên gian hàng',
   r.current_name||' → '||r.requested_name,'/admin?tab=sellers',r.created_at);
 insert into public.audit_logs(user_id,action,target) values(p_actor,'seller_name_requested',r.id::text);
 return to_jsonb(r);
end $$;

create function public.review_seller_name(p_actor uuid,p_request uuid,p_status text,p_reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.seller_name_requests; u public.profiles; target uuid;
begin
 perform 1 from public.profiles where id=p_actor and role='admin' for update;
 if not found or exists(select 1 from public.account_controls c where c.user_id=p_actor and c.suspended) then raise exception 'Cần quyền quản trị'; end if;
 if p_status is null or p_status not in('approved','rejected') or p_reason is null or char_length(p_reason)>1000
   or (p_status='rejected' and char_length(btrim(p_reason))<3) then raise exception 'Kết quả hoặc lý do xét duyệt không hợp lệ'; end if;
 select user_id into target from public.seller_name_requests where id=p_request;
 -- Same lock order as submission: seller profile before request.
 select * into u from public.profiles where id=target for update;
 select * into r from public.seller_name_requests where id=p_request for update;
 if not found or r.status<>'pending' then raise exception 'Yêu cầu đã được xử lý hoặc không tồn tại'; end if;
 if p_status='approved' then
  perform public.require_seller(target);
  if exists(select 1 from public.account_controls c where c.user_id=target and c.suspended) then raise exception 'Tài khoản người bán đang bị khóa'; end if;
  if coalesce(nullif(u.seller_name,''),u.name)<>r.current_name then raise exception 'Tên hiện tại đã thay đổi. Không thể duyệt yêu cầu cũ'; end if;
 end if;
 update public.seller_name_requests set status=p_status,reason=btrim(p_reason),resolved_at=now(),resolved_by=p_actor where id=p_request returning * into r;
 if p_status='approved' then
  perform set_config('keynest.seller_name_request',r.id::text,true);
  update public.profiles set seller_name=r.requested_name where id=target;
  perform set_config('keynest.seller_name_request','',true);
 end if;
 insert into public.notifications(id,user_id,title,body,href) values('seller-name:'||r.id,target,
   case when p_status='approved' then 'Tên gian hàng đã được duyệt' else 'Yêu cầu đổi tên chưa được duyệt' end,
   case when p_status='approved' then 'Tên mới: '||r.requested_name else r.reason end,'/seller?tab=profile');
 insert into public.audit_logs(user_id,action,target) values(p_actor,'seller_name_'||p_status,r.id::text);
 return to_jsonb(r);
end $$;
revoke all on function public.guard_seller_name_change(),public.request_seller_name(uuid,text),public.review_seller_name(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.request_seller_name(uuid,text),public.review_seller_name(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
-- KEYNEST STEP 057_seller_name_approval END

-- KEYNEST STEP 058_login_protection BEGIN
begin;
create table public.login_attempts (
 email_hash text primary key check(email_hash ~ '^[a-f0-9]{64}$'),
 failures integer not null default 0 check(failures between 0 and 5),
 window_started_at timestamptz not null default now(),
 otp_required boolean not null default false,
 otp_blocked_until timestamptz,
 otp_strikes integer not null default 0,
 otp_last_abuse timestamptz,
 otp_window timestamptz,
 otp_sends integer not null default 0,
 otp_checks integer not null default 0,
 attempt_id uuid,
 lease_until timestamptz
);
create index login_attempts_expiry on public.login_attempts(window_started_at);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from public,anon,authenticated;
grant all on public.login_attempts to service_role;

-- Reserve before contacting Auth: concurrent requests cannot race past the limit.
create function public.begin_login_attempt(p_email_hash text,p_attempt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.login_attempts;
begin
 if p_email_hash is null or p_email_hash !~ '^[a-f0-9]{64}$' or p_attempt is null then raise exception 'Invalid login attempt'; end if;
 delete from public.login_attempts where not otp_required and window_started_at < now()-interval '1 day' and coalesce(lease_until,now())<=now();
 insert into public.login_attempts(email_hash) values(p_email_hash) on conflict do nothing;
 select * into r from public.login_attempts where email_hash=p_email_hash for update;
 if r.otp_required then return jsonb_build_object('otp_required',true); end if;
 if r.lease_until>now() then return jsonb_build_object('busy',true,'retry_after',2); end if;
 if r.window_started_at<=now()-interval '15 minutes' then
  update public.login_attempts set failures=0,window_started_at=now() where email_hash=p_email_hash;
 end if;
 update public.login_attempts set attempt_id=p_attempt,lease_until=now()+interval '30 seconds' where email_hash=p_email_hash;
 return jsonb_build_object('attempt_id',p_attempt);
end $$;

create function public.finish_login_attempt(p_email_hash text,p_attempt uuid,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.login_attempts;
begin
 if p_outcome is null or p_outcome not in ('success','failure','error') then raise exception 'Invalid login outcome'; end if;
 select * into r from public.login_attempts where email_hash=p_email_hash for update;
 if not found or r.attempt_id is distinct from p_attempt or r.lease_until<=now() then return null; end if;
 if p_outcome='success' then delete from public.login_attempts where email_hash=p_email_hash; return '{}'::jsonb; end if;
 update public.login_attempts set failures=least(5,failures+case when p_outcome='failure' then 1 else 0 end),
  otp_required=otp_required or (p_outcome='failure' and failures>=4),
  attempt_id=null,lease_until=null where email_hash=p_email_hash returning * into r;
 return jsonb_build_object('otp_required',r.otp_required);
end $$;

create function public.login_protection_state(p_email_hash text) returns jsonb
language sql security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('otp_required',otp_required) from public.login_attempts where email_hash=p_email_hash),'{}'::jsonb);
$$;

-- Count across challenges, browsers and IPs. Requests during a ban do not extend
-- it. Each later abuse incident doubles 30 minutes, capped at 365 days.
create function public.login_otp_budget(p_email_hash text,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.login_attempts; seconds integer; incident boolean:=false;
begin
 if p_action is null or p_action not in ('send','verify','failure') then raise exception 'Invalid OTP action'; end if;
 select * into r from public.login_attempts where email_hash=p_email_hash for update;
 if not found or not r.otp_required then return jsonb_build_object('not_required',true); end if;
 if r.otp_blocked_until>now() then return jsonb_build_object('locked',true,'retry_after',ceil(extract(epoch from r.otp_blocked_until-now()))::int); end if;
 if r.otp_blocked_until is not null or r.otp_window is null or r.otp_window<=now()-interval '15 minutes' then
  r.otp_window:=now(); r.otp_sends:=0; r.otp_checks:=0; r.otp_blocked_until:=null;
 end if;
 if p_action='send' then r.otp_sends:=r.otp_sends+1; incident:=r.otp_sends>=5;
 elsif p_action='verify' then r.otp_checks:=r.otp_checks+1; incident:=r.otp_checks>5;
 else incident:=r.otp_checks>=5; end if;
 if incident then
  r.otp_strikes:=least(16,r.otp_strikes+1);
  seconds:=least(31536000,1800*power(2,r.otp_strikes-1))::integer;
  r.otp_blocked_until:=now()+make_interval(secs=>seconds); r.otp_last_abuse:=now();
 end if;
 update public.login_attempts set otp_sends=r.otp_sends,otp_checks=r.otp_checks,otp_window=r.otp_window,
  otp_blocked_until=r.otp_blocked_until,otp_strikes=r.otp_strikes,otp_last_abuse=r.otp_last_abuse where email_hash=p_email_hash;
 return jsonb_build_object('locked',incident,'retry_after',coalesce(seconds,0));
end $$;

create function public.unlock_login_protection(p_actor uuid,p_user uuid,p_email_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=p_actor and role='admin' for update;
 if not found or exists(select 1 from public.account_controls where user_id=p_actor and suspended) then raise exception 'Cần quyền quản trị'; end if;
 perform 1 from public.profiles where id=p_user for update;
 if not found or p_email_hash is null or p_email_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid account'; end if;
 delete from public.login_attempts where email_hash=p_email_hash;
 insert into public.audit_logs(user_id,action,target) values(p_actor,'login_protection_unlocked',p_user::text);
end $$;

alter table public.password_recovery_links add column otp_attempts integer not null default 0 check(otp_attempts between 0 and 5),
 add column otp_generation uuid;
create function public.claim_recovery_otp_attempt(p_email_hash text,p_recovery_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.password_recovery_links set otp_attempts=case when otp_generation=p_recovery_id then otp_attempts+1 else 1 end,
  otp_generation=p_recovery_id where email_hash=p_email_hash and recovery_id=p_recovery_id
  and consumed_at is null and expires_at>now() and (otp_generation is distinct from p_recovery_id or otp_attempts<5);
 return found;
end $$;

-- Only an actual password update clears the gate, not requesting/verifying OTP.
create function public.clear_login_attempts_after_password() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.encrypted_password is distinct from old.encrypted_password then
  delete from public.login_attempts a using public.password_recovery_tickets t where t.user_id=new.id and t.email_hash=a.email_hash;
 end if;
 return new;
end $$;
create trigger password_login_protection_reset after update of encrypted_password on auth.users
 for each row execute function public.clear_login_attempts_after_password();
revoke all on function public.begin_login_attempt(text,uuid),public.finish_login_attempt(text,uuid,text),
 public.claim_recovery_otp_attempt(text,uuid),public.clear_login_attempts_after_password(),
 public.login_otp_budget(text,text),public.login_protection_state(text),public.unlock_login_protection(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_login_attempt(text,uuid),public.finish_login_attempt(text,uuid,text),
 public.claim_recovery_otp_attempt(text,uuid),public.login_otp_budget(text,text),public.login_protection_state(text),public.unlock_login_protection(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
-- KEYNEST STEP 058_login_protection END
