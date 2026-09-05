# Chrome Extension Starter Kit

TypeScript と Vite を使用して Chrome 拡張機能を開発するためのスターターキット

## 特徴

- TypeScript 対応: 静的型付けによる開発効率とコードの品質向上
- Vite 導入済み: TypeScript ファイルを高速にバンドル
- オートリロード機能: 開発モードでのファイル変更時に自動的に拡張機能をリロード（WebSocket 使用）
- Bootstrap UI: モダンで使いやすいポップアップ UI
- 基本的なファイル構成: 開発をすぐに開始できるよう必要なファイルが揃った状態

## 必要条件

- [Node.js](https://nodejs.org/) (v22.12.0 以上、またはv24.x以上を推奨)
- [npm](https://www.npmjs.com/) または [yarn](https://yarnpkg.com/)

## クイックスタート

### テンプレートから新しいリポジトリを作成（推奨）

このリポジトリをテンプレートとして使用して，コミット履歴を含まない新しいプロジェクトを開始できます．

GitHub CLI を使用する場合:

```bash
# テンプレートから新しいリポジトリを作成
gh repo create my-extension --template yhotamos/chrome-extension-starter-kit --private --clone
cd my-extension

# 依存関係をインストール
npm install

# 開発モード
npm run watch
```

GitHub UI を使用する場合:

1. [このリポジトリ](https://github.com/yhotamos/chrome-extension-starter-kit)にアクセス
2. 「Use this template」ボタンをクリック
3. 新しいリポジトリ名を入力して作成
4. 作成したリポジトリをクローンして使用

### コミット履歴をリセットして新規プロジェクトとして開始

既存のクローンからコミット履歴を削除して，新しいプロジェクトとして始めることもできます．

```bash
# リポジトリをクローン
git clone https://github.com/yhotamos/chrome-extension-starter-kit my-extension
cd my-extension

# Git履歴を削除
rm -rf .git

# 新しいGitリポジトリとして初期化
git init
git add .
git commit -m "initial commit"

# 依存関係をインストール
npm install

# 開発モード
npm run watch
```

### 通常のクローン（開発・貢献用）

このリポジトリに貢献する場合や，コミット履歴を保持したい場合は通常のクローンを使用します．

```bash
# リポジトリをクローン
git clone https://github.com/yhotamos/chrome-extension-starter-kit
cd chrome-extension-starter-kit

# 依存関係をインストール
npm install

# 開発モード
npm run watch

# または本番用ビルド
npm run build
```

### Chrome に拡張機能を読み込む

1. Chrome で `chrome://extensions/` を開く
2. 「デベロッパーモード」をオンにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `dist/` ディレクトリを選択

## 主要ファイルの説明

### マニフェストファイル

拡張機能の設定はマニフェストファイルで管理されます．このプロジェクトでは，開発用と本番用の 2 つのマニフェストを使用しています．

- `public/manifest.dev.json`: 開発用マニフェスト（オートリロード機能など開発用設定を含む）
- `public/manifest.prod.json`: 本番用マニフェスト（公開時に使用）
- `public/manifest.meta.json`: メタ情報用マニフェスト

ビルドプロセスに応じて，Vite が自動的に適切なマニフェストを `dist/` にコピーします．

### コアスクリプト

- `src/background/dev.ts`: 開発用バックグラウンドスクリプト（開発時のみ使用）
- `src/background/index.ts`: バックグラウンドで常駐し，イベント処理や状態管理を行います．例: API 呼び出し，タブ管理，通知の送信など．
- `src/content/index.ts`: Web ページに挿入され，DOM 操作やページとのやり取りを行います．例: ページ内容の解析，要素の追加・変更，スクレイピングなど．
- `src/popup/index.ts`: ポップアップ（`popup.html`）に関連する処理を記述します．例: UI イベントハンドラー，ユーザアクションの処理など．

### ユーティリティ関数

`src/utils/` 配下に汎用的な関数をまとめています．

### アイコン

- `public/icons/` にアイコンファイルを配置します．
- 使用サイズを揃え，マニフェストファイルで参照してください．

### ポップアップの UI

ポップアップの HTML 構造は `public/popup.html` に記述します．
ベースのスタイルは Bootstrap を使用しており，カスタマイズは `src/popup/popup.css` で行います．

初期状態のポップアップ UI は，シンプルなタブ構成を想定しています．

- 設定タブ：
  機能のオン／オフや基本的な設定を行います．

- ドキュメントタブ：
  拡張機能の使い方や簡単なヘルプを表示します．

- バージョンタブ：
  現在の拡張機能のバージョンや更新内容を表示します．

- 情報タブ：
  作者情報，ライセンス，外部リンクなどを表示します．

#### ポップアップ UI のスクリーンショット

左側はポップアップとして表示されるデフォルトの UI です．
右側のように，新しいタブとして開いて表示することもできます．

![Popup UI](https://lh3.googleusercontent.com/d/1CFzXMhYtzmNPvMRHAjKg98TMk5bgMfwO)

### ドキュメント（ポップアップ）機能

ポップアップの「ドキュメント」タブは，`docs/*.md` を読み込んでアコーディオン表示します．

- 読み込み元: `docs/overview.md`, `docs/tutorial.md`
- 表示処理: `src/popup/components/document.ts`
- Markdown変換: `scripts/plugins/markdown.ts`（Front Matter と CHANGELOG を解析し，本文を HTML 化）

各 `.md` は先頭に Front Matter を持てます（例）:

```yaml
---
id: overview
title: 概要
order: 1
visible: true
expanded: true
date: 2026-02-19
lang: ja
---
```

- `order`: 小さい順で表示
- `visible`: `false` なら非表示
- `expanded`: 初期表示で開くかどうか

新しいドキュメントを追加する場合は，`.md` を作成したうえで `src/popup/components/document.ts` の `allDocs` に追加してください．

### 公開スクリプト

公開に関連する npm スクリプトは以下の通りです．

- `npm run pack`
  - `dist/` ディレクトリの内容を ZIP 圧縮して `releases/` に出力します．
  - 出力先：`releases/<package-name>-<version>.zip`

- `npm run release`
  - `releases/` ディレクトリの最新の ZIP を Chrome Web Store にアップロードして公開します．
  - `.env` に必要な環境変数が設定されている必要があります（後述）．
  - `EXTENSION_ID` が必要なため，初回は `npm run pack` で作成した ZIP を手動で Chrome Web Store にアップロードし，`EXTENSION_ID` を取得してください．取得後は，2回目以降 `npm run release` で公開できます．

`npm run release` を使用するには，`.env` に次の環境変数を設定する必要があります．
`.env.example` を参考にして `.env` ファイルを作成してください．

```env
EXTENSION_ID=...
CLIENT_ID=...
CLIENT_SECRET=...
REFRESH_TOKEN=...
PUBLISHER_ID=...
```

これらが不足している場合，スクリプトはエラーで停止します．詳しくは [github.com/yhotamos/extension-release-cli](https://github.com/yhotamos/extension-release-cli) のドキュメントを参照してください．

## 開発ワークフロー

### 日常的な開発サイクル

1. Watch モードで起動

   ```bash
   npm run watch
   ```

2. コードを編集
   - `src/` 配下のファイルを編集
   - 保存すると自動でビルドされ，拡張機能が自動リロードされます

3. 動作確認
   - ポップアップやコンソールで確認
   - オートリロード機能により，手動でのリロードは不要です

### よくある開発タスク

本スターターキットでは，Chrome 拡張機能開発で頻繁に行われる典型的な作業を簡単に追加・拡張できます．以下は代表的な例です．

#### コンテンツスクリプトで DOM を操作する

コンテンツスクリプトでは，Web ページ上の要素を取得し，内容やスタイルを変更できます．

```typescript
// src/content/index.ts
const title = document.querySelector("h1");
if (title) {
  title.style.outline = "2px solid red";
}
```

主に次のような用途で使用されます．

- 要素の取得
- テキストの書き換え
- スタイルの変更

多くの拡張機能で利用される基本的な処理です．

#### ポップアップ UI をカスタマイズする

ポップアップは拡張機能の設定や操作を行う主要な UI です．必要に応じて以下のファイルを編集してください．

1. `public/popup.html` に設定 UI を追加
2. `src/popup/popup.css` でスタイルを調整
3. `src/popup/index.ts` でイベント処理を実装

主に以下のような機能を追加できます．

- ボタンの追加
- 機能の ON／OFF 切り替え
- 設定値の表示や更新

#### バックグラウンドスクリプトで処理を実行する

バックグラウンドスクリプトでは，拡張機能全体に関わる処理やタブ・イベントの監視などを行います．
常駐処理や他スクリプトとの橋渡し役として利用されます．

```typescript
// src/background/index.ts
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed");
});
```

主に次のような用途で使用されます．

- 拡張機能の初期化処理
- タブやブラウザイベントの監視
- コンテンツスクリプトやポップアップとのメッセージ連携

#### UI 文言・説明文を調整する

ユーザにとって分かりやすい拡張機能にするためには，UI 文言や説明文の調整も重要です．

- ポップアップやオプション画面のラベルを分かりやすくする
- README の説明を整理する
- 技術的な表現をユーザ向けに調整する

例：

```text
設定時にボタンをクリックすることで，
ユーザが開いているタブの URL を取得し，
設定を簡単に行えるようにします．
```

## オートリロード機能について

開発モード（`npm run watch`）では，ファイルを保存すると自動的に拡張機能がリロードされます．

### 仕組み

- Vite が watch モードで起動し，ファイル変更を監視
- ビルド完了後，WebSocket サーバー（ポート 6571）にリロード信号を送信
- 拡張機能の background スクリプトが信号を受け取り，`chrome.runtime.reload()` を実行

### 注意事項

- オートリロード機能は開発モードのみで動作します
- 本番ビルド（`npm run build`）では含まれません
- WebSocket サーバーはローカルホスト（localhost:6571）で動作します
- 拡張機能全体が再起動されるため，状態は保持されません
- Service Worker が有効である必要があります
  - `chrome://extensions/` で拡張機能の「Service Worker」の横に「無効」と表示されている場合，「ビューを検証」をクリックして有効化してください
  - Service Worker が無効だと WebSocket 接続ができず，オートリロードが動作しません

## トラブルシューティング

### オートリロードが動作しない

1. Service Worker が有効か確認
   - `chrome://extensions/` で拡張機能の詳細を開く
   - 「Service Worker」の横に「無効」と表示されている場合，「ビューを検証」をクリック
   - DevTools が開き，Service Worker が有効化されます
2. `npm run watch` が正常に起動しているか確認
3. ブラウザのコンソール（または Service Worker の DevTools）で WebSocket 接続エラーがないか確認
4. ポート 6571 が他のプロセスに使用されていないか確認

### ビルドエラーが出る

```bash
# node_modules を削除して再インストール
rm -rf node_modules package-lock.json
npm install
npm run build
```

### 拡張機能が動作しない

1. `chrome://extensions/` でエラーメッセージを確認
2. ブラウザのコンソール（F12）でエラーを確認
3. `manifest.json` の permissions が正しいか確認
4. ビルドが成功しているか確認（`dist/` に成果物があるか）

### 設定が保存されない

1. `chrome.storage` の permissions が `manifest.json` にあるか確認
2. ブラウザのコンソールでエラーを確認
3. `src/settings.ts` の型定義が正しいか確認

## ライセンス

MIT License

## 作者

- yhotta240 (https://github.com/yhotta240)
