# コミュニティ拡張の投稿ガイド

Storift のコミュニティ拡張(パック・スクリプト)を作って、公式リポジトリに投稿する方法。仕組みの詳細は [docs/EXTENSIONS.md](EXTENSIONS.md)、投稿者向けの要約はサイトの `/extensions/submit` にもある。

投稿できるのは**パック**(コードを含まない JSON。通信しない)と**スクリプト**(隔離された環境で動く 1 ファイルの JavaScript。書き方・API・投稿の流れ・上限は [SCRIPT_API.md](SCRIPT_API.md)。ひな形は `extensions/_template-script/`)。スクリプトは、`bun run validate:extensions` が `eval`・`new Function`・`importScripts`・`WebAssembly`・動的 `import()` を拒否し、難読化・圧縮の疑い(極端に長い行・1 文字の変数名だらけ)を警告として出す(PR で人が見る)。`permissions.network` の各ホストは `privacy.sends[].to` に書く。

## パックの作り方

1. リポジトリをフォークし、`extensions/_template/` を `extensions/<あなたの id>/` にコピーする。
2. `manifest.json` を編集する(`id` はフォルダ名と同じ。小文字英数字とハイフン。`monolog`・`discord`・`submit`・`official-*` は使えない)。
3. 足したい貢献の JSON を `contents/` に置き、`contributions` にパスを書く。
4. `bun run validate:extensions` で検証する。
5. PR を作る(テンプレート: URL に `?template=extension.md`)。

```json
{
	"id": "my-pack",
	"name": "私のパック",
	"description": "1〜2 文の説明",
	"version": "1.0.0",
	"author": "あなたの名前",
	"kind": "pack",
	"apiVersion": 1,
	"platforms": ["web", "desktop"],
	"icon": "puzzle",
	"license": "MIT",
	"updatedAt": "2026-11-12",
	"permissions": { "storage": true },
	"privacy": {
		"sends": [],
		"stores": ["インストールした内容: この端末のブラウザ内(IndexedDB)にだけ保存"],
		"onDisable": "無効にすると、このパックが足す機能が止まります。アンインストールすると、保存した内容を削除します。",
		"notes": ["通信しません。コードも実行しません(JSON のデータだけです)。"]
	},
	"contributions": { "proofreadRules": ["contents/rules.json"] }
}
```

`icon` は `src/lib/components/editor/icons/` の SVG の名前(無い名前は検証で拒否)。`homepage`(https の URL)は任意。

## 各貢献の仕様

すべて JSON。各ファイルに `id`(英小文字・数字・ハイフン。同じ種類の中で一意)と `name` を書く。上限は [docs/EXTENSIONS.md](EXTENSIONS.md) の表を参照(1 ファイル 256KB、パック全体 1MB)。

### 配色テーマ(`themes`)

```json
{
	"id": "wakakusa",
	"name": "若草",
	"scheme": "light",
	"colors": {
		"primary": "#3f6b3a",
		"secondary": "…",
		"background": "…",
		"surface": "…",
		"text": "…",
		"textSecondary": "…",
		"border": "…",
		"accent": "…",
		"success": "…",
		"warning": "…",
		"error": "…",
		"info": "…"
	},
	"editor": {
		"background": "…",
		"text": "…",
		"selection": "…",
		"lineHighlight": "…",
		"cursor": "…"
	}
}
```

色は `#rgb` / `#rrggbb`(12 色と 5 色、すべて必須)。`scheme` は背景色の明暗と一致させる。フォントは指定できない。検証するコントラスト比(WCAG): 文字/背景・原稿の文字/原稿の背景・文字/面は 4.5 以上、薄い文字・primary・accent と背景、原稿の文字/選択範囲は 3 以上。見本は `extensions/wakakusa-themes/`。

### 校正の辞書(`proofreadRules`)

```json
{
	"id": "my-rules",
	"name": "辞書",
	"rules": [{ "from": "出来る", "to": "できる", "message": "任意の指摘文" }]
}
```

固定の文字列だけ(正規表現・`pattern` は使えない)。`from` 1〜32 文字(前後の空白・制御文字は不可)、`to` 0〜32 文字、1 ファイル 500 件・パック全体 1000 件。同じ `from` の重複は不可。見本は `extensions/common-notation/`。

