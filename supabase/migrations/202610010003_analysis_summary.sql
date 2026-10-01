-- Add an LLM-generated overall summary(총평) to analysis reports.
-- Existing rows default to '' so reads stay safe before any re-analysis.

alter table public.analysis_reports
  add column if not exists summary text not null default '';
