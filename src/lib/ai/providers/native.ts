/** Rust 側で実行するプロバイダ(Claude Code・Ollama)の共通の呼び出し */
import {
	cancelNativeRun,
	sendNativeRun,
	type ExitEvent,
	type NativeProvider
} from '$lib/desktop/ai';
import type { AiRunRequest } from '../types';

/** 送信して終了を待つ。signal が中断されたらネイティブ側の実行を止める */
export async function runNative(
	request: AiRunRequest,
	provider: NativeProvider,
	fields: {
		model?: string;
		allowWeb: boolean;
		claudePath?: string;
		ollamaUrl?: string;
	},
	emit: (line: string) => void,
	signal: AbortSignal
): Promise<ExitEvent> {
	const cancel = () => void cancelNativeRun(request.runId).catch(() => {});
	if (signal.aborted) cancel();
	else signal.addEventListener('abort', cancel, { once: true });
	try {
		return await sendNativeRun(
			{
				requestId: request.runId,
				prompt: request.prompt,
				sessionId: request.sessionId,
				provider,
				model: fields.model || undefined,
				allowWeb: fields.allowWeb,
				claudePath: fields.claudePath || undefined,
				ollamaUrl: fields.ollamaUrl || undefined,
				editMode: request.editMode,
				appendSystemPrompt: request.appendSystemPrompt
			},
			emit
		);
	} finally {
		signal.removeEventListener('abort', cancel);
	}
}
