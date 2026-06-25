-- M3 (#92): constrain documents.status and documents.file_type with Postgres
-- enums so `supabase gen types` emits TS string-literal unions instead of `string`.
--
-- WHY. Both columns were plain `text` in 20260617000002_create_core_content_tables.sql.
-- `status` already had an inline `check (status in (...))`, but Supabase typegen
-- does not lift an inline CHECK into a TS union — only a named domain/enum or a
-- typed column does. `file_type` had no constraint at all. As a result the app
-- layer re-declared these invariants with no compiler link to the schema:
--   - src/lib/ingestion/ingest-document.ts's updateStatus() hand-declared the
--     status literal union locally (and could silently drift from the DB's set).
--   - src/lib/documents/validation.ts's isFileType() was the only thing narrowing
--     file_type before ingest-document.ts's exhaustive parser switch.
--
-- Moving both columns to named Postgres enums fixes typegen at the source: the
-- four-value invariants live once, in the schema, and the compiler enforces app
-- code against them (the runtime narrowing in isFileType() stays as
-- defense-in-depth — typegen does not make an arbitrary stored value trustworthy
-- without a guard, since e.g. an out-of-band write could still need handling).
--
-- USING status::document_status / file_type::document_file_type casts existing
-- text values during the ALTER — safe here because every existing row was already
-- constrained to these four values (status) or written only by the upload path's
-- four-value isFileType()-guarded set (file_type). This entire file is applied as one
-- multi-statement simple-query message (tests/helpers/setup-test-db.ts sends the whole
-- file in a single sql.unsafe() call), which Postgres runs inside one implicit
-- transaction. So the ACCESS EXCLUSIVE lock the first ALTER TABLE below takes on
-- public.documents is held until that transaction commits — for the whole migration,
-- not released after that one statement. No concurrent writer can observe or race the
-- column type change, and no explicit LOCK TABLE is needed here.

create type document_status as enum ('uploading', 'processing', 'ready', 'error');
create type document_file_type as enum ('pdf', 'docx', 'txt', 'md');

-- The inline CHECK becomes redundant once the column type itself is the enum
-- (Postgres rejects out-of-range enum values at the type level), so it is
-- dropped rather than kept alongside a now-redundant ANY(ARRAY[...]) check.
alter table public.documents
  drop constraint if exists documents_status_check;

-- The existing text default must be dropped before the ALTER COLUMN TYPE —
-- Postgres cannot auto-cast a column default across types — and re-added after
-- as the enum's 'uploading' value.
alter table public.documents
  alter column status drop default;

alter table public.documents
  alter column status type document_status using status::document_status;

alter table public.documents
  alter column status set default 'uploading'::document_status;

alter table public.documents
  alter column file_type type document_file_type using file_type::document_file_type;

comment on column public.documents.status is
  'Async ingestion pipeline state (CLAUDE.md "Document Ingestion Pipeline"). '
  'document_status enum: uploading (initial, set by the upload route) | '
  'processing (worker picked it up) | ready | error (see error_detail).';

comment on column public.documents.file_type is
  'Canonical parser key resolved from the upload filename''s extension '
  '(src/lib/documents/validation.ts resolveFileType). document_file_type enum: '
  'pdf | docx | txt | md.';
