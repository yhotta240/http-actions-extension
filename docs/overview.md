---
id: overview
title: 概要
order: 1
visible: true
expanded: true
date: 2026-09-06
lang: ja
---

## HTTP Actionsとは

HTTP Actionsは，Webページの情報を使って，登録済みのHTTPリクエストを実行するChrome拡張機能です．

ポップアップからアクションを直接実行できるほか，ページ上で右クリックして，ページURL，選択文字列，リンクURL，画像URLをAPIやWebhookへ送信できます．

## 主な機能

- GET，POST，PUT，PATCH，DELETEへの対応
- ページ，選択文字列，リンク，画像ごとのコンテキストメニュー
- ヘッダーのKey-Value編集
- JSON（KV）とRaw形式の本文編集
- ページ情報，変数，シークレットのテンプレート展開
- 実行結果の通知とログ表示

## テンプレート

URL，ヘッダー，本文には，`{{page.url}}`，`{{page.title}}`，`{{selection}}`，`{{link.url}}`，`{{image.url}}`などを埋め込めます．「変数」タブで登録した値は`{{var.キー名}}`，シークレットは`{{secret.キー名}}`で参照できます．

詳しい設定方法とプレースホルダーの一覧は「チュートリアル」を確認してください．

## データについて

アクション，変数，シークレット，ログはChromeのローカルストレージに保存されます．アクションを実行すると，設定した送信先へ指定したデータが送信されます．
