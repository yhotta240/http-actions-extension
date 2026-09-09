# HTTP Actions

HTTPリクエストをアクションとして登録し，ポップアップや右クリックメニューから実行できるChrome拡張機能です．

## 主な機能

- HTTPリクエストのアクション登録・編集
- ポップアップと右クリックメニューからの実行
- ページ情報，実行時入力，変数，シークレットのテンプレート展開
- ヘッダーとJSON（KV）・Raw形式の本文編集
- HTTPレスポンスの表示
- 実行結果の通知とログ表示

## インストール

### Chrome Web Store からインストール

[HTTP Actions - Chrome ウェブストア](https://chrome.google.com/webstore/detail/http-actions/pokpmgkcbccalbhademgdijckcheekjm)

### 手動インストール

必要条件

- [Node.js](https://nodejs.org/) (v18.x 以上を推奨)
- [npm](https://www.npmjs.com/) または [yarn](https://yarnpkg.com/)

手順

1. このリポジトリをクローン

   ```bash
   git clone https://github.com/yhotta240/http-actions-extension.git
   cd http-actions-extension
   ```

2. 依存関係をインストール

   ```bash
   npm install
   ```

3. ビルド

   ```bash
   npm run build
   ```

4. Chrome に読み込む
   - Chrome で `chrome://extensions/` を開く
   - 「デベロッパーモード」をオンにする
   - 「パッケージ化されていない拡張機能を読み込む」をクリック
   - `dist/` ディレクトリを選択

## 使い方

- [機能概要](docs/overview.md)
- [操作チュートリアル](docs/tutorial.md)
- [プライバシーポリシー](docs/policies/privacy-policy.md)

初回起動時には，動作確認用のサンプルアクションが登録されます．利用前に送信先と本文を確認してください．

## ライセンス

MIT License

## 作者

- [yhotta240](https://github.com/yhotta240)
