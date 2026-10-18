begin;
do $$
declare definition text; marker text;
begin
 select pg_get_functiondef('public.seller_conversation(uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 marker := 'if message_id is not null then';
 if strpos(definition,marker)=0 then raise exception 'Chat message insert marker not found'; end if;
 -- Only a newly accepted reply acknowledges incoming messages in this conversation.
 -- Retrying an old request must not clear notifications for newer messages.
 definition := replace(definition,marker,marker || '
   update public.notifications n set read_at=now()
   where n.user_id=p_actor and n.read_at is null and exists (
    select 1 from public.seller_chat_messages m
    where m.item_id=p_item and m.author_id<>p_actor and n.id=''seller-chat:''||m.id
   );');
 execute definition;
end $$;
commit;
