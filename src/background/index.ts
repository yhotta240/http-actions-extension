import type {
  ActionContext,
  ActionInput,
  ExecutionInputRequired,
  ExecutionPageContext,
  ExecutionResult,
} from "../types/actions";
import { getMissingRequiredActionInputs } from "../utils/action-inputs";
import {
  EXECUTION_NOTIFICATION_ID,
  executeHttpAction,
  type PreparedHttpRequest,
  type PreparedRequestExecutor,
  showExecutionNotification,
} from "../utils/executor";
import { logError, logInfo } from "../utils/logger";
import { getLatestExecutionResult, saveLatestExecutionResult } from "../utils/response-storage";
import {
  ACTIONS_STORAGE_KEY,
  getActions,
  getSessionStorage,
  isEnabled,
  removeSessionStorage,
  setSessionStorage,
} from "../utils/storage";

const ROOT_MENU_ID = "http_actions_root";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const INPUT_PAGE_PATH = "input.html";
const PENDING_INPUT_KEY_PREFIX = "pending-input:";
const RESPONSE_ACTION_ID_PARAM = "responseActionId";
const EXPAND_RESPONSE_PARAM = "expandResponse";

interface PendingInputRequest {
  actionId: string;
  pageContext: ExecutionPageContext;
}

interface ExecutionInputPageData {
  success: true;
  actionId: string;
  actionName: string;
  inputs: ActionInput[];
}

type ExecuteActionResponse = ExecutionResult | ExecutionInputRequired;

/**
 * Maps ActionContext to Chrome ContextMenus ContextType
 */
function mapContextToChrome(context: ActionContext): `${chrome.contextMenus.ContextType}` {
  switch (context) {
    case "selection":
      return chrome.contextMenus.ContextType.SELECTION;
    case "link":
      return chrome.contextMenus.ContextType.LINK;
    case "image":
      return chrome.contextMenus.ContextType.IMAGE;
    default:
      return chrome.contextMenus.ContextType.PAGE;
  }
}

let isUpdatingMenus = false;
let pendingUpdate = false;
let offscreenDocumentCreating: Promise<void> | undefined;
let activeOffscreenRequests = 0;

function failedExecutionResult(actionId: string, error: string): ExecutionResult {
  return {
    actionId,
    actionName: actionId,
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}

function pendingInputStorageKey(requestId: string): string {
  return `${PENDING_INPUT_KEY_PREFIX}${requestId}`;
}

async function openLatestResponsePopup(): Promise<void> {
  const latestResult = await getLatestExecutionResult();
  if (!latestResult) return;

  const popupUrl = new URL(chrome.runtime.getURL("popup.html"));
  popupUrl.searchParams.set(RESPONSE_ACTION_ID_PARAM, latestResult.actionId);
  popupUrl.searchParams.set(EXPAND_RESPONSE_PARAM, "1");

  await chrome.windows.create({
    url: popupUrl.toString(),
    type: "popup",
    width: 480,
    height: 720,
    focused: true,
  });
}

async function findActionById(actionId: string) {
  const actions = await getActions();
  return actions.find((item) => item.id === actionId);
}

async function openExecutionInputPage(
  actionId: string,
  actionName: string,
  pageContext: ExecutionPageContext,
): Promise<ExecutionInputRequired> {
  const requestId = crypto.randomUUID();
  await setSessionStorage({
    [pendingInputStorageKey(requestId)]: {
      actionId,
      pageContext,
    } satisfies PendingInputRequest,
  });

  try {
    const inputUrl = `${chrome.runtime.getURL(INPUT_PAGE_PATH)}?requestId=${encodeURIComponent(requestId)}`;
    await chrome.windows.create({
      url: inputUrl,
      type: "popup",
      width: 460,
      height: 560,
    });
  } catch (error: unknown) {
    await removeSessionStorage(pendingInputStorageKey(requestId)).catch(() => undefined);
    throw error;
  }

  return { inputRequired: true, requestId, actionName };
}

async function hasOffscreenDocument(): Promise<boolean> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    });
    return contexts.length > 0;
  }

  const serviceWorkerClients = (
    globalThis as typeof globalThis & {
      clients: { matchAll: () => Promise<Array<{ url: string }>> };
    }
  ).clients;
  const contexts = await serviceWorkerClients.matchAll();
  return contexts.some((client) => client.url === offscreenUrl);
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;

  if (!offscreenDocumentCreating) {
    offscreenDocumentCreating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "長時間HTTPリクエストを専用Workerで実行するため",
      })
      .finally(() => {
        offscreenDocumentCreating = undefined;
      });
  }

  await offscreenDocumentCreating;
}

