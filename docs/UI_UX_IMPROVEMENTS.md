# UI/UX 改善・未実装項目一覧

調査日: 2026-10-01

## 0. 前提: スタイリングの方針

| 区分 | 対象ページ | 方針 |
| --- | --- | --- |
| 基準とするデザイン | ホーム (`src/routes/home`)、執筆エディタ (`src/routes/project/[id]/editor`) | 現状のスタイルを基準とし、微調整に留める |
| 要再設計 | プロット、キャラクター、設定資料、進捗、設定、セットアップ、エラーページ、各種モーダル系コンポーネント | 初期に AI 生成したもの。ホーム・エディタのデザインに合わせて全面的に見直す |

要再設計ページで共通して見直す点:

- ホーム・エディタで使っている線の太さ・余白・タイポグラフィ・`theme-*` トークンに揃える
- `bg:white` / `fg:gray-600` / `bg:blue-600` などの色の直接指定をやめ、`theme-*` トークンに置き換える（ダークテーマ対応）
- 一覧・カード・モーダル・フォームの部品をページ間で統一する

---

## A. 不具合（ユーザーに見える挙動の誤り）

| # | 内容 | 場所 |
| --- | --- | --- |
| A-1 | 同期状態の色・回転アニメーションが反映されない。`config.color + ' ' + syncStore.status === 'syncing' ? ... : ''` の演算子の優先順位により class が常に空になる | `src/lib/components/ui/SyncStatus.svelte:39` |
| A-2 | 保存処理中も `isDirty` を先に判定しているため、「保存中...」が表示されず「未保存」のままになる | `src/routes/project/[id]/editor/+page.svelte:955` |
| A-3 | 右クリックメニューの「カット」「貼り付け」が DOM だけを書き換え、`editorStore.content` を更新しない。保存すると変更が失われる | `editor/+page.svelte:696-718` |
| A-4 | textarea 用の旧ハンドラ（`handleEditorContextMenu`, `editorTextarea`）が使われずに残っている | `editor/+page.svelte:266-332` |
| A-5 | カーソル位置の復元が `firstChild` と `startOffset` のみに依存している。改行を含む本文が外部から変わる（執筆支援の適用など）とカーソルが飛ぶ | `editor/+page.svelte:746-779` |
| A-6 | 書式設定のスライダーがエディタに即時反映されるため、「キャンセル」しても元に戻らない。フォントだけ即時保存で、他の項目は「保存」が必要という不一致もある | `editor/+page.svelte:599-638, 1157-1244` |
| A-7 | 右クリックメニューの「エクスポート」が印刷プレビューを開く | `editor/+page.svelte:320, 731` |
| A-8 | 「すべて選択」が選択範囲のあるときにしか表示されない（条件が逆） | `src/lib/utils/contextMenu.ts:51` |
| A-9 | `bg:theme-wraning` の誤字により色が当たらない | `src/routes/settings/+page.svelte:597` |

## B. 未実装・中途半端な機能

| # | 内容 | 場所 |
| --- | --- | --- |
| B-1 | 競合を手動で解決する UI がない。競合解決ポリシーの既定値は `manual` で、競合は `pendingConflicts` に溜まるが、`ConflictResolver.svelte` がどこからも使われていない | `src/lib/services/sync.service.ts:48-136` |
| B-2 | 作成済みだが未使用: `SearchReplace.svelte`（検索・置換）、`HistoryViewer.svelte`、`ExportModal.svelte`、`backup.service.ts`、`proofreading.ts`。エディタに検索・置換や校正の入口がない | `src/lib/components/ui/`, `src/lib/services/`, `src/lib/utils/` |
| B-3 | 設定に値があるが反映されない: `shortcuts`（表示のみで編集不可、実際に動くのは Ctrl+S だけ）、`autoSave` / `autoSaveInterval`（エディタは 30 秒固定）、`paragraphSpacing`（エディタ未使用） | `src/lib/types/settings.ts`, `settings/+page.svelte:634-648`, `editor/+page.svelte:137` |
| B-4 | プレビュー設定がエディタのローカル状態のみで、ページ遷移すると初期値に戻る | `editor/+page.svelte:56` |
| B-5 | 進捗の目標値（`project.settings.goal`）を設定する UI がない。達成率の計算だけが行われている | `progress/+page.svelte:94-113` |
| B-6 | 進捗ログは手入力のみ。エディタで保存しても執筆文字数が自動で記録されない | `progress/+page.svelte:175-197` |
| B-7 | 相関図ビューにキャラクター間の線がなく、関係が描画されない | `characters/+page.svelte:459-493` |
| B-8 | エラーレポート送信が「開発中」の alert のみ | `src/routes/+error.svelte:21` |
| B-9 | 復元ポイントが localStorage 保存のため端末間で同期されない。自動保存（30 秒ごと）のたびに履歴が増え続け、間引く処理がない | `src/lib/services/version.service.ts:176`, `src/lib/db/scenes.ts` |
| B-10 | エディタ自体が横書きのみ。縦書きはプレビューでしか使えない | `editor/+page.svelte` |

