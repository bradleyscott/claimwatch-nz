-- Labels are append-only (STO-R17, STORE §2.5, HARNESS §2.1).
--
-- A label, a label set, a double-label pairing and a stratum assignment are all
-- historical records: a published L3 run was scored against a particular
-- assignment version and label-set version, and the run file pins the numbers it
-- produced. So a correction is a NEW row — a new label, a new `label_set_version`,
-- a new `assignment_version` — never an edit of the row a run was scored against.
--
-- The grants do not carry this. The `harness` role deliberately holds ALL
-- privileges on this database (it is the labeller's role; the blind rule
-- constrains `pipeline`, not `harness`), so before this migration
-- `UPDATE stratum_assignment SET stratum = …` succeeded and would have silently
-- rewritten the grid an L3 run rested on, leaving no way to tell. Zero triggers
-- existed on any labels table.
--
-- ADR-0019 (speakership attribution and claim scope) makes this live rather than
-- theoretical: re-deriving the HARNESS §2.2 strata is exactly when a claim that
-- was in scope becomes out of scope, and the cheap move is to "fix" the existing
-- assignment in place. Versioned rows were always the design (STORE §2.5,
-- STO-R17); this makes the alternative actually blocked (Sept 2026).
CREATE OR REPLACE FUNCTION labels_append_only_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (STO-R17): write a new label / label set / assignment version instead of editing history', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS label_append_only ON "label";
CREATE TRIGGER label_append_only BEFORE UPDATE OR DELETE ON "label"
  FOR EACH ROW EXECUTE FUNCTION labels_append_only_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS label_set_append_only ON "label_set";
CREATE TRIGGER label_set_append_only BEFORE UPDATE OR DELETE ON "label_set"
  FOR EACH ROW EXECUTE FUNCTION labels_append_only_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS double_label_append_only ON "double_label";
CREATE TRIGGER double_label_append_only BEFORE UPDATE OR DELETE ON "double_label"
  FOR EACH ROW EXECUTE FUNCTION labels_append_only_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS stratum_assignment_append_only ON "stratum_assignment";
CREATE TRIGGER stratum_assignment_append_only BEFORE UPDATE OR DELETE ON "stratum_assignment"
  FOR EACH ROW EXECUTE FUNCTION labels_append_only_guard();
