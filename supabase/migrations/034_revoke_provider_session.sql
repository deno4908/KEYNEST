begin;

-- A locally revoked device must also lose access to Supabase Auth endpoints.
-- No browser grants on auth.sessions: deletion stays inside this service RPC.
create or replace function public.revoke_app_sessions(p_user uuid,p_id uuid default null,p_except uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare keep_session uuid; target_session uuid; cutoff timestamptz;
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
  if p_id is not null then
    select auth_session_id into target_session from public.app_sessions
      where id=p_id and user_id=p_user and id is distinct from p_except for update;
    if not found then return false; end if;
    if target_session is null then
      raise exception 'Phiên cũ chưa có mã thiết bị. Hãy dùng Thu hồi các phiên khác';
    end if;
    update public.app_sessions set revoked_at=coalesce(revoked_at,cutoff)
      where id=p_id and user_id=p_user;
    -- Auth rejects a missing session_id; dependent refresh tokens are removed
    -- by Auth's foreign-key cascade. Never delete by a client-supplied Auth ID.
    delete from auth.sessions where id=target_session and user_id=p_user;
    return true;
  end if;
  insert into public.account_controls(user_id,sessions_revoked_before,session_exception)
    values(p_user,cutoff,keep_session)
    on conflict(user_id) do update set sessions_revoked_before=excluded.sessions_revoked_before,
      session_exception=excluded.session_exception;
  update public.app_sessions set revoked_at=coalesce(revoked_at,cutoff)
    where user_id=p_user and id is distinct from p_except;
  -- Bulk provider revocation continues through Auth's signOut API in Node.
  return true;
end $$;

revoke all on function public.revoke_app_sessions(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_app_sessions(uuid,uuid,uuid) to service_role;

-- Close the same gap for previously revoked, identified devices.
delete from auth.sessions s using public.app_sessions a
  where a.auth_session_id=s.id and a.user_id=s.user_id and a.revoked_at is not null;

commit;
