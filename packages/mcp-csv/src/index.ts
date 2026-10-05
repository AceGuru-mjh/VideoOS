// @videoos/mcp-csv —— CSV 工具服务器（stdio MCP）：parse/stringify/filter/tojson，纯文本处理零落盘。
// 关键设计：手写 RFC 4180 风格解析器——"" 转义、字段内换行、\r\n 与 \n 行尾、空行忽略；
// rows 输出恒 ≤200 条并附 truncated 标记；数值列 gt/lt 自动 Number 比较；tojson 行对象化（≤200 行）。
import { defineTool, byteLength, ok, runStdioServer, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";

const ROW_CAP = 200; // parse/tojson 的 rows 上限
const FILTER_CAP = 500; // filter 的 rows 上限
const MAX_TEXT_BYTES = 2 * 1_048_576; // text 入参上限
const MAX_ROWS_INPUT = 5_000; // stringify 的 rows 入参上限

/**
 * 解析 CSV：状态机逐字符扫描。
 * - 引号字段："" → 字面 "，字段内可含分隔符与换行；收尾引号后到分隔符/行尾之间的字符并入字段（宽容模式）
 * - 行尾：\r\n、\n、\r 都接受；完全空白的行（单列空串）忽略
 */
function parseCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let i = 0;
  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    if (!(row.length === 1 && row[0] === "")) records.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i++; // 开引号
      for (;;) {
        if (i >= text.length) break; // 未闭合：宽容收尾
        const q = text[i];
        if (q === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++; // 收尾引号
          break;
        }
        field += q;
        i++;
      }
      continue;
    }
    if (c === delimiter) {
      endField();
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    if (c === "\r") {
      endRow();
      i++;
      if (text[i] === "\n") i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) endRow(); // 末行无换行符的情况
  return records;
}

/** 字段按需加引号：含分隔符/引号/换行才加，引号转义为 "" */
function quoteField(field: string, delimiter: string): string {
  return field.includes(delimiter) || field.includes('"') || field.includes("\n") || field.includes("\r")
    ? `"${field.replace(/"/g, '""')}"`
    : field;
}

function assertDelimiter(delimiter: string): void {
  if (delimiter === '"') {
    throw new ToolError("E_ARGS", 'delimiter must not be the quote character (")');
  }
}

function assertSize(text: string): void {
  if (byteLength(text) > MAX_TEXT_BYTES) {
    throw new ToolError("E_SIZE", `input exceeds ${MAX_TEXT_BYTES} bytes; process in smaller chunks`);
  }
}

/** parse/filter/tojson 共用的拆分：表头列名 + 数据行 */
function splitRecords(records: string[][], hasHeader: boolean): { columns: string[]; dataRows: string[][] } {
  if (!hasHeader) return { columns: [], dataRows: records };
  const [head, ...rest] = records;
  return { columns: head ?? [], dataRows: rest };
}

