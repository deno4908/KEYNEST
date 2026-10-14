begin;
create table public.order_receipts (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references public.orders(id),
 payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_until timestamptz,
 claim_token uuid,
 last_error text,
 sent_at timestamptz,
 created_at timestamptz not null default now()
);
create index order_receipts_pending on public.order_receipts(available_at) where status in ('pending','sending');
alter table public.order_receipts enable row level security;
revoke all on public.order_receipts from public,anon,authenticated;
grant select,insert,update on public.order_receipts to service_role;

-- Deferred until items and wallet/bank payment changes have all committed.
-- No old orders are backfilled. Unique order_id deduplicates repeated webhooks.
create function public.queue_order_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; recipient text;
begin
 select * into o from public.orders where id=new.id;
 if o.paid_at is null or o.status not in ('processing','completed') then return null; end if;
 select email into recipient from auth.users where id=o.user_id;
 if recipient is null or recipient='' then return null; end if;
 insert into public.order_receipts(order_id,payload) values(o.id,jsonb_build_object(
  'id',o.id,'number',o.number,'email',recipient,'paid_at',o.paid_at,'method',o.method,
  'subtotal',o.subtotal,'discount',o.discount,'total',o.total,
  'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.name,'variant_name',i.variant_name,
   'price',i.price,'quantity',i.quantity,'is_preorder',i.is_preorder,'expected_delivery',i.expected_delivery) order by i.id)
   from public.order_items i where i.order_id=o.id),'[]'::jsonb))) on conflict(order_id) do nothing;
 return null;
end $$;
create constraint trigger order_receipt_paid after insert or update of status on public.orders
 deferrable initially deferred for each row execute function public.queue_order_receipt();

create function public.claim_order_receipt() returns setof public.order_receipts language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 update public.order_receipts set status='failed',last_error='worker_lease_exhausted',claim_token=null,lease_until=null
  where status='sending' and lease_until<=now() and attempts>=8;
 select id into target from public.order_receipts
 where attempts<8 and ((status='pending' and available_at<=now()) or (status='sending' and lease_until<=now()))
 order by available_at,id for update skip locked limit 1;
 if target is null then return; end if;
 return query update public.order_receipts set status='sending',attempts=attempts+1,
  lease_until=now()+interval '2 minutes',claim_token=gen_random_uuid() where id=target returning *;
end $$;
create function public.finish_order_receipt(p_id uuid,p_claim uuid,p_sent boolean,p_error text default '') returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.order_receipts set status=case when p_sent then 'sent' when attempts>=8 then 'failed' else 'pending' end,
  sent_at=case when p_sent then now() else null end,lease_until=null,claim_token=null,
  last_error=case when p_sent then null else left(p_error,100) end,
  available_at=now()+make_interval(secs=>least(3600,30*(2^attempts)::int))
 where id=p_id and claim_token=p_claim and status='sending';
 return found;
end $$;
revoke all on function public.queue_order_receipt(),public.claim_order_receipt(),public.finish_order_receipt(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_order_receipt(),public.finish_order_receipt(uuid,uuid,boolean,text) to service_role;
commit;
