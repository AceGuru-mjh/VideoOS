// VIR 三图构建：temporal（场景时序）/ spatial（场景→图层）/ dependency（scene→layer→asset）
import type { VirAssetRef, VirGraphs, VirScene } from "@videoos/vir";

export function buildGraphs(scenes: readonly VirScene[], assets: readonly VirAssetRef[]): VirGraphs {
  const temporal: VirGraphs["temporal"] = {
    nodes: scenes.map((s) => ({ id: s.id, kind: "scene" as const, start: s.start, end: s.start + s.duration })),
    edges: scenes.slice(1).map((s, i) => ({ from: scenes[i]!.id, to: s.id })),
  };
  const spatial: VirGraphs["spatial"] = {
    roots: Object.fromEntries(scenes.map((s) => [s.id, s.layers.map((l) => l.id)])),
  };
  // dependency 约定：edge (from → to) 表示 from 依赖 to；scene→layer（包含）、layer→asset（uses）
  const nodes: VirGraphs["dependency"]["nodes"] = [];
  const edges: VirGraphs["dependency"]["edges"] = [];
  for (const scene of scenes) {
    nodes.push({ id: scene.id, kind: "scene" });
    for (const layer of scene.layers) {
      nodes.push({ id: layer.id, kind: "layer" });
      edges.push({ from: scene.id, to: layer.id });
    }
    for (const layer of scene.layers) {
      for (const use of layer.uses) edges.push({ from: layer.id, to: use });
    }
  }
  for (const asset of assets) {
    nodes.push({ id: asset.id, kind: "asset" });
  }
  return { temporal, spatial, dependency: { nodes, edges } };
}
