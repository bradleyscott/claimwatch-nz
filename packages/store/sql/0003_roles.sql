-- Role setup (names only — no committed credentials). Idempotent.
DO $$ BEGIN CREATE ROLE pipeline NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE site NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE harness NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO pipeline, site, harness;
GRANT INSERT, SELECT ON publication, segment, claim, claimant_entity, evidence_item,
  evidence_pack, verdict_version, verdict_transition_log, fallback_log, verdict_provenance, authority
  TO pipeline;
GRANT SELECT ON publication, segment, claim, claimant_entity, evidence_item,
  evidence_pack, verdict_version, verdict_transition_log, fallback_log, verdict_provenance, authority
  TO site;
