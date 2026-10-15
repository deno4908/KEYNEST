begin;
alter table public.products add column product_kind text not null default 'key'
  check (product_kind in ('key','account','source','product','service'));
alter table public.order_items add column product_kind text not null default 'key'
  check (product_kind in ('key','account','source','product','service'));

-- Preserve the purchased classification independently of later catalog edits.
create function public.snapshot_product_kind() returns trigger
language plpgsql set search_path='' as $$
begin
  select p.product_kind into new.product_kind from public.products p where p.id=new.product_id;
  return new;
end $$;
create trigger order_product_kind before insert on public.order_items
  for each row execute function public.snapshot_product_kind();
revoke all on function public.snapshot_product_kind() from public,anon,authenticated;

-- Seller edits use the same field and existing ownership checks.
do $$ declare definition text; marker text; begin
  select pg_get_functiondef('public.seller_command(uuid,text,jsonb)'::regprocedure) into definition;
  marker := 'insert into audit_logs(user_id,action,target) values(p_actor,''seller_product'',target::text);';
  if strpos(definition,marker)=0 then raise exception 'seller product marker not found'; end if;
  execute replace(definition,marker,
    'if p_data ? ''product_kind'' then update products set product_kind=p_data->>''product_kind'' where id=target; end if; ' || marker);
end $$;
commit;
