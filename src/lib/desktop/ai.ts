/**
 * デスクトップ版のネイティブ側(src-tauri)の呼び出し。
 * Web 版では呼ばれない(呼び出し元で isDesktop() を確認する)。
 * Claude Code と Ollama は Rust 側で実行し、出力を 1 行ずつ受け取る(sendNativeRun)。
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

/** ネイティブ側で実行するプロバイダ(Rust の SendRequest.provider の値) */
export type NativeProvider = 'claude' | 'ollama';

export interface SendRequest {
	/** 実行の ID。MCP の呼び出しはこれで回答(assistant メッセージ)を特定する */
	requestId: string;
	prompt: string;
	sessionId?: string;
	model?: string;
	allowWeb: boolean;
	claudePath?: string;
	appendSystemPrompt?: string;
	/** 編集モード。propose_edit の扱い(提案のみでは使わせない)をネイティブ側が決める */
	editMode: 'suggest' | 'confirm' | 'auto';
	/** 省略時は claude。ollama ならローカルの Ollama で動かす(model は Ollama のモデル名) */
	provider?: NativeProvider;
	ollamaUrl?: string;
}

export interface OllamaStatus {
	found: boolean;
	version?: string;
	models: string[];
	error?: string;
}

export interface ExitEvent {
	requestId: string;
	code: number | null;
	cancelled: boolean;
	stderr: string;
	/** HTTP 系プロバイダで、認証の失敗(API キーの誤りなど)だったとき */
	authError?: boolean;
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

export function getOllamaStatus(url?: string): Promise<OllamaStatus> {
	return invoke('ollama_status', { url: url || null });
}

/** ターミナルを開いて `claude auth login` を実行する */
export function openClaudeLogin(claudePath?: string): Promise<void> {
	return invoke('claude_open_login', { claudePath: claudePath || null });
}

export function cancelNativeRun(requestId: string): Promise<void> {
	return invoke('claude_cancel', { requestId });
}

/**
 * メッセージを送り、出力を 1 行ずつ受け取る。
 * 戻り値の Promise はプロセスの終了で解決する。
 */
export async function sendNativeRun(
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
export async function attachNativeRun(
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
export function releaseNativeRun(requestId: string): Promise<void> {
	return invoke('claude_release', { requestId });
}

/** アプリのツールの定義(MCP と同じ内容)。HTTP 系プロバイダが自分の形式へ変換して使う */
export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export function fetchToolDefinitions(
	mode: 'suggest' | 'confirm' | 'auto',
	allowWeb = false
): Promise<ToolDefinition[]> {
	return invoke('ai_tool_definitions', { mode, allowWeb });
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
