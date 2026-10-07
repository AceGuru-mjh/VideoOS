// sha256 校验测试：checksums 解析（sha256sum 格式各变体）+ 文件哈希 + verifyAsset
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChecksums, sha256File, verifyAsset } from "./verify";

const TMP = mkdtempSync(join(tmpdir(), "videoos-verify-"));
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("parseChecksums", () => {
  test("标准 sha256sum 格式：hash 双空格 + 文件名", () => {
    const map = parseChecksums(
      "a".repeat(64) + "  videoos-linux-x64.tar.gz\n" + "b".repeat(64) + "  videoos-darwin-arm64.tar.gz\n",
    );
    expect(map.get("videoos-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(map.get("videoos-darwin-arm64.tar.gz")).toBe("b".repeat(64));
  });

  test("单空格 / tab 分隔与 `*` 二进制标记", () => {
    const map = parseChecksums("c".repeat(64) + " *videoos-windows-x64.zip\n" + "d".repeat(64) + "\tvideoos.exe\n");
    expect(map.get("videoos-windows-x64.zip")).toBe("c".repeat(64));
    expect(map.get("videoos.exe")).toBe("d".repeat(64));
  });

  test("CRLF / 空行 / # 注释 / 非法行（跳过不抛）", () => {
    const text = [
      "# VideoOS v0.3.1 checksums",
      "",
      "e".repeat(64) + "  videoos-linux-x64.tar.gz",
      "not-a-checksum-line",
      "zz".repeat(32) + "  bad-hash.swp",
      "f".repeat(63) + "  short-hash.bin",
    ].join("\r\n");
    const map = parseChecksums(text);
    expect(map.size).toBe(1);
    expect(map.get("videoos-linux-x64.tar.gz")).toBe("e".repeat(64));
  });

  test("大写 hex 归一为小写", () => {
    const upper = "A".repeat(64);
    expect(parseChecksums(`${upper}  videoos.tar.gz`).get("videoos.tar.gz")).toBe("a".repeat(64));
  });
});

describe("sha256File / verifyAsset", () => {
  const content = "fake videoos binary payload — deterministic";
  const file = join(TMP, "videoos");
  writeFileSync(file, content, "utf8");
  const expected = createHash("sha256").update(content).digest("hex");

  test("sha256File 与 node:crypto 一致", async () => {
    expect(await sha256File(file)).toBe(expected);
  });

  test("verifyAsset：匹配（含 `<hash>  <name>` 复合格式）/ 大小写不敏感", async () => {
    expect(await verifyAsset(file, expected)).toBe(true);
    expect(await verifyAsset(file, expected.toUpperCase())).toBe(true);
    expect(await verifyAsset(file, `${expected}  videoos`)).toBe(true);
  });

  test("verifyAsset：哈希不符 / 格式非法 → false", async () => {
    expect(await verifyAsset(file, "0".repeat(64))).toBe(false);
    expect(await verifyAsset(file, "deadbeef")).toBe(false);
    expect(await verifyAsset(file, "")).toBe(false);
  });
});
