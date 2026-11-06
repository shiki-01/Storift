# デスクトップ版(Tauri)

Storift を macOS / Windows / Linux のデスクトップアプリとして動かし、AI(Claude Code・OpenAI 互換 API・Anthropic API・Gemini・Ollama)をサイドパネルで使えるようにしたもの。

## 構成

| 場所                                           | 役割                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/`                                   | Tauri v2 のネイティブ側(Rust)                                                                                                 |
| `src-tauri/src/claude.rs`                      | `claude -p` の起動・出力の中継・中断                                                                                          |
| `src-tauri/src/mcp.rs`                         | Claude Code が呼ぶ MCP サーバー(127.0.0.1)。呼び出しをフロントへ中継する。ツール定義を TS へ渡す `ai_tool_definitions` もここ |
| `src-tauri/src/secrets.rs`                     | API キーの保管(`secret_set` / `secret_get` / `secret_delete`)。macOS / Windows は OS のキーチェーン                           |
| `src-tauri/src/workspace.rs`                   | 原稿の書き出し先(ワークスペース)へのファイル同期                                                                              |
| `src-tauri/src/shell_env.rs`                   | ログインシェルの環境変数(PATH など)の取り込み                                                                                 |
| `src/lib/desktop/`                             | フロントエンドからネイティブ側の呼び出し、原稿の Markdown 化、出力の解釈                                                      |
| `src/lib/desktop/mcp.ts`                       | MCP ツール(storift)の処理。IndexedDB を読み、編集案を回答に記録する                                                           |
| `src/lib/ai/`                                  | AI プロバイダの抽象(型・登録簿・設定の移行・API キーの保管・HTTP 系の共通基盤・各プロバイダ)                                  |
| `src/lib/stores/ai.svelte.ts`                  | パネルの状態・会話・設定                                                                                                      |
| `src/lib/components/desktop/AiPanel.svelte`    | サイドパネルの UI                                                                                                             |
| `src/lib/components/settings/AiSection.svelte` | 設定の「AI」(プロバイダの選択と各設定)                                                                                        |

フロントエンドは Web 版と同じ SvelteKit のコードで、Tauri から起動したときだけ `adapter-static` で静的ファイルとして書き出してアプリに同梱する(`svelte.config.js` が `TAURI_ENV_PLATFORM` を見て切り替える)。Service Worker はデスクトップ版では登録しない。

## AI プロバイダ

設定の「AI」の先頭でプロバイダを選ぶ(カードに、必要なものと送信先が出る)。**選んだプロバイダに、質問と原稿の一部(AI がツールで読んだ範囲)が送られる。**

設定カードの並び順は、Claude Code・OpenAI 互換 API・Anthropic API・Gemini・Ollama(`providers/index.ts` の登録順)。

### 対応プロバイダ

| プロバイダ      | 必要なもの                                   | 送信先                                                               | ツール使用 | Web 検索 | キーの保存場所                                         |
| --------------- | -------------------------------------------- | -------------------------------------------------------------------- | ---------- | -------- | ------------------------------------------------------ |
| Claude Code     | Claude Code のインストールとログイン         | Anthropic(Claude Code 経由)                                          | 使える     | 使える   | なし(Claude Code のログインを使う)                     |
| OpenAI 互換 API | API キー(ローカルのサーバーでは不要)とモデル | 設定した Base URL のサービス                                         | 使える     | 使えない | OS のキーチェーン(`openai-compatible:<プリセット ID>`) |
| Anthropic API   | Anthropic の API キーとモデル名              | `api.anthropic.com`(Base URL を変えたら設定中の URL)                 | 使える     | 使えない | OS のキーチェーン(`anthropic:api-key`)                 |
| Gemini          | Google AI Studio の API キーとモデル名       | `generativelanguage.googleapis.com`(Base URL を変えたら設定中の URL) | 使える     | 使えない | OS のキーチェーン(`gemini:api-key`)                    |
| Ollama          | Ollama とツール呼び出しに対応したモデル      | この端末(設定した接続先)                                             | 使える     | 使えない | なし                                                   |

キーチェーンを使えない環境(Linux など)では、キーは端末内の localStorage に平文で保存される(後述)。Claude Code と Ollama は Rust(`claude.rs` / `ollama.rs`)で、OpenAI 互換 API・Anthropic API・Gemini は TypeScript(`src/lib/ai/providers/`)で実行する。

### 構成(`src/lib/ai/`)

- `types.ts`: `AiProvider`(id・表示名・説明・必要なもの・送信先・設定スキーマ・`capabilities { webSearch, resume, tools }`・`run(request, emit, signal)`・`status()`・`listModels?()`・`testConnection?()`)と `AiSettings`。
- `registry.ts`: プロバイダの登録簿。`providers/index.ts` が組み込みの 5 つを上の並び順で登録する。新しいプロバイダは、実装を `providers/` に足し、`providers/index.ts` に登録し、設定フォームを `components/settings/ai/` に足す。
- `settings.ts`: 設定の既定値・読み込み・旧形式からの移行(後述)。
- `secrets.ts`: API キーの保管(後述)。
- `http/`: HTTP 系プロバイダの共通基盤。`agent.ts`(エージェントのループ)・`sse.ts`(SSE パーサー)・`errors.ts`(エラーの分類)・`url.ts`(接続先の検証)・`abort.ts`(中断とタイムアウト)・`fetch.ts`(`tauri-plugin-http` の fetch)。
- `providers/`: `claudeCode.ts` と `ollama.ts` は Rust を呼ぶ既存の経路を包むアダプタ(挙動は変えない)。`openaiCompatible.ts` / `openaiChat.ts` / `openaiPresets.ts` が OpenAI 互換 API、`anthropic.ts` / `anthropicChat.ts` が Anthropic API、`gemini.ts` / `geminiChat.ts` / `geminiSchema.ts` が Gemini。

画面(ストアとパネル)は、プロバイダの違いを意識せず `provider.run` を呼ぶ。出力は Claude Code の `stream-json` と同じ形の行(`system/init`・`stream_event`・`assistant`・`result`)で、`applyStreamLine` がそのまま畳み込む。ツール名は `mcp__storift__<名前>` に揃える。

### 設定と移行

設定は localStorage の `storift:ai-settings`(パネルは `storift:ai-panel`、会話は `storift:ai-chats`)。形は `{ provider, editMode, claudeCode: { model, claudePath, allowWeb }, ollama: { url, model }, openaiCompatible: { baseUrl, model, presetId }, anthropic: { baseUrl, model, maxTokens }, gemini: { baseUrl, model, maxOutputTokens? } }`。`maxTokens` の既定は 8192、`maxOutputTokens` は未設定ならリクエストに含めない。モデルは既定値を持たず、未選択なら送信前にエラーで選択を促す。API キーは含めない。

以前の `storift:claude-*` キーと、旧形式の設定(`provider: 'claude'` とフラットな項目)は、読み込み時に新キー・新形式へ移す(新キーが無いときだけ。旧キーは消さずに残す)。

### HTTP 系プロバイダ(OpenAI 互換 API)

- エージェントのループは TypeScript で回す(`http/agent.ts`)。モデルの応答をストリームで受け、ツール呼び出しを集め、mcp.ts の `callTool` を直接呼んで結果を履歴に足し、次のステップへ進む(最大 12 ステップ)。MCP のトランスポートは経由しない。
- ツール定義は Rust の `tool_definitions` を Tauri コマンド `ai_tool_definitions(mode, allow_web)` で受け取り、プロバイダごとの形式(OpenAI は `tools: [{type: 'function', function}]`)へ変換する。
- `POST {baseUrl}/chat/completions`(`stream: true`、`tool_choice: 'auto'`)。SSE を行単位で読み、`delta.content` と `delta.tool_calls`(index ごとに引数の断片を結合)を集める。`[DONE]` かストリームの終わりで 1 ステップを終える。`stream` を無視して JSON で返すサーバーにも対応する。
- 1 リクエストのタイムアウトは 600 秒。`AbortSignal` で中断でき、パネルの「中断」で止まる。
- エラーは HTTP ステータスで分類して日本語にする(401/403 は認証、404 は URL とモデル、429 はレート制限、5xx はサービス側)。API キーはメッセージに含めない。
- 会話の履歴はメモリ上で持つ(セッション ID は `openai-<runId>`)。アプリを再起動すると、モデル側は新しい会話になる(Ollama と同じ)。
- プリセット: OpenAI / OpenRouter / LM Studio(ローカル) / Groq / DeepSeek / Mistral / カスタム。Base URL とモデル名の例が入る。モデルは `GET {baseUrl}/models` の一覧から選ぶか、直接入力する。「接続テスト」で一覧の取得を試し、成功・失敗の理由を日本語で見せる。
- 画面を再読み込みすると、実行中の HTTP 系の回答は途中で止まる(Claude Code と Ollama はネイティブ側で動くため、再読み込み後も受け取り直せる)。

### Anthropic API

- `POST {baseUrl}/v1/messages`(既定 `https://api.anthropic.com`、`stream: true`)。ヘッダーは `x-api-key`・`anthropic-version: 2023-06-01`・`content-type: application/json`。`max_tokens`(必須)は設定、`system` はトップレベルの文字列、`tools` は `{name, description, input_schema}`。
- SSE の `content_block_start`(`text` / `tool_use`)・`content_block_delta`(`text_delta`、`input_json_delta` の `partial_json` を結合)・`message_delta`(`stop_reason`)・`message_stop`・`ping`・`error` を処理する。`stop_reason` が `max_tokens` のときは、最大トークン数を増やすよう案内するエラーにする。
- assistant の `content` ブロック(`text` と `tool_use`)はそのまま履歴に残し、ツールの結果は次の user メッセージの `tool_result` ブロック(`tool_use_id`・`content`・失敗時は `is_error`)に 1 つにまとめて返す。システムプロンプトは履歴に入れず、リクエストごとに `system` で送る。
- モデル一覧は `GET {baseUrl}/v1/models?limit=100`(`has_more` なら `after_id` で続きを取る)。取得できなければモデル名を手入力する。`claude-sonnet-5-5` などは入力欄の候補としてだけ使い、既定値にはしない。
- エラー: 401/403 は認証、404 はモデル、400 は `invalid_request_error` の理由を短縮して添える、429 は `retry-after` があれば待ち時間、529 は過負荷、その他の 5xx は障害。

