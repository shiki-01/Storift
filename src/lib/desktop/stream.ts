/**
 * Claude Code の `--output-format stream-json` の出力を、表示用の状態へ畳み込む。
 *
 * 1 回の送信(ターン)の中で、Claude はツールを使いながら複数の API メッセージを返す。
 * `--include-partial-messages` の差分(stream_event)で逐次表示し、
 * 完成したメッセージ(assistant)が届いたらその内容で置き換える。
 */

export type TurnPart =
	| { kind: 'text'; text: string }
	| { kind: 'tool'; name: string; summary: string };

export interface TurnState {
	/** API メッセージ ID の出現順 */
	order: string[];
	/** メッセージ ID ごとの内容(content block の index 順) */
	blocks: Record<string, TurnPart[]>;
	/** 差分を受け取っている途中のメッセージ */
	streamingId?: string;
	sessionId?: string;
	model?: string;
	done: boolean;
	isError: boolean;
	costUsd?: number;
	durationMs?: number;
	/** result イベントの最終テキスト(本文が空だったときの補い) */
	resultText?: string;
}

export function createTurnState(): TurnState {
	return { order: [], blocks: {}, done: false, isError: false };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- CLI の出力は外部の JSON で、型は実行時に確かめる */

function shortPath(path: string): string {
	// ワークスペースの絶対パスは長いので、末尾の 2 階層だけ見せる
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.slice(-2).join('/');
}

/** ツール呼び出しを 1 行で表す */
export function summarizeTool(name: string, input: any): string {
	if (!input || typeof input !== 'object') return '';
	switch (name) {
		case 'Read':
			return shortPath(String(input.file_path ?? ''));
		case 'Grep':
			return `"${input.pattern ?? ''}"${input.path ? ` in ${shortPath(String(input.path))}` : ''}`;
		case 'Glob':
			return String(input.pattern ?? '');
		case 'LS':
			return shortPath(String(input.path ?? ''));
		case 'WebSearch':
			return String(input.query ?? '');
		case 'WebFetch':
			return String(input.url ?? '');
		default:
			return '';
	}
}

function toPart(block: any): TurnPart | null {
	if (block?.type === 'text') return { kind: 'text', text: String(block.text ?? '') };
	if (block?.type === 'tool_use') {
		return {
			kind: 'tool',
			name: String(block.name),
			summary: summarizeTool(block.name, block.input)
		};
	}
	// thinking などは表示しない
	return null;
}

function ensureMessage(state: TurnState, id: string) {
	if (!state.blocks[id]) {
		state.blocks[id] = [];
		state.order.push(id);
	}
}

function applyStreamEvent(state: TurnState, event: any) {
	switch (event?.type) {
		case 'message_start': {
			const id = event.message?.id;
			if (!id) return;
			state.streamingId = id;
			ensureMessage(state, id);
			return;
		}
		case 'content_block_start': {
			const id = state.streamingId;
			const part = toPart(event.content_block);
			if (!id || !part || typeof event.index !== 'number') return;
			state.blocks[id][event.index] = part;
			return;
		}
		case 'content_block_delta': {
			const id = state.streamingId;
			if (!id || event.delta?.type !== 'text_delta') return;
			const part = state.blocks[id]?.[event.index];
			if (part?.kind === 'text') part.text += String(event.delta.text ?? '');
			return;
		}
	}
}

/** 出力 1 行(JSON)を状態へ反映する。JSON でない行は無視する */
export function applyStreamLine(state: TurnState, line: string): void {
	let event: any;
	try {
		event = JSON.parse(line);
	} catch {
		return;
	}

	switch (event?.type) {
		case 'system':
			if (event.subtype === 'init') {
				state.sessionId = event.session_id ?? state.sessionId;
				state.model = event.model ?? state.model;
			}
			return;
		case 'stream_event':
			applyStreamEvent(state, event.event);
			return;
		case 'assistant': {
			const message = event.message;
			const id = message?.id;
			if (!id || !Array.isArray(message.content)) return;
			ensureMessage(state, id);
			state.blocks[id] = message.content.map(toPart).filter(Boolean) as TurnPart[];
			return;
		}
		case 'result':
			state.done = true;
			state.sessionId = event.session_id ?? state.sessionId;
			state.isError = !!event.is_error || (event.subtype && event.subtype !== 'success');
			state.costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined;
			state.durationMs = typeof event.duration_ms === 'number' ? event.duration_ms : undefined;
			state.resultText = typeof event.result === 'string' ? event.result : undefined;
			return;
	}
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** 表示する部品を順に並べる。連続するテキストはひとつにまとめる */
export function turnParts(state: TurnState): TurnPart[] {
	const parts: TurnPart[] = [];
	for (const id of state.order) {
		for (const part of state.blocks[id] ?? []) {
			if (!part) continue;
			const last = parts[parts.length - 1];
			if (part.kind === 'text' && last?.kind === 'text') {
				last.text += (last.text && part.text ? '\n\n' : '') + part.text;
			} else {
				parts.push({ ...part });
			}
		}
	}
	const hasText = parts.some((p) => p.kind === 'text' && p.text.trim());
	// エラーのときの result はエラー文なので、本文としては出さない(エラー表示に回す)
	if (!hasText && !state.isError && state.resultText?.trim()) {
		parts.push({ kind: 'text', text: state.resultText });
	}
	return parts;
}

/** Claude Code の認証(ログイン)のエラーか */
export function isAuthError(text: string): boolean {
	return /authenticat|oauth|not logged in|\/login|auth login|invalid api key|unauthorized|credential/i.test(
		text
	);
}
