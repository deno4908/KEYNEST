-- Public product instructions; never store passwords or delivery keys here.
alter table public.products
  add column usage_notes text not null default ''
  check (length(usage_notes) <= 10000);
