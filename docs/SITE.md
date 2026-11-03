# サイト（ブランディングサイト）とドメイン構成

## 構成

| 役割               | URL                        | ソース         | Cloudflare Pages プロジェクト |
| ------------------ | -------------------------- | -------------- | ----------------------------- |
| サイト（紹介）     | `storift.shiki-01.com`     | `site/`        | `storift-site`                |
| エディタ（アプリ） | `app.storift.shiki-01.com` | リポジトリ直下 | `storift`（既存）             |

- サイトは SvelteKit + `adapter-static` の静的サイト。ページは `/`、`/features`、`/guide`、`/guide/firebase`(Firebase 同期の設定ガイド)、`/faq`、`/privacy`(プライバシーポリシー)、`/terms`(利用規約)。
- アプリのコード・ビルドは変更しない。サイトは `site/` に独立した `package.json` を持つ。
- サイトとアプリは別オリジンになる。Cookie・IndexedDB・Service Worker は共有されない（意図した分離）。

## アプリの画面を載せている箇所

- トップの操作デモ(`site/src/lib/demo/`)は動画ではなく、見本の部品を台本どおりに動かしている。アプリの見た目を大きく変えたら合わせて直す。
- 実画面の画像は `site/static/shots/` にある。アプリの dev サーバーを 5181 番で起動し、リポジトリ直下で次を実行すると撮り直せる。使い捨てプロファイルの Chrome で撮るので、手元の作品には触れない。

```bash
node site/scripts/capture-shots.mjs
```

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
