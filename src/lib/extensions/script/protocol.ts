/**
 * ホスト(アプリ)とスクリプト(ワーカー)の間の、postMessage 上の薄いプロトコル。
 *
 * - ワーカー → ホスト: リクエスト `{ t: 'req', id, m, a }`
 * - ホスト → ワーカー: 応答 `{ t: 'res', id, ok, ... }`、イベント `{ t: 'ev', n, p }`、画面の操作 `{ t: 'ui', id, kind, v }`
 * ワーカーは信用しない。受け取ったものは、必ずここで形と大きさを確かめてから使う
 * (構造化クローンで届く値のうち、JSON で表せるものだけを受け付ける)。
 */
import type { ExtensionEventName, ExtensionEventMap, WritingSessionEvent } from '../events';
import { SCRIPT_LIMITS } from './limits';

export const REQUEST_METHODS = [
	'events.on',
	'events.off',
	'storage.get',
	'storage.set',
	'storage.delete',
	'storage.list',
	'ui.set',
	'notify'
] as const;
export type RequestMethod = (typeof REQUEST_METHODS)[number];

export type ErrorCode = 'permission' | 'invalid' | 'limit' | 'quota' | 'rate' | 'internal';

export interface RequestMessage {
	t: 'req';
	id: number;
	m: RequestMethod;
	a: unknown;
}

export type ResponseMessage =
	| { t: 'res'; id: number; ok: true; v: unknown }
	| { t: 'res'; id: number; ok: false; code: ErrorCode; msg: string };

export interface EventMessage {
	t: 'ev';
	n: ExtensionEventName;
	p: unknown;
}

export interface UiEventMessage {
	t: 'ui';
	id: string;
	kind: 'press' | 'change';
	v?: string | boolean;
}

export type HostMessage = ResponseMessage | EventMessage | UiEventMessage;

export type MeasureFailure = 'type' | 'size' | 'depth' | 'nodes';
export type Measured = { ok: true; bytes: number } | { ok: false; reason: MeasureFailure };

interface MeasureLimits {
	maxBytes: number;
	maxDepth: number;
	maxNodes: number;
}

const DEFAULT_LIMITS: MeasureLimits = {
	maxBytes: SCRIPT_LIMITS.messageBytes,
	maxDepth: SCRIPT_LIMITS.messageDepth,
	maxNodes: SCRIPT_LIMITS.messageNodes
};

/**
 * 値が JSON で表せるもの(文字列・有限の数・真偽値・null・プレーンな配列/オブジェクト)だけでできているかを確かめ、
 * 大きさ(概算のバイト数)・深さ・個数の上限を超えたらそこで打ち切る。Map・Date・バイナリ・関数などは受け付けない
 */
export function measureJson(value: unknown, limits: Partial<MeasureLimits> = {}): Measured {
	const { maxBytes, maxDepth, maxNodes } = { ...DEFAULT_LIMITS, ...limits };
	let bytes = 0;
	let nodes = 0;
	const stack: { v: unknown; depth: number }[] = [{ v: value, depth: 0 }];
	while (stack.length > 0) {
		const { v, depth } = stack.pop()!;
		if (++nodes > maxNodes) return { ok: false, reason: 'nodes' };
		if (v === null || typeof v === 'boolean') {
			bytes += 4;
		} else if (typeof v === 'number') {
			if (!Number.isFinite(v)) return { ok: false, reason: 'type' };
			bytes += 8;
		} else if (typeof v === 'string') {
			bytes += v.length;
		} else if (Array.isArray(v)) {
			if (depth + 1 > maxDepth) return { ok: false, reason: 'depth' };
			if (v.length > maxNodes) return { ok: false, reason: 'nodes' };
			bytes += 2 + v.length;
			for (let i = 0; i < v.length; i++) stack.push({ v: v[i], depth: depth + 1 });
		} else if (typeof v === 'object' && v !== undefined) {
			const proto = Object.getPrototypeOf(v);
			if (proto !== Object.prototype && proto !== null) return { ok: false, reason: 'type' };
			if (depth + 1 > maxDepth) return { ok: false, reason: 'depth' };
			const keys = Object.keys(v);
			if (keys.length > maxNodes) return { ok: false, reason: 'nodes' };
			bytes += 2;
			for (const key of keys) {
				bytes += key.length + 3;
				stack.push({ v: (v as Record<string, unknown>)[key], depth: depth + 1 });
			}
		} else if (v !== undefined) {
			// 関数・シンボル・bigint など。undefined は(オブジェクトの値として)無いものとして扱う
			return { ok: false, reason: 'type' };
		}
		if (bytes > maxBytes) return { ok: false, reason: 'size' };
	}
	return { ok: true, bytes };
}

export type ParsedRequest =
	| { ok: true; request: RequestMessage }
	| { ok: false; reason: 'protocol' | 'oversize' };

/** ワーカーから届いたメッセージを、リクエストとして検証する */
export function parseRequest(data: unknown): ParsedRequest {
	const measured = measureJson(data);
	if (!measured.ok) {
		return { ok: false, reason: measured.reason === 'type' ? 'protocol' : 'oversize' };
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		return { ok: false, reason: 'protocol' };
	}
	const msg = data as Record<string, unknown>;
	if (
		msg.t !== 'req' ||
		typeof msg.id !== 'number' ||
		!Number.isSafeInteger(msg.id) ||
		msg.id < 1 ||
		typeof msg.m !== 'string' ||
		!(REQUEST_METHODS as readonly string[]).includes(msg.m)
	) {
		return { ok: false, reason: 'protocol' };
	}
	return { ok: true, request: { t: 'req', id: msg.id, m: msg.m as RequestMethod, a: msg.a } };
}

/**
 * イベントのペイロードを、スクリプトに渡してよい項目だけにする。
 * - 本文は、もともと含まれない
 * - 作品名(projectTitle)は、`canTitle`(権限 project:title)があるときだけ
 * - 内部の ID(シーン・章・作品・セッション)は渡さない
 * 権限の無い項目は、キーごと無い(undefined でもなく、存在しない)
 */
export function narrowEventPayload<K extends ExtensionEventName>(
	name: K,
	payload: ExtensionEventMap[K],
	options: { canTitle: boolean }
): Record<string, unknown> {
	switch (name) {
		case 'session:start':
		case 'session:update':
		case 'session:end': {
			const e = payload as WritingSessionEvent;
			const out: Record<string, unknown> = {
				startedAt: e.startedAt,
				lastEditAt: e.lastEditAt,
				endedAt: e.endedAt,
				netChars: e.netChars
			};
			if (e.reason !== undefined) out.reason = e.reason;
			if (options.canTitle && typeof e.projectTitle === 'string') out.projectTitle = e.projectTitle;
			return out;
		}
		case 'page:change':
			return { page: (payload as ExtensionEventMap['page:change']).page };
		case 'app:visibility':
			return { visible: (payload as ExtensionEventMap['app:visibility']).visible };
		case 'scene:updated': {
			const e = payload as ExtensionEventMap['scene:updated'];
			return {
				characterCount: e.characterCount,
				previousCharacterCount: e.previousCharacterCount,
				delta: e.delta,
				origin: e.origin
			};
		}
		case 'scene:created':
			return {};
		default:
			return {};
	}
}
