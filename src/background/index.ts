import { EXECUTION_NOTIFICATION_ID } from "../utils/executor";
import { logError, logInfo } from "../utils/logger";
import { ACTIONS_STORAGE_KEY } from "../utils/storage";
import { handleRuntimeMessage } from "./messages";
import { handleContextMenuClick, updateContextMenus } from "./triggers/context-menus";
import { handlePageLoad } from "./triggers/page-load";
import { openLatestResponsePopup } from "./ui/response-popup";

export { updateContextMenus } from "./triggers/context-menus";

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

chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
chrome.webNavigation.onCompleted.addListener((details) =>
  handlePageLoad(details).catch((error: unknown) =>
    logError("ページ読み込みの処理に失敗しました", "background", error),
  ),
);

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== EXECUTION_NOTIFICATION_ID) return;
  void openLatestResponsePopup().catch((error: unknown) => {
    logError("レスポンス表示Popupの起動に失敗しました", "background", error);
  });
});

chrome.runtime.onMessage.addListener(handleRuntimeMessage);
