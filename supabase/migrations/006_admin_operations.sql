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
