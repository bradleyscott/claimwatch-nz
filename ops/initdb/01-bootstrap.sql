-- Slice role/bootstrap SQL. Runs once on first container start.
-- Append-only enforcement (STORE §2.4): pipeline gets INSERT/SELECT only;
-- UPDATE/DELETE are never granted. Site role is SELECT-only.

-- Separate database for harness labels (blind rule, HARNESS §2.4).
CREATE DATABASE claimwatch_labels;

-- \c claimwatch
-- CREATE ROLE pipeline LOGIN PASSWORD '<set in .env>';
-- CREATE ROLE site READ ONLY ...
-- Grants land with the first store migration (they reference its tables).