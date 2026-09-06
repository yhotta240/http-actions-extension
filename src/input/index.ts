import type { ActionInput, ExecutionResult } from "../types/actions";

interface InputPageData {
  success: true;
  actionId: string;
  actionName: string;
  inputs: ActionInput[];
}

interface ErrorResponse {
  success: false;
  error: string;
}

type InputPageResponse = InputPageData | ErrorResponse;

const requestId = new URLSearchParams(location.search).get("requestId") ?? "";
const form = document.querySelector("#input-form") as HTMLFormElement;
const title = document.querySelector("#title") as HTMLElement;
const description = document.querySelector("#description") as HTMLElement;
const message = document.querySelector("#message") as HTMLElement;

function setMessage(text: string, type: "error" | "success"): void {
  message.className = type;
  message.textContent = text;
}

function sendMessage<T>(messagePayload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(messagePayload, (response: T | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (response === undefined) {
        reject(new Error("Service Workerから応答を受信できませんでした"));
        return;
      }
      resolve(response);
    });
  });
}

function renderInputs(data: InputPageData): void {
  title.textContent = `実行入力: ${data.actionName}`;
  description.textContent = "リクエスト実行に必要な値を入力してください";
  form.innerHTML = "";

  for (const input of data.inputs) {
    const field = document.createElement("div");
    field.className = "field";

    const label = document.createElement("label");
    const inputId = `action-input-${input.key}`;
    label.htmlFor = inputId;
    label.textContent = `${input.label}${input.required ? " *" : ""}`;

    const inputElement = document.createElement("input");
    inputElement.id = inputId;
    inputElement.name = input.key;
    inputElement.type = input.type;
    inputElement.placeholder = `{{${input.key}}}`;
    inputElement.required = input.required;
    inputElement.autocomplete = "off";

    field.append(label, inputElement);
    form.appendChild(field);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `
    <button type="button" id="cancel">キャンセル</button>
    <button type="submit" id="submit">実行</button>
  `;
  form.appendChild(actions);

  const cancelButton = actions.querySelector("#cancel") as HTMLButtonElement;
  cancelButton.addEventListener("click", () => {
    void sendMessage({ type: "CANCEL_EXECUTION_INPUT", requestId })
      .catch(() => undefined)
      .finally(() => window.close());
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = actions.querySelector("#submit") as HTMLButtonElement;
    submitButton.disabled = true;
    setMessage("実行中です…", "success");

    const values: Record<string, string> = {};
    for (const input of data.inputs) {
      const element = form.elements.namedItem(input.key) as HTMLInputElement | null;
      values[input.key] = element?.value ?? "";
    }

    try {
      const result = await sendMessage<ExecutionResult>({
        type: "SUBMIT_EXECUTION_INPUT",
        requestId,
        values,
      });
      if (result.success) {
        setMessage(
          `${result.statusCode ?? 200} ${result.statusText ?? "OK"} で実行しました`,
          "success",
        );
      } else {
        setMessage(
          `${result.statusCode ? `${result.statusCode} ` : ""}${result.error || result.statusText || "実行に失敗しました"}`,
          "error",
        );
        submitButton.disabled = false;
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error), "error");
      submitButton.disabled = false;
    }
  });
}

async function initialize(): Promise<void> {
  if (!requestId) {
    setMessage("入力リクエストIDが指定されていません", "error");
    return;
  }

  try {
    const response = await sendMessage<InputPageResponse>({
      type: "GET_EXECUTION_INPUT",
      requestId,
    });
    if (!response.success) {
      setMessage(response.error, "error");
      return;
    }
    renderInputs(response);
  } catch (error: unknown) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

void initialize();
