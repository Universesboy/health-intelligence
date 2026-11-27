// Minimal D1 over node:sqlite with every migration applied. Used by route tests and the local preview.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

export function memoryD1(dir = "migrations") {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort())
    for (const sql of readFileSync(`${dir}/${file}`, "utf8").split("--> statement-breakpoint")) if (sql.trim()) db.exec(sql);
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind: (...values: unknown[]) => { params = values.map((v) => (v === undefined ? null : v)); return stmt; },
      run: async () => { db.prepare(sql).run(...(params as never[])); return { success: true }; },
      all: async <T>() => ({ results: db.prepare(sql).all(...(params as never[])) as T[] }),
      first: async <T>() => (db.prepare(sql).get(...(params as never[])) ?? null) as T | null,
    };
    return stmt;
  };
  const batch = async (statements: { run: () => Promise<unknown> }[]) => {
    db.exec("BEGIN");
    try { for (const s of statements) await s.run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
    return [];
  };
  return { raw: db, d1: { prepare, batch } as unknown as D1Database };
}
