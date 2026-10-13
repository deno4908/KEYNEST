begin;

-- Keep only salted hashes. Current passwords remain managed by Supabase Auth.
create table public.password_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  password_hash text not null,
  retired_at timestamptz not null default now()
);
create index password_history_user_time on public.password_history(user_id, retired_at);
alter table public.password_history enable row level security;
revoke all on public.password_history from public, anon, authenticated;
grant select, delete on public.password_history to service_role;

create function public.record_password_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.encrypted_password is distinct from new.encrypted_password
     and coalesce(old.encrypted_password, '') <> '' then
    insert into public.password_history(user_id, password_hash, retired_at)
      values(old.id, old.encrypted_password, now());
    delete from public.password_history where user_id = old.id
      and retired_at <= now() - interval '30 days';
  end if;
  return new;
end;
$$;
revoke all on function public.record_password_history() from public, anon, authenticated;
create trigger keynest_password_history after update of encrypted_password on auth.users
  for each row execute function public.record_password_history();

-- Serialize password changes across application instances while Auth updates.
create table public.password_change_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lock_id uuid not null,
  expires_at timestamptz not null
);
alter table public.password_change_locks enable row level security;
revoke all on public.password_change_locks from public, anon, authenticated;

create function public.begin_password_change(p_user_id uuid, p_lock_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare claimed uuid; current_hash text; old_hashes jsonb;
begin
  insert into public.password_change_locks values(p_user_id, p_lock_id, now() + interval '2 minutes')
  on conflict(user_id) do update set lock_id = excluded.lock_id, expires_at = excluded.expires_at
    where public.password_change_locks.expires_at <= now()
  returning lock_id into claimed;
  if claimed is null then return null; end if;
  select encrypted_password into current_hash from auth.users where id = p_user_id;
  delete from public.password_history where user_id = p_user_id and retired_at <= now() - interval '30 days';
  select coalesce(jsonb_agg(password_hash), '[]'::jsonb) into old_hashes
    from public.password_history where user_id = p_user_id and retired_at > now() - interval '30 days';
  return jsonb_build_object('current_hash', current_hash, 'history', old_hashes);
end;
$$;
create function public.finish_password_change(p_user_id uuid, p_lock_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.password_change_locks where user_id = p_user_id and lock_id = p_lock_id;
$$;
revoke all on function public.begin_password_change(uuid, uuid), public.finish_password_change(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_password_change(uuid, uuid), public.finish_password_change(uuid, uuid) to service_role;

-- Inspect before enforcing the password policy. A rejected password must not
-- consume the reset ticket; the existing claim function still consumes once.
create function public.inspect_password_recovery_reset(p_ticket_hash text)
returns table(user_id uuid)
language sql security definer set search_path = '' as $$
  select t.user_id from public.password_recovery_tickets t
  join public.password_recovery_links l on l.email_hash = t.email_hash
    and l.recovery_id = t.recovery_id and l.consumed_at is not null
    and l.expires_at > now()
  where t.ticket_hash = p_ticket_hash and t.consumed_at is null and t.expires_at > now();
$$;
revoke all on function public.inspect_password_recovery_reset(text) from public, anon, authenticated;
grant execute on function public.inspect_password_recovery_reset(text) to service_role;
commit;
