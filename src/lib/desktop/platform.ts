/**
 * デスクトップ版(Tauri)で動いているか。
 * Web 版・PWA では false になり、デスクトップ専用の機能(Claude Code パネルなど)を出さない。
 */
export function isDesktop(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
