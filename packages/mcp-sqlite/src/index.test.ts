// mcp-sqlite 协议级 E2E：spawn 真子进程，临时目录建 .db 建表插数查询全链路（离线）。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

describe("mcp-sqlite (E2E)", () => {
  it(
    "exposes 5 sqlite tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "sqlite.close",
          "sqlite.exec",
          "sqlite.query",
          "sqlite.schema",
          "sqlite.tables",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "exec DDL/DML then query roundtrip with positional params",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-sqlite-"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_SQLITE_ROOTS: root } });
      try {
        const create = await server.call("sqlite.exec", {
          db: "app.db",
          sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INT DEFAULT 18)",
        });
        expect(create.ok).toBe(true);
        expect(create.data).toMatchObject({ changes: 0 });

        const insert = await server.call("sqlite.exec", {
          db: "app.db",
          sql: "INSERT INTO users (name, age) VALUES ('ada', 36), ('linus', 55)",
        });
        expect(insert.ok).toBe(true);
        expect(insert.data).toMatchObject({ changes: 2, lastInsertRowid: 2 });

        const all = await server.call("sqlite.query", { db: "app.db", sql: "SELECT id, name, age FROM users ORDER BY id" });
        expect(all.ok).toBe(true);
        const allData = all.data as { columns: string[]; rows: object[]; rowCount: number; truncated: boolean };
        expect(allData.columns).toEqual(["id", "name", "age"]);
        expect(allData.rowCount).toBe(2);
        expect(allData.rows[0]).toEqual({ id: 1, name: "ada", age: 36 });

        const paramed = await server.call("sqlite.query", {
          db: "app.db",
          sql: "SELECT name FROM users WHERE age > ? AND name != ?",
          params: [30, "linus"],
        });
        expect(paramed.ok).toBe(true);
        expect((paramed.data as { rows: Array<{ name: string }> }).rows).toEqual([{ name: "ada" }]);

        const nullParam = await server.call("sqlite.query", {
          db: "app.db",
          sql: "SELECT count(*) AS n FROM users WHERE name IS NOT ?",
          params: [null],
        });
        expect(((nullParam.data as { rows: Array<{ n: number }> }).rows[0]!.n)).toBe(2);
        expect(existsSync(join(root, "app.db"))).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "query caps rows at 100 with truncated flag and supports multi-statement exec",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-sqlite-"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_SQLITE_ROOTS: root } });
      try {
        // 多语句 exec：建表 + 批量插入 105 行
        const values = Array.from({ length: 105 }, (_, i) => `('row-${i}')`).join(", ");
        const bulk = await server.call("sqlite.exec", {
          db: "bulk.db",
          sql: `CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO items (label) VALUES ${values};`,
        });
        expect(bulk.ok).toBe(true);

        const paged = await server.call("sqlite.query", { db: "bulk.db", sql: "SELECT id, label FROM items ORDER BY id" });
        const pagedData = paged.data as { rows: object[]; rowCount: number; truncated: boolean };
        expect(pagedData.rowCount).toBe(105);
        expect(pagedData.rows.length).toBe(100);
        expect(pagedData.truncated).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "tables and schema describe the database structure",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-sqlite-"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_SQLITE_ROOTS: root } });
      try {
        await server.call("sqlite.exec", {
          db: "meta.db",
          sql: "CREATE TABLE scenes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, fps REAL DEFAULT 30.0, tags TEXT)",
        });
        const tables = await server.call("sqlite.tables", { db: "meta.db" });
        expect(tables.ok).toBe(true);
        const tablesData = tables.data as { tables: Array<{ name: string; type: string; sql: string | null }>; total: number };
        expect(tablesData.total).toBe(1);
        expect(tablesData.tables[0]!.name).toBe("scenes");
        expect(tablesData.tables[0]!.type).toBe("table");
        expect(tablesData.tables[0]!.sql).toContain("CREATE TABLE");

        const schema = await server.call("sqlite.schema", { db: "meta.db", table: "scenes" });
        expect(schema.ok).toBe(true);
        const schemaData = schema.data as {
          sql: string;
          columns: Array<{ name: string; type: string; notnull: boolean; default?: unknown; primaryKey: boolean }>;
        };
        expect(schemaData.sql).toContain("CREATE TABLE scenes");
        const byName = new Map(schemaData.columns.map((c) => [c.name, c]));
        expect(byName.get("id")).toMatchObject({ type: "INTEGER", primaryKey: true });
        expect(byName.get("title")).toMatchObject({ type: "TEXT", notnull: true });
        expect(byName.get("fps")).toMatchObject({ type: "REAL", default: "30.0" }); // dflt_value 按源文本返回
        expect(byName.get("tags")).toMatchObject({ notnull: false, primaryKey: false });

        const missing = await server.call("sqlite.schema", { db: "meta.db", table: "ghost" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_NOT_FOUND");

        const badIdent = await server.call("sqlite.schema", { db: "meta.db", table: "x; DROP TABLE scenes" });
        expect(badIdent.ok).toBe(false);
        expect(badIdent.error).toContain("E_ARGS");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "close evicts the connection; exec reopens on demand; double close errors",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-sqlite-"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_SQLITE_ROOTS: root } });
      try {
        await server.call("sqlite.exec", { db: "re.db", sql: "CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (7)" });
        const close = await server.call("sqlite.close", { db: "re.db" });
        expect(close.ok).toBe(true);
        expect(close.data).toMatchObject({ closed: true, openConnections: 0 });

        const again = await server.call("sqlite.close", { db: "re.db" });
        expect(again.ok).toBe(false);
        expect(again.error).toContain("E_DB");

        // close 后再次 exec → 自动重开并读到旧数据
        const reopen = await server.call("sqlite.query", { db: "re.db", sql: "SELECT x FROM t" });
        expect(reopen.ok).toBe(true);
        expect((reopen.data as { rows: Array<{ x: number }> }).rows).toEqual([{ x: 7 }]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "errors: bad SQL (E_SQL), write-via-query guard, jail escapes, missing parent dir",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-sqlite-"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_SQLITE_ROOTS: root } });
      try {
        const badSql = await server.call("sqlite.exec", { db: "e.db", sql: "CREAT TABLE broken (x INT)" });
        expect(badSql.ok).toBe(false);
        expect(badSql.error).toContain("E_SQL");
        expect(badSql.error).toMatch(/syntax error|near/);

        await server.call("sqlite.exec", { db: "e.db", sql: "CREATE TABLE t (x INTEGER)" });
        const noSuchTable = await server.call("sqlite.query", { db: "e.db", sql: "SELECT * FROM missing" });
        expect(noSuchTable.ok).toBe(false);
        expect(noSuchTable.error).toContain("E_SQL");

        const writeViaQuery = await server.call("sqlite.query", {
          db: "e.db",
          sql: "INSERT INTO t VALUES (1)",
        });
        expect(writeViaQuery.ok).toBe(false);
        expect(writeViaQuery.error).toContain("E_SQL");

        const outside = await server.call("sqlite.exec", { db: "../escape.db", sql: "CREATE TABLE t (x)" });
        expect(outside.ok).toBe(false);
        expect(outside.error).toContain("E_JAIL");

        const noParent = await server.call("sqlite.exec", { db: "no/such/dir/x.db", sql: "CREATE TABLE t (x)" });
        expect(noParent.ok).toBe(false);
        expect(noParent.error).toContain("E_NOT_FOUND");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
