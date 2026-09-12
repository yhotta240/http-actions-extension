import type { ActionContext, ActionTrigger, TriggerCondition } from "../../types/actions";
import {
  ACTION_CONTEXT_LABELS,
  ACTION_CONTEXTS,
  getContextMenuContexts,
} from "../../utils/triggers";

export function setupTriggerEditor(container: HTMLElement, onChange: () => void) {
  container.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-1">
      <span class="form-label small mb-0 fw-semibold">トリガー</span>
      <div class="dropdown">
        <button type="button" class="btn btn-outline-primary btn-sm py-0 px-2 dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
          <i class="bi bi-plus-lg"></i> トリガーを追加
        </button>
        <ul class="dropdown-menu dropdown-menu-end small">
          <li><button type="button" class="dropdown-item" data-trigger-type="contextMenu">コンテキストメニュー</button></li>
          <li><button type="button" class="dropdown-item" data-trigger-type="pageLoad">ページ読み込み</button></li>
        </ul>
      </div>
    </div>
    <div class="trigger-list d-flex flex-column gap-2"></div>
  `;
  const list = container.querySelector(".trigger-list") as HTMLElement;
  const collectors = new Map<HTMLElement, () => ActionTrigger>();
  const contextMenuButton = container.querySelector(
    '[data-trigger-type="contextMenu"]',
  ) as HTMLButtonElement;

  const addTrigger = (trigger: ActionTrigger) => {
    if (trigger.type === "contextMenu" && contextMenuButton.disabled) return;
    const card = document.createElement("div");
    card.className = "border rounded p-2 trigger-card";
    card.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <span class="small fw-semibold">${trigger.type === "contextMenu" ? "コンテキストメニュー" : "ページ読み込み"}</span>
        <button type="button" class="btn btn-outline-danger btn-sm py-0 px-1 remove-trigger" title="トリガーを削除" aria-label="トリガーを削除">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    `;
    card.querySelector(".remove-trigger")?.addEventListener("click", () => {
      collectors.delete(card);
      card.remove();
      if (trigger.type === "contextMenu") contextMenuButton.disabled = false;
      onChange();
    });

    if (trigger.type === "contextMenu") {
      contextMenuButton.disabled = true;
      const contexts = document.createElement("div");
      contexts.className = "d-flex gap-3 flex-wrap small";
      for (const context of ACTION_CONTEXTS) {
        const label = document.createElement("label");
        label.className = "form-check mb-0";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "form-check-input";
        checkbox.value = context;
        checkbox.checked = trigger.contexts.includes(context);
        const text = document.createElement("span");
        text.className = "form-check-label";
        text.textContent = ACTION_CONTEXT_LABELS[context];
        label.append(checkbox, text);
        contexts.appendChild(label);
      }
      card.appendChild(contexts);
      collectors.set(card, () => ({
        type: "contextMenu",
        contexts: Array.from(
          contexts.querySelectorAll<HTMLInputElement>("input:checked"),
          (input) => input.value as ActionContext,
        ),
      }));
    } else {
      const conditionsHeader = document.createElement("div");
      conditionsHeader.className = "d-flex justify-content-between align-items-center mb-1";
      conditionsHeader.innerHTML = `
        <span class="small text-muted">条件（すべて一致）</span>
        <button type="button" class="btn btn-outline-secondary btn-sm py-0 px-2">＋ 条件追加</button>
      `;
      const conditions = document.createElement("div");
      conditions.className = "d-flex flex-column gap-1";
      const addCondition = (condition: TriggerCondition) => {
        const row = document.createElement("div");
        row.className = "row g-1 align-items-center trigger-condition";
        row.innerHTML = `
          <div class="col-5">
            <select class="form-select form-select-sm condition-target" aria-label="条件の対象">
              <option value="url">ページURL</option>
              <option value="domain">ドメイン</option>
              <option value="title">ページタイトル</option>
            </select>
          </div>
          <div class="col-7">
            <select class="form-select form-select-sm condition-operator" aria-label="条件タイプ">
              <option value="equals">完全一致</option>
              <option value="contains">含む</option>
              <option value="startsWith">前方一致</option>
              <option value="endsWith">後方一致</option>
              <option value="matches">正規表現</option>
            </select>
          </div>
          <div class="col-12">
            <div class="input-group input-group-sm">
              <input type="text" class="form-control condition-value" aria-label="条件の値" placeholder="条件の値" required>
              <button type="button" class="btn btn-outline-danger" title="条件を削除" aria-label="条件を削除"><i class="bi bi-x-lg"></i></button>
            </div>
          </div>
        `;
        (row.querySelector(".condition-target") as HTMLSelectElement).value = condition.target;
        (row.querySelector(".condition-operator") as HTMLSelectElement).value = condition.operator;
        (row.querySelector(".condition-value") as HTMLInputElement).value = condition.value;
        row.querySelector("button")?.addEventListener("click", () => row.remove());
        conditions.appendChild(row);
      };
      conditionsHeader.querySelector("button")?.addEventListener("click", () => {
        addCondition({ target: "url", operator: "contains", value: "" });
      });
      for (const condition of trigger.conditions) addCondition(condition);
      card.append(conditionsHeader, conditions);
      collectors.set(card, () => ({
        type: "pageLoad",
        conditions: Array.from(conditions.children, (row) => ({
          target: (row.querySelector(".condition-target") as HTMLSelectElement)
            .value as TriggerCondition["target"],
          operator: (row.querySelector(".condition-operator") as HTMLSelectElement)
            .value as TriggerCondition["operator"],
          value: (row.querySelector(".condition-value") as HTMLInputElement).value,
        })),
      }));
    }
    list.appendChild(card);
  };

  container.querySelectorAll<HTMLButtonElement>("[data-trigger-type]").forEach((button) => {
    button.addEventListener("click", () => {
      addTrigger(
        button.dataset.triggerType === "contextMenu"
          ? { type: "contextMenu", contexts: ["page"] }
          : { type: "pageLoad", conditions: [{ target: "url", operator: "contains", value: "" }] },
      );
      onChange();
    });
  });

  return {
    getTriggers: (): ActionTrigger[] => Array.from(collectors.values(), (collect) => collect()),
    setTriggers: (triggers: ActionTrigger[]): void => {
      collectors.clear();
      list.replaceChildren();
      contextMenuButton.disabled = false;
      const contexts = getContextMenuContexts(triggers);
      for (const trigger of triggers)
        addTrigger(trigger.type === "contextMenu" ? { type: "contextMenu", contexts } : trigger);
      onChange();
    },
  };
}
