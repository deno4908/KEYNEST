alter table public.payment_events add column credited_user_id uuid references public.profiles(id);
alter table public.payment_events add column credited_at timestamptz;
alter table public.payment_events add column reason text;
create function public.credit_reviewed_payment(p_transaction text,p_user uuid,p_reason text,p_admin uuid) returns void language plpgsql set search_path=public as $$ declare e payment_events; begin
 if not exists(select 1 from profiles where id=p_admin and role='admin') then raise exception 'Không có quyền quản trị'; end if;
 if length(trim(p_reason))<10 then raise exception 'Cần lý do đối soát'; end if;
 perform 1 from profiles where id=p_user for update; if not found then raise exception 'Không tìm thấy khách hàng'; end if;
 select * into e from payment_events where transaction_id=p_transaction for update;
 if not found or e.outcome<>'needs_review' then raise exception 'Giao dịch không chờ đối soát hoặc đã xử lý'; end if;
 update profiles set balance=balance+e.amount where id=p_user;
 insert into wallet_ledger(user_id,amount,description) values(p_user,e.amount,'Đối soát giao dịch '||p_transaction);
 update payment_events set outcome='credited',credited_user_id=p_user,credited_at=now(),reason=p_reason where transaction_id=p_transaction;
 insert into audit_logs(user_id,action,target) values(p_admin,'credit_reviewed_payment',p_transaction);
end $$;
revoke all on function public.credit_reviewed_payment(text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.credit_reviewed_payment(text,uuid,text,uuid) to service_role;
