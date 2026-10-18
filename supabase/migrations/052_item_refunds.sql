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
