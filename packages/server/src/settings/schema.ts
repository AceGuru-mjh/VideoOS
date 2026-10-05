// 设置中心 schema（SPEC v0.2 §5：九大类；zod 单一事实源）。
// ⚠️ 契约冻结：SettingsValues 形状与 DEFAULT_SETTINGS 默认值与 v0.2 前端设置页共享 —— 修改需双向同步。
// 设计说明：zod schema 本身不带 .default()（zod 3.25 的 default 在 .partial()/节缺省场景下行为不一致），
// 默认值集中在 DEFAULT_SETTINGS 字面量，由 store 在加载/合并时补齐（见 store.ts mergeSettings）。
import { z } from "zod";

/** 九大类节名（reset/patch 校验共用） */
export const SETTINGS_SECTION_NAMES = [
  "general",
  "providers",
  "agent",
  "render",
  "mcp",
  "skills",
  "interface",
  "privacy",
  "advanced",
] as const;
export type SettingsSectionName = (typeof SETTINGS_SECTION_NAMES)[number];

// ---------------------------------------------------------------- 节字段定义（无默认值；patch partial 与完整节共用同一形状源）
const generalShape = {
  theme: z.enum([
    "midnight",
    "graphite",
    "amber",
    "forest",
    "rose",
    "sand",
    "paper",
    "daylight",
    "ocean",
    "cyber",
    "coffee",
    "mono",
    "sakura",
    "mint",
    "lavender",
    "ivory",
  ]),
  language: z.enum(["zh", "en"]),
  onboarded: z.boolean(),
  startup: z.enum(["last-session", "new-chat", "wizard"]),
};

// ---------------------------------------------------------------- providers.entries（issue #46：条目类型化；⚠️ settings.json 永不包含 API Key —— 未知键（含 apiKey）由 zod 剥除）
/** Provider 条目 id 规则：小写字母/数字开头，仅小写字母、数字、连字符 */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const ProviderTypeSchema = z.enum(["openai-compatible", "anthropic", "manual"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

const providerIdField = z
  .string()
  .regex(PROVIDER_ID_PATTERN, "id must match /^[a-z0-9][a-z0-9-]*$/（小写字母/数字开头，仅小写字母、数字、连字符）");

const providerEntryShape = {
  id: providerIdField,
  type: ProviderTypeSchema,
  /** 显示名覆盖（缺省用目录/厂商名） */
  label: z.string().optional(),
  /** 完整 base：openai-compatible 含 /v1（如 https://api.openai.com/v1）；anthropic 不含 /v1；manual 可为空串 */
  baseUrl: z.string(),
  model: z.string(),
  /** 缺省 true（创建/读取时归一化为显式值） */
  enabled: z.boolean().optional(),
  vision: z.boolean().optional(),
  /** 缺省 true */
  tools: z.boolean().optional(),
};

/** 非 manual 类型必须提供非空 baseUrl（openai-compatible 需含 /v1 的完整 base；anthropic 需不含 /v1） */
function requireBaseUrl(entry: { type?: unknown; baseUrl?: unknown }, ctx: z.RefinementCtx): void {
  if (entry.type !== undefined && entry.type !== "manual" && typeof entry.baseUrl === "string" && entry.baseUrl.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["baseUrl"],
      message: `baseUrl is required for type "${String(entry.type)}"（openai-compatible 需含 /v1 的完整 base；anthropic 需不含 /v1）`,
    });
  }
}

/** 完整条目（settings.json 存储 + 读回校验） */
export const ProviderEntrySchema = z.object(providerEntryShape).superRefine(requireBaseUrl);
export type ProviderEntry = z.infer<typeof ProviderEntrySchema>;

/** 创建输入：id 可缺省（服务端按 label/type 生成 slug） */
export const ProviderEntryCreateSchema = z
  .object({ ...providerEntryShape, id: providerIdField.optional() })
  .superRefine(requireBaseUrl);
export type ProviderEntryCreate = z.infer<typeof ProviderEntryCreateSchema>;

/** 更新输入：全部字段可选（与现存条目字段级合并后再整体过 ProviderEntrySchema） */
export const ProviderEntryPatchSchema = z.object({
  id: providerIdField.optional(),
  type: ProviderTypeSchema.optional(),
  label: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  enabled: z.boolean().optional(),
  vision: z.boolean().optional(),
  tools: z.boolean().optional(),
});
export type ProviderEntryPatch = z.infer<typeof ProviderEntryPatchSchema>;

