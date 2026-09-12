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
import { resolveDirectMediaUrl } from "../media-requests";

const ROOT_MENU_ID = "http_actions_root";
type ChromeContextType = `${chrome.contextMenus.ContextType}`;
type ChromeContextTypes = [ChromeContextType, ...ChromeContextType[]];

interface MediaContextInfo {
  context: MediaContext;
  url: string;
  directUrl?: string;
  pageUrl: string;
}

interface PendingMediaContext extends MediaContextInfo {
  tabId: number;
  frameId: number;
}

const mediaFallbackMenuContexts = new Map<string, MediaContext[]>();
const regularMenuContexts = new Map<string, ActionContext[]>();
let pendingMediaContext: PendingMediaContext | undefined;
let mediaContextVersion = 0;
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
  const parentContexts = new Set<ChromeContextType>([
    ...[...regularMenuContexts.values()]
      .filter((contexts) => isRegularMenuVisible(contexts, context))
      .flatMap((contexts) => contexts.map(mapContextToChrome)),
    ...[...mediaFallbackMenuContexts.values()].flatMap((contexts) =>
      contexts.map(mapContextToChrome),
    ),
  ]);
  if (hasMatchingMediaAction) parentContexts.add(chrome.contextMenus.ContextType.PAGE);
  const contexts = [...parentContexts];

  chrome.contextMenus.update(
    ROOT_MENU_ID,
    {
      visible: contexts.length > 0,
      contexts: [contexts[0] ?? chrome.contextMenus.ContextType.PAGE, ...contexts.slice(1)],
    },
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
    // 標準の動画・音声メニューは常に利用可能にし、検出時だけオーバーレイを補完する。
    const menuContexts = contexts.map(mapContextToChrome) as ChromeContextTypes;
    if (context !== undefined && contexts.includes(context)) {
      menuContexts.push(chrome.contextMenus.ContextType.PAGE);
    }
    chrome.contextMenus.update(id, { visible: true, contexts: menuContexts }, () => {
      void chrome.runtime.lastError;
    });
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

    await createMenuItem({
      id: ROOT_MENU_ID,
      title: "HTTP Actions",
      contexts: parentContexts,
      visible: true,
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
      const contexts = mediaFallbackContexts.map(mapContextToChrome) as ChromeContextTypes;

      await createMenuItem({
        id: `action_${action.id}`,
        parentId: ROOT_MENU_ID,
        title: `${action.method} ${action.name}`,
        contexts,
        visible: true,
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
  let actionMediaFallbackContexts: MediaContext[] = [];
  if (action) actionMediaFallbackContexts = getActionMediaFallbackContexts(action);

  let pending: PendingMediaContext | undefined;
  if (
    pendingMediaContext &&
    tab?.id === pendingMediaContext.tabId &&
    info.frameId === pendingMediaContext.frameId
  ) {
    pending = pendingMediaContext;
  }

  let mediaContext: MediaContextInfo | undefined = pending;
  if (isMediaContext(info.mediaType)) {
    let directUrl: string | undefined;
    if (tab?.id !== undefined) {
      directUrl = await resolveDirectMediaUrl(
        tab.id,
        info.frameId ?? 0,
        info.mediaType,
        info.srcUrl || "",
      );
    }
    mediaContext = {
      context: info.mediaType,
      url: info.srcUrl || "",
      directUrl,
      pageUrl: info.pageUrl || "",
    };
  }

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
    imageUrl: "",
    videoUrl: "",
    audioUrl: "",
  };

  if (info.mediaType === "image") pageContext.imageUrl = info.srcUrl || "";
  if (mediaContext?.context === "video") {
    pageContext.videoUrl = mediaContext.url;
    pageContext.videoDirectUrl = mediaContext.directUrl;
  }
  if (mediaContext?.context === "audio") {
    pageContext.audioUrl = mediaContext.url;
    pageContext.audioDirectUrl = mediaContext.directUrl;
  }

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
  const version = ++mediaContextVersion;
  let mediaContext: MediaContext | undefined;
  if (isMediaContext(message.mediaContext)) mediaContext = message.mediaContext;
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;
  const mediaUrl = getStringValue(message.mediaUrl);

  if (tabId !== undefined && mediaContext) {
    const nextPendingMediaContext: PendingMediaContext = {
      tabId,
      frameId,
      context: mediaContext,
      url: mediaUrl,
      pageUrl: getStringValue(message.pageUrl),
    };
    pendingMediaContext = nextPendingMediaContext;
    nextPendingMediaContext.directUrl = await resolveDirectMediaUrl(
      tabId,
      frameId,
      mediaContext,
      mediaUrl,
    );
    if (version !== mediaContextVersion) return;
  } else {
    pendingMediaContext = undefined;
  }

  await ensureMediaMenuState();
  if (version !== mediaContextVersion) return;
  // 復元を待つ間に届いた最新の検出結果を反映する。
  updateMediaMenuVisibility(pendingMediaContext?.context);
}

function getStringValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value;
}
