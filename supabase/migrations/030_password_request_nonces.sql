begin;

create table public.password_request_nonces (
  nonce_hash text primary key check(nonce_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null
);
create index password_request_nonces_expiry on public.password_request_nonces(expires_at);
alter table public.password_request_nonces enable row level security;
revoke all on public.password_request_nonces from public, anon, authenticated;

create function public.consume_password_request_nonce(p_nonce_hash text, p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed text;
begin
  if p_expires_at is null or p_expires_at <= clock_timestamp()
     or p_expires_at > clock_timestamp() + interval '125 seconds' then
    return false;
  end if;
  delete from public.password_request_nonces where expires_at <= clock_timestamp();
  insert into public.password_request_nonces(nonce_hash, expires_at)
    values(p_nonce_hash, p_expires_at)
    on conflict(nonce_hash) do nothing returning nonce_hash into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.consume_password_request_nonce(text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_password_request_nonce(text, timestamptz) to service_role;
commit;
