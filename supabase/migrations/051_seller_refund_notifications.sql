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
