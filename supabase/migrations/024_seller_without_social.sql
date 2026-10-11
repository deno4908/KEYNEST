begin;
-- Keep existing installations compatible: social contacts are no longer required.
update profiles set seller_social_links='[]'::jsonb where seller_social_links<>'[]'::jsonb;
create or replace function require_seller(p_user uuid) returns void language plpgsql set search_path=public as $$ begin
 perform 1 from profiles where id=p_user and role='seller' and seller_terms_version='2026-10-11-v1' for update;
 if not found then raise exception 'Cần hoàn tất hồ sơ và điều khoản người bán'; end if;
 if exists(select 1 from account_controls where user_id=p_user and suspended) then raise exception 'Người bán đang bị khóa'; end if;
end $$;
do $$ declare definition text; begin
 select pg_get_functiondef('seller_command(uuid,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,' or jsonb_array_length(p_data->''social_links'') not between 1 and 5','');
 definition:=replace(definition,'seller_social_links=p_data->''social_links''','seller_social_links=''[]''::jsonb');
 if position('jsonb_array_length(p_data->''social_links'')' in definition)>0
    or position('seller_social_links=p_data->''social_links''' in definition)>0 then
  raise exception 'Could not remove seller social link requirements from seller_command';
 end if;
 execute definition;
end $$;
commit;
