begin;
-- Existing payments retain their original transfer instructions. New payments
-- cannot be credited by a provider until routing is durably committed.
create table public.payment_routes (
 payment_id uuid primary key references public.payments(id),
 provider text check(provider in ('tingee','pay2s','sepay')),
 state text not null default 'unassigned' check(state in ('unassigned','creating','ready','failed')),
 claim_token uuid, lease_until timestamptz, attempts integer not null default 0,
 bill_id text unique, qr_account text, qr_image text, qr_expires_at timestamptz,
 bank text, account text, account_name text,
 bank_bin text, va_account text,
 next_poll_at timestamptz not null default now(), remote_closed boolean not null default false,
 last_error text, created_at timestamptz not null default now()
);
create index payment_routes_poll on public.payment_routes(next_poll_at) where provider='tingee' and state='ready' and not remote_closed;
alter table public.payment_routes enable row level security;
revoke all on public.payment_routes from public,anon,authenticated;
grant select,insert,update on public.payment_routes to service_role;
create function public.new_payment_route() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.payment_routes(payment_id) values(new.id); return new; end $$;
create trigger new_payment_route after insert on public.payments for each row execute function public.new_payment_route();

create function public.claim_payment_route(p_id uuid,p_claim uuid) returns setof public.payment_routes
language plpgsql security definer set search_path='' as $$
begin
 -- Same lock order as settlement/expiry: payment, then route.
 perform 1 from public.payments where id=p_id and status='pending' and expires_at>now() for update;
 if found then
  update public.payment_routes set state='creating',claim_token=p_claim,lease_until=now()+interval '45 seconds',attempts=attempts+1
  where payment_id=p_id and (state='unassigned' or (state='creating' and lease_until<=now()));
 end if;
 return query select * from public.payment_routes where payment_id=p_id;
end $$;
create function public.finish_payment_route(p_id uuid,p_claim uuid,p_data jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.payments where id=p_id and status='pending' and expires_at>now() for update;
 if not found then return false; end if;
 if p_data->>'provider'='tingee' and (coalesce(p_data->>'bill_id','')='' or coalesce(p_data->>'qr_account','')='' or coalesce(p_data->>'qr_image','')='') then raise exception 'Missing dynamic QR'; end if;
 update public.payment_routes set state=case when p_data->>'provider' is null then 'failed' else 'ready' end,
  provider=p_data->>'provider',bill_id=p_data->>'bill_id',qr_account=p_data->>'qr_account',qr_image=p_data->>'qr_image',
  bank=p_data->>'bank',account=p_data->>'account',account_name=p_data->>'account_name',
  bank_bin=p_data->>'bank_bin',va_account=p_data->>'va_account',qr_expires_at=(p_data->>'expires_at')::timestamptz,
  last_error=p_data->>'error',claim_token=null,lease_until=null
 where payment_id=p_id and state='creating' and claim_token=p_claim;
 if not found then return false; end if;
 if p_data->>'provider'='tingee' then
  update public.payments set expires_at=least(expires_at,(p_data->>'expires_at')::timestamptz) where id=p_id;
 end if;
 return true;
end $$;

create function public.claim_tingee_polls() returns setof jsonb language plpgsql security definer set search_path='' as $$
declare r public.payment_routes; p public.payments;
begin
 for r in select * from public.payment_routes where provider='tingee' and state='ready' and not remote_closed
  and next_poll_at<=now() order by next_poll_at,payment_id for update skip locked limit 20 loop
  -- Lease covers all five batches, each with up to three 8-second API calls.
  update public.payment_routes set next_poll_at=now()+interval '3 minutes' where payment_id=r.payment_id;
  select * into p from public.payments where id=r.payment_id;
  return next to_jsonb(r)||jsonb_build_object('payment',to_jsonb(p));
 end loop;
end $$;

-- Only authenticated provider data can reach this service-only RPC. Guard
-- source and amount at the same time as settlement, including fallback races.
create function public.settle_routed_payment(p_source text,p_transaction text,p_code text,p_amount bigint,p_bill text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payments; r public.payment_routes;
begin
 perform public.expire_payments();
 select * into p from public.payments where code=p_code for update;
 if found then
  select * into r from public.payment_routes where payment_id=p.id;
  if (found and (r.state<>'ready' or r.provider is distinct from p_source or (p_source='tingee' and r.bill_id is distinct from p_bill)))
     or (not found and p_source='tingee') then
   -- A second provider can report the same bank transfer. Never offer that
   -- report for manual credit while the assigned provider is reconciling it.
   insert into public.payment_events(transaction_id,code,amount,outcome) values(p_transaction,p_code,p_amount,'provider_mismatch') on conflict do nothing;
   return jsonb_build_object('ignored',true);
  end if;
 end if;
 if p_source not in ('tingee','pay2s','sepay') then raise exception 'Invalid payment source'; end if;
 return public.settle_payment(p_transaction,p_code,p_amount);
end $$;
revoke all on function public.new_payment_route(),public.claim_payment_route(uuid,uuid),public.finish_payment_route(uuid,uuid,jsonb),public.claim_tingee_polls(),public.settle_routed_payment(text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.claim_payment_route(uuid,uuid),public.finish_payment_route(uuid,uuid,jsonb),public.claim_tingee_polls(),public.settle_routed_payment(text,text,text,bigint,text) to service_role;
commit;
