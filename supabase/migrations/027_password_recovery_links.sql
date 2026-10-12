begin;

create table public.password_recovery_links (
  email_hash text primary key check (email_hash ~ '^[a-f0-9]{64}$'),
  recovery_id uuid not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.password_recovery_tickets (
  ticket_hash text primary key check (ticket_hash ~ '^[a-f0-9]{64}$'),
  email_hash text not null,
  recovery_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_session text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (email_hash) references public.password_recovery_links(email_hash)
    on update cascade on delete cascade
);

alter table public.password_recovery_links enable row level security;
alter table public.password_recovery_tickets enable row level security;
revoke all on public.password_recovery_links, public.password_recovery_tickets
  from public, anon, authenticated;
grant select, insert, update, delete on public.password_recovery_links,
  public.password_recovery_tickets to service_role;

create function public.claim_password_recovery_reset(
  p_ticket_hash text,
  p_now timestamptz
)
returns table(user_id uuid, encrypted_session text)
language plpgsql
security definer
set search_path = public
as $$
declare
  found_ticket public.password_recovery_tickets%rowtype;
begin
  select t.* into found_ticket
  from public.password_recovery_tickets t
  join public.password_recovery_links l
    on l.email_hash = t.email_hash
   and l.recovery_id = t.recovery_id
   and l.consumed_at is not null
   and l.expires_at > p_now
  where t.ticket_hash = p_ticket_hash
    and t.consumed_at is null
    and t.expires_at > p_now
  for update of t, l;

  if not found then return; end if;

  update public.password_recovery_tickets t
  set consumed_at = p_now
  where t.ticket_hash = p_ticket_hash
  returning t.user_id, t.encrypted_session
    into user_id, encrypted_session;

  return next;
end;
$$;

revoke all on function public.claim_password_recovery_reset(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_password_recovery_reset(text, timestamptz)
  to service_role;

commit;
