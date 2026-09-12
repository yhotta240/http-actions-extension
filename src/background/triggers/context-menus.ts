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
let pendingMediaContext: PendingMediaContext | undefined;
let hasRegularActions = false;

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

function updateMediaMenuVisibility(context: MediaContext | undefined): void {
  console.log("updateMediaMenuVisibility", context, mediaFallbackMenuContexts);
  if (mediaFallbackMenuContexts.size === 0) return;

  chrome.contextMenus.update(
    ROOT_MENU_ID,
    { visible: hasRegularActions || context !== undefined },
    () => {
      void chrome.runtime.lastError;
    },
  );

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

  try {
    // First clear existing menus cleanly
    await removeAllMenus();
    mediaFallbackMenuContexts.clear();
    hasRegularActions = false;

    const enabled = await isEnabled();
    if (!enabled) {
      return;
    }

    const actions = await getActions();
    const enabledActions = actions.filter(
      (action) => action.enabled && getContextMenuContexts(action.triggers).length > 0,
    );

    if (enabledActions.length === 0) {
      return;
    }

    const regularActions = enabledActions.filter(
      (action) => getActionMediaFallbackContexts(action).length === 0,
    );
    const mediaActions = enabledActions.filter(
      (action) => getActionMediaFallbackContexts(action).length > 0,
    );

    hasRegularActions = regularActions.length > 0;
    const parentContexts = getParentMenuContexts(enabledActions);
    if (mediaActions.length > 0 && !parentContexts.includes(chrome.contextMenus.ContextType.PAGE)) {
      parentContexts.push(chrome.contextMenus.ContextType.PAGE);
    }

    await createMenuItem({
      id: ROOT_MENU_ID,
      title: "HTTP Actions",
      contexts: parentContexts,
      visible: hasRegularActions,
    });

    for (const action of regularActions) {
      const actionContexts = getContextMenuContexts(action.triggers);

      await createMenuItem({
        id: `action_${action.id}`,
        parentId: ROOT_MENU_ID,
        title: `${action.method} ${action.name}`,
        contexts: actionContexts.map(mapContextToChrome) as ChromeContextTypes,
      });
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
  } finally {
    isUpdatingMenus = false;
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
export function handleMediaContext(
  message: { mediaContext?: unknown; mediaUrl?: unknown; pageUrl?: unknown },
  sender: chrome.runtime.MessageSender,
): void {
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

  updateMediaMenuVisibility(mediaContext);
}
