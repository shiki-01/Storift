/**
 * スクリプト(ワーカー)からのリクエストを受けて、権限と上限を確かめたうえで処理するホスト側の窓口。
 * DOM には依存しない(iframe とのやり取りは sandbox.ts)。ワーカーは信用せず、すべての入力をここで検証する。
 *
 * - 権限: マニフェストで宣言したイベント・ストレージ・通知・画面だけ。足りなければ拒否(violation を数える)
 * - 上限: メッセージの数/秒・大きさ・未応答のリクエスト数・画面の更新頻度。超えたら拡張を停止する
 * - 拒否が一定回数に達したら、停止する
 */
import type { ExtensionEventName, ExtensionEvents } from '../events';
import type { ExtensionPermissions } from '../manifest';
import { PERMISSION_EVENTS } from '../manifest';
import { SCRIPT_LIMITS } from './limits';
import {
	narrowEventPayload,
	parseRequest,
	type ErrorCode,
	type HostMessage,
	type RequestMessage
} from './protocol';
import { ScriptStorageError, type ScriptStorage } from './storage';
import { checkUiEvent, validateUi, type UiTree, type UiEventKind } from './ui';

/** 拡張を止める理由 */
export type StopReason =
	| 'hang' // ワーカーが応答しない(無限ループなど)
	| 'shell-hang' // 隔離された枠(iframe)が応答しない
	| 'flood' // メッセージ・画面の更新が多すぎる
	| 'oversize' // メッセージが大きすぎる
	| 'protocol' // 決められた形でないメッセージ
	| 'violations' // 権限のないことを繰り返した
	| 'error' // 読み込み時の例外
	| 'timeout'; // 起動できなかった

export const STOP_MESSAGES: Record<StopReason, string> = {
	hang: '応答がなくなった(無限ループなど)ため、停止しました',
	'shell-hang': '隔離された環境が応答しなくなったため、停止しました',
	flood: 'メッセージまたは画面の更新が多すぎたため、停止しました',
	oversize: '大きすぎるメッセージを送ったため、停止しました',
	protocol: '決められた形ではないメッセージを送ったため、停止しました',
	violations: '権限のない操作や上限を超える操作を繰り返したため、停止しました',
	error: '読み込み中にエラーが出たため、停止しました',
	timeout: '起動できなかったため、停止しました'
};

export interface BridgeEnv {
	/** 宣言したイベントだけを購読できる窓口(ExtensionContext.events) */
	events: ExtensionEvents;
	/** 作品の総文字数(権限 project:chars が無ければ undefined を返す窓口) */
	getProjectCharCount(projectId: string): Promise<number | undefined>;
	storage: ScriptStorage;
	notify(message: string): void;
	/** 画面を更新する(null で消す) */
	setUi(target: UiTarget, tree: UiTree | null): void;
	/** ワーカーへ送る */
	send(message: HostMessage): void;
	/** 拡張を停止する(呼び出し側が iframe を取り除く) */
	stop(reason: StopReason, detail?: string): void;
	now(): number;
}

export type UiTarget = 'panel' | 'settings';

const SESSION_EVENTS: readonly ExtensionEventName[] = [
	'session:start',
	'session:update',
	'session:end'
];

class Denied extends Error {
	constructor(
		message: string,
		readonly code: ErrorCode
	) {
		super(message);
	}
}

export class ScriptBridge {
	private disposed = false;
	private received: number[] = [];
	private uiUpdates: number[] = [];
	private notifies: number[] = [];
	private pending = 0;
	private violations = 0;
	private unsubscribers = new Map<ExtensionEventName, () => void>();
	/** イベントの配信は順番を守る(総文字数の読み取りを待つ間に追い越さない) */
	private deliver: Promise<void> = Promise.resolve();
	private trees: Record<UiTarget, UiTree | null> = { panel: null, settings: null };

