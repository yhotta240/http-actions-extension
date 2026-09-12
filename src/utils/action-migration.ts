import type { ActionContext, HttpAction } from "../types/actions";
import { ACTION_CONTEXTS } from "./triggers";

export type StoredHttpAction =
  | HttpAction
  | (Omit<HttpAction, "triggers"> & { contexts: ActionContext[] });

// 旧形式は読み込み境界で変換する。明示的な triggers: [] は手動実行専用を表す。
export function normalizeAction(action: StoredHttpAction): HttpAction {
  const { contexts, ...current } = action as HttpAction & { contexts?: ActionContext[] };
  if (current.triggers !== undefined) return current;
  return {
    ...current,
    triggers: [
      { type: "contextMenu", contexts: contexts?.length ? [...contexts] : [...ACTION_CONTEXTS] },
    ],
  };
}
