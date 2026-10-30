/**
 * デスクトップ版のネイティブ側(src-tauri)の呼び出し。
 * Web 版では呼ばれない(呼び出し元で isDesktop() を確認する)。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { buildWorkspace, loadWorkspaceData, type WorkspaceExport } from './workspace';

export interface ClaudeStatus {
	found: boolean;
	path?: string;
	version?: string;
	error?: string;
	/** `claude auth status` の結果(確かめられなければ undefined) */
	loggedIn?: boolean;
}

export interface SendRequest {
	requestId: string;
	prompt: string;
	sessionId?: string;
	model?: string;
	allowWeb: boolean;
	claudePath?: string;
	appendSystemPrompt?: string;
}

export interface ExitEvent {
	requestId: string;
	code: number | null;
	cancelled: boolean;
	stderr: string;
}

/** 出力 1 行(index はその実行の何行目か) */
interface LineEvent {
	requestId: string;
	index: number;
	line: string;
}

interface AttachResult {
	lines: string[];
	exit: ExitEvent | null;
}

export function getClaudeStatus(claudePath?: string): Promise<ClaudeStatus> {
	return invoke('claude_status', { claudePath: claudePath || null });
}

/** ターミナルを開いて `claude auth login` を実行する */
export function openClaudeLogin(claudePath?: string): Promise<void> {
	return invoke('claude_open_login', { claudePath: claudePath || null });
}

export function cancelClaude(requestId: string): Promise<void> {
	return invoke('claude_cancel', { requestId });
}

/**
 * メッセージを送り、出力を 1 行ずつ受け取る。
 * 戻り値の Promise はプロセスの終了で解決する。
 */
export async function sendToClaude(
	request: SendRequest,
	onLine: (line: string) => void
): Promise<ExitEvent> {
	const unlisten: UnlistenFn[] = [];
	try {
		let resolveExit!: (e: ExitEvent) => void;
		const exited = new Promise<ExitEvent>((resolve) => (resolveExit = resolve));
		// 取りこぼさないよう、購読を始めてから起動する
		unlisten.push(
			await listen<ExitEvent>('claude://exit', (e) => {
				if (e.payload.requestId === request.requestId) resolveExit(e.payload);
			}),
			await listen<LineEvent>('claude://line', (e) => {
				if (e.payload.requestId === request.requestId) onLine(e.payload.line);
			})
		);
		await invoke('claude_send', { request });
		return await exited;
	} finally {
		for (const u of unlisten) u();
	}
}

/**
 * 再読み込みなどで画面が入れ替わった後に、実行中(または直前に終わった)の出力を受け取り直し、
 * 続きも流す。ネイティブ側に記録が無ければ(アプリを再起動した等) null を返す。
 */
export async function attachClaude(
	requestId: string,
	onLine: (line: string) => void
): Promise<ExitEvent | null> {
	const unlisten: UnlistenFn[] = [];
	try {
		let resolveExit!: (e: ExitEvent) => void;
		const exited = new Promise<ExitEvent>((resolve) => (resolveExit = resolve));
		// 受け取り直す前に届いた行は取っておき、index で重複を除いてから流す
		let next = 0;
		let replayed = false;
		const early: LineEvent[] = [];
		const deliver = (e: LineEvent) => {
			if (e.index < next) return;
			next = e.index + 1;
			onLine(e.line);
		};
		unlisten.push(
			await listen<ExitEvent>('claude://exit', (e) => {
				if (e.payload.requestId === requestId) resolveExit(e.payload);
			}),
			await listen<LineEvent>('claude://line', (e) => {
				if (e.payload.requestId !== requestId) return;
				if (replayed) deliver(e.payload);
				else early.push(e.payload);
			})
		);
		const snapshot = await invoke<AttachResult | null>('claude_attach', { requestId });
		if (!snapshot) return null;
		snapshot.lines.forEach((line, index) => deliver({ requestId, index, line }));
		replayed = true;
		early.forEach(deliver);
		return snapshot.exit ?? (await exited);
	} finally {
		for (const u of unlisten) u();
	}
}

/** 結果を受け取り終えた実行の記録をネイティブ側から消す */
export function releaseClaude(requestId: string): Promise<void> {
	return invoke('claude_release', { requestId });
}

export function getWorkspacePath(): Promise<{ path: string }> {
	return invoke('workspace_info');
}

export function openWorkspace(): Promise<void> {
	return invoke('workspace_open');
}

/** 全プロジェクトを書き出し、ワークスペースを最新にする(overrides: シーン ID → 未保存の本文) */
export async function syncWorkspace(
	overrides: Record<string, string> = {}
): Promise<WorkspaceExport> {
	const exported = buildWorkspace(await loadWorkspaceData(), overrides);
	await invoke('workspace_sync', { files: exported.files });
	return exported;
}
