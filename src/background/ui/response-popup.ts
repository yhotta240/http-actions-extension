import { getLatestExecutionResult } from "../../utils/response-storage";

const RESPONSE_ACTION_ID_PARAM = "responseActionId";
const EXPAND_RESPONSE_PARAM = "expandResponse";
const RESPONSE_ONLY_PARAM = "responseOnly";
let responseWindowId: number | undefined;
export async function openLatestResponsePopup(): Promise<void> {
  const latestResult = await getLatestExecutionResult();
  if (!latestResult) return;

  const popupUrl = new URL(chrome.runtime.getURL("popup.html"));
  popupUrl.searchParams.set(RESPONSE_ACTION_ID_PARAM, latestResult.actionId);
  popupUrl.searchParams.set(EXPAND_RESPONSE_PARAM, "1");
  popupUrl.searchParams.set(RESPONSE_ONLY_PARAM, "1");

  if (responseWindowId !== undefined) {
    try {
      const responseWindow = await chrome.windows.get(responseWindowId, { populate: true });
      const responseTab = responseWindow.tabs?.[0];
      if (responseTab?.id === undefined) throw new Error("レスポンス表示タブが見つかりません");

      await chrome.tabs.update(responseTab.id, { url: popupUrl.toString(), active: true });
      await chrome.windows.update(responseWindowId, { focused: true });
      return;
    } catch {
      responseWindowId = undefined;
    }
  }

  const responseWindow = await chrome.windows.create({
    url: popupUrl.toString(),
    type: "popup",
    width: 480,
    height: 480,
    focused: true,
  });
  if (responseWindow?.id === undefined) {
    throw new Error("レスポンス表示ウィンドウを作成できませんでした");
  }
  responseWindowId = responseWindow.id;
}
