alter table public.variants add column warranty_days integer not null default 30 check(warranty_days between 0 and 3650);
alter table public.orders add column paid_at timestamptz, add column completed_at timestamptz;
-- Historic orders retain NULL: their delivery time / purchase-time policy is unknown.
alter table public.order_items add column warranty_days integer check(warranty_days between 0 and 3650),
  add column delivered_at timestamptz, add column product_image text not null default '', add column product_slug text not null default '';
alter table public.tickets add column kind text not null default 'support' check(kind in ('support','warranty')),
  add column order_id uuid references public.orders(id), add column warranty_key_ids uuid[] not null default '{}';
create unique index one_open_warranty_per_order on public.tickets(order_id) where kind='warranty' and status='open';

create function public.stamp_order_times() returns trigger language plpgsql set search_path=public as $$ begin
 if new.status in ('processing','completed') then
  if tg_op='INSERT' then new.paid_at:=coalesce(new.paid_at,now());
  elsif old.status='pending' then new.paid_at:=coalesce(new.paid_at,now()); end if;
 end if;
 if new.status='completed' then new.completed_at:=coalesce(new.completed_at,now()); end if;
 return new;
end $$;
create trigger order_times before insert or update of status on public.orders for each row execute function public.stamp_order_times();
create function public.snapshot_order_item() returns trigger language plpgsql set search_path=public as $$ declare v variants; p products; o orders; begin
 select * into v from variants where id=new.variant_id;
 select * into p from products where id=new.product_id;
 select * into o from orders where id=new.order_id;
 new.warranty_days:=v.warranty_days; new.product_image:=p.image; new.product_slug:=p.slug;
 if o.status='completed' or (o.status='processing' and new.delivery='key') then new.delivered_at:=coalesce(o.paid_at,now()); end if;
 return new;
end $$;
create trigger order_item_snapshot before insert on public.order_items for each row execute function public.snapshot_order_item();
create function public.stamp_item_delivery() returns trigger language plpgsql set search_path=public as $$ begin
 if new.status in ('processing','completed') then
  update order_items set delivered_at=coalesce(delivered_at,now()) where order_id=new.id and (new.status='completed' or delivery='key');
 end if;
 return new;
end $$;
create trigger item_delivery after update of status on public.orders for each row when(old.status is distinct from new.status) execute function public.stamp_item_delivery();

alter function public.save_variant(uuid,jsonb) rename to save_variant_core;
create function public.save_variant(p_product uuid,p_data jsonb) returns uuid language plpgsql set search_path=public as $$ declare vid uuid; begin
 vid:=save_variant_core(p_product,p_data);
 if p_data ? 'warranty_days' then update variants set warranty_days=(p_data->>'warranty_days')::integer where id=vid; end if;
 return vid;
end $$;

create function public.create_warranty(p_user uuid,p_order uuid,p_keys uuid[],p_message text) returns uuid language plpgsql set search_path=public as $$
declare o orders; k uuid; i order_items; tid uuid; begin
 select * into o from orders where id=p_order and user_id=p_user for update;
 if not found then raise exception 'Không tìm thấy đơn hàng'; end if;
 if o.status not in ('processing','completed') then raise exception 'Chỉ gửi bảo hành cho sản phẩm đã nhận, chưa hoàn tiền'; end if;
 if cardinality(p_keys) is null or cardinality(p_keys) not between 1 and 200 or cardinality(p_keys)<>(select count(distinct x) from unnest(p_keys) x) then raise exception 'Chọn sản phẩm bảo hành hợp lệ'; end if;
 if char_length(btrim(p_message)) not between 10 and 3000 then raise exception 'Mô tả cần từ 10 đến 3000 ký tự'; end if;
 if exists(select 1 from tickets where order_id=o.id and kind='warranty' and status='open') then raise exception 'Đơn này đã có yêu cầu bảo hành đang xử lý'; end if;
 foreach k in array p_keys loop
  select oi.* into i from order_items oi join inventory inv on inv.item_id=oi.id where inv.id=k and inv.order_id=o.id and oi.order_id=o.id;
  if not found or (i.delivery='manual' and o.status<>'completed') then raise exception 'Sản phẩm chưa được giao hoặc không thuộc đơn này'; end if;
  if i.warranty_days=0 then raise exception 'Gói sản phẩm không áp dụng bảo hành theo ngày'; end if;
  if i.warranty_days is not null and i.delivered_at is not null and now()>=i.delivered_at+make_interval(days=>i.warranty_days) then raise exception 'Sản phẩm đã hết thời hạn bảo hành'; end if;
 end loop;
 insert into tickets(user_id,subject,message,kind,order_id,warranty_key_ids)
 values(p_user,'Bảo hành đơn '||o.number,btrim(p_message),'warranty',o.id,p_keys) returning id into tid;
 return tid;
end $$;
revoke all on function public.stamp_order_times(),public.snapshot_order_item(),public.stamp_item_delivery(),public.save_variant(uuid,jsonb),public.create_warranty(uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.save_variant(uuid,jsonb),public.create_warranty(uuid,uuid,uuid[],text) to service_role;
