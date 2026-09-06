import type {
  ActionContext,
  ExecutionPageContext,
  ExecutionResult,
} from "../types/actions";
import {
  executeHttpAction,
  showExecutionNotification,
  type PreparedHttpRequest,
  type PreparedRequestExecutor,
} from "../utils/executor";
import { logError, logInfo } from "../utils/logger";
import { ACTIONS_STORAGE_KEY, getActions, isEnabled } from "../utils/storage";

const ROOT_MENU_ID = "http_actions_root";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

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
): Promise<ExecutionResult | undefined> {
  const actions = await getActions();
  const action = actions.find((item) => item.id === actionId);

  if (!action) {
    logError(`Action not found: ${actionId}`, "background");
    return undefined;
  }

  const result = await executeHttpAction(action, pageContext, {
    keepServiceWorkerAlive: true,
    executeRequest: executePreparedRequestInOffscreen,
  });
  showExecutionNotification(result);
  return result;
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
  await executeActionById(actionId, pageContext);
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

    executeActionById(actionId, pageContext)
      .then((result) => {
        sendResponse(result ?? failedExecutionResult(actionId, `Action not found: ${actionId}`));
      })
      .catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        sendResponse(failedExecutionResult(actionId, errorMsg));
      });
    return true;
  }

  if (message?.type === "REFRESH_MENUS") {
    updateContextMenus()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err }));
    return true; // Keep message channel open for async response
  }
});
