begin;
do $$ declare definition text; begin
 select pg_get_functiondef('public.seller_conversation(uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 if strpos(definition,'''can_message'',actor_role<>''admin''')=0 then raise exception 'Apply migration 047 before 048'; end if;
 definition:=replace(definition,
  'if actor_role=''admin'' then raise exception ''Quản trị viên chỉ được xem cuộc trò chuyện. Hãy phản hồi qua yêu cầu hỗ trợ'';',
  'if actor_role=''admin'' and p_actor<>o.user_id then raise exception ''Quản trị viên chỉ được xem cuộc trò chuyện. Hãy phản hồi qua yêu cầu hỗ trợ'';');
 definition:=replace(definition,'''can_message'',actor_role<>''admin''',
  '''can_message'',(p_actor=o.user_id or (p_actor=i.seller_id and actor_role<>''admin''))');
 definition:=replace(definition,
  'case when actor_role=''admin'' then ''admin'' when p_actor=o.user_id then ''customer'' else ''seller'' end',
  'case when p_actor=o.user_id then ''customer'' when actor_role=''admin'' then ''admin'' else ''seller'' end');
 execute definition;
end $$;
commit;
