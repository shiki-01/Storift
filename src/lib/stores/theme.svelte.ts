import { get as idbGet, set as idbSet } from 'idb-keyval';

export interface Theme {
	id: string;
	name: string;
	colors: {
		primary: string;
		secondary: string;
		background: string;
		surface: string;
		text: string;
		textSecondary: string;
		border: string;
		accent: string;
		success: string;
		warning: string;
		error: string;
		info: string;
	};
	editor: {
		background: string;
		text: string;
		selection: string;
		lineHighlight: string;
		cursor: string;
	};
	fonts: {
		body: string;
		editor: string;
		heading: string;
	};
}

export const themes: Record<string, Theme> = {
	light: {
		id: 'light',
		name: 'ライト',
		colors: {
			primary: '#3b82f6',
			secondary: '#8b5cf6',
			background: '#ffffff',
			surface: '#f9fafb',
			text: '#1f2937',
			textSecondary: '#6b7280',
			border: '#e5e7eb',
			accent: '#f59e0b',
			success: '#10b981',
			warning: '#f59e0b',
			error: '#ef4444',
			info: '#3b82f6'
		},
		editor: {
			background: '#ffffff',
			text: '#1f2937',
			selection: '#bfdbfe',
			lineHighlight: '#f3f4f6',
			cursor: '#3b82f6'
		},
		fonts: {
			body: "'Noto Sans JP', sans-serif",
			editor: "'Noto Serif JP', serif",
			heading: "'Noto Sans JP', sans-serif"
		}
	},
	dark: {
		id: 'dark',
		name: 'ダーク',
		colors: {
			primary: '#60a5fa',
			secondary: '#a78bfa',
			background: '#111827',
			surface: '#1f2937',
			text: '#f9fafb',
			textSecondary: '#9ca3af',
			border: '#374151',
			accent: '#fbbf24',
			success: '#34d399',
			warning: '#fbbf24',
			error: '#f87171',
			info: '#60a5fa'
		},
		editor: {
			background: '#1f2937',
			text: '#f9fafb',
			selection: '#1e40af',
			lineHighlight: '#374151',
			cursor: '#60a5fa'
		},
		fonts: {
			body: "'Noto Sans JP', sans-serif",
			editor: "'Noto Serif JP', serif",
			heading: "'Noto Sans JP', sans-serif"
		}
	},
	sepia: {
		id: 'sepia',
		name: 'セピア',
		colors: {
			primary: '#92400e',
			secondary: '#78350f',
			background: '#fef3c7',
			surface: '#fde68a',
			text: '#451a03',
			textSecondary: '#78350f',
			border: '#fbbf24',
			accent: '#dc2626',
			success: '#15803d',
			warning: '#ea580c',
			error: '#dc2626',
			info: '#92400e'
		},
		editor: {
			background: '#fef3c7',
			text: '#451a03',
			selection: '#fde68a',
			lineHighlight: '#fef3c7',
			cursor: '#92400e'
		},
		fonts: {
			body: "'Noto Sans JP', sans-serif",
			editor: "'Noto Serif JP', serif",
			heading: "'Noto Sans JP', sans-serif"
		}
	},
	night: {
		id: 'night',
		name: 'ナイト',
		colors: {
			primary: '#818cf8',
			secondary: '#c084fc',
			background: '#0f172a',
			surface: '#1e293b',
			text: '#e2e8f0',
			textSecondary: '#94a3b8',
			border: '#334155',
			accent: '#fb923c',
			success: '#4ade80',
			warning: '#fb923c',
			error: '#fb7185',
			info: '#818cf8'
		},
		editor: {
			background: '#1e293b',
			text: '#e2e8f0',
			selection: '#312e81',
			lineHighlight: '#334155',
			cursor: '#818cf8'
		},
		fonts: {
			body: "'Noto Sans JP', sans-serif",
			editor: "'Noto Serif JP', serif",
			heading: "'Noto Sans JP', sans-serif"
		}
	}
};

