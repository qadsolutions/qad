-- M2 (#20): pgvector extension + embeddings table with HNSW index.
--
-- embeddings stores one 768-dim vector per document_chunk. 768 matches the
-- nomic-embed-text Ollama model (CLAUDE.md "Stack"/"pgvector Index"); the
-- vector(768) column type enforces dimensionality at write time, so a wrong-size
-- vector from a misconfigured embedder is rejected by the DB rather than silently
-- stored and breaking similarity search later.
--
-- Isolation model is identical to the M2 content tables (20260617000002): every
-- row carries tenant_id, RLS is enabled, and the only authenticated-facing policy
-- is a tenant-scoped SELECT. All writes (the ingestion pipeline bulk-inserting
-- vectors) happen server-side via service_role, which bypasses RLS — so the
-- service_role write grant is included here up front, and table privileges are
-- granted explicitly since RLS bypass does not imply them.
--
-- Tenant-consistency at the denormalized FK (#78 precedent): embeddings.tenant_id
-- is denormalized from document_chunks.tenant_id purely so embedding-level RLS
-- doesn't need a join through document_chunks. This is the exact shape of problem
-- #78 hardened on document_chunks/messages: nothing on a plain single-column
-- chunk_id FK + independent tenant_id FK stops the copy from disagreeing with the
-- parent chunk's tenant_id, and since all writes go through service_role (RLS
-- bypassed), a buggy bulk insert is the only thing between a mismatched row and a
-- cross-tenant leak. So embeddings gets a COMPOSITE FK on (chunk_id, tenant_id)
-- targeting document_chunks (id, tenant_id), making a mismatch a constraint
-- violation rather than a latent bug — same DB-as-backstop-for-service_role
-- reasoning as document_chunks_doc_tenant_fk / messages_conv_tenant_fk.
--
-- document_chunks needs a `unique (id, tenant_id)` to be the target of that
-- composite FK. It had no children when 20260617000002 was written, so it was
-- never added there; we add it here via ALTER TABLE (that already-merged migration
-- is not edited). embeddings itself gets no `unique (id, tenant_id)` — nothing
-- references it as a parent yet (YAGNI).

create extension if not exists vector;

-- Backfill the parent-side unique constraint embeddings' composite FK targets.
alter table public.document_chunks
  add constraint document_chunks_id_tenant_uq unique (id, tenant_id);

-- ---------------------------------------------------------------------------
-- embeddings
-- One row per document_chunk: the chunk's 768-dim vector plus the model that
-- produced it (model_version supports re-embedding under a newer model later).
-- ---------------------------------------------------------------------------

create table public.embeddings (
  id            uuid        primary key default gen_random_uuid(),
  chunk_id      uuid        not null,
  tenant_id     uuid        not null references public.tenants (id) on delete cascade,
  embedding     vector(768) not null,
  model_version text        not null,
  created_at    timestamptz not null default now(),
  -- Composite FK (not a plain chunk_id FK) so an embedding's tenant_id can never
  -- disagree with its chunk's tenant_id — see the tenant-consistency note above.
  -- on delete cascade so re-ingestion (delete chunks → embeddings go too) and
  -- tenant teardown both clean up vectors automatically.
  constraint embeddings_chunk_tenant_fk
    foreign key (chunk_id, tenant_id) references public.document_chunks (id, tenant_id) on delete cascade
);

-- HNSW index for approximate-nearest-neighbour cosine similarity search — the
-- pgvector path the RAG retrieval step uses. HNSW (not IVFFlat) handles
-- continuously-added documents without VACUUM/lists tuning (CLAUDE.md "pgvector
-- Index"). vector_cosine_ops matches the cosine distance operator (<=>) used at
-- query time.
create index embeddings_embedding_hnsw_idx
  on public.embeddings
  using hnsw (embedding vector_cosine_ops)
  with (ef_construction = 64, m = 16);

-- Tenant-scoped index (mirrors documents_tenant_id_idx etc.) so RLS's
-- tenant_id predicate is index-backed.
create index embeddings_tenant_id_idx on public.embeddings (tenant_id);
-- chunk_id index (mirrors document_chunks_document_id_idx) — backs the
-- re-ingestion "delete embeddings for these chunks" flow and chunk joins.
create index embeddings_chunk_id_idx on public.embeddings (chunk_id);

alter table public.embeddings enable row level security;

create policy "embeddings: select own tenant"
  on public.embeddings
  for select
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Grants
-- anon has no access. authenticated is scoped by the RLS policy above.
-- service_role bypasses RLS and is the only write path (ingestion pipeline) —
-- granted explicitly since RLS bypass does not imply table privileges.
-- ---------------------------------------------------------------------------

grant select on public.embeddings to authenticated;
grant select, insert, update, delete on public.embeddings to service_role;
