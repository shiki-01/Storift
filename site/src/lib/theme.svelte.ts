/** サイトの配色。色の値は app.css にあり、アプリの組み込みテーマと同じ */
export const THEMES = [
	{ id: 'light', name: '和紙', bg: '#f6f4ef', paper: '#fbfaf6', ink: '#2a2925', accent: '#33507a' },
	{ id: 'dark', name: '墨', bg: '#1b1a18', paper: '#201f1c', ink: '#e7e3da', accent: '#9db3d1' },
	{ id: 'sepia', name: '古書', bg: '#f1e8d8', paper: '#f6efe2', ink: '#3b2f22', accent: '#7a4b2a' },
	{ id: 'night', name: '夜', bg: '#141920', paper: '#171c23', ink: '#d8dde3', accent: '#a9bedb' }
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'storift-site-theme';

class SiteTheme {
	/** 明示的に選んだ配色。null なら OS の明暗に従う */
	current = $state<ThemeId | null>(null);

	/** app.html の先頭で当てた配色を読み取る */
	init() {
		this.current = (document.documentElement.dataset.theme as ThemeId | undefined) ?? null;
	}

	set(id: ThemeId) {
		this.current = id;
		document.documentElement.dataset.theme = id;
		try {
			localStorage.setItem(KEY, id);
		} catch {
			// 保存できなくても、この頁を開いている間は効く
		}
	}
}

export const siteTheme = new SiteTheme();
