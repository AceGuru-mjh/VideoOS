# starter — the reference VideoOS plugin

`starter` shows every manifest field, one tool, and event subscriptions. Copy this folder (rename the directory **and** `id`) to bootstrap a new plugin. See `plugins/README.md` for the full runtime contract.

## Manifest fields (plugin.json)

| field | meaning |
|---|---|
| `id` | kebab-case, **must equal the directory name** (`starter`). Tool names are namespaced under it. |
| `name` | human display name (any casing). |
| `version` | `x.y.z` semver of the plugin itself. |
| `description` | one line, ≤ 200 chars — what the plugin provides. |
| `apiVersion` | plugin API contract version; must be exactly `"0.1"`. |
| `permissions` | capability allowlist: `fs:read`, `fs:write`, `events`, `tools`. `ctx.registerTool` requires `tools`; `ctx.on`/`ctx.emit` require `events`; `ctx.fs` requires `fs:read`/`fs:write`. |
| `provides.tools` | full names `"<id>.<name>"` of tools this plugin intends to register (documentation + discovery; runtime still enforces the `<id>.` prefix). |
| `provides.hooks` | events (≤ 10) this plugin may subscribe to **or** emit — `ctx.on`/`ctx.emit` reject anything else. |
| `entry` | always `"index.ts"` (relative to the plugin directory). |
| `config` | optional default config object; surfaced to the plugin as a deep copy via `ctx.config`. |

## Entry contract (index.ts)

```ts
import type { PluginContext } from "@videoos/plugin-kit";

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "my-plugin.my-tool",        // must start with "<id>."
    description: "what it does",
    schema: ctx.z.object({ who: ctx.z.string().default("world") }), // zod comes from ctx.z
    run: ({ who }) => ({ ok: true, data: { hello: who } }),
  });
}

export function deactivate(): void {} // optional, called in reverse start order on host.stop()
```

Only two import kinds are allowed: `import type { … } from "@videoos/plugin-kit"` and `import … from "node:*"`. Runtime package imports (zod included) will not resolve — take zod from `ctx.z`.

## Try it

```bash
bun test packages/plugin-kit   # loads plugins/ and calls starter.hello
```
