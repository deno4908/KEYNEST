begin;

create table public.seller_name_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 current_name text not null,
 requested_name text not null check(char_length(requested_name) between 2 and 80 and requested_name=btrim(requested_name)),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reason text not null default '' check(char_length(reason)<=1000),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 resolved_by uuid references public.profiles(id),
 check((status='pending' and resolved_at is null and resolved_by is null)
    or (status<>'pending' and resolved_at is not null and resolved_by is not null)),
 check(status<>'rejected' or char_length(btrim(reason))>=3)
);
create unique index seller_name_one_pending on public.seller_name_requests(user_id) where status='pending';
create index seller_name_history on public.seller_name_requests(user_id,created_at desc,id);
alter table public.seller_name_requests enable row level security;
revoke all on public.seller_name_requests from public,anon,authenticated;
grant all on public.seller_name_requests to service_role;

-- Name changes from onboarding, profile updates or older API versions must also
-- pass approval. Only the matching, resolved request authorizes this transition.
create function public.guard_seller_name_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.seller_name is not distinct from old.seller_name or coalesce(old.seller_name,'')='' then return new; end if;
 if not exists(select 1 from public.seller_name_requests r join public.profiles a on a.id=r.resolved_by
   where r.id::text=current_setting('keynest.seller_name_request',true) and r.user_id=old.id
   and r.status='approved' and r.current_name=old.seller_name and r.requested_name=new.seller_name and a.role='admin'
   and not exists(select 1 from public.account_controls c where c.user_id=a.id and c.suspended)) then
  raise exception 'Đổi tên gian hàng cần được admin duyệt';
 end if;
 return new;
end $$;
create trigger seller_name_approval_guard before update of seller_name on public.profiles
 for each row execute function public.guard_seller_name_change();

create function public.request_seller_name(p_actor uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.profiles; r public.seller_name_requests;
begin
 perform public.require_seller(p_actor);
 select * into u from public.profiles where id=p_actor for update;
 if exists(select 1 from public.account_controls c where c.user_id=p_actor and c.suspended) then raise exception 'Tài khoản đang bị khóa'; end if;
 if p_name is null or char_length(btrim(p_name)) not between 2 and 80 then raise exception 'Tên gian hàng cần từ 2 đến 80 ký tự'; end if;
 p_name:=btrim(p_name);
 select * into r from public.seller_name_requests where user_id=p_actor and status='pending';
 if found then
  if r.requested_name=p_name then return to_jsonb(r); end if;
  raise exception 'Bạn đã có yêu cầu đổi tên đang chờ duyệt';
 end if;
 if p_name=coalesce(nullif(u.seller_name,''),u.name) then raise exception 'Tên mới trùng với tên đang hiển thị'; end if;
 insert into public.seller_name_requests(user_id,current_name,requested_name)
 values(p_actor,coalesce(nullif(u.seller_name,''),u.name),p_name) returning * into r;
 perform public.notify_active_admins('seller-name:'||r.id,'Yêu cầu đổi tên gian hàng',
   r.current_name||' → '||r.requested_name,'/admin?tab=sellers',r.created_at);
 insert into public.audit_logs(user_id,action,target) values(p_actor,'seller_name_requested',r.id::text);
 return to_jsonb(r);
end $$;

create function public.review_seller_name(p_actor uuid,p_request uuid,p_status text,p_reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.seller_name_requests; u public.profiles; target uuid;
begin
 perform 1 from public.profiles where id=p_actor and role='admin' for update;
 if not found or exists(select 1 from public.account_controls c where c.user_id=p_actor and c.suspended) then raise exception 'Cần quyền quản trị'; end if;
 if p_status is null or p_status not in('approved','rejected') or p_reason is null or char_length(p_reason)>1000
   or (p_status='rejected' and char_length(btrim(p_reason))<3) then raise exception 'Kết quả hoặc lý do xét duyệt không hợp lệ'; end if;
 select user_id into target from public.seller_name_requests where id=p_request;
 -- Same lock order as submission: seller profile before request.
 select * into u from public.profiles where id=target for update;
 select * into r from public.seller_name_requests where id=p_request for update;
 if not found or r.status<>'pending' then raise exception 'Yêu cầu đã được xử lý hoặc không tồn tại'; end if;
 if p_status='approved' then
  perform public.require_seller(target);
  if exists(select 1 from public.account_controls c where c.user_id=target and c.suspended) then raise exception 'Tài khoản người bán đang bị khóa'; end if;
  if coalesce(nullif(u.seller_name,''),u.name)<>r.current_name then raise exception 'Tên hiện tại đã thay đổi. Không thể duyệt yêu cầu cũ'; end if;
 end if;
 update public.seller_name_requests set status=p_status,reason=btrim(p_reason),resolved_at=now(),resolved_by=p_actor where id=p_request returning * into r;
 if p_status='approved' then
  perform set_config('keynest.seller_name_request',r.id::text,true);
  update public.profiles set seller_name=r.requested_name where id=target;
  perform set_config('keynest.seller_name_request','',true);
 end if;
 insert into public.notifications(id,user_id,title,body,href) values('seller-name:'||r.id,target,
   case when p_status='approved' then 'Tên gian hàng đã được duyệt' else 'Yêu cầu đổi tên chưa được duyệt' end,
   case when p_status='approved' then 'Tên mới: '||r.requested_name else r.reason end,'/seller?tab=profile');
 insert into public.audit_logs(user_id,action,target) values(p_actor,'seller_name_'||p_status,r.id::text);
 return to_jsonb(r);
end $$;
revoke all on function public.guard_seller_name_change(),public.request_seller_name(uuid,text),public.review_seller_name(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.request_seller_name(uuid,text),public.review_seller_name(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
