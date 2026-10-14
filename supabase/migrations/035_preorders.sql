begin;
-- Preorders use paid/manual fulfillment. stock counts remaining reservations.
alter table public.variants add column is_preorder boolean not null default false,
  add column expected_delivery date,
  add constraint preorder_delivery check(not is_preorder or (delivery='manual' and expected_delivery is not null));
alter table public.order_items add column is_preorder boolean not null default false,
  add column expected_delivery date;
create or replace function public.save_variant(p_product uuid,p_data jsonb) returns uuid
language plpgsql set search_path=public as $$ declare vid uuid; begin
 vid:=save_variant_core(p_product,p_data);
 if p_data ? 'warranty_days' then update variants set warranty_days=(p_data->>'warranty_days')::integer where id=vid; end if;
 if p_data ? 'is_preorder' then
  update variants set is_preorder=(p_data->>'is_preorder')::boolean,
   expected_delivery=case when (p_data->>'is_preorder')::boolean then (p_data->>'expected_delivery')::date else null end where id=vid;
 end if;
 return vid;
end $$;
create function public.snapshot_preorder() returns trigger language plpgsql set search_path='' as $$
declare v public.variants;
begin
 select * into v from public.variants where id=new.variant_id;
 new.is_preorder:=v.is_preorder; new.expected_delivery:=v.expected_delivery;
 if v.is_preorder and v.expected_delivery < (now() at time zone 'Asia/Ho_Chi_Minh')::date then
  raise exception 'Đợt đặt trước đã hết hạn. Vui lòng chờ cửa hàng cập nhật ngày giao';
 end if;
 return new;
end $$;
create trigger preorder_snapshot before insert on public.order_items for each row execute function public.snapshot_preorder();
do $$ declare definition text; old_check text := 'if length(trim(p_payload->>''customer_note''))=0 then'; begin
 select pg_get_functiondef('public.create_order_before_sellers(uuid,jsonb,uuid)'::regprocedure) into definition;
 if position(old_check in definition)=0 then raise exception 'Unexpected create_order implementation'; end if;
 execute replace(definition,old_check,'if not v.is_preorder and length(trim(p_payload->>''customer_note''))=0 then');
end $$;
revoke all on function public.snapshot_preorder() from public,anon,authenticated;
commit;
