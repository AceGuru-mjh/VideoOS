// @videoos/mcp-sqlite —— SQLite 工具服务器（stdio MCP）：bun:sqlite 内建（零原生下载）。
// 关键设计点：模块级 Map<absPath, Database> 连接缓存（key = jail resolve 后的绝对路径，close 主动驱逐、
// 下次调用自动重开）；exec 走 .run()（多语句 OK），query 走 .all() 且只放行 SELECT/PRAGMA/EXPLAIN/WITH；
// db 文件必须监狱内；SQL 错误透传 sqlite message（E_SQL 前缀）。
import { defineTool, runStdioServer, ok, err, jailFromEnv, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";
import { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";

const jail = await jailFromEnv("MCP_SQLITE_ROOTS");

/** 连接缓存：key = 监狱内绝对路径（模块级可变状态，SPEC 允许的缓存例外） */
const connections = new Map<string, Database>();

/** 打开（或复用）监狱内数据库连接；父目录缺失 → E_NOT_FOUND，sqlite 报错 → E_SQL */
async function getConnection(dbPath: string): Promise<{ db: Database; abs: string }> {
  const abs = await jail.resolve(dbPath);
  const cached = connections.get(abs);
  if (cached !== undefined) {
    try {
      cached.query("SELECT 1").get(); // 活性检查：已关闭句柄在此抛错 → 重开
      return { db: cached, abs };
    } catch {
      connections.delete(abs); // 已关闭/失效 → 重开
    }
  }
  const parentStat = await stat(dirname(abs)).catch(() => undefined);
  if (parentStat === undefined || !parentStat.isDirectory()) {
    throw new ToolError("E_NOT_FOUND", `database directory ${JSON.stringify(dirname(dbPath))} does not exist`);
  }
  try {
    const db = new Database(abs);
    connections.set(abs, db);
    return { db, abs };
  } catch (error) {
    throw new ToolError("E_SQL", error instanceof Error ? error.message : String(error));
  }
}

/** 只读语句守卫：query 工具仅放行 SELECT/PRAGMA/EXPLAIN/WITH（写操作请用 sqlite.exec） */
function assertReadOnly(sql: string): void {
  const head = sql.trimStart().slice(0, 12).toLowerCase();
  if (!(head.startsWith("select") || head.startsWith("pragma") || head.startsWith("explain") || head.startsWith("with"))) {
    throw new ToolError("E_SQL", "sqlite.query is read-only (SELECT/PRAGMA/EXPLAIN/WITH); use sqlite.exec for writes");
  }
}

/** 表标识符守卫（PRAGMA 无法参数化） */
function assertIdentifier(table: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new ToolError("E_ARGS", `invalid table identifier: ${JSON.stringify(table)}`);
  }
}

const dbPathSchema = z.string().describe("sqlite database file path, relative to jail root or absolute inside roots");
const MAX_QUERY_ROWS = 100;

const tools = [
  defineTool(
    "sqlite.exec",
    "Execute write statements (INSERT/UPDATE/DELETE/DDL; multi-statement strings allowed) with .run(); returns changes + lastInsertRowid.",
    z.object({
      db: dbPathSchema,
      sql: z.string().min(1).describe("SQL to execute (single or multiple statements)"),
    }),
    async ({ db, sql }) => {
      const { db: conn } = await getConnection(db);
      try {
        const result = conn.run(sql);
        return ok({
          changes: result.changes,
          lastInsertRowid:
            typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : result.lastInsertRowid,
        });
      } catch (error) {
        return err(`E_SQL: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  ),
  defineTool(
    "sqlite.query",
    "Run a read-only SELECT/PRAGMA/EXPLAIN/WITH with optional positional params; returns columns + rows (capped at 100, truncated flag).",
    z.object({
      db: dbPathSchema,
      sql: z.string().min(1).describe("SELECT/PRAGMA/EXPLAIN/WITH statement"),
      params: z.array(z.union([z.string(), z.number()]).nullable())
        .describe("positional bind params (?) in order; entries are string | number | null").optional(),
    }),
    async ({ db, sql, params }) => {
      try {
        assertReadOnly(sql);
      } catch (error) {
        return err(error instanceof ToolError ? error.message : `E_SQL: ${String(error)}`);
      }
      const { db: conn } = await getConnection(db);
      try {
        const stmt = conn.query(sql); // prepare（语法/表名错误在此抛出）
        const rows = (params !== undefined && params.length > 0 ? stmt.all(...params) : stmt.all()) as object[];
        const columns = [...(stmt.columnNames ?? [])] as string[];
        return ok({
          columns,
          rows: rows.slice(0, MAX_QUERY_ROWS),
          rowCount: rows.length,
          truncated: rows.length > MAX_QUERY_ROWS,
        });
      } catch (error) {
        return err(`E_SQL: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  ),
  defineTool(
    "sqlite.tables",
    "List tables/views in the database from sqlite_master (internal sqlite_* entries skipped).",
    z.object({ db: dbPathSchema }),
    async ({ db }) => {
      const { db: conn } = await getConnection(db);
      try {
        const rows = conn
          .query("SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
          .all() as Array<{ name: string; type: string; sql: string | null }>;
        return ok({ tables: rows, total: rows.length });
      } catch (error) {
        return err(`E_SQL: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  ),
  defineTool(
    "sqlite.schema",
    "Describe one table: its CREATE statement plus PRAGMA table_info columns (name/type/notnull/default/pk).",
    z.object({
      db: dbPathSchema,
      table: z.string().describe("table name (identifier chars only)"),
    }),
    async ({ db, table }) => {
      try {
        assertIdentifier(table);
      } catch (error) {
        return err(error instanceof ToolError ? error.message : `E_ARGS: ${String(error)}`);
      }
      const { db: conn } = await getConnection(db);
      try {
        const row = conn
          .query("SELECT sql, type FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
          .get(table) as { sql: string | null; type: string } | null;
        if (row === null) {
          return err(`E_NOT_FOUND: table ${JSON.stringify(table)} does not exist (see sqlite.tables)`);
        }
        const columns = (conn.query(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>).map((c) => ({
          name: c.name,
          type: c.type,
          notnull: c.notnull === 1,
          ...(c.dflt_value !== null ? { default: c.dflt_value } : {}),
          primaryKey: c.pk > 0,
        }));
        return ok({ table, type: row.type, sql: row.sql ?? undefined, columns });
      } catch (error) {
        return err(`E_SQL: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  ),
  defineTool(
    "sqlite.close",
    "Close a database connection and evict it from the cache (a later exec/query reopens it fresh).",
    z.object({ db: dbPathSchema }),
    async ({ db }) => {
      const abs = await jail.resolve(db);
      const conn = connections.get(abs);
      if (conn === undefined) {
        return err(`E_DB: no open connection for ${JSON.stringify(db)} (already closed or never opened)`);
      }
      connections.delete(abs);
      try {
        conn.close();
      } catch (error) {
        return err(`E_SQL: ${error instanceof Error ? error.message : String(error)}`);
      }
      return ok({ closed: true, db: abs, openConnections: connections.size });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-sqlite", serverVersion: "0.1.0" });
