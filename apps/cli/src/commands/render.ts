// videoos render：ctx.renderFinal（scene/codec/crf/preset/output 透传）+ 进度条（\r 百分比）+ 汇总
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Option } from "commander";
import type { Command } from "commander";
import type { VideoCodec } from "@videoos/encode";
import { EncodeError } from "@videoos/encode";
import { color, ctxFor, fail, formatDuration, isInteractive, openProject, resolveProjectRoot, withProjectOption } from "../util";

export function registerRenderCommand(program: Command): void {
  withProjectOption(
    program
      .command("render")
      .description("渲染最终视频（逐帧 canvas → 帧缓存 → ffmpeg 编码 MP4/WebM）")
      .option("--scene <name>", "只渲染该场景（缺省全片）")
      .addOption(new Option("--codec <codec>", "视频编码").choices(["h264", "vp9"]).default("h264"))
      .option("--crf <number>", "恒定质量（0-51，越小质量越高）", "18")
      .option("--preset <preset>", "ffmpeg 编码速度预设", "medium")
      .option("--output <path>", "输出文件路径（缺省 .video/renders/render-<hash>.mp4）"),
  ).action(async (opts: { project?: string; scene?: string; codec: string; crf: string; preset: string; output?: string }) => {
    const project = await openProject(resolveProjectRoot(opts.project));
    if (project === null) return;

    const crf = Number.parseInt(opts.crf, 10);
    if (!Number.isInteger(crf) || crf < 0 || crf > 51) {
      fail(`--crf 需为 0-51 的整数，got ${JSON.stringify(opts.crf)}`);
      return;
    }
    const codec = opts.codec as VideoCodec;

    const ctx = await ctxFor(project);
    const startedAt = Date.now();
    const showProgress = isInteractive && process.stderr.isTTY === true;

    const renderProgress = (p: { phase: string; frame: number; totalFrames: number }): void => {
      if (!showProgress) return;
      const pct = p.totalFrames > 0 ? Math.floor((p.frame / p.totalFrames) * 100) : 100;
      const label = p.phase === "render" ? "渲染" : p.phase === "encode" ? "编码" : "准备";
      process.stderr.write(`\r${label}中 ${pct}%（${p.frame + 1}/${p.totalFrames} 帧）`);
    };

    try {
      const result = await ctx.renderFinal({
        ...(opts.scene !== undefined ? { scene: opts.scene } : {}),
        encoder: { codec, crf, preset: opts.preset },
        onProgress: renderProgress,
      });
      if (showProgress) process.stderr.write("\n");

      let videoPath = result.video;
      if (opts.output !== undefined) {
        const target = resolve(opts.output);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(result.video, target);
        videoPath = target;
      }

      console.log(color.green(`✔ 渲染完成${opts.scene !== undefined ? `（场景 ${opts.scene}）` : ""}`));
      console.log(`  视频    ${videoPath}`);
      console.log(`  帧数    ${result.frames}（${result.durationSeconds.toFixed(2)}s @ ${codec}）`);
      console.log(color.gray(`  缓存    命中 ${result.cacheHits} / 未命中 ${result.cacheMisses}`));
      console.log(color.gray(`  耗时    ${formatDuration(Date.now() - startedAt)}`));
    } catch (err) {
      if (showProgress) process.stderr.write("\n");
      if (err instanceof EncodeError && err.code === "ENCODE_FFMPEG_NOT_FOUND") {
        fail(`${err.message}；运行 videoos doctor 检查环境`);
      } else if (err instanceof EncodeError && err.code === "ENCODE_SCENE_NOT_FOUND") {
        fail(err.message);
      } else if (err instanceof EncodeError) {
        fail(err.message);
      } else {
        fail(`渲染失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
}
