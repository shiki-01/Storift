# コントリビュート

不具合の報告、機能の提案、プルリクエストを受け付けています。

## 不具合・提案

Issue に次を書いてください。

- 使っている環境(Web 版のブラウザとバージョン、またはデスクトップ版の OS)
- 再現手順と、期待した動作・実際の動作
- 原稿の内容は書かないでください。必要な場合は、問題の再現に必要な最小限の文章にしてください。

## 開発の流れ

セットアップとコマンドは [README](README.md) を参照してください。プルリクエストの前に、次が通ることを確認してください。

```sh
bun run lint
bun run check
bun run test -- --run
bun run build
```

- `bun run test` は vitest で、`src/` 以下のテストだけを実行します(`--run` を付けないと、監視モードのまま終わりません)。
- 変更した内容によっては、次も確認してください。
  - `site/` を変えた場合: `cd site` して `bun run lint`、`bun run check`、`bun run build`(`site/node_modules` が必要。なければ `bun install`)。
  - `src-tauri/`(Rust)を変えた場合: `cd src-tauri` して `cargo fmt --check` と `cargo test`。
  - `firestore.rules` を変えた場合: `bun run test:rules`(Java と Firebase Emulator が必要。`firebase emulators:exec` を使います)。あわせて、紹介サイトのガイドに載せたルールの写し(`site/src/lib/firestoreRules.ts`)も同じ内容に更新してください。`bun run test` が一致を検証します。
- 画面を変えた場合は、関連する E2E を `bun run test:e2e:*` で実行してください。Playwright の Chromium を使い、`vite dev` を空きポートで起動します。**並行して実行すると不安定になるものがあるので、1 本ずつ実行してください。**
  - `test:e2e`(共同編集): Firebase Emulator(auth・firestore)を使います。
  - `test:e2e:mobile` / `:preview` / `:settings` / `:ai-header` / `:ai-select` / `:user-select` / `:scrollbar` / `:progress` / `:plot` / `:characters` / `:worldbuilding` / `:toolbar`: エミュレータは不要です。
- 拡張機能を足すときは、[docs/EXTENSIONS.md](docs/EXTENSIONS.md) の「公式拡張の追加手順」を読んでください。`extensions/<id>/manifest.json`(名前・対応環境・権限・送る情報。アプリとサイトの両方が読みます)を書き、`src/lib/extensions/builtin/<id>/` に実装して、`registry.ts` に登録します。**マニフェストの `privacy` は事実だけを書き**、送る情報や保存場所を変えたら、同じ変更でマニフェストも直してください(利用者に再同意を求める仕組みがあります)。コミュニティの拡張は、**パック**(コードを含まない JSON)と**スクリプト**(隔離して実行する 1 ファイルの JavaScript。[docs/SCRIPT_API.md](docs/SCRIPT_API.md))を、`extensions/<id>/` への PR で受け付けています。作り方・基準・検証(`bun run validate:extensions`)は [docs/COMMUNITY.md](docs/COMMUNITY.md) を読み、PR には `.github/PULL_REQUEST_TEMPLATE/extension.md`(URL に `?template=extension.md`)を使ってください。`extensions/**` と `src/lib/extensions/**` の変更は、オーナーのレビューが必要です。スクリプトの隔離(`src/lib/extensions/script/`)を触る変更は、必ず `bun run test:e2e:scripts`(実際の Chromium で、悪意のあるスクリプトを止められることの確認)を通してください。
- コードの整形は Prettier、静的解析は ESLint に従います(`bun run format` で整形できます)。
- 挙動を変える場合は、可能な範囲でテストを追加してください。
- 変更は目的ごとに分け、コミットメッセージは変更の内容が分かるように書いてください。

### CI

GitHub Actions が実行するのは、次のコマンドです。**`bun run lint`、`test:rules`、E2E は CI では動かない**ので、手元で確認してください。

| ワークフロー | いつ                             | コマンド                                               |
| ------------ | -------------------------------- | ------------------------------------------------------ |
| Web CI       | PR                               | `bun run check` / `bunx vitest run` / `bun run build`  |
| Deploy App   | main への push                   | 同上のあと、Cloudflare Pages へ配信                    |
| Desktop      | PR(デスクトップ版に関係する変更) | Linux で `cargo test`、各 OS で `--no-bundle` のビルド |

## リリース

1. `package.json` の `version` を上げます(`src-tauri/Cargo.toml` の `version` も揃えます)。
2. 変更点を [CHANGELOG.md](CHANGELOG.md) に書きます。
3. `main` に入れます。`release.yml` が `v<version>` のタグを作り、`desktop.yml` がインストーラーのビルドと GitHub Releases への公開までを行います。手順の詳細は [docs/DESKTOP.md](docs/DESKTOP.md) の「リリースの手順」を参照してください。

## 変更前の相談

大きな変更(データ構造、同期、デスクトップ版の AI 連携など)は、実装の前に Issue で方針を相談してください。
