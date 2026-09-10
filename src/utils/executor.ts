import type {
  ExecutionPageContext,
  ExecutionResult,
  HttpAction,
  HttpMethod,
} from "../types/actions";
import { logError, logInfo } from "./logger";
import { getSecrets, getVariables } from "./storage";
import { interpolateTemplate } from "./template";

export interface PreparedHttpRequest {
  actionId: string;
  actionName: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export type PreparedRequestExecutor = (request: PreparedHttpRequest) => Promise<ExecutionResult>;
export const EXECUTION_NOTIFICATION_ID = "http-actions-execution-result";

function normalizeTimeoutMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function prepareHttpRequest(
  action: HttpAction,
  pageContext: ExecutionPageContext = {},
  inputValues: Record<string, string> = {},
): Promise<PreparedHttpRequest> {
  const variables = await getVariables();
  const secrets = await getSecrets();

  const templateContext = {
    page: pageContext,
    variables,
    secrets,
    inputs: inputValues,
  };

  const finalUrl = interpolateTemplate(action.url, templateContext);

  // Headers
  const finalHeaders: Record<string, string> = {};
  for (const [key, val] of Object.entries(action.headers || {})) {
    finalHeaders[key] = interpolateTemplate(val, templateContext);
  }

  const isJson = Object.entries(finalHeaders).some(
    ([key, val]) => key.toLowerCase() === "content-type" && /json/i.test(val),
  );

  // Body
  let finalBody: string | undefined;
  if (action.method !== "GET") {
    finalBody = interpolateTemplate(action.body || "", templateContext, { escapeJson: isJson });
  }

  return {
    actionId: action.id,
    actionName: action.name,
    method: action.method,
    url: finalUrl,
    headers: finalHeaders,
    body: action.method !== "GET" ? finalBody : undefined,
    timeoutMs: normalizeTimeoutMs(action.timeoutMs),
  };
}

export async function executePreparedHttpRequest(
  request: PreparedHttpRequest,
): Promise<ExecutionResult> {
  const timestamp = new Date().toISOString();
  const timeoutMs = request.timeoutMs;
  const abortController = timeoutMs === undefined ? undefined : new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  if (abortController && timeoutMs !== undefined) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method !== "GET" ? request.body : undefined,
      signal: abortController?.signal,
    });

    let resBodyText = "";
    try {
      resBodyText = await response.text();
    } catch {
      if (timedOut) throw new Error("Request body read timed out");
      resBodyText = "";
    }

    const result: ExecutionResult = {
      actionId: request.actionId,
      actionName: request.actionName,
      success: response.ok,
      statusCode: response.status,
      statusText: response.statusText,
      responseBody: resBodyText,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      timestamp,
    };

    return result;
  } catch (err: unknown) {
    const errorMsg = timedOut
      ? `リクエストがタイムアウトしました (${timeoutMs}ms)`
      : err instanceof Error
        ? err.message
        : String(err);
    const result: ExecutionResult = {
      actionId: request.actionId,
      actionName: request.actionName,
      success: false,
      error: errorMsg,
      timestamp,
    };

    return result;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

function logExecutionResult(action: HttpAction, result: ExecutionResult): void {
  if (result.success) {
    logInfo(
      `✓ [${result.statusCode} ${result.statusText}] "${action.name}" を送信しました (${action.method} ${action.url})`,
      "background",
    );
  } else if (result.statusCode !== undefined) {
    logError(
      `✕ [${result.statusCode} ${result.statusText}] "${action.name}" の実行に失敗しました (${action.method} ${action.url})`,
      "background",
    );
  } else {
    logError(
      `✕ "${action.name}" の送信中にネットワークエラーが発生しました`,
      "background",
      result.error,
    );
  }
}

export async function executeHttpAction(
  action: HttpAction,
  pageContext: ExecutionPageContext = {},
  inputValues: Record<string, string> = {},
  executeRequest: PreparedRequestExecutor,
): Promise<ExecutionResult> {
  const request = await prepareHttpRequest(action, pageContext, inputValues);
  let result: ExecutionResult;

  try {
    result = await executeRequest(request);
  } catch (err: unknown) {
    result = {
      actionId: action.id,
      actionName: action.name,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    };
  }

  logExecutionResult(action, result);
  return result;
}

export function showExecutionNotification(result: ExecutionResult): void {
  const iconUrl = chrome.runtime.getURL("icons/icon.png");
  let notification: chrome.notifications.NotificationCreateOptions;

  if (result.success) {
    notification = {
      type: "basic",
      iconUrl,
      title: `✓ ${result.statusCode ?? 200} ${result.statusText ?? "OK"}`,
      message: `${result.actionName} へ送信しました`,
      contextMessage: "クリックしてレスポンスを表示",
      priority: 1,
    };
  } else {
    const statusPart = result.statusCode
      ? `${result.statusCode} ${result.statusText || ""}`
      : "Request Failed";
    notification = {
      type: "basic",
      iconUrl,
      title: `✕ ${statusPart}`,
      message:
        result.statusCode !== undefined
          ? `${result.actionName}のエラー詳細を確認してください`
          : `${result.actionName}: ${result.error || "エラーが発生しました"}`,
      contextMessage: "クリックして詳細を表示",
      priority: 2,
    };
  }

  void chrome.notifications.clear(EXECUTION_NOTIFICATION_ID, () => {
    void chrome.notifications.create(EXECUTION_NOTIFICATION_ID, notification);
  });
}