	constructor(
		private readonly permissions: ExtensionPermissions,
		private readonly env: BridgeEnv
	) {}

	private get canTitle(): boolean {
		return this.permissions.read?.includes('project:title') ?? false;
	}

	private get canChars(): boolean {
		return this.permissions.read?.includes('project:chars') ?? false;
	}

	/** 受信回数が 1 秒あたりの上限を超えたか */
	private overRate(stamps: number[], limit: number, windowMs: number): boolean {
		const now = this.env.now();
		stamps.push(now);
		while (stamps.length > 0 && now - stamps[0] >= windowMs) stamps.shift();
		return stamps.length > limit;
	}

	private stop(reason: StopReason, detail?: string): void {
		if (this.disposed) return;
		this.dispose();
		this.env.stop(reason, detail);
	}

	/** ワーカーからのメッセージを処理する。例外は投げない */
	handle(data: unknown): void {
		if (this.disposed) return;
		if (this.overRate(this.received, SCRIPT_LIMITS.messagesPerSecond, 1000)) {
			this.stop('flood', 'メッセージの数');
			return;
		}
		const parsed = parseRequest(data);
		if (!parsed.ok) {
			this.stop(parsed.reason, 'メッセージの形または大きさ');
			return;
		}
		if (this.pending >= SCRIPT_LIMITS.pendingRequests) {
			this.stop('flood', '応答待ちのリクエスト');
			return;
		}
		this.pending++;
		void this.process(parsed.request).finally(() => {
			this.pending--;
		});
	}

	private reply(message: HostMessage): void {
		if (!this.disposed) this.env.send(message);
	}

	private async process(req: RequestMessage): Promise<void> {
		try {
			const value = await this.dispatch(req);
			this.reply({ t: 'res', id: req.id, ok: true, v: value ?? null });
		} catch (error) {
			if (this.disposed) return;
			let code: ErrorCode = 'internal';
			let msg = '処理できませんでした';
			if (error instanceof Denied) {
				code = error.code;
				msg = error.message;
			} else if (error instanceof ScriptStorageError) {
				code = error.code;
				msg = error.message;
			} else {
				console.warn('スクリプト拡張のリクエストを処理できませんでした:', error);
			}
			// 権限・上限による拒否は数える。繰り返したら停止する
			if (code !== 'internal') {
				this.violations++;
				if (this.violations >= SCRIPT_LIMITS.violationsBeforeStop) {
					this.stop('violations', msg);
					return;
				}
			}
			this.reply({ t: 'res', id: req.id, ok: false, code, msg });
		}
	}

	private async dispatch(req: RequestMessage): Promise<unknown> {
		const args =
			typeof req.a === 'object' && req.a !== null && !Array.isArray(req.a)
				? (req.a as Record<string, unknown>)
				: {};
		switch (req.m) {
			case 'events.on':
				return this.subscribe(args.name);
			case 'events.off':
				return this.unsubscribe(args.name);
			case 'storage.get':
				this.requireStorage();
				return this.env.storage.get(args.key);
			case 'storage.set':
				this.requireStorage();
				return this.env.storage.set(args.key, args.value);
			case 'storage.delete':
				this.requireStorage();
				return this.env.storage.delete(args.key);
			case 'storage.list':
				this.requireStorage();
				return this.env.storage.list(args.prefix);
			case 'ui.set':
				return this.setUi(args);
			case 'notify':
				return this.notify(args.message);
		}
	}

	private requireStorage(): void {
		if (!this.permissions.storage)
			throw new Denied(
				'storage は、マニフェストの permissions.storage を宣言していません',
				'permission'
			);
	}

	private eventName(name: unknown): ExtensionEventName {
		if (typeof name !== 'string' || !(PERMISSION_EVENTS as readonly string[]).includes(name)) {
			throw new Denied('イベントの名前が正しくありません', 'invalid');
		}
		return name as ExtensionEventName;
	}

