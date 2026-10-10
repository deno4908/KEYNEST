alter table public.profiles add column avatar_url text;

-- Provider metadata is user-controlled: accept only HTTPS image CDN URLs.
create function public.oauth_avatar(metadata jsonb) returns text
language sql immutable set search_path=public as $$
 select value from (values (1,metadata->>'avatar_url'),(2,metadata->>'picture')) as candidates(priority,value)
 where length(value) <= 2048
 and value ~ '^https://([a-zA-Z0-9-]+[.]googleusercontent[.]com|cdn[.]discordapp[.]com|media[.]discordapp[.]net)/[^[:space:]]+$'
 order by priority limit 1
$$;
revoke all on function public.oauth_avatar(jsonb) from public,anon,authenticated;
grant execute on function public.oauth_avatar(jsonb) to service_role;

create or replace function public.handle_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,email,name,avatar_url)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'name',''),public.oauth_avatar(new.raw_user_meta_data));
 return new;
end $$;

create function public.sync_oauth_avatar() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 update public.profiles set avatar_url=public.oauth_avatar(new.raw_user_meta_data)
 where id=new.id and avatar_url is distinct from public.oauth_avatar(new.raw_user_meta_data);
 return new;
end $$;
revoke all on function public.sync_oauth_avatar() from public,anon,authenticated;
create trigger sync_user_avatar after update of raw_user_meta_data on auth.users
for each row execute function public.sync_oauth_avatar();

-- Existing OAuth accounts also receive their current provider image.
update public.profiles p set avatar_url=public.oauth_avatar(u.raw_user_meta_data)
from auth.users u where u.id=p.id;
