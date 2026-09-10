import type {
  ExecutionInputRequired,
  ExecutionPageContext,
  ExecutionResult,
} from "../../types/actions";
import {
  getLatestExecutionResult,
  LATEST_EXECUTION_RESULT_KEY,
  type StoredExecutionResult,
} from "../../utils/response-storage";
import { getActions, setActions } from "../../utils/storage";

function executeActionInBackground(
  actionId: string,
  pageContext: ExecutionPageContext,
): Promise<ExecutionResult | ExecutionInputRequired> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "EXECUTE_ACTION", actionId, pageContext },
      (response: (ExecutionResult | ExecutionInputRequired) | undefined) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response) {
          reject(new Error("Service Workerから実行結果を受信できませんでした"));
          return;
        }
        resolve(response);
      },
    );
  });
}

function getMethodBadgeClass(method: string): string {
  switch (method) {
    case "GET":
      return "bg-success";
    case "POST":
      return "bg-primary";
    case "PUT":
      return "bg-warning text-dark";
    case "PATCH":
      return "bg-info text-dark";
    case "DELETE":
      return "bg-danger";
    default:
      return "bg-secondary";
  }
}

function formatResponseBody(body: string | undefined): string {
  if (!body) return "（本文なし）";
  try {
    return JSON.stringify(JSON.parse(body), null, 2) ?? body;
  } catch {
    return body;
  }
}

function formatResponseHeaders(headers: Record<string, string> | undefined): string {
  if (!headers || Object.keys(headers).length === 0) return "（ヘッダーなし）";
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function renderExecutionResult(
  container: HTMLElement,
  result: ExecutionResult | StoredExecutionResult,
  expandDetails = false,
): void {
  container.className = "small mt-1 border-top pt-1";
  container.replaceChildren();

  if (result.statusCode === undefined) {
    container.classList.add("text-danger-emphasis");
    container.textContent = `✕ ${result.error || "エラー"}`;
    return;
  }

  container.classList.add(result.success ? "text-success-emphasis" : "text-danger-emphasis");

  const summaryLine = document.createElement("div");
  summaryLine.className = "d-flex align-items-center gap-2";
  const summary = document.createElement("span");
  summary.textContent =
    `${result.success ? "✓" : "✕"} ${result.statusCode} ${result.statusText || ""}`.trim();
  summaryLine.appendChild(summary);

  const details = document.createElement("div");
  details.className = `${expandDetails ? "" : "d-none "}mt-1 text-body`;

  const detailButton = document.createElement("button");
  detailButton.type = "button";
  detailButton.className = "btn btn-sm btn-link p-0";
  detailButton.textContent = expandDetails ? "閉じる" : "詳細";
  detailButton.addEventListener("click", () => {
    const expanded = !details.classList.contains("d-none");
    details.classList.toggle("d-none", expanded);
    detailButton.textContent = expanded ? "詳細" : "閉じる";
  });
  summaryLine.appendChild(detailButton);

  const headersDetails = document.createElement("details");
  const headersSummary = document.createElement("summary");
  headersSummary.textContent = "Headers";
  headersDetails.appendChild(headersSummary);
  const responseHeaders = document.createElement("pre");
  responseHeaders.className = "small border rounded p-2 mt-1 overflow-auto";
  responseHeaders.textContent = formatResponseHeaders(result.responseHeaders);
  headersDetails.appendChild(responseHeaders);
  details.appendChild(headersDetails);

  const responseLabel = document.createElement("div");
  responseLabel.className = "fw-semibold mt-1";
  responseLabel.textContent = "Response";
  details.appendChild(responseLabel);

  if ("responseBodyTruncated" in result && result.responseBodyTruncated) {
    const limitMessage = document.createElement("div");
    limitMessage.className = "text-warning small";
    limitMessage.textContent = "100KB制限：レスポンスが大きいため一部のみ表示しています";
    details.appendChild(limitMessage);
  }

  const responseBody = document.createElement("pre");
  responseBody.className = "small border rounded p-2 mb-1 mt-1 overflow-auto";
  responseBody.style.maxHeight = "240px";
  responseBody.textContent = formatResponseBody(result.responseBody);
  details.appendChild(responseBody);

  container.appendChild(summaryLine);
  container.appendChild(details);
}

async function getActiveTabContext(): Promise<ExecutionPageContext> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab) return {};

  let selection = "";
  try {
    if (activeTab.id) {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => window.getSelection()?.toString() || "",
      });
      if (injectionResults?.[0]?.result) {
        selection = injectionResults[0].result;
      }
    }
  } catch (_e) {
    // If scripting is restricted on internal chrome:// pages, ignore
  }

  let domain = "";
  if (activeTab.url) {
    try {
      domain = new URL(activeTab.url).hostname;
    } catch {
      domain = "";
    }
  }

  return {
    url: activeTab.url,
    title: activeTab.title,
    domain,
    selection,
  };
}

