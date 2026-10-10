alter table public.profiles add column avatar_source text not null default 'oauth'
 check (avatar_source in ('oauth','upload'));

-- A user-selected photo must survive subsequent social sign-ins.
create or replace function public.sync_oauth_avatar() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 update public.profiles set avatar_url=public.oauth_avatar(new.raw_user_meta_data)
 where id=new.id and avatar_source='oauth'
 and avatar_url is distinct from public.oauth_avatar(new.raw_user_meta_data);
 return new;
end $$;
