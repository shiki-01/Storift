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

// 配色は「紙と墨」を基調にする。
// 原色に近い青や紫は避け、藍・朱・松葉といった落ち着いた色を差し色に使う。
export const themes: Record<string, Theme> = {
	light: {
		id: 'light',
		name: '和紙',
		colors: {
			primary: '#33507a', // 藍
			secondary: '#6b5b7b', // 藤鼠
			background: '#f6f4ef',
			surface: '#ece8df',
			text: '#2a2925', // 墨
			textSecondary: '#78736a',
			border: '#dfdad0',
			accent: '#b4543a', // 朱
			success: '#557a4c', // 松葉
			warning: '#b0812c', // 黄土
			error: '#a83c3c', // 臙脂
			info: '#33507a'
		},
		editor: {
			background: '#fbfaf6',
			text: '#2a2925',
			selection: '#d6dfeb',
			lineHighlight: '#f1eee6',
			cursor: '#33507a'
		},
		fonts: {
			body: "'Noto Sans JP', sans-serif",
			editor: "'Noto Serif JP', serif",
			heading: "'Noto Sans JP', sans-serif"
		}
	},
	dark: {
		id: 'dark',
		name: '墨',
		colors: {
			primary: '#9db3d1',
			secondary: '#b3a6c2',
			background: '#1b1a18',
			surface: '#24231f',
			text: '#e7e3da',
			textSecondary: '#9a958a',
			border: '#34322d',
			accent: '#d98a6e',
			success: '#93b486',
			warning: '#d6b06a',
			error: '#e08a82',
			info: '#9db3d1'
		},
		editor: {
			background: '#201f1c',
			text: '#e7e3da',
			selection: '#3a4558',
			lineHighlight: '#2a2925',
			cursor: '#9db3d1'
		},
		fonts: {
			body: "'Noto Sans JP', sans-serif",
			editor: "'Noto Serif JP', serif",
			heading: "'Noto Sans JP', sans-serif"
		}
	},
	sepia: {
		id: 'sepia',
		name: '古書',
		colors: {
			primary: '#7a4b2a', // 焦茶
			secondary: '#6e5a45',
			background: '#f1e8d8',
			surface: '#e7dcc6',
			text: '#3b2f22',
			textSecondary: '#7f6c56',
			border: '#d9cab0',
			accent: '#a6452f',
			success: '#5d7444',
			warning: '#a8742a',
			error: '#a3392e',
			info: '#7a4b2a'
		},
		editor: {
			background: '#f6efe2',
			text: '#3b2f22',
			selection: '#e3d0ad',
			lineHighlight: '#efe5d2',
			cursor: '#7a4b2a'
		},
		fonts: {
			body: "'Noto Sans JP', sans-serif",
			editor: "'Noto Serif JP', serif",
			heading: "'Noto Sans JP', sans-serif"
		}
	},
	night: {
		id: 'night',
		name: '夜',
		colors: {
			primary: '#a9bedb',
			secondary: '#b9adc9',
			background: '#141920',
			surface: '#1b2129',
			text: '#d8dde3',
			textSecondary: '#8a939e',
			border: '#2a323c',
			accent: '#d9a46e',
			success: '#8fb39a',
			warning: '#d9b56e',
			error: '#e0918a',
			info: '#a9bedb'
		},
		editor: {
			background: '#171c23',
			text: '#d8dde3',
			selection: '#33425a',
			lineHighlight: '#1f2630',
			cursor: '#a9bedb'
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
