begin;

-- Tingee may expose a bank credit only after a static QR's payment deadline.
-- A verified wallet top-up received before that deadline is safe to credit
-- even if polling observes it later. Expired orders still require review since
-- their reserved inventory may already have been released.
create or replace function public.settle_tingee_static(
  p_transaction text,
  p_code text,
  p_amount bigint,
  p_account text,
  p_bank text,
  p_time timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
  r public.payment_routes;
  e public.payment_events;
begin
  perform public.expire_payments();

  select * into p
  from public.payments
  where code = p_code
  for update;
  if not found then return jsonb_build_object('ignored', true); end if;

  select * into r
  from public.payment_routes
  where payment_id = p.id
  for update;
  if not found
     or r.provider is distinct from 'tingee'
     or r.state <> 'ready'
     or r.qr_kind <> 'static'
     or p_account is distinct from r.account
     or p_bank is distinct from r.bank_bin
     or p_time is null
     or p_time < date_trunc('second', p.created_at)
     or p_time > clock_timestamp() + interval '5 minutes'
     or p_transaction is null
     or p_transaction !~ '^tingee-static:[a-f0-9]{64}$'
     or p_amount is null
     or p_amount <= 0 then
    return jsonb_build_object('ignored', true);
  end if;

  if p_time > p.expires_at then
    insert into public.payment_events(transaction_id, code, amount, outcome)
    values (p_transaction, p_code, p_amount, 'needs_review')
    on conflict (transaction_id) do nothing;
    return jsonb_build_object('review', true);
  end if;

  -- For wallet top-ups, timestamp and exact amount prove that the transfer
  -- was made in time. Handle pending or expired rows directly because the
  -- shared settle_payment() intentionally rejects expired payments.
  if p.order_id is null
     and p.status in ('pending', 'expired')
     and p.amount = p_amount then
    select * into e
    from public.payment_events
    where transaction_id = p_transaction
    for update;

    if found then
      if e.code is distinct from p_code or e.amount is distinct from p_amount then
        return jsonb_build_object('ignored', true);
      end if;
      if e.outcome in ('paid', 'credited') then
        return jsonb_build_object('duplicate', true);
      end if;
      if e.outcome not in ('received', 'needs_review') then
        return jsonb_build_object('ignored', true);
      end if;
      update public.payment_events
      set outcome = 'received', reason = null
      where transaction_id = p_transaction;
    else
      insert into public.payment_events(transaction_id, code, amount, outcome)
      values (p_transaction, p_code, p_amount, 'received')
      on conflict (transaction_id) do nothing;

      if not found then
        select * into e
        from public.payment_events
        where transaction_id = p_transaction
        for update;
        if not found
           or e.code is distinct from p_code
           or e.amount is distinct from p_amount then
          return jsonb_build_object('ignored', true);
        end if;
        if e.outcome in ('paid', 'credited') then
          return jsonb_build_object('duplicate', true);
        end if;
        if e.outcome not in ('received', 'needs_review') then
          return jsonb_build_object('ignored', true);
        end if;
        update public.payment_events
        set outcome = 'received', reason = null
        where transaction_id = p_transaction;
      end if;
    end if;

    update public.profiles
    set balance = balance + p_amount
    where id = p.user_id;
    if not found then raise exception 'Payment owner profile is missing'; end if;

    insert into public.wallet_ledger(user_id, amount, description)
    values (p.user_id, p_amount, 'Nạp ví ' || p_code);

    update public.payments
    set status = 'paid', transaction_id = p_transaction
    where id = p.id;

    update public.payment_events
    set outcome = 'paid'
    where transaction_id = p_transaction;

    return jsonb_build_object('paid', true);
  end if;

  -- Preserve the standard path for in-deadline orders and route all other
  -- cases (late transfer, wrong amount, cancelled payment) to review.
  return public.settle_payment(p_transaction, p_code, p_amount);
end;
$$;

revoke all on function public.settle_tingee_static(text, text, bigint, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.settle_tingee_static(text, text, bigint, text, text, timestamptz)
  to service_role;

commit;
