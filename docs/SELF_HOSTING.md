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
3. Firestore のセキュリティルール(`firestore.rules`)を公開する([FIRESTORE_SETUP.md](FIRESTORE_SETUP.md))。
4. 最初の端末で、アプリの初回画面(または設定画面)に Firebase の設定を貼り付ける。同期を使わない場合は不要です。新ルールの公開後、この端末が自動でオーナーとして登録されます。
5. 2 台目以降の端末では、Firebase の設定値の代わりに、最初の端末の 設定 →「設定コード」で表示したコードを貼り付ける。

Firebase の設定値はビルドに含めず、利用者が端末ごとに入力します。設定コードは Firebase の設定とオーナー鍵をまとめたもので、持つ人は全データにアクセスできるため、自分の端末にだけ貼ってください。旧ルール(認証済みなら全開放)のままでも同期は従来どおり動きますが、共有機能は使えません。

### 招待リンク(共有)を使う場合

- 招待リンクの `<base>` は、Web 版では配信しているドメイン(`location.origin`)、デスクトップ版では公開アプリの URL(既定 `https://app.storift.shiki-01.com`)です。自分のドメインで配信し、デスクトップ版でもそちらを使いたい場合は、`src/lib/firebase/invite.ts` の `PUBLIC_APP_URL` を書き換えてビルドしてください(定数 1 か所です)。
- 招待された人(ゲスト)は、そのドメインのアプリから**ホストの Firebase に匿名認証で接続**します。ホストの Firebase の Authentication → 承認済みドメインに、**ゲストがアプリを開くドメイン**(自分で配信しているドメイン、公開版を使うならそのドメイン)を追加してください。ゲスト側に Firebase の設定は不要です。
- 共有機能には新ルール(`firestore.rules`)が必要です。旧ルールのままでは、ゲストは参加できません([FIRESTORE_SETUP.md](FIRESTORE_SETUP.md))。

## 紹介サイト

`site/` は独立した SvelteKit プロジェクトです。URL は環境変数 `PUBLIC_SITE_URL` と `PUBLIC_APP_URL` で変更します([SITE.md](SITE.md))。
