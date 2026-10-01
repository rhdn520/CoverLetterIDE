-- CoverLetterIDE initial schema
-- Apply with: supabase db push

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create type public.application_status as enum ('pending', 'passed', 'failed');
create type public.extraction_status as enum ('pending', 'processing', 'done', 'unsupported', 'failed');
create type public.chat_role as enum ('user', 'assistant');
create type public.suggestion_status as enum ('pending', 'accepted', 'rejected', 'partial');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  school text not null default '',
  major text not null default '',
  graduation text not null default '',
  experiences text not null default '',
  awards text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  company text not null check (char_length(company) between 1 and 200),
  role text not null check (char_length(role) between 1 and 200),
  deadline date,
  status public.application_status not null default 'pending',
  result_rewarded boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  original_name text not null check (char_length(original_name) between 1 and 255),
  storage_path text not null unique,
  byte_size bigint not null check (byte_size >= 0 and byte_size <= 26214400),
  mime_type text not null,
  sha256 text,
  extracted_text text,
  extraction_status public.extraction_status not null default 'pending',
  extraction_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path like user_id::text || '/%')
);

create table public.project_files (
  project_id uuid not null references public.projects(id) on delete cascade,
  file_id uuid not null references public.evidence_files(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, file_id)
);

create table public.essays (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default '문항' check (char_length(title) between 1 and 200),
  question text not null default '',
  answer text not null default '',
  position integer not null default 0 check (position >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, position)
);

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '새 대화' check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role public.chat_role not null,
  content text not null,
  reasoning jsonb not null default '[]'::jsonb,
  reference_items jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.analysis_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cache_key text not null,
  model_version text not null,
  score numeric(5, 2) not null check (score between 0 and 100),
  strengths jsonb not null default '[]'::jsonb,
  weaknesses jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  passed_matches integer not null default 0 check (passed_matches >= 0),
  failed_matches integer not null default 0 check (failed_matches >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, cache_key, model_version)
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company text not null check (char_length(company) between 1 and 200),
  role text not null check (char_length(role) between 1 and 200),
  application_period text not null,
  result public.application_status not null check (result in ('passed', 'failed')),
  consented_at timestamptz not null,
  consent_version text not null,
  anonymized_at timestamptz,
  quality_status text not null default 'pending' check (quality_status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

create table public.contribution_questions (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.contributions(id) on delete cascade,
  position integer not null check (position >= 0),
  question text not null,
  answer text not null,
  created_at timestamptz not null default now(),
  unique (contribution_id, position)
);

create table public.contribution_embeddings (
  id uuid primary key default gen_random_uuid(),
  contribution_question_id uuid not null unique references public.contribution_questions(id) on delete cascade,
  embedding extensions.vector(1536) not null,
  embedding_model text not null,
  created_at timestamptz not null default now()
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null check (char_length(reason) between 1 and 200),
  reference_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reason, reference_id)
);

create index projects_user_created_idx on public.projects (user_id, created_at desc);
create index evidence_files_user_created_idx on public.evidence_files (user_id, created_at desc);
create index essays_project_position_idx on public.essays (project_id, position);
create index chat_sessions_project_updated_idx on public.chat_sessions (project_id, updated_at desc);
create index chat_messages_session_created_idx on public.chat_messages (session_id, created_at);
create index reports_project_created_idx on public.analysis_reports (project_id, created_at desc);
create index contributions_user_created_idx on public.contributions (user_id, created_at desc);
create index credit_transactions_user_created_idx on public.credit_transactions (user_id, created_at desc);
-- The vector extension is installed in the `extensions` schema, so its
-- operator class must be schema-qualified as well.
create index contribution_embeddings_hnsw_idx on public.contribution_embeddings using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
  for each row execute procedure public.set_updated_at();
create trigger evidence_files_set_updated_at before update on public.evidence_files
  for each row execute procedure public.set_updated_at();
create trigger essays_set_updated_at before update on public.essays
  for each row execute procedure public.set_updated_at();
