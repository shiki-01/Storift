import {
	THEME_MIRROR_KEY,
	applySnapshot,
	buildMirror,
	parseMirror,
	resolveSystemDark,
	toSnapshot,
	type ThemeMirror
} from '$lib/utils/themeBoot';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { packRuntime, type PackThemeEntry } from '$lib/extensions/packRuntime.svelte';
import { DEFAULT_THEME_FONTS } from '$lib/utils/themeTools';

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
const builtinThemes: Record<string, Theme> = {
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
 * 組み込みとユーザー作成のテーマをまとめて ID から引けるようにする。
 * 読み込んだカスタムテーマもここに登録するので、ID で参照する箇所はそのまま動く。
 */
export const themes: Record<string, Theme> = { ...builtinThemes };

const CUSTOM_THEMES_KEY = 'app-custom-themes';

/** パックのテーマを、アプリのテーマにする(フォントは既定。パックは指定できない) */
function packEntryToTheme(entry: PackThemeEntry): Theme {
	return {
		id: entry.themeId,
		name: entry.theme.name,
		colors: { ...entry.theme.colors },
		editor: { ...entry.theme.editor },
		fonts: { ...DEFAULT_THEME_FONTS }
	};
}

function findTheme(themeId: string): Theme | undefined {
	return Object.hasOwn(themes, themeId) ? themes[themeId] : undefined;
}

/**
 * テーマストアの状態
 */
class ThemeStore {
	private currentTheme: Theme = $state(builtinThemes.light);
	private customList: Theme[] = $state([]);
	/** 有効なパックが足したテーマ(`pack:<パック>:<テーマ>`)。パックの有効/無効で増減する */
	private packList: Theme[] = $state([]);
	/** 保存済みのテーマがパックのもので、パックがまだ読み込まれていないときの ID */
	private pendingPackThemeId: string | null = null;
	private autoTheme: boolean = $state(false);
	private initialized = false;
	/** システムが最後にダークと判定できたか(判定できないときの代わり) */
	private lastSystemDark = false;
	/**
	 * 保存済みの設定の読み込みが終わったら解決する。
	 * 読み込み前に書き込むと既定のライトで上書きしてしまうので、書き込みはこれを待つ。
	 */
	readonly ready: Promise<void>;

	constructor() {
		// ブラウザ環境でのみ初期化
		if (typeof window !== 'undefined') {
			this.ready = this.init();
		} else {
			this.ready = Promise.resolve();
		}
	}

	async init() {
		if (this.initialized) return;
		this.initialized = true;

		// 起動前スクリプト(app.html)が適用した直前のテーマ。読み込めなければこれを保つ
		const mirror = this.readMirror();
		if (mirror) this.lastSystemDark = mirror.lastSystemDark;

		// システムテーマの変更を監視(読み込みの成否によらず登録する)
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (this.autoTheme) this.applySystemTheme();
		});

		try {
			// カスタムテーマを先に読み込み、保存済みのテーマ ID がカスタムでも復元できるようにする
			const savedCustom = await idbGet<Theme[]>(CUSTOM_THEMES_KEY);
			this.setCustomList(Array.isArray(savedCustom) ? savedCustom : []);

			// 保存されたテーマ設定を読み込み
			const savedThemeId = await idbGet<string>('app-theme');
			const savedAutoTheme = await idbGet<boolean>('app-auto-theme');
			const savedTheme = savedThemeId ? findTheme(savedThemeId) : undefined;

			if (savedAutoTheme) {
				this.autoTheme = true;
				this.applySystemTheme();
			} else if (!savedTheme && savedThemeId?.startsWith('pack:')) {
				// パックのテーマ。パックは拡張の起動(あと)で読み込まれるので、それまでは直前の見た目を保ち、
				// 保存済みの ID は書き換えない(syncPackThemes / settlePackThemes で確定する)
				this.pendingPackThemeId = savedThemeId;
				if (mirror) this.restoreFromMirror(mirror);
			} else if (savedTheme) {
				this.currentTheme = savedTheme;
				this.applyTheme(this.currentTheme);
			} else if (mirror && savedThemeId === undefined && savedAutoTheme === undefined) {
				// IndexedDB に何も無いが、ミラーはある。直前のテーマを捨てずに引き継ぐ
				this.restoreFromMirror(mirror);
			} else {
				this.applyTheme(builtinThemes.light);
			}
			this.writeMirror();
		} catch (error) {
			// 読み込めなかったときは、起動前に適用したテーマのままにする(ライトに戻さない)
			console.error('Failed to load theme settings:', error);
			if (mirror) this.restoreFromMirror(mirror);
		}
	}

	private readMirror(): ThemeMirror | null {
		try {
			return parseMirror(localStorage.getItem(THEME_MIRROR_KEY));
		} catch {
			return null;
		}
	}

	/** 確定したテーマを、起動前スクリプトが読める場所に書く(プレビュー中は呼ばない) */
	private writeMirror() {
		if (typeof localStorage === 'undefined') return;
		try {
			const mirror = buildMirror({
				auto: this.autoTheme,
				current: this.currentTheme,
				light: builtinThemes.light,
				dark: builtinThemes.dark,
				lastSystemDark: this.lastSystemDark
			});
			localStorage.setItem(THEME_MIRROR_KEY, JSON.stringify(mirror));
		} catch {
			// 保存できなくても、通常の保存先(IndexedDB)には書かれる
		}
	}

	private restoreFromMirror(mirror: ThemeMirror) {
		this.autoTheme = mirror.auto;
		if (mirror.auto) {
			this.applySystemTheme();
			return;
		}
		const theme = findTheme(mirror.fixed.id);
		if (theme) this.currentTheme = theme;
		// 画面にはミラーの内容を適用する(カスタムテーマが未読み込みでも見た目は保てる)
		applySnapshot(document.documentElement, theme ? toSnapshot(theme) : mirror.fixed);
	}

	/**
	 * 現在のテーマを取得
	 */
	get theme(): Theme {
		return this.currentTheme;
	}

	/**
	 * ユーザーが作成したテーマ(保存済み)
	 */
	get customThemes(): Theme[] {
		return this.customList;
	}

	/**
	 * 組み込みテーマとカスタムテーマをすべて返す
	 */
	get allThemes(): Theme[] {
		return [...Object.values(builtinThemes), ...this.customList, ...this.packList];
	}

	/** パックが足したテーマ */
	get packThemes(): Theme[] {
		return this.packList;
	}

	/**
	 * 有効なパックのテーマを取り込み直す(パックの有効化・無効化・更新のたびに呼ばれる)。
	 * 使っていたテーマを足していたパックが無効になったら、ライトに戻す
	 */
	async syncPackThemes() {
		this.packList = packRuntime.themes.map(packEntryToTheme);
		this.rebuildRegistry();
		await this.ready;
		if (this.autoTheme) return;
		const pending = this.pendingPackThemeId;
		if (pending) {
			const theme = findTheme(pending);
			if (!theme) return;
			this.pendingPackThemeId = null;
			this.currentTheme = theme;
			this.applyTheme(theme);
			this.writeMirror();
			return;
		}
		if (!this.currentTheme.id.startsWith('pack:')) return;
		const latest = findTheme(this.currentTheme.id);
		if (latest) {
			// パックの更新で色が変わっていたら反映する
			this.currentTheme = latest;
			this.applyTheme(latest);
			this.writeMirror();
		} else {
			await this.setTheme('light');
		}
	}

	/** 拡張の起動が終わったあと、読み込めなかったパックのテーマの設定をライトに戻す */
	async settlePackThemes() {
		await this.ready;
		if (this.pendingPackThemeId && !findTheme(this.pendingPackThemeId)) {
			this.pendingPackThemeId = null;
			if (!this.autoTheme) await this.setTheme('light');
		}
	}

	/**
	 * テーマを設定(組み込み・カスタムのどちらも可)
	 */
	async setTheme(themeId: string) {
		await this.ready;
		const theme = findTheme(themeId);
		if (theme) {
			this.currentTheme = theme;
			this.autoTheme = false;
			this.applyTheme(this.currentTheme);
			this.writeMirror();
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
		await this.ready;
		this.autoTheme = auto;
		if (typeof window !== 'undefined') {
			await idbSet('app-auto-theme', auto);
		}

		if (auto) {
			this.applySystemTheme();
		}
		this.writeMirror();
	}

	/**
	 * カスタムテーマを保存する(同じ ID があれば上書き)。適用はしない
	 */
	async saveCustomTheme(theme: Theme) {
		await this.ready;
		if (!theme.id.startsWith('custom-')) {
			throw new Error('カスタムテーマの ID ではありません');
		}
		const snapshot: Theme = $state.snapshot(theme) as Theme;
		const exists = this.customList.some((t) => t.id === snapshot.id);
		const next = exists
			? this.customList.map((t) => (t.id === snapshot.id ? snapshot : t))
			: [...this.customList, snapshot];
		this.setCustomList(next);

		// 適用中のテーマを編集した場合は、表示も更新する
		if (this.currentTheme.id === snapshot.id) {
			this.currentTheme = snapshot;
			this.applyTheme(snapshot);
			this.writeMirror();
		}
		await this.persistCustomThemes();
	}

	/**
	 * カスタムテーマを削除する。適用中だった場合はライトテーマに戻す
	 */
	async deleteCustomTheme(themeId: string) {
		await this.ready;
		const next = this.customList.filter((t) => t.id !== themeId);
		this.setCustomList(next);
		await this.persistCustomThemes();

		if (this.currentTheme.id === themeId) {
			await this.setTheme('light');
		}
	}

	/**
	 * 保存せずにテーマを一時適用する。null で現在のテーマに戻す
	 */
	previewTheme(theme: Theme | null) {
		this.applyTheme(theme ?? this.currentTheme);
	}

	/**
	 * システムテーマを適用
	 */
	private applySystemTheme() {
		if (typeof window !== 'undefined') {
			// どちらにも一致しない(取得できない)ときは、ライトに確定せず直前の判定を使う
			const prefersDark = resolveSystemDark(
				window.matchMedia('(prefers-color-scheme: dark)').matches,
				window.matchMedia('(prefers-color-scheme: light)').matches,
				this.lastSystemDark
			);
			this.lastSystemDark = prefersDark;
			this.currentTheme = prefersDark ? builtinThemes.dark : builtinThemes.light;
			this.applyTheme(this.currentTheme);
			this.writeMirror();
		}
	}

	/**
	 * カスタムテーマの一覧を差し替え、ID 参照用の登録も合わせる
	 */
	private setCustomList(list: Theme[]) {
		this.customList = list;
		this.rebuildRegistry();
	}

	/** ID 参照用の登録を、組み込み・カスタム・パックのテーマで作り直す */
	private rebuildRegistry() {
		for (const id of Object.keys(themes)) {
			if (!Object.hasOwn(builtinThemes, id)) delete themes[id];
		}
		for (const theme of [...this.customList, ...this.packList]) {
			themes[theme.id] = theme;
		}
	}

	private async persistCustomThemes() {
		if (typeof window !== 'undefined') {
			await idbSet(CUSTOM_THEMES_KEY, $state.snapshot(this.customList));
		}
	}

	/**
	 * テーマをDOMに適用
	 */
	private applyTheme(theme: Theme) {
		if (typeof document === 'undefined') return;

		const root = document.documentElement;

		applySnapshot(root, toSnapshot(theme));
	}

	/**
	 * 自動テーマが有効か
	 */
	get isAutoTheme(): boolean {
		return this.autoTheme;
	}
}

export const themeStore = new ThemeStore();
