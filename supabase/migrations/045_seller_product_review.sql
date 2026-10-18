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
