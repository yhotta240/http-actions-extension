import type { PreparedHttpRequest } from "../utils/executor";
import type { ExecutionResult } from "../types/actions";

interface ExecutePreparedRequestMessage {
  type: "EXECUTE_PREPARED_REQUEST";
  target: "offscreen";
  request: PreparedHttpRequest;
}

function failedExecutionResult(actionId: string, actionName: string, error: string): ExecutionResult {
  return {
    actionId,
    actionName,
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener(
  (message: ExecutePreparedRequestMessage, _sender, sendResponse) => {
    if (message?.type !== "EXECUTE_PREPARED_REQUEST" || message.target !== "offscreen") {
      return false;
    }

    const worker = new Worker(chrome.runtime.getURL("offscreen-worker.js"), {
      type: "module",
    });
    let responded = false;

    const respond = (result: ExecutionResult) => {
      if (responded) return;
      responded = true;
      worker.terminate();
      sendResponse(result);
    };

    worker.onmessage = (event: MessageEvent<ExecutionResult>) => {
      respond(event.data);
    };
    worker.onerror = () => {
      respond(
        failedExecutionResult(
          message.request.actionId,
          message.request.actionName,
          "長時間リクエスト用Workerでエラーが発生しました",
        ),
      );
    };

    try {
      worker.postMessage(message.request);
    } catch (err: unknown) {
      respond(
        failedExecutionResult(
          message.request.actionId,
          message.request.actionName,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }

    return true;
  },
);
