begin;

-- Consume each newly created order line in the same transaction as checkout.
-- An idempotent retry reuses existing lines, so it cannot consume the cart twice.
create function public.consume_order_item_cart() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.account_carts c
 set items=coalesce((
  select jsonb_agg(
   case when entry.value->>'variant_id'=new.variant_id::text then
    jsonb_set(entry.value,'{quantity}',to_jsonb((entry.value->>'quantity')::integer-new.quantity))
   else entry.value end order by entry.ordinality
  )
  from jsonb_array_elements(c.items) with ordinality as entry(value,ordinality)
  where entry.value->>'variant_id' is distinct from new.variant_id::text
   or (entry.value->>'quantity')::integer>new.quantity
 ),'[]'::jsonb), updated_at=now()
 where c.user_id=(select o.user_id from public.orders o where o.id=new.order_id)
  and exists(select 1 from jsonb_array_elements(c.items) as entry(value)
   where entry.value->>'variant_id'=new.variant_id::text);
 return new;
end $$;

create trigger consume_order_item_cart after insert on public.order_items
 for each row execute function public.consume_order_item_cart();
revoke all on function public.consume_order_item_cart() from public,anon,authenticated,service_role;

commit;
