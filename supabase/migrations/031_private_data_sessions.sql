begin;

-- Private data is served by Node, which enforces MFA, suspension and sessions.
do $$ declare t text; columns text; begin
  foreach t in array array['profiles','orders','order_items','payments','wallet_ledger','tickets','ticket_messages'] loop
    execute format('revoke all on public.%I from public,anon,authenticated', t);
    select string_agg(quote_ident(attname), ',') into columns from pg_attribute
      where attrelid=format('public.%I',t)::regclass and attnum>0 and not attisdropped;
    execute format('revoke select (%s) on public.%I from public,anon,authenticated', columns,t);
  end loop;
end $$;

alter table public.account_controls add column sessions_revoked_before timestamptz;
alter table public.account_controls add column session_exception uuid;
alter table public.app_sessions add column auth_session_id uuid;

-- All session decisions serialize on the profile row, including set_customer_access.
-- Use Auth's original creation time, never the refreshed JWT's iat.
create function public.authorize_app_session(p_user uuid,p_session uuid,p_hash text,p_agent text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare control public.account_controls%rowtype; original_time timestamptz; tracked public.app_sessions%rowtype;
begin
  perform 1 from public.profiles where id=p_user for update;
  if not found then return jsonb_build_object('status','revoked'); end if;
  select * into control from public.account_controls where user_id=p_user;
  if control.suspended then return jsonb_build_object('status','suspended'); end if;
  select created_at into original_time from auth.sessions where id=p_session and user_id=p_user;
  if original_time is null or (original_time <= control.sessions_revoked_before
      and p_session is distinct from control.session_exception) then
    return jsonb_build_object('status','revoked');
  end if;
  insert into public.app_sessions(user_id,token_hash,user_agent,auth_session_id,created_at)
    values(p_user,p_hash,left(coalesce(p_agent,''),300),p_session,original_time)
    on conflict(token_hash) do nothing;
  select * into tracked from public.app_sessions where token_hash=p_hash and user_id=p_user;
  if not found or tracked.revoked_at is not null then return jsonb_build_object('status','revoked'); end if;
  update public.app_sessions set auth_session_id=p_session where id=tracked.id;
  return jsonb_build_object('status','ok','id',tracked.id);
end $$;

create function public.revoke_app_sessions(p_user uuid,p_id uuid default null,p_except uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare keep_session uuid; cutoff timestamptz;
begin
  perform 1 from public.profiles where id=p_user for update;
  if not found then return false; end if;
  if exists(select 1 from public.account_controls where user_id=p_user and suspended) then return false; end if;
  if p_except is not null then
    select auth_session_id into keep_session from public.app_sessions
      where id=p_except and user_id=p_user and revoked_at is null;
    if keep_session is null then return false; end if;
  end if;
  cutoff := clock_timestamp();
  if p_id is null then
    insert into public.account_controls(user_id,sessions_revoked_before,session_exception)
      values(p_user,cutoff,keep_session)
      on conflict(user_id) do update set sessions_revoked_before=excluded.sessions_revoked_before,
        session_exception=excluded.session_exception;
  end if;
  update public.app_sessions set revoked_at=coalesce(revoked_at,cutoff)
    where user_id=p_user and (p_id is null or id=p_id) and id is distinct from p_except;
  return p_id is null or found;
end $$;

-- Unblocking an account must not resurrect unregistered sessions from before suspension.
create function public.suspend_session_cutoff() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.suspended then
    new.sessions_revoked_before := clock_timestamp();
    new.session_exception := null;
  end if;
  return new;
end $$;
create trigger suspend_session_cutoff before insert or update of suspended on public.account_controls
  for each row execute function public.suspend_session_cutoff();
update public.account_controls set suspended=suspended where suspended;

revoke all on function public.authorize_app_session(uuid,uuid,text,text),
  public.revoke_app_sessions(uuid,uuid,uuid),public.suspend_session_cutoff() from public,anon,authenticated;
grant execute on function public.authorize_app_session(uuid,uuid,text,text),
  public.revoke_app_sessions(uuid,uuid,uuid) to service_role;
commit;
