alter table public.notifications add column body text not null default '';
create table public.notification_campaigns (
 id uuid primary key, actor uuid not null references public.profiles(id),
 title text not null, body text not null, email text, recipients integer not null default 0,
 created_at timestamptz not null default now()
);
alter table public.notification_campaigns enable row level security;
revoke all on public.notification_campaigns from public,anon,authenticated;
grant all on public.notification_campaigns to service_role;

create function public.send_store_notification(p_id uuid,p_actor uuid,p_title text,p_body text,p_email text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer; existing notification_campaigns;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 if length(trim(p_title)) not between 3 and 150 or length(trim(p_body)) not between 3 and 3000 then raise exception 'Nội dung không hợp lệ'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into existing from notification_campaigns where id=p_id;
 if found then
  if existing.actor<>p_actor or existing.title<>p_title or existing.body<>p_body or existing.email is distinct from p_email then raise exception 'Mã gửi đã được sử dụng'; end if;
  return existing.recipients;
 end if;
 insert into notification_campaigns(id,actor,title,body,email) values(p_id,p_actor,p_title,p_body,p_email);
 insert into notifications(id,user_id,title,body,href)
 select 'campaign:'||p_id||':'||id,id,p_title,p_body,'/account'
 from profiles where (p_email is null and role='customer') or (p_email is not null and lower(email)=lower(p_email));
 get diagnostics n=row_count;
 if p_email is not null and n=0 then raise exception 'Không tìm thấy tài khoản'; end if;
 update notification_campaigns set recipients=n where id=p_id;
 insert into audit_logs(user_id,action,target) values(p_actor,'send_notification',p_id::text);
 return n;
end $$;
revoke all on function public.send_store_notification(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.send_store_notification(uuid,uuid,text,text,text) to service_role;

create function public.notify_ticket_completed() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='closed' and old.status is distinct from new.status then
  insert into notifications(id,user_id,title,body,href)
  values(gen_random_uuid()::text,new.user_id,
   case when new.kind='warranty' then 'Yêu cầu bảo hành đã được xử lý' else 'Yêu cầu hỗ trợ đã được xử lý' end,
   new.subject||' — Mở yêu cầu để xem kết quả và phản hồi.', '/support');
 end if;
 return new;
end $$;
create trigger ticket_completed_notification after update of status on public.tickets for each row execute function public.notify_ticket_completed();
revoke all on function public.notify_ticket_completed() from public,anon,authenticated;
