import type { ExecutionPageContext } from "../../types/actions";
import { logError, logWarn } from "../../utils/logger";
import { getActions, isEnabled } from "../../utils/storage";
import { matchesPageLoad } from "../../utils/triggers";
import { executeActionById } from "../execution/actions";
export async function handlePageLoad(
  details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
): Promise<void> {
  if (
    details.frameId !== 0 ||
    (details.documentLifecycle && details.documentLifecycle !== "active")
  )
    return;
  const url = new URL(details.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (!(await isEnabled())) return;

  const actions = (await getActions()).filter(
    (action) => action.enabled && action.triggers.some((trigger) => trigger.type === "pageLoad"),
  );
  if (actions.length === 0) return;

  // 対象タブの情報を使う。読み込み後に閉じられた／別ページへ移動したタブは評価しない。
  const tab = await chrome.tabs.get(details.tabId).catch(() => undefined);
  if (!tab || tab.url !== details.url) return;
  const pageContext: ExecutionPageContext = {
    url: details.url,
    domain: url.hostname,
    title: tab.title,
  };

  await Promise.all(
    actions
      .filter((action) => matchesPageLoad(action.triggers, pageContext))
      .map(async (action) => {
        try {
          if (action.inputs?.length) {
            await logWarn(
              `「${action.name}」のページ読み込みによる自動実行をスキップしました（実行時入力あり）`,
              "background",
            );
            return;
          }
          await executeActionById(action.id, pageContext);
        } catch (error) {
          await logError(
            `「${action.name}」のページ読み込みによる自動実行に失敗しました`,
            "background",
            error,
          );
        }
      }),
  );
}