### Gemini

- `POST {baseUrl}/v1beta/models/{model}:streamGenerateContent?alt=sse`(既定 `https://generativelanguage.googleapis.com`)。API キーはヘッダー `x-goog-api-key` だけで送り、URL には付けない。ボディは `systemInstruction`・`contents`・`tools: [{functionDeclarations}]`・`toolConfig: {functionCallingConfig: {mode: 'AUTO'}}`、設定があれば `generationConfig.maxOutputTokens`。
- ツールのスキーマは `geminiSchema.ts`(純粋関数)で OpenAPI のサブセットに変換する。許可する項目(`type`・`description`・`enum`・`items`・`properties`・`required`・`minimum` など)だけを残し、`additionalProperties`・`default`・`examples` などを再帰的に除く。`type` の配列と `anyOf` / `oneOf` は先頭の候補に単純化する。引数のないツールは `parameters` を省き、`properties` を持たない object(`propose_create` の `fields`)は JSON 文字列を受ける string にして、返ってきた引数を実行前に `restoreGeminiArgs` でオブジェクトに戻す。
- SSE の各 `data:` の `candidates[0].content.parts` を順に処理する。`text` は差分として流し(`thought: true` は表示しない)、`functionCall` はオブジェクト引数のままツール呼び出しにする。`finishReason`(`MAX_TOKENS`・`SAFETY`・`MALFORMED_FUNCTION_CALL` など)と `promptFeedback.blockReason` は日本語のエラーにする。
- 応答の `parts` は `thoughtSignature` などの未知の項目も含めて、受け取ったまま `role: 'model'` として履歴に残す。ツールの結果は `role: 'user'` の `parts: [{functionResponse: {name, response: {result: "<text>"}}}]`(複数のツールは 1 メッセージの複数 parts)で返す。API が `functionCall.id` を返したときは、同じ `id` を `functionResponse` にも付ける。
- モデル一覧は `GET {baseUrl}/v1beta/models?pageSize=100`(`nextPageToken` があれば続きを取る)のうち、`supportedGenerationMethods` に `generateContent` を含むものだけ(`models/` 接頭辞は除く)。
- エラー: 400 は `INVALID_ARGUMENT`、ただし `API_KEY_INVALID` は認証として扱う。403 は認証、404 はモデル、429 は `RESOURCE_EXHAUSTED`(利用上限)、5xx は障害。

