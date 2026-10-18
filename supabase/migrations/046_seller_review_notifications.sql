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
