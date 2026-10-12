begin;

-- Keep the last delivered generation until the provider accepts the next email.
create table public.password_recovery_sends (
  email_hash text primary key,
  recovery_id uuid not null,
  requested_at timestamptz not null default now()
);
alter table public.password_recovery_sends enable row level security;
revoke all on public.password_recovery_sends from public, anon, authenticated;
grant all on public.password_recovery_sends to service_role;

create function public.reserve_password_recovery(p_email_hash text, p_recovery_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed uuid;
begin
  insert into password_recovery_sends(email_hash, recovery_id) values(p_email_hash, p_recovery_id)
  on conflict(email_hash) do update
    set recovery_id = excluded.recovery_id, requested_at = now()
    where password_recovery_sends.requested_at <= now() - interval '90 seconds'
  returning recovery_id into claimed;
  return claimed is not null;
end;
$$;

create function public.finish_password_recovery(p_email_hash text, p_recovery_id uuid, p_sent boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare sent_at timestamptz;
begin
  select requested_at into sent_at from password_recovery_sends
    where email_hash = p_email_hash and recovery_id = p_recovery_id for update;
  if not found then return false; end if;
  if not p_sent then
    delete from password_recovery_sends where email_hash = p_email_hash;
    return true;
  end if;
  insert into password_recovery_links(email_hash, recovery_id, expires_at, consumed_at)
    values(p_email_hash, p_recovery_id, sent_at + interval '10 minutes', null)
  on conflict(email_hash) do update set recovery_id = excluded.recovery_id,
    expires_at = excluded.expires_at, consumed_at = null, created_at = sent_at;
  return true;
end;
$$;

-- Consumption and ticket persistence must either both succeed or both roll back.
create function public.redeem_password_recovery(p_ticket jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare deadline timestamptz;
begin
  update password_recovery_links set consumed_at=now()
    where email_hash=p_ticket->>'email_hash'
      and recovery_id=(p_ticket->>'recovery_id')::uuid
      and consumed_at is null and expires_at > now()
    returning expires_at into deadline;
  if not found then return false; end if;
  insert into password_recovery_tickets(ticket_hash,email_hash,recovery_id,user_id,encrypted_session,expires_at)
    values(p_ticket->>'ticket_hash',p_ticket->>'email_hash',(p_ticket->>'recovery_id')::uuid,
      (p_ticket->>'user_id')::uuid,p_ticket->>'encrypted_session',deadline);
  return true;
end;
$$;

revoke all on function public.redeem_password_recovery(jsonb) from public, anon, authenticated;
grant execute on function public.redeem_password_recovery(jsonb) to service_role;
revoke all on function public.reserve_password_recovery(text, uuid),
  public.finish_password_recovery(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.reserve_password_recovery(text, uuid),
  public.finish_password_recovery(text, uuid, boolean) to service_role;
commit;
