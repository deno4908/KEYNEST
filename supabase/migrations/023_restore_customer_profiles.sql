begin;
-- Auth accounts created before the profile trigger was installed must also
-- appear in the admin customer list. Never overwrite existing roles or money.
insert into public.profiles(id,email,name,avatar_url)
select u.id,u.email,coalesce(u.raw_user_meta_data->>'name',u.raw_user_meta_data->>'full_name',''),
 public.oauth_avatar(u.raw_user_meta_data)
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- Reattach the existing registration handler if the trigger was removed.
drop trigger if exists new_auth_user on auth.users;
create trigger new_auth_user after insert on auth.users
for each row execute function public.handle_user();
commit;
