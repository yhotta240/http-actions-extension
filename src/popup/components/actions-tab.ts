import type { ExecutionPageContext } from "../../types/actions";
import { executeHttpAction, showExecutionNotification } from "../../utils/executor";
import { getActions, setActions } from "../../utils/storage";

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
  const render = async () => {
    const actions = await getActions();
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

      // Left info: method, name, url & context chips
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

      const urlText = document.createElement("span");
      urlText.className = "text-muted font-monospace text-truncate";
      urlText.style.fontSize = "0.75rem";
      urlText.textContent = action.url;
      urlText.title = action.url;

      const contextsDiv = document.createElement("div");
      contextsDiv.className = "d-flex gap-1 flex-shrink-0";
      (action.contexts || ["page"]).forEach((c) => {
        const cBadge = document.createElement("span");
        cBadge.className = "text-secondary-emphasis bg-secondary-subtle px-1 rounded";
        cBadge.style.fontSize = "0.68rem";
        cBadge.textContent = c;
        contextsDiv.appendChild(cBadge);
      });

      subLine.appendChild(urlText);
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

      runBtn.addEventListener("click", async () => {
        runBtn.disabled = true;
        runBtn.innerHTML =
          '<span class="spinner-border spinner-border-sm" style="width: 14px; height: 14px;" role="status"></span>';
        statusMsg.classList.add("d-none");

        try {
          const pageContext = await getActiveTabContext();
          const result = await executeHttpAction(action, pageContext);
          showExecutionNotification(result);

          statusMsg.classList.remove("d-none");
          if (result.success) {
            statusMsg.className = "small text-success mt-1 border-top pt-1";
            statusMsg.textContent = `✓ ${result.statusCode ?? 200} ${result.statusText ?? "OK"}`;
          } else {
            statusMsg.className = "small text-danger mt-1 border-top pt-1";
            statusMsg.textContent = `✕ ${result.statusCode ? `${result.statusCode} ` : ""}${result.error || result.statusText || "エラー"}`;
          }
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

  return {
    refresh: render,
  };
}