	private subscribe(rawName: unknown): null {
		const name = this.eventName(rawName);
		if (!(this.permissions.events ?? []).includes(name)) {
			throw new Denied(
				`イベント ${name} は、マニフェストの permissions.events に宣言していません`,
				'permission'
			);
		}
		if (this.unsubscribers.has(name)) return null;
		const off = this.env.events.on(name, (payload) => {
			// 配信は、順番どおりに 1 つずつ
			this.deliver = this.deliver.then(() => this.forward(name, payload)).catch(() => undefined);
		});
		this.unsubscribers.set(name, off);
		return null;
	}

	private unsubscribe(rawName: unknown): null {
		const name = this.eventName(rawName);
		this.unsubscribers.get(name)?.();
		this.unsubscribers.delete(name);
		return null;
	}

	private async forward(name: ExtensionEventName, payload: unknown): Promise<void> {
		if (this.disposed || !this.unsubscribers.has(name)) return;
		const narrowed = narrowEventPayload(name, payload as never, { canTitle: this.canTitle });
		if (this.canChars && SESSION_EVENTS.includes(name)) {
			const projectId = (payload as { projectId?: unknown }).projectId;
			if (typeof projectId === 'string') {
				const chars = await this.env.getProjectCharCount(projectId);
				if (typeof chars === 'number') narrowed.projectChars = chars;
			}
		}
		this.reply({ t: 'ev', n: name, p: narrowed });
	}

	private setUi(args: Record<string, unknown>): null {
		if (!this.permissions.ui)
			throw new Denied('ui は、マニフェストの permissions.ui を宣言していません', 'permission');
		if (this.overRate(this.uiUpdates, SCRIPT_LIMITS.uiUpdatesPerSecond, 1000)) {
			this.stop('flood', '画面の更新');
			throw new Denied('画面の更新が多すぎます', 'rate');
		}
		const target = args.target;
		if (target !== 'panel' && target !== 'settings')
			throw new Denied("target は 'panel' か 'settings' です", 'invalid');
		if (args.nodes === null) {
			this.trees[target] = null;
			this.env.setUi(target, null);
			return null;
		}
		const result = validateUi({ nodes: args.nodes, badge: args.badge });
		if (!result.ok) throw new Denied(result.error, 'limit');
		this.trees[target] = result.tree;
		this.env.setUi(target, result.tree);
		return null;
	}

	private notify(message: unknown): null {
		if (!this.permissions.notify)
			throw new Denied(
				'notify は、マニフェストの permissions.notify を宣言していません',
				'permission'
			);
		if (typeof message !== 'string' || message.trim() === '')
			throw new Denied('message は文字列で指定してください', 'invalid');
		if (message.length > SCRIPT_LIMITS.notifyLength)
			throw new Denied(`message は ${SCRIPT_LIMITS.notifyLength} 文字までです`, 'limit');
		if (this.overRate(this.notifies, SCRIPT_LIMITS.notifyPerMinute, 60_000)) {
			// 超えた分は数えない(記録から外す)
			this.notifies.pop();
			throw new Denied(`通知は 1 分に ${SCRIPT_LIMITS.notifyPerMinute} 回までです`, 'rate');
		}
		this.env.notify(message);
		return null;
	}

	/** 画面の操作(ボタンを押した・値を変えた)をスクリプトへ渡す。記述にない操作は渡さない */
	sendUiEvent(target: UiTarget, id: string, kind: UiEventKind, value?: unknown): void {
		if (this.disposed) return;
		if (!checkUiEvent(this.trees[target], id, kind, value)) return;
		this.reply({ t: 'ui', id, kind, ...(value === undefined ? {} : { v: value }) });
	}

	/** 購読を解除して、以降のメッセージを無視する */
	dispose(): void {
		this.disposed = true;
		for (const off of this.unsubscribers.values()) off();
		this.unsubscribers.clear();
	}
}
