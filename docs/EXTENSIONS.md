# 拡張機能

Storift に機能を足す仕組みと、公式拡張「Monolog. 連携」「Discord Rich Presence」の仕様。

## 拡張の種類

拡張は 3 種類(公式・パック・スクリプト)。スクリプトの仕様は [SCRIPT_API.md](SCRIPT_API.md)。

| 種類       | `kind`     | 中身                                                                                                                                                                                          | 状態                |
| ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 公式       | `official` | アプリに同梱する。Svelte のコンポーネントとコードを持ち、特権(Tauri のコマンドなど)を使える                                                                                                   | 実装済み            |
| パック     | `pack`     | コードを含まない JSON(テーマ・校正の辞書・入力補助キー・書き出しのプリセット)。通信せず、コードも実行しない                                                                                   | 実装済み(第 2 段階) |
| スクリプト | `script`   | `sandbox="allow-scripts"` の iframe の中の Web Worker で隔離して実行する 1 ファイルの JavaScript。宣言した権限の範囲だけ、ホストと `postMessage` でやり取りし、宣言したホストにだけ通信できる | 提供中(第 3 段階)   |

コミュニティの拡張は、リポジトリのトップレベル `extensions/<id>/` に PR で受け、サイトで一覧配信し、アプリの「拡張機能を探す」から入れられる(パックのみ。投稿の手順は [docs/COMMUNITY.md](COMMUNITY.md))。`script` は、マニフェストの検証は通るが、読み込む処理は未実装で、`extensions/` への PR でも受け付けない(`validate-extensions` が拒否する)。

## パック

コードを含まない拡張。マニフェスト(`kind: 'pack'`)に `contributions` を持ち、貢献の種類ごとに、コンテンツ(JSON)への相対パスを書く。型・検証・上限は `src/lib/extensions/pack.ts`(アプリ・サイト・検証スクリプトが同じ実装を使う)。

### マニフェストの決まり(パック)

- `contributions` 必須(1 つ以上)。`license`・`updatedAt`(`YYYY-MM-DD`)も必須。
- `permissions` に `network` / `events` / `read` は書けない(通信せず、本体のイベントも情報も扱わない)。`{ "storage": true }` だけにする。
- `privacy.sends` は `[]`。既定の文面は「通信しない。端末内にだけ保存」(ひな形 `extensions/_template/` を参照)。
- `id` は予約済み(`monolog`・`discord`・`submit`・`official-*`)を使えない。公式と誤認させないため。

### 上限

| 項目                   | 上限                  |
| ---------------------- | --------------------- |
| コンテンツ 1 ファイル  | 256KB                 |
| パック全体(コンテンツ) | 1MB                   |
| マニフェスト           | 64KB                  |
| バンドル全体           | 1.25MB                |
| 種類ごとのファイル数   | 8                     |
| リポジトリ上の画像     | 1 枚 256KB(png / svg) |

### 貢献の種類

パスは、小文字英数字・`-`・`_`・`.` の `.json`(階層は 3 つまで)。`..`・絶対パス・バックスラッシュ・隠しファイルは検証で拒否する(`isSafeContentPath`)。各ファイルは `id`(英小文字・数字・ハイフン)と `name` を持ち、`id` は同じ種類の中で一意。

- **`themes`(配色テーマ)**: アプリのテーマ(`theme.svelte.ts` の `Theme`)と同じ `colors`(12 色)と `editor`(5 色)のトークンを、`#rgb` / `#rrggbb` で書く。`scheme` は `light` / `dark` で、背景色の明暗と一致させる。**フォントは指定できない**(CSS への注入を避ける)。検証するコントラスト比(WCAG): 文字と背景・原稿の文字と原稿の背景・文字と面は 4.5 以上、薄い文字・primary・accent と背景、原稿の文字と選択範囲は 3 以上。有効なパックのテーマは、設定の外観に「パック」付きで並ぶ(ID は `pack:<パック>:<テーマ>`。この ID は同期・バックアップされる設定には書かない)。使っているテーマのパックを無効にすると、ライトに戻る。起動時は、パックの読み込みが終わるまで直前の見た目(ミラー)を保つ。
- **`proofreadRules`(校正の辞書)**: `rules: [{ from, to, message? }]`。**固定の文字列だけで、正規表現は使えない**(ReDoS の余地が無い)。`from` 1〜32 文字・前後の空白と制御文字は不可、`to` は 0〜32 文字(空は削除の提案)、`message` は 80 文字まで。1 ファイル 500 件、パック全体 1000 件まで。実行時も、検索は `indexOf` のみで、100ms で打ち切り、指摘は 500 件まで(`packProofread.ts`)。有効なパックの辞書は、スマホの「校正」(`ProofreadSheet`)の指摘に、本体の校閲と並んで出る(種類は「提案」)。範囲が重なる指摘を「すべて直す」でまとめて適用するときは、後ろの指摘だけを適用して、本文を壊さない。
- **`assistKeys`(入力補助キー)**: `keys: [{ label?, text, caretBack? }]`。文字列のみ。制御文字・書字方向の制御・ゼロ幅文字は不可。`text` 16 文字、`label` 8 文字、1 セット 32 個まで。`caretBack` は挿入後にカーソルを左へ戻す文字数。スマホのエディタの入力補助バー(`AssistBar`)に、セットごとに区切って追加される。
- **`exportPresets`(書き出しのプリセット)**: `ruby`(`keep` / `pipe-ascii` / `paren` / `strip`)、`bouten`(`keep` / `ruby-dots` / `strip`)、`blankLines`(`keep` / `between-paragraphs` / `collapse`)。**テキスト・Markdown の書き出しだけ**に適用する(書き出す文字列だけを変え、原稿は変えない)。書き出しダイアログに「記法のプリセット」として出る。PDF・EPUB・RTF(docx)・JSON は対象外(予定)。投稿サイトごとの具体的な記法(なろう・カクヨムなど)は、仕様を確認できないため、プリセットとしては同梱していない。

