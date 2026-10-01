/**
 * プロット・キャラクター・設定資料・進捗ページで共有するクラス定義
 * 色はすべて theme トークンで指定する（ダークテーマ対応）
 */

export const fieldClass =
	'w:full px:12 py:10 b:1|solid|theme-border bg:theme-background fg:theme-text r:8 font:16 outline:none focus:b:$(theme.primary) transition:all|.2s font-family:inherit';

export const textareaClass = `${fieldClass} resize:vertical`;

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const buttonBase =
	'px:16 py:8 r:6 font:14 cursor:pointer transition:all|.2s|ease opacity:.5:disabled cursor:not-allowed:disabled';

const buttonVariants: Record<ButtonVariant, string> = {
	primary: 'bg:theme-primary fg:theme-background b:2|solid|theme-text',
	secondary: 'bg:theme-background fg:theme-text b:1|solid|theme-border bg:theme-surface:hover',
	danger: 'bg:theme-background fg:theme-error b:1|solid|theme-border bg:theme-surface:hover'
};

/** ボタンのクラス文字列（button 要素に直接付ける） */
export function buttonClass(variant: ButtonVariant = 'secondary', extra = ''): string {
	return `${buttonBase} ${buttonVariants[variant]} ${extra}`.trim();
}

/** 小さいタグ・バッジ */
export const badgeClass =
	'px:8 py:2 r:6 b:1|solid|theme-border bg:theme-background font:12 fg:theme-text-secondary';