### 通信の制限

HTTP 通信は `tauri-plugin-http`(Rust 側から送るので CORS の影響を受けない)。`src-tauri/capabilities/default.json` の `http:default` のスコープで、送れる先を `https://**` と `http://localhost:*/**`・`http://127.0.0.1:*/**`・`http://[::1]:*/**` に限る。TS 側(`http/url.ts`)でも、https か localhost 系の http 以外の Base URL を拒否する。リダイレクトは追わない(キーを別のホストへ送らないため)。

### API キーの保管

- macOS / Windows: Rust の `secret_set` / `secret_get` / `secret_delete`(`keyring` crate)で OS のキーチェーンに保存する。項目名は「プロバイダ ID:識別子」(OpenAI 互換ではプリセット ID、Anthropic と Gemini では `api-key`)。
- Linux など: キーチェーンの依存(libdbus 等)を避けるため使わず、Rust は `"unsupported"` を返す。TS 側は localStorage(`storift:ai-secret:…`)に**平文で**保存し、設定画面にその旨を表示する。
- キーは常に「そのプロバイダの識別子」で取り出し、そのプロバイダの Base URL にだけ送る(プロバイダを切り替えても、他のプロバイダのキーは送られない)。ログに出さない。エクスポート・バックアップ・Firestore 同期の対象にしない(これらは IndexedDB のデータだけを扱う)。設定画面では伏せ字で入力し、表示の切り替えと削除ができる。保存済みのキーは画面に読み戻さない。

