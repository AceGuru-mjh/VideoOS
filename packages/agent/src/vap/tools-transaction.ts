// Transaction 工具：transaction.begin / commit / rollback / list（SPEC §7.3）
// commit/rollback 作用于「最近一次 begin 且仍 active」的事务（工具层在 VapSession 上跟踪 currentTransaction）。
import { z } from "zod";
import { asVapSession } from "../session";
import type { VapContext } from "../session";
import type { VapTool, VapToolArgs, VapToolResult } from "./registry";

export function createTransactionTools(): VapTool[] {
  const begin: VapTool = {
    name: "transaction.begin",
    description: "开启工作区事务（快照受控文件）。修改项目前调用；测试失败 rollback 恢复，全部通过 commit 固化",
    schema: z.object({
      description: z.string().optional().describe("事务描述（做了什么修改）"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const description = args.description !== undefined ? String(args.description) : undefined;
      const handle = await session.workspace.transactions.begin(description);
      session.currentTransaction = handle;
      ctx.events.emit({ kind: "transaction", detail: { action: "begin", id: handle.id, description } });
      return { ok: true, data: { id: handle.id, description, status: handle.status, note: "当前事务已设为该事务（commit/rollback 作用于它）" } };
    },
  };

  const commit: VapTool = {
    name: "transaction.commit",
    description: "提交当前事务（保留快照可 diff）；作用于最近一次 begin 且仍 active 的事务",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const tx = session.currentTransaction;
      if (tx === null || tx.status !== "active") {
        return { ok: false, error: `NO_ACTIVE_TRANSACTION: ${tx === null ? "尚未 transaction.begin" : `事务 ${tx.id} 已 ${tx.status}`}` };
      }
      try {
        await tx.commit();
      } catch (err) {
        return { ok: false, error: `COMMIT_FAILED: ${(err as Error).message}` };
      }
      ctx.events.emit({ kind: "transaction", detail: { action: "commit", id: tx.id } });
      return { ok: true, data: { id: tx.id, status: tx.status } };
    },
  };

  const rollback: VapTool = {
    name: "transaction.rollback",
    description: "回滚当前事务（原子恢复快照内全部文件；begin 之后的新增文件一并移除）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const tx = session.currentTransaction;
      if (tx === null || tx.status !== "active") {
        return { ok: false, error: `NO_ACTIVE_TRANSACTION: ${tx === null ? "尚未 transaction.begin" : `事务 ${tx.id} 已 ${tx.status}`}` };
      }
      try {
        await tx.rollback();
      } catch (err) {
        return { ok: false, error: `ROLLBACK_FAILED: ${(err as Error).message}` };
      }
      // 回滚后源码回到旧版本 → 重新编译刷新世界模型
      try {
        await session.compile();
      } catch {
        // 编译失败（例如回滚到本来就编不过的状态）不掩盖回滚成功事实
      }
      ctx.events.emit({ kind: "transaction", detail: { action: "rollback", id: tx.id } });
      return { ok: true, data: { id: tx.id, status: tx.status, recompiled: session.lastCompile !== null } };
    },
  };

  const list: VapTool = {
    name: "transaction.list",
    description: "事务历史列表（id/description/status，由 workspace 层维护）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const transactions = await session.workspace.transactions.list();
      return { ok: true, data: { transactions, count: transactions.length } };
    },
  };

  return [begin, commit, rollback, list];
}
