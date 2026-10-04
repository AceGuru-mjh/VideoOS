// parseManifest / ManifestSchema 契约测试
import { describe, expect, test } from "bun:test";
import { DEFAULT_ENTRY, ManifestSchema, WorkspaceError, parseManifest } from "./index";

function expectManifestError(raw: unknown, hint?: string): WorkspaceError {
  try {
    parseManifest(raw);
    throw new Error(`expected parseManifest to throw${hint === undefined ? "" : ` (${hint})`}`);
  } catch (err) {
    if (!(err instanceof WorkspaceError)) throw err;
    expect(err.code).toBe("WORKSPACE_MANIFEST_INVALID");
    expect(err.message).toContain("WORKSPACE_MANIFEST_INVALID"); // message 带 code 前缀（toThrow 兼容）
    return err;
  }
}

describe("parseManifest", () => {
  test("minimal manifest: entry falls back to default", () => {
    const manifest = parseManifest({ name: "launch-video" });
    expect(manifest.name).toBe("launch-video");
    expect(manifest.entry).toBe("src/video.ts");
    expect(DEFAULT_ENTRY).toBe("src/video.ts");
  });

  test("entry: undefined explicitly falls back to default", () => {
    const manifest = parseManifest({ name: "x", entry: undefined });
    expect(manifest.entry).toBe("src/video.ts");
  });

  test("explicit entry preserved", () => {
    expect(parseManifest({ name: "x", entry: "src/main.ts" }).entry).toBe("src/main.ts");
  });

  test("full manifest: all sections preserved", () => {
    const manifest = parseManifest({
      name: "launch-video",
      entry: "src/video.ts",
      engines: { videoos: "^0.2" },
      render: { defaultBackend: "svg", encoder: "ffmpeg" },
      agent: { autonomous: false, maxRepairLoops: 5 },
    });
    expect(manifest.engines).toEqual({ videoos: "^0.2" });
    expect(manifest.render).toEqual({ defaultBackend: "svg", encoder: "ffmpeg" });
    expect(manifest.agent).toEqual({ autonomous: false, maxRepairLoops: 5 });
  });

  test("empty nested sections allowed (all keys optional)", () => {
    const manifest = parseManifest({ name: "x", engines: {}, render: {}, agent: {} });
    expect(manifest.engines).toEqual({});
    expect(manifest.render).toEqual({});
    expect(manifest.agent).toEqual({});
  });

  test("unknown fields tolerated (loose schema, top level and nested)", () => {
    const manifest = parseManifest({
      name: "x",
      future: { nested: true },
      engines: { videoos: "^0.1", extra: "kept" },
    });
    const loose = manifest as unknown as Record<string, unknown>;
    expect(loose.future).toEqual({ nested: true });
    expect((loose.engines as Record<string, unknown>).extra).toBe("kept");
  });

  test("invalid inputs throw WORKSPACE_MANIFEST_INVALID with issue details", () => {
    for (const [raw, hint] of [
      [null, "null"],
      ["string", "string"],
      [42, "number"],
      [[], "array"],
      [{}, "missing name"],
      [{ name: "" }, "empty name"],
      [{ name: 42 }, "name type"],
      [{ name: "x", entry: "" }, "empty entry"],
      [{ name: "x", entry: 42 }, "entry type"],
      [{ name: "x", entry: "src/video.ts", engines: { videoos: "" } }, "empty engines.videoos"],
      [{ name: "x", render: { defaultBackend: 7 } }, "render.defaultBackend type"],
      [{ name: "x", agent: { autonomous: "yes" } }, "agent.autonomous type"],
      [{ name: "x", agent: { maxRepairLoops: "3" } }, "agent.maxRepairLoops type"],
      [{ name: "x", agent: { maxRepairLoops: -1 } }, "agent.maxRepairLoops negative"],
    ] as [unknown, string][]) {
      const err = expectManifestError(raw, hint);
      expect(err instanceof WorkspaceError).toBe(true);
    }
  });
});

describe("ManifestSchema", () => {
  test("safeParse accepts a valid manifest", () => {
    const result = ManifestSchema.safeParse({ name: "x", entry: "src/video.ts" });
    expect(result.success).toBe(true);
  });

  test("safeParse rejects a manifest missing required fields", () => {
    const result = ManifestSchema.safeParse({ entry: "src/video.ts" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "name")).toBe(true);
    }
  });
});
