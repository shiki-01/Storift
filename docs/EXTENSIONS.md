# 拡張機能

Storift に機能を足す仕組みと、最初の拡張「Monolog. 連携」の仕様。

## 構成

```
src/lib/extensions/
  types.ts            ExtensionManifest / Extension / ExtensionContext / ExtensionToolbarContribution
  events.ts           型付きのイベントエミッタ(拡張は購読のみ)
  registry.ts         組み込みの拡張の一覧、プラットフォーム判定、ツールバー項目 ID(`ext:<拡張 ID>`)
  host.svelte.ts      有効状態(localStorage)、activate / deactivate、ツールバー項目の一覧(toolbarItems)
  builtin/monolog/    Monolog. 連携(下記)
```

ツールバー周りの共通部品は拡張の外にある。

| ファイル                                           | 役割                                                            |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `src/lib/utils/toolbarItems.ts`                    | ツールバーの項目の定義と、並び順・まとめる設定の正規化(純関数)  |
| `src/lib/components/ui/Popover.svelte`             | 起点に追従して開くポップアップ。位置計算は `popoverPosition.ts` |
| `src/lib/components/settings/EditorSection.svelte` | 設定の「ツールバー」(並べ替え・常時表示/三点メニューの切り替え) |
| `src/routes/project/[id]/editor/+page.svelte`      | ツールバーの描画、拡張のポップアップ、スマホの「操作」シート    |

- 拡張は `Extension { manifest, activate(ctx), deactivate() }`。`manifest.platforms` は `'web'` と `'desktop'` の組み合わせ。含まれない環境では設定に無効表示で出て、activate もされない。
- `ExtensionContext` は購読専用の `events`、作品名を読む `getProjectTitle`、通知(`notify`)だけを持つ。**拡張は DB に直接触れない。**
- 新しい拡張は `registry.ts` の `EXTENSIONS` に足す。
- 有効/無効は**端末ごと**に localStorage(`storift:extensions:enabled`)へ保存する。Dexie・Firestore 同期・バックアップ・エクスポートの対象外。既定はすべて無効。読み書きは try/catch で保護している。
- 拡張は任意で `toolbar`(ツールバー貢献。次の節)を持てる。
- 起動時(ルートの `+layout.svelte`)に `extensionHost.start()` を呼び、有効な拡張だけ activate する。無効な拡張は何も購読しないので、エディタの動作・性能に影響しない。

## ツールバーへの貢献

拡張は `Extension.toolbar` で、執筆画面のツールバーに 1 つだけ項目(アイコン)を出せる。押すとポップアップ(スマホではシート)で、拡張が用意した `panel` が開く。

```ts
export const myExtension: Extension = {
	manifest: { id: 'my-ext', name: '…', description: '…', platforms: ['web', 'desktop'] },
	toolbar: {
		id: 'my-ext', // 拡張の中で一意
		label: 'My Ext', // ツールチップ・設定の一覧・三点メニューに出る名前
		icon: 'clock', // Icon.svelte の名前(src/lib/components/editor/icons/*.svg)
		panel: MyPanel, // Svelte コンポーネント。受け取る props は { close: () => void } だけ
		badge: () => state.running // 任意。true の間、アイコンに小さなドットを出す
	},
	activate(ctx) {},
	deactivate() {}
};
```

- **出る条件**: 利用者が有効にしていて、現在のプラットフォームに対応する拡張だけ。`extensionHost.toolbarItems` が、その一覧(拡張の登録順。`itemId` は `ext:<拡張 ID>`、`extensionId`、`label`、`icon`、`panel`、`badge`)を返す。activate の完了は待たない。無効にすると即座に消え、開いているポップアップも閉じる。非対応のプラットフォームでは、有効の保存値が残っていても出ない。
- **panel の制約**: 拡張は DB に触れない。`panel` が受け取るのは `close`(ポップアップを閉じて起点へフォーカスを戻す)だけ。状態は拡張が持つ `$state` を読む。1 秒ごとの更新などは、`panel` の中で持ち、`panel` が描画されている間(ポップアップが開いている間)だけ動かす(パネルは閉じると破棄される)。
- **badge**: ツールバーの描画の中で呼ばれる。リアクティブな状態だけを読み、重い処理をしない。
- **アイコン**: `src/lib/components/editor/icons/` の SVG を使う(Monolog. は `clock.svg`)。足すときは既存と同じ `viewBox="0 0 24 24"`、`stroke="currentColor"` の形式にする。
- 1 つの拡張が出せる項目は 1 つ。項目 ID(`ext:<拡張 ID>`)の `<拡張 ID>` は `manifest.id` で、`toolbar.id` は拡張内の識別用。

