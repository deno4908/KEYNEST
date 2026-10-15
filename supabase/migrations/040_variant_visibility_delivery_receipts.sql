begin;
alter table public.variants add column active boolean not null default true;
do $$ declare definition text; begin
 select pg_get_functiondef('public.save_variant(uuid,jsonb)'::regprocedure) into definition;
 execute replace(definition,'return vid;', 'if p_data ? ''active'' then update public.variants set active=(p_data->>''active'')::boolean where id=vid; end if; return vid;');
 select pg_get_functiondef('public.snapshot_preorder()'::regprocedure) into definition;
 execute replace(definition,'new.is_preorder:=v.is_preorder;', 'if not v.active then raise exception ''Gói sản phẩm đã ngừng bán''; end if; new.is_preorder:=v.is_preorder;');
 select pg_get_functiondef('public.catalog_search(jsonb)'::regprocedure) into definition;
 execute replace(definition,'v.product_id=p.id','v.product_id=p.id and v.active');
end $$;

alter table public.order_receipts drop constraint order_receipts_order_id_key;
alter table public.order_receipts add column kind text not null default 'payment' check(kind in ('payment','delivery'));
alter table public.order_receipts add constraint order_receipts_order_kind_key unique(order_id,kind);

-- Snapshots contain encrypted inventory only. Decryption happens in the email worker.
do $$ declare definition text; begin
 select pg_get_functiondef('public.queue_order_receipt()'::regprocedure) into definition;
 definition:=replace(definition,'''expected_delivery'',i.expected_delivery)', '''expected_delivery'',i.expected_delivery,''delivered_at'',i.delivered_at,''encrypted_keys'',coalesce((select jsonb_agg(k.secret order by k.id) from public.inventory k where k.order_id=o.id and k.item_id=i.id),''[]''::jsonb))');
 definition:=replace(definition,'on conflict(order_id)', 'on conflict(order_id,kind)');
 execute definition;
end $$;

create function public.queue_delivery_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; recipient text;
begin
 select * into o from public.orders where id=new.order_id;
 if o.paid_at is null or o.status not in ('processing','completed') then return null; end if;
 if not exists(select 1 from public.order_items where order_id=o.id and delivery='manual')
   or exists(select 1 from public.order_items where order_id=o.id and delivered_at is null) then return null; end if;
 select email into recipient from auth.users where id=o.user_id;
 if recipient is null or recipient='' then return null; end if;
 insert into public.order_receipts(order_id,kind,payload) values(o.id,'delivery',jsonb_build_object(
  'id',o.id,'number',o.number,'email',recipient,'paid_at',o.paid_at,'method',o.method,'kind','delivery',
  'subtotal',o.subtotal,'discount',o.discount,'total',o.total,
  'items',(select jsonb_agg(jsonb_build_object('name',i.name,'variant_name',i.variant_name,'quantity',i.quantity,'price',i.price,
    'is_preorder',i.is_preorder,'expected_delivery',i.expected_delivery,'delivered_at',i.delivered_at,
    'encrypted_keys',coalesce((select jsonb_agg(k.secret order by k.id) from public.inventory k where k.order_id=o.id and k.item_id=i.id),'[]'::jsonb)) order by i.id)
    from public.order_items i where i.order_id=o.id))) on conflict(order_id,kind) do nothing;
 return null;
end $$;
create constraint trigger order_delivery_receipt after update of delivered_at on public.order_items
 deferrable initially deferred for each row execute function public.queue_delivery_receipt();
revoke all on function public.queue_delivery_receipt() from public,anon,authenticated;
commit;
