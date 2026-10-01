-- Production service hardening. This migration intentionally follows the
-- already-applied initial schema and must not be merged into it.

create type public.credit_grant_kind as enum ('monthly', 'earned');
create type public.file_state as enum ('quarantined', 'ready', 'rejected', 'deleted');

alter table public.evidence_files
  add column if not exists file_state public.file_state not null default 'quarantined',
  add column if not exists detected_mime_type text,
  add column if not exists processed_at timestamptz;

alter table public.contributions
  add column if not exists content_hash text,
  add column if not exists moderation_reason text;

alter table public.contribution_questions
  add column if not exists anonymized_answer text;

create unique index if not exists contributions_content_hash_idx
  on public.contributions (content_hash)
  where content_hash is not null;

create table public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.credit_grant_kind not null,
  original_amount integer not null check (original_amount > 0),
  remaining_amount integer not null check (remaining_amount >= 0),
  reference_id text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, kind, reference_id)
);

create table public.credit_spends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  grant_id uuid not null references public.credit_grants(id) on delete restrict,
  transaction_id uuid not null references public.credit_transactions(id) on delete cascade,
  amount integer not null check (amount > 0),
  request_id text not null,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (grant_id, transaction_id)
);

create table public.document_jobs (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null unique references public.evidence_files(id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index credit_grants_available_idx on public.credit_grants (user_id, kind, expires_at, created_at)
  where remaining_amount > 0;
create index credit_spends_request_idx on public.credit_spends (user_id, request_id);

alter table public.credit_grants enable row level security;
alter table public.credit_spends enable row level security;
alter table public.document_jobs enable row level security;

create policy "credit grants are readable by owner" on public.credit_grants
  for select using ((select auth.uid()) = user_id);
create policy "credit spends are readable by owner" on public.credit_spends
  for select using ((select auth.uid()) = user_id);
-- document jobs are service-only; no client policy is deliberately created.

create or replace function public.kst_month_key(p_now timestamptz default now())
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_now at time zone 'Asia/Seoul', 'YYYY-MM');
$$;

create or replace function public.kst_next_month_start(p_now timestamptz default now())
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (date_trunc('month', p_now at time zone 'Asia/Seoul') + interval '1 month') at time zone 'Asia/Seoul';
$$;

create or replace function public.ensure_monthly_credits(p_user_id uuid default auth.uid())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_id uuid;
  month_key text := public.kst_month_key();
  balance integer;
begin
  if p_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Cannot grant credits for another user';
  end if;

  -- Monthly credit is a use-it-this-month bucket. Earned grants have no expiry.
  update public.credit_grants
  set remaining_amount = 0
  where user_id = p_user_id
    and kind = 'monthly'
    and expires_at <= now()
    and remaining_amount > 0;

  insert into public.credit_grants (user_id, kind, original_amount, remaining_amount, reference_id, expires_at)
  values (p_user_id, 'monthly', 1000, 1000, month_key, public.kst_next_month_start())
  on conflict (user_id, kind, reference_id) do nothing
  returning id into grant_id;

  if grant_id is not null then
    insert into public.credit_transactions (user_id, amount, reason, reference_id)
    values (p_user_id, 1000, 'monthly_grant', month_key)
    on conflict (user_id, reason, reference_id) do nothing;
  end if;

  select total into balance from public.credit_balance_detail(p_user_id);
  return balance;
end;
$$;

create or replace function public.credit_balance_detail(p_user_id uuid default auth.uid())
returns table (monthly integer, earned integer, total integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user_id is null then raise exception 'Authentication is required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Cannot read another user credit balance'; end if;
  return query select
    coalesce(sum(remaining_amount) filter (where kind = 'monthly' and (expires_at is null or expires_at > now())), 0)::integer as monthly,
    coalesce(sum(remaining_amount) filter (where kind = 'earned'), 0)::integer as earned,
    coalesce(sum(remaining_amount) filter (where kind = 'monthly' and (expires_at is null or expires_at > now())), 0)::integer
      + coalesce(sum(remaining_amount) filter (where kind = 'earned'), 0)::integer as total
  from public.credit_grants
  where user_id = p_user_id;
end;
$$;

create or replace function public.reserve_credits(p_amount integer, p_reason text, p_request_id text)
returns table (monthly integer, earned integer, total integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  remaining_to_spend integer := p_amount;
  allocation integer;
  grant_row public.credit_grants%rowtype;
  tx_id uuid;
  result record;
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  if p_amount <= 0 or coalesce(trim(p_reason), '') = '' or coalesce(trim(p_request_id), '') = '' then
    raise exception 'Invalid credit reservation';
  end if;

  perform public.ensure_monthly_credits(current_user_id);

  -- A retried request is idempotent and does not deduct a second time.
  if exists (
    select 1 from public.credit_transactions
    where user_id = current_user_id and reason = p_reason and reference_id = p_request_id
  ) then
    select * into result from public.credit_balance_detail(current_user_id);
    return query select result.monthly, result.earned, result.total;
    return;
  end if;

  for grant_row in
    select * from public.credit_grants
    where user_id = current_user_id
      and remaining_amount > 0
      and (kind = 'earned' or expires_at > now())
    order by case kind when 'monthly' then 0 else 1 end, created_at
    for update
  loop
    exit when remaining_to_spend = 0;
    allocation := least(grant_row.remaining_amount, remaining_to_spend);
    remaining_to_spend := remaining_to_spend - allocation;
  end loop;

  if remaining_to_spend > 0 then
    raise exception 'Insufficient credits';
  end if;

  insert into public.credit_transactions (user_id, amount, reason, reference_id)
  values (current_user_id, -p_amount, p_reason, p_request_id)
  returning id into tx_id;

  remaining_to_spend := p_amount;
  for grant_row in
    select * from public.credit_grants
    where user_id = current_user_id
      and remaining_amount > 0
      and (kind = 'earned' or expires_at > now())
    order by case kind when 'monthly' then 0 else 1 end, created_at
    for update
  loop
    exit when remaining_to_spend = 0;
    allocation := least(grant_row.remaining_amount, remaining_to_spend);
    update public.credit_grants set remaining_amount = remaining_amount - allocation where id = grant_row.id;
    insert into public.credit_spends (user_id, grant_id, transaction_id, amount, request_id)
    values (current_user_id, grant_row.id, tx_id, allocation, p_request_id);
    remaining_to_spend := remaining_to_spend - allocation;
  end loop;

  select * into result from public.credit_balance_detail(current_user_id);
  return query select result.monthly, result.earned, result.total;
end;
$$;

create or replace function public.refund_credit_reservation(p_reason text, p_request_id text)
returns table (monthly integer, earned integer, total integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  debit_tx uuid;
  spend_row record;
  result record;
begin
  if current_user_id is null then raise exception 'Authentication is required'; end if;
  select id into debit_tx from public.credit_transactions
  where user_id = current_user_id and reason = p_reason and reference_id = p_request_id;
  if debit_tx is null then raise exception 'Credit reservation not found'; end if;

  if not exists (
    select 1 from public.credit_transactions
    where user_id = current_user_id and reason = p_reason || ':refund' and reference_id = p_request_id
  ) then
    for spend_row in select * from public.credit_spends where transaction_id = debit_tx and refunded_at is null for update loop
      update public.credit_grants set remaining_amount = remaining_amount + spend_row.amount where id = spend_row.grant_id;
      update public.credit_spends set refunded_at = now() where id = spend_row.id;
    end loop;
    insert into public.credit_transactions (user_id, amount, reason, reference_id)
    values (
      current_user_id,
      - (select amount from public.credit_transactions where id = debit_tx),
      p_reason || ':refund',
      p_request_id
    );
  end if;

  select * into result from public.credit_balance_detail(current_user_id);
  return query select result.monthly, result.earned, result.total;
end;
$$;

create or replace function public.reward_accepted_contribution(p_contribution_id uuid)
returns table (monthly integer, earned integer, total integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  contribution_row public.contributions%rowtype;
  grant_id uuid;
  result record;
begin
  select * into contribution_row from public.contributions where id = p_contribution_id for update;
  if contribution_row.id is null or contribution_row.quality_status <> 'accepted' then
    raise exception 'Contribution is not eligible for reward';
  end if;

  insert into public.credit_grants (user_id, kind, original_amount, remaining_amount, reference_id)
  values (contribution_row.user_id, 'earned', 500, 500, 'contribution:' || p_contribution_id::text)
  on conflict (user_id, kind, reference_id) do nothing
  returning id into grant_id;

  if grant_id is not null then
    insert into public.credit_transactions (user_id, amount, reason, reference_id)
    values (contribution_row.user_id, 500, 'contribution_reward', p_contribution_id::text)
    on conflict (user_id, reason, reference_id) do nothing;
  end if;

  select * into result from public.credit_balance_detail(contribution_row.user_id);
  return query select result.monthly, result.earned, result.total;
end;
$$;

-- Replace the initial trigger body so first OAuth login creates both profile and
-- the current month's base grant. Existing users are repaired by the monthly job.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.email, '')
  ) on conflict (id) do nothing;
  perform public.ensure_monthly_credits(new.id);
  return new;
end;
$$;

create or replace function public.bump_essay_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists essays_bump_version on public.essays;
create trigger essays_bump_version before update on public.essays
  for each row execute procedure public.bump_essay_version();

revoke all on function public.ensure_monthly_credits(uuid) from public, anon;
grant execute on function public.ensure_monthly_credits(uuid) to authenticated;
revoke all on function public.credit_balance_detail(uuid) from public, anon;
grant execute on function public.credit_balance_detail(uuid) to authenticated;
revoke all on function public.reserve_credits(integer, text, text) from public, anon;
grant execute on function public.reserve_credits(integer, text, text) to authenticated;
revoke all on function public.refund_credit_reservation(text, text) from public, anon;
grant execute on function public.refund_credit_reservation(text, text) to authenticated;
revoke all on function public.reward_accepted_contribution(uuid) from public, anon, authenticated;
