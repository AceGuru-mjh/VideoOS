// @videoos/workspace：项目文件系统 + 事务系统 + Agent Memory + 项目模板（SPEC §7.3 / §9）
export { WorkspaceError } from "./errors";
export { ManifestSchema, parseManifest, DEFAULT_ENTRY } from "./manifest";
export type { ProjectManifest } from "./manifest";
export { ProjectWorkspace, PROJECT_FILE } from "./workspace";
export type { WorkspacePaths } from "./workspace";
export { MemoryStore } from "./memory";
export { TransactionManager, Transaction, PROTECTED_PATHS, MAX_FINISHED_SNAPSHOTS } from "./transactions";
export type { TransactionInfo } from "./transactions";
export { createProjectTemplate } from "./template";
