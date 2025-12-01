/**
 * プレビュー設定の型定義
 */

export type WritingMode = 'vertical' | 'horizontal';
export type TextOrientation = 'upright' | 'mixed' | 'sideways';
export type ViewMode = 'split' | 'editor' | 'preview';

export interface PreviewSettings {
	// 表示モード
	writingMode: WritingMode;
	textOrientation: TextOrientation;
	
	// フォント設定
	fontSize: number; // px
	lineHeight: number; // 倍率
	letterSpacing: number; // em
	fontFamily: string;
	
	// レイアウト
	lineLength: number; // 1行の最大文字数（縦書き時）
	linesPerPage: number; // 1ページの行数
	
	// 原稿用紙モード
	manuscriptMode: boolean;
	manuscriptColumns: 20 | 25 | 30; // 1行の文字数
	manuscriptRows: 10 | 20; // 行数
	
	// 表示オプション
	showRuby: boolean;
	showBouten: boolean;
	showLineNumbers: boolean;
	showPageNumbers: boolean;
}

export const defaultPreviewSettings: PreviewSettings = {
	writingMode: 'vertical',
	textOrientation: 'mixed',
	fontSize: 16,
	lineHeight: 1.8,
	letterSpacing: 0.05,
	fontFamily: '"Noto Serif JP", serif',
	lineLength: 40,
	linesPerPage: 20,
	manuscriptMode: false,
	manuscriptColumns: 20,
	manuscriptRows: 20,
	showRuby: true,
	showBouten: true,
	showLineNumbers: false,
	showPageNumbers: true,
};
