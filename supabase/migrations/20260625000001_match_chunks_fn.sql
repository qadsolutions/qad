-- M4 (#28): tenant-filtered cosine similarity search via the HNSW index.
--
-- match_chunks is the RAG retrieval function called on every user query. It
-- returns the top-k document chunks most similar to a query embedding, filtered
-- strictly to one tenant.
--
-- HNSW POST-FILTER RECALL (documented in 20260618000003_pgvector_embeddings.sql)
-- The shared multi-tenant index applies the tenant_id predicate as a post-filter
-- over the HNSW candidate set (default hnsw.ef_search = 40). In a busy tenant a
-- qualifying chunk can sit outside that window, causing the query to silently
-- return fewer than k or lower-quality matches. SET LOCAL hnsw.ef_search = 100
-- widens the candidate window before the filter runs. 100 is 2.5× the default;
-- the right value at scale is empirical (pgvector iterative scans in v0.8+ are
-- the permanent fix — see issue #96). SET LOCAL confines the change to the
-- caller's transaction — no session-wide side-effect.
--
-- ISOLATION MODEL
-- SECURITY INVOKER: the function runs with the caller's privileges.
--   authenticated path: PostgREST injects the JWT role → RLS on embeddings and
--     document_chunks scopes the scan to the JWT's tenant_id automatically.
--   service_role path: bypasses RLS → the explicit WHERE e.tenant_id = p_tenant_id
--     is the only isolation guard. Callers MUST supply the validated tenant_id from
--     the request's verified JWT (never from the request body).
-- The explicit WHERE filter is defense-in-depth on both paths.
--
-- SEARCH PATH
-- SET search_path = public pins the resolution scope (Supabase linter:
-- function_search_path_mutable). Unlike other functions in this repo that use
-- search_path = '' + fully-qualified ::public.vector casts, match_chunks also
-- relies on the <=> operator, which would require the ugly OPERATOR(public.<=>)
-- syntax under an empty path. Since the vector extension is installed in public
-- (see 20260618000003_pgvector_embeddings.sql), search_path = public lets
-- ::vector(768) and <=> resolve normally while satisfying the linter.
--
-- PARAMETER ENCODING
-- query_embedding is TEXT, not vector(768), so callers can pass the pgvector
-- literal '[f0,f1,…,f767]' without the client needing to understand the vector
-- type — identical to reingest_document_chunks accepting Json for chunk payloads.
-- The cast to vector(768) inside the body validates dimensionality at call time.

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding text,
  p_tenant_id     uuid,
  p_top_k         integer DEFAULT 5
)
RETURNS TABLE (
  chunk_id    uuid,
  document_id uuid,
  chunk_text  text,
  similarity  double precision
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  SET LOCAL hnsw.ef_search = 100;

  RETURN QUERY
  SELECT
    e.chunk_id,
    dc.document_id,
    dc.chunk_text,
    (1.0 - (e.embedding <=> query_embedding::vector(768)))::double precision AS similarity
  FROM public.embeddings e
  JOIN public.document_chunks dc
    ON dc.id = e.chunk_id AND dc.tenant_id = e.tenant_id
  WHERE e.tenant_id = p_tenant_id
  ORDER BY e.embedding <=> query_embedding::vector(768)
  LIMIT p_top_k;
END;
$$;

-- anon has no retrieval access.
-- authenticated: the Client Portal query path (SECURITY INVOKER → RLS scopes rows).
-- service_role: the admin / background path (RLS bypassed; p_tenant_id is the guard).
GRANT EXECUTE ON FUNCTION public.match_chunks(text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks(text, uuid, integer) TO service_role;