### ポップアップ(Popover)

`src/lib/components/ui/Popover.svelte`。使い方は [UI_GUIDELINES.md](UI_GUIDELINES.md) の「ポップオーバー」を参照。

- 起点のボタンの下に開く。収まらなければ上へ反転し、画面端では横位置と高さを補正する(位置計算は `popoverPosition.ts` の純関数で、テストがある)。
- Escape と外側のクリックで閉じる。Escape と `close()` では起点にフォーカスを戻す(外側のクリックではフォーカスを奪わない)。
- `role="dialog"` と `aria-label`(項目の `label`)を持つ。起点には開いている間、`aria-haspopup="dialog"`・`aria-expanded`・`aria-controls` が付く。フォーカスは開いたときに本体へ移るが、閉じ込めない(非モーダル)。
- `body` 直下に `position: fixed` で描画する(親の `overflow` で切れない)。リサイズ・スクロール・中身の大きさの変化で位置を取り直す。色はテーマの CSS 変数に従う。

### 並べ替えと三点メニュー

ツールバーの設定は、端末内の設定(Dexie の `settings` レコード。同期の対象外)に 2 つ保存する。どちらも未設定なら従来どおり(既定の順で全部表示)。

| フィールド                     | 内容                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| `AppSettings.toolbarMenuItems` | 三点メニュー(…)にまとめる項目の ID(従来からあるフィールド。形式は変更なし) |
| `AppSettings.toolbarOrder`     | ボタンの並び(ID の配列)                                                    |

- 設定は 1 レコードの JSON なので、フィールドを足してもスキーマのバージョンは上げない。`settingsForm.svelte.ts` の保存は既存の値をスプレッドするので、画面の保存で消えない。
- ID は組み込みのボタン(`assist`・`export`・`review`・`manuscript`・`print`・`history`・`proofread`・`search`・`focus`・`memo`・`ai`)と、拡張の項目(`ext:<拡張 ID>`)。組み込みの ID と、チュートリアルが参照する `data-tour` 属性は変えない。
- 既定の並びは、組み込み(`TOOLBAR_ITEMS` の順)→ 有効な拡張の項目。`normalizeOrder` が保存値をそろえる: 使えない ID(不明、無効・非対応の拡張、Web 版でのデスクトップ専用)と重複を除き、保存値に無い項目は既定の順で末尾に足す。
- **AI パネルのボタン(`ai`)は並べ替えの対象外**で、デスクトップ版のとき、区切りの後ろ(右端側、保存状態の手前)に固定する。これまでの「AI は区切って末尾側」というレイアウトを保つため。常時表示/三点メニューの切り替えは他と同じようにできる(三点メニューでも最後に並ぶ)。保存値の `toolbarOrder` に `ai` があっても無視する。
- 拡張が無効の間も、その `ext:` の ID は両方の保存値に残る。画面の並べ替えは「見えている項目の位置」だけを入れ替え、見えていない `ext:` の項目の位置は動かさない(`applyVisibleOrder`)ので、再び有効にすると以前の位置・設定で戻る。
- 設定画面(設定 → エディタ → ツールバー)は `SortableList` を使う。取っ手のドラッグ、または取っ手で Space → ↑↓ → Space で並べ替え、各行のチェックで常時表示/三点メニューを切り替える。変更は即時に保存し、エディタの画面にも即時に反映される(`settingsStore`)。「既定に戻す」は並びと「まとめる」の両方を初期化する。
- 三点メニューにまとめた拡張の項目を選ぶと、三点ボタンに追従して同じポップアップが開く。

### スマホ

スマホにはツールバーが無いので、並べ替え・まとめる設定は使わない。「操作」シート(上部バーの「その他の操作」)に、有効で対応する拡張の項目が並び(拡張の登録順)、押すとシート(`Sheet`)で同じ `panel` が開く(`close` はシートを閉じる)。Monolog. は、上部バーの「計測中」表示(`MonologBadge`)もそのまま出る。