/**
 * テーマストアの状態
 */
class ThemeStore {
	private currentTheme: Theme = $state(themes.light);
	private autoTheme: boolean = $state(false);
	private initialized = false;

	constructor() {
		// ブラウザ環境でのみ初期化
		if (typeof window !== 'undefined') {
			this.init();
		}
	}

	async init() {
		if (this.initialized) return;
		this.initialized = true;

		// 保存されたテーマ設定を読み込み
		const savedThemeId = await idbGet<string>('app-theme');
		const savedAutoTheme = await idbGet<boolean>('app-auto-theme');

		if (savedAutoTheme) {
			this.autoTheme = true;
			this.applySystemTheme();
		} else if (savedThemeId && themes[savedThemeId]) {
			this.currentTheme = themes[savedThemeId];
			this.applyTheme(this.currentTheme);
		} else {
			this.applyTheme(themes.light);
		}

		// システムテーマの変更を監視
		if (typeof window !== 'undefined') {
			window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
				if (this.autoTheme) {
					this.applySystemTheme();
				}
			});
		}
	}

	/**
	 * 現在のテーマを取得
	 */
	get theme(): Theme {
		return this.currentTheme;
	}

	/**
	 * テーマを設定
	 */
	async setTheme(themeId: string) {
		if (themes[themeId]) {
			this.currentTheme = themes[themeId];
			this.autoTheme = false;
			this.applyTheme(this.currentTheme);
			if (typeof window !== 'undefined') {
				await idbSet('app-theme', themeId);
				await idbSet('app-auto-theme', false);
			}
		}
	}

	/**
	 * 自動テーマを設定
	 */
	async setAutoTheme(auto: boolean) {
		this.autoTheme = auto;
		if (typeof window !== 'undefined') {
			await idbSet('app-auto-theme', auto);
		}

		if (auto) {
			this.applySystemTheme();
		}
	}

	/**
	 * システムテーマを適用
	 */
	private applySystemTheme() {
		if (typeof window !== 'undefined') {
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			this.currentTheme = prefersDark ? themes.dark : themes.light;
			this.applyTheme(this.currentTheme);
		}
	}

	/**
	 * テーマをDOMに適用
	 */
	private applyTheme(theme: Theme) {
		if (typeof document === 'undefined') return;

		const root = document.documentElement;

		// CSS変数として設定
		root.style.setProperty('--color-primary', theme.colors.primary);
		root.style.setProperty('--color-secondary', theme.colors.secondary);
		root.style.setProperty('--color-background', theme.colors.background);
		root.style.setProperty('--color-surface', theme.colors.surface);
		root.style.setProperty('--color-text', theme.colors.text);
		root.style.setProperty('--color-text-secondary', theme.colors.textSecondary);
		root.style.setProperty('--color-border', theme.colors.border);
		root.style.setProperty('--color-accent', theme.colors.accent);
		root.style.setProperty('--color-success', theme.colors.success);
		root.style.setProperty('--color-warning', theme.colors.warning);
		root.style.setProperty('--color-error', theme.colors.error);
		root.style.setProperty('--color-info', theme.colors.info);

		// エディタカラー
		root.style.setProperty('--editor-background', theme.editor.background);
		root.style.setProperty('--editor-text', theme.editor.text);
		root.style.setProperty('--editor-selection', theme.editor.selection);
		root.style.setProperty('--editor-line-highlight', theme.editor.lineHighlight);
		root.style.setProperty('--editor-cursor', theme.editor.cursor);

		// フォント
		root.style.setProperty('--font-body', theme.fonts.body);
		root.style.setProperty('--font-editor', theme.fonts.editor);
		root.style.setProperty('--font-heading', theme.fonts.heading);

		// data-theme属性を設定
		root.setAttribute('data-theme', theme.id);
	}

	/**
	 * 自動テーマが有効か
	 */
	get isAutoTheme(): boolean {
		return this.autoTheme;
	}
}

export const themeStore = new ThemeStore();