## Ollama(ローカル LLM)

設定の「AI」で Ollama を選ぶと、Claude Code の代わりにローカルの Ollama で動く。`src-tauri/src/ollama.rs` が `/api/chat`(ツール定義つき)を呼び、返ってきたツール呼び出しを MCP と同じ経路でフロントへ中継して、結果を渡して続きを書かせる。出力は Claude Code と同じ `stream-json` の形に直して流すので、画面側は共通。

- 接続は `http://` のみ(既定 `http://localhost:11434`)。ツール呼び出しに対応したモデルが必要。
- 会話の履歴はメモリ上で持つ(アプリを再起動すると新しい会話になる)。Web 検索は使えない。
- 文脈の長さは `num_ctx` 16384 を指定している。

## AI パネル

ヘッダーの「AI」ボタンか `Ctrl(Cmd)+Shift+L` で開閉する。ヘッダーの高さは、執筆のツールバーと共通の CSS 変数 `--editor-header-height`(`src/app.css`)で揃えている。入力欄の下(編集モードの隣)に、使っているプロバイダとモデル(例: `Anthropic API・claude-sonnet-5-5`。モデル未選択なら名前だけ)を小さく出す(`describeActiveModel`)。以下は Claude Code を選んだときの仕組みを中心に書く(本文の編集・エディタ上の差分表示は、どのプロバイダでも共通)。

### Claude Code の仕組み

1. 送信のたびに `claude -p --output-format stream-json` を起動し、プロンプトを標準入力で渡す。作業ディレクトリは空のフォルダで、原稿の写しは置かない。
2. Claude Code は作品や本文を読むために、アプリの MCP サーバー(サーバー名 `storift`、127.0.0.1 の Streamable HTTP)のツールを呼ぶ。Claude Code には起動のたびにトークン入りの一時的な設定ファイル(0600)を渡し、実行が終わると消す。
3. Rust 側は呼び出しを Tauri のイベント `mcp://request` でフロントへ渡し、フロントが IndexedDB を読んで `mcp_respond` で返す(`src/lib/desktop/mcp.ts`)。データの正本は IndexedDB なので、未保存の本文も今の内容で返せる。応答が 30 秒ないとタイムアウトする。
4. 出力を 1 行ずつパネルへ流し、逐次表示する。会話は Claude Code のセッション ID(`--resume`)で続く。

ツール(`mcp__storift__<名前>`):

