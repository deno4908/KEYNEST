begin;
create table public.categories (
 id text primary key check(id ~ '^[a-z][a-z0-9-]{0,39}$' and id not in ('all','constructor','prototype')),
 name text not null check(length(btrim(name)) between 2 and 60),
 sort_order integer not null default 0 check(sort_order between 0 and 9999)
);
insert into public.categories(id,name,sort_order) values
 ('game','Game key',0),('gift','Gift card',1),('topup','Nạp game',2),('mmo','MMO & Proxy',3);
alter table public.categories enable row level security;
revoke all on public.categories from public,anon,authenticated;
grant select on public.categories to anon,authenticated;
grant all on public.categories to service_role;
create policy categories_public on public.categories for select to anon,authenticated using(true);
alter table public.products drop constraint products_category_check;
alter table public.products add constraint products_category_fkey foreign key(category) references public.categories(id);
alter table public.coupons drop constraint coupons_category_check;
alter table public.coupons add constraint coupons_category_check check(category ~ '^[a-z][a-z0-9-]{0,39}$');

create or replace function public.catalog_search(p_filters jsonb) returns jsonb
language plpgsql stable set search_path=public as $$
declare
  per_page integer := coalesce((p_filters->>'page_size')::integer,12);
  requested_page integer := coalesce((p_filters->>'page')::integer,1);
  category_filter text := coalesce(p_filters->>'category','all');
  sort_mode text := coalesce(p_filters->>'sort','featured');
  result jsonb;
begin
  if per_page not between 1 and 48 or requested_page not between 1 and 10000
    or category_filter !~ '^[a-z][a-z0-9-]{0,39}$'
    or sort_mode not in ('featured','asc','desc','name') then
    raise exception 'Bộ lọc không hợp lệ';
  end if;
  with active as materialized (
    select p.*, coalesce(nullif(p.subcategory,''),nullif(p.platform,''),'Khác') as group_name
    from products p where p.active
  ), scoped as materialized (
    select * from active where category_filter='all' or category=category_filter
  ), filtered as (
    select p.*, (select min(v.price) from variants v where v.product_id=p.id) as min_price
    from scoped p
    where position(catalog_normalize(coalesce(p_filters->>'q','')) in
      catalog_normalize(p.name || ' ' || p.platform || ' ' || p.description || ' ' || p.group_name))>0
      and (coalesce(p_filters->>'sub','')='' or p.group_name=p_filters->>'sub')
      and (coalesce(p_filters->>'platform','')='' or p.platform=p_filters->>'platform')
      and exists(select 1 from variants v where v.product_id=p.id
        and v.price >= coalesce((p_filters->>'min')::bigint,0)
        and v.price <= coalesce((p_filters->>'max')::bigint,100000000)
        and (coalesce(p_filters->>'stock','0')<>'1' or v.stock>0)
        and (coalesce(p_filters->>'sale','0')<>'1' or v.original_price>v.price)
        and (coalesce(p_filters->>'delivery','')='' or v.delivery=p_filters->>'delivery')
        and (coalesce(p_filters->>'region','')='' or v.region=p_filters->>'region'))
  ), ranked as materialized (
    select *,row_number() over(order by
      case when sort_mode='asc' then min_price end asc,
      case when sort_mode='desc' then min_price end desc,
      case when sort_mode='name' then name end asc,
      case when sort_mode='featured' then featured end desc,
      case when sort_mode='featured' then sort_order end asc,id asc) as rank
    from filtered
  ), totals as (
    select count(*)::integer as total, greatest(1,ceil(count(*)::numeric/per_page)::integer) as pages from ranked
  ), pagination as (
    select *,least(requested_page,pages) as page from totals
  ), selected as (
    select r.* from ranked r cross join pagination pg
    where r.rank > (pg.page-1)*per_page and r.rank <= pg.page*per_page
  ), items as (
    select (to_jsonb(p)-'group_name'-'min_price'-'rank') || jsonb_build_object(
      'variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.price,v.id) from variants v where v.product_id=p.id),'[]'::jsonb),
      'review_count',coalesce(s.review_count,0),
      'rating_average',coalesce(s.rating_average,0),
      'rating_counts',coalesce(s.rating_counts,'[0,0,0,0,0]'::jsonb)) as item,p.rank
    from selected p left join product_review_stats s on s.product_id=p.id
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(item order by rank) from items),'[]'::jsonb),
    'total',pg.total,'page',pg.page,'page_size',per_page,'pages',pg.pages,
    'facets',jsonb_build_object(
      'groups',coalesce((select jsonb_agg(g order by g) from (select distinct group_name g from scoped) x),'[]'::jsonb),
      'platforms',coalesce((select jsonb_agg(g order by g) from (select distinct platform g from scoped) x),'[]'::jsonb),
      'regions',coalesce((select jsonb_agg(g order by g) from (select distinct v.region g from variants v join scoped s on s.id=v.product_id) x),'[]'::jsonb),
      'categories',(select jsonb_object_agg(c,(select count(*) from active where c='all' or category=c))
        from (select 'all' as c union all select id from public.categories) category_rows))) into result from pagination pg;
  return result;
end $$;
revoke all on function public.catalog_normalize(text),public.catalog_search(jsonb) from public,anon,authenticated;
grant execute on function public.catalog_normalize(text),public.catalog_search(jsonb) to service_role;
commit;