### バンドル形式(`.storiftext.json`)

マニフェストと全コンテンツを 1 つの JSON にしたもの。レジストリの配信物であり、「ファイルから追加」で読む形式。

```json
{
	"format": "storift-extension-bundle",
	"bundleVersion": 1,
	"manifest": { "...": "manifest.json の内容" },
	"files": { "contents/rules.json": { "...": "contributions に書いたパス → 解析済みの JSON" } }
}
```

- `files` は `contributions` に書いたパスと過不足なく一致する(パスの昇順)。
- 1 行の JSON(末尾に改行 1 つ)。入力が同じなら同じバイト列になる(`buildBundle` / `serializeBundle`)。`sha256` はこのバイト列のもの。
- 取り込むときは必ず `parseBundleText`(`packBundle.ts`)を通る: 大きさ → JSON → 外側の形 → マニフェストの検証(`kind: 'pack'`)→ コンテンツの検証。レジストリ・ファイル・フォルダのどの経路も同じ検証。

### 出所のラベル

UI では、公式と誤認させないよう、出所を必ず表示する(`ORIGIN_LABELS`)。

| `origin`          | 表示                 | 入れ方                                                |
| ----------------- | -------------------- | ----------------------------------------------------- |
| `official`        | 公式                 | アプリに同梱                                          |
| `community`       | コミュニティ         | レジストリ(`extensions/<id>/` に PR で追加されたもの) |
| `personal-file`   | 個人追加(未審査)     | 「ファイルから追加」                                  |
| `personal-folder` | 個人フォルダ(未審査) | デスクトップ版の拡張フォルダ                          |

カード・同意画面・詳細に出す(未審査のものは注意の文も出す)。同意画面は、どの出所でも必須(公式と同じ `ConsentDialog`)。

### 保存場所

- インストール済みのパック(レジストリ・ファイル): **別の IndexedDB `storift-extensions`**(ストア `packs`。`packStore.ts`、`idb-keyval`)。メインの DB(Dexie `StoriftDB`)のスキーマは触らない。**Firestore 同期・バックアップ(`createFullBackup` など)・書き出しには含まれない**(`packStore.test.ts` で、別 DB であること・バックアップに入らないこと・各サービスのコードが参照しないことを確認している)。
- 初回のインストールで `navigator.storage.persist()` を試みる(断られても続行)。
- 読み込むたびに、マニフェストとコンテンツを検証し直す(壊れたものは読み込まない)。
- 拡張フォルダのパックは保存しない(起動時と「再読み込み」で読み直す)。
- 有効/無効と同意の記録は、公式と同じ localStorage(端末内のみ)。

### ホストの扱い(`ExtensionHost`)

パックは `Extension`(`createPackExtension`)として、`addExtension` / `removeExtension` で出し入れする。`activate` で `packRuntime`(リアクティブな置き場)にコンテンツを出し、各機能(テーマ・校正・入力補助バー・書き出し)が読む。コードは実行しない。更新(`addExtension` で同じ ID を置き換え)で `permissions` / `privacy` が同意のときと変わっていれば、`changed` として確認まで止める(公式と同じ)。公式の拡張は置き換え・取り除きができない。

### レジストリ(リポジトリ → サイト → アプリ)

```
extensions/<id>/ ──(scripts/build-registry.ts)──▶ site/static/extensions-registry/ ──(サイトのビルド)──▶ site/build
                                                  index.json
                                                  <id>/<version>.storiftext.json
```

- 配信 URL: `https://storift.shiki-01.com/extensions-registry/index.json` と `.../<id>/<version>.storiftext.json`。生成物はコミットしない(`site/.gitignore`)。サイトの `build` / `dev` の前に `bun run registry` が走る。
- 出力は入力だけで決まる(コミット日時・実行時刻を使わない。更新日はマニフェストの `updatedAt`)。ひな形(`_template`)は含めない。
- `index.json`: `{ "indexVersion": 1, "extensions": [...] }`。各項目は `id` `name` `description` `version` `author` `kind` `platforms` `icon` `license` `homepage` `permissions`(要約)`privacy`(要約)`contributes` `bundle`(URL)`sha256` `size` `updatedAt` `source`(`official` / `community`)。公式(monolog・discord)は載るが、`bundle` / `sha256` / `size` は `null`(アプリに同梱)。型と検証は `registryIndex.ts`。
- `site/static/_headers`: `/extensions-registry/*` に `Access-Control-Allow-Origin: *`。`index.json` は `max-age=300`、バンドルは版付きの URL なので `max-age=31536000, immutable`(**公開済みの版の内容は変えない。変えるときは版を上げる**。ルールが重なると Cache-Control が連結されるので、`index.json` と `:id/:file` で重ならないようにしている)。
- デプロイ: `extensions/**` などを変えると `deploy-site.yml` が動く(`paths`)。アプリ(`deploy-app.yml`)も `extensions/**` で動く(公式のマニフェストを同梱しているため)。

### インストールの流れ(アプリ)

1. 設定の「拡張機能」→「拡張機能を探す」を開いたときだけ、一覧を取得する(`registryState.load`。起動時には取得しない。「更新を確認」も同じ)。失敗(オフラインなど)しても、すでに入れたものは何も変わらない。
2. 一覧(検索・種類・出所で絞り込み)→ 詳細(説明・権限・プライバシー・作者・ライセンス・版・サイズ・出所)→「インストール」。
3. 取得(`registryClient.fetchBundle`): 取得先は **`storift.shiki-01.com` の `/extensions-registry/` 配下だけ**(`isRegistryUrl`。コードに固定。`https`・ポートなし・認証情報なし・リダイレクトなし・`credentials: omit`)→ 上限つきで読み取り → **SHA-256 が一覧と一致**すること → マニフェストとコンテンツを再検証 → 一覧の id・版と一致すること。
4. 保存(`storift-extensions`)→ 同意画面(出所のラベルと、権限・プライバシー)→「同意して有効にする」で有効化。同意するまで有効にならない。
5. 更新(手動): 「更新を確認」で一覧を取得し、入れてある版より新しいものにだけ「更新」を出す。更新で権限・プライバシーが変わると、確認するまで止まり、再同意を求める。
6. アンインストール: 無効化(同意の記録も消える)→ 取り除く → `storift-extensions` から削除。
7. 同じ ID が別の出所で入っているときは、上書きしない(先にアンインストールする)。

