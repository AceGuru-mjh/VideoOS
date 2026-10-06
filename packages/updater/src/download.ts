// 流式下载：fetch → node:fs WriteStream（分块落盘 + onProgress 进度回调）。
// 全局 fetch（bun / node18+ / electron 均内建），零第三方依赖；fetchImpl 可注入（测试离线）。
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { UpdaterError } from "./provider";
import type { FetchLike } from "./provider";

export interface DownloadOptions {
  fetchImpl?: FetchLike;
  /** 进度回调：received 累计字节；total 为 0 表示服务器未给 content-length */
  onProgress?: (received: number, total: number) => void;
}

/** 下载 url 到 destPath（覆盖写）；返回落盘字节数 */
export async function downloadFile(url: string, destPath: string, opts: DownloadOptions = {}): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET" });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new UpdaterError("NETWORK", `下载失败（${url}）：${reason}。请检查网络后重试`);
  }
  if (!res.ok) {
    throw new UpdaterError("DOWNLOAD_HTTP", `下载失败：HTTP ${String(res.status)}（${url}）`);
  }
  await mkdir(dirname(destPath), { recursive: true });

  const total = Number(res.headers.get("content-length") ?? 0);
  const stream = createWriteStream(destPath);
  let received = 0;
  try {
    if (res.body !== null) {
      // ReadableStream 逐块读取（bun 与 node 行为一致）；不整读进内存 —— 产物可达上百 MB
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done === true) break;
        if (value === undefined) continue;
        received += value.byteLength;
        if (!stream.write(value)) {
          // 背压：等 drain，避免大文件把内存写爆
          await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
        }
        opts.onProgress?.(received, total);
      }
    } else {
      // 兜底：无 body 流（某些注入实现）→ 整读 arrayBuffer
      const buf = await res.arrayBuffer();
      received = buf.byteLength;
      stream.write(Buffer.from(buf));
      opts.onProgress?.(received, received);
    }
  } finally {
    await new Promise<void>((resolve) => stream.end(resolve));
  }
  return received;
}
