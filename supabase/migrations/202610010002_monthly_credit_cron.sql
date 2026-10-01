-- Run a database-local job every day at 00:05 Asia/Seoul (15:05 UTC).
-- The function only grants on the first day and uses an idempotent monthly key.
create extension if not exists pg_cron;

create or replace function public.run_monthly_credit_reset()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row record;
  processed integer := 0;
begin
  if extract(day from now() at time zone 'Asia/Seoul') <> 1 then
    return 0;
  end if;
  for profile_row in select id from public.profiles loop
    perform public.ensure_monthly_credits(profile_row.id);
    processed := processed + 1;
  end loop;
  return processed;
end;
$$;

revoke all on function public.run_monthly_credit_reset() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'coverletteride-monthly-credit-reset';
select cron.schedule(
  'coverletteride-monthly-credit-reset',
  '5 15 * * *',
  $$select public.run_monthly_credit_reset()$$
);
