/**
 * HTTP 系プロバイダ共通のエージェントのループ。
 *
 * モデルの応答をストリームで受け、ツール呼び出しがあれば実行して結果を履歴に足し、次のステップへ進む
 * (ツール呼び出しが無くなるか、最大ステップに達するまで)。モデルごとの違い(リクエストの形・
 * ストリームの読み方・履歴の形)は `AgentAdapter` が持ち、ここは共通の流れと、画面へ流す出力だけを扱う。
 *
 * 出力は Claude Code の stream-json と同じ形の行(system/init・stream_event・assistant・result)。
 * ツール名は画面の表示に合わせて `mcp__storift__<name>` にする。
 */
import type { ExitEvent } from '$lib/desktop/ai';
import { AiAbortError, AiHttpError, redact } from './errors';

/** 1 回の送信で回すツール呼び出しの往復の上限 */
export const MAX_STEPS = 12;
/** 保持する会話の数の上限 */
export const MAX_SESSIONS = 20;

/** 画面に出すツール名の接頭辞(Claude Code の MCP ツールと同じ表示になる) */
const TOOL_PREFIX = 'mcp__storift__';

export interface ToolSpec {
	name: string;
	description: string;
	/** JSON Schema(Rust の tool_definitions の inputSchema) */
	inputSchema: Record<string, unknown>;
}

export interface ToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
	/** 引数が JSON として読めなかったときの理由。実行せず、この内容をモデルに返す */
	invalidArgs?: string;
}

export interface StepResult {
	text: string;
	toolCalls: ToolCall[];
}

export interface ToolOutcome {
	call: ToolCall;
	text: string;
	isError: boolean;
}

/** モデルごとの違い。M はそのモデルの会話履歴の 1 件の型 */
export interface AgentAdapter<M> {
	/** 会話の最初のメッセージ列(システムプロンプトを含むなら含める) */
	start(system: string): M[];
	userMessage(text: string): M;
	assistantMessage(step: StepResult): M;
	toolMessages(outcomes: ToolOutcome[]): M[];
	/** 履歴を送ってストリームを読み、テキストの差分を onText に流して、完成した応答を返す */
	step(
		history: M[],
		tools: ToolSpec[],
		signal: AbortSignal,
		onText: (delta: string) => void
	): Promise<StepResult>;
}

/** 会話の履歴をメモリ上に持つ(アプリを再起動すると失われる) */
export class SessionStore<M> {
	private readonly sessions = new Map<string, M[]>();

	constructor(private readonly max = MAX_SESSIONS) {}

	get(id: string | undefined): M[] | undefined {
		if (!id) return undefined;
		const found = this.sessions.get(id);
		return found ? [...found] : undefined;
	}

	set(id: string, history: M[]): void {
		if (this.sessions.size >= this.max && !this.sessions.has(id)) {
			const oldest = this.sessions.keys().next().value;
			if (oldest !== undefined) this.sessions.delete(oldest);
		}
		// 入れ直して最近使った順にする
		this.sessions.delete(id);
		this.sessions.set(id, history);
	}

	get size(): number {
		return this.sessions.size;
	}
}

export interface AgentOptions<M> {
	runId: string;
	prompt: string;
	model: string;
	/** 続きの会話にするときのセッション ID */
	sessionId?: string;
	/** 新しいセッションの ID の接頭辞(例: openai-) */
	sessionPrefix: string;
	/** システムプロンプト(新しい会話の最初にだけ使う) */
	system: string;
	adapter: AgentAdapter<M>;
	sessions: SessionStore<M>;
	tools: ToolSpec[];
	callTool: (name: string, args: Record<string, unknown>, runId: string) => Promise<ToolResultLike>;
	/** 画面へ流す 1 行(JSON 文字列) */
	emit: (line: string) => void;
	signal: AbortSignal;
	maxSteps?: number;
	/** 伏せたい文字列(API キー)。エラー文に含めないために使う */
	secrets?: readonly (string | undefined)[];
	now?: () => number;
}

/** callTool の戻り値(ストアの ToolResult と同じ形) */
export interface ToolResultLike {
	text: string;
	isError: boolean;
}