- 読み取り: `list_projects` / `get_outline` / `list_items` / `get_scene` / `get_item` / `search` / `get_history`
- 書き込み: `propose_edit` / `propose_create` / `propose_delete`(提案のみの設定では出さない。後述)

一覧は id・題名・補足だけを返し、本文は含めない。本文は `get_scene` で `offset` と `limit` を指定して必要な分だけ読む。`projectId` を省略すると開いている作品を使う。

### 会話の単位

会話(Claude Code のセッション)は作品ごとに分かれる。作品を開いていないとき(ホームなど)は「全体」の会話になる。パネルのタイトル横に今の会話の範囲が出る。

### 文脈と引用

- 開いている作品・シーンの ID が、毎回 `<storift_context>` としてプロンプトの先頭に付く。本文は付かない。
- 開いているシーンの本文は、エディタの未保存の編集も含めて `get_scene` などが返す。
- エディタで文章を選ぶと「AI に聞く / 校正 / 書き換え」のポップアップが出る。「AI に聞く」は選んだ部分を引用として入力欄に付け、質問をその部分に絞る。「校正」「書き換え」はそのまま送る。引用は `<quote sceneId="…">` として付く。
- 「校正」「矛盾チェック」などのボタンは、引用があればそれを、なければ開いているシーンを対象にする。

### 本文の編集

設定の「AI」→「本文の編集」で 3 段階を選ぶ(プロバイダ共通)。

| 設定                   | 動き                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 提案のみ(既定)         | 修正案を文章で示すだけ                                                                                                                             |
| 差分を確認して反映     | 編集案を文字単位の差分で表示し、1 件ずつ「反映」「却下」するか、回答ごとに「すべて反映」「すべて却下」する                                         |
| 自動で反映(後から確認) | 編集案が届いた時点で自動で書き換える。変更は 1 行(シーン名・追加/削除の文字数)に畳まれ、開くと差分が見える。1 件ずつ・まとめて「元に戻す」ができる |

### エディタ上の差分表示

開いているシーンに対する AI の変更は、エディタ上に色付きで表示する(実装は `src/lib/components/desktop/EditorDiff.svelte`)。

- 反映済みで未確認の変更: 追加した文字を緑、消えた文字があった位置に赤い印。
- 未反映の提案(差分を確認して反映): 消える文字を赤の取り消し線、入る位置に緑の印。
- 変更にマウスを乗せると差分のカードが出て、反映済みなら「保持 / 元に戻す」、提案なら「反映 / 却下」を選べる。
- エディタ下部のバーで、変更の件数・前後の変更への移動(↑↓)・「すべて保持 / すべて元に戻す / すべて反映 / すべて却下」。
- 「保持」した変更は色付けが消える(本文はそのまま)。パネルの編集カードにも「保持」がある。

本文の DOM は書き換えず、CSS Custom Highlight API で色を付ける(非対応の環境では半透明の枠を重ねる)ので、入力や自動保存には影響しない。

反映した変更は、どのモードでも次の方法で後から確認できる。

- 編集カードの見出しを押すと、差分の開閉ができる(判断が要るもの=未反映・反映できないものは最初から開いている)。
- 回答の下に「変更 N 件(反映済み x・未反映 y)」のまとめが出る。
- 開いているシーンの変更は「本文で表示」で、エディタ上の該当箇所を選択して見せる。
- 元に戻すときは、反映した位置と直前の文を覚えておき、同じ場所を戻す(削除だけの編集も戻せる)。

仕組み: 編集を許可しているときは、AI に MCP ツール `propose_edit`(`kind`・`id`・`old`・`new`)で編集案を出すよう指示する(`src/lib/desktop/edits.ts` の `EDIT_INSTRUCTIONS`)。アプリは呼び出しを受けると、対象があるか・編集できる種類か・`old` が本文中にちょうど 1 回現れるか・編集できない部分(見出しや箇条書きの情報)が変わらないかを先に確かめる。通ったものだけを回答の編集案として記録し、「差分を確認して反映」なら承認待ちに、「自動で反映」ならその場で書き換える。失敗したときは理由を AI に返すので、直して出し直せる。開いているシーンはエディタ経由で書き換えるので通常どおり自動保存され、それ以外は DB を直接更新して同期キューに積む。どちらも既存の変更履歴に残る。過去の回答に書かれた `<storift-edit>` は、履歴の表示にだけ使う。

