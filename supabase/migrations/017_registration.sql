begin;
-- Separate the reserved registration name from editable/OAuth display names.
alter table public.profiles add column registration_name text;
create unique index profiles_registration_name_unique on public.profiles(registration_name);
-- Preserve existing accounts even if they already share a display name.
with names as (
 select id, lower(btrim(name)) as normalized,
 row_number() over(partition by lower(btrim(name)) order by id) as n
 from public.profiles where btrim(name)<>''
)
update public.profiles p set registration_name=n.normalized
from names n where p.id=n.id and n.n=1;

create or replace function public.handle_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,email,name,avatar_url,registration_name)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'name',''),
 public.oauth_avatar(new.raw_user_meta_data),
 nullif(lower(btrim(new.raw_user_meta_data->>'registration_name')),''));
 return new;
end $$;
revoke all on function public.handle_user() from public,anon,authenticated;

create function public.registration_conflicts(p_email text,p_name text) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'email',exists(select 1 from auth.users where lower(email)=lower(btrim(p_email))),
 'name',exists(select 1 from public.profiles where registration_name=lower(btrim(p_name))
 or lower(btrim(name))=lower(btrim(p_name))))
$$;
revoke all on function public.registration_conflicts(text,text) from public,anon,authenticated;
grant execute on function public.registration_conflicts(text,text) to service_role;
commit;
