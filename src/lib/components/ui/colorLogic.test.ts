import { describe, it, expect } from 'vitest';
import { hexToHsv, hsvToHex, normalizeHex, readableOn } from './colorLogic';

describe('normalizeHex', () => {
	it('3 桁・# なし・大文字を #rrggbb にそろえる', () => {
		expect(normalizeHex('#ABC')).toBe('#aabbcc');
		expect(normalizeHex('3b82f6')).toBe('#3b82f6');
		expect(normalizeHex(' #3B82F6 ')).toBe('#3b82f6');
	});
	it('不正な入力は null', () => {
		for (const bad of ['', '#12', '#12345', 'red', '#gggggg', '#1234567']) {
			expect(normalizeHex(bad)).toBeNull();
		}
	});
});

describe('hex <-> hsv', () => {
	it('主要な色が往復で変わらない', () => {
		for (const hex of [
			'#ff0000',
			'#00ff00',
			'#0000ff',
			'#ffffff',
			'#000000',
			'#3b82f6',
			'#6b7280'
		]) {
			expect(hsvToHex(hexToHsv(hex))).toBe(hex);
		}
	});
	it('赤の HSV', () => {
		expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
	});
	it('範囲外は丸める', () => {
		expect(hsvToHex({ h: 400, s: 2, v: -1 })).toBe('#000000');
	});
});

describe('readableOn', () => {
	it('明るい色には黒、暗い色には白', () => {
		expect(readableOn('#ffff00')).toBe('#000000');
		expect(readableOn('#1e3a8a')).toBe('#ffffff');
	});
});
