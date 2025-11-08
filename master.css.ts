import type { Config } from '@master/css';

export default {
	variables: {
		// 固定カラー
		color: {
			black: '#111111',
			white: '#F9F9F9',
			gray: '#D9D9D9'
		},
		// テーマカラー（CSS変数から参照）
		theme: {
			primary: 'var(--color-primary)',
			secondary: 'var(--color-secondary)',
			background: 'var(--color-background)',
			surface: 'var(--color-surface)',
			text: 'var(--color-text)',
			'text-secondary': 'var(--color-text-secondary)',
			border: 'var(--color-border)',
			accent: 'var(--color-accent)',
			success: 'var(--color-success)',
			warning: 'var(--color-warning)',
			error: 'var(--color-error)',
			info: 'var(--color-info)'
		},
		// エディタカラー
		editor: {
			background: 'var(--editor-background)',
			text: 'var(--editor-text)',
			selection: 'var(--editor-selection)',
			'line-highlight': 'var(--editor-line-highlight)',
			cursor: 'var(--editor-cursor)'
		}
	}
} as Config;