### 拡張の追加手順

1. `src/lib/extensions/builtin/<id>/` に拡張を作る(`Extension`。`manifest`、必要なら `toolbar`)。
2. `registry.ts` の `EXTENSIONS` に足す。
3. ツールバーに出すなら、アイコン(SVG)と `panel` を用意する。`panel` は `ExtensionPanelProps`(`{ close }`)だけを受け取る。
4. 設定画面の「拡張機能」には、`manifest` の名前・説明・対応プラットフォームから、有効/無効の行が自動で並ぶ(`ExtensionsSection.svelte`)。拡張固有の設定カードが必要なら、同じファイルに足す(現在は Monolog. の `MonologSettings.svelte` を、有効なときだけ読み込む形で直接書いている)。
5. ユニットテストを書く(`host.test.ts` のように `ExtensionHost` へ差し込める)。

## イベント

| イベント        | いつ                                                           | payload                                                                     |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `scene:updated` | シーンの本文が**実際に変わって**保存されたとき(文字数の更新後) | `{ sceneId, chapterId, projectId, characterCount, previousCharacterCount }` |
| `scene:created` | シーンを作成したとき                                           | `{ sceneId, chapterId, projectId }`                                         |

発行は `src/lib/db/scenes.ts` の `scenesDB.update` / `scenesDB.create`。オプション引数 `{ silent: true }`(`update` は第 3 引数、`create` は第 2 引数) で発行を止められる。購読者の例外・失敗した Promise は握りつぶされ、保存には影響しない。

### scene:updated を発行しない経路(調査結果)

「自分が書いたわけではない」変更で発火すると、執筆時間や文字数が誤って記録される。`scenesDB.update` / `db.scenes.*` の呼び出し元を全部調べた結果:

| 経路                                                                     | 書き込み先           | 扱い                                                                               |
| ------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------- |
| エディタの保存・離脱時保存(`editor/+page.svelte`)                        | `scenesDB.update`    | **発行する**(自分の編集)                                                           |
| 共同編集のミラー(`sceneText.service.ts` の `mirrorContent`)              | `scenesDB.update`    | `silent: true`。リモート由来の変更や復元を含み、自分の分だけを切り分けられないため |
| AI による差し替え(開いていないシーン。`ai.svelte.ts`)                    | `scenesDB.update`    | `silent: true`                                                                     |
| 同期(`sync.service.ts`)・参加(`join.service.ts`)                         | `db.scenes.*` を直接 | 発行されない(`scenesDB.update` を通らない)                                         |
| 履歴の復元(`version.service.ts`)・検索置換・インポート・バックアップ復元 | `db.scenes.*` を直接 | 発行されない                                                                       |
| タイトル変更・並び替え                                                   | `scenesDB.update`    | 本文が変わらないので発行されない                                                   |

既知の取りこぼし/混入:

- 共同編集(共有プロジェクト)のシーンで書いた分は、Monolog. の計測の対象にならない(ミラーが他の人の変更を含むため)。
- エディタ内で AI の提案を適用した場合は、エディタの本文の変更として保存されるため、自分の編集として数えられる。

## Monolog. 連携

仕様の出典は <https://www.monolog.life/developers>。実装は `src/lib/extensions/builtin/monolog/`。

| ファイル                 | 役割                                                                      |
| ------------------------ | ------------------------------------------------------------------------- |
| `config.ts`              | client_id、各 URL、リダイレクト URI、連携できる環境の判定                 |
| `pkce.ts`                | code_verifier / state / code_challenge(S256)                              |
| `oauth.ts`               | 認可 URL、途中状態の保存、戻りの解釈、トークンの交換・更新・失効          |
| `tokens.ts`              | トークンの保存先と、更新の直列化(`TokenManager`)                          |
| `client.ts`              | リソース API(リトライ・Idempotency-Key・401/429 の扱い)                   |
| `session.ts`             | 執筆セッション(無操作での終了、タイマー/記録方式、pagehide)               |
| `service.svelte.ts`      | 接続状態、接続・解除・認可の戻りの処理、UI から使う窓口(`monologControl`) |
| `settings.svelte.ts`     | 記録方式などの設定(この端末の localStorage)                               |
| `index.ts`               | 拡張本体(購読、pagehide、deep link)                                       |
| `MonologSettings.svelte` | 設定画面のカード                                                          |
| `MonologPanel.svelte`    | ツールバーのポップアップ(スマホでは「操作」シート)の中身                  |
| `panelLogic.ts`          | パネルの表示用ロジック(経過時間・文字数の整形、接続状態の表示名)          |
| `MonologBadge.svelte`    | スマホの上部バーの「Monolog. 計測中」表示                                 |

