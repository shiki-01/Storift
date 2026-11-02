import { describe, expect, it } from 'vitest';
import { previewToHtml, rubyToHtml } from './ruby';

describe('previewToHtml', () => {
	const attack = '<img src=x onerror=alert(1)>';

	it.each([
		[true, true],
		[true, false],
		[false, true],
		[false, false]
	])('本文中のHTMLをエスケープする(ルビ: %s, 傍点: %s)', (showRuby, showBouten) => {
		const html = previewToHtml(`${attack}《《${attack}》》`, showRuby, showBouten);
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
	});

	it('ルビ・傍点・段落をHTMLにする', () => {
		expect(previewToHtml('漢字《かんじ》と《《強調》》\n\n次', true, true)).toBe(
			'<p><ruby>漢字<rt>かんじ</rt></ruby>と<span class="bouten">強調</span></p><p class="empty-line">&nbsp;</p><p>次</p>'
		);
	});

	it('無効にした記法は記号を除いて本文だけ残す', () => {
		expect(previewToHtml('漢字《かんじ》と《《強調》》', false, false)).toBe('<p>漢字と強調</p>');
	});
});

describe('rubyToHtml', () => {
	it('ルビと傍点をHTMLに変換する', () => {
		expect(rubyToHtml('漢字《かんじ》と《《強調》》')).toBe(
			'<ruby>漢字<rt>かんじ</rt></ruby>と<span class="bouten">強調</span>'
		);
	});

	it('本文中のHTMLをエスケープする', () => {
		expect(rubyToHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
	});

	it('親文字・ルビ・傍点の中のHTMLもエスケープする', () => {
		expect(rubyToHtml('｜<b>《<i>》')).toBe('<ruby>&lt;b&gt;<rt>&lt;i&gt;</rt></ruby>');
		expect(rubyToHtml('《《<b>》》')).toBe('<span class="bouten">&lt;b&gt;</span>');
	});
});