### ファイルから追加

設定の「ファイルから追加」で `.storiftext.json` を選ぶ。レジストリと同じ検証(`parseBundleText`)を通り、出所は「個人追加(未審査)」。注意の文と、同意画面は必須。

### 拡張フォルダ(デスクトップ版)

設定の「拡張フォルダ」に絶対パスを書く(空なら、アプリのデータフォルダ内の `extensions/`)。直下の `<id>/manifest.json` を持つフォルダをパックとして読み込む(起動時と「再読み込み」)。出所は「個人フォルダ(未審査)」。Rust(`src-tauri/src/extensions.rs`)は読み取り専用で、拡張フォルダの外を読まず、シンボリックリンクをたどらず、`.json` だけを読む(上限あり)。TypeScript 側(`packFolder.ts`)は、マニフェストが宣言した安全なパスのファイルだけを引き、レジストリと同じ検証にかける。フォルダ選択のダイアログは使わない(Tauri のダイアログプラグインを足していないため。パスの入力と「フォルダを開く」)。

## スクリプト(第 3 段階)

仕様・API・セキュリティモデル・限界は [SCRIPT_API.md](SCRIPT_API.md)。ここは、既存の仕組みとの関係だけを書く。

- **構成**: `src/lib/extensions/script/` に、上限(`limits.ts`)・プロトコルと検証(`protocol.ts`)・UI 記述(`ui.ts`)・端末内ストレージ(`storage.ts`)・ブリッジ(`bridge.ts`。権限と上限の判断)・静的な検査(`lint.ts`・`files.ts`)・ランタイム(`runtime/`。シェルの HTML と CSP、シェルとワーカーの JS)・iframe の管理(`sandbox.ts`)・状態と停止の管理(`scriptRuntime.svelte.ts`)・拡張への変換(`scriptExtension.ts`)がある。画面は `ScriptUi.svelte`(描画)・`ScriptPanel.svelte`(ポップアップ)・`ScriptSettings.svelte`(設定欄)。
- **バンドル**: パックと同じ `.storiftext.json`。`files` に、`entry` のソースを文字列で入れる(それ以外のファイルは置けない)。SHA-256 をレジストリの `index.json` に載せる仕組みも同じ。アプリは、取得・ファイルから追加・保存済みの読み込みのたびに、マニフェストとソース(`lint.ts`)を検証し直す。
- **出所と同意**: 出所のラベルは 公式 / コミュニティ(レビュー済み)/ 個人追加(未審査)/ 個人フォルダ(未審査)。同意画面は、権限を平易な日本語で列挙し(`describeScriptPermissions`)、「隔離されているが、通信先に送られた情報は取り消せない」「運営者は内容を保証しない」を必ず出す。**個人追加・個人フォルダ由来のスクリプトは、赤い警告と「未審査のコードを実行する」のチェックが必須**。スクリプトは既定で無効。権限・プライバシー・版が変わる更新は再同意(`consentFingerprint`。`ui`・`notify` も対象)。
- **ホスト**: `ExtensionHost.addExtension` / `removeExtension` はパックとスクリプトを扱う。スクリプトの `activate` は、隔離環境の起動(`scriptRuntime.launch`)で、`ExtensionContext` の `events`・`getProjectCharCount`・`notify` をブリッジに渡す。拡張を削除したら、端末内データ(`storift-extension-data`)も消す。
- **失効(キルスイッチ)**: `extensions/revoked.json`(`[{ id, versions: string[] | "*", reason, at }]`。PR で更新)が、ビルド時に `index.json` の `revoked` になる。アプリは `revocation.svelte.ts` が、(a) 設定の「拡張機能」を開いたとき、(b) 「更新を確認」のとき、(c) スクリプトを有効にしている場合の起動時に 1 日 1 回まで(設定「失効リストを自動で確認」。既定オン。`storift:extensions:revocation:auto` = `'0'` でオフ)、取得して `ExtensionHost.applyRevocations` で反映する。取得先は `storift.shiki-01.com` に固定。取得に失敗しても何も壊さない。一覧は保存され(`storift:extensions:revoked`)、失効した版は、再起動しても有効にできない。公式の拡張は対象にしない。
- **拡張フォルダ(デスクトップ)**: Rust の `extension_folder_scan` は `.json` に加えて `.js` を読む(読むだけで実行しない)。スクリプトも同じ検証を通る。
- **未検証**: Firefox・Safari・iOS Safari・Tauri の WebView(WebKit 系)で、不透明オリジンの iframe の中の Blob ワーカーが動くかは、検証していない。動かない環境では、スクリプトを実行しない(フェイルクローズ)。

## 構成

