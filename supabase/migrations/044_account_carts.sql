begin;
create table public.account_carts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  items jsonb not null default '[]' check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=20),
  updated_at timestamptz not null default now()
);
alter table public.account_carts enable row level security;
revoke all on public.account_carts from public,anon,authenticated;
grant select,insert,update,delete on public.account_carts to service_role;
commit;
