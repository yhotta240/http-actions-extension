# HTTP Actions

Chromeのコンテキストメニューやポップアップから，Webページの情報を使った任意のHTTPリクエストを送信できる拡張機能です．

## 主な機能

- GET，POST，PUT，PATCH，DELETEへの対応
- ページ，選択文字列，リンク，画像に対応したコンテキストメニュー
- JSON（KV）またはRaw形式の本文編集
- テンプレート変数，ユーザー定義変数，シークレット
- 実行結果の通知とログ表示

## クイックスタート

```bash
npm install
npm run build
```

ビルド後，Chromeで`chrome://extensions/`を開き，「デベロッパーモード」→「パッケージ化されていない拡張機能を読み込む」から`dist/`を選択してください．

## 使い方

- [機能概要](docs/overview.md)
- [操作チュートリアル](docs/tutorial.md)
- [プライバシーポリシー](docs/policies/privacy-policy.md)

初回起動時には，動作確認用のサンプルアクションが登録されます．利用前に送信先と本文を確認してください．

## 開発

```bash
# 開発用ビルドと自動リロード
npm run watch

# 開発用マニフェストを使ったビルド
npm run build:dev

# チェックと本番用ビルド
npm run check
npm run typecheck
npm run build
```

実装の構成やドキュメントの追加方法は，リポジトリ内の各ファイルと[ドキュメント](docs/overview.md)を参照してください．

## ライセンス

MIT License

## 作者

- [yhotta240](https://github.com/yhotta240)
