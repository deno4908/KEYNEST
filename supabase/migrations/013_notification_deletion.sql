alter table public.notification_campaigns add column deleted_at timestamptz;
create function public.delete_store_campaign(p_id uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 -- Retain the campaign ID so retries cannot send a deleted campaign again.
 update notification_campaigns set deleted_at=now() where id=p_id and deleted_at is null;
 delete from notifications where id like 'campaign:'||p_id||':%';
 insert into audit_logs(user_id,action,target) values(p_actor,'delete_notification',p_id::text);
end $$;
revoke all on function public.delete_store_campaign(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_store_campaign(uuid,uuid) to service_role;
