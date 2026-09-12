import type { ExecutionPageContext, ExecutionResult } from "../../types/actions";
import { getMissingRequiredActionInputs } from "../../utils/action-inputs";
import { executeHttpAction, showExecutionNotification } from "../../utils/executor";
import { logError } from "../../utils/logger";
import { saveLatestExecutionResult } from "../../utils/response-storage";
import { getActions } from "../../utils/storage";
import { executePreparedRequestInOffscreen } from "./offscreen";
import { failedExecutionResult } from "./result";
export async function findActionById(actionId: string) {
  const actions = await getActions();
  return actions.find((item) => item.id === actionId);
}

export async function executeActionById(
  actionId: string,
  pageContext: ExecutionPageContext = {},
  inputValues: Record<string, string> = {},
): Promise<ExecutionResult | undefined> {
  const action = await findActionById(actionId);

  if (!action) {
    logError(`Action not found: ${actionId}`, "background");
    return undefined;
  }

  const missingInputs = getMissingRequiredActionInputs(action, inputValues);
  if (missingInputs.length > 0) {
    return failedExecutionResult(
      actionId,
      `必須入力が不足しています: ${missingInputs.map((input) => input.key).join(", ")}`,
    );
  }

  const result = await executeHttpAction(
    action,
    pageContext,
    inputValues,
    executePreparedRequestInOffscreen,
  );
  await saveLatestExecutionResult(result).catch(() => {
    logError("最新レスポンスの一時保存に失敗しました", "background");
  });
  showExecutionNotification(result);
  return result;
}
