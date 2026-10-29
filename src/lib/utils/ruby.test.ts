import { describe, it, expect } from 'vitest';
import { rubyToHtml } from './ruby';

describe('rubyToHtml', () => {
	it('ルビを ruby 要素に変換する', () => {
		expect(rubyToHtml('｜漢字《かんじ》')).toBe('<ruby>漢字<rt>かんじ</rt></ruby>');
	});

	it('本文中の HTML はエスケープする', () => {
		expect(rubyToHtml('a <b> & "c"')).toBe('a &lt;b&gt; &amp; &quot;c&quot;');
		expect(rubyToHtml('<img src=x onerror=alert(1)>')).not.toContain('<img');
	});

	it('ルビ文字もエスケープする', () => {
		expect(rubyToHtml('｜漢字《<i>》')).toBe('<ruby>漢字<rt>&lt;i&gt;</rt></ruby>');
	});
});
