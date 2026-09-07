import { createBackup, parseBackup, restoreBackup } from "../../utils/backup";
import { logError } from "../../utils/logger";

/**
 * メニューボタンの挙動を設定する
 */
export function setupHeaderMenus(): void {
  const moreButton = document.getElementById("more-button");
  const moreMenu = document.getElementById("more-menu");
  const themeButton = document.getElementById("theme-button");
  const newTabButton = document.getElementById("new-tab-button");
  const settingsButton = document.getElementById("settings-button");
  const settingsMenu = document.getElementById("settings-menu");
  const exportButton = document.getElementById("export-data-button");
  const importButton = document.getElementById("import-data-button");
  const importInput = document.getElementById("import-data-input") as HTMLInputElement | null;

  if (!moreButton || !moreMenu) return;

  moreButton.addEventListener("click", (e) => {
    e.stopPropagation();
    settingsMenu?.classList.add("d-none");
    moreMenu.classList.toggle("d-none");
  });

  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (!moreMenu.contains(target) && !moreButton.contains(target)) {
      moreMenu.classList.add("d-none");
    }
    if (settingsMenu && !settingsMenu.contains(target) && !settingsButton?.contains(target)) {
      settingsMenu.classList.add("d-none");
    }
  });

  themeButton?.addEventListener("click", () => {
    moreMenu.classList.add("d-none");
    settingsMenu?.classList.add("d-none");
  });

  settingsButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    moreMenu.classList.add("d-none");
    settingsMenu?.classList.toggle("d-none");
  });

  newTabButton?.addEventListener("click", () => {
    chrome.tabs.create({ url: "popup.html" });
    moreMenu.classList.add("d-none");
  });

  exportButton?.addEventListener("click", async () => {
    settingsMenu?.classList.add("d-none");
    try {
      const backup = await createBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      link.href = url;
      link.download = `http-actions-backup-${date}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      const message = "JSONエクスポートに失敗しました（データ取得またはファイル作成）";
      await reportBackupError(message);
    }
  });

  importButton?.addEventListener("click", () => {
    settingsMenu?.classList.add("d-none");
    if (importInput) {
      importInput.value = "";
      importInput.click();
    }
  });

  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;

    let stage = "JSONの読み込み";
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      stage = "設定データの保存";
      const result = await restoreBackup(backup);
      window.alert(
        `JSONインポートが完了しました\nアクション: ${result.addedActions}件追加，${result.updatedActions}件更新\nVariables: ${result.addedVariables}件追加，${result.updatedVariables}件更新`,
      );
      window.location.reload();
    } catch {
      const reason = stage === "JSONの読み込み" ? "JSON読み込みまたは形式確認" : stage;
      await reportBackupError(`JSONインポートに失敗しました（${reason}）`);
    }
  });
}

async function reportBackupError(message: string): Promise<void> {
  await logError(message, "popup");
  window.alert(message);
}
