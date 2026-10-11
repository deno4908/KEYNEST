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
