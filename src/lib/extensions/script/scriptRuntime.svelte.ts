/**
 * 動いているスクリプト拡張の管理(Svelte のリアクティブな状態)。
 *
 * 拡張ごとに、隔離された環境(sandbox.ts)とブリッジ(bridge.ts)を 1 組持つ。状態(起動中・動作中・停止・非対応)と、
 * 画面(ポップアップ・設定欄)の記述をここに保持して、画面側(ScriptPanel / ScriptSettings / 拡張のカード)が読む。
 *
 * 止める条件(ウォッチドッグ・上限超過・権限違反の繰り返し)に当たったら、その拡張を「停止」にして利用者に通知する。
 * 連続して止まった回数が上限に達したら、自動で無効にする(onAutoDisable)。
 */
import { SvelteMap } from 'svelte/reactivity';
import type { ExtensionContext } from '../types';
import type { ExtensionManifest } from '../manifest';
import { STOP_MESSAGES, ScriptBridge, type StopReason, type UiTarget } from './bridge';
import { SCRIPT_LIMITS } from './limits';
import { sandboxPrerequisites, startSandbox, type SandboxProcess } from './sandbox';
import { ScriptStorage } from './storage';
import type { UiEventKind, UiTree } from './ui';

export const STOP_COUNT_STORAGE_KEY = 'storift:extensions:script-stops';

export type ScriptStatus = 'starting' | 'running' | 'stopped' | 'unsupported';

export interface ScriptState {
	status: ScriptStatus;
	/** 停止の理由(status が stopped のとき) */
	reason?: StopReason;
	/** 補足(エラーメッセージなど。短く切ってある) */
	detail?: string;
	panel: UiTree | null;
	settings: UiTree | null;
}

interface Run {
	manifest: ExtensionManifest;
	source: string;
	ctx: ExtensionContext;
	process: SandboxProcess | null;
	bridge: ScriptBridge | null;
	stableTimer?: ReturnType<typeof setTimeout>;
}

function readCounts(): Record<string, number> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STOP_COUNT_STORAGE_KEY) ?? '{}');
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: Record<string, number> = {};
		for (const [id, n] of Object.entries(parsed)) if (typeof n === 'number' && n > 0) out[id] = n;
		return out;
	} catch {
		return {};
	}
}

function writeCounts(counts: Record<string, number>): void {
	try {
		localStorage.setItem(STOP_COUNT_STORAGE_KEY, JSON.stringify(counts));
	} catch {
		// 保存できなくても、動作は続ける
	}
}

class ScriptRuntime {
	private states = new SvelteMap<string, ScriptState>();
	/** 自動で無効にしたことの記録(カードに出す。次に有効にするまで) */
	private autoDisabled = new SvelteMap<string, StopReason>();
	private runs = new Map<string, Run>();
	/** この環境ではワーカーを起動できなかった(起動時の検出の結果。以降は実行しない) */
	probeFailed = $state(false);
	/** 自動で無効にするときの処理(packManager が、拡張ホストの setEnabled(id, false) を渡す) */
	onAutoDisable: ((id: string) => void | Promise<void>) | null = null;

	/** この環境で、スクリプトを隔離して実行できるか */
	get supported(): boolean {
		return !this.probeFailed && sandboxPrerequisites();
	}

	state(id: string): ScriptState | undefined {
		return this.states.get(id);
	}

	autoDisabledReason(id: string): StopReason | undefined {
		return this.autoDisabled.get(id);
	}

	/** ツールバーのアイコンにドットを出すか */
	badge(id: string): boolean {
		return this.states.get(id)?.panel?.badge === true;
	}

	private patch(id: string, change: Partial<ScriptState>): void {
		const prev = this.states.get(id) ?? { status: 'starting', panel: null, settings: null };
		this.states.set(id, { ...prev, ...change });
	}

