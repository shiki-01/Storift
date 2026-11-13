# サイト（ブランディングサイト）とドメイン構成

## 構成

| 役割               | URL                        | ソース         | Cloudflare Pages プロジェクト |
| ------------------ | -------------------------- | -------------- | ----------------------------- |
| サイト（紹介）     | `storift.shiki-01.com`     | `site/`        | `storift-site`                |
| エディタ（アプリ） | `app.storift.shiki-01.com` | リポジトリ直下 | `storift`（既存）             |

- サイトは SvelteKit + `adapter-static` の静的サイト。ページは `/`、`/features`、`/guide`、`/guide/firebase`(Firebase 同期の設定ガイド)、`/extensions`(拡張機能の一覧)、`/extensions/<id>`(拡張ごとのページ。リポジトリ直下の `extensions/<id>/manifest.json` から、ビルド時に生成する。公式とコミュニティ(パック・スクリプト)の両方を載せ、スクリプトには権限(イベント・通信先・ストレージ・通知・画面)と隔離の注意を表示し、コミュニティには出所のラベルを出す。「この拡張が扱う情報」はプライバシーポリシーの一部)、`/extensions/submit`(拡張機能を投稿する方法。固定のルートなので、`[id]` より優先される。そのため `submit` は拡張の id に使えない)、`/faq`、`/support`(開発の支援)、`/privacy`(プライバシーポリシー)、`/terms`(利用規約)。
- アプリのコード・ビルドは変更しない。サイトは `site/` に独立した `package.json` を持つ。
- サイトとアプリは別オリジンになる。Cookie・IndexedDB・Service Worker は共有されない（意図した分離）。

## アプリの画面を載せている箇所

- トップの操作デモ(`site/src/lib/demo/`)は動画ではなく、見本の部品を台本どおりに動かしている。アプリのコンポーネントは import せず、見た目だけをサイト側の部品(`DemoEditor`・`DemoPlot`・`DemoCharacters`・`DemoRelation`・`DemoWorld`・`DemoProgress`)として書いている。台本は `AppDemo.svelte` の `scripts`(書く・プロット・人物・設定資料・進捗の 5 場面)で、動きを減らす設定(`prefers-reduced-motion`)では各場面の最後の状態をそのまま見せる。アプリの画面を作り直したら、合わせて直す(配色は `app.css` のトークンだけを使い、色の見本は基調色の `color-mix` で作る)。
- 実画面の画像は `site/static/shots/`(WebP、1920x1200。ライト/ダークの 2 枚ずつ、1 枚 100KB 前後)にある。使っている場所は、トップの `Gallery.svelte`(`split`・`plot`・`characters`・`relation`・`world`・`preview`・`progress`・`home`)、機能の頁(`editor`・`plot`・`preview`)、使い方の頁(`settings`)。

### 実画面の撮り直し

アプリの dev サーバーを 5181 番で起動し、リポジトリ直下で次を実行する。Playwright の Chromium(E2E と同じ、インストール済みのもの。`playwright install` はしない)で撮り、撮影用の作品(`site/scripts/seed.js`。架空の作品「雨の日の栞」)を使い捨てのコンテキストに入れるので、手元の作品には触れない。

```bash
bun run dev -- --port 5181 --strictPort   # 別のターミナルで起動しておく
node site/scripts/capture-shots.mjs                  # すべて撮る(約 3 分)
node site/scripts/capture-shots.mjs plot world       # 名前を指定すると、その画像だけ撮る
```

| 名前         | 画面                                                             |
| ------------ | ---------------------------------------------------------------- |
| `home`       | 作品一覧(チュートリアルの案内は閉じて撮る)                       |
| `editor`     | 執筆(「祖母の栞」を開いた状態)                                   |
| `split`      | 執筆の二画面表示(本文と縦書きのプレビュー)                       |
| `plot`       | プロットのボード(四つの列がすべて見える。詳細は開かない)         |
| `characters` | 人物の一覧と詳細(「朝倉 灯」を開いた状態)                        |
| `relation`   | 人物の相関図                                                     |
| `world`      | 設定資料の一覧と詳細(「坂の上の古書店」を開いた状態)             |
| `progress`   | 進捗                                                             |
| `preview`    | 通読(横書き。作品名の見出しから)                                 |
| `settings`   | 設定の「外観」(「システム設定に従う」を外し、配色の枠を合わせる) |

