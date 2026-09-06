import type { ExecutionPageContext, ExecutionResult, HttpAction } from "../types/actions";
import { logError, logInfo } from "./logger";
import { getSecrets, getVariables } from "./storage";
import { interpolateTemplate } from "./template";

export async function executeHttpAction(
  action: HttpAction,
  pageContext: ExecutionPageContext = {},
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

  try {
    const response = await fetch(finalUrl, {
      method: action.method,
      headers: finalHeaders,
      body: action.method !== "GET" ? finalBody : undefined,
    });

    let resBodyText = "";
    try {
      resBodyText = await response.text();
    } catch {
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
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: ExecutionResult = {
      actionId: action.id,
      actionName: action.name,
      success: false,
      error: errorMsg,
      timestamp,
    };

    logError(
      `✕ "${action.name}" の送信中にネットワークエラーが発生しました: ${errorMsg}`,
      "background",
      err,
    );

    return result;
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
