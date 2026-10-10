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
