import type {
  ActionContext,
  ActionTrigger,
  ExecutionPageContext,
  TriggerCondition,
} from "../types/actions";

export const ACTION_CONTEXTS: ActionContext[] = ["page", "selection", "link", "image"];
export const ACTION_CONTEXT_LABELS: Record<ActionContext, string> = {
  page: "ページ全体",
  selection: "選択テキスト",
  link: "リンク",
  image: "画像",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTriggers(value: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(value)) return { valid: false, error: "トリガーの形式が不正です" };

  for (const trigger of value) {
    if (!isRecord(trigger)) return { valid: false, error: "トリガーの形式が不正です" };
    if (trigger.type === "contextMenu") {
      if (
        !Array.isArray(trigger.contexts) ||
        trigger.contexts.length === 0 ||
        !trigger.contexts.every((context) => ACTION_CONTEXTS.includes(context))
      ) {
        return { valid: false, error: "コンテキストメニューの表示対象を1つ以上選択してください" };
      }
    } else if (trigger.type === "pageLoad") {
      if (!Array.isArray(trigger.conditions) || trigger.conditions.length === 0) {
        return { valid: false, error: "ページ読み込みの条件を1つ以上設定してください" };
      }
      for (const condition of trigger.conditions) {
        if (
          !isRecord(condition) ||
          typeof condition.target !== "string" ||
          !["url", "domain", "title"].includes(condition.target) ||
          typeof condition.operator !== "string" ||
          !["equals", "contains", "startsWith", "endsWith", "matches"].includes(
            condition.operator,
          ) ||
          typeof condition.value !== "string" ||
          !condition.value.trim()
        ) {
          return { valid: false, error: "ページ読み込みの対象・条件タイプ・値を入力してください" };
        }
        if (condition.operator === "matches") {
          try {
            new RegExp(condition.value);
          } catch {
            return { valid: false, error: "ページ読み込みの正規表現が不正です" };
          }
        }
      }
    } else {
      return { valid: false, error: "未対応のトリガーです" };
    }
  }
  return { valid: true };
}

export function getContextMenuContexts(triggers: ActionTrigger[]): ActionContext[] {
  return [...new Set(triggers.flatMap((t) => (t.type === "contextMenu" ? t.contexts : [])))];
}

export function matchesCondition(condition: TriggerCondition, page: ExecutionPageContext): boolean {
  const actual = page[condition.target];
  if (actual === undefined || !condition.value.trim()) return false;
  switch (condition.operator) {
    case "equals":
      return actual === condition.value;
    case "contains":
      return actual.includes(condition.value);
    case "startsWith":
      return actual.startsWith(condition.value);
    case "endsWith":
      return actual.endsWith(condition.value);
    case "matches":
      try {
        return new RegExp(condition.value).test(actual);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function matchesPageLoad(triggers: ActionTrigger[], page: ExecutionPageContext): boolean {
  return triggers.some(
    (trigger) =>
      trigger.type === "pageLoad" &&
      trigger.conditions.length > 0 &&
      trigger.conditions.every((condition) => matchesCondition(condition, page)),
  );
}
