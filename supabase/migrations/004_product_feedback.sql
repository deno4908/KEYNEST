-- Public discussion is separate from purchase-verified ratings.
create table public.product_comments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  name text not null,
  body text not null check (char_length(btrim(body)) between 3 and 1000),
  created_at timestamptz not null default now()
);
create index product_comments_product_created on public.product_comments(product_id, created_at desc, id desc);
create index reviews_product_created on public.reviews(product_id, created_at desc, id desc);
alter table public.product_comments enable row level security;
revoke all on public.product_comments from anon, authenticated;
grant select on public.product_comments to anon, authenticated;
grant all on public.product_comments to service_role;
create policy comments_public on public.product_comments for select
  using (exists(select 1 from public.products p where p.id = product_id and p.active));

-- Backend-only aggregate: customer mutations never supply rating totals.
create view public.product_review_stats as
select product_id, count(*)::integer as review_count,
  round(avg(rating)::numeric, 1) as rating_average,
  jsonb_build_array(
    count(*) filter(where rating=1), count(*) filter(where rating=2),
    count(*) filter(where rating=3), count(*) filter(where rating=4),
    count(*) filter(where rating=5)
  ) as rating_counts
from public.reviews group by product_id;
revoke all on public.product_review_stats from public, anon, authenticated;
grant select on public.product_review_stats to service_role;