- 日時は、撮影スクリプトの `FIXED_TIME`(`2026-06-14T10:00:00+09:00`)に、ブラウザの時計とタイムゾーン(Asia/Tokyo)を固定している。進捗のカレンダー、プロットの「更新 日付」、詳細の更新日時が、実行日に依らず同じ絵になる。
- データは `seed.js` が `projectsDB` などへ直接書き込む。人物・設定資料・プロットを足したいときは、そこに追記する(実在の作品名・人名は使わない)。
- 画像は 1280x800 の表示を 1.5 倍で撮り、WebP(quality 82)で書く。1 枚が 150KB を超えたら、`QUALITY` を下げる。
- 撮ったら 1 枚ずつ開いて、崩れ・切れ・日付・個人情報(端末のパス、Firebase の設定、API キー)が写っていないか、ライトとダークで確かめる。画像を足したら、`Gallery.svelte` の `shots`(名前・タブ名・alt)か、使う頁の `Shot` に追加する。

## URL の設定

サイトの URL とエディタの URL は、環境変数で 1 か所から設定する（`site/src/lib/config.ts`）。

| 変数              | 用途                            | 例                                 |
| ----------------- | ------------------------------- | ---------------------------------- |
| `PUBLIC_SITE_URL` | canonical・OGP・sitemap・robots | `https://storift.shiki-01.com`     |
| `PUBLIC_APP_URL`  | 「エディタを開く」などの遷移先  | `https://app.storift.shiki-01.com` |

未設定の場合は、上表の例の URL（`storift.shiki-01.com` / `app.storift.shiki-01.com`）が使われるため、通常は設定不要。別のドメインに変えるときだけ環境変数で上書きする。

## Cloudflare Pages の設定

### サイト（新規プロジェクト `storift-site`）

- Git 連携: このリポジトリ
- ルートディレクトリ: `site`
- ビルドコマンド: `bun run build`
- ビルド出力ディレクトリ: `build`
- 環境変数: `PUBLIC_SITE_URL`、`PUBLIC_APP_URL`（上表）
- カスタムドメイン: `storift.shiki-01.com`

### アプリ（既存プロジェクト `storift`）

- カスタムドメインに `app.storift.shiki-01.com` を追加
- 「ビルドウォッチパス」の除外に `site/*` を追加（サイトだけの変更でアプリを再ビルドしない）

## GitHub Actions で配信する

`.github/workflows/deploy-app.yml`(エディタ)と `deploy-site.yml`(サイト)が、`main` への push で wrangler を使って Cloudflare Pages へ配信する。エディタはサイト以外の変更、サイトは `site/` の変更があったときだけ動く。手動実行(workflow_dispatch)もできる。

### 事前準備

