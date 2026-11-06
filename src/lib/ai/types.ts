/**
 * AI 連携のプロバイダ(Claude Code・Ollama・OpenAI 互換 API など)の共通の型。
 *
 * 画面(ストア・パネル)は、プロバイダの違いを意識せず `AiProvider.run` を呼ぶ。
 * 出力は Claude Code の `stream-json` と同じ形の行(JSON 文字列)で `emit` へ流し、
 * 画面側は desktop/stream.ts の `applyStreamLine` で畳み込む。
 */
import type { ExitEvent } from '$lib/desktop/ai';

/** suggest: 提案のみ / confirm: 差分を見て反映 / auto: 自動で反映し、後から確認・元に戻す */
export type EditMode = 'suggest' | 'confirm' | 'auto';

/** 組み込みのプロバイダの ID。後続で追加するプロバイダは文字列で増える */
export type AiProviderId =
	| 'claude-code'
	| 'ollama'
	| 'openai-compatible'
	| 'anthropic'
	| 'gemini'
	| (string & {});

export interface ClaudeCodeSettings {
	/** 空なら Claude Code の既定 */
	model: string;
	/** 空なら自動で探す */
	claudePath: string;
	/** WebSearch / WebFetch を許可する */
	allowWeb: boolean;
}

export interface OllamaSettings {
	/** 接続先(空なら既定) */
	url: string;
	model: string;
}

export interface OpenAiCompatibleSettings {
	baseUrl: string;
	model: string;
	/** 選んだプリセット(API キーの保管先の識別子にもなる) */
	presetId: string;
}

export interface AnthropicSettings {
	baseUrl: string;
	model: string;
	/** 1 回の応答の最大トークン数(Anthropic API では必須) */
	maxTokens: number;
}

export interface GeminiSettings {
	baseUrl: string;
	model: string;
	/** 1 回の応答の最大トークン数。未設定ならリクエストに含めない */
	maxOutputTokens?: number;
}

/** AI 連携の設定。API キーは含めない(OS のキーチェーンに別に保管する) */
export interface AiSettings {
	provider: AiProviderId;
	/** 本文の編集の扱い(プロバイダ共通) */
	editMode: EditMode;
	claudeCode: ClaudeCodeSettings;
	ollama: OllamaSettings;
	openaiCompatible: OpenAiCompatibleSettings;
	anthropic: AnthropicSettings;
	gemini: GeminiSettings;
}

/** プロバイダ別の設定の入れ物(AiSettings のうち、オブジェクトのキー) */
export type ProviderSettingsKey =
	| 'claudeCode'
	| 'ollama'
	| 'openaiCompatible'
	| 'anthropic'
	| 'gemini';

/** 設定画面に出す項目の定義(単純な入力欄は、これで描画できる) */
export interface SettingField {
	key: string;
	label: string;
	type: 'text' | 'url' | 'checkbox';
	placeholder?: string;
	hint?: string;
}

export interface AiCapabilities {
	/** モデル側の Web 検索・取得が使える */
	webSearch: boolean;
	/** 会話の続き(セッションの継続)を扱える */
	resume: boolean;
	/** アプリのツール(原稿の読み取り・編集提案)を使える */
	tools: boolean;
}

/** 接続・準備の状態(パネルと設定画面が表示に使う) */
export interface AiStatus {
	/** 使える状態か(見つかった・接続できた・設定がそろっている) */
	found: boolean;
	path?: string;
	version?: string;
	error?: string;
	/** Claude Code のログイン状態(確かめられなければ undefined) */
	loggedIn?: boolean;
	/** 選べるモデル(分かるときだけ) */
	models?: string[];
}

/** 1 回の送信の入力 */
export interface AiRunRequest {
	/** 実行の ID。ツール呼び出しはこれで回答(assistant メッセージ)を特定する */
	runId: string;
	prompt: string;
	/** 続きの会話にするときのセッション ID(そのプロバイダが発行したもの) */
	sessionId?: string;
	editMode: EditMode;
	appendSystemPrompt?: string;
	settings: AiSettings;
}

/** 実行の結果。画面は code が 0 以外や cancelled のときにエラー表示へ回す */
export type AiRunResult = ExitEvent;

export interface ConnectionTestResult {
	ok: boolean;
	/** 画面に出す日本語の説明 */
	message: string;
	models?: string[];
}

export interface AiProvider {
	id: AiProviderId;
	/** 画面に出す名前 */
	label: string;
	description: string;
	/** 使うために必要なもの */
	requires: string;
	/** 質問と原稿の一部が送られる先 */
	destination: string;
	/** 設定によって送信先が変わるとき(Base URL の変更など)の、今の送信先。無ければ destination */
	currentDestination?(settings: AiSettings): string;
	/** AiSettings の中の、このプロバイダの設定の置き場 */
	settingsKey: ProviderSettingsKey;
	/** 設定画面の単純な入力欄の定義 */
	settingsSchema: SettingField[];
	capabilities: AiCapabilities;
	/** このプロバイダが発行するセッション ID の接頭辞(無ければ接頭辞なしの ID を発行する) */
	sessionPrefix?: string;
	/**
	 * 質問を送り、出力を 1 行ずつ emit へ流す。signal が中断されたら実行を止める。
	 * 失敗は例外ではなく、code が 0 以外の結果で返す。
	 */
	run(
		request: AiRunRequest,
		emit: (line: string) => void,
		signal: AbortSignal
	): Promise<AiRunResult>;
	/** 準備の状態を確かめる(外部への通信は最小限にする) */
	status(settings: AiSettings): Promise<AiStatus>;
	/** 選べるモデルの一覧 */
	listModels?(settings: AiSettings): Promise<string[]>;
	/** 設定画面の「接続テスト」 */
	testConnection?(settings: AiSettings): Promise<ConnectionTestResult>;
}
