begin;
-- A shared order conversation can contain another seller's delivery secrets.
-- Only conversations for orders fulfilled entirely by this seller are exposed.
create function public.seller_support(p_actor uuid,p_ticket uuid default null,p_body text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_ticket public.tickets%rowtype;
begin
  perform public.require_seller(p_actor);
  if p_body is not null then
    if char_length(btrim(p_body)) not between 3 and 3000 then raise exception 'Nội dung phải có 3–3000 ký tự'; end if;
    select * into target_ticket from public.tickets where id=p_ticket and deleted_at is null for update;
    if not found or target_ticket.order_id is null or not exists(select 1 from public.order_items where order_id=target_ticket.order_id and seller_id=p_actor)
      or exists(select 1 from public.order_items where order_id=target_ticket.order_id and seller_id is distinct from p_actor)
      then raise exception 'Không tìm thấy yêu cầu của gian hàng'; end if;
    if target_ticket.status='closed' then raise exception 'Yêu cầu đã đóng'; end if;
    insert into public.ticket_messages(ticket_id,author_id,role,body) values(target_ticket.id,p_actor,'seller',btrim(p_body));
    update public.tickets set updated_at=now() where id=target_ticket.id;
    insert into public.notifications(id,user_id,title,href)
      values('seller-reply:'||gen_random_uuid(),target_ticket.user_id,'Người bán đã phản hồi yêu cầu hỗ trợ','/support');
    return jsonb_build_object('ok',true);
  end if;
  return coalesce((select jsonb_agg(result order by result->>'updated_at' desc) from (
    select jsonb_build_object('id',t.id,'subject',t.subject,'message',t.message,'kind',t.kind,
      'status',t.status,'created_at',t.created_at,'updated_at',t.updated_at,'order_number',o.number,
      'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'role',m.role,'body',m.body,'created_at',m.created_at) order by m.created_at)
        from public.ticket_messages m where m.ticket_id=t.id),'[]'::jsonb)) result
    from public.tickets t join public.orders o on o.id=t.order_id
    where t.deleted_at is null and (p_ticket is null or t.id=p_ticket)
      and exists(select 1 from public.order_items where order_id=t.order_id and seller_id=p_actor)
      and not exists(select 1 from public.order_items where order_id=t.order_id and seller_id is distinct from p_actor)
  ) rows),'[]'::jsonb);
end $$;
revoke all on function public.seller_support(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.seller_support(uuid,uuid,text) to service_role;
commit;
