-- M4 (#96): make hnsw.ef_search configurable via the p_ef_search parameter.
--
-- This migration replaces match_chunks (originally defined in
-- 20260625000001_match_chunks_fn.sql) with an updated signature that accepts
-- p_ef_search so callers can widen or narrow the HNSW candidate window at
-- call time instead of using the hardcoded value of 100.
--
-- WHY p_ef_search EXISTS
-- The shared multi-tenant HNSW index applies the tenant_id predicate as a
-- post-filter over the candidate set produced by the graph traversal. If the
-- candidate window (hnsw.ef_search) is smaller than the number of candidate
-- vectors inspected before finding k qualifying chunks, the query silently
-- returns fewer than k results (or lower-quality matches). This is the
-- "post-filter recall" problem on dense multi-tenant indexes.
--
-- DEFAULT VALUE: 100 (2.5× the pgvector built-in default of 40).
-- At the prototype scale (tens to hundreds of documents per tenant) this is
-- more than sufficient. At scale, the right value is empirical: measure
-- average recall (fraction of expected chunks returned) and increase until
-- recall is acceptable. Each doubling of ef_search roughly doubles traversal
-- work; above ~400 diminishing returns typically set in.
--
-- ENV VAR: RAG_HNSW_EF_SEARCH (read in src/lib/rag/retrieval.ts → getEfSearch()).
-- Callers set this env var to control the default; the SQL DEFAULT 100 here
-- is a safety net for any caller that does not supply the argument.
--
-- PERFORMANCE BUDGET: target < 200ms per query (HNSW). At ef_search=100
-- on a typical workload this is well within budget.
--
-- SECURITY INVOKER / ISOLATION MODEL: unchanged from the original migration.
-- See 20260625000001_match_chunks_fn.sql for the full isolation-model comment.
--
-- FORMAT + EXECUTE NOTE
-- SET LOCAL does not accept a parameter placeholder, so injection prevention
-- requires EXECUTE format(). The value is validated as an integer by the
-- explicit IF guard before reaching EXECUTE, making the format call safe.

-- Drop the old 3-argument overload so the new 4-argument version is the only
-- match_chunks signature in the catalog. Having both simultaneously causes
-- "function is not unique" errors on calls that use positional arguments with
-- fewer than 4 args — PostgreSQL cannot determine which overload to use when
-- the text literal comes in as type `unknown` and both signatures are eligible
-- via their DEFAULT parameter values.
DROP FUNCTION IF EXISTS public.match_chunks(text, uuid, integer);

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding text,
  p_tenant_id     uuid,
  p_top_k         integer DEFAULT 5,
  p_ef_search     integer DEFAULT 100
)
RETURNS TABLE (
  chunk_id    uuid,
  document_id uuid,
  chunk_text  text,
  similarity  double precision
)
LANGUAGE plpgsql
VOLATILE     -- SET LOCAL inside the body is a side effect; STABLE/IMMUTABLE would be wrong
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_top_k IS NULL OR p_top_k <= 0 THEN
    RAISE EXCEPTION 'p_top_k must be a positive integer, got %', p_top_k;
  END IF;

  IF p_ef_search IS NULL OR p_ef_search <= 0 THEN
    RAISE EXCEPTION 'p_ef_search must be a positive integer, got %', p_ef_search;
  END IF;

  -- SET LOCAL does not accept a parameter placeholder; use format() + EXECUTE.
  -- p_ef_search is validated as a positive integer above, so injection is not
  -- possible here.
  EXECUTE format('SET LOCAL hnsw.ef_search = %s', p_ef_search);

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

-- Re-grant EXECUTE for the new function signature. PostgreSQL treats functions
-- with different signatures as distinct objects, so the GRANTs from the
-- original migration (text, uuid, integer) do not carry over to the new
-- four-argument overload.
--
-- anon has no retrieval access.
-- authenticated: the Client Portal query path (SECURITY INVOKER → RLS scopes rows).
-- service_role: the admin / background path (RLS bypassed; p_tenant_id is the guard).
GRANT EXECUTE ON FUNCTION public.match_chunks(text, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks(text, uuid, integer, integer) TO service_role;
