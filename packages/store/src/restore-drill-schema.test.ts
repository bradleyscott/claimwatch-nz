// Restore-drill table derivation (STORE §5.2, STO-R7). A pure function over the
// Drizzle schema, so it runs with no database — the drill's table set is
// DERIVED, and these tests pin the derivation rather than a literal list.
//
// A hand-maintained table array drifts: a table in neither the dump list nor the
// grant list makes the release-blocking drill report PASS while dropping it. The
// derivation is what these tests pin.

import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { drillTableGraph, drillTables } from "./restore-drill.ts";
import * as schema from "./schema/index.ts";

/** Independent re-derivation: the schema's table names, straight from Drizzle. */
function schemaTableNames(): string[] {
  return Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map((table) => getTableConfig(table).name);
}

describe("restore drill table set", () => {
  it("covers every table the store schema defines — none can be silently omitted", () => {
    expect([...drillTables()].sort()).toEqual(schemaTableNames().sort());
  });

  it("includes the append-only authority registry", () => {
    // Losing `authority` in a restore is losing the amortised discoveries that
    // make repeat checks cheap — it is not reconstructible from the raw lanes.
    expect(drillTables()).toContain("authority");
  });

  it("orders every referenced table before the tables that reference it", () => {
    // The dump replays as plain INSERTs, so a child row must not precede its
    // parent: verdict_transition_log → verdict_version → evidence_pack.
    const position = new Map(drillTables().map((name, i) => [name, i]));
    for (const node of drillTableGraph()) {
      for (const dep of node.dependsOn) {
        const parentIndex = position.get(dep);
        const childIndex = position.get(node.name);
        if (parentIndex === undefined || childIndex === undefined) {
          throw new Error(`${node.name} references ${dep}, which the drill order omits`);
        }
        expect(parentIndex).toBeLessThan(childIndex);
      }
    }
  });

  it("lists each table exactly once", () => {
    const names = drillTables();
    expect(new Set(names).size).toBe(names.length);
  });
});
