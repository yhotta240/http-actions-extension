import type {
  ActionInput,
  ExecutionInputRequired,
  ExecutionPageContext,
  ExecutionResult,
} from "../../types/actions";
import { getMissingRequiredActionInputs } from "../../utils/action-inputs";
import { logError } from "../../utils/logger";
import { getSessionStorage, removeSessionStorage, setSessionStorage } from "../../utils/storage";
import { executeActionById, findActionById } from "./actions";
import { failedExecutionResult } from "./result";

const INPUT_PAGE_PATH = "input.html";
const PENDING_INPUT_KEY_PREFIX = "pending-input:";
interface PendingInputRequest {
  actionId: string;
  pageContext: ExecutionPageContext;
}

interface ExecutionInputPageData {
  success: true;
  actionId: string;
  actionName: string;
  inputs: ActionInput[];
}

type ExecuteActionResponse = ExecutionResult | ExecutionInputRequired;

function pendingInputStorageKey(requestId: string): string {
  return `${PENDING_INPUT_KEY_PREFIX}${requestId}`;
}

async function openExecutionInputPage(
  actionId: string,
  actionName: string,
  pageContext: ExecutionPageContext,
): Promise<ExecutionInputRequired> {
  const requestId = crypto.randomUUID();
  await setSessionStorage({
    [pendingInputStorageKey(requestId)]: {
      actionId,
      pageContext,
    } satisfies PendingInputRequest,
  });

  try {
    const inputUrl = `${chrome.runtime.getURL(INPUT_PAGE_PATH)}?requestId=${encodeURIComponent(requestId)}`;
    await chrome.windows.create({
      url: inputUrl,
      type: "popup",
      width: 460,
      height: 560,
    });
  } catch (error: unknown) {
    await removeSessionStorage(pendingInputStorageKey(requestId)).catch(() => undefined);
    throw error;
  }

  return { inputRequired: true, requestId, actionName };
}

export async function startActionById(
  actionId: string,
  pageContext: ExecutionPageContext = {},
): Promise<ExecuteActionResponse | undefined> {
  const action = await findActionById(actionId);
  if (!action) {
    logError(`Action not found: ${actionId}`, "background");
    return undefined;
  }

  if (action.inputs && action.inputs.length > 0) {
    return openExecutionInputPage(action.id, action.name, pageContext);
  }

  return executeActionById(actionId, pageContext);
}

export async function getExecutionInput(
  requestId: string,
): Promise<ExecutionInputPageData | { success: false; error: string }> {
  const stored = await getSessionStorage<{ [key: string]: PendingInputRequest }>(
    pendingInputStorageKey(requestId),
  );
  const pending = stored[pendingInputStorageKey(requestId)];
  const action = pending ? await findActionById(pending.actionId) : undefined;
  if (!pending || !action?.inputs?.length) {
    return { success: false, error: "実行入力の情報が見つかりません" };
  }
  return { success: true, actionId: action.id, actionName: action.name, inputs: action.inputs };
}
export async function submitExecutionInput(
  requestId: string,
  values: Record<string, unknown>,
): Promise<ExecutionResult> {
  const stored = await getSessionStorage<{ [key: string]: PendingInputRequest }>(
    pendingInputStorageKey(requestId),
  );
  const pending = stored[pendingInputStorageKey(requestId)];
  if (!pending) {
    return failedExecutionResult("", "実行入力の有効期限が切れています");
  }

  const action = await findActionById(pending.actionId);
  if (!action) {
    return failedExecutionResult(pending.actionId, "アクションが見つかりません");
  }

  const inputValues: Record<string, string> = {};
  for (const input of action.inputs ?? []) {
    const value = values[input.key];
    inputValues[input.key] = typeof value === "string" ? value : "";
  }
  const missingInputs = getMissingRequiredActionInputs(action, inputValues);
  if (missingInputs.length > 0) {
    return failedExecutionResult(
      action.id,
      `必須入力が不足しています: ${missingInputs.map((input) => input.key).join(", ")}`,
    );
  }

  const result = await executeActionById(action.id, pending.pageContext, inputValues);
  if (result?.success) {
    await removeSessionStorage(pendingInputStorageKey(requestId)).catch((error: unknown) => {
      logError("実行入力の一時データ削除に失敗しました", "background", error);
    });
  }
  return result ?? failedExecutionResult(action.id, "アクションの実行に失敗しました");
}
export function cancelExecutionInput(requestId: string): Promise<void> {
  return removeSessionStorage(pendingInputStorageKey(requestId));
}
