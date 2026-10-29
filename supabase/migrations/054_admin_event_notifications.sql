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