const tools = [
  defineTool(
    "csv.parse",
    "Parse CSV text into rows (handles \"\" quote escaping and newlines inside quoted fields); first record is used as columns by default.",
    z.object({
      text: z.string().describe("CSV text"),
      delimiter: z.string().min(1).max(1).default(",").describe("field delimiter (single character, default \",\")"),
      hasHeader: z.boolean().default(true).describe("treat the first record as a header row (default true)"),
    }),
    ({ text, delimiter, hasHeader }) => {
      assertDelimiter(delimiter);
      assertSize(text);
      const { columns, dataRows } = splitRecords(parseCsv(text, delimiter), hasHeader);
      return ok({
        ...(hasHeader ? { columns } : {}),
        rows: dataRows.slice(0, ROW_CAP),
        rowCount: dataRows.length,
        truncated: dataRows.length > ROW_CAP,
      });
    },
  ),

  defineTool(
    "csv.stringify",
    "Build CSV text from rows (optional header), quoting only fields that contain the delimiter, quotes or newlines.",
    z.object({
      rows: z.array(z.array(z.string())).max(MAX_ROWS_INPUT).describe("data rows as arrays of cell strings"),
      columns: z.array(z.string()).optional().describe("optional header row written before rows"),
      delimiter: z.string().min(1).max(1).default(",").describe("field delimiter (single character, default \",\")"),
    }),
    ({ rows, columns, delimiter }) => {
      assertDelimiter(delimiter);
      const line = (cells: string[]): string => cells.map((cell) => quoteField(cell, delimiter)).join(delimiter);
      const lines = [...(columns !== undefined ? [line(columns)] : []), ...rows.map(line)];
      const text = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
      if (byteLength(text) > MAX_TEXT_BYTES) {
        throw new ToolError("E_SIZE", `output would exceed ${MAX_TEXT_BYTES} bytes; split the rows`);
      }
      return ok({ text, rowCount: rows.length });
    },
  ),

  defineTool(
    "csv.filter",
    "Filter CSV rows where a column matches (equals/contains/gt/lt); gt/lt compare numerically when both sides are numbers.",
    z.object({
      text: z.string().describe("CSV text (with a header row by default)"),
      column: z.string().describe("column name (or 0-based index when hasHeader is false)"),
      op: z.enum(["equals", "contains", "gt", "lt"]).describe("comparison operator (gt/lt compare numerically)"),
      value: z.string().describe('comparison value, e.g. "20" or "alice"'),
      delimiter: z.string().min(1).max(1).default(",").describe("field delimiter (single character, default \",\")"),
      hasHeader: z.boolean().default(true).describe("whether the first record is a header row (default true)"),
    }),
    ({ text, column, op, value, delimiter, hasHeader }) => {
      assertDelimiter(delimiter);
      assertSize(text);
      const { columns, dataRows } = splitRecords(parseCsv(text, delimiter), hasHeader);
      let colIndex = -1;
      if (hasHeader) {
        colIndex = columns.findIndex((name) => name === column);
        if (colIndex === -1 && /^\d+$/.test(column)) {
          const n = Number.parseInt(column, 10);
          if (n >= 0 && n < columns.length) colIndex = n;
        }
        if (colIndex === -1) {
          throw new ToolError(
            "E_COLUMN",
            `unknown column ${JSON.stringify(column)} (available: ${columns.map((c) => JSON.stringify(c)).join(", ") || "none"})`,
          );
        }
      } else {
        if (!/^\d+$/.test(column)) {
          throw new ToolError("E_COLUMN", `without a header row, column must be a 0-based index (got ${JSON.stringify(column)})`);
        }
        colIndex = Number.parseInt(column, 10);
      }
      const numericValue = op === "gt" || op === "lt" ? Number(value) : undefined;
      if (numericValue !== undefined && !Number.isFinite(numericValue)) {
        throw new ToolError("E_ARGS", `op "${op}" needs a numeric value (got ${JSON.stringify(value)})`);
      }
      const matched: string[][] = [];
      for (const row of dataRows) {
        const cell = row[colIndex] ?? "";
        if (op === "equals") {
          if (cell === value) matched.push(row);
        } else if (op === "contains") {
          if (cell.includes(value)) matched.push(row);
        } else {
          const cellNum = Number(cell);
          if (Number.isFinite(cellNum) && numericValue !== undefined) {
            if ((op === "gt" && cellNum > numericValue) || (op === "lt" && cellNum < numericValue)) matched.push(row);
          }
          // 非数值单元格不参与 gt/lt（跳过）
        }
      }
      return ok({
        ...(hasHeader ? { columns } : {}),
        rows: matched.slice(0, FILTER_CAP),
        rowCount: matched.length,
        truncated: matched.length > FILTER_CAP,
      });
    },
  ),

  defineTool(
    "csv.tojson",
    "Convert CSV text into an array of row objects keyed by the header (column \"0\",\"1\",... when hasHeader is false).",
    z.object({
      text: z.string().describe("CSV text"),
      delimiter: z.string().min(1).max(1).default(",").describe("field delimiter (single character, default \",\")"),
      hasHeader: z.boolean().default(true).describe("whether the first record is a header row (default true)"),
    }),
    ({ text, delimiter, hasHeader }) => {
      assertDelimiter(delimiter);
      assertSize(text);
      const { columns, dataRows } = splitRecords(parseCsv(text, delimiter), hasHeader);
      const width = Math.max(0, ...dataRows.map((r) => r.length));
      // hasHeader → 用表头作键；否则生成 "0","1",... 按最宽行
      const keys = hasHeader
        ? columns
        : Array.from({ length: width }, (_, i) => String(i));
      const objects = dataRows
        .slice(0, ROW_CAP)
        .map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i] ?? ""])));
      return ok({ columns: keys, rows: objects, rowCount: dataRows.length, truncated: dataRows.length > ROW_CAP });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-csv", serverVersion: "0.1.0" });
