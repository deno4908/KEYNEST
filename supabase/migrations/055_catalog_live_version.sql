begin;

-- Return a small fingerprint instead of streaming unchanged descriptions and
-- variants back to the VPS every few seconds. No writes or global lock row.
-- Hash only the tables/columns used by the public catalog, never inventory keys.
create function public.catalog_live_version() returns text
language sql stable security definer set search_path='' as $$
 with visible as materialized (select * from public.products where active),
 parts as (
  select 'p' as kind,p.id::text as id,md5(to_jsonb(p)::text) as hash from visible p
  union all
  select 'v',v.id::text,md5(to_jsonb(v)::text) from public.variants v
   join visible p on p.id=v.product_id where v.active
  union all
  select 'r',s.product_id::text,md5(to_jsonb(s)::text) from public.product_review_stats s
   join visible p on p.id=s.product_id
  union all
  select 's',s.id::text,md5(jsonb_build_array(s.id,s.name,s.seller_name)::text)
   from public.profiles s where exists(select 1 from visible p where p.seller_id=s.id)
 )
 select md5(coalesce(string_agg(kind||id||hash,'' order by kind,id),'')) from parts
$$;
revoke all on function public.catalog_live_version() from public,anon,authenticated;
grant execute on function public.catalog_live_version() to service_role;

commit;
