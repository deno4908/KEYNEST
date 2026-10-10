-- Browser roles may read only where earlier grants and RLS allow it.
-- All application writes and business RPCs must pass through the Node API.
revoke create on schema public from public, anon, authenticated;

do $$ declare r record; begin
 for r in
  select c.oid, c.relname, c.relkind from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','S')
  and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
 loop
  if r.relkind='S' then
   execute format('revoke all on sequence public.%I from public,anon,authenticated',r.relname);
  else
   execute format('revoke insert,update,delete,truncate,references,trigger on table public.%I from public,anon,authenticated',r.relname);
   -- Table-level REVOKE does not remove explicit column grants.
   execute (select format('revoke insert (%s),update (%s),references (%s) on public.%I from public,anon,authenticated',
    string_agg(quote_ident(attname),','),string_agg(quote_ident(attname),','),string_agg(quote_ident(attname),','),r.relname)
    from pg_attribute where attrelid=r.oid and attnum>0 and not attisdropped);
   if r.relkind in ('r','p') then
    execute format('alter table public.%I enable row level security',r.relname);
   end if;
  end if;
 end loop;
 for r in
  select p.oid::regprocedure as signature from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 loop
  execute format('revoke execute on function %s from public,anon,authenticated',r.signature);
 end loop;
end $$;

-- Defaults apply to objects created by the role running this migration.
-- New migrations must still explicitly grant access and enable RLS.
alter default privileges revoke execute on functions from public,anon,authenticated;
alter default privileges revoke all on tables from public,anon,authenticated;
alter default privileges revoke all on sequences from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke all on tables from public,anon,authenticated;
alter default privileges in schema public revoke all on sequences from public,anon,authenticated;
