# サイト（ブランディングサイト）とドメイン構成

## 構成

| 役割               | URL                      | ソース         | Cloudflare Pages プロジェクト |
| ------------------ | ------------------------ | -------------- | ----------------------------- |
| サイト（紹介）     | `storift.<ドメイン>`     | `site/`        | `storift-site`                |
| エディタ（アプリ） | `app.storift.<ドメイン>` | リポジトリ直下 | `storift`（既存）             |

- サイトは SvelteKit + `adapter-static` の静的サイト。ページは `/`、`/features`、`/guide`、`/faq`。
- アプリのコード・ビルドは変更しない。サイトは `site/` に独立した `package.json` を持つ。
- サイトとアプリは別オリジンになる。Cookie・IndexedDB・Service Worker は共有されない（意図した分離）。

## URL の設定

サイトの URL とエディタの URL は、環境変数で 1 か所から設定する（`site/src/lib/config.ts`）。

| 変数              | 用途                            | 例                            |
| ----------------- | ------------------------------- | ----------------------------- |
| `PUBLIC_SITE_URL` | canonical・OGP・sitemap・robots | `https://storift.example`     |
| `PUBLIC_APP_URL`  | 「エディタを開く」などの遷移先  | `https://app.storift.example` |

未設定の間は Cloudflare Pages の既定ドメイン（`storift-site.pages.dev` / `storift.pages.dev`）を使う。

## Cloudflare Pages の設定

### サイト（新規プロジェクト `storift-site`）

- Git 連携: このリポジトリ
- ルートディレクトリ: `site`
- ビルドコマンド: `bun run build`
- ビルド出力ディレクトリ: `build`
- 環境変数: `PUBLIC_SITE_URL`、`PUBLIC_APP_URL`（上表）
- カスタムドメイン: `storift.<ドメイン>`

### アプリ（既存プロジェクト `storift`）

- カスタムドメインに `app.storift.<ドメイン>` を追加
- 「ビルドウォッチパス」の除外に `site/*` を追加（サイトだけの変更でアプリを再ビルドしない）

## DNS

Cloudflare でドメインを管理している場合、Pages のカスタムドメイン追加で CNAME が自動作成される。手動で設定する場合:

| 種別  | 名前            | 値                       |
| ----- | --------------- | ------------------------ |
| CNAME | `@` / `storift` | `storift-site.pages.dev` |
| CNAME | `app`           | `storift.pages.dev`      |

## アプリを別オリジンへ移すときの注意

- 端末内のデータ（IndexedDB）はオリジンごとに分かれる。旧 URL（`storift.pages.dev` など）で作った作品は、`app.` 側からは見えない。移行前に設定画面のエクスポートで書き出すか、同期（Firebase）で取り込む。
- Firebase Console → Authentication → 設定 → 承認済みドメイン に、`app.storift.<ドメイン>` を追加する（匿名認証を使っているため必須）。
- インストール済みの PWA は旧オリジンのまま残る。新しい URL から入れ直す。
