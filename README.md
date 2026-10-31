# Storift

小説を書くための、ひとつの場所。

執筆・プロット・キャラクター・設定資料・進捗を、作品ごとにまとめて管理する小説執筆アプリです。ブラウザで動き、オフラインでも書けます。デスクトップ版では、Claude Code をサイドパネルから使えます。

- サイト: <https://storift.shiki-01.com>
- エディタ(Web 版): <https://app.storift.shiki-01.com>

## 特徴

- **執筆エディタ**: 作品を章とシーンに分けて執筆。30 秒ごとの自動保存、文字数表示、ルビ記法、書式設定。
- **縦書きプレビュー**: 縦書き・原稿用紙のレイアウトで確認。印刷用プレビューにも対応。
- **プロット / キャラクター / 設定資料**: 物語の材料を作品ごとに管理。キャラクターは相関図で整理できます。
- **進捗管理**: 執筆量を記録し、目標に対する進み具合を確認。
- **履歴と復元**: 作品のバージョンを残し、以前の状態へ戻せます。
- **エクスポート**: TXT / Markdown / DOCX / PDF / EPUB / JSON。シーン単位では、投稿サイト向けのルビ記法への変換にも対応しています。
- **オフライン対応(PWA)**: 一度開けば通信なしで起動し、原稿は端末内(IndexedDB)に保存されます。
- **複数端末の同期**: 利用者自身の Firebase プロジェクトを設定して同期します。データの保管先を自分で管理できます。
- **Claude Code 連携(デスクトップ版)**: 原稿を Markdown としてワークスペースに書き出し、`claude -p` で校正・矛盾チェック・質問・書き換えを行います。本文の変更は差分で確認してから反映できます。

## データの扱い

- 原稿は端末内(IndexedDB)に保存されます。Storift の運営するサーバーには送信されません。
- Firebase の設定は任意です。設定した場合のみ、利用者自身の Firebase(Firestore)にも保存されます。
- デスクトップ版の Claude Code 連携では、質問のたびに原稿の一部が Claude に送られます。利用にはインストール済みでログイン済みの Claude Code が必要で、利用料金・使用量はそのアカウントに計上されます。

## 使い方

Web 版は <https://app.storift.shiki-01.com> を開くだけで使えます。初回に Firebase の設定を案内されますが、「設定せずに始める」で省略できます(設定画面から後でも設定できます)。同期を使う場合の Firebase 側の設定とセキュリティルールは [docs/FIRESTORE_SETUP.md](docs/FIRESTORE_SETUP.md) を参照してください。

デスクトップ版は GitHub Releases から配布する予定です。未署名のため、初回起動時に OS の警告が出ます。手順は [docs/DESKTOP.md](docs/DESKTOP.md) にあります。

## 開発

必要なもの: [Bun](https://bun.sh/)、Node.js 22。デスクトップ版のビルドには加えて Rust と [Tauri の前提環境](https://tauri.app/start/prerequisites/)。

```sh
bun install
bun run dev            # 開発サーバー
bun run check          # 型チェック
bun run test           # テスト(vitest)
bun run lint           # prettier + eslint
bun run build          # Web 版のビルド
bun run desktop:dev    # デスクトップ版を開発モードで起動
bun run desktop:build  # デスクトップ版をビルド
```

### 構成

| 場所         | 内容                                       |
| ------------ | ------------------------------------------ |
| `src/`       | アプリ本体(SvelteKit + Svelte 5)           |
| `src-tauri/` | デスクトップ版のネイティブ側(Tauri v2)     |
| `site/`      | 紹介サイト(静的サイト。アプリとは独立)     |
| `docs/`      | 設計メモ・セットアップ手順                 |

### 技術スタック

SvelteKit / Svelte 5 / TypeScript / Master CSS / Dexie(IndexedDB) / Firebase(Firestore・同期のみ) / Tauri v2 / Cloudflare Pages

## ドキュメント

| ファイル                                                       | 内容                               |
| -------------------------------------------------------------- | ---------------------------------- |
| [docs/DESKTOP.md](docs/DESKTOP.md)                             | デスクトップ版と Claude Code 連携  |
| [docs/PWA.md](docs/PWA.md)                                     | オフライン対応と自動更新           |
| [docs/FIRESTORE_SETUP.md](docs/FIRESTORE_SETUP.md)             | Firestore の設定とセキュリティ     |
| [docs/SYNC_OPTIMIZATION.md](docs/SYNC_OPTIMIZATION.md)         | 同期の仕組みと最適化               |
| [docs/FIREBASE_USAGE_ESTIMATE.md](docs/FIREBASE_USAGE_ESTIMATE.md) | Firebase 無料枠での使用量の見積もり |
| [docs/SITE.md](docs/SITE.md)                                   | 紹介サイトとドメイン構成           |
| [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)                   | 自分の環境で配信する場合           |

## コントリビュート

[CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## ライセンス

[MIT License](LICENSE)。同梱の第三者の素材(フォントなど)は、それぞれのライセンスに従います。一覧は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります。
