import type { ExecutionPageContext, ExecutionResult, HttpAction } from "../types/actions";
import { logError, logInfo } from "./logger";
import { getSecrets, getVariables } from "./storage";
import { interpolateTemplate } from "./template";

export interface ExecuteHttpActionOptions {
  keepServiceWorkerAlive?: boolean;
}

const SERVICE_WORKER_KEEP_ALIVE_INTERVAL_MS = 20_000;

function startServiceWorkerKeepAlive(): () => void {
  const ping = () => {
    chrome.runtime.getPlatformInfo(() => {
      // Read lastError so Chrome does not report an unhandled runtime error
      // if the extension is being unloaded while the heartbeat is running.
      void chrome.runtime.lastError;
    });
  };

  ping();
  const intervalId = setInterval(ping, SERVICE_WORKER_KEEP_ALIVE_INTERVAL_MS);
  return () => clearInterval(intervalId);
}

export async function executeHttpAction(
  action: HttpAction,
  pageContext: ExecutionPageContext = {},
  options: ExecuteHttpActionOptions = {},
): Promise<ExecutionResult> {
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

  const timestamp = new Date().toISOString();
  const configuredTimeoutMs = action.timeoutMs;
  const timeoutMs =
    typeof configuredTimeoutMs === "number" &&
    Number.isInteger(configuredTimeoutMs) &&
    configuredTimeoutMs > 0
      ? configuredTimeoutMs
      : undefined;
  const abortController = timeoutMs === undefined ? undefined : new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const stopKeepAlive = options.keepServiceWorkerAlive ? startServiceWorkerKeepAlive() : undefined;

  if (abortController && timeoutMs !== undefined) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(finalUrl, {
      method: action.method,
      headers: finalHeaders,
      body: action.method !== "GET" ? finalBody : undefined,
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
      actionId: action.id,
      actionName: action.name,
      success: response.ok,
      statusCode: response.status,
      statusText: response.statusText,
      responseBody: resBodyText,
      timestamp,
    };

    if (response.ok) {
      logInfo(
        `✓ [${response.status} ${response.statusText}] "${action.name}" を送信しました (${action.method} ${action.url})`,
        "background",
      );
    } else {
      logError(
        `✕ [${response.status} ${response.statusText}] "${action.name}" の実行に失敗しました (${action.method} ${action.url})`,
        "background",
        { status: response.status, body: resBodyText.slice(0, 300) },
      );
    }

    return result;
  } catch (err: unknown) {
    const errorMsg = timedOut
      ? `リクエストがタイムアウトしました (${timeoutMs}ms)`
      : err instanceof Error
        ? err.message
        : String(err);
    const result: ExecutionResult = {
      actionId: action.id,
      actionName: action.name,
      success: false,
      error: errorMsg,
      timestamp,
    };

    logError(`✕ "${action.name}" の送信中にネットワークエラーが発生しました`, "background");

    return result;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    stopKeepAlive?.();
  }
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
