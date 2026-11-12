import { describe, expect, it } from 'vitest';
import { MAX_PRESENCE_TEXT, renderTemplate, truncateText, usesPlaceholder } from './template';

describe('renderTemplate', () => {
	it('プレースホルダーを値に置き換える', () => {
		expect(renderTemplate('{page}', { page: '執筆中' })).toBe('執筆中');
		expect(renderTemplate('{chars} 字', { chars: '+1,234' })).toBe('+1,234 字');
		expect(renderTemplate('{page} / {total} 字', { page: 'ホーム', total: '12,345' })).toBe(
			'ホーム / 12,345 字'
		);
	});

	it('作品名が空なら、括弧と助詞ごと省く(「『』を」を残さない)', () => {
		const t = '『{project}』を{page}';
		expect(renderTemplate(t, { project: '', page: '執筆中' })).toBe('執筆中');
		expect(renderTemplate(t, { page: '執筆中' })).toBe('執筆中');
		expect(renderTemplate(t, { project: '月の庭', page: '執筆中' })).toBe('『月の庭』を執筆中');
		expect(renderTemplate('「{project}」の{page}', { project: '  ', page: '執筆中' })).toBe(
			'執筆中'
		);
	});

	it('空の値のあとに残る区切りを整える', () => {
		expect(renderTemplate('{page} - {project}', { page: '執筆中' })).toBe('執筆中');
		expect(renderTemplate('{project} ・ {page}', { page: '執筆中' })).toBe('執筆中');
		expect(renderTemplate('{page} / {total} 字', { page: 'ホーム' })).toBe('ホーム');
		expect(renderTemplate('{page}({project})', { page: '執筆中' })).toBe('執筆中');
	});

	it('空の {chars} は単位ごと省く', () => {
		expect(renderTemplate('{chars} 字', {})).toBe('');
		expect(renderTemplate('{page}({chars}字)', { page: '執筆中' })).toBe('執筆中');
	});

	it('知らないプレースホルダーはそのまま残す', () => {
		expect(renderTemplate('{foo} {page}', { page: '執筆中' })).toBe('{foo} 執筆中');
		expect(renderTemplate('{time}', {})).toBe('{time}');
	});

	it('空白を整理する', () => {
		expect(renderTemplate('  {page}   です\n続き ', { page: 'A' })).toBe('A です 続き');
	});

	it('128 文字(コードポイント)に切り詰める', () => {
		const long = 'あ'.repeat(300);
		const out = renderTemplate('{project}', { project: long });
		expect([...out]).toHaveLength(MAX_PRESENCE_TEXT);
		expect(out.endsWith('…')).toBe(true);
		// サロゲートペアを壊さない
		const emoji = '😀'.repeat(200);
		expect([...truncateText(emoji)]).toHaveLength(MAX_PRESENCE_TEXT);
		expect(truncateText('短い')).toBe('短い');
	});

	it('値に含まれる {…} は再評価しない', () => {
		expect(renderTemplate('{project}', { project: '{page}' })).toBe('{page}');
	});
});

describe('usesPlaceholder', () => {
	it('使っているものだけ true', () => {
		expect(usesPlaceholder('{page} {total}', 'total')).toBe(true);
		expect(usesPlaceholder('{page}', 'total')).toBe(false);
	});
});
