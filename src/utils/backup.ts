import type {
  ActionContext,
  ActionInputType,
  HttpAction,
  HttpMethod,
  Variables,
} from "../types/actions";
import { validateActionInputDefinitions } from "./action-inputs";
import { ACTIONS_STORAGE_KEY, VARIABLES_STORAGE_KEY } from "./storage";

export const BACKUP_FORMAT = "http-actions-extension-backup";
export const BACKUP_VERSION = 1;

export interface BackupData {
  actions: HttpAction[];
  variables: Variables;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: BackupData;
}

export async function createBackup(): Promise<BackupFile> {
  const result = await chrome.storage.local.get([ACTIONS_STORAGE_KEY, VARIABLES_STORAGE_KEY]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      actions: (result[ACTIONS_STORAGE_KEY] as HttpAction[] | undefined) ?? [],
      variables: (result[VARIABLES_STORAGE_KEY] as Variables | undefined) ?? {},
    },
  };
}

export interface RestoreResult {
  addedActions: number;
  updatedActions: number;
  addedVariables: number;
  updatedVariables: number;
}

export async function restoreBackup(backup: BackupFile): Promise<RestoreResult> {
  const result = await chrome.storage.local.get([ACTIONS_STORAGE_KEY, VARIABLES_STORAGE_KEY]);
  const currentActions = (result[ACTIONS_STORAGE_KEY] as HttpAction[] | undefined) ?? [];
  const currentVariables = (result[VARIABLES_STORAGE_KEY] as Variables | undefined) ?? {};
  const importedActions = new Map(backup.data.actions.map((action) => [action.id, action]));
  const updatedActions = currentActions.filter((action) => importedActions.has(action.id)).length;
  const mergedActions = currentActions.map((action) => {
    const imported = importedActions.get(action.id);
    return imported ? { ...imported, order: action.order } : action;
  });
  const addedActions = backup.data.actions.filter(
    (action) => !currentActions.some((current) => current.id === action.id),
  );
  mergedActions.push(
    ...addedActions.map((action, index) => ({
      ...action,
      order: currentActions.length + index,
    })),
  );
  const addedVariables = Object.keys(backup.data.variables).filter(
    (key) => !(key in currentVariables),
  );
  const updatedVariables = Object.keys(backup.data.variables).filter(
    (key) => key in currentVariables,
  );

  await chrome.storage.local.set({
    [ACTIONS_STORAGE_KEY]: mergedActions,
    [VARIABLES_STORAGE_KEY]: { ...currentVariables, ...backup.data.variables },
  });

  return {
    addedActions: addedActions.length,
    updatedActions,
    addedVariables: addedVariables.length,
    updatedVariables: updatedVariables.length,
  };
}

export function parseBackup(value: unknown): BackupFile {
  if (!isRecord(value)) {
    throw new Error("JSONの形式が不正です");
  }
  if (value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    throw new Error("対応していないバックアップ形式です");
  }
  if (!isRecord(value.data)) {
    throw new Error("バックアップデータが見つかりません");
  }

  const data = value.data;
  if (!Array.isArray(data.actions) || !data.actions.every(isHttpAction)) {
    throw new Error("アクションデータが不正です");
  }
  if (new Set(data.actions.map((action) => action.id)).size !== data.actions.length) {
    throw new Error("アクションIDが重複しています");
  }
  if (!isStringRecord(data.variables)) {
    throw new Error("Variablesの形式が不正です");
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    data: {
      actions: data.actions,
      variables: data.variables,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isHttpAction(value: unknown): value is HttpAction {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isHttpMethod(value.method) ||
    typeof value.url !== "string" ||
    !isStringRecord(value.headers) ||
    typeof value.body !== "string" ||
    !Array.isArray(value.contexts) ||
    !value.contexts.every(isActionContext) ||
    typeof value.enabled !== "boolean" ||
    typeof value.order !== "number"
  ) {
    return false;
  }
  if (
    value.timeoutMs !== undefined &&
    (typeof value.timeoutMs !== "number" ||
      !Number.isInteger(value.timeoutMs) ||
      value.timeoutMs < 1)
  ) {
    return false;
  }
  if (value.inputs !== undefined) {
    if (
      !Array.isArray(value.inputs) ||
      !value.inputs.every(isActionInput) ||
      !validateActionInputDefinitions(value.inputs).valid
    ) {
      return false;
    }
  }
  return value.id.length > 0 && value.name.length > 0;
}

function isHttpMethod(value: unknown): value is HttpMethod {
  return (
    value === "GET" ||
    value === "POST" ||
    value === "PUT" ||
    value === "PATCH" ||
    value === "DELETE"
  );
}

function isActionContext(value: unknown): value is ActionContext {
  return value === "page" || value === "selection" || value === "link" || value === "image";
}

function isActionInput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === "string" &&
    isActionInputType(value.type) &&
    typeof value.required === "boolean"
  );
}

function isActionInputType(value: unknown): value is ActionInputType {
  return value === "text" || value === "password";
}