```
extensions/<id>/manifest.json   拡張のマニフェスト(単一の情報源。アプリとサイトの両方が読む)
src/lib/extensions/
  manifest.ts         マニフェストの型・実行時の検証(純関数)・同意の比較・表示用の整形
  types.ts            Extension / ExtensionContext / ExtensionToolbarContribution
  events.ts           型付きのイベントエミッタ(拡張は購読のみ)と、イベントの payload の型
  pages.ts            開いている画面の判定(`page:change` 用。ルートのパス → 画面の種類と固定のラベル)
  session.ts          執筆セッションの追跡(`session:*` を発行する。本体の機能)
  sessionSettings.svelte.ts   執筆セッションの設定(無操作時間)
  pack.ts             パックの貢献・コンテンツ・バンドルの型と検証(純関数。サイト・scripts からも読む)
  packBundle.ts       バンドル文字列の検証(レジストリ・ファイル追加の共通の入口)
  packRuntime.svelte.ts / packExtension.ts   有効なパックのコンテンツの置き場と、パックを Extension にする変換
  packManager.svelte.ts / packStore.ts       導入・更新・削除・起動時の読み込みと、別の IndexedDB への保存
  packFolder.ts       拡張フォルダの読み取り結果の検証(Rust: src-tauri/src/extensions.rs)
  packProofread.ts / packExport.ts           校正の辞書(固定文字列)と、書き出しの記法の変換
  registryIndex.ts / registryClient.ts / registryState.svelte.ts   レジストリの形式・取得・状態
  registry.ts         同梱する拡張の一覧、プラットフォーム判定、ツールバー項目 ID(`ext:<拡張 ID>`)
  host.svelte.ts      有効状態・同意の記録(localStorage)、activate / deactivate、権限に応じた API の絞り込み
  builtin/monolog/    Monolog. 連携(下記)
  builtin/discord/    Discord Rich Presence(下記)
src/lib/components/settings/ExtensionsSection.svelte, ExtensionCard.svelte   設定の「拡張機能」(マニフェスト駆動)
src/lib/components/extensions/   同意画面(ConsentDialog)、扱う情報の表示(PrivacyInfo)、拡張の設定の読み込み
site/src/routes/extensions/      サイトの拡張ページ(マニフェストから生成)
```

`$extensions`(= リポジトリ直下の `extensions/`)は `svelte.config.js` の alias で、`vite.config.ts` の `server.fs.allow` と `vitest.config.ts` にも設定している。サイト(`site/`)は `site/svelte.config.js` の alias(`$extensions` と、検証の `$manifest`)と `site/vite.config.ts` の `server.fs.allow` で、同じファイルを読む(静的ビルド・デスクトップの静的ビルドでも通る)。

## マニフェスト

`extensions/<id>/manifest.json`(`apiVersion: 1`)。フォルダ名と `id` は一致させる。型と検証は `src/lib/extensions/manifest.ts`(`validateManifest` / `parseManifest`。外部ライブラリは使わない)。検証に通らないマニフェストは、アプリでもサイトでも、ビルドまたは起動時に例外になる。

| キー                     | 内容                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `id`                     | 英小文字・数字・ハイフン(64 文字まで)                                                              |
| `name` / `description`   | 表示名、説明(1〜2 文)                                                                              |
| `version`                | semver                                                                                             |
| `author`                 | 作者                                                                                               |
| `kind`                   | `official` / `pack` / `script`                                                                     |
| `apiVersion`             | `1`                                                                                                |
| `platforms`              | `web` / `desktop` の 1 つ以上。含まない環境では、設定に「…のみ」と出て、有効にも読み込みもできない |
| `icon`                   | `src/lib/components/editor/icons/*.svg` の名前(サイトに無い名前は、パズルの形で出す)               |
| `homepage?` / `license?` | `https://` の URL / ライセンス名(パックは `license` 必須)                                          |
| `updatedAt?`             | 更新日 `YYYY-MM-DD`(レジストリの一覧に載せる。パックは必須)                                        |
| `contributions?`         | パックの貢献(上記「パック」)                                                                       |
| `permissions`            | 下記                                                                                               |
| `privacy`                | 下記                                                                                               |

### 権限(`permissions`)

宣言した範囲だけを、拡張に渡す(`ExtensionHost.createContext`)。

