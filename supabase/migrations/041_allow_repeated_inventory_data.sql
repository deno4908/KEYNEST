begin;
-- Each inventory row is one sellable unit, even when its contents match
-- another row. Allocation and warranty tracking continue to use inventory.id.
alter table public.inventory drop constraint inventory_variant_id_secret_hash_key;
commit;
