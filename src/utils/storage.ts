import { DEFAULT_SETTINGS, type Settings } from "../settings";
import type { HttpAction, Secrets, Variables } from "../types/actions";
import { normalizeAction, type StoredHttpAction } from "./action-migration";

export const ACTIONS_STORAGE_KEY = "actions";
export const VARIABLES_STORAGE_KEY = "variables";
export const SECRETS_STORAGE_KEY = "secrets";

export const DEFAULT_ACTIONS: HttpAction[] = [
  {
    id: "default-save-url",
    name: "URLを保存 (Webhook例)",
    method: "POST",
    url: "https://httpbin.org/post",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      {
        url: "{{page.url}}",
        title: "{{page.title}}",
        domain: "{{page.domain}}",
      },
      null,
      2,
    ),
    triggers: [{ type: "contextMenu", contexts: ["page"] }],
    enabled: true,
    order: 0,
  },
  {
    id: "default-selection",
    name: "選択テキストを送信 (例)",
    method: "POST",
    url: "https://httpbin.org/post",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      {
        text: "{{selection}}",
        source: "{{page.url}}",
      },
      null,
      2,
    ),
    triggers: [{ type: "contextMenu", contexts: ["selection"] }],
    enabled: true,
    order: 1,
  },
];

export async function getSettings(): Promise<Settings> {
  const data = await getStorage<{ settings?: Settings }>("settings");
  return data.settings ?? DEFAULT_SETTINGS;
}

export async function isEnabled(): Promise<boolean> {
  const data = await getStorage<{ enabled?: boolean }>("enabled");
  // Default to true if not explicitly disabled
  return data.enabled !== false;
}

export async function setSettings(settings: Settings): Promise<void> {
  await setStorage({ settings });
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await setStorage({ enabled });
}

export async function getActions(): Promise<HttpAction[]> {
  const data = await getStorage<{ [ACTIONS_STORAGE_KEY]?: StoredHttpAction[] }>(
    ACTIONS_STORAGE_KEY,
  );
  if (!data[ACTIONS_STORAGE_KEY]) {
    // If not initialized, save default actions
    await setActions(DEFAULT_ACTIONS);
    return DEFAULT_ACTIONS;
  }
  return data[ACTIONS_STORAGE_KEY].map(normalizeAction);
}

export async function setActions(actions: HttpAction[]): Promise<void> {
  await setStorage({ [ACTIONS_STORAGE_KEY]: actions });
}

export async function getVariables(): Promise<Variables> {
  const data = await getStorage<{ [VARIABLES_STORAGE_KEY]?: Variables }>(VARIABLES_STORAGE_KEY);
  return data[VARIABLES_STORAGE_KEY] ?? { apiBase: "http://localhost:3000" };
}

export async function setVariables(variables: Variables): Promise<void> {
  await setStorage({ [VARIABLES_STORAGE_KEY]: variables });
}

export async function getSecrets(): Promise<Secrets> {
  const data = await getStorage<{ [SECRETS_STORAGE_KEY]?: Secrets }>(SECRETS_STORAGE_KEY);
  return data[SECRETS_STORAGE_KEY] ?? {};
}

export async function setSecrets(secrets: Secrets): Promise<void> {
  await setStorage({ [SECRETS_STORAGE_KEY]: secrets });
}

export function getStorage<T extends Record<string, unknown>>(
  keys: string | string[],
): Promise<Partial<T>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve((result ?? {}) as Partial<T>);
    });
  });
}

export function setStorage<T extends Record<string, unknown>>(items: T): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

export function getSessionStorage<T extends Record<string, unknown>>(
  keys: string | string[],
): Promise<Partial<T>> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve((result ?? {}) as Partial<T>);
    });
  });
}

export function setSessionStorage<T extends Record<string, unknown>>(items: T): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

export function removeSessionStorage(keys: string | string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}