Claude Code 自体にはファイルの書き換え(`Edit` / `Write`)も `Bash` も許可していない。本文と項目を書き換えるのは常にアプリ側で、対象は本文のシーンと下の表の項目(履歴を除く)。

### 本文以外の編集

本文のシーンに加えて、次の項目も `propose_edit` で編集できる。項目は `kind`(`characters` など)と `id` で指定する。`get_item` は項目ごとのファイルと同じ Markdown を返すので、AI は見出しや節の名前を確かめてから `old` を書ける。

| ファイル                   | 編集できるフィールド(`## 見出し`の節)          | 編集できない部分                 | 保存先 / 同期                        |
| -------------------------- | ---------------------------------------------- | -------------------------------- | ------------------------------------ |
| `キャラクター/<名前>.md`   | 役割・外見・性格・背景・関係                   | 名前・年齢・性別                 | `charactersDB.update` / 同期する     |
| `設定資料/<タイトル>.md`   | タグ・内容                                     | タイトル・分類                   | `worldbuildingDB.update` / 同期する  |
| `プロット/<タイトル>.md`   | 状態(日本語ラベル)・内容                       | タイトル・種類                   | `plotsDB.update` / 同期する          |
| `本文/<章>/00_章の概要.md` | 概要                                           | 章の名前                         | `chaptersDB.update` / 同期する       |
| `メモ/<先頭行>.md`         | 本文・タグ                                     | 完了状態・関連シーン・本文の引用 | `memosDB.update` / 同期しない        |
| `進捗/<日付>.md`           | 日付・文字数・時間(分)                         | 書いたシーン                     | `progressLogsDB.update` / 同期しない |
| `相関図/相関図の配置.md`   | ノード座標・線の見た目・グループの座標と大きさ | 行の増減・名前・id・グループの色 | `relationMapsDB.save` / 同期しない   |
| `履歴/…`                   | なし(読み取り専用)                             | すべて(改変・削除不可)           | -                                    |

- 解析と書き戻しは `src/lib/desktop/entities.ts`。置換後のファイルを読み直し、編集フィールド以外(見出し・箇条書きの情報など)が 1 文字でも変わっていれば反映しない。値が不正(状態のラベル、日付の形式、数値でない座標など)でも反映しない。
- 関係そのものの正は `Character.relationships` で、キャラクターのファイルの「関係」(`- 相手の名前 [相手の id]: 関係`)で追加・削除・名前の変更ができる。相手は同じ作品のキャラクターで、名前は id と一致している必要がある。関係の名前を変えると、相関図の線の見た目(色・形・矢印・ずれ)は新しい関係へ引き継ぐ。
- 相関図ファイルの「線の見た目」は、関係ごとに 1 行(`- 名前 → 名前「関係」 [元 id|先 id]: 色, 曲線, 矢印, ずれ x, ずれ y`)。色は `#RRGGBB`、曲線は 曲線・直線・折れ線・角丸、矢印は 片方向・双方向・お互い別。線の増減はできず(関係のほうで行う)、逆向きの関係がある線を「双方向」にすることもできない。アプリの設定(`AppSettings`)は対象外。
- 進捗の日付を、同じ作品の別の日の進捗と重ねる変更は反映しない。
- 履歴は `get_history` で、作品ごとに新しい順 50 件まで一覧できる。
- 元に戻す操作も同じ経路で、項目ファイルを組み直して置き戻す。

### 項目の新規追加と削除

`propose_create`(`kind`・`fields`・`projectId` 省略時は開いている作品)と `propose_delete`(`kind`・`id`)で、項目の追加と削除も提案できる。`propose_edit` と同じく、検証を通ったものだけを回答の編集案(`EditState`、`action` が `create` / `delete`)として記録し、確認モードは承認待ち、自動モードはその場で実行する。カードには「新規: キャラクター 太郎」「削除: …」と出て、差分は項目ファイル全体の追加/削除として見える。

