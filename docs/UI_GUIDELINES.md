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
- ヘッダーがスクロールコンテナの外にあるページ(進捗)は、クラシックスクロールバーの環境で、ヘッダーと本文の左右がスクロールバー幅の半分だけずれる(従来もスクロールが入るページでは同じだった)。

- プロットは、ボードの列の本体(`.col-body`)とタイムライン、詳細ペインがそれぞれスクロールするので、それぞれに `.scroll-stable` を付けている。人物・設定資料は、一覧(`.list-scroll`)と詳細ペイン、相関図の領域に付けている。

テストは `bun run test:e2e:scrollbar`。

## 部品

- セレクト: `<select>` ではなく `src/lib/components/ui/Select.svelte`(`options` / `value` / `size`)。
  ポップアップは `body` 直下に `position: fixed` で出し、空きの広い側へ開く。`bun run test:e2e:ai-select`。
  `menuMinWidth` を省略すると、`size="sm"` のポップアップ最小幅は 160px(`md` はトリガーの幅)。
  `SelectOption.style` に インラインスタイルを渡すと項目の文字に当たる(例: フォント選択で `font-family`)。省略した項目には何も付かない。
- 進捗バー: `src/lib/components/ui/ProgressBar.svelte`(`value` は 0〜1、`null` は不確定)。高さ・角丸・色はここで揃える。
- アイコン: 絵文字や記号文字(✓ ⚠ ⏳ など)は使わず、`src/lib/components/editor/icons/*.svg` を `Icon.svelte` で出す。
  色は `currentColor` にし、固定の黒・白は使わない。インラインで使うときは `class="ico"`(`1em` 角)。
- 保存状態: `src/lib/components/ui/SaveState.svelte`。全ラベルを同じセルに重ねて幅を固定する。
- 色選択: `<input type="color">` は使わず `src/lib/components/ui/ColorPicker.svelte`(インライン表示と `popover` 表示)。計算は `colorLogic.ts`。
- 相関図の操作: ズームなどは `src/lib/components/relation/RelationControls.svelte`。ライブラリ既定のコントロールやラベルの白い箱は使わず、`--color-background` / `--color-text` のトークンで描く。
- AI 返答の資料リンク: AI には内部名や id を出させず、`[[種別:id|表示名]]` で書かせる(指示は `src/lib/ai/refs.ts`)。描画は `linkifyRefs`、遷移は `src/lib/desktop/refLinks.ts` の `openRef`、同じ画面での選択は `itemNav.svelte.ts`。
- ツールバーの表示設定: 項目は `src/lib/utils/toolbarItems.ts` に定義し、三点メニューへまとめる項目は `AppSettings.toolbarMenuItems`、並び順は `AppSettings.toolbarOrder` に保存する(どちらも未設定なら既定の順で全表示)。項目を足すときは定義(`TOOLBAR_ITEMS`)と、`editor/+page.svelte` の `toolDefs`(`Record<ToolbarItemId, …>` なので、足し忘れると型エラーになる)に加える。既存の ID と `data-tour` は変えない。AI のボタンは並べ替えの対象外で、右端側に固定する。拡張の項目(`ext:<拡張 ID>`)も同じ仕組みで並べ替え・まとめができる(詳細は [EXTENSIONS.md](EXTENSIONS.md))。
- ポップオーバー: ボタンから開く小さな非モーダルのパネルは `src/lib/components/ui/Popover.svelte`(`bind:open` / `anchor` / `label` / `align`、中身は `children` スニペットで、`close` を受け取る)。
  本体は `body` 直下に `position: fixed` で出し、起点の下に開く。収まらなければ上へ反転し、画面端では補正する(計算は `popoverPosition.ts`)。
  Escape と外側のクリックで閉じ、Escape と `close()` では起点にフォーカスを戻す。`role="dialog"` と `label` が付き、起点には `aria-haspopup`・`aria-expanded`・`aria-controls` が付く。起点を押したときの開閉(`open` の切り替え)は呼び出し側で行う。
  選択肢の一覧には `Select`、右クリックのメニューには `ContextMenu`、スマホの下から出る面には `mobile/Sheet.svelte` を使い、Popover は「小さな操作パネル」に使う。色は `--color-*` のトークンに従い、固定の色は使わない。
- ネイティブのコンテキストメニュー: Tauri の本番ビルドでは、入力欄と選択テキスト以外の既定メニューを `src/lib/desktop/nativeContextMenu.ts` で止める。
- アクティブ状態: 開閉するボタンは `disabled` ではなく、選択中の見た目(`aria-pressed`)にする。

## 一覧と詳細(プロット・人物・設定資料)

3 つのページは同じ部品でできている(`src/lib/components/items/`)。見た目はホーム・エディタに合わせ、色は `--color-*`、角丸 8〜12px、枠線 `--color-border`、見出し 22px / 600 を使う。

- **`MasterDetail.svelte`**: 一覧と詳細のレイアウト。コンテナ幅が `wideMin`(既定 900px)以上なら並べ、それ未満(スマホ)は一覧が全画面で、項目を開くと詳細が全画面に切り替わる(ヘッダーに「一覧」へ戻るボタン)。
  - 選択は URL の hash(`#<id>`)に持つ。狭いときは履歴に積むので、ブラウザ/Android の戻るで一覧へ戻れる。リロードで復元される。
  - SvelteKit の `pushState` / `replaceState` は `page.url` を更新しない。選択の正は `selectedId` で、履歴には `page.state.md` を持たせて戻る/進むに追従している。
  - 項目を開く・閉じるは、必ず `open()` / `close()` / `replace()` を使う(未保存の変更の確認が入る)。
  - 狭いとき、一覧は裏に残して `visibility: hidden` + `inert` にする(戻ったときのスクロール位置を保つため)。