### ツールバーのアイコンとポップアップ

- アイコン(`clock`)は、有効なときにツールバーへ出る。計測中(`monologState.sessionActive`)は、アイコンの右上にドットを出す。デスクトップ/タブレットのツールバーにあった `MonologBadge` の単独表示は、このドットに置き換えた。
- ポップアップ(`MonologPanel`)は、接続状態(未接続 / 接続中 / 要再接続。確認中・オフラインで確認できない状態も出る)、計測の有無、計測中の経過時間と増減した文字数を出す。1 秒ごとの更新は、計測中で、ポップアップが開いている間だけ動く。
- 操作は「Monolog. に接続」(未接続のときだけ。本番環境とデスクトップ版のみ)、「いま終了して記録する」(計測中のときだけ押せる)、「設定を開く」(設定の拡張機能セクションへ移る)。
- パネルは `monologControl`(`service.svelte.ts`)経由でセッションの情報を読む。`monologControl` は拡張が activate されている間だけ、セッション管理(`MonologSessionManager.snapshot()` / `finish('manual')`)につながる。無効なときは「計測していない」を返す。

### 認可(OAuth 2.0 認可コード + PKCE S256)

- public クライアント(client_secret なし)。スコープは `records:write timer`。
- リダイレクト URI は完全一致で、**本番のものだけ**登録されている: Web = `https://app.storift.shiki-01.com/monolog/callback`、デスクトップ = `storift://monolog/callback`。Web 版は本番のオリジン以外(localhost、プレビュー環境)では「Monolog. に接続」を無効にし、「本番環境でのみ利用できます」と表示する。デスクトップ版はスキームが固定なので常に使える。
- code_verifier と state は、認可の開始時に localStorage(`storift:monolog:oauth-pending`)へ短時間(10 分)保存し、戻りで取り出すと同時に消す(エラーでも消す)。認可コードの再送はしない。
- **Web**: `location.assign` で認可ページへ。戻りは `src/routes/monolog/callback/+page.svelte` で、URL のクエリを履歴から消してから state を検証し、トークンを交換して `/settings#extensions` へ移る。
- **デスクトップ**: tauri-plugin-opener でシステムブラウザを開き、`storift://monolog/callback?...` を tauri-plugin-deep-link で受け取る(`index.ts`)。Windows / Linux では deep link が 2 つ目のプロセスとして起動するため、tauri-plugin-single-instance(`deep-link` 機能)で URL を実行中のプロセスへ渡す。そのため**デスクトップ版は単一インスタンスになる**(2 つ目を起動すると既存のウィンドウが前面に出る)。開発中(未インストール)は、起動時に `register_all()` でスキームを実行時に登録する(debug ビルドの Windows / Linux のみ)。

### トークン

- アクセストークン(`mla_…`)とリフレッシュトークンは**この端末内だけ**に保存する。同期・バックアップ・エクスポートの対象外(これらは IndexedDB のデータだけを扱う)。
- 保存先: デスクトップ版は既存の秘密情報保存(`src/lib/ai/secrets.ts`。macOS / Windows は OS のキーチェーン、Linux などは localStorage の平文)を `provider = monolog` で再利用する。Web 版は localStorage(`storift:monolog:tokens`)。
- 選んだ理由: AI プロバイダの API キーと同じ脅威モデルで、すでに「キーチェーンが使えなければ平文で localStorage」という方針と利用者への説明があり、新しい仕組みを増やさずに済む。Web 版はキーチェーンが無く、IndexedDB に置くとエクスポート処理と混ざりやすいため、独立した localStorage のキーにした。
- リフレッシュトークンは 90 日で、**更新のたびにローテーション**する。新しい値を保存してから古い値を捨てる。使用済みを再送すると invalid_grant になるので、更新は直列化する(同じタブ内は進行中の Promise を共有、複数タブ間は `navigator.locks`。ロック取得後に保存済みの値を読み直し、他のタブが更新済みならそれを使う)。
- invalid_grant になったら接続情報を消し、設定に「要再接続」を表示する(印は `storift:monolog:needs-reconnect`)。
- 連携の解除は `POST /v1/oauth/revoke` を呼び、失敗してもローカルのトークンは必ず消す。

