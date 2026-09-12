import type { ExecutionResult } from "../../types/actions";

export function failedExecutionResult(actionId: string, error: string): ExecutionResult {
  return {
    actionId,
    actionName: actionId,
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}