| 操作 | 対象の種類                                                           | 範囲外                         |
| ---- | -------------------------------------------------------------------- | ------------------------------ |
| 追加 | characters / plots / worldbuilding / memos / progressLogs / chapters | シーンの新規作成・履歴・相関図 |
| 削除 | characters / plots / worldbuilding / memos / progressLogs            | シーンと章の削除・履歴・相関図 |

- `fields` は項目ファイルの「## 見出し」と同じ項目名(`editableFields`)で、値の検証も編集と同じ。加えて、追加のときだけ次の項目が必須: キャラクターは「名前」、プロットは「タイトル」「種類」、設定資料は「タイトル」「分類」、章は「タイトル」。メモは「本文」、進捗は「日付」が必須。不正な値・未知の項目名・同じ日付の進捗の重複は、理由を `isError` で返す。
- 追加は `charactersDB.create` などの既存 API で行い、残りのフィールドを `update` で反映する。同期対象(chapters / characters / plots / worldbuilding)は同期キューに `create` / `delete` を積み、開いている作品の章の一覧も更新する。
- 追加を元に戻すと削除になる(章にシーンが追加されていたら戻せない)。削除を元に戻すと、`EditState.snapshot` に残した削除前のレコードを同じ ID で復元する。追加を一度取り消したあとの再反映も、同じ ID で復元する。
- キャラクターを削除すると、既存の削除 API は参照を掃除しないため、アプリ側で他のキャラクターの関係と、相関図の配置・線の見た目から、そのキャラクターへの参照を取り除く。取り除いたものは `EditState.touched` に元の状態を残し、元に戻すときに戻す。プロット・メモ・進捗にキャラクターへの参照はない。

### 反映の挙動

- 「すべて反映」「すべて元に戻す」「すべて却下」は、1 件が例外になっても残りを続ける。反映の失敗は `failed` と理由が編集案に残る。実行中は二重に実行できず、パネルのボタンも押せない(`aiStore.busy`)。
- 提案時の検証と反映・取り消しは、対象 1 件だけを DB から読む(`src/lib/desktop/workspace.ts` の `loadEntity` など)。「すべて反映」は同じ対象への編集をまとめて 1 回の読み書きにし、同期キューへの登録も最後に 1 回だけ行う。
- 同じ対象にまだ反映していない編集案があるときは、提案時にそれらを反映した状態に対して `old` を確かめる(先行の提案で消える文は指定できず、先行の提案が入れる文には依存できる)。依存する編集を先に反映しようとすると失敗し、反映済みの別の編集と重なって失敗した場合はその旨を理由に添える。

### トークンについて

- AI が読むのは MCP の読み取りツールで必要になった分だけ。一覧は id と題名だけで、本文は `get_scene` で区切って読む。
- 1 回の送信ごとに `claude -p --resume` を起動する。Claude Code のシステムプロンプトとツール定義は毎回送られるが、プロンプトキャッシュに乗るため、2 回目以降はほとんどがキャッシュ読み込みとして計上される。
- ユーザー設定の MCP サーバー・スキルは読み込まず(`--strict-mcp-config` と `--disable-slash-commands`)、使えるツールはアプリの storift のツールと、許可したときの Web 検索だけに絞る。手元の計測では、MCP やプラグインを多く入れた環境で 1 回の API 呼び出しあたりの固定分が約 45k トークンから約 6〜9k トークンに減った。
- 会話を作品ごとに分けているので、別の作品の履歴を読み直すことがない。長くなったら「新規」で会話を切り替える。

### 必要なもの

Claude Code を使う場合は、Claude Code がインストール済みで、ログインしていること(他のプロバイダに必要なものは上の表を参照)。

```sh
# macOS / Linux
curl -fsSL https://claude.ai/install.sh | bash
# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex
```

インストール後、ターミナルで `claude auth login`(または `claude` を起動して `/login`)でログインする。ログイン情報はディレクトリごとではなくユーザー単位(`~/.claude`、macOS はキーチェーン)で共有されるので、どのフォルダで行ってもアプリから使える。

ログインしていない・ログインが切れている(`OAuth session expired` など)ときは、パネルに案内と「ログインする(ターミナルを開く)」ボタンが出る。押すと OS のターミナル(macOS: ターミナル.app、Windows: コマンドプロンプト、Linux: 入っている端末)で `claude auth login` が開く。ログイン後にもう一度送信すればよい。デスクトップから起動したアプリはシェルの PATH を持たないため、起動時にログインシェルから環境変数を読み込み、さらに `~/.local/bin` などのよくある場所を探す。見つからない場合は設定の「AI」で実行ファイルの場所を指定できる。

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