const executePreparedRequestInOffscreen: PreparedRequestExecutor = async (
  request: PreparedHttpRequest,
): Promise<ExecutionResult> => {
  activeOffscreenRequests += 1;

  try {
    await ensureOffscreenDocument();

    return await new Promise<ExecutionResult>((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "EXECUTE_PREPARED_REQUEST",
          target: "offscreen",
          request,
        },
        (response: ExecutionResult | undefined) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            resolve(
              failedExecutionResult(
                request.actionId,
                runtimeError.message || "Offscreen Documentとの通信に失敗しました",
              ),
            );
            return;
          }
          resolve(
            response ??
              failedExecutionResult(
                request.actionId,
                "Offscreen Documentから実行結果を受信できませんでした",
              ),
          );
        },
      );
    });
  } finally {
    activeOffscreenRequests -= 1;
    if (activeOffscreenRequests === 0) {
      await chrome.offscreen.closeDocument().catch(() => undefined);
    }
  }
};

async function executeActionById(
  actionId: string,
  pageContext: ExecutionPageContext = {},
  inputValues: Record<string, string> = {},
): Promise<ExecutionResult | undefined> {
  const action = await findActionById(actionId);

  if (!action) {
    logError(`Action not found: ${actionId}`, "background");
    return undefined;
  }

  const missingInputs = getMissingRequiredActionInputs(action, inputValues);
  if (missingInputs.length > 0) {
    return failedExecutionResult(
      actionId,
      `必須入力が不足しています: ${missingInputs.map((input) => input.key).join(", ")}`,
    );
  }

  const result = await executeHttpAction(
    action,
    pageContext,
    inputValues,
    executePreparedRequestInOffscreen,
  );
  await saveLatestExecutionResult(result).catch(() => {
    logError("最新レスポンスの一時保存に失敗しました", "background");
  });
  showExecutionNotification(result);
  return result;
}

async function startActionById(
  actionId: string,
  pageContext: ExecutionPageContext = {},
): Promise<ExecuteActionResponse | undefined> {
  const action = await findActionById(actionId);
  if (!action) {
    logError(`Action not found: ${actionId}`, "background");
    return undefined;
  }

  if (action.inputs && action.inputs.length > 0) {
    return openExecutionInputPage(action.id, action.name, pageContext);
  }

  return executeActionById(actionId, pageContext);
}

function createMenuItem(options: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.create(options, () => {
      // Clear lastError if any so it doesn't log unhandled runtime.lastError
      const err = chrome.runtime.lastError;
      if (err) {
        // Silently ignore duplicate id or transient creation conflicts
      }
      resolve();
    });
  });
}

function removeAllMenus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      const _ = chrome.runtime.lastError;
      resolve();
    });
  });
}

/**
 * Rebuilds context menus based on registered actions and extension enabled state
 */
export async function updateContextMenus(): Promise<void> {
  if (isUpdatingMenus) {
    pendingUpdate = true;
    return;
  }
  isUpdatingMenus = true;

  try {
    // First clear existing menus cleanly
    await removeAllMenus();

    const enabled = await isEnabled();
    if (!enabled) {
      return;
    }

    const actions = await getActions();
    const enabledActions = actions.filter((a) => a.enabled);

    if (enabledActions.length === 0) {
      return;
    }

    // Create parent menu
    await createMenuItem({
      id: ROOT_MENU_ID,
      title: "HTTP Actions",
      contexts: [
        chrome.contextMenus.ContextType.PAGE,
        chrome.contextMenus.ContextType.SELECTION,
        chrome.contextMenus.ContextType.LINK,
        chrome.contextMenus.ContextType.IMAGE,
      ],
    });

    // Create item for each action
    for (const action of enabledActions) {
      const rawContexts =
        action.contexts && action.contexts.length > 0
          ? action.contexts.map(mapContextToChrome)
          : [
              chrome.contextMenus.ContextType.PAGE,
              chrome.contextMenus.ContextType.SELECTION,
              chrome.contextMenus.ContextType.LINK,
              chrome.contextMenus.ContextType.IMAGE,
            ];

      const contexts: [
        `${chrome.contextMenus.ContextType}`,
        ...`${chrome.contextMenus.ContextType}`[],
      ] = [rawContexts[0] ?? chrome.contextMenus.ContextType.PAGE, ...rawContexts.slice(1)];

      await createMenuItem({
        id: `action_${action.id}`,
        parentId: ROOT_MENU_ID,
        title: `${action.method} ${action.name}`,
        contexts,
      });
    }
  } finally {
    isUpdatingMenus = false;
    if (pendingUpdate) {
      pendingUpdate = false;
      updateContextMenus();
    }
  }
}

// Initial setup
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    logInfo("拡張機能がインストールされました", "background");
  } else if (details.reason === "update") {
    logInfo(
      `拡張機能がアップデートされました (v${details.previousVersion ?? "?"} → v${chrome.runtime.getManifest().version})`,
      "background",
    );
  }
  await updateContextMenus();
});

chrome.runtime.onStartup?.addListener(async () => {
  await updateContextMenus();
});

