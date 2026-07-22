CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "knowledge_chunks"
ADD COLUMN "search_text" TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION opensupportai_lexical_search_text(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
DECLARE
  result TEXT := lower(value);
  cjk_segment TEXT;
  segment_length INTEGER;
  gram_size INTEGER;
  gram_index INTEGER;
BEGIN
  FOR cjk_segment IN
    SELECT matches[1]
    FROM regexp_matches(value, U&'([\4E00-\9FFF]+)', 'g') AS matches
  LOOP
    segment_length := char_length(cjk_segment);
    FOR gram_size IN 2..LEAST(3, segment_length)
    LOOP
      FOR gram_index IN 1..(segment_length - gram_size + 1)
      LOOP
        result := result || ' ' || substring(cjk_segment FROM gram_index FOR gram_size);
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION opensupportai_set_knowledge_chunk_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.search_text := opensupportai_lexical_search_text(NEW.content);
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "knowledge_chunks_search_text_trigger"
BEFORE INSERT OR UPDATE OF "content" ON "knowledge_chunks"
FOR EACH ROW
EXECUTE FUNCTION opensupportai_set_knowledge_chunk_search_text();

UPDATE "knowledge_chunks"
SET "search_text" = opensupportai_lexical_search_text("content");

CREATE INDEX "knowledge_chunks_search_text_fts_idx"
ON "knowledge_chunks"
USING GIN (to_tsvector('simple', "search_text"));

CREATE INDEX "knowledge_chunks_content_trgm_idx"
ON "knowledge_chunks"
USING GIN (lower("content") gin_trgm_ops);