| キー      | 内容                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events`  | 購読できるイベント。宣言していないイベントを `ctx.events.on` すると、例外になる。`page:change` `app:visibility` `scene:updated` `scene:created` `session:start` `session:update` `session:end`  |
| `read`    | `project:title`(作品名)、`project:chars`(作品の総文字数)。宣言していない拡張には、`session:*` の `projectTitle` を外し、`ctx.getProjectTitle` / `ctx.getProjectCharCount` は `undefined` を返す |
| `network` | 通信する相手のホスト名(完全一致。スキーム・ポート・パス・ワイルドカードは書けない)。**宣言した拡張は、`privacy.sends` に送る情報を書く必要がある**(検証で拒否する)                              |
| `storage` | 端末内に設定などを保存するか                                                                                                                                                                    |

公式拡張は特権のあるコードなので、`network` は宣言と説明のためのもので、強制はしていない(公式のコードを読んで確認する)。スクリプトでは、ホストが宣言を強制する(`permissions.network` は CSP の `connect-src`、イベント・ストレージ・通知・画面はブリッジの権限確認)。

### プライバシー(`privacy`)

設定画面の「プライバシー」の開閉、有効にするときの同意画面、サイトの拡張ページが、同じ内容をここから出す。

- `sends`: 外部へ送る情報。`{ to: 送り先, items: 送る項目[], when: いつ }` の配列(送らないなら `[]`)
- `stores`: この端末に保存するものと、保存場所
- `onDisable`: 無効にした(連携を解除した)ときの扱い
- `notes?`: 補足(本文は送らない、など)

**マニフェストに書くのは事実だけ。** 実装を変えて送る情報・保存場所・解除時の扱いが変わるときは、同じ変更でマニフェストも直す(同意の再確認が走る。次の節)。

## 同意

拡張を有効にするには、いまのマニフェストの `permissions` / `privacy` への同意が要る。

- 設定のスイッチを入れる → 同意画面(`ConsentDialog`。送る項目・送り先・保存場所・解除時の扱い)→「同意して有効にする」で有効になる。`ExtensionHost.setEnabled(id, true)` は、同意が現在のマニフェストと一致していなければ `false` を返して何もしない。
- 同意の記録(`storift:extensions:consent`。拡張ごとに版・`permissions`/`privacy` の指紋・時刻)は、有効状態と同じく**端末内の localStorage だけ**。同期・バックアップ・エクスポートの対象外。無効にすると記録も消える(次に有効にするときは、もう一度確認する)。
- 同意のあとにマニフェストが変わったとき(`consentStatus`):
  - `version-changed`(版だけが変わった。扱う情報は同じ): そのまま動かし、設定のカードに確認の促しを出す。
  - `changed`(`permissions` / `privacy` が変わった): 起動時に確認されるまで activate せず(`isSuspended`)、通知を 1 回出す。カードの「内容を確認して再開」で同意すると再開する。
- 同意画面ができる前から有効にしていた既存ユーザー(記録なし = `none`): **起動時に無効にしない**。そのまま動かし、設定を開いたとき、カードに「内容を確認する」を出す(`needsReview`)。

## 拡張の API

- `Extension { manifest, toolbar?, settings?, activate(ctx), deactivate() }`。`manifest.platforms` に含まれない環境では、設定に「…のみ」と出て、`activate` もされない。
- `ExtensionContext`: 購読専用の `events`(マニフェストで宣言したイベントだけ)、`session`(`current()` / `endNow()`)、`app`(`page()` = 開いている画面、`visible()` = 前面にあるか)、`getProjectTitle` / `getProjectCharCount`(`read` の宣言が要る)、`notify`。**拡張は DB に直接触れない。**
- 有効/無効は**端末ごと**に localStorage(`storift:extensions:enabled`)へ保存する。Dexie・Firestore 同期・バックアップ・エクスポートの対象外。既定はすべて無効。読み書きは try/catch で保護している。
- 起動時(ルートの `+layout.svelte`)に `extensionHost.start()` を呼び、有効な拡張だけ activate する。無効な拡張は何も購読しないので、エディタの動作・性能に影響しない。

## ツールバーへの貢献

拡張は `Extension.toolbar` で、執筆画面のツールバーに 1 つだけ項目(アイコン)を出せる。押すとポップアップ(スマホではシート)で、拡張が用意した `panel` が開く。

```ts
export const myExtension: Extension = {
	manifest: parseManifest(manifestJson, 'my-ext'), // extensions/my-ext/manifest.json
	toolbar: {
		id: 'my-ext', // 拡張の中で一意
		label: 'My Ext', // ツールチップ・設定の一覧・三点メニューに出る名前
		icon: 'clock', // Icon.svelte の名前(src/lib/components/editor/icons/*.svg)
		panel: MyPanel, // Svelte コンポーネント。受け取る props は { close: () => void } だけ
		badge: () => state.running, // 任意。true の間、アイコンに小さなドットを出す
		status: MyStatus // 任意。スマホの上部バー(シーン名の下)に出す小さな表示
	},
	settings: () => import('./MySettings.svelte'), // 任意。設定のカードに出す拡張固有の設定
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

スマホにはツールバーが無いので、並べ替え・まとめる設定は使わない。「操作」シート(上部バーの「その他の操作」)に、有効で対応する拡張の項目が並び(拡張の登録順)、押すとシート(`Sheet`)で同じ `panel` が開く(`close` はシートを閉じる)。「操作」シートは、項目を「執筆 / 出力と確認 / 拡張機能 / このシーン」の見出しでまとめ、拡張の項目には、`badge()` が true の間「動作中」の表示を出す。上部バーのシーン名の下には、各拡張の `toolbar.status`(Monolog. は「計測中」)が並ぶ。

### 公式拡張の追加手順

1. `extensions/<id>/manifest.json` を書く(`kind: "official"`)。送る情報・保存場所・解除時の扱いは、実装の事実どおりに。`manifest.test.ts` が、同梱のマニフェストをすべて検証する(新しい拡張は、そのテストの一覧にも足す)。
2. `src/lib/extensions/builtin/<id>/index.ts` に `Extension` を作る。`manifest: parseManifest(manifestJson, '<id>')`(`import manifestJson from '$extensions/<id>/manifest.json'`)。必要なら `toolbar`(アイコンとパネル)、`settings`(設定のコンポーネント)を持たせる。購読するイベントは、マニフェストの `permissions.events` に書いたものだけ。
3. `registry.ts` の `EXTENSIONS` に足す。
4. 設定画面のカード(アイコン・名前・「公式」・対応環境・説明・スイッチ・プライバシー)は、マニフェストから自動で出る。拡張固有の設定は、`Extension.settings`(`() => import('./XxxSettings.svelte')`)で貢献する。有効で、対応環境のときだけ読み込む。`SettingsGroup` と `SettingsRow` で、意味ごとに区切る。
5. Tauri のコマンドが要るなら `src-tauri/src/` に足す(`lib.rs` の `invoke_handler` に登録)。このアプリの独自コマンドは、`build.rs` に `AppManifest` を置いていないので、`capabilities` への記載は要らない(既存の `secret_*` などと同じ)。プラグインの権限だけを capabilities に足す。
6. ユニットテストを書く(`host.test.ts` のように `ExtensionHost` へ差し込める。購読する拡張は、`EventEmitter` で本体のイベントを流して確かめる)。
7. サイトの拡張ページは、マニフェストから自動で生成される(サイト側の作業は要らない)。プライバシーポリシー(`site/src/routes/privacy/+page.svelte`)の公式拡張の一覧には、リンクを足す。

## イベント

| イベント         | いつ                                                            | payload                                                                                                                       |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `scene:updated`  | シーンの本文が**実際に変わって**保存されたとき(文字数の更新後)  | `{ sceneId, chapterId, projectId, characterCount, previousCharacterCount, delta, origin }`                                    |
| `scene:created`  | シーンを作成したとき                                            | `{ sceneId, chapterId, projectId }`                                                                                           |
| `session:start`  | 執筆セッションの開始(利用者が書いた最初の編集)                  | `WritingSessionEvent`                                                                                                         |
| `session:update` | 利用者が書くたび。作品名が読み込めたとき(`projectTitle` が入る) | `WritingSessionEvent`                                                                                                         |
| `session:end`    | 無操作・手動・ページを閉じる/隠れるとき                         | `WritingSessionEvent`(`endedAt`、`reason`: `idle` / `manual` / `pagehide`)                                                    |
| `page:change`    | 開いている画面が変わったとき(起動時の最初の画面を含む)          | `{ page, projectId? }`。`page` は `home` `editor` `plot` `characters` `worldbuilding` `progress` `preview` `settings` `other` |
| `app:visibility` | アプリが前面にあるか(`visibilitychange`)が変わったとき          | `{ visible }`                                                                                                                 |

`WritingSessionEvent` は `{ sessionId, startedAt, lastEditAt, endedAt, netChars, projectId, projectTitle?, reason? }`(時刻は Unix ミリ秒)。`netChars` は利用者が書いた分の増減の合計。`projectTitle` は、権限 `project:title` を宣言した拡張にだけ渡す。

発行は `src/lib/db/scenes.ts` の `scenesDB.update` / `scenesDB.create`(`scene:*`)、`session.ts`(`session:*`)、ルートの `+layout.svelte`(`page:change` / `app:visibility`)。`scenesDB` のオプション引数 `{ silent?, origin?, ai? }`(`update` は第 3 引数、`create` は第 2 引数)で、発行を止めたり、origin を指定したりできる。購読者の例外・失敗した Promise は握りつぶされ、保存には影響しない。

### origin

`scene:updated` の `origin` は、変更が誰(何)によるものか。

| origin         | 意味                                                                         | 発行元                                                                                                                |
| -------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `user`         | 利用者がエディタで書いた変更(入力・貼り付け・執筆支援・校正の反映・元に戻す) | エディタの保存・離脱時保存                                                                                            |
| `ai`           | AI の提案を適用した変更                                                      | エディタで開いているシーン(保存時に、AI の適用分と自分の分を別のイベントに分ける)、開いていないシーン(`ai.svelte.ts`) |
| `collab-local` | 共有プロジェクト(共同編集)のシーンで、**自分が書いた**変更                   | 共同編集のミラー(`sceneText.service.ts` の `mirrorContent`)                                                           |

- **増減の数え方は `delta`**。共同編集では、ミラーの本文に他の人の変更も混ざるので、`characterCount - previousCharacterCount` とは一致しない。`delta` は、この端末で入れた変更(Yjs の `Y.Text` の変更イベントを origin ごとに数えたもの。`LocalChanges`)だけの増減。
- **執筆セッションに数えるのは `user` と `collab-local` だけ**。`ai` は、セッションを始めも延ばしもせず、文字数にも入れない。
- エディタで開いているシーン(共同編集でない)では、AI の提案の適用(`editorStore.applyExternalText`)で入った文字数の増減(`aiDelta`)を、次の保存まで覚えておく。保存時に、`origin: 'ai'`(`delta` = その増減)と、残りの `origin: 'user'` を、続けて 2 回発行する(合計は保存の前後の差と一致する)。
- 共同編集で開いているシーンでは、AI の適用は `ORIGIN_AI` を付けて Y に入れる。検索置換・履歴の復元など、プログラムによる書き換えは `ORIGIN_PROGRAM` を付け、執筆としては数えない(送信とミラーは通常どおり行う)。他の人から届いた変更(`remote`)・保存済みの状態の読み込み(`restore`)も数えない。
- 元に戻す(UndoManager)は、`ORIGIN_AI` と `ORIGIN_PROGRAM` も対象にしている(利用者が戻せるように)。

### scene:updated を発行しない経路(調査結果)

「自分が書いたわけではない」変更で発火すると、執筆時間や文字数が誤って記録される。`scenesDB.update` / `db.scenes.*` の呼び出し元を全部調べた結果:

| 経路                                                                     | 書き込み先                                    | 扱い                                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| エディタの保存・離脱時保存(`editor/+page.svelte`)                        | `scenesDB.update`                             | **発行する**(`user`。AI の適用分が混ざれば `ai` を分ける)                                        |
| 共同編集のミラー(`sceneText.service.ts` の `mirrorContent`)              | `scenesDB.update`                             | `silent: true` で書き、この端末で入れた分だけを `collab-local` / `ai` で、ミラーの側から発行する |
| AI による差し替え(開いていないシーン。`ai.svelte.ts`)                    | `scenesDB.update`                             | `origin: 'ai'`(共有プロジェクトのシーンは、`ORIGIN_AI` で Y に入れ、ミラーから `ai` を発行)      |
| 同期(`sync.service.ts`)・参加(`join.service.ts`)                         | `db.scenes.*` を直接                          | 発行されない(`scenesDB.update` を通らない)                                                       |
| 履歴の復元(`version.service.ts`)・検索置換・インポート・バックアップ復元 | `db.scenes.*` を直接、または `applySceneText` | 発行されない(共同編集のシーンへの `applySceneText` は、既定で `ORIGIN_PROGRAM` なので数えない)   |
| タイトル変更・並び替え                                                   | `scenesDB.update`                             | 本文が変わらないので発行されない                                                                 |

### origin の既知の制限

確実に区別できる範囲だけを直している。次は、推測で区別せず、制限として残している。

- 元に戻す・やり直しは、その変更の出どころに関係なく、操作した利用者の変更(`user` / `collab-local`)として数える。AI の適用を元に戻すと、その分は利用者が削除した文字数(負の増減)になる。
- エディタで開いているシーン(共同編集でない)で、AI の適用と、その直後の利用者の編集が重なったとき(適用された文章を利用者が書き換える・消す)、AI の分(適用した時点の増減)と利用者の分(保存の前後の差から引いた残り)の配分は、適用の順序にかかわらず保存の時点でまとめて決まる。合計は正しい。
- 共同編集のシーンのミラーは約 1.5 秒の遅延があるため、`scene:updated` の発行もその分遅れる(エディタの離脱・シーン切替の直前にも、ミラーを実行する)。
- 共同編集のシーンで書いた分は、ミラーが実行される前にアプリが終了すると、イベントになる前に失われる(本文の保存・送信には影響しない)。

## Monolog. 連携

仕様の出典は <https://www.monolog.life/developers>。実装は `src/lib/extensions/builtin/monolog/`。

| ファイル                 | 役割                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `config.ts`              | client_id、各 URL、リダイレクト URI、連携できる環境の判定                                     |
| `pkce.ts`                | code_verifier / state / code_challenge(S256)                                                  |
| `oauth.ts`               | 認可 URL、途中状態の保存、戻りの解釈、トークンの交換・更新・失効                              |
| `tokens.ts`              | トークンの保存先と、更新の直列化(`TokenManager`)                                              |
| `client.ts`              | リソース API(リトライ・Idempotency-Key・401/429 の扱い)                                       |
| `session.ts`             | 本体の `session:*` を受けて、タイマー/記録方式で Monolog. に記録する(`MonologSessionManager`) |
| `service.svelte.ts`      | 接続状態、接続・解除・認可の戻りの処理、UI から使う窓口(`monologControl`)                     |
| `settings.svelte.ts`     | 記録方式などの設定(この端末の localStorage)                                                   |
| `index.ts`               | 拡張本体(`session:*` の購読、deep link)。マニフェストは `extensions/monolog/manifest.json`    |
| `MonologSettings.svelte` | 設定のカードに出す、拡張固有の設定(接続 / 記録 / 操作のグループ)                              |
| `MonologPanel.svelte`    | ツールバーのポップアップ(スマホでは「操作」シート)の中身                                      |
| `panelLogic.ts`          | パネルの表示用ロジック(経過時間・文字数の整形、接続状態の表示名)                              |
| `MonologBadge.svelte`    | スマホの上部バーの「計測中」表示(`toolbar.status`)                                            |

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

セッションの判定(最初の編集で開始、無操作で終了、増減した文字数の合計)は**本体**(`src/lib/extensions/session.ts`)が行う。Monolog. は `session:start` / `session:update` / `session:end` を購読して、Monolog. に写す。

- 無操作で終了するまでの時間は、本体の設定(設定の「拡張機能」→「執筆セッション」。5/10/15/30 分、既定 5)。以前の Monolog. 連携の設定(`storift:monolog:settings` の `idleMinutes`)があれば、初回に引き継ぐ。
- 接続済みで拡張が有効なときだけ記録する。未接続の間に始まったセッションは記録しない。セッションの途中で接続した(拡張を有効にした)場合は、その次の知らせから記録を始め、開始時刻と文字数はその時点から数える(それより前の時間・文字数は含めない)。
- 文字数: セッションの増減の合計(利用者が書いた分だけ。AI の適用は含まない)。memo は `+1,234字 (Storift)` / `-120字 (Storift)`。
- title: 既定 `執筆(Storift)`。「作品名を Monolog. に送る」(既定オフ)をオンにすると `作品名を執筆`(作品名は、権限 `project:title` により、`session:*` の `projectTitle` で届く)。タグ名は既定 `執筆`。**本文は一切送らない**。
- 記録方式(設定。セッション開始時の値が使われる):
  - **タイマー方式(既定)**: 開始で `POST /timer/start`、終了で `POST /timer/stop` のみ。Monolog. アプリ側でも計測中に見える。`/records` は呼ばない。
  - **記録方式**: 終了で `POST /records` のみ。タイマーには触れない。失敗は通知のみ(再送のために保存はしない)。
- 二重に記録しないため、1 つのセッションで両方を呼ばない(タイマーを止めた時点で記録が保存されるため)。409・`Idempotency-Key`・停止前の `GET /timer` の確認は、これまでどおり。
- 手動: 設定の「いま終了して記録する」(Monolog. の記録を終え、本体のセッションも `manual` で終了する)。連携の解除の前は、Monolog. の記録だけを終える(`monologControl.finishRecording`)。
- ページを閉じる/隠れる(`session:end` の `reason: 'pagehide'`)とき、計測中なら `fetch(..., { keepalive: true })` で終了を送る。待てないため、停止前の GET /timer 検証とトークンの更新ができない。起動中に検証済み(開始時に受け取った started_at を保持)であることを前提にし、期限切れで失敗しないよう、編集中は 1 分に 1 回までトークンの期限(5 分前)を確かめて先に更新しておく。結果は確認できず、失敗しても通知されない。

### 既知の制限

- **停止時刻(タイマー方式)**: 終了時刻は最後の編集の時刻ではなく、実際に `/timer/stop` を送った時刻になる(無操作の待ち時間が含まれる)。記録方式なら、無操作による終了は最後の編集の時刻になる。
- **タイマーは Monolog. アプリと共有**: 開始時に 409 `timer_already_running` が返ったら乗っ取らず、そのセッションの連携をスキップして通知する。停止は誰が開始したかに関係なく動いているタイマーを止めてしまうため、停止前に `GET /timer` で「実行中で、started_at が開始時に受け取った値と同じ」ことを確かめ、違えば止めずにセッションを破棄して通知する。pagehide ではこの確認ができない(上記)。
- 新しいセッションの開始は、直前のセッションの停止の完了を待つ(409 を避けるため)。
- オフライン時の記録は保存して再送しない(通知のみ)。
- 共同編集のシーンで自分が書いた分は記録に入り、AI の提案を適用した分は入らない(「イベント」の節の origin を参照。元に戻す、などの制限がある)。
- デスクトップ版の deep link、Monolog. での実際の認可は、実機での確認が必要(自動テストは API をモックしている)。
- 拡張が無効なときは、`session:*` の購読者がいなければ、本体の追跡(`scene:updated` と pagehide の購読)も動かない。未接続のときは、知らせを受けても何もしない。エディタには影響しない。

## Discord Rich Presence

デスクトップ版のみ(`platforms: ["desktop"]`)。Storift を開いている間、この端末の Discord クライアントに、いま開いている画面と経過時間を表示する(Rich Presence)。実装は `src/lib/extensions/builtin/discord/` と `src-tauri/src/discord.rs`。

| ファイル                 | 役割                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `config.ts`              | `DISCORD_APPLICATION_ID`(既定の Application ID)、画像キー、ID の検証・上書きの解決           |
| `template.ts`            | 表示文字のテンプレートの評価(純関数)                                                         |
| `presence.ts`            | 画面・セッション・設定から、Discord に出す内容を作る(純関数)                                 |
| `controller.ts`          | イベントを購読して、間隔を空けて Rust のコマンドへ送る(`DiscordPresenceController`)          |
| `settings.svelte.ts`     | 設定(この端末の localStorage)                                                                |
| `DiscordSettings.svelte` | 設定のカードに出す、拡張固有の設定(表示する内容・プレビュー・前面にないとき・Application ID) |
| `index.ts`               | 拡張本体。Web 版では、マニフェスト以外を読み込まない(本体は有効にしたときに動的に読み込む)   |

- **表示**: 画面ごとの固定のラベル(`pages.ts` の `PAGE_LABELS`): ホーム / 執筆中 / プロットを練っています / 人物を整理しています / 世界観を作っています / 進捗を見ています / 通読しています / 設定を開いています(上記以外の画面は「Storift」)。経過時間(`timestamps.start`)は、執筆セッション中はセッションの開始、それ以外は Storift を開いた(拡張を有効にした)時刻から。
- **画像**: `large_image` = `logo`(`large_text` = `Storift`)。`small_image` は執筆セッション中だけ `writing`(`small_text` は画面のラベル)。画像は Discord の Developer Portal に、この名前で登録してある(未登録でも文字の表示は壊れない)。
- **表示文字のテンプレート**: Details(既定 `{page}`)と State(既定 `{chars} 字`)。State は執筆セッション中だけ出す。プレースホルダーは `{page}`(画面のラベル)、`{project}`(作品名)、`{chars}`(セッションの増減文字数。例 `+1,234`。0 は `±0`)、`{total}`(作品の総文字数)。
  - `{project}` は「作品名を送る」、`{total}` は「作品の総文字数を送る」をオンにしたときだけ値が入る(**既定はどちらもオフ**。権限 `project:title` / `project:chars` を宣言している)。値が空のプレースホルダーは、それを含む区間(前後の括弧、直後の助詞・単位)ごと省くので、`『{project}』を{page}` で作品名が無いときは「『』を」が残らず「執筆中」になる。
  - 未知のプレースホルダー(`{foo}`)はそのまま残す。空白を整理し、前後に残った区切りを取り、128 文字(Discord の上限)に切り詰める。Discord は 2 文字未満の文字を受け付けないので、Details が 2 文字未満になったら画面のラベルにし、State は出さない。
  - 設定画面に、Discord のカード風のプレビューがある(例の値で、入力に応じてその場で変わる)。
- **前面にないとき**(別のウィンドウに移った・最小化した。`app:visibility`): 「表示を続ける」(既定)/「『離席中』にする」/「表示を消す」から選ぶ。
- **Application ID**: `config.ts` の `DISCORD_APPLICATION_ID`(Storift の ID。公開してよい値)。設定の「自分の Application ID で上書き(任意)」に 15〜25 桁の数字を入れると、その ID を使う(空、または形式が正しくなければ、既定の ID)。
  - 自分の ID を用意する手順: [Discord Developer Portal](https://discord.com/developers/applications) で「New Application」を作る。名前(「Storift」など)は、Discord に「…をプレイ中」と出る名前になる。「General Information」の「Application ID」をコピーして、設定に貼る。画像は、「Rich Presence」→「Art Assets」に、`logo`(大きい画像)と `writing`(小さい画像)の名前で登録する。
- **接続**: Discord が起動していない・つながらないときは、静かに何もしない(通知しない)。つなぎ直しを試みるのは、新しい執筆セッションの開始時と、前回の失敗から 60 秒たったあとの更新(画面の移動など)のときだけ。更新は 5 秒以上あけて、最後の内容だけを送る(Discord の頻度制限を超えないように)。
- **消すとき**: 無効化、「消す」設定で前面にないとき、アプリの終了で、表示を消して接続を閉じる。
- **Rust**(`src-tauri/src/discord.rs`): crate `discord-rich-presence`。IPC は専用のスレッド(`discord-presence`)で行い、Tauri のコマンド(`discord_set_activity` / `discord_clear_activity`)は依頼をチャネルで渡して、最長 5 秒だけ結果を待つ。UI は止まらない。アプリの終了(`RunEvent::Exit`)で表示を消す。
- **プライバシー**: 送る情報は、画面のラベル、(オンのとき)作品名・総文字数、セッションの増減文字数、経過の開始時刻、表示文字のテンプレートを展開した文章、Application ID。本文は送らない。送り先は、ローカルの Discord クライアント(IPC)経由の Discord。詳細は `extensions/discord/manifest.json`。
- **未確認**: 実際の Discord クライアントでの表示(画像・経過時間・「離席中」など)は、この環境では確認できていない(自動テストは、表示内容の組み立てと送信の制御を、Rust への呼び出しをモックして確かめている)。Windows の名前付きパイプ、macOS・Linux の Unix ソケットでの接続も、実機では未確認。
