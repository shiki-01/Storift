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

export function getClaudeStatus(claudePath?: string): Promise<ClaudeStatus> {
	return invoke('claude_status', { claudePath: claudePath || null });
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
			await listen<{ requestId: string; line: string }>('claude://line', (e) => {
				if (e.payload.requestId === request.requestId) onLine(e.payload.line);
			})
		);
		await invoke('claude_send', { request });
		return await exited;
	} finally {
		for (const u of unlisten) u();
	}
}

export function getWorkspacePath(): Promise<{ path: string }> {
	return invoke('workspace_info');
}

export function openWorkspace(): Promise<void> {
	return invoke('workspace_open');
}

/** 全プロジェクトを書き出し、ワークスペースを最新にする */
export async function syncWorkspace(): Promise<WorkspaceExport> {
	const exported = buildWorkspace(await loadWorkspaceData());
	await invoke('workspace_sync', { files: exported.files });
	return exported;
}
