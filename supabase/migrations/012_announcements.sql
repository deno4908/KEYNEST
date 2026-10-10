create table public.store_announcements (
 id uuid primary key, title text not null check(length(title) between 3 and 150),
 body text not null check(length(body) between 3 and 3000),
 active boolean not null default true, created_at timestamptz not null default now()
);
alter table public.store_announcements enable row level security;
revoke all on public.store_announcements from public,anon,authenticated;
grant all on public.store_announcements to service_role;
create index on public.store_announcements(active,created_at desc);
