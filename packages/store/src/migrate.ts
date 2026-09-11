// Migration runner: applies the drizzle migration chain from zero.
// CI runs this against a scratch Postgres before merge (STORE §2.4).
// Implementation lands with the first schema batch; failing tests assert it.

export async function migrate(databaseUrl: string): Promise<void> {
  void databaseUrl;
  throw new Error("migrate: not implemented — Store schema phase");
}
