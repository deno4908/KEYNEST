begin;
alter table public.variants add column unlimited boolean not null default false;
alter table public.variants add constraint unlimited_key_only check(not unlimited or (delivery='key' and not is_preorder));
create table public.variant_shared_keys (
 variant_id uuid primary key references public.variants(id) on delete cascade,
 secret text not null,
 secret_hash text not null
);
alter table public.variant_shared_keys enable row level security;
revoke all on public.variant_shared_keys from public,anon,authenticated;
grant select,insert,update,delete on public.variant_shared_keys to service_role;

create or replace function public.save_variant(p_product uuid,p_data jsonb) returns uuid
language plpgsql set search_path=public as $$ declare vid uuid; old public.variants; unlimited_mode boolean; begin
 if p_data->>'id' is not null then
  select * into old from variants where id=(p_data->>'id')::uuid and product_id=p_product for update;
  if not found then raise exception 'Không tìm thấy gói'; end if;
 end if;
 unlimited_mode:=coalesce((p_data->>'unlimited')::boolean,old.unlimited,false);
 if old.id is not null and old.unlimited<>unlimited_mode then raise exception 'Hãy tạo gói mới để đổi chế độ kho'; end if;
 if unlimited_mode and (p_data->>'delivery'<>'key' or coalesce((p_data->>'is_preorder')::boolean,false)) then raise exception 'Gói dùng chung key phải giao mã tự động'; end if;
 if unlimited_mode and old.id is null and coalesce(p_data->'shared_key'->>'secret','')='' then raise exception 'Cần nhập key dùng chung'; end if;
 vid:=save_variant_core(p_product,p_data);
 if p_data ? 'warranty_days' then update variants set warranty_days=(p_data->>'warranty_days')::integer where id=vid; end if;
 if p_data ? 'is_preorder' then update variants set is_preorder=(p_data->>'is_preorder')::boolean,
 expected_delivery=case when (p_data->>'is_preorder')::boolean then (p_data->>'expected_delivery')::date else null end where id=vid; end if;
 if p_data ? 'active' then update variants set active=(p_data->>'active')::boolean where id=vid; end if;
 -- Availability compatibility for existing catalog/cart clients. Never decremented.
 update variants set unlimited=unlimited_mode,stock=case when unlimited_mode then 100000 else stock end where id=vid;
 if unlimited_mode and coalesce(p_data->'shared_key'->>'secret','')<>'' then
  insert into variant_shared_keys(variant_id,secret,secret_hash) values(vid,p_data->'shared_key'->>'secret',p_data->'shared_key'->>'hash')
  on conflict(variant_id) do update set secret=excluded.secret,secret_hash=excluded.secret_hash;
 end if;
 return vid;
end $$;

do $$ declare definition text; needle text; begin
 select pg_get_functiondef('public.create_order_before_sellers(uuid,jsonb,uuid)'::regprocedure) into definition;
 needle:='update variants set stock=stock-n where id=v.id;';
 if position(needle in definition)=0 then raise exception 'Unexpected checkout implementation'; end if;
 definition:=replace(definition,needle,'if not v.unlimited then update variants set stock=stock-n where id=v.id; end if;');
 needle:='if v.delivery=''key'' then for j in 1..n loop';
 if position(needle in definition)=0 then raise exception 'Unexpected key allocation implementation'; end if;
 definition:=replace(definition,needle,'if v.unlimited then
   if not exists(select 1 from public.variant_shared_keys where variant_id=v.id) then raise exception ''Chưa cấu hình key dùng chung''; end if;
   insert into public.inventory(variant_id,secret,secret_hash,order_id,item_id)
    select v.id,k.secret,k.secret_hash,oid,iid from public.variant_shared_keys k cross join generate_series(1,n) where k.variant_id=v.id;
  elsif v.delivery=''key'' then for j in 1..n loop');
 execute definition;
 select pg_get_functiondef('public.release_order(uuid)'::regprocedure) into definition;
 definition:=replace(definition,'where id=i.variant_id;', 'where id=i.variant_id and not unlimited;');
 definition:=replace(definition,'update inventory set order_id=null,item_id=null where order_id=p_order;', 'delete from public.inventory k using public.variants v where k.variant_id=v.id and v.unlimited and k.order_id=p_order; update inventory set order_id=null,item_id=null where order_id=p_order;');
 execute definition;
 select pg_get_functiondef('public.import_keys(uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'v.delivery<>''key''', '(v.delivery<>''key'' or v.unlimited)');
 execute definition;
end $$;
commit;
