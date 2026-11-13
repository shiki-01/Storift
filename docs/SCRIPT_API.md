# スクリプト拡張の API

Storift のスクリプト拡張(`kind: script`)を書くための仕様。ひな形は `extensions/_template-script/`(`manifest.json`・`main.js`・型定義 `sdk.d.ts`)、サンプルは `extensions/pomodoro-timer/`(通信なし)と `extensions/discord-webhook/`(通信先は discord.com だけ)。仕組みの全体は [EXTENSIONS.md](EXTENSIONS.md)、投稿の手順は [COMMUNITY.md](COMMUNITY.md)。

## セキュリティモデル

第三者が書いたコードを、利用者の原稿・Firebase の設定・AI の API キー・Monolog. のトークンなど、アプリの保存領域と UI から隔離して動かす。**最悪でも「宣言して利用者が同意した範囲の情報を、宣言した通信先へ送る」ことしかできない**状態を目標にし、失敗時は動かさない(フェイルクローズ)。

```
ホスト(アプリ)
  └ <iframe sandbox="allow-scripts" srcdoc=ランタイムシェル>   ← 不透明オリジン
        ├ <meta http-equiv="Content-Security-Policy"> を最初に置く
        └ 拡張のコードを Blob から Web Worker として起動(CSP を継承)
  ホスト ⇄ シェル ⇄ ワーカー: MessageChannel のポート 1 本を中継
```

- **iframe**: `sandbox="allow-scripts"` のみ(`allow-same-origin`・`allow-forms`・`allow-popups`・`allow-top-navigation` は付けない)。オリジンは不透明になり、アプリの localStorage・IndexedDB・Cookie・DOM には触れない。`allow=""`(権限ポリシーはすべて無し)、`referrerpolicy="no-referrer"`。
- **CSP**(シェルの `<meta>`。`src/lib/extensions/script/runtime/shell.ts`): `default-src 'none'; script-src 'nonce-<毎回新しい乱数>'; worker-src blob:; connect-src <宣言したホストの https://ホスト>; img-src 'none'; style-src 'none'; form-action 'none'; base-uri 'none'`。`'unsafe-eval'` と `'unsafe-inline'` は付けない。そのため、ワーカーの中でも `eval`・`new Function`・`importScripts`・動的 `import()`・WebAssembly・文字列の `setTimeout` は、ブラウザが拒否する。宣言していないホストへの `fetch` / XHR も拒否される。
- **ワーカー**: 拡張のコードは Web Worker で動く(重いコードや無限ループが UI を固めない)。`window`・`document`・`parent`・`localStorage` は無い。`indexedDB` は不透明オリジンなので、ホストのデータベース(`StoriftDB`・`storift-extensions`)には届かない。
- **ハンドシェイク**: シェルが親へ `hello`(nonce つき)を送り、ホストは `event.source === iframe.contentWindow` を確かめて、`MessageChannel` のポートを 1 本だけ渡す。以降は、自分が作ったポートからのメッセージだけを受け付ける。
- **メッセージの検証**: ホストは、ワーカーから届いたものをすべて検証する。構造化クローンで届いた値のうち、JSON で表せるもの(文字列・有限の数・真偽値・null・プレーンな配列/オブジェクト)だけを受け付け、大きさ・深さ・個数の上限がある。
- **ウォッチドッグ**: シェルがワーカーに確認(ping)を送り、**3 秒**応答が無ければ `terminate()` する。ホストはその拡張を「停止」にして通知する。連続して **3 回**止まると自動で無効にする(60 秒止まらずに動けば、数え直す)。ホストはシェル自身にも確認を送り、**4 秒**応答が無ければ iframe ごと取り除く。
- **静的な検査**(`src/lib/extensions/script/lint.ts`): インストール時(アプリ)と PR の CI で、`eval`・`new Function`・`importScripts`・`WebAssembly`・動的 `import()`・`import` / `export` 文を拒否する。コメントや文字列の中の語(`<script` など)は対象にしない。これは足切りで、本当の防御は上の CSP と sandbox。
- **失効(キルスイッチ)**: 運営は `extensions/revoked.json` で拡張の版を失効できる。アプリは、設定の「拡張機能」を開いたとき・「更新を確認」のとき・スクリプトを有効にしている場合の起動時(1 日 1 回まで。設定「失効リストを自動で確認」。既定オン)に確認して、該当する版を無効にし、理由を表示する。