### API の扱い

- ベース `https://api.monolog.life/v1`、`Authorization: Bearer`、本文は JSON。CORS は許可済みで、ブラウザから直接呼ぶ。
- OAuth のエンドポイント(`/v1/oauth/token`、`/v1/oauth/revoke`)は `application/x-www-form-urlencoded`、エラーは RFC 6749 の形。リソース API のエラーは `{ "error": { "code", "message", "request_id" } }`。
- 401 は 1 回だけ更新して再試行。429 は Retry-After 秒(最大 60 秒)待って再試行(最大 3 回)。
- `POST /records`・`/timer/start`・`/timer/stop` には `Idempotency-Key`(UUID)を付け、通信エラーの再送(最大 3 回、500ms から指数バックオフ)・401 後・429 後の再試行は同じキーで行う。

### 執筆セッション

- 接続済みで拡張が有効なとき、最初の `scene:updated` でセッションを開始し、最後の編集から N 分(5/10/15/30、既定 5)操作がなければ終了する。作品を切り替えても同じセッションとして続く。
- 文字数: 各シーンの `characterCount - previousCharacterCount` の合計。memo は `+1,234字 (Storift)` / `-120字 (Storift)`。
- title: 既定 `執筆(Storift)`。「作品名を Monolog. に送る」(既定オフ)をオンにすると `作品名を執筆`。タグ名は既定 `執筆`。**本文は一切送らない**。
- 記録方式(設定。セッション開始時の値が使われる):
  - **タイマー方式(既定)**: 開始で `POST /timer/start`、終了で `POST /timer/stop` のみ。Monolog. アプリ側でも計測中に見える。`/records` は呼ばない。
  - **記録方式**: 終了で `POST /records` のみ。タイマーには触れない。失敗は通知のみ(再送のために保存はしない)。
- 二重に記録しないため、1 つのセッションで両方を呼ばない(タイマーを止めた時点で記録が保存されるため)。
- 手動: 設定の「いま終了して記録する」。
- ページを閉じる/隠れる(`pagehide`)とき、計測中なら `fetch(..., { keepalive: true })` で終了を送る。待てないため、停止前の GET /timer 検証とトークンの更新ができない。起動中に検証済み(開始時に受け取った started_at を保持)であることを前提にし、期限切れで失敗しないよう、編集中は 1 分に 1 回までトークンの期限(5 分前)を確かめて先に更新しておく。結果は確認できず、失敗しても通知されない。

### 既知の制限

- **停止時刻(タイマー方式)**: 終了時刻は最後の編集の時刻ではなく、実際に `/timer/stop` を送った時刻になる(無操作の待ち時間が含まれる)。記録方式なら、無操作による終了は最後の編集の時刻になる。
- **タイマーは Monolog. アプリと共有**: 開始時に 409 `timer_already_running` が返ったら乗っ取らず、そのセッションの連携をスキップして通知する。停止は誰が開始したかに関係なく動いているタイマーを止めてしまうため、停止前に `GET /timer` で「実行中で、started_at が開始時に受け取った値と同じ」ことを確かめ、違えば止めずにセッションを破棄して通知する。pagehide ではこの確認ができない(上記)。
- 新しいセッションの開始は、直前のセッションの停止の完了を待つ(409 を避けるため)。
- オフライン時の記録は保存して再送しない(通知のみ)。
- 共同編集のシーン・エディタ内で適用した AI の提案の扱いは「イベント」の節を参照。
- デスクトップ版の deep link、Monolog. での実際の認可は、実機での確認が必要(自動テストは API をモックしている)。
- 拡張が無効または未接続のときは、`scene:updated` の購読者がいない(無効)か、早期 return する(未接続)だけで、エディタに影響しない。