- **`ItemDetail.svelte` + `ItemSection.svelte`**: 詳細は**既定で全文を読める閲覧ビュー**(`white-space: pre-wrap`、省略しない、本文は `.selectable`)。「編集」で同じ場所が編集フォームに切り替わる。フォームの値と未保存の判定は親が持ち、別の項目へ移るときは確認する。閲覧専用では編集・削除・並べ替えを出さない。新規作成も詳細ペイン(スマホは全画面)の編集フォームで行う(モーダルは使わない)。
- 一覧の項目に「編集」ボタンだけを置いて全文を隠さない。カードは冒頭を数行で省略してよいが、カードの中で「もっと見る」で全文に広げられるか、詳細で全文が読めること。

### 並べ替え

- データ: 各項目の `order?: number`(分数順序)。`src/lib/utils/ordering.ts` の `sortByOrder`(`order` が無ければ `createdAt` 順)、`moveItem`(1 回の移動で書く行は 1 件。間隔が尽きたときと `order` が無い行が混ざるときだけ、そのグループ全体を 1024 刻みで振り直す)。DB は `plotsDB` / `charactersDB` / `worldbuildingDB` の `moveTo(id, toIndex, group?)`(書いた行の id を返すので、呼び出し元が `queueChanges` に渡す)。
- **`SortableList.svelte`**: 並べ替えできる縦の一覧(Pointer Events)。`onmove(id, toIndex, listKey)` を呼ぶだけで、書き込みは親が行う。
  - ポインタ: ハンドルをドラッグ(マウス・タッチ・ペン)。ドラッグ中は浮き上がり + 挿入位置の線 + スクロールコンテナの端で自動スクロール。`Escape` で取り消し。ハンドルは `touch-action: none`。ドラッグ中は選択を止める。
  - キーボード / スクリーンリーダー: ハンドルにフォーカスして `Space` で持ち上げ → `↑` `↓`(`Home` `End`)→ `Space` で確定 / `Esc` で取り消し。`aria-live` で「N 番目に移動しました」を通知する。
  - 「上へ」「下へ」: タッチで確実に使える代替。項目のメニューから `ctx.moveUp()` / `ctx.moveDown()` を呼ぶか、`showMoveButtons` でハンドルの下に出す。
  - `disabled`(閲覧専用)ではハンドル・ボタン・キー操作をすべて出さない。`prefers-reduced-motion` では動きを止める。
  - 同じ `group` の一覧どうしでは、項目を行き来できる(プロットの状態の列)。移動先は `listKey` で分かる。
  - ドラッグ・並べ替えの対象に `.selectable` は付けない。本文の `<p>` だけに付ける。

### アイコン枠

- 丸い・四角いアイコン枠やアバターは **`IconBadge.svelte`** を使う(`size` / `shape: 'circle' | 'square'` / `tone` / `icon` または `text`)。
- 自前で作る場合も、`width` と `height` を同じ値で固定し、`aspect-ratio: 1`、`flex-shrink: 0` を付ける。行が窮屈でも楕円にならないようにするため。`border-radius: 100%` は使わず、円は `50%`、四角は 8〜12px。
- 文字や絵文字ではなく、`Icon.svelte` のアイコンを使う。

### 人物・設定資料の構成

- **一覧の項目**は `ItemRow.svelte`(左にアバター/アイコン枠、名前 1 行(省略)、補足 1 行(muted)、右端に「⋯」メニューと並べ替えのハンドル)。行の高さは 60px 以上、タッチの押せる範囲は 44px 以上。左右の余白は `--row-pad-x`(広い画面 12px、スマホ 16px)。操作はボタンを並べず、右端のメニューとハンドルに集約する。
  - スマホの一覧は画面の端まで広げた行(区切り線)、広い画面は角丸の行(選択は `--selected`)。ハンドルの大きさは `--sortable-handle-size`(タッチでは 44px)。
- **人物**: アバターは `IconBadge shape="circle"`(イニシャル。色は人物の id から決まる)。見出し(`ItemsPageHead`)の右に「一覧 / 相関図」のセグメントと「新規人物」。詳細は、見出し=名前 + 役割・年齢・性別、節=外見・性格・背景・関係(空の節は出さない)。
  - **関係**は、関係名のチップ + 関係先の人物のリンク(アバター付き。押すとその人物の詳細へ)。編集では、行ごとに `Select`(相手)+ 入力欄(関係名)+ 削除、「関係を追加」。相手と関係名の両方がある行だけを保存する。
- **設定資料**: アイコン枠は `IconBadge shape="square"`(44px、`aspect-ratio: 1`、`flex-shrink: 0`)。分類ごとのアイコンと色は `src/lib/utils/worldList.ts` の `WORLD_META`(用語=abc、場所=buildings、年表=timeline-event、その他=book-2)。
  - **分類のチップ**は一覧ペインの上部(`data-tour="worldbuilding-categories"`)に、「すべて」+ 分類名 + 件数。スマホは 1 行の横スクロール(40px 以上の高さ)、広い画面は折り返す。件数は、検索語・タグで絞った結果の件数。
  - 「すべて」の手動順は、分類の順に節(見出し + 件数)へ分け、並べ替えは節の中だけ。分類を選んでいるときは、その分類の中で並べ替える。分類を変える編集は、移動先の分類の末尾に入る。
  - タグは詳細に押せるチップで出し、押すとそのタグで絞り込む(スマホでは一覧へ戻る)。一覧の上の「タグ」の Select からも絞り込める。
- 検索語・タグで絞り込んでいる間、「手動順」以外の並びのときは、並べ替えを止めて理由を案内する。閲覧専用では、新規・編集・削除・並べ替えを出さない。
- テストは `bun run test:e2e:characters` / `bun run test:e2e:worldbuilding`。
