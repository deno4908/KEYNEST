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
