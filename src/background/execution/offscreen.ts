import type { ExecutionResult } from "../../types/actions";
import type { PreparedHttpRequest, PreparedRequestExecutor } from "../../utils/executor";
import { failedExecutionResult } from "./result";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let offscreenDocumentCreating: Promise<void> | undefined;
let activeOffscreenRequests = 0;
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

export const executePreparedRequestInOffscreen: PreparedRequestExecutor = async (
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
