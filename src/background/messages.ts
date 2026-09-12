import type { ExecutionPageContext } from "../types/actions";
import { logError } from "../utils/logger";
import {
  cancelExecutionInput,
  getExecutionInput,
  startActionById,
  submitExecutionInput,
} from "./execution/input";
import { failedExecutionResult } from "./execution/result";
import { handleMediaContext, updateContextMenus } from "./triggers/context-menus";
// true を返す分岐では非同期応答までメッセージチャネルを維持する。
export const handleRuntimeMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
  message,
  sender,
  sendResponse,
) => {
  if (message?.type === "MEDIA_CONTEXT") {
    handleMediaContext(message, sender)
      .then(() => sendResponse({ success: true }))
      .catch((error: unknown) => {
        logError("メディアメニューの更新に失敗しました", "background", error);
        sendResponse({ success: false });
      });
    return true;
  }
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

    getExecutionInput(requestId)
      .then(sendResponse)
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

    submitExecutionInput(requestId, values)
      .then(sendResponse)
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
      cancelExecutionInput(requestId).catch(() => undefined);
    }
    return false;
  }

  if (message?.type === "REFRESH_MENUS") {
    updateContextMenus()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err }));
    return true; // Keep message channel open for async response
  }
};
