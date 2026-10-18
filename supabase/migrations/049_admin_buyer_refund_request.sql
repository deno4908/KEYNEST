begin;
-- An administrator purchasing from a seller has the same request rights as a buyer.
-- Observer administrators cannot open a dispute for someone else's order.
do $$
declare definition text; marker text;
begin
 select pg_get_functiondef('public.seller_conversation(uuid,uuid,text,text,uuid)'::regprocedure) into definition;
 marker := 'if actor_role=''admin'' or char_length(btrim(p_body)) not between 10 and 2000 or o.status';
 if strpos(definition,marker)=0 then raise exception 'Refund request guard not found'; end if;
 definition := replace(definition,marker,
  'if (actor_role=''admin'' and p_actor<>o.user_id) or p_body is null or char_length(btrim(p_body)) not between 10 and 2000 or o.status');
 execute definition;
end $$;
commit;
