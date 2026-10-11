-- Enforce the displayed 1,000 VND step even for direct API/RPC calls.
create or replace function public.create_wallet_topup(p_user uuid, p_amount bigint)
returns public.payments language plpgsql security definer set search_path=public as $$
declare result public.payments;
begin
  if p_amount is null or p_amount < 10000 or p_amount > 50000000 or p_amount % 1000 <> 0 then
    raise exception 'Số tiền nạp không hợp lệ';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet-topup:' || p_user::text || ':' || p_amount::text, 0));
  select * into result from public.payments
    where user_id=p_user and amount=p_amount and order_id is null
      and status='pending' and expires_at > clock_timestamp()
    order by created_at desc, id limit 1 for update;
  if found and result.expires_at > clock_timestamp() then return result; end if;
  insert into public.payments(user_id, amount) values(p_user,p_amount) returning * into result;
  return result;
end $$;
revoke all on function public.create_wallet_topup(uuid,bigint) from public,anon,authenticated;
grant execute on function public.create_wallet_topup(uuid,bigint) to service_role;