// Watch for changes in actions or enabled status to update menus
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && (changes[ACTIONS_STORAGE_KEY] || changes.enabled)) {
    await updateContextMenus();
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = String(info.menuItemId);
  if (!menuId.startsWith("action_")) return;

  const actionId = menuId.replace("action_", "");
  // Build page context
  const pageContext: ExecutionPageContext = {
    url: tab?.url || info.pageUrl,
    title: tab?.title || "",
    selection: info.selectionText || "",
    linkUrl: info.linkUrl || "",
    imageUrl: info.srcUrl || "",
  };

  if (pageContext.url) {
    try {
      pageContext.domain = new URL(pageContext.url).hostname;
    } catch {
      pageContext.domain = "";
    }
  }

  // Execute
  await startActionById(actionId, pageContext);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== EXECUTION_NOTIFICATION_ID) return;
  void openLatestResponsePopup().catch((error: unknown) => {
    logError("レスポンス表示Popupの起動に失敗しました", "background", error);
  });
});

// Listen for messages from popup (e.g. manual execution or menu refresh)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "EXECUTE_ACTION") {
    const actionId = typeof message.actionId === "string" ? message.actionId : "";
    const pageContext = (message.pageContext ?? {}) as ExecutionPageContext;

    if (!actionId) {
      sendResponse(failedExecutionResult("", "アクションIDが指定されていません"));
      return false;
    }

    startActionById(actionId, pageContext)
      .then((result) => {
        sendResponse(result ?? failedExecutionResult(actionId, `Action not found: ${actionId}`));
      })
      .catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        sendResponse(failedExecutionResult(actionId, errorMsg));
      });
    return true;
  }

  if (message?.type === "GET_EXECUTION_INPUT") {
    const requestId = typeof message.requestId === "string" ? message.requestId : "";
    if (!requestId) {
      sendResponse({ success: false, error: "入力リクエストIDが指定されていません" });
      return false;
    }

    getSessionStorage<{ [key: string]: PendingInputRequest }>(pendingInputStorageKey(requestId))
      .then(async (stored) => {
        const pending = stored[pendingInputStorageKey(requestId)];
        const action = pending ? await findActionById(pending.actionId) : undefined;
        if (!pending || !action?.inputs?.length) {
          sendResponse({ success: false, error: "実行入力の情報が見つかりません" });
          return;
        }

        const response: ExecutionInputPageData = {
          success: true,
          actionId: action.id,
          actionName: action.name,
          inputs: action.inputs,
        };
        sendResponse(response);
      })
      .catch((error: unknown) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  if (message?.type === "SUBMIT_EXECUTION_INPUT") {
    const requestId = typeof message.requestId === "string" ? message.requestId : "";
    const values = (message.values ?? {}) as Record<string, unknown>;
    if (!requestId) {
      sendResponse(failedExecutionResult("", "入力リクエストIDが指定されていません"));
      return false;
    }

    getSessionStorage<{ [key: string]: PendingInputRequest }>(pendingInputStorageKey(requestId))
      .then(async (stored) => {
        const pending = stored[pendingInputStorageKey(requestId)];
        if (!pending) {
          sendResponse(failedExecutionResult("", "実行入力の有効期限が切れています"));
          return;
        }

        const action = await findActionById(pending.actionId);
        if (!action) {
          sendResponse(failedExecutionResult(pending.actionId, "アクションが見つかりません"));
          return;
        }

        const inputValues: Record<string, string> = {};
        for (const input of action.inputs ?? []) {
          const value = values[input.key];
          inputValues[input.key] = typeof value === "string" ? value : "";
        }
        const missingInputs = getMissingRequiredActionInputs(action, inputValues);
        if (missingInputs.length > 0) {
          sendResponse(
            failedExecutionResult(
              action.id,
              `必須入力が不足しています: ${missingInputs.map((input) => input.key).join(", ")}`,
            ),
          );
          return;
        }

        const result = await executeActionById(action.id, pending.pageContext, inputValues);
        if (result?.success) {
          await removeSessionStorage(pendingInputStorageKey(requestId)).catch((error: unknown) => {
            logError("実行入力の一時データ削除に失敗しました", "background", error);
          });
        }
        sendResponse(result ?? failedExecutionResult(action.id, "アクションの実行に失敗しました"));
      })
      .catch((error: unknown) => {
        sendResponse(
          failedExecutionResult("", error instanceof Error ? error.message : String(error)),
        );
      });
    return true;
  }

  if (message?.type === "CANCEL_EXECUTION_INPUT") {
    const requestId = typeof message.requestId === "string" ? message.requestId : "";
    if (requestId) {
      removeSessionStorage(pendingInputStorageKey(requestId)).catch(() => undefined);
    }
    return false;
  }

  if (message?.type === "REFRESH_MENUS") {
    updateContextMenus()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err }));
    return true; // Keep message channel open for async response
  }
});