const providersShape = {
  entries: z.array(ProviderEntrySchema),
  defaultProvider: z.string().nullable(),
  defaultModel: z.string().nullable(),
};
const agentShape = {
  autonomy: z.enum(["L1", "L2", "L3", "L4"]),
  maxSteps: z.number(),
  toolPermissions: z.record(z.string(), z.enum(["allow", "confirm", "deny"])),
  confirmRender: z.boolean(),
  /** 危险参数模式黑名单（issue #54）：正则，匹配 JSON.stringify(args) → 硬拒绝（优先于一切许可） */
  dangerousPatterns: z.array(z.string()),
};
const renderShape = {
  outDir: z.string(),
  preset: z.enum(["1080p30", "720p30", "vertical-1080x1920"]),
  concurrency: z.number(),
  retries: z.number(),
};
// ---------------------------------------------------------------- mcp.servers（issue #53：条目类型化）
/** MCP 服务器 id 规则：小写字母/数字开头，仅小写字母、数字、连字符（不含下划线 → mcp_<serverId>_<tool> 前缀可逆解析） */
export const MCP_SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const McpServerEntrySchema = z.object({
  id: z.string().regex(MCP_SERVER_ID_PATTERN, "id must match /^[a-z0-9][a-z0-9-]*$/（小写字母/数字开头，仅小写字母、数字、连字符）"),
  /** 显示名（缺省用 id） */
  label: z.string().optional(),
  /** 启动命令（如 "bun" / "npx"；须非空） */
  command: z.string().min(1, "command must be a non-empty string"),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  enabled: z.boolean(),
  /** 工具白名单（空 = 全部放行） */
  whitelist: z.array(z.string()),
  /** 单次 callTool 超时（ms） */
  timeoutMs: z.number().int().min(100).max(600_000),
});
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;

const mcpShape = {
  // 迁移容错（issue #53）：旧数据 mcp.servers 为 unknown[]（可能含历史脏条目）→
  // .catch([]) 整组降级为空数组而非判整个文件损坏；PUT /api/mcp/servers 单独严格校验后再写入
  servers: z.array(McpServerEntrySchema).catch([]),
  mergeTools: z.boolean(),
};
const skillsShape = {
  enabled: z.record(z.string(), z.boolean()),
  autoTrigger: z.boolean(),
  customDir: z.string().nullable(),
};
const interfaceShape = {
  fontSize: z.enum(["sm", "md", "lg"]),
  density: z.enum(["cozy", "compact"]),
  codeTheme: z.enum(["auto", "dark", "light"]),
  motion: z.boolean(),
};
const privacyShape = {
  telemetry: z.boolean(),
  crashReports: z.boolean(),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  logRetentionDays: z.number(),
  sessionRetentionDays: z.number(),
};
const advancedShape = {
  replayWizard: z.boolean(),
};

// ---------------------------------------------------------------- 节 schema（字段必填、未知键剥除 —— 加载/最终校验用）
export const GeneralSettingsSchema = z.object(generalShape);
export const ProvidersSettingsSchema = z.object(providersShape);
export const AgentSettingsSchema = z.object(agentShape);
export const RenderSettingsSchema = z.object(renderShape);
export const McpSettingsSchema = z.object(mcpShape);
export const SkillsSettingsSchema = z.object(skillsShape);
export const InterfaceSettingsSchema = z.object(interfaceShape);
export const PrivacySettingsSchema = z.object(privacyShape);
export const AdvancedSettingsSchema = z.object(advancedShape);

/** 完整设置（九节必填；未知节/未知键剥除 —— 升级兼容：缺节由 store 合并默认值后传入） */
export const SettingsValuesSchema = z.object({
  general: GeneralSettingsSchema,
  providers: ProvidersSettingsSchema,
  agent: AgentSettingsSchema,
  render: RenderSettingsSchema,
  mcp: McpSettingsSchema,
  skills: SkillsSettingsSchema,
  interface: InterfaceSettingsSchema,
  privacy: PrivacySettingsSchema,
  advanced: AdvancedSettingsSchema,
});

/** PUT 全量替换体：九节必须齐全 + 拒绝未知节（不完整替换是数据丢失事故，宁可 400） */
export const SettingsReplaceSchema = SettingsValuesSchema.strict();

/** PATCH 局部更新体：{section: {key: val}}，节可选、节内键可选（缺席即保持现值）+ 拒绝未知节 */
export const SettingsPatchSchema = z
  .object({
    general: GeneralSettingsSchema.partial().optional(),
    providers: ProvidersSettingsSchema.partial().optional(),
    agent: AgentSettingsSchema.partial().optional(),
    render: RenderSettingsSchema.partial().optional(),
    mcp: McpSettingsSchema.partial().optional(),
    skills: SkillsSettingsSchema.partial().optional(),
    interface: InterfaceSettingsSchema.partial().optional(),
    privacy: PrivacySettingsSchema.partial().optional(),
    advanced: AdvancedSettingsSchema.partial().optional(),
  })
  .strict();

/** 默认值（单一事实源；store.test 断言其满足 SettingsValuesSchema 防漂移） */
export const DEFAULT_SETTINGS: SettingsValues = {
  general: {
    theme: "midnight",
    language: "zh",
    onboarded: false,
    startup: "last-session",
  },
  providers: {
    entries: [],
    defaultProvider: null,
    defaultModel: null,
  },
  agent: {
    autonomy: "L3",
    maxSteps: 12,
    toolPermissions: {},
    confirmRender: true,
    dangerousPatterns: [],
  },
  render: {
    outDir: "renders",
    preset: "1080p30",
    concurrency: 1,
    retries: 1,
  },
  mcp: {
    servers: [],
    mergeTools: false,
  },
  skills: {
    enabled: {},
    autoTrigger: true,
    customDir: null,
  },
  interface: {
    fontSize: "md",
    density: "cozy",
    codeTheme: "auto",
    motion: true,
  },
  privacy: {
    telemetry: false,
    crashReports: true,
    logLevel: "info",
    logRetentionDays: 14,
    sessionRetentionDays: 90,
  },
  advanced: {
    replayWizard: false,
  },
};

export type SettingsValues = z.infer<typeof SettingsValuesSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
