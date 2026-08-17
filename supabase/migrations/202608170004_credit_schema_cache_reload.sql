-- Credit schema repair follow-up.
--
-- 202608170001_cost_plus_fixed_profit_credits.sql replaces the reservation
-- functions and adds the private pricing tier.  PostgREST can keep its old
-- function catalogue after a SQL migration, which makes the gateway report a
-- misleading "credit balance could not be checked" error until the schema is
-- reloaded.  This migration is deliberately idempotent and is safe to run
-- after all preceding credit migrations.

do $$
begin
  if to_regprocedure('public.get_ai_pricing_tier(uuid)') is null then
    raise exception using
      errcode = '0A000',
      message = 'Credit pricing migration is incomplete; apply 202608170001_cost_plus_fixed_profit_credits.sql first.';
  end if;
  if to_regprocedure('public.reserve_ai_tool_credits(uuid,uuid,text,integer,integer,text,integer)') is null then
    raise exception using
      errcode = '0A000',
      message = 'Butler credit migration is incomplete; apply 202608170001_cost_plus_fixed_profit_credits.sql first.';
  end if;
end;
$$;

-- Refresh PostgREST's RPC schema cache immediately after the functions are
-- replaced.  Without this notification the next request can still receive a
-- stale 404 even though the functions exist in PostgreSQL.
notify pgrst, 'reload schema';
