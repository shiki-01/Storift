# PWA（オフライン対応・自動更新）

## 構成

| 役割                         | ファイル                                                              |
| ---------------------------- | --------------------------------------------------------------------- |
| オフライン用のキャッシュ     | `src/service-worker.ts`（SvelteKit 標準の Service Worker）            |
| インストール情報             | `static/manifest.webmanifest`、アイコンは `static/favicon/icon-*.png` |
| 登録と自動更新               | `src/lib/utils/sw-register.ts`、`src/routes/+layout.svelte`           |
| ヘッダー（常に最新を確認）   | `_headers`（プロジェクトルート）                                      |
| クライアントのみで動かす設定 | `src/routes/+layout.ts`（`ssr = false`）                              |

以前の `vite-plugin-pwa` / Workbox は、キャッシュ対象が空のままで実際にはオフラインで動かず、マニフェストのアイコンのパスも誤っていてインストールできなかったため、廃止した。

## オフラインで動く仕組み

- アプリは `ssr = false` で、どの URL でも同じ HTML（アプリの殻）で起動する。データは端末の IndexedDB にある。
- Service Worker は、インストール時にビルド成果物・静的ファイル・アプリの殻を、バージョン専用のキャッシュ（`storift-app-<build>`）へ保存する。
- ページの表示は保存済みの殻を即座に返す。殻と成果物は同じバージョンのものだけを使うので、更新の途中で食い違わない。
- フォント（`/font/*`）は大きいため、初回使用時にキャッシュする。Google Fonts は表示しながら裏で更新する。
- Firebase など外部への通信には介入しない（SDK がオフラインを扱う）。

## 配信元が更新されたとき

1. アプリを開いたとき、画面に戻ったとき、オンラインに戻ったとき、20 分ごと、`/_app/version.json` の変化を検知したときに、Service Worker の更新を確認する。
2. 新しいバージョンが見つかると、裏でキャッシュを作る（古いバージョンはそのまま動く）。
3. **未保存の本文・保存中・同期中が無いときに**、自動で新しいバージョンへ切り替えて再読み込みする。あるときは「保存が終わると自動で更新します」と知らせて待つ。
4. 古いキャッシュは削除される。端末のデータ（IndexedDB）には触れない。

設定画面の「バージョン情報」で、ビルドと Service Worker のバージョンを確認でき、「更新を確認」で手動でも確認できる。

## ビルド識別子

`svelte.config.js` の `kit.version.name` が識別子になる。Cloudflare Pages ではコミット SHA（`CF_PAGES_COMMIT_SHA`）、ローカルでは時刻。デプロイのたびに変わるので、新しいデプロイは必ず更新として検知される。

## ローカルでの確認方法

```sh
bun run build
bunx wrangler pages dev .svelte-kit/cloudflare   # Cloudflare Pages と同じ配信
```

- 開発サーバー（`bun run dev`）では Service Worker を無効にし、既存の登録とキャッシュを削除する。
- ブラウザの開発者ツール → Application → Service Workers で、`/service-worker.js` が有効か確認できる。
- 「オフライン」にしてから任意の URL（例: `/home`）を再読み込みしても開ければ正常。

## 制限

- iOS では、ホーム画面に追加した PWA が一定期間使われないと、ブラウザのデータ（IndexedDB を含む）が削除される場合がある。大事なデータは設定画面のエクスポートでバックアップする。
- 初回のアクセスはオンラインが必要（そのとき Service Worker がキャッシュを作る）。