	/** 起動する(すでに動いていれば、いったん止めてから)。拡張の activate から呼ぶ */
	launch(manifest: ExtensionManifest, source: string, ctx: ExtensionContext): void {
		const id = manifest.id;
		this.teardown(id);
		this.autoDisabled.delete(id);
		this.states.set(id, { status: 'starting', panel: null, settings: null });
		if (!this.supported) {
			this.patch(id, { status: 'unsupported' });
			return;
		}
		const run: Run = { manifest, source, ctx, process: null, bridge: null };
		this.runs.set(id, run);
		const storage = new ScriptStorage(id);
		const process = startSandbox({
			hosts: manifest.permissions.network ?? [],
			source,
			label: manifest.name,
			onEvent: (event) => {
				if (this.runs.get(id) !== run) return;
				switch (event.type) {
					case 'message':
						run.bridge?.handle(event.data);
						break;
					case 'loaded':
						this.patch(id, { status: 'running' });
						clearTimeout(run.stableTimer);
						run.stableTimer = setTimeout(() => this.resetStops(id), SCRIPT_LIMITS.stableMs);
						break;
					case 'unsupported':
						this.teardown(id);
						this.probeFailed = true;
						this.patch(id, { status: 'unsupported' });
						break;
					case 'stopped':
						this.handleStop(id, event.reason, event.detail);
						break;
					case 'worker-error':
						console.warn(`拡張機能 ${id} のスクリプトで例外が出ました:`, event.detail);
						break;
				}
			}
		});
		run.process = process;
		run.bridge = new ScriptBridge(manifest.permissions, {
			events: ctx.events,
			getProjectCharCount: (projectId) => ctx.getProjectCharCount(projectId),
			storage,
			notify: (message) => ctx.notify.info(`${manifest.name}: ${message}`),
			setUi: (target: UiTarget, tree) => this.patch(id, { [target]: tree }),
			send: (message) => process.post(message),
			stop: (reason, detail) => this.handleStop(id, reason, detail),
			now: () => Date.now()
		});
	}

	/** 止める(状態も消す)。拡張の deactivate から呼ぶ。連続して止まった回数も戻す */
	shutdown(id: string): void {
		this.teardown(id);
		this.states.delete(id);
		this.resetStops(id);
	}

	private teardown(id: string): void {
		const run = this.runs.get(id);
		if (!run) return;
		clearTimeout(run.stableTimer);
		run.bridge?.dispose();
		run.process?.destroy();
		this.runs.delete(id);
	}

	/** 「再開」: 止まった拡張を、もう一度起動する */
	restart(id: string): void {
		const run = this.runs.get(id);
		const state = this.states.get(id);
		if (!run || state?.status !== 'stopped') return;
		this.launch(run.manifest, run.source, run.ctx);
	}

	private handleStop(id: string, reason: StopReason, detail?: string): void {
		const run = this.runs.get(id);
		if (!run) return;
		const { manifest, ctx } = run;
		// iframe とブリッジは取り除くが、再開できるよう run は残す
		clearTimeout(run.stableTimer);
		run.bridge?.dispose();
		run.process?.destroy();
		run.bridge = null;
		run.process = null;
		this.patch(id, {
			status: 'stopped',
			reason,
			detail: detail?.slice(0, 200),
			panel: null,
			settings: null
		});
		const counts = readCounts();
		const count = (counts[id] ?? 0) + 1;
		counts[id] = count;
		writeCounts(counts);
		console.warn(`拡張機能 ${id} を停止しました: ${reason}`, detail ?? '');
		if (count >= SCRIPT_LIMITS.consecutiveStopsBeforeDisable) {
			this.autoDisabled.set(id, reason);
			ctx.notify.error(
				`「${manifest.name}」が続けて停止したため、無効にしました(${STOP_MESSAGES[reason]})`
			);
			void this.onAutoDisable?.(id);
		} else {
			ctx.notify.error(`「${manifest.name}」を停止しました。${STOP_MESSAGES[reason]}`);
		}
	}

	private resetStops(id: string): void {
		const counts = readCounts();
		if (!(id in counts)) return;
		delete counts[id];
		writeCounts(counts);
	}

	/** 画面の操作(ボタン・入力など)をスクリプトへ渡す */
	sendUiEvent(
		id: string,
		target: UiTarget,
		uiId: string,
		kind: UiEventKind,
		value?: unknown
	): void {
		this.runs.get(id)?.bridge?.sendUiEvent(target, uiId, kind, value);
	}
}

export const scriptRuntime = new ScriptRuntime();