### 限界(正直に)

- **ブラウザの実装のバグ**による sandbox / CSP の回避は、このしくみでは防げない。ブラウザを最新に保つこと。
- **宣言した通信先へ送られた情報は取り消せない**。送られた情報の扱いは、作者と通信先に従う。
- **CPU・メモリの消費**は、応答が無くなる(3 秒)ものしか止められない。応答を返しながら CPU やメモリを使い続けるコードは、ブラウザ側の制限に任せることになる。
- **Firefox・Safari(WebKit)・iOS Safari・Tauri の WebView(WebKit 系)では、「不透明オリジンの iframe の中の Blob ワーカー」が動くかを検証していない**(Chromium だけで検証した)。ワーカーを起動できない環境では、スクリプトを実行せず、「この環境では実行できません」と表示する(直接 iframe の中で実行する代替は作っていない)。
- 既定のヘッドレスの Chromium では、sandbox 付きの iframe がホストと同じプロセスで動く(サイト分離と `IsolateSandboxedIframes` を有効にすると別プロセスになる)。拡張のコードは Worker にあり、シェルは信頼できるコードだけなので、シェルが固まる経路は想定していないが、同一プロセスの環境では、シェルが固まるとホストも固まる(保険のウォッチドッグが効くのは、別プロセスの環境)。
- 失効リストの確認の前に起動したスクリプトは、確認が終わるまで動いている。保存済みの失効リストは、起動時に先に適用する。

## マニフェスト

```json
{
	"id": "my-script",
	"name": "私のスクリプト",
	"description": "1 〜 2 文の説明",
	"version": "1.0.0",
	"author": "あなたの名前",
	"kind": "script",
	"apiVersion": 1,
	"platforms": ["web", "desktop"],
	"icon": "puzzle",
	"license": "MIT",
	"updatedAt": "2026-11-12",
	"entry": "main.js",
	"permissions": {
		"events": ["session:end"],
		"read": ["project:title"],
		"network": ["discord.com"],
		"storage": true,
		"notify": true,
		"ui": true
	},
	"privacy": {
		"sends": [{ "to": "discord.com(…)", "items": ["…"], "when": "…" }],
		"stores": ["…"],
		"onDisable": "…"
	}
}
```

- `entry`: スクリプト本体のファイル名(拡張のフォルダ直下の **1 ファイルだけ**。`.js`。200KB まで)。
- `license`・`updatedAt`・`privacy` は必須。`license` は SPDX の許可リスト(MIT など)のいずれか。
- `permissions.network`: **完全一致のホスト名だけ**(ワイルドカード・IP アドレス・localhost・ポート・パス・内部用の名前は不可)。**各ホストは `privacy.sends[].to` のどこかに現れる**こと。`privacy.sends` を書いたなら `network` も宣言すること。
- `permissions.events`: `session:start`・`session:update`・`session:end`・`page:change`・`app:visibility`・`scene:updated`・`scene:created`。
- `permissions.read`: `project:title`(作品名)・`project:chars`(作品の総文字数)。
- `permissions.storage` / `notify` / `ui`: `true` で有効。`notify`・`ui` はスクリプトだけ。
- 権限・プライバシー・版が変わる更新は、利用者に再同意を求める。

## `storift` オブジェクト

ワーカーのグローバルにある。型は `extensions/_template-script/sdk.d.ts`。

### `storift.events.on(name, handler)` → `Promise<() => void>`

`permissions.events` に宣言したイベントだけ購読できる(宣言していないと Promise が `code: 'permission'` で reject)。返る関数で解除できる。**本文は一切渡さない。内部の ID(シーン・章・作品・セッション)も渡さない。**