### 入力補助キー(`assistKeys`)

```json
{ "id": "my-keys", "name": "キー", "keys": [{ "label": "「」", "text": "「」", "caretBack": 1 }] }
```

文字列のみ。制御文字・書字方向の制御・ゼロ幅文字は不可。`text` 16 文字・`label` 8 文字(省略で `text`)・1 セット 32 個。見本は `extensions/dialogue-keys/`。

### 書き出しのプリセット(`exportPresets`)

```json
{
	"id": "plain",
	"name": "プレーン",
	"ruby": "paren",
	"bouten": "strip",
	"blankLines": "between-paragraphs"
}
```

`ruby`: `keep` / `pipe-ascii` / `paren` / `strip`。`bouten`: `keep` / `ruby-dots` / `strip`。`blankLines`: `keep` / `between-paragraphs` / `collapse`。テキスト・Markdown の書き出しにだけ適用される。

## 検証

```sh
bun run validate:extensions
```

`extensions/*/manifest.json` をすべて検証する。エラーは `ファイル:メッセージ` の形で出て、あれば終了コード 1。確認する内容: スキーマ、`id` とフォルダ名の一致、`license`(許可リスト: MIT / Apache-2.0 / CC0-1.0 / CC-BY-4.0 / ISC / BSD-2-Clause / BSD-3-Clause / 0BSD / Unlicense)、`privacy`・`author`、サイズ、コンテンツの中身、参照ファイルの存在、余計なファイル(許可: `.json` `.md` `.png` `.svg` のみ。マニフェストに書かれていない JSON・隠しファイル・シンボリックリンクは不可。画像は 1 枚 256KB まで)。レジストリの生成を試すには `bun run build:registry`(出力先は引数で変えられる)。

同じ検証が、PR で自動で動く(`.github/workflows/validate-extensions.yml`。`extensions/**`・`scripts/**` などを触る PR)。

## PR の流れ

1. PR を作る(テンプレートの確認項目: ライセンス・プライバシーの記述・通信しないこと・権限が最小であること)。
2. CI の検証が通ること。
3. オーナーがレビューする(`.github/CODEOWNERS` で `extensions/**` と `src/lib/extensions/**` などはオーナーのレビューが必須の対象。**CODEOWNERS のファイルだけでは強制されないので、リポジトリのブランチ保護で「Require review from Code Owners」を有効にする必要がある。ブランチ保護は、コードからは設定できない**)。
4. マージされると、サイトのデプロイ(`extensions/**` で動く)で `index.json` とバンドルが更新され、アプリの「拡張機能を探す」に現れる。

更新するときは、`version` と `updatedAt` を上げる。**公開済みの版のファイルは書き換えない**(バンドルは版ごとの URL で、長くキャッシュされる)。権限・プライバシーの記述を変えると、利用者に再同意を求める。

## 審査基準

- ライセンスが許可リスト内で、含まれる内容を再配布してよい(他人の著作物を許諾なく含めない。辞書は自作か、再配布を許されたものに限る)。
- `privacy` が実際の動作と合っている(確認できないことを書かない)。
- 通信しない・コードを含まない・権限が最小。
- 名前・説明が正確で、公式のものと誤認させない。
- 公序良俗に反しない。他者の権利を侵害しない。
- サイズと構成の上限を守る。

運営者は公開前に確認するが、**内容を保証しない**。アプリでは「コミュニティ」のラベルで表示する。

## 削除・停止の方針

基準に反する、権利者から申し立てがある、利用者に害を及ぼすおそれがある拡張は、`extensions/<id>/` を削除して、一覧から外す(次回のサイトの更新で配信が止まる)。すでに利用者の端末に入っているものは、利用者がアンインストールするまで残る。**ただし、スクリプトは、`extensions/revoked.json` に `{ "id", "versions": ["1.0.0"] または "*", "reason", "at" }` を足す PR で失効させられる**。アプリは、失効リストを確認して(設定を開いたとき・「更新を確認」・スクリプトを有効にしている場合の起動時に 1 日 1 回まで)、該当する版を自動で無効にし、理由を表示する。作者からの取り下げは、PR か Issue で受け付ける。
