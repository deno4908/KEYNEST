begin;
do $$ declare definition text; begin
 select pg_get_functiondef('public.seller_conversation(uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 if strpos(definition,'''item_id'',i.id')=0 then raise exception 'Conversation return marker missing'; end if;
 definition:=replace(definition,'''item_id'',i.id',
  '''can_message'',actor_role<>''admin'',''viewer_role'',case when actor_role=''admin'' then ''admin'' when p_actor=o.user_id then ''customer'' else ''seller'' end,''item_id'',i.id');
 definition:=replace(definition,'if actor_role=''admin'' or char_length(btrim(p_body)) not between 1 and 3000 or p_request is null then',
  'if actor_role=''admin'' then raise exception ''Quản trị viên chỉ được xem cuộc trò chuyện. Hãy phản hồi qua yêu cầu hỗ trợ''; end if; if p_body is null or char_length(btrim(p_body)) not between 1 and 3000 or p_request is null then');
 execute definition;
end $$;
commit;
