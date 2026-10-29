begin;

alter table public.payment_routes add column poll_failures integer not null default 0 check(poll_failures>=0);

-- Keep the lease in database time and return only reconciliation inputs, never
-- the base64 QR image. A claim token prevents an old worker rescheduling a newer job.
create or replace function public.claim_tingee_polls() returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare r public.payment_routes; p public.payments;
begin
 for r in select * from public.payment_routes where provider='tingee' and state='ready' and not remote_closed
  and next_poll_at<=now() and (lease_until is null or lease_until<=now())
  order by next_poll_at,payment_id for update skip locked limit 20 loop
  update public.payment_routes set next_poll_at=now()+interval '3 minutes',
   lease_until=now()+interval '3 minutes',claim_token=pg_catalog.gen_random_uuid()
   where payment_id=r.payment_id returning * into r;
  select * into p from public.payments where id=r.payment_id;
  return next jsonb_build_object(
   'payment_id',r.payment_id,'claim_token',r.claim_token,'polled_at',now(),
   'qr_kind',r.qr_kind,'bill_id',r.bill_id,'qr_account',r.qr_account,
   'bank_bin',r.bank_bin,'account',r.account,'va_account',r.va_account,
   'last_error',r.last_error,'poll_failures',r.poll_failures,
   'payment',jsonb_build_object('id',p.id,'code',p.code,'amount',p.amount,
    'status',p.status,'created_at',p.created_at,'expires_at',p.expires_at));
 end loop;
end $$;

-- One acknowledgement replaces status/error PATCH + a second schedule PATCH.
-- The VPS supplies no absolute timestamp. Successful pending dynamic bills keep
-- a 5s cadence; failed checks back off and never change the pinned provider.
create function public.finish_tingee_poll(p_id uuid,p_claim uuid,p_error text default null,
 p_closed boolean default false,p_failed boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.payment_routes; p public.payments; failures integer; delay_seconds integer; active boolean;
begin
 if char_length(p_error)>120 then raise exception 'Invalid poll diagnostic'; end if;
 select * into p from public.payments where id=p_id;
 select * into r from public.payment_routes where payment_id=p_id and provider='tingee'
  and state='ready' and claim_token=p_claim for update;
 if not found or p.id is null then return false; end if;
 active:=p.status='pending' and p.expires_at>clock_timestamp();
 failures:=case when p_failed then least(r.poll_failures+1,10) else 0 end;
 delay_seconds:=case when r.qr_kind='static' and not active then 600
  when r.qr_kind='static' then 30 when not active then 30 else 5 end;
 if p_failed then
  delay_seconds:=greatest(delay_seconds,case when active then
   least(300,15*power(2,least(failures-1,5)))::integer
   else least(3600,60*power(2,least(failures-1,6)))::integer end);
 end if;
 update public.payment_routes set next_poll_at=clock_timestamp()+make_interval(secs=>delay_seconds),
  remote_closed=remote_closed or (coalesce(p_closed,false) and not coalesce(p_failed,false)),
  last_error=p_error,poll_failures=failures,claim_token=null,lease_until=null
  where payment_id=p_id;
 return true;
end $$;
revoke all on function public.claim_tingee_polls(),public.finish_tingee_poll(uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_tingee_polls(),public.finish_tingee_poll(uuid,uuid,text,boolean,boolean) to service_role;

commit;
