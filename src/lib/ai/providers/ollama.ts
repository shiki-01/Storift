/** Ollama(ローカルの LLM)。Rust 側(ollama.rs)の実行を包むアダプタ */
import { getOllamaStatus } from '$lib/desktop/ai';
import type { AiProvider } from '../types';
import { runNative } from './native';

export const ollamaProvider: AiProvider = {
	id: 'ollama',
	label: 'Ollama',
	description: 'この端末で動かす Ollama を使います。Web 検索は使えません。',
	requires: 'Ollama の起動と、ツール呼び出しに対応したモデル',
	destination: 'この端末(Ollama の接続先)',
	settingsKey: 'ollama',
	settingsSchema: [
		{ key: 'url', label: '接続先', type: 'url', placeholder: 'http://localhost:11434' }
	],
	capabilities: { webSearch: false, resume: true, tools: true },
	sessionPrefix: 'ollama-',

	run(request, emit, signal) {
		const s = request.settings.ollama;
		return runNative(
			request,
			'ollama',
			{ model: s.model, allowWeb: false, ollamaUrl: s.url },
			emit,
			signal
		);
	},

	async status(settings) {
		try {
			const r = await getOllamaStatus(settings.ollama.url);
			return { found: r.found, version: r.version, error: r.error, models: r.models };
		} catch (error) {
			return { found: false, error: String(error) };
		}
	},

	async listModels(settings) {
		return (await getOllamaStatus(settings.ollama.url)).models;
	}
};
