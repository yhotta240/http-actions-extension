import type { ExecutionResult } from "../types/actions";
import { getSessionStorage, setSessionStorage } from "./storage";

export const LATEST_EXECUTION_RESULT_KEY = "latest_execution_result";
export const MAX_RESPONSE_BODY_LENGTH = 100 * 1024;

export interface StoredExecutionResult extends ExecutionResult {
  responseBodyTruncated?: boolean;
}

export async function saveLatestExecutionResult(result: ExecutionResult): Promise<void> {
  const responseBody = result.responseBody ?? "";
  const responseBodyTruncated = responseBody.length > MAX_RESPONSE_BODY_LENGTH;
  const storedResult: StoredExecutionResult = {
    ...result,
    responseBody: responseBodyTruncated
      ? responseBody.slice(0, MAX_RESPONSE_BODY_LENGTH)
      : result.responseBody,
    responseBodyTruncated,
  };

  await setSessionStorage({ [LATEST_EXECUTION_RESULT_KEY]: storedResult });
}

export async function getLatestExecutionResult(): Promise<StoredExecutionResult | undefined> {
  const result = await getSessionStorage<{
    [LATEST_EXECUTION_RESULT_KEY]?: StoredExecutionResult;
  }>(LATEST_EXECUTION_RESULT_KEY);
  return result[LATEST_EXECUTION_RESULT_KEY];
}