| イベント                                           | ペイロード                                                                                                                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session:start` / `session:update` / `session:end` | `{ startedAt, lastEditAt, endedAt, netChars, reason?, projectTitle?, projectChars? }`。`projectTitle` は `project:title`、`projectChars` は `project:chars` を宣言したときだけ入る(権限が無ければキーごと無い) |
| `page:change`                                      | `{ page }`(ホーム・執筆などの固定の種類だけ)                                                                                                                                                                   |
| `app:visibility`                                   | `{ visible }`                                                                                                                                                                                                  |
| `scene:updated`                                    | `{ characterCount, previousCharacterCount, delta, origin }`(文字数のみ)                                                                                                                                        |
| `scene:created`                                    | `{}`                                                                                                                                                                                                           |

### `storift.storage`(`permissions.storage: true`)

`get(key)`・`set(key, value)`・`delete(key)`・`list(prefix?)`(すべて Promise)。値は JSON で表せるもの。拡張ごとの名前空間で、別の IndexedDB(`storift-extension-data`)に保存し、同期・バックアップ・書き出しには含まれない。拡張を削除したら消える。

- 1 拡張あたり合計 **256KB**(キーと値のバイト数)、値 1 つ **64KB**、キー **64 文字**、キー数 **100**。超える書き込みは `code: 'quota'` で拒否される。

### `storift.ui.set(target, nodes, options?)` / `storift.ui.onEvent(handler)`(`permissions.ui: true`)

画面は**宣言的**。拡張は DOM やスタイルに触れず、JSON の記述を渡し、ホストが描画する。`target` は `'panel'`(ツールバーのポップアップ。スマホは「操作」シートから)か `'settings'`(設定画面の拡張のカードの設定欄)。`nodes` は要素の配列(`null` で消す)。`options.badge: true` で、ツールバーのアイコンにドットを出す。

| `type`     | 項目                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| `heading`  | `text`                                                                                      |
| `text`     | `text`、`tone`(`normal` / `muted` / `warning` / `error`)                                    |
| `button`   | `id`、`label`、`variant`(`primary` / `secondary` / `danger`)、`disabled`                    |
| `toggle`   | `id`、`label`、`value`、`description`、`disabled`                                           |
| `input`    | `id`、`label`、`value`、`placeholder`、`secret`(`true` で伏せ字)、`description`、`disabled` |
| `select`   | `id`、`label`、`value`、`options: [{ value, label }]`、`description`、`disabled`            |
| `list`     | `items`(文字列、または `{ text, detail }`)                                                  |
| `progress` | `value`(0 〜 1)、`label`                                                                    |
| `divider`  | なし                                                                                        |
| `link`     | `label`、`url`(**https のみ**)。押すと、ホストが「外部サイトを開きます」と確認する          |

- 文字はすべて**テキストとして**描画される(HTML・`<script>` を入れても、文字として表示されるだけ)。`javascript:`・`data:`・`http:` の URL、未知の `type`、`id` の重複、上限超過があれば、**記述全体が拒否される**(前の画面が残る)。
- 上限: 要素 **60** 個、`text` **500** 文字、ラベル **80** 文字、`list` **50** 項目、`select` の選択肢 **30**、`input` の値 **1000** 文字、`id` **40** 文字。更新は **1 秒に 10 回**まで。
- `ui.onEvent(handler)` で操作を受け取る: `{ id, kind: 'press' | 'change', value }`。`button` は `press`、`toggle`(boolean)・`input`(string。確定したとき)・`select`(string)は `change`。記述にある要素・値だけが届く。1 つだけ登録できる。
- `input` に `secret: true` を付けても、渡した `value` は(伏せ字で)ホストの画面に出る。保存済みの秘密を画面に戻さず、`placeholder` で「設定済み」と示すのがよい(discord-webhook がそうしている)。

### `storift.notify(message)`(`permissions.notify: true`)

トースト(`「<拡張名>: <message>」`)。**1 分に 5 回**まで、**200 文字**まで(超えると `code: 'rate'` / `'limit'`)。

### 通信

API ではない。宣言したホストへの **`fetch` を直接行う**(HTTPS。**CORS が必要**。オリジンは `null`)。宣言していないホストは CSP でブロックされる。

## 上限と停止

| 上限                          | 値                             | 超えたとき                |
| ----------------------------- | ------------------------------ | ------------------------- |
| メッセージ(ワーカー → ホスト) | 1 秒に 100                     | 停止(`flood`)             |
| 1 メッセージの大きさ          | 約 128KB / 深さ 8 / 値 4000 個 | 停止(`oversize`)          |
| 決められた形でないメッセージ  | -                              | 停止(`protocol`)          |
| 応答待ちのリクエスト          | 32                             | 停止(`flood`)             |
| 画面の更新                    | 1 秒に 10 回                   | 停止(`flood`)             |
| 権限違反・上限による拒否      | 10 回                          | 停止(`violations`)        |
| ワーカーの無応答              | 3 秒                           | 停止(`hang`)              |
| 読み込み中の例外・起動の失敗  | -                              | 停止(`error` / `timeout`) |

停止すると、iframe が取り除かれ、利用者に通知される(設定のカードと、ポップアップに理由と「再開」ボタンが出る)。連続して 3 回止まると自動で無効になる。個別の権限違反(宣言していない `events.on`・`storage`・`notify`・`ui`、ストレージや画面の上限超過)は、まず Promise の reject(`error.code`: `permission` / `invalid` / `limit` / `quota` / `rate`)として返る。

## 例

```js
// 執筆セッションが終わったら通知して、数える
let count = 0;
storift.ui.onEvent(async (e) => {
	if (e.id === 'reset') count = 0;
	await storift.ui.set('panel', [
		{ type: 'text', text: `${count} 回` },
		{ type: 'button', id: 'reset', label: 'リセット' }
	]);
});
(async () => {
	await storift.events.on('session:end', async (s) => {
		count += 1;
		await storift.notify(`${s.netChars} 文字`);
	});
})();
```

## デバッグ

- ワーカーのエラーは、ブラウザの開発者ツールに出る(Chromium は「Sources」の「Threads」、または iframe(`about:srcdoc`)のコンテキスト)。`console.log` はそのまま使える。
- 検証は `bun run validate:extensions`(エラーは `ファイル:メッセージ`、警告は難読化の疑いなど)。
- ローカルで試すには、バンドル(`.storiftext.json`)を作って「ファイルから追加」する、またはデスクトップ版の拡張フォルダに `extensions/<id>/` を置く。個人で追加したスクリプトは「個人追加(未審査)」で、同意画面で「未審査のコードを実行する」にチェックが要る。
- `session:*` を試すには、エディタで文字を入力して、設定の「無操作で終了するまでの時間」を待つ。

## 投稿の流れ

1. `extensions/_template-script/` を `extensions/<id>/` にコピーして、`manifest.json`・`main.js` を書く(`sdk.d.ts` は置かない)。
2. `bun run validate:extensions`(エラーが 0 に、警告は読み返す)。
3. PR(`.github/PULL_REQUEST_TEMPLATE/extension.md`)。`extensions/**` は CODEOWNERS により、オーナーのレビューが必須。
4. マージされると、サイトのデプロイで `index.json`(SHA-256 つき)とバンドルが更新され、アプリの「拡張機能を探す」に「コミュニティ(レビュー済み)」として現れる。レビューは内容を保証するものではない。
5. 有害と分かった版は、`extensions/revoked.json` に `{ "id": "…", "versions": ["1.0.0"] または "*", "reason": "…", "at": "YYYY-MM-DD" }` を足して失効させる(PR)。

## テスト

実際の Chromium で、悪意のあるスクリプトを動かして止められることを確かめる E2E(`bun run test:e2e:scripts`。攻撃用のスクリプトは `tests/e2e/fixtures/scripts/`。`extensions/` には置かない): ホストの DOM・IndexedDB・localStorage への到達、宣言していないホストへの通信、`eval` などの実行、無限ループ(ウォッチドッグ)、フラッディング・巨大ペイロード・ストレージと UI の上限、宣言していないイベント・権限の使用、UI への HTML の混入、ポップアップ・ナビゲーション。
