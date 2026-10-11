-- Retain support/warranty history while removing deleted requests from the inbox.
alter table public.tickets add column deleted_at timestamptz;