## C. 操作性

| # | 内容 | 場所 |
| --- | --- | --- |
| C-1 | `alert` / `confirm` を約 40 か所で使用。トースト通知・独自の確認ダイアログ・取り消し操作付きの削除に置き換えたい | 全体 |
| C-2 | 作成・更新・リネーム成功時の表示がない。章・シーン作成の失敗などは console に出すだけ | `editor/+page.svelte:197-221` ほか、プロット・キャラクター・設定資料・進捗 |
| C-3 | 次の操作が右クリックメニューからしか実行できず、タッチ端末で到達できない: 章・シーンのリネーム／削除／複製／並べ替え、ホームのプロジェクト操作 | `editor/+page.svelte`, `home/+page.svelte:101-120` |
| C-4 | 並べ替えが「上へ・下へ」のみで、ドラッグ&ドロップがない | `editor/+page.svelte:550-596` |
| C-5 | 章・シーン一覧に章の折りたたみ、シーン検索、シーン別の目標文字数がない。章はあるがシーンが 0 件のとき、空状態に作成ボタンが出ない | `editor/+page.svelte:787-859` |
| C-6 | プロジェクト内の移動がハンバーガーメニュー経由のみ。デスクトップでも常時表示のナビゲーションがない | `src/routes/+layout.svelte` |
| C-7 | ページごとの `<title>` がなく、どの画面でもタブ名が同じ | 全ルート |
| C-8 | エディタのツールバーにアイコンだけのボタンが多く、モバイルでは横スクロールになる。執筆に集中するための全画面モードがない | `editor/+page.svelte:862-965` |
| C-9 | プロジェクト読み込み中は文字表示のみ。「プロジェクトが見つかりません」の画面にホームへ戻る導線がない | `src/routes/project/[id]/+layout.svelte` |
| C-10 | プロジェクトのデータを `onMount` でしか読み込まないため、URL の id が変わっても再読み込みされない可能性がある | `src/routes/project/[id]/+layout.svelte:11` |
| C-11 | プロット・キャラクター・設定資料の一覧に検索・フィルタがない | 各ページ |
| C-12 | プロットの「次へ →」ボタンが確認なしにステータスを進める | `plot/+page.svelte:332-346` |

## D. ダークテーマ・アクセシビリティ

| # | 内容 | 場所 |
| --- | --- | --- |
| D-1 | 色の直接指定によりダークテーマで崩れる: `Modal.svelte` の `bg:white`（全モーダルに影響）、`SyncStatus` の `fg:black`、`+error.svelte` 全体、`home/+page.svelte:95-98, 297`、`PrintPreview.svelte`、`setup/+page.svelte:273` | 各所 |
| D-2 | モーダルにフォーカストラップがなく、開いても入力欄にフォーカスが移らない。Esc はオーバーレイ要素にフォーカスがあるときしか効かない | `src/lib/components/ui/Modal.svelte` |
| D-3 | アイコンボタンが `title` のみで `aria-label` がない。メニューボタンの `aria-label` が "mordal" と誤記されている | `editor/+page.svelte:885-951`, `+layout.svelte:126` |
| D-4 | `<label for="chapterTitle">` などに対応する `id` が `Input` 側になく、ラベルと入力欄が結び付いていない | `editor/+page.svelte:1036, 1057, 1264` |
| D-5 | 表示モード切替の選択中ボタンが `bg:primary` と `fg:theme-text-secondary` の組み合わせで、コントラストが不足する可能性がある | `editor/+page.svelte:895-917` |

---

## 優先度の目安

1. **最優先**: A-3（データ消失）、B-1（競合を解決できない）、D-1（モーダルの白背景）
2. **次点**: A-1, A-2, A-6, B-3, B-4, C-1, C-3
3. **再設計と合わせて対応**: 要再設計ページのスタイル統一（第 0 節）、C-11, C-12, B-5, B-7, D-1 のうちページ固有のもの
4. **その後**: 残りの項目

## 調査範囲について

- エディタ・共通レイアウト・同期・モーダル・コンテキストメニューはコードを直接確認した
- ホーム・設定・セットアップ・キャラクター・プロット・設定資料・進捗・エラーページは要約による調査で、主要な指摘（目標設定、進捗記録、ショートカット、誤字）は grep で裏付けを取った。行番号は調査時点のもの
