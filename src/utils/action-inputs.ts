import type { ActionInput, HttpAction } from "../types/actions";

const ACTION_INPUT_KEY_PATTERN = /^[\p{L}\p{N}_-]+$/u;
const RESERVED_ACTION_INPUT_KEYS = new Set([
  "page",
  "link",
  "image",
  "var",
  "secret",
  "__proto__",
  "constructor",
  "prototype",
]);

export interface ActionInputValidationResult {
  valid: boolean;
  error?: string;
}

export function validateActionInputDefinitions(
  inputs: ActionInput[] = [],
): ActionInputValidationResult {
  const seenKeys = new Set<string>();

  for (const input of inputs) {
    const key = input.key.trim();
    if (!key) return { valid: false, error: "実行時入力のIDを入力してください" };
    if (!ACTION_INPUT_KEY_PATTERN.test(key)) {
      return {
        valid: false,
        error: `実行時入力のID「${key}」には英数字，日本語，_，-のみ使用できます`,
      };
    }
    if (RESERVED_ACTION_INPUT_KEYS.has(key)) {
      return {
        valid: false,
        error: `実行時入力のID「${key}」は予約されているため使用できません`,
      };
    }
    if (seenKeys.has(key)) {
      return { valid: false, error: `実行時入力のID「${key}」が重複しています` };
    }
    seenKeys.add(key);
  }

  return { valid: true };
}

export function getMissingRequiredActionInputs(
  action: HttpAction,
  values: Record<string, string> = {},
): ActionInput[] {
  return (action.inputs ?? []).filter(
    (input) => input.required && !(values[input.key] ?? "").trim(),
  );
}
