import type {
  ActionContext,
  ActionTrigger,
  ExecutionPageContext,
  MediaContext,
} from "../../types/actions";
import { getActions, isEnabled } from "../../utils/storage";
import { getContextMenuContexts } from "../../utils/triggers";
import { findActionById } from "../execution/actions";
import { startActionById } from "../execution/input";

const ROOT_MENU_ID = "http_actions_root";
type ChromeContextType = `${chrome.contextMenus.ContextType}`;
type ChromeContextTypes = [ChromeContextType, ...ChromeContextType[]];

interface PendingMediaContext {
  tabId: number;
  frameId: number;
  context: MediaContext;
  url: string;
  pageUrl: string;
}

const mediaFallbackMenuContexts = new Map<string, MediaContext[]>();
const regularMenuContexts = new Map<string, ActionContext[]>();
let pendingMediaContext: PendingMediaContext | undefined;
let mediaMenuStateReady = false;
let mediaMenuStateRestoring: Promise<void> | undefined;

// Worker復帰時は既存メニューを作り直さず、表示判定に必要な状態だけ復元する。
async function ensureMediaMenuState(): Promise<void> {
  if (mediaMenuStateReady || isUpdatingMenus) return;
  if (!mediaMenuStateRestoring) {
    mediaMenuStateRestoring = (async () => {
      const [enabled, actions] = await Promise.all([isEnabled(), getActions()]);
      if (mediaMenuStateReady || isUpdatingMenus) return;

      mediaFallbackMenuContexts.clear();
      regularMenuContexts.clear();
      for (const action of actions) {
        if (!enabled || !action.enabled || getContextMenuContexts(action.triggers).length === 0)
          continue;
        const contexts = getActionMediaFallbackContexts(action);
        if (contexts.length > 0) {
          mediaFallbackMenuContexts.set(`action_${action.id}`, contexts);
        } else {
          regularMenuContexts.set(`action_${action.id}`, getContextMenuContexts(action.triggers));
        }
      }
      mediaMenuStateReady = true;
    })().finally(() => {
      mediaMenuStateRestoring = undefined;
    });
  }
  await mediaMenuStateRestoring;
}

function getActionMediaFallbackContexts(action: { triggers: ActionTrigger[] }): MediaContext[] {
  const contexts = getContextMenuContexts(action.triggers);
  if (contexts.length === 0 || contexts.includes("page") || !contexts.every(isMediaContext)) {
    return [];
  }
  return contexts.filter(isMediaContext);
}

function isMediaContext(value: unknown): value is MediaContext {
  return value === "video" || value === "audio";
}

function isRegularMenuVisible(
  contexts: ActionContext[],
  context: MediaContext | undefined,
): boolean {
  // 「ページ」は動画・音声の指定を兼ねない。他のコンテキストはChromeの判定に任せる。
  return context === undefined || !contexts.includes("page") || contexts.includes(context);
}

function updateMediaMenuVisibility(context: MediaContext | undefined): void {
  if (isUpdatingMenus || (mediaFallbackMenuContexts.size === 0 && regularMenuContexts.size === 0))
    return;

  const hasMatchingMediaAction =
    context !== undefined &&
    [...mediaFallbackMenuContexts.values()].some((contexts) => contexts.includes(context));
  const hasVisibleRegularAction = [...regularMenuContexts.values()].some((contexts) =>
    isRegularMenuVisible(contexts, context),
  );

  chrome.contextMenus.update(
    ROOT_MENU_ID,
    { visible: hasVisibleRegularAction || hasMatchingMediaAction },
    () => {
      void chrome.runtime.lastError;
    },
  );

  for (const [id, contexts] of regularMenuContexts) {
    chrome.contextMenus.update(id, { visible: isRegularMenuVisible(contexts, context) }, () => {
      void chrome.runtime.lastError;
    });
  }

  for (const [id, contexts] of mediaFallbackMenuContexts) {
    chrome.contextMenus.update(
      id,
      { visible: context !== undefined && contexts.includes(context) },
      () => {
        void chrome.runtime.lastError;
      },
    );
  }
}

/**
 * Maps ActionContext to Chrome ContextMenus ContextType
 */
function mapContextToChrome(context: ActionContext): ChromeContextType {
  switch (context) {
    case "selection":
      return chrome.contextMenus.ContextType.SELECTION;
    case "link":
      return chrome.contextMenus.ContextType.LINK;
    case "image":
      return chrome.contextMenus.ContextType.IMAGE;
    case "video":
      return chrome.contextMenus.ContextType.VIDEO;
    case "audio":
      return chrome.contextMenus.ContextType.AUDIO;
    default:
      return chrome.contextMenus.ContextType.PAGE;
  }
}

function getParentMenuContexts(actions: Array<{ triggers: ActionTrigger[] }>): ChromeContextTypes {
  const contextSet = new Set<ChromeContextType>();

  for (const action of actions) {
    const contexts = getContextMenuContexts(action.triggers);
    for (const context of contexts) {
      contextSet.add(mapContextToChrome(context));
    }
  }

  const contexts = [...contextSet];
  return [contexts[0] ?? chrome.contextMenus.ContextType.PAGE, ...contexts.slice(1)];
}

