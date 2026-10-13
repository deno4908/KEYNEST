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
