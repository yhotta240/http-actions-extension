import { getStorage, setStorage } from "../../utils/storage";

const EXECUTION_WINDOW_IDS_KEY = "execution-window-ids";
let windowIdQueue = Promise.resolve();

interface ExecutionWindowStorage {
  [key: string]: unknown;
  [EXECUTION_WINDOW_IDS_KEY]?: number[];
}

export function rememberExecutionWindow(windowId: number): Promise<void> {
  windowIdQueue = windowIdQueue
    .catch(() => undefined)
    .then(async () => {
      const stored = await getStorage<ExecutionWindowStorage>(EXECUTION_WINDOW_IDS_KEY);
      const windowIds = stored[EXECUTION_WINDOW_IDS_KEY] ?? [];
      if (windowIds.includes(windowId)) return;
      await setStorage({ [EXECUTION_WINDOW_IDS_KEY]: [...windowIds, windowId] });
    });
  return windowIdQueue;
}

export function forgetExecutionWindow(windowId: number): Promise<void> {
  windowIdQueue = windowIdQueue
    .catch(() => undefined)
    .then(async () => {
      const stored = await getStorage<ExecutionWindowStorage>(EXECUTION_WINDOW_IDS_KEY);
      const windowIds = stored[EXECUTION_WINDOW_IDS_KEY] ?? [];
      const remainingWindowIds = windowIds.filter((id) => id !== windowId);
      if (remainingWindowIds.length !== windowIds.length) {
        await setStorage({ [EXECUTION_WINDOW_IDS_KEY]: remainingWindowIds });
      }
    });
  return windowIdQueue;
}

export async function closeExecutionWindows(): Promise<void> {
  await windowIdQueue.catch(() => undefined);

  const stored = await getStorage<ExecutionWindowStorage>(EXECUTION_WINDOW_IDS_KEY);
  const windowIds = stored[EXECUTION_WINDOW_IDS_KEY] ?? [];
  await Promise.all(
    windowIds.map((windowId) => chrome.windows.remove(windowId).catch(() => undefined)),
  );

  await windowIdQueue.catch(() => undefined);
  await setStorage({ [EXECUTION_WINDOW_IDS_KEY]: [] });
}