let isUpdatingMenus = false;
let pendingUpdate = false;
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
  mediaMenuStateReady = false;

  try {
    // First clear existing menus cleanly
    await removeAllMenus();
    mediaFallbackMenuContexts.clear();
    regularMenuContexts.clear();

    const enabled = await isEnabled();
    if (!enabled) {
      mediaMenuStateReady = true;
      return;
    }

    const actions = await getActions();
    const enabledActions = actions.filter(
      (action) => action.enabled && getContextMenuContexts(action.triggers).length > 0,
    );

    if (enabledActions.length === 0) {
      mediaMenuStateReady = true;
      return;
    }

    const regularActions = enabledActions.filter(
      (action) => getActionMediaFallbackContexts(action).length === 0,
    );
    const mediaActions = enabledActions.filter(
      (action) => getActionMediaFallbackContexts(action).length > 0,
    );

    const parentContexts = getParentMenuContexts(enabledActions);
    if (mediaActions.length > 0 && !parentContexts.includes(chrome.contextMenus.ContextType.PAGE)) {
      parentContexts.push(chrome.contextMenus.ContextType.PAGE);
    }

    await createMenuItem({
      id: ROOT_MENU_ID,
      title: "HTTP Actions",
      contexts: parentContexts,
      visible: regularActions.length > 0,
    });

    for (const action of regularActions) {
      const actionContexts = getContextMenuContexts(action.triggers);

      await createMenuItem({
        id: `action_${action.id}`,
        parentId: ROOT_MENU_ID,
        title: `${action.method} ${action.name}`,
        contexts: actionContexts.map(mapContextToChrome) as ChromeContextTypes,
      });
      regularMenuContexts.set(`action_${action.id}`, actionContexts);
    }

    for (const action of mediaActions) {
      const mediaFallbackContexts = getActionMediaFallbackContexts(action);
      const contexts = [
        chrome.contextMenus.ContextType.PAGE,
        ...mediaFallbackContexts.map(mapContextToChrome),
      ] as ChromeContextTypes;

      await createMenuItem({
        id: `action_${action.id}`,
        parentId: ROOT_MENU_ID,
        title: `${action.method} ${action.name}`,
        contexts,
        visible: false,
      });

      mediaFallbackMenuContexts.set(`action_${action.id}`, mediaFallbackContexts);
    }
    mediaMenuStateReady = true;
  } finally {
    isUpdatingMenus = false;
    if (mediaMenuStateReady) updateMediaMenuVisibility(pendingMediaContext?.context);
    if (pendingUpdate) {
      pendingUpdate = false;
      updateContextMenus();
    }
  }
}

export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  const menuId = String(info.menuItemId);
  if (!menuId.startsWith("action_")) return;

  const actionId = menuId.replace("action_", "");
  const action = await findActionById(actionId);
  const actionMediaFallbackContexts = action ? getActionMediaFallbackContexts(action) : [];
  const nativeMediaContext = isMediaContext(info.mediaType) ? info.mediaType : undefined;
  const pending =
    pendingMediaContext &&
    tab?.id === pendingMediaContext.tabId &&
    info.frameId === pendingMediaContext.frameId
      ? pendingMediaContext
      : undefined;
  const mediaContext = nativeMediaContext
    ? {
        context: nativeMediaContext,
        url: info.srcUrl || "",
        pageUrl: info.pageUrl || "",
      }
    : pending;

  pendingMediaContext = undefined;
  updateMediaMenuVisibility(undefined);

  if (
    !action?.enabled ||
    !(await isEnabled()) ||
    getContextMenuContexts(action.triggers).length === 0
  )
    return;

  if (
    actionMediaFallbackContexts.length > 0 &&
    (!mediaContext || !actionMediaFallbackContexts.includes(mediaContext.context))
  ) {
    return;
  }

  if (
    mediaContext &&
    !isRegularMenuVisible(getContextMenuContexts(action.triggers), mediaContext.context)
  )
    return;

  // Build page context
  const pageContext: ExecutionPageContext = {
    url: tab?.url || info.pageUrl || mediaContext?.pageUrl,
    title: tab?.title || "",
    selection: info.selectionText || "",
    linkUrl: info.linkUrl || "",
    imageUrl: info.mediaType === "image" ? info.srcUrl || "" : "",
    videoUrl: mediaContext?.context === "video" ? mediaContext.url : "",
    audioUrl: mediaContext?.context === "audio" ? mediaContext.url : "",
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
}
export async function handleMediaContext(
  message: { mediaContext?: unknown; mediaUrl?: unknown; pageUrl?: unknown },
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const mediaContext = isMediaContext(message.mediaContext) ? message.mediaContext : undefined;
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;

  if (tabId !== undefined && mediaContext) {
    pendingMediaContext = {
      tabId,
      frameId,
      context: mediaContext,
      url: typeof message.mediaUrl === "string" ? message.mediaUrl : "",
      pageUrl: typeof message.pageUrl === "string" ? message.pageUrl : "",
    };
  } else {
    pendingMediaContext = undefined;
  }

  await ensureMediaMenuState();
  // 復元を待つ間に届いた最新の検出結果を反映する。
  updateMediaMenuVisibility(pendingMediaContext?.context);
}