create trigger chat_sessions_set_updated_at before update on public.chat_sessions
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.evidence_files enable row level security;
alter table public.project_files enable row level security;
alter table public.essays enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.analysis_reports enable row level security;
alter table public.contributions enable row level security;
alter table public.contribution_questions enable row level security;
alter table public.contribution_embeddings enable row level security;
alter table public.credit_transactions enable row level security;

create policy "profiles are private" on public.profiles for all using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "projects are private" on public.projects for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "files are private" on public.evidence_files for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "project files follow project ownership" on public.project_files for all
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
    and exists (select 1 from public.evidence_files f where f.id = file_id and f.user_id = (select auth.uid()))
  );
create policy "essays follow project ownership" on public.essays for all
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy "chat sessions are private" on public.chat_sessions for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "chat messages follow session ownership" on public.chat_messages for all
  using (exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = (select auth.uid())));
create policy "reports are private" on public.analysis_reports for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "contributions are private" on public.contributions for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "contribution questions follow ownership" on public.contribution_questions for all
  using (exists (select 1 from public.contributions c where c.id = contribution_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.contributions c where c.id = contribution_id and c.user_id = (select auth.uid())));
create policy "credit transactions are readable by owner" on public.credit_transactions for select using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public)
values ('evidence-files', 'evidence-files', false)
on conflict (id) do update set public = false;

create policy "private evidence files are readable by owner" on storage.objects for select
  using (bucket_id = 'evidence-files' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "private evidence files are insertable by owner" on storage.objects for insert
  with check (bucket_id = 'evidence-files' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "private evidence files are updatable by owner" on storage.objects for update
  using (bucket_id = 'evidence-files' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'evidence-files' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "private evidence files are deletable by owner" on storage.objects for delete
  using (bucket_id = 'evidence-files' and (storage.foldername(name))[1] = (select auth.uid()::text));

create or replace function public.credit_balance()
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(amount), 0)::integer
  from public.credit_transactions
  where user_id = (select auth.uid());
$$;

create or replace function public.consume_credits(p_amount integer, p_reason text, p_reference_id text)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  current_balance integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if p_amount <= 0 or p_reason = '' or p_reference_id = '' then
    raise exception 'Invalid credit transaction';
  end if;

  select coalesce(sum(amount), 0)::integer into current_balance
  from public.credit_transactions where user_id = current_user_id;
  if current_balance < p_amount then
    raise exception 'Insufficient credits';
  end if;

  insert into public.credit_transactions (user_id, amount, reason, reference_id)
  values (current_user_id, -p_amount, p_reason, p_reference_id)
  on conflict (user_id, reason, reference_id) do nothing;

  return public.credit_balance();
end;
$$;

create or replace function public.grant_monthly_credits(p_month date, p_amount integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if p_amount <= 0 then
    raise exception 'Credit amount must be positive';
  end if;
  insert into public.credit_transactions (user_id, amount, reason, reference_id)
  select id, p_amount, 'monthly_grant', to_char(p_month, 'YYYY-MM')
  from public.profiles
  on conflict (user_id, reason, reference_id) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.match_contribution_embeddings(
  query_embedding extensions.vector(1536),
  match_count integer default 20
)
returns table (
  contribution_id uuid,
  contribution_question_id uuid,
  company text,
  role text,
  result public.application_status,
  question text,
  answer text,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    q.id,
    c.company,
    c.role,
    c.result,
    q.question,
    q.answer,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.contribution_embeddings e
  join public.contribution_questions q on q.id = e.contribution_question_id
  join public.contributions c on c.id = q.contribution_id
  where c.quality_status = 'accepted' and c.anonymized_at is not null
  order by e.embedding <=> query_embedding
  limit greatest(least(match_count, 20), 1);
$$;

revoke all on function public.grant_monthly_credits(date, integer) from public, anon, authenticated;
revoke all on function public.match_contribution_embeddings(extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.credit_balance() to authenticated;
grant execute on function public.consume_credits(integer, text, text) to authenticated;
