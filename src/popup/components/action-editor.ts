import type { ActionContext, ActionInput, HttpAction, HttpMethod } from "../../types/actions";
import { validateActionInputDefinitions } from "../../utils/action-inputs";
import { getActions, setActions } from "../../utils/storage";

const COMMON_HEADERS = [
  "Content-Type",
  "Authorization",
  "Accept",
  "X-API-Key",
  "User-Agent",
  "Cache-Control",
];

type BodyScalarType = "string" | "number" | "boolean";

function getBodyScalarType(value: unknown): BodyScalarType | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

export function setupActionEditor(
  container: HTMLElement,
  options: {
    onSaved?: () => void;
  } = {},
): {
  loadActionForEdit: (actionId: string) => Promise<void>;
  resetForm: () => void;
} {
  let currentEditingId: string | null = null;
  let bodyMode: "kv" | "raw" = "kv";

  container.innerHTML = `
    <div class="card p-3 shadow-sm mb-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="m-0 fw-bold" id="editor-title">新規アクション作成</h6>
        <button type="button" class="btn btn-sm btn-outline-secondary d-none" id="btn-cancel-edit">
          新規作成に戻る
        </button>
      </div>

      <form id="action-form">
        <div class="mb-2">
          <label class="form-label small mb-1 fw-semibold">名前 (Name)</label>
          <input type="text" class="form-control form-control-sm" id="action-name" placeholder="例: URLを保存" required />
        </div>

        <div class="row g-2 mb-2">
          <div class="col-3">
            <label class="form-label small mb-1 fw-semibold">Method</label>
            <select class="form-select form-select-sm" id="action-method">
              <option value="GET">GET</option>
              <option value="POST" selected>POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div class="col-9">
            <label class="form-label small mb-1 fw-semibold">URL (変数展開可)</label>
            <input type="text" class="form-control form-control-sm font-monospace" id="action-url" placeholder="https://api.example.com/save" required />
          </div>
        </div>

        <div class="mb-2">
          <label class="form-label small mb-1 fw-semibold">リクエストタイムアウト (ms)</label>
          <input type="number" class="form-control form-control-sm" id="action-timeout-ms" min="1" step="1" inputmode="numeric" placeholder="空欄 = 制限なし" />
          <small class="text-muted">空欄の場合，拡張機能側ではタイムアウトしません</small>
        </div>

        <div class="mb-3 pt-2">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <div>
              <label class="form-label small mb-0 fw-semibold">実行時入力</label>
              <div class="small text-muted"><code>{{userId}}</code>のようにURL・Header・Bodyで参照します</div>
            </div>
            <button type="button" class="btn btn-outline-primary btn-sm py-0 px-2 small" id="btn-add-action-input">
              <i class="bi bi-plus-lg"></i> 項目追加
            </button>
          </div>
          <div id="action-inputs-container" class="d-flex flex-column gap-1"></div>
        </div>

        <div class="mb-2">
          <label class="form-label small mb-1 fw-semibold">使用可能な Context (右クリック表示条件)</label>
          <div class="d-flex gap-3 flex-wrap small">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="ctx-page" value="page" checked>
              <label class="form-check-label" for="ctx-page">Page</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="ctx-selection" value="selection" checked>
              <label class="form-check-label" for="ctx-selection">Selection</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="ctx-link" value="link" checked>
              <label class="form-check-label" for="ctx-link">Link</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="ctx-image" value="image">
              <label class="form-check-label" for="ctx-image">Image</label>
            </div>
          </div>
        </div>

        <!-- Headers Key-Value -->
        <div class="mb-3 pt-2">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <label class="form-label small mb-0 fw-semibold">Headers</label>
            <div class="d-flex gap-1">
              <div class="dropdown">
                <button class="btn btn-outline-secondary btn-sm py-0 px-2 dropdown-toggle small" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                  + 定番プリセット
                </button>
                <ul class="dropdown-menu dropdown-menu-end small">
                  <li><a class="dropdown-item header-preset" href="#" data-key="Content-Type" data-val="application/json">Content-Type: application/json</a></li>
                  <li><a class="dropdown-item header-preset" href="#" data-key="Authorization" data-val="Bearer {{secret.token}}">Authorization: Bearer {{secret.token}}</a></li>
                  <li><a class="dropdown-item header-preset" href="#" data-key="Accept" data-val="application/json">Accept: application/json</a></li>
                </ul>
              </div>
              <button type="button" class="btn btn-outline-primary btn-sm py-0 px-2 small" id="btn-add-header-row">
                <i class="bi bi-plus-lg"></i> 行追加
              </button>
            </div>
          </div>
          <datalist id="common-headers-list">
            ${COMMON_HEADERS.map((h) => `<option value="${h}"></option>`).join("")}
          </datalist>
          <div id="headers-rows-container" class="d-flex flex-column gap-1"></div>
        </div>

        <!-- Body Section -->
        <div class="mb-2 pt-2" id="body-container">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <label class="form-label small mb-0 fw-semibold">Body</label>
            <div class="btn-group btn-group-sm" role="group">
              <input type="radio" class="btn-check" name="body-mode-radio" id="mode-body-kv" autocomplete="off" checked>
              <label class="btn btn-outline-secondary py-0 px-2" for="mode-body-kv">JSON (KV)</label>

              <input type="radio" class="btn-check" name="body-mode-radio" id="mode-body-raw" autocomplete="off">
              <label class="btn btn-outline-secondary py-0 px-2" for="mode-body-raw">Raw</label>
            </div>
          </div>

          <!-- KV Mode -->
          <div id="body-kv-panel" class="mb-2">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <small class="text-muted">自動でJSONオブジェクトに変換されます</small>
              <button type="button" class="btn btn-outline-primary btn-sm py-0 px-2 small" id="btn-add-body-kv-row">
                <i class="bi bi-plus-lg"></i> 項目追加
              </button>
            </div>
            <div id="body-kv-rows-container" class="d-flex flex-column gap-1"></div>
          </div>

          <!-- Raw Mode -->
          <div id="body-raw-panel" class="d-none mb-2">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <small class="text-muted">生のJSONやテキスト</small>
              <div class="d-flex gap-1">
                <button type="button" class="btn btn-link btn-sm p-0 small text-decoration-none" id="btn-insert-selection">
                  + selection
                </button>
                <button type="button" class="btn btn-link btn-sm p-0 small text-decoration-none" id="btn-insert-url">
                  + page.url
                </button>
              </div>
            </div>
            <textarea class="form-control form-control-sm font-monospace" id="action-body-raw" rows="4" placeholder='{\n  "text": "{{selection}}",\n  "url": "{{page.url}}"\n}'></textarea>
          </div>
        </div>

        <div class="d-flex justify-content-between align-items-center mt-3">
          <div class="d-flex gap-2">
            <button type="submit" class="btn btn-sm btn-primary" id="btn-save">
              <i class="bi bi-check-lg"></i> 保存
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger d-none" id="btn-delete">
              <i class="bi bi-trash"></i> 削除
            </button>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary d-none" id="btn-duplicate">
            <i class="bi bi-files"></i> 複製
          </button>
        </div>
      </form>
    </div>
  `;

  const form = container.querySelector("#action-form") as HTMLFormElement;
  const editorTitle = container.querySelector("#editor-title") as HTMLElement;
  const btnCancelEdit = container.querySelector("#btn-cancel-edit") as HTMLButtonElement;
  const btnDelete = container.querySelector("#btn-delete") as HTMLButtonElement;
  const btnDuplicate = container.querySelector("#btn-duplicate") as HTMLButtonElement;

  const inputName = container.querySelector("#action-name") as HTMLInputElement;
  const selectMethod = container.querySelector("#action-method") as HTMLSelectElement;
  const inputUrl = container.querySelector("#action-url") as HTMLInputElement;
  const inputTimeoutMs = container.querySelector("#action-timeout-ms") as HTMLInputElement;
  const actionInputsContainer = container.querySelector("#action-inputs-container") as HTMLElement;
  const btnAddActionInput = container.querySelector("#btn-add-action-input") as HTMLButtonElement;

  const chkPage = container.querySelector("#ctx-page") as HTMLInputElement;
  const chkSelection = container.querySelector("#ctx-selection") as HTMLInputElement;
  const chkLink = container.querySelector("#ctx-link") as HTMLInputElement;
  const chkImage = container.querySelector("#ctx-image") as HTMLInputElement;

  // Header Elements
  const headersContainer = container.querySelector("#headers-rows-container") as HTMLElement;
  const btnAddHeaderRow = container.querySelector("#btn-add-header-row") as HTMLButtonElement;

  // Body Elements
  const bodyContainer = container.querySelector("#body-container") as HTMLElement;
  const radioBodyKv = container.querySelector("#mode-body-kv") as HTMLInputElement;
  const radioBodyRaw = container.querySelector("#mode-body-raw") as HTMLInputElement;
  const bodyKvPanel = container.querySelector("#body-kv-panel") as HTMLElement;
  const bodyRawPanel = container.querySelector("#body-raw-panel") as HTMLElement;
  const bodyKvRowsContainer = container.querySelector("#body-kv-rows-container") as HTMLElement;
  const btnAddBodyKvRow = container.querySelector("#btn-add-body-kv-row") as HTMLButtonElement;
  const inputBodyRaw = container.querySelector("#action-body-raw") as HTMLTextAreaElement;

  const btnInsertSelection = container.querySelector("#btn-insert-selection") as HTMLButtonElement;
  const btnInsertUrl = container.querySelector("#btn-insert-url") as HTMLButtonElement;

  const createActionInputRow = (input: Partial<ActionInput> = {}) => {
    const row = document.createElement("div");
    row.className = "input-group input-group-sm action-input-row";
    row.innerHTML = `
      <input type="text" class="form-control font-monospace action-input-key" placeholder="キー (例: userId)" required>
      <input type="text" class="form-control action-input-label" placeholder="表示名 (例: ユーザーID)" required>
      <select class="form-select action-input-type" style="max-width: 110px">
        <option value="text">テキスト</option>
        <option value="password">パスワード</option>
      </select>
      <div class="input-group-text" title="必須入力">
        <input class="form-check-input mt-0 action-input-required" type="checkbox" checked>
        <span class="ms-1 small">必須</span>
      </div>
      <button type="button" class="btn btn-outline-danger btn-remove-action-input" title="削除">
        <i class="bi bi-x-lg"></i>
      </button>
    `;

    const keyInput = row.querySelector(".action-input-key") as HTMLInputElement;
    const labelInput = row.querySelector(".action-input-label") as HTMLInputElement;
    const typeInput = row.querySelector(".action-input-type") as HTMLSelectElement;
    const requiredInput = row.querySelector(".action-input-required") as HTMLInputElement;

    keyInput.value = input.key ?? "";
    labelInput.value = input.label ?? "";
    typeInput.value = input.type ?? "text";
    requiredInput.checked = input.required ?? true;

    row.querySelector(".btn-remove-action-input")?.addEventListener("click", () => row.remove());
    actionInputsContainer.appendChild(row);
  };

  const collectActionInputs = (): ActionInput[] => {
    const inputs: ActionInput[] = [];
    actionInputsContainer.querySelectorAll(".action-input-row").forEach((row) => {
      inputs.push({
        key: (row.querySelector(".action-input-key") as HTMLInputElement).value.trim(),
        label: (row.querySelector(".action-input-label") as HTMLInputElement).value.trim(),
        type: (row.querySelector(".action-input-type") as HTMLSelectElement)
          .value as ActionInput["type"],
        required: (row.querySelector(".action-input-required") as HTMLInputElement).checked,
      });
    });
    return inputs;
  };

  btnAddActionInput.addEventListener("click", () => createActionInputRow());

  // Toggle method-based body display
  selectMethod.addEventListener("change", () => {
    if (selectMethod.value === "GET") {
      bodyContainer.classList.add("opacity-50");
    } else {
      bodyContainer.classList.remove("opacity-50");
    }
  });

  // Sync functions
  const syncKvToRaw = () => {
    const obj = collectBodyKv();
    inputBodyRaw.value = JSON.stringify(obj, null, 2);
  };

  const syncRawToKv = (): boolean => {
    const rawText = inputBodyRaw.value.trim();
    if (!rawText) {
      bodyKvRowsContainer.innerHTML = "";
      return true;
    }

    try {
      const parsed = JSON.parse(rawText);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        bodyKvRowsContainer.innerHTML = "";
        const keys = Object.keys(parsed);
        keys.forEach((k) => {
          const val = parsed[k];
          const strVal = typeof val === "object" ? JSON.stringify(val) : String(val ?? "");
          createBodyKvRow(k, strVal, getBodyScalarType(val));
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Switch Body Mode (KV vs Raw)
  radioBodyKv.addEventListener("change", () => {
    if (radioBodyKv.checked) {
      bodyMode = "kv";
      // Sync from Raw to KV
      const parsedSuccessfully = syncRawToKv();
      if (!parsedSuccessfully && inputBodyRaw.value.trim()) {
        // If raw is not valid key-value JSON, notify user or stay on raw
        const keepRaw = !confirm(
          "Rawの入力内容が単純なJSONオブジェクト形式ではないため、KVモードで一部崩れる可能性があります。変換を続けますか？",
        );
        if (keepRaw) {
          radioBodyRaw.checked = true;
          bodyMode = "raw";
          return;
        }
      }
      bodyKvPanel.classList.remove("d-none");
      bodyRawPanel.classList.add("d-none");
    }
  });

  radioBodyRaw.addEventListener("change", () => {
    if (radioBodyRaw.checked) {
      bodyMode = "raw";
      // Sync from KV to Raw
      syncKvToRaw();
      bodyKvPanel.classList.add("d-none");
      bodyRawPanel.classList.remove("d-none");
    }
  });

  // ----------------
  // Header Rows Helper
  // ----------------
  const createHeaderRow = (key = "", val = "") => {
    const row = document.createElement("div");
    row.className = "input-group input-group-sm header-row";
    row.innerHTML = `
      <input type="text" class="form-control font-monospace header-key" list="common-headers-list" placeholder="Key (e.g. Content-Type)" value="" style="max-width: 40%;">
      <input type="text" class="form-control font-monospace header-val" placeholder="Value (e.g. application/json)" value="">
      <button type="button" class="btn btn-outline-danger btn-remove-row" title="削除">
        <i class="bi bi-x-lg"></i>
      </button>
    `;
    (row.querySelector(".header-key") as HTMLInputElement).value = key;
    (row.querySelector(".header-val") as HTMLInputElement).value = val;
    row.querySelector(".btn-remove-row")?.addEventListener("click", () => row.remove());
    headersContainer.appendChild(row);
  };

  btnAddHeaderRow.addEventListener("click", () => createHeaderRow());

  container.querySelectorAll(".header-preset").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const k = el.getAttribute("data-key") || "";
      const v = el.getAttribute("data-val") || "";
      createHeaderRow(k, v);
    });
  });

  const collectHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    headersContainer.querySelectorAll(".header-row").forEach((row) => {
      const k = (row.querySelector(".header-key") as HTMLInputElement)?.value.trim();
      const v = (row.querySelector(".header-val") as HTMLInputElement)?.value;
      if (k) {
        headers[k] = v;
      }
    });
    return headers;
  };

  // ----------------
  // Body KV Rows Helper
  // ----------------
  const createBodyKvRow = (key = "", val = "", valueType?: BodyScalarType) => {
    const row = document.createElement("div");
    row.className = "input-group input-group-sm body-kv-row";
    row.innerHTML = `
      <input type="text" class="form-control font-monospace body-key" placeholder="Key (e.g. text)" value="" style="max-width: 35%;">
      <input type="text" class="form-control font-monospace body-val" placeholder="Value (e.g. {{selection}})" value="">
      <button type="button" class="btn btn-outline-secondary dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown" aria-expanded="false" title="変数を挿入">
      </button>
      <ul class="dropdown-menu dropdown-menu-end small">
        <li><a class="dropdown-item insert-var" href="#" data-val="{{selection}}">{{selection}} (選択文字列)</a></li>
        <li><a class="dropdown-item insert-var" href="#" data-val="{{page.url}}">{{page.url}} (URL)</a></li>
        <li><a class="dropdown-item insert-var" href="#" data-val="{{page.title}}">{{page.title}} (タイトル)</a></li>
        <li><a class="dropdown-item insert-var" href="#" data-val="{{link.url}}">{{link.url}} (リンクURL)</a></li>
        <li><a class="dropdown-item insert-var" href="#" data-val="{{image.url}}">{{image.url}} (画像URL)</a></li>
      </ul>
      <button type="button" class="btn btn-outline-danger btn-remove-kv-row" title="削除">
        <i class="bi bi-x-lg"></i>
      </button>
    `;

    const keyInput = row.querySelector(".body-key") as HTMLInputElement;
    const valInput = row.querySelector(".body-val") as HTMLInputElement;
    keyInput.value = key;
    valInput.value = val;
    if (valueType) row.dataset.valueType = valueType;

    keyInput.addEventListener("input", () => {
      if (bodyMode === "kv") syncKvToRaw();
    });

    valInput.addEventListener("input", () => {
      delete row.dataset.valueType;
      if (bodyMode === "kv") syncKvToRaw();
    });

    row.querySelectorAll(".insert-var").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        const placeholder = item.getAttribute("data-val") || "";
        valInput.value = placeholder;
        if (bodyMode === "kv") syncKvToRaw();
      });
    });

    row.querySelector(".btn-remove-kv-row")?.addEventListener("click", () => {
      row.remove();
      if (bodyMode === "kv") syncKvToRaw();
    });
    bodyKvRowsContainer.appendChild(row);
  };

  btnAddBodyKvRow.addEventListener("click", () => {
    createBodyKvRow();
    if (bodyMode === "kv") syncKvToRaw();
  });

  const parseKvValue = (val: string): unknown => {
    const trimmed = val.trim();
    // もし { または [ で始まっていれば JSON（オブジェクトや配列）として解釈
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // パースできなければそのまま文字列
        return val;
      }
    }
    // true / false
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    // 数値
    if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
      return Number(trimmed);
    }
    return val;
  };

  const collectBodyKv = (): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    bodyKvRowsContainer.querySelectorAll(".body-kv-row").forEach((row) => {
      const k = (row.querySelector(".body-key") as HTMLInputElement)?.value.trim();
      const v = (row.querySelector(".body-val") as HTMLInputElement)?.value ?? "";
      if (k) {
        const valueType = (row as HTMLElement).dataset.valueType;
        if (valueType === "string") {
          obj[k] = v;
        } else if (valueType === "number") {
          const parsed = Number(v);
          obj[k] = Number.isNaN(parsed) ? v : parsed;
        } else if (valueType === "boolean" && (v.trim() === "true" || v.trim() === "false")) {
          obj[k] = v.trim() === "true";
        } else {
          obj[k] = parseKvValue(v);
        }
      }
    });
    return obj;
  };

  // ----------------
  // Raw Mode Cursor Helpers
  // ----------------
  const insertAtCursor = (textarea: HTMLTextAreaElement, text: string) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    textarea.value = val.substring(0, start) + text + val.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
  };

  inputBodyRaw.addEventListener("input", () => {
    if (bodyMode === "raw") {
      syncRawToKv();
    }
  });

  btnInsertSelection?.addEventListener("click", () => {
    insertAtCursor(inputBodyRaw, "{{selection}}");
    if (bodyMode === "raw") {
      syncRawToKv();
    }
  });

  btnInsertUrl?.addEventListener("click", () => {
    insertAtCursor(inputBodyRaw, "{{page.url}}");
    if (bodyMode === "raw") {
      syncRawToKv();
    }
  });

  // ----------------
  // Form Reset
  // ----------------
  const resetForm = () => {
    currentEditingId = null;
    editorTitle.textContent = "新規アクション作成";
    btnCancelEdit.classList.add("d-none");
    btnDelete.classList.add("d-none");
    btnDuplicate.classList.add("d-none");
    form.reset();

    headersContainer.innerHTML = "";
    createHeaderRow("Content-Type", "application/json");

    actionInputsContainer.innerHTML = "";

    bodyKvRowsContainer.innerHTML = "";
    createBodyKvRow("text", "{{selection}}");
    createBodyKvRow("url", "{{page.url}}");

    inputBodyRaw.value = JSON.stringify({ text: "{{selection}}", url: "{{page.url}}" }, null, 2);
    inputTimeoutMs.value = "";

    radioBodyKv.checked = true;
    bodyMode = "kv";
    bodyKvPanel.classList.remove("d-none");
    bodyRawPanel.classList.add("d-none");

    chkPage.checked = true;
    chkSelection.checked = true;
    chkLink.checked = true;
    chkImage.checked = false;
  };

  btnCancelEdit.addEventListener("click", () => resetForm());

  // ----------------
  // Load Action For Edit
  // ----------------
  const loadActionForEdit = async (actionId: string) => {
    const actions = await getActions();
    const action = actions.find((a) => a.id === actionId);
    if (!action) return;

    currentEditingId = action.id;
    editorTitle.textContent = `アクション編集: ${action.name}`;
    btnCancelEdit.classList.remove("d-none");
    btnDelete.classList.remove("d-none");
    btnDuplicate.classList.remove("d-none");

    inputName.value = action.name;
    selectMethod.value = action.method;
    inputUrl.value = action.url;
    inputTimeoutMs.value = action.timeoutMs === undefined ? "" : String(action.timeoutMs);

    actionInputsContainer.innerHTML = "";
    for (const input of action.inputs ?? []) createActionInputRow(input);

    // Load Headers
    headersContainer.innerHTML = "";
    const headers = action.headers || {};
    const headerKeys = Object.keys(headers);
    if (headerKeys.length === 0) {
      createHeaderRow();
    } else {
      headerKeys.forEach((k) => {
        createHeaderRow(k, headers[k]);
      });
    }

    // Load Body: attempt to parse as simple key-value JSON
    bodyKvRowsContainer.innerHTML = "";
    inputBodyRaw.value = action.body || "";
    let isSimpleKv = false;

    if (action.body?.trim()) {
      try {
        const parsed = JSON.parse(action.body);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const keys = Object.keys(parsed);
          const allSimple = keys.every(
            (k) =>
              typeof parsed[k] === "string" ||
              typeof parsed[k] === "number" ||
              typeof parsed[k] === "boolean",
          );
          if (allSimple) {
            isSimpleKv = true;
            keys.forEach((k) => {
              const value = parsed[k];
              createBodyKvRow(k, String(value), getBodyScalarType(value));
            });
          }
        }
      } catch {
        isSimpleKv = false;
      }
    }

    if (isSimpleKv) {
      radioBodyKv.checked = true;
      bodyMode = "kv";
      bodyKvPanel.classList.remove("d-none");
      bodyRawPanel.classList.add("d-none");
    } else {
      radioBodyRaw.checked = true;
      bodyMode = "raw";
      bodyKvPanel.classList.add("d-none");
      bodyRawPanel.classList.remove("d-none");
    }

    const ctxs = action.contexts || [];
    chkPage.checked = ctxs.includes("page");
    chkSelection.checked = ctxs.includes("selection");
    chkLink.checked = ctxs.includes("link");
    chkImage.checked = ctxs.includes("image");

    if (action.method === "GET") {
      bodyContainer.classList.add("opacity-50");
    } else {
      bodyContainer.classList.remove("opacity-50");
    }

    container.scrollIntoView({ behavior: "smooth" });
  };

  btnDelete.addEventListener("click", async () => {
    if (!currentEditingId) return;
    if (!confirm("このアクションを削除してもよろしいですか？")) return;

    const actions = await getActions();
    const newActions = actions.filter((a) => a.id !== currentEditingId);
    await setActions(newActions);
    resetForm();
    options.onSaved?.();
  });

  btnDuplicate.addEventListener("click", async () => {
    if (!currentEditingId) return;
    const actions = await getActions();
    const target = actions.find((a) => a.id === currentEditingId);
    if (!target) return;

    const duplicated: HttpAction = {
      ...target,
      id: `action_${Date.now()}`,
      name: `${target.name} (コピー)`,
      order: actions.length,
    };

    actions.push(duplicated);
    await setActions(actions);
    options.onSaved?.();
    await loadActionForEdit(duplicated.id);
  });

  // ----------------
  // Form Submit
  // ----------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const timeoutText = inputTimeoutMs.value.trim();
    const timeoutMs = timeoutText ? Number(timeoutText) : undefined;
    if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
      inputTimeoutMs.setCustomValidity("1以上の整数を入力してください");
      inputTimeoutMs.reportValidity();
      return;
    }
    inputTimeoutMs.setCustomValidity("");

    const finalHeaders = collectHeaders();
    const actionInputs = collectActionInputs();
    const actionInputValidation = validateActionInputDefinitions(actionInputs);
    if (!actionInputValidation.valid) {
      alert(actionInputValidation.error);
      return;
    }

    // Determine final body
    let finalBody = "";
    if (selectMethod.value !== "GET") {
      if (bodyMode === "kv") {
        const obj = collectBodyKv();
        finalBody = JSON.stringify(obj, null, 2);
      } else {
        finalBody = inputBodyRaw.value;
      }
    }

    const contexts: ActionContext[] = [];
    if (chkPage.checked) contexts.push("page");
    if (chkSelection.checked) contexts.push("selection");
    if (chkLink.checked) contexts.push("link");
    if (chkImage.checked) contexts.push("image");

    const actions = await getActions();

    if (currentEditingId) {
      const idx = actions.findIndex((a) => a.id === currentEditingId);
      if (idx !== -1) {
        const updatedAction: HttpAction = {
          ...actions[idx],
          name: inputName.value.trim(),
          method: selectMethod.value as HttpMethod,
          url: inputUrl.value.trim(),
          headers: finalHeaders,
          body: finalBody,
          contexts,
        };
        if (actionInputs.length === 0) {
          delete updatedAction.inputs;
        } else {
          updatedAction.inputs = actionInputs;
        }
        if (timeoutMs === undefined) {
          delete updatedAction.timeoutMs;
        } else {
          updatedAction.timeoutMs = timeoutMs;
        }
        actions[idx] = updatedAction;
      }
    } else {
      const newAction: HttpAction = {
        id: `action_${Date.now()}`,
        name: inputName.value.trim(),
        method: selectMethod.value as HttpMethod,
        url: inputUrl.value.trim(),
        headers: finalHeaders,
        body: finalBody,
        contexts,
        enabled: true,
        order: actions.length,
        ...(actionInputs.length === 0 ? {} : { inputs: actionInputs }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      };
      actions.push(newAction);
    }

    await setActions(actions);
    resetForm();
    options.onSaved?.();
  });

  resetForm();

  return {
    loadActionForEdit,
    resetForm,
  };
}