1. Cloudflare の API トークンを作る(権限: Account → Cloudflare Pages → Edit)。
2. GitHub の Settings → Secrets and variables → Actions に登録する。
   - Secrets: `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
   - Variables(任意): `PUBLIC_SITE_URL`、`PUBLIC_APP_URL`(サイトのビルドで使う。未設定なら既定のドメイン)
3. 配信先のプロジェクトを **ダイレクトアップロード** 形式で用意する。

### Cloudflare の自動デプロイ(Git 連携)を切る

Git 連携のプロジェクトは、ダイレクトアップロード形式へ変更できず、wrangler からは配信できない。そのため次のどちらかにする。

- **推奨: ダイレクトアップロードのプロジェクトを作り直す**
  1. Workers & Pages → Create → Pages → 「Upload assets」で、プロジェクトを作る(名前はワークフローの `PAGES_PROJECT`。既存と同じ名前にするには、旧プロジェクトの削除が先に必要)。
  2. 旧プロジェクトのカスタムドメイン(`app.storift.shiki-01.com` など)を外し、新しいプロジェクトへ付け替える。
  3. 旧プロジェクトは削除する。これで Git 連携による二重の自動デプロイが止まる。
- **配信は Git 連携のまま、ワークフローは使わない**
  プロジェクトの Settings → Builds → Branch control で、「Automatic production branch deployments」をオフにし、プレビューも「None」にする。ただし、その場合は配信する手段がなくなるため、ダイレクトアップロード側のプロジェクトが別に必要になる。

アプリのドメイン(`app.` 側)を付け替える間は、短時間つながらなくなる。作業は影響の少ない時間に行う。

## DNS

Cloudflare でドメインを管理している場合、Pages のカスタムドメイン追加で CNAME が自動作成される。手動で設定する場合:

| 種別  | 名前      | 値                       |
| ----- | --------- | ------------------------ |
| CNAME | `storift` | `storift-site.pages.dev` |
| CNAME | `app`     | `storift.pages.dev`      |

## アプリを別オリジンへ移すときの注意

- 端末内のデータ（IndexedDB）はオリジンごとに分かれる。旧 URL（`storift.pages.dev` など、現在の配信元）で作った作品は、`app.` 側からは見えない。移行前に設定画面のエクスポートで書き出すか、同期（Firebase）で取り込む。
- Firebase Console → Authentication → 設定 → 承認済みドメイン に、`app.storift.shiki-01.com` を追加する（匿名認証を使っているため必須）。
- インストール済みの PWA は旧オリジンのまま残る。新しい URL から入れ直す。

## 証明書

`app.storift.shiki-01.com` は 2 階層のサブドメインになる。Cloudflare Pages のカスタムドメインとして追加すれば証明書は個別に発行されるが、発行されない場合は、Cloudflare の SSL/TLS 設定でこのホスト名が対象になっているか確認する。

## 拡張機能のレジストリ

- サイトのビルド(`bun run build` / `dev`)の前に、`bun run registry`(`bun ../scripts/build-registry.ts`)が、`extensions/*/manifest.json` から `site/static/extensions-registry/` を生成する(`index.json` と `<id>/<version>.storiftext.json`。コミットしない。`site/.gitignore`)。`site/build` に出て、アプリが `https://storift.shiki-01.com/extensions-registry/` から取得する。仕様は [docs/EXTENSIONS.md](EXTENSIONS.md)。
- `/extensions` と `/extensions/<id>` は、同じ `extensions/*/manifest.json` から作る(`site/src/lib/extensions.ts`。`_template` は除く)。
- `site/static/_headers` で `/extensions-registry/*` に CORS(`Access-Control-Allow-Origin: *`)と Cache-Control を付ける。規則を重ねない(重なると Cache-Control が連結される)。
- デプロイ: `.github/workflows/deploy-site.yml` は、`site/**` に加えて `extensions/**`、`scripts/` のうち検証・生成に使うもの、`src/lib/extensions/` の `manifest.ts` / `pack.ts` / `registryIndex.ts` の変更でも動く。アプリ(`deploy-app.yml`)は `site/**` などを除く変更で動くので、`extensions/**` の変更では両方が動く。
- ビルド確認のとき、リポジトリ直下の `.svelte-kit/` が無い状態でも通ること(CI にはそれが無い。`site/vite.config.ts` の `esbuild.tsconfigRaw: '{}'` が、直下の tsconfig を読み込ませないために必要)。成果物(`site/build`)の HTML が、`/_app/...` の絶対パスで CSS / JS を参照していること(`kit.paths.relative: false`)も確認する。

### スクリプトとレジストリ

- `extensions/_template-script/` は、ひな形(サイトの一覧・レジストリには載せない。`site/src/lib/extensions.ts` の glob で除外)。
- バンドルにはスクリプトのソースが入る(`files` に `entry`)。`index.json` には、`revoked`(`extensions/revoked.json` から生成。空でも出す)と、権限の要約の `notify`・`ui` が加わる。
- サイトのデプロイ(`.github/workflows/deploy-site.yml`)は、`src/lib/extensions/script/**`(`manifest.ts` が読む上限、`scripts/lib/` が読む静的な検査)の変更でも動く。
- `/extensions/submit` に、スクリプトの投稿方法がある。プライバシーポリシー・利用規約は、スクリプトの提供・失効リストの確認(スクリプトを有効にしているときだけ起動時に 1 日 1 回)に合わせて改定済み。
