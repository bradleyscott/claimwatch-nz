-- Append-only enforcement (STO-R1): triggers reject UPDATE/DELETE on
-- append-only tables. verdict_version is split: UPDATE fires only when the
-- status column is untouched (lifecycle transitions are legal — the pipeline
-- logs every change via verdict_transition_log); DELETE is always rejected.
CREATE OR REPLACE FUNCTION publication_append_only_guard() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION evidence_item_append_only_guard() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION evidence_pack_append_only_guard() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION verdict_version_append_only_guard() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION authority_append_only_guard() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS publication_append_only ON "publication";
CREATE TRIGGER publication_append_only BEFORE UPDATE OR DELETE ON "publication"
  FOR EACH ROW EXECUTE FUNCTION publication_append_only_guard();

DROP TRIGGER IF EXISTS evidence_item_append_only ON "evidence_item";
CREATE TRIGGER evidence_item_append_only BEFORE UPDATE OR DELETE ON "evidence_item"
  FOR EACH ROW EXECUTE FUNCTION evidence_item_append_only_guard();

DROP TRIGGER IF EXISTS evidence_pack_append_only ON "evidence_pack";
CREATE TRIGGER evidence_pack_append_only BEFORE UPDATE OR DELETE ON "evidence_pack"
  FOR EACH ROW EXECUTE FUNCTION evidence_pack_append_only_guard();

DROP TRIGGER IF EXISTS verdict_version_append_only ON "verdict_version";
DROP TRIGGER IF EXISTS verdict_version_append_only_update ON "verdict_version";
DROP TRIGGER IF EXISTS verdict_version_append_only_delete ON "verdict_version";
CREATE TRIGGER verdict_version_append_only_update BEFORE UPDATE ON "verdict_version"
  FOR EACH ROW WHEN (OLD.status IS NOT DISTINCT FROM NEW.status)
  EXECUTE FUNCTION verdict_version_append_only_guard();
CREATE TRIGGER verdict_version_append_only_delete BEFORE DELETE ON "verdict_version"
  FOR EACH ROW EXECUTE FUNCTION verdict_version_append_only_guard();

DROP TRIGGER IF EXISTS authority_append_only ON "authority";
CREATE TRIGGER authority_append_only BEFORE UPDATE OR DELETE ON "authority"
  FOR EACH ROW EXECUTE FUNCTION authority_append_only_guard();
