# デスクトップ版(Tauri)

Storift を macOS / Windows / Linux のデスクトップアプリとして動かし、Claude Code をサイドパネルで使えるようにしたもの。

## 構成

| 場所                                            | 役割                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `src-tauri/`                                    | Tauri v2 のネイティブ側(Rust)                                            |
| `src-tauri/src/claude.rs`                       | `claude -p` の起動・出力の中継・中断                                     |
| `src-tauri/src/workspace.rs`                    | 原稿の書き出し先(ワークスペース)へのファイル同期                         |
| `src-tauri/src/shell_env.rs`                    | ログインシェルの環境変数(PATH など)の取り込み                            |
| `src/lib/desktop/`                              | フロントエンドからネイティブ側の呼び出し、原稿の Markdown 化、出力の解釈 |
| `src/lib/stores/claude.svelte.ts`               | パネルの状態・会話・設定                                                 |
| `src/lib/components/desktop/ClaudePanel.svelte` | サイドパネルの UI                                                        |

フロントエンドは Web 版と同じ SvelteKit のコードで、Tauri から起動したときだけ `adapter-static` で静的ファイルとして書き出してアプリに同梱する(`svelte.config.js` が `TAURI_ENV_PLATFORM` を見て切り替える)。Service Worker はデスクトップ版では登録しない。

## Claude Code パネル

ヘッダーの「Claude」ボタンか `Ctrl(Cmd)+Shift+L` で開閉する。

### 仕組み

1. 送信のたびに、IndexedDB の全プロジェクトを Markdown に書き出し、アプリのデータディレクトリ内の `workspace/` に同期する(変更のあったファイルだけ書き換え、消えたシーンのファイルは削除)。
2. `workspace/` を作業ディレクトリにして `claude -p --output-format stream-json` を起動し、プロンプトを標準入力で渡す。
3. 出力を 1 行ずつパネルへ流し、逐次表示する。会話は Claude Code のセッション ID(`--resume`)で続く。

ワークスペースの構成:

```
workspace/
  CLAUDE.md                     # Claude への説明と作品一覧
  projects/<作品名>/
    概要.md                     # 説明・目次・文字数
    本文/<01_章名>/<01_シーン名>.md
    キャラクター.md / 設定資料.md / プロット.md
```

`CLAUDE.md` があるので、全作品を横断した質問(表記ゆれ、設定の使い回しなど)にも Claude が自分で Grep / Read して答える。

### 添付と文脈

- 開いている作品・シーンの名前とファイルの場所は、毎回 `<storift_context>` としてプロンプトの先頭に付く。
- 「シーン本文を添付」はエディタの現在の本文(未保存の分も含む)を添付する。
- 「選択範囲」はパネルの外で最後に選択した文章を添付する。
- 「校正」「矛盾チェック」などのボタンは、選択範囲があればそれを、なければシーン全体を対象にする。

### 安全のための制限

- 使えるツールは `Read` / `Glob` / `Grep`(設定で Web 検索を許可したときは `WebSearch` / `WebFetch` も)だけ。`Bash` / `Edit` / `Write` は禁止している。
- ワークスペースはアプリからの一方向の写しで、Claude がファイルを書き換えることはない。修正案は回答の中で示し、反映はユーザーがエディタで行う。

### 必要なもの

Claude Code がインストール済みで、ログインしていること。

```sh
# macOS / Linux
curl -fsSL https://claude.ai/install.sh | bash
# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex
```

インストール後、ターミナルで一度 `claude` を起動してログインする。デスクトップから起動したアプリはシェルの PATH を持たないため、起動時にログインシェルから環境変数を読み込み、さらに `~/.local/bin` などのよくある場所を探す。見つからない場合はパネルの「設定」で実行ファイルの場所を指定できる。

## 開発

```sh
bun install
bun run desktop:dev     # 開発サーバー + アプリを起動
bun run desktop:build   # 配布用にビルド
```

Linux では WebKitGTK などが必要(`.github/workflows/desktop.yml` の「Install Linux dependencies」を参照)。

## ビルドと配布(GitHub Actions)

| ワークフロー                    | 内容                                                              |
| ------------------------------- | ----------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | Web 版の型チェック・テスト・ビルド                                |
| `.github/workflows/desktop.yml` | macOS(Apple Silicon / Intel)・Windows・Linux 向けにアプリをビルド |

- main への push と PR では、ビルドした `.dmg` / `.msi` / `.exe` / `.deb` / `.rpm` / `.AppImage` を Actions の Artifacts に置く。
- `v` から始まるタグ(例: `v0.1.0`)を push すると、それらを添付した下書きのリリースを GitHub Releases に作る。アプリのバージョンは `package.json` の `version` を使うので、タグと合わせて更新する。

### 署名について

現状はコード署名をしていない。

- macOS: 初回は Finder で右クリック →「開く」で起動する。「壊れている」と出る場合は `xattr -cr /Applications/Storift.app` を実行する。
- Windows: SmartScreen の警告が出たら「詳細情報」→「実行」。

署名する場合は Apple Developer ID / Windows のコード署名証明書を用意し、Tauri の署名用の環境変数(`APPLE_CERTIFICATE` など)をリポジトリの Secrets に登録してワークフローに渡す。

## 既知の制限

- データ(IndexedDB)は Web 版とは別に、アプリ内に保存される。端末間・Web 版との共有は既存の Firebase 同期を使う。デスクトップ版のオリジン(`tauri://localhost` / `http://tauri.localhost`)で Firebase 認証が通らない場合は、Firebase コンソールの承認済みドメインに `tauri.localhost` を追加する。
- Claude Code の利用料金・使用量は、ログインしている Claude のアカウントに計上される。
