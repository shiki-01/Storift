# UI ガイドライン

画面を作るときの共通の取り決め。見た目の色は `src/app.css` の `--color-*` / `--editor-*`(テーマ追従)を使う。

## テキスト選択(user-select)

UI の操作部品は選択できず、本文や、コピーしたくなる情報は選択できる。

- 既定: `body` が `user-select: none`(`-webkit-user-select` と `-webkit-touch-callout: none` を併記)。
  `src/app.css` の `@layer base` で全要素が親の値を引き継ぐ(`user-select: inherit`)ので、`getComputedStyle(el).userSelect` は常に `none` か `text` になる。
- 選択可にする: `input` / `textarea` / `select` / `[contenteditable]` / `pre` / `code` / `[role='alert']` は自動で `text`。
  それ以外の本文・情報には **`.selectable` クラス**を付ける(子孫も選択できる)。
  `.selectable` や `[role='alert']` の中のボタン・`summary` は `none` のまま。
- 選択できない領域の中に選択できる領域を置いてよい(子孫の `text` が効く)。
- ドラッグ操作(並べ替え・相関図・スクロール)の対象になる要素には `.selectable` を付けない。

### 対応表

| 領域                                                                                | 選択 | 備考                             |
| ----------------------------------------------------------------------------------- | ---- | -------------------------------- |
| ナビ(AppRail・下部ナビ・ヘッダー)、ツールバー、タブ、サイドバー、シーン一覧         | 不可 |                                  |
| ボタン、ラベル、見出し、バッジ、メニュー、カードの枠、アイコン、保存状態、進捗バー  | 不可 |                                  |
| ダイアログのタイトル・ボタン、設定の項目名・セクション見出し                        | 不可 |                                  |
| チュートリアル、セットアップの案内文                                                | 不可 |                                  |
| エディタ本文(`contenteditable`)、入力欄                                             | 可   | Ctrl+A は本文だけを選ぶ          |
| プレビュー本文、通読の本文(`.body`)                                                 | 可   |                                  |
| AI の回答・ユーザーの質問・ツール結果・エラー文(`.msg`)                             | 可   | 操作ボタンは不可                 |
| メモの本文                                                                          | 可   |                                  |
| プロット・人物・設定資料の本文と説明                                                | 可   | レイアウトの作り直し時も維持する |
| 競合ダイアログの差分・抜粋、履歴・バックアップの内容、バージョン比較の差分          | 可   |                                  |
| エラーメッセージ(エラーページ、トースト、`role="alert"`)                            | 可   |                                  |
| 設定コード、招待リンク、ID、バージョン、診断ログ、同期の記録、Firebase ルールの全文 | 可   | `pre` / `code` / `.selectable`   |

テストは `bun run test:e2e:user-select`(`tests/e2e/user-select.spec.mjs`)。

## スクロールバーと位置ずれ

このアプリは `html` / `body` ではなく、各ページの縦スクロールのコンテナがスクロールする。
ページの主スクロールコンテナには **`.scroll-stable`**(`scrollbar-gutter: stable`)を付け、スクロールの有無で内容の位置がずれないようにする。

- `scrollbar-gutter` 未対応の環境では `overflow-y: scroll` で代替する(`app.css`)。
- オーバーレイのスクロールバー(macOS・モバイル)は幅 0 なので、余白は増えない。
- `html` / `body` には付けない(スクロールしないのに右端に空きができる)。
- 縦書きで横にスクロールするコンテナには付けない。
- ヘッダーがスクロールコンテナの外にあるページ(プロット・人物・設定資料・進捗)は、クラシックスクロールバーの環境で、ヘッダーと本文の左右がスクロールバー幅の半分だけずれる(従来もスクロールが入るページでは同じだった)。

テストは `bun run test:e2e:scrollbar`。

## 部品

- セレクト: `<select>` ではなく `src/lib/components/ui/Select.svelte`(`options` / `value` / `size`)。
  ポップアップは `body` 直下に `position: fixed` で出し、空きの広い側へ開く。`bun run test:e2e:ai-select`。
- 進捗バー: `src/lib/components/ui/ProgressBar.svelte`(`value` は 0〜1、`null` は不確定)。高さ・角丸・色はここで揃える。
- アイコン: 絵文字や記号文字(✓ ⚠ ⏳ など)は使わず、`src/lib/components/editor/icons/*.svg` を `Icon.svelte` で出す。
  色は `currentColor` にし、固定の黒・白は使わない。インラインで使うときは `class="ico"`(`1em` 角)。
- 保存状態: `src/lib/components/ui/SaveState.svelte`。全ラベルを同じセルに重ねて幅を固定する。