export function setupActionsTab(
  container: HTMLElement,
  onEditAction?: (actionId: string) => void,
): { refresh: () => Promise<void> } {
  const responseDisplayParams = new URLSearchParams(window.location.search);
  const responseActionId = responseDisplayParams.get("responseActionId");
  const expandResponse = responseDisplayParams.get("expandResponse") === "1";
  const statusElements = new Map<string, HTMLElement>();
  let latestResult: StoredExecutionResult | undefined;

  const clearExecutionResult = (element: HTMLElement): void => {
    element.className = "small d-none mt-1 border-top pt-1";
    element.replaceChildren();
  };

  const updateLatestResult = (nextResult: StoredExecutionResult | undefined): void => {
    if (latestResult?.actionId !== nextResult?.actionId) {
      const previousStatus = latestResult ? statusElements.get(latestResult.actionId) : undefined;
      if (previousStatus) clearExecutionResult(previousStatus);
    }

    latestResult = nextResult;
    if (!nextResult) return;

    const statusMsg = statusElements.get(nextResult.actionId);
    if (statusMsg) {
      renderExecutionResult(
        statusMsg,
        nextResult,
        expandResponse && responseActionId === nextResult.actionId,
      );
    }
  };

  const render = async () => {
    const [actions, loadedResult] = await Promise.all([getActions(), getLatestExecutionResult()]);
    latestResult = loadedResult;
    statusElements.clear();
    container.innerHTML = "";

    if (actions.length === 0) {
      container.innerHTML = `
        <div class="text-center text-muted p-4 border rounded bg-light-subtle">
          <p class="mb-1">登録されているアクションがありません</p>
          <small>「設定」タブから新しいアクションを追加してください</small>
        </div>
      `;
      return;
    }

    const listGroup = document.createElement("div");
    listGroup.className = "d-flex flex-column gap-1";

    actions.forEach((action) => {
      const card = document.createElement("div");
      card.className = "card action-item-card rounded-2 p-2";

      // Main container: left info, right actions
      const row = document.createElement("div");
      row.className = "d-flex align-items-center justify-content-between gap-2";

      // Left info: method, name & context chips
      const leftCol = document.createElement("div");
      leftCol.className = "d-flex flex-column flex-grow-1 overflow-hidden";

      const titleLine = document.createElement("div");
      titleLine.className = "d-flex align-items-center gap-2 text-truncate";

      const badge = document.createElement("span");
      badge.className = `badge ${getMethodBadgeClass(action.method)} px-1 py-0 small`;
      badge.style.fontSize = "0.72rem";
      badge.textContent = action.method;

      const title = document.createElement("span");
      title.className = "fw-semibold text-truncate small";
      title.title = action.name;
      title.textContent = action.name;

      titleLine.appendChild(badge);
      titleLine.appendChild(title);

      const subLine = document.createElement("div");
      subLine.className = "d-flex align-items-center gap-2 mt-1 text-truncate";

      const contextsDiv = document.createElement("div");
      contextsDiv.className = "d-flex gap-1 flex-shrink-0";
      (action.contexts || ["page"]).forEach((c) => {
        const cBadge = document.createElement("span");
        cBadge.className = "text-secondary-emphasis bg-secondary-subtle px-1 rounded";
        cBadge.style.fontSize = "0.68rem";
        cBadge.textContent = c;
        contextsDiv.appendChild(cBadge);
      });

      subLine.appendChild(contextsDiv);

      leftCol.appendChild(titleLine);
      leftCol.appendChild(subLine);

      // Right action buttons: Run icon, Edit icon, Switch
      const rightCol = document.createElement("div");
      rightCol.className = "d-flex align-items-center gap-1 flex-shrink-0";

      // Run Icon Button
      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "icon-action-btn btn-run";
      runBtn.innerHTML =
        '<i class="bi bi-play-fill" style="font-size: 1.1rem; line-height: 1;"></i>';
      runBtn.title = "このアクションを実行";

      // Edit Icon Button
      let editBtn: HTMLButtonElement | null = null;
      if (onEditAction) {
        editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "icon-action-btn";
        editBtn.innerHTML =
          '<i class="bi bi-pencil" style="font-size: 0.85rem; line-height: 1;"></i>';
        editBtn.title = "アクションを編集";
        editBtn.addEventListener("click", () => onEditAction(action.id));
      }

      // Switch
      const formCheck = document.createElement("div");
      formCheck.className = "form-check form-switch m-0 ms-1";
      const toggle = document.createElement("input");
      toggle.className = "form-check-input";
      toggle.type = "checkbox";
      toggle.role = "switch";
      toggle.checked = action.enabled;
      toggle.title = action.enabled ? "有効 (右クリックメニューに表示)" : "無効";

      toggle.addEventListener("change", async () => {
        action.enabled = toggle.checked;
        await setActions(actions);
      });

      formCheck.appendChild(toggle);

      rightCol.appendChild(runBtn);
      if (editBtn) rightCol.appendChild(editBtn);
      rightCol.appendChild(formCheck);

      row.appendChild(leftCol);
      row.appendChild(rightCol);

      // Status message display
      const statusMsg = document.createElement("div");
      statusMsg.className = "small d-none mt-1 border-top pt-1";
      statusMsg.style.fontSize = "0.75rem";
      if (latestResult?.actionId === action.id) {
        renderExecutionResult(
          statusMsg,
          latestResult,
          expandResponse && responseActionId === action.id,
        );
      }
      statusElements.set(action.id, statusMsg);

      runBtn.addEventListener("click", async () => {
        runBtn.disabled = true;
        runBtn.innerHTML =
          '<span class="spinner-border spinner-border-sm" style="width: 14px; height: 14px;" role="status"></span>';
        statusMsg.classList.add("d-none");

        try {
          const pageContext = await getActiveTabContext();
          const result = await executeActionInBackground(action.id, pageContext);

          statusMsg.classList.remove("d-none");
          if ("inputRequired" in result) {
            statusMsg.className = "small text-info mt-1 border-top pt-1";
            statusMsg.textContent = "実行入力画面を開きました";
          } else {
            const storedResult = await getLatestExecutionResult();
            renderExecutionResult(
              statusMsg,
              storedResult?.actionId === action.id ? storedResult : result,
            );
          }
        } catch (err: unknown) {
          statusMsg.className = "small text-danger mt-1 border-top pt-1";
          statusMsg.textContent = `✕ ${err instanceof Error ? err.message : String(err)}`;
        } finally {
          runBtn.disabled = false;
          runBtn.innerHTML =
            '<i class="bi bi-play-fill" style="font-size: 1.1rem; line-height: 1;"></i>';
        }
      });

      card.appendChild(row);
      card.appendChild(statusMsg);
      listGroup.appendChild(card);
    });

    container.appendChild(listGroup);
  };

  render();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[LATEST_EXECUTION_RESULT_KEY]) {
      updateLatestResult(
        changes[LATEST_EXECUTION_RESULT_KEY].newValue as StoredExecutionResult | undefined,
      );
    }
  });

  return {
    refresh: render,
  };
}
