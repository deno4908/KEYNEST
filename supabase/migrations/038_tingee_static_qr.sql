begin;
-- Existing dynamic bills keep their original reconciliation path.
alter table public.payment_routes add column if not exists qr_kind text not null default 'dynamic' check(qr_kind in ('static','dynamic'));

create or replace function public.finish_payment_route(p_id uuid,p_claim uuid,p_data jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.payments where id=p_id and status='pending' and expires_at>now() for update;
 if not found then return false; end if;
 if coalesce(p_data->>'qr_kind','dynamic') not in ('static','dynamic') then raise exception 'Invalid QR kind'; end if;
 if p_data->>'provider'='tingee' and ((coalesce(p_data->>'qr_kind','dynamic')='dynamic' and coalesce(p_data->>'bill_id','')='') or coalesce(p_data->>'qr_account','')='' or coalesce(p_data->>'qr_image','')='') then raise exception 'Missing QR'; end if;
 update public.payment_routes set state=case when p_data->>'provider' is null then 'failed' else 'ready' end,
  qr_kind=coalesce(p_data->>'qr_kind','dynamic'),provider=p_data->>'provider',bill_id=p_data->>'bill_id',qr_account=p_data->>'qr_account',qr_image=p_data->>'qr_image',
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

create or replace function public.settle_routed_payment(p_source text,p_transaction text,p_code text,p_amount bigint,p_bill text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payments; r public.payment_routes;
begin
 perform public.expire_payments();
 select * into p from public.payments where code=p_code for update;
 if found then
  select * into r from public.payment_routes where payment_id=p.id;
  if (found and (r.state<>'ready' or r.provider is distinct from p_source or (p_source='tingee' and (r.qr_kind<>'dynamic' or r.bill_id is distinct from p_bill))))
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

-- Only server-verified CREDIT transactions from the signed history API reach here.
-- Persist source identity so retries and two payments cannot spend the same transfer.
create function public.settle_tingee_static(p_transaction text,p_code text,p_amount bigint,p_account text,p_bank text,p_time timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payments; r public.payment_routes;
begin
 perform public.expire_payments();
 select * into p from public.payments where code=p_code for update;
 if not found then return jsonb_build_object('ignored',true); end if;
 select * into r from public.payment_routes where payment_id=p.id;
 if not found or r.provider is distinct from 'tingee' or r.state<>'ready' or r.qr_kind<>'static'
   or p_account is distinct from r.account or p_bank is distinct from r.bank_bin
   or p_time is null or p_time < date_trunc('second',p.created_at) or p_time > clock_timestamp()+interval '5 minutes'
   or p_transaction is null or p_transaction !~ '^tingee-static:[a-f0-9]{64}$' or p_amount is null or p_amount<=0 then
  return jsonb_build_object('ignored',true);
 end if;
 if p_time > p.expires_at then
  insert into public.payment_events(transaction_id,code,amount,outcome) values(p_transaction,p_code,p_amount,'needs_review') on conflict do nothing;
  return jsonb_build_object('review',true);
 end if;
 return public.settle_payment(p_transaction,p_code,p_amount);
end $$;
revoke all on function public.settle_tingee_static(text,text,bigint,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_tingee_static(text,text,bigint,text,text,timestamptz) to service_role;
commit;
