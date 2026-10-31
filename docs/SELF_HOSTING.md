# 自分の環境で配信する

Storift の Web 版は、サーバー処理を持たない静的ファイルの集まりです。原稿は利用者の端末(IndexedDB)に保存され、同期を使う場合のみ利用者自身の Firebase に保存されます。このため、Storift 側に預けるデータはなく、一般的な意味でのセルフホスト(自前のサーバーとデータベースの運用)は必要ありません。

自分の環境で配信するのは、次のような場合に限られます。

- 独自ドメインで配信したい。
- フォークして改変したものを配信したい。
- 配信元を第三者に依存したくない。

## 手順

```sh
bun install
bun run build
```

`.svelte-kit/cloudflare` に出力されます(`@sveltejs/adapter-cloudflare`)。Cloudflare Pages 以外で配信する場合は、`svelte.config.js` のアダプターを `@sveltejs/adapter-static` などに差し替えます(デスクトップ版のビルドでは `adapter-static` を使っています)。

Service Worker と PWA の動作には HTTPS が必要です(`localhost` を除く)。

## 同期に使う Firebase

1. Firebase でプロジェクトを作成し、Firestore と匿名認証を有効にする。
2. 配信するドメインを、Authentication の「承認済みドメイン」に追加する。
3. Firestore のセキュリティルールを設定する([FIRESTORE_SETUP.md](FIRESTORE_SETUP.md))。
4. アプリの初回画面(または設定画面)に、Firebase の設定を貼り付ける。同期を使わない場合は不要です。

Firebase の設定値はビルドに含めず、利用者が端末ごとに入力します。

## 紹介サイト

`site/` は独立した SvelteKit プロジェクトです。URL は環境変数 `PUBLIC_SITE_URL` と `PUBLIC_APP_URL` で変更します([SITE.md](SITE.md))。
