-- M2 (#19): core content tables — documents, document_chunks, conversations, messages.
--
-- Same isolation model as M1 (20260615000001): every table carries tenant_id,
-- RLS is enabled, and the only authenticated-facing policy is a tenant-scoped
-- SELECT. There are no client-facing insert/update policies — all writes
-- (ingestion, chat) happen server-side via service_role, which bypasses RLS.
--
-- Unlike M1, the service_role write grants are included in this migration up
-- front rather than as a follow-up fix — 20260616000002 was needed only because
-- the original M1 migration granted authenticated alone and service_role writes
-- failed with "permission denied for table" (RLS bypass does not imply table
-- privileges). Granting both here from the start avoids repeating that gap.
--
-- Tenant-consistency at the denormalized FKs (#78, raised in review of #19): both
-- document_chunks and messages carry a tenant_id denormalized from their parent
-- (documents / conversations) purely so chunk/message-level RLS doesn't need a
-- join. Nothing stops the copy from disagreeing with the parent's tenant_id on a
-- plain single-column FK — and since all writes happen via service_role (which
-- bypasses RLS), a server-side bug is the only thing standing between a
-- mismatched row and a genuine cross-tenant leak. Each parent therefore gets a
-- `unique (id, tenant_id)` so the child's FK can target that pair instead of just
-- `id`, making a mismatched tenant_id a constraint violation rather than a latent
-- bug — the same DB-as-backstop-for-service_role-writes reasoning already used for
-- the platform_admin CHECKs in 20260617000001 (#69).

-- ---------------------------------------------------------------------------
-- documents
-- One row per uploaded file. Status tracks the async ingestion pipeline
-- (see CLAUDE.md "Document Ingestion Pipeline").
-- ---------------------------------------------------------------------------

create table public.documents (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants (id) on delete cascade,
  filename     text        not null,
  file_type    text        not null,
  storage_path text        not null,
  version      integer     not null default 1,
  status       text        not null default 'uploading'
                            check (status in ('uploading', 'processing', 'ready', 'error')),
  created_at   timestamptz not null default now(),
  -- Lets document_chunks' FK target (id, tenant_id) instead of id alone.
  constraint documents_id_tenant_uq unique (id, tenant_id)
);

create index documents_tenant_id_idx on public.documents (tenant_id);

alter table public.documents enable row level security;

create policy "documents: select own tenant"
  on public.documents
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- document_chunks
-- Chunked text per document, produced by the ingestion pipeline. tenant_id is
-- denormalized from documents so chunk-level RLS doesn't require a join.
-- ---------------------------------------------------------------------------

create table public.document_chunks (
  id          uuid        primary key default gen_random_uuid(),
  document_id uuid        not null,
  tenant_id   uuid        not null references public.tenants (id) on delete cascade,
  chunk_text  text        not null,
  chunk_index integer     not null,
  token_count integer     not null,
  created_at  timestamptz not null default now(),
  -- Composite FK (not a plain document_id FK) so a chunk's tenant_id can never
  -- disagree with its document's tenant_id — see the tenant-consistency note above.
  constraint document_chunks_doc_tenant_fk
    foreign key (document_id, tenant_id) references public.documents (id, tenant_id) on delete cascade,
  -- Chunk indices are unique within a document; also backs the re-ingestion
  -- "delete all chunks then reinsert" flow (CLAUDE.md ingestion pipeline).
  constraint document_chunks_doc_chunk_index_uq unique (document_id, chunk_index)
);

create index document_chunks_tenant_id_idx on public.document_chunks (tenant_id);
create index document_chunks_document_id_idx on public.document_chunks (document_id);

alter table public.document_chunks enable row level security;

create policy "document_chunks: select own tenant"
  on public.document_chunks
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- conversations
-- One row per chat thread. title is nullable — a new conversation has no
-- title until the client portal derives one (e.g. from the first message).
-- ---------------------------------------------------------------------------

create table public.conversations (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.users (id) on delete cascade,
  tenant_id  uuid        not null references public.tenants (id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  -- Lets messages' FK target (id, tenant_id) instead of id alone. (user_id's own
  -- cross-tenant case is intentionally not backstopped here — users.tenant_id is
  -- nullable for platform_admin, which complicates a composite FK; deferred to #15.)
  constraint conversations_id_tenant_uq unique (id, tenant_id)
);

create index conversations_tenant_id_idx on public.conversations (tenant_id);
create index conversations_user_id_idx on public.conversations (user_id);

alter table public.conversations enable row level security;

create policy "conversations: select own tenant"
  on public.conversations
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- messages
-- One row per turn in a conversation. role follows the Vercel AI SDK message
-- role convention (the project's chosen AI SDK — see CLAUDE.md "Stack").
-- 'tool' is intentionally omitted: no tool-calling milestone exists yet.
-- ---------------------------------------------------------------------------

create table public.messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null,
  tenant_id       uuid        not null references public.tenants (id) on delete cascade,
  role            text        not null check (role in ('user', 'assistant', 'system')),
  content         text        not null,
  created_at      timestamptz not null default now(),
  -- Composite FK (not a plain conversation_id FK) so a message's tenant_id can
  -- never disagree with its conversation's tenant_id — see the tenant-consistency
  -- note above.
  constraint messages_conv_tenant_fk
    foreign key (conversation_id, tenant_id) references public.conversations (id, tenant_id) on delete cascade
);

create index messages_tenant_id_idx on public.messages (tenant_id);
create index messages_conversation_id_idx on public.messages (conversation_id);

alter table public.messages enable row level security;

create policy "messages: select own tenant"
  on public.messages
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Grants
-- anon has no access (no policies, no grants). authenticated is scoped by the
-- RLS policies above. service_role bypasses RLS entirely and is the only
-- write path (document ingestion, chat) — granted explicitly since RLS bypass
-- does not imply table privileges.
-- ---------------------------------------------------------------------------

grant select on public.documents       to authenticated;
grant select on public.document_chunks to authenticated;
grant select on public.conversations   to authenticated;
grant select on public.messages        to authenticated;

grant select, insert, update, delete on public.documents       to service_role;
grant select, insert, update, delete on public.document_chunks to service_role;
grant select, insert, update, delete on public.conversations   to service_role;
grant select, insert, update, delete on public.messages        to service_role;