### 自動アップデート

デスクトップ版は `tauri-plugin-updater` で更新できる。

- 起動の少し後と 6 時間ごとに、GitHub Releases の最新リリースにある `latest.json` を確認する(設定の「バージョン情報」で自動確認をオフにできる)。手動でも「更新を確認」で確認できる。
- 新しい版があると通知が出る。「更新」を押すとダウンロードして入れる。自動では入れない。macOS / Linux は入れ終わったあと「再起動」で切り替わり、Windows は自動で再起動する。
- 更新用ファイルには署名が付き、アプリに埋め込んだ公開鍵(`src-tauri/tauri.conf.json` の `plugins.updater.pubkey`)で検証する。
- 下書きのリリースは配信されない。**リリースを公開(Publish)した時点で**、利用者に更新が届く。

#### 初回の準備(1 度だけ)

署名用の鍵を作る。**秘密鍵は公開しない・なくさない**(なくすと、既存の利用者へ更新を配れなくなる)。

```bash
bun run tauri signer generate -w ~/.tauri/storift-updater.key
```

- 公開鍵(`.key.pub` の中身)を `tauri.conf.json` の `plugins.updater.pubkey` に入れる。
- 秘密鍵の中身を GitHub の Secrets に `TAURI_SIGNING_PRIVATE_KEY` として登録する。パスワードを付けた場合は `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` も登録する。

#### リリースの手順

1. `package.json` の `version` を上げ、`main` に入れる。
2. あとは自動。`release.yml` が `v<version>` のタグを作り、`desktop.yml` が 3 OS 分をビルドして署名付きのリリースと `latest.json` を作る。3 つとも通ると、リリースを自動で公開し、利用者へ更新が配られる。

- すでにあるバージョンは何もしない(`package.json` を別の理由で変えても、タグは増えない)。
- 手動でやり直すときは、Actions の「Release」を手動実行する。手でタグを打って push しても、同じビルドが動く。
- 公開したくないときは、`desktop.yml` の `publish` ジョブを外し、下書きを確かめてから手で Publish する。

更新用ファイルは `src-tauri/tauri.release.conf.json`(`createUpdaterArtifacts`)をタグのビルドでだけ重ねて作る。鍵のない PR や通常のビルドでは作らないので、そのまま通る。

### 署名について

Apple Developer ID による署名・公証はしていない。macOS 版はアドホック署名(`bundle.macOS.signingIdentity: "-"`)だけをしている。署名がまったく無いと、ブラウザでダウンロードした `.app` は Apple Silicon で「壊れているため開けません」と表示され、通常の手順では開けない。

- macOS: 初回は Finder で右クリック →「開く」、または「システム設定」→「プライバシーとセキュリティ」→「このまま開く」で起動する。それでも「壊れている」と出る場合は `xattr -dr com.apple.quarantine /Applications/Storift.app` を実行する。
- Windows: SmartScreen の警告が出たら「詳細情報」→「実行」。

署名する場合は Apple Developer ID / Windows のコード署名証明書を用意し、Tauri の署名用の環境変数(`APPLE_CERTIFICATE` など)をリポジトリの Secrets に登録してワークフローに渡す。

## 既知の制限

- MCP 方式より前に始めた会話は、開き直すと Claude Code 側の続きを引き継がない。表示される過去の回答はそのまま残り、次の送信から新しいセッションで始まる。
- データ(IndexedDB)は Web 版とは別に、アプリ内に保存される。端末間・Web 版との共有は既存の Firebase 同期を使う。デスクトップ版のオリジン(`tauri://localhost` / `http://tauri.localhost`)で Firebase 認証が通らない場合は、Firebase コンソールの承認済みドメインに `tauri.localhost` を追加する。
- Claude Code の利用料金・使用量は、ログインしている Claude のアカウントに計上される。OpenAI 互換 API・Anthropic API・Gemini の料金は、設定した API キーのアカウントに計上される。