/** 失敗の説明。利用者に見せる日本語 */
function describeError(error: unknown, secrets: readonly (string | undefined)[]): string {
	const text = error instanceof Error ? error.message : String(error);
	return redact(text, secrets);
}

/**
 * 会話を 1 回ぶん進める。失敗や中断は例外にせず、結果(ExitEvent)で返す。
 * 成功すると履歴を保存し、`result` の行を流す。
 */
export async function runAgent<M>(o: AgentOptions<M>): Promise<ExitEvent> {
	const now = o.now ?? Date.now;
	const started = now();
	const maxSteps = o.maxSteps ?? MAX_STEPS;
	const secrets = o.secrets ?? [];
	const out = (obj: unknown) => o.emit(JSON.stringify(obj));
	const streamEvent = (event: unknown) => out({ type: 'stream_event', event });
	const exit = (code: number | null, cancelled: boolean, stderr = '', authError = false) =>
		({
			requestId: o.runId,
			code,
			cancelled,
			stderr,
			...(authError ? { authError } : {})
		}) as ExitEvent;

	const existing = o.sessions.get(o.sessionId);
	const sessionId = existing ? (o.sessionId as string) : `${o.sessionPrefix}${o.runId}`;
	const history = existing ?? o.adapter.start(o.system);
	history.push(o.adapter.userMessage(o.prompt));

	out({ type: 'system', subtype: 'init', session_id: sessionId, model: o.model });

	try {
		let finalText = '';
		let finished = false;
		for (let step = 0; step < maxSteps; step++) {
			if (o.signal.aborted) throw new AiAbortError();
			const msgId = `msg_${o.runId}_${step}`;
			streamEvent({ type: 'message_start', message: { id: msgId } });
			streamEvent({
				type: 'content_block_start',
				index: 0,
				content_block: { type: 'text', text: '' }
			});

			const result = await o.adapter.step(history, o.tools, o.signal, (delta) => {
				if (!delta) return;
				streamEvent({
					type: 'content_block_delta',
					index: 0,
					delta: { type: 'text_delta', text: delta }
				});
			});

			// 完成したメッセージ(画面側はこれで逐次表示の内容を置き換える)
			const content: unknown[] = [];
			if (result.text) content.push({ type: 'text', text: result.text });
			result.toolCalls.forEach((call) =>
				content.push({
					type: 'tool_use',
					id: call.id,
					name: `${TOOL_PREFIX}${call.name}`,
					input: call.args
				})
			);
			out({ type: 'assistant', message: { id: msgId, content } });
			history.push(o.adapter.assistantMessage(result));

			if (!result.toolCalls.length) {
				finalText = result.text;
				finished = true;
				break;
			}

			const outcomes: ToolOutcome[] = [];
			for (const call of result.toolCalls) {
				if (o.signal.aborted) throw new AiAbortError();
				let text: string;
				let isError = true;
				if (call.invalidArgs) {
					text = `エラー: ${call.invalidArgs}`;
				} else {
					try {
						const res = await o.callTool(call.name, call.args, o.runId);
						isError = res.isError;
						text = res.isError ? `エラー: ${res.text}` : res.text;
					} catch (error) {
						text = `エラー: ${describeError(error, secrets)}`;
					}
				}
				outcomes.push({ call, text, isError });
			}
			history.push(...o.adapter.toolMessages(outcomes));
		}

		if (!finished)
			return exit(
				1,
				false,
				`ツールの呼び出しが ${maxSteps} 回に達したため、途中で打ち切りました。`
			);

		o.sessions.set(sessionId, history);
		out({
			type: 'result',
			subtype: 'success',
			is_error: false,
			session_id: sessionId,
			duration_ms: now() - started,
			result: finalText
		});
		return exit(0, false);
	} catch (error) {
		if (error instanceof AiAbortError || o.signal.aborted) return exit(null, true);
		const auth = error instanceof AiHttpError && error.kind === 'auth';
		return exit(1, false, describeError(error, secrets), auth);
	}
}
