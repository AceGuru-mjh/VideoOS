// @videoos/mcp-os — 系统信息 MCP 服务器（Issue #33）。无路径监狱（只读系统信息 + 白名单 env）。
// 隐私基线：os.info 只输出 SPEC 列出的字段（不含用户名/家目录/userInfo 等任何用户身份信息）；
//           os.env 白名单读取（最多 50 个键），敏感键名（KEY/TOKEN/SECRET/PASSWORD，不区分大小写）掩码为 ***。
import { statfs } from "node:fs/promises";
import { arch, cpus, freemem, hostname, platform, release, totalmem } from "node:os";
import { defineTool, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// os.info — 系统信息（白名单字段，无隐私）
// ---------------------------------------------------------------------------

const infoTool = defineTool({
  name: "os.info",
  description: "系统信息：platform/release/arch/hostname/CPU 数量与型号/内存总量与可用（刻意排除用户名、家目录等隐私字段）",
  schema: z.object({}),
  call: () => {
    const cpuList = cpus();
    return {
      ok: true,
      data: {
        platform: platform(),
        release: release(),
        arch: arch(),
        hostname: hostname(),
        cpuCount: cpuList.length,
        cpuModel: cpuList.length > 0 ? cpuList[0].model : "unknown",
        memTotalBytes: totalmem(),
        memFreeBytes: freemem(),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// os.disk — 文件系统用量（statfs）
// ---------------------------------------------------------------------------

const diskTool = defineTool({
  name: "os.disk",
  description: "文件系统用量（statfs）：totalBytes/freeBytes/availableBytes；path 缺省为进程 cwd。平台不支持时返回 ok:false 而非崩溃",
  schema: z.object({ path: z.string().min(1).optional() }),
  call: async (args) => {
    const target = args.path ?? process.cwd();
    try {
      const st = await statfs(target);
      const totalBytes = st.blocks * st.bsize;
      const freeBytes = st.bfree * st.bsize;
      const availableBytes = st.bavail * st.bsize;
      return { ok: true, data: { path: target, totalBytes, freeBytes, availableBytes } };
    } catch (err) {
      return { ok: false, error: `statfs failed for ${target}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ---------------------------------------------------------------------------
// os.env — 白名单读取环境变量（敏感键掩码）
// ---------------------------------------------------------------------------

/** 敏感键名判定：键名含 KEY/TOKEN/SECRET/PASSWORD（不区分大小写）→ 值掩码 *** */
const SENSITIVE_KEY = /KEY|TOKEN|SECRET|PASSWORD/i;

const envTool = defineTool({
  name: "os.env",
  description: "按白名单读取环境变量（1..50 个键；只返回请求且已设置的键；敏感键名的值掩码为 ***）",
  schema: z.object({ keys: z.array(z.string().min(1)).min(1).max(50) }),
  call: (args) => {
    const values: Record<string, string> = {};
    for (const key of args.keys) {
      const value = process.env[key];
      if (value === undefined) continue; // 未设置的键直接省略（白名单语义）
      values[key] = SENSITIVE_KEY.test(key) ? "***" : value;
    }
    return { ok: true, data: values };
  },
});

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

await runStdioServer([infoTool, diskTool, envTool], { serverName: "mcp-os", serverVersion: "0.1.0" });
