/** Claude Code(claude コマンド)。Rust 側(claude.rs)の実行を包むアダプタ */
import { getClaudeStatus } from '$lib/desktop/ai';
import type { AiProvider } from '../types';
import { runNative } from './native';

export const claudeCodeProvider: AiProvider = {
	id: 'claude-code',
	label: 'Claude Code',
	description: 'Claude Code(claude コマンド)を使います。Web 検索も使えます。',
	requires: 'Claude Code のインストールとログイン',
	destination: 'Anthropic(Claude Code 経由)',
	settingsKey: 'claudeCode',
	settingsSchema: [
		{
			key: 'claudePath',
			label: 'claude の場所',
			type: 'text',
			placeholder: '空なら自動で探します'
		},
		{ key: 'allowWeb', label: 'Web 検索を許可する', type: 'checkbox' }
	],
	capabilities: { webSearch: true, resume: true, tools: true },

	run(request, emit, signal) {
		const s = request.settings.claudeCode;
		return runNative(
			request,
			'claude',
			{ model: s.model, allowWeb: s.allowWeb, claudePath: s.claudePath },
			emit,
			signal
		);
	},

	async status(settings) {
		try {
			return await getClaudeStatus(settings.claudeCode.claudePath);
		} catch (error) {
			return { found: false, error: String(error) };
		}
	}
};
