-- Server-owned account controls, session revocation and customer notifications.
create table account_controls (
 user_id uuid primary key references profiles(id), suspended boolean not null default false,
 reason text not null default '', updated_at timestamptz not null default now()
);
create table app_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id),
 token_hash text not null unique, user_agent text not null default '',
 created_at timestamptz not null default now(), revoked_at timestamptz
);
create index on app_sessions(user_id,created_at desc);
create table notifications (
 id text primary key, user_id uuid not null references profiles(id),
 title text not null, href text not null, created_at timestamptz not null default now(), read_at timestamptz
);
create index on notifications(user_id,created_at desc);
alter table account_controls enable row level security;
alter table app_sessions enable row level security;
alter table notifications enable row level security;
revoke all on account_controls,app_sessions,notifications from public,anon,authenticated;
grant all on account_controls,app_sessions,notifications to service_role;

create function notify_store_event() returns trigger language plpgsql set search_path=public as $$
declare uid uuid;
begin
 if TG_TABLE_NAME='orders' then
  if TG_OP='UPDATE' then if new.status=old.status then return new; end if; end if;
  insert into notifications(id,user_id,title,href)
   values('order:'||new.id||':'||new.status,new.user_id,'Đơn '||new.number||': '||new.status,'/orders/'||new.id) on conflict do nothing;
 elsif TG_TABLE_NAME='ticket_messages' then
  if new.role='admin' then
   select user_id into uid from tickets where id=new.ticket_id;
   insert into notifications(id,user_id,title,href)
    values('reply:'||new.id,uid,'Có phản hồi mới cho yêu cầu hỗ trợ','/support') on conflict do nothing;
  end if;
 elsif TG_TABLE_NAME='payments' then
  if new.status='paid' and new.order_id is null and old.status is distinct from new.status then
   insert into notifications(id,user_id,title,href)
    values('topup:'||new.id,new.user_id,'Nạp ví thành công: '||new.amount||' VND','/wallet') on conflict do nothing;
  end if;
 end if;
 return new;
end $$;
create trigger order_notification after insert or update on orders for each row execute function notify_store_event();
create trigger ticket_notification after insert on ticket_messages for each row execute function notify_store_event();
create trigger topup_notification after update on payments for each row execute function notify_store_event();
revoke all on function notify_store_event() from public,anon,authenticated;

create function set_customer_access(p_actor uuid,p_user uuid,p_suspended boolean,p_reason text) returns void
language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 perform 1 from profiles where id=p_user and role='customer' for update;
 if not found then raise exception 'Chỉ thay đổi quyền truy cập của khách hàng'; end if;
 insert into account_controls(user_id,suspended,reason) values(p_user,p_suspended,p_reason)
 on conflict(user_id) do update set suspended=excluded.suspended,reason=excluded.reason,updated_at=now();
 if p_suspended then update app_sessions set revoked_at=now() where user_id=p_user and revoked_at is null; end if;
 insert into audit_logs(user_id,action,target) values(p_actor,'customer_access',p_user||':'||p_suspended||':'||p_reason);
end $$;
revoke all on function set_customer_access(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function set_customer_access(uuid,uuid,boolean,text) to service_role;

create function discard_inventory(p_actor uuid,p_id uuid,p_reason text) returns void
language plpgsql set search_path=public as $$
declare vid uuid; row_inventory inventory;
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 select variant_id into vid from inventory where id=p_id;
 if vid is null then raise exception 'Không tìm thấy mã kho'; end if;
 -- Same variant -> inventory lock order as checkout/import.
 perform 1 from variants where id=vid for update;
 select * into row_inventory from inventory where id=p_id for update;
 if not found or row_inventory.order_id is not null then raise exception 'Chỉ loại mã chưa được giữ cho đơn hàng'; end if;
 update variants set stock=stock-1 where id=vid and stock>0;
 if not found then raise exception 'Tồn kho không hợp lệ'; end if;
 delete from inventory where id=p_id;
 insert into audit_logs(user_id,action,target) values(p_actor,'inventory_discard',p_id||':'||p_reason);
end $$;
revoke all on function discard_inventory(uuid,uuid,text) from public,anon,authenticated;
grant execute on function discard_inventory(uuid,uuid,text) to service_role;
