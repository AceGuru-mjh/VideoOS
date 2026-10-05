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
  theme: z.enum(["midnight", "graphite", "amber", "forest", "rose", "sand", "paper", "daylight"]),
  language: z.enum(["zh", "en"]),
  onboarded: z.boolean(),
  startup: z.enum(["last-session", "new-chat", "wizard"]),
};
const providersShape = {
  entries: z.array(z.unknown()),
  defaultProvider: z.string().nullable(),
  defaultModel: z.string().nullable(),
};
const agentShape = {
  autonomy: z.enum(["L1", "L2", "L3", "L4"]),
  maxSteps: z.number(),
  toolPermissions: z.record(z.string(), z.enum(["allow", "confirm", "deny"])),
  confirmRender: z.boolean(),
};
const renderShape = {
  outDir: z.string(),
  preset: z.enum(["1080p30", "720p30", "vertical-1080x1920"]),
  concurrency: z.number(),
  retries: z.number(),
};
const mcpShape = {
  servers: z.array(z.unknown()),
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
