// The Symbiose API, runtime-agnostic: the Node server (apps/server) and the
// app on its own (apps/mobile/src/local) both run it.

export { createApp, type AppOptions } from './app';
export { singleUser, type AuthEnv, type Authenticate } from './auth';
export { VERSION, type CoreConfig } from './config';
export type { Db } from './db';
export * as schema from './db/schema';
export { HttpError } from './errors';
export type { Deps } from './http';
export { newId } from './ids';
export { createAi } from './ai';
export { AI_PROVIDERS, describeAi, isAiProvider, resolveAi, type AiConfig, type AiProvider, type AiSetup } from './ai/providers';
export { createDisabledAi } from './ai/shared';
export type { Ai, AiFeature, AiUsage, AiUsageListener } from './ai/types';
export { createUsageRecorder, pruneAiUsage, AI_USAGE_MONTHS } from './services/ai-usage';
export { decodePhoto, PhotoStore, type DecodedPhoto, type PhotoFiles, type PhotoMime } from './services/photos';
export { inProcessFetch, supportStreamingResponses, type InProcessApp, type InProcessOptions } from './in-process';
export { migrate, LATEST_MIGRATION } from './db/migrate';
export { createLocalApi, localAiUsage, localUserId, LOCAL_EMAIL, type LocalAiUsage, type LocalApiOptions } from './local';
export { createChatGptAi, CHATGPT_API, CHATGPT_FALLBACK_MODEL, type ChatGptAi, type ChatGptOptions } from './ai/chatgpt';
export {
  BACKUP_EXTENSION,
  BACKUP_FORMAT,
  BackupImportError,
  backupProblem,
  dataTables,
  importBackup,
  readBackupMeta,
  rowCounts,
  sealBackup,
  unsealBackup,
  type BackupMeta,
  type BackupProblem,
  type Sql,
} from './backup';
