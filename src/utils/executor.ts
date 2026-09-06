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

export type PreparedRequestExecutor = (
  request: PreparedHttpRequest,
) => Promise<ExecutionResult>;

export interface ExecuteHttpActionOptions {
  executeRequest?: PreparedRequestExecutor;
}

function normalizeTimeoutMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function prepareHttpRequest(
  action: HttpAction,
  pageContext: ExecutionPageContext = {},
): Promise<PreparedHttpRequest> {
  const variables = await getVariables();
  const secrets = await getSecrets();

  const templateContext = {
    page: pageContext,
    variables,
    secrets,
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
      { status: result.statusCode, body: result.responseBody?.slice(0, 300) },
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
  options: ExecuteHttpActionOptions = {},
): Promise<ExecutionResult> {
  const request = await prepareHttpRequest(action, pageContext);
  let result: ExecutionResult;

  try {
    result = await (options.executeRequest ?? executePreparedHttpRequest)(request);
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

  if (result.success) {
    chrome.notifications.create({
      type: "basic",
      iconUrl,
      title: `✓ ${result.statusCode ?? 200} ${result.statusText ?? "OK"}`,
      message: `${result.actionName} へ送信しました`,
      priority: 1,
    });
  } else {
    const statusPart = result.statusCode
      ? `${result.statusCode} ${result.statusText || ""}`
      : "Request Failed";
    chrome.notifications.create({
      type: "basic",
      iconUrl,
      title: `✕ ${statusPart}`,
      message: `${result.actionName}: ${result.error || result.responseBody?.slice(0, 80) || "エラーが発生しました"}`,
      priority: 2,
    });
  }
}
