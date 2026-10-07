// 极简类型化事件总线：updater 各阶段进度与结果的外部观察通道。
// 事件语义（OpenCode 式）：
//   update-available —— 检查到新版本（含类型，供上层决定自动装还是只提示）
//   download-progress —— 资产下载中（进度条）
//   downloaded        —— 单个资产下载完成
//   updated           —— 版本切换完成（upgradeTo / rollback）
//   failed            —— 任一阶段失败（phase + 错误消息）
import type { ReleaseType } from "./semver";

export interface UpdaterEventPayloads {
  "update-available": { current: string; latest: string; type: ReleaseType };
  "download-progress": { version: string; received: number; total: number };
  downloaded: { version: string; name: string; bytes: number };
  updated: { from: string; to: string };
  failed: { phase: string; error: string };
}

export type UpdaterEventName = keyof UpdaterEventPayloads;
export type UpdaterHandler<K extends UpdaterEventName> = (payload: UpdaterEventPayloads[K]) => void;

/** 订阅记录：保留原 handler 引用以支持 off() */
interface Subscription {
  original: UpdaterHandler<UpdaterEventName>;
  wrapped: (payload: unknown) => void;
}

export class UpdaterEmitter {
  private readonly handlers = new Map<UpdaterEventName, Set<Subscription>>();

  /** 订阅事件；返回 this 以便链式 */
  on<K extends UpdaterEventName>(event: K, handler: UpdaterHandler<K>): this {
    let set = this.handlers.get(event);
    if (set === undefined) {
      set = new Set<Subscription>();
      this.handlers.set(event, set);
    }
    const sub: Subscription = {
      original: handler as UpdaterHandler<UpdaterEventName>,
      wrapped: (payload: unknown) => {
        (handler as (p: unknown) => void)(payload);
      },
    };
    set.add(sub);
    return this;
  }

  /** 退订事件 */
  off<K extends UpdaterEventName>(event: K, handler: UpdaterHandler<K>): this {
    const set = this.handlers.get(event);
    if (set === undefined) return this;
    const target = handler as UpdaterHandler<UpdaterEventName>;
    for (const sub of set) {
      if (sub.original === target) set.delete(sub);
    }
    return this;
  }

  /** 触发事件（内部使用；订阅者异常被吞 —— 不影响更新主流程） */
  protected emit<K extends UpdaterEventName>(event: K, payload: UpdaterEventPayloads[K]): void {
    const set = this.handlers.get(event);
    if (set === undefined) return;
    for (const sub of set) {
      try {
        sub.wrapped(payload as unknown);
      } catch {
        // 订阅者异常不影响更新主流程
      }
    }
  }
}
