import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyDiffToYText, chunkText, diffText } from './diff';

function applyTo(oldText: string, newText: string): string {
	const doc = new Y.Doc();
	const ytext = doc.getText('t');
	ytext.insert(0, oldText);
	applyDiffToYText(ytext, oldText, newText, 'local');
	return ytext.toString();
}

const isWellFormed = (s: string) => {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff) {
			const n = s.charCodeAt(i + 1);
			if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
			i++;
		} else if (c >= 0xdc00 && c <= 0xdfff) return false;
	}
	return true;
};

describe('diffText', () => {
	it('同一文字列は何もしない', () => {
		expect(diffText('こんにちは', 'こんにちは')).toEqual({ index: 5, deleteCount: 0, insert: '' });
	});

	it('空文字からの挿入と空文字への全削除', () => {
		expect(diffText('', 'abc')).toEqual({ index: 0, deleteCount: 0, insert: 'abc' });
		expect(diffText('abc', '')).toEqual({ index: 0, deleteCount: 3, insert: '' });
		expect(diffText('', '')).toEqual({ index: 0, deleteCount: 0, insert: '' });
	});

	it('日本語の途中への挿入は最小の差分になる', () => {
		expect(diffText('吾輩は猫である', '吾輩は黒い猫である')).toEqual({
			index: 3,
			deleteCount: 0,
			insert: '黒い'
		});
	});

	it('置換と削除', () => {
		expect(diffText('abcdef', 'abXef')).toEqual({ index: 2, deleteCount: 2, insert: 'X' });
		expect(diffText('abcdef', 'abef')).toEqual({ index: 2, deleteCount: 2, insert: '' });
	});

	it('接頭辞と接尾辞が重なる繰り返し文字でも範囲が壊れない', () => {
		expect(applyTo('aaaa', 'aaaaaa')).toBe('aaaaaa');
		expect(applyTo('aaaaaa', 'aaa')).toBe('aaa');
		expect(applyTo('abab', 'ababab')).toBe('ababab');
	});

	it('改行を含む', () => {
		expect(applyTo('一行目\n二行目\n三行目', '一行目\n\n二行目改\n三行目')).toBe(
			'一行目\n\n二行目改\n三行目'
		);
	});

	it('サロゲートペアの途中で分割しない(上位サロゲートが共通)', () => {
		// 😀 = D83D DE00, 😁 = D83D DE01
		const d = diffText('a😀b', 'a😁b');
		expect(d).toEqual({ index: 1, deleteCount: 2, insert: '😁' });
		expect(applyTo('a😀b', 'a😁b')).toBe('a😁b');
	});

	it('サロゲートペアの途中で分割しない(下位サロゲートが共通)', () => {
		const a = String.fromCharCode(0xd83d, 0xde00);
		const b = String.fromCharCode(0xd83c, 0xde00);
		const d = diffText(`x${a}y`, `x${b}y`);
		expect(isWellFormed(d.insert)).toBe(true);
		expect(d.deleteCount).toBe(2);
		expect(applyTo(`x${a}y`, `x${b}y`)).toBe(`x${b}y`);
	});

	it('絵文字の追加・削除は整形式のまま', () => {
		expect(isWellFormed(applyTo('テスト', 'テスト😀😀'))).toBe(true);
		expect(applyTo('😀😀😀', '😀😀')).toBe('😀😀');
		expect(applyTo('👨‍👩‍👧', '👨‍👩')).toBe('👨‍👩');
	});

	it('全置換', () => {
		expect(applyTo('吾輩は猫である', '名前はまだ無い')).toBe('名前はまだ無い');
	});

	it('ファズ: 任意の文字列の組で apply 後に new と一致し、差分は整形式', () => {
		const alphabet = ['a', 'b', 'あ', 'い', '\n', '😀', '😁', '𠮷', 'ab', ' '];
		let seed = 12345;
		const rand = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return seed / 0x100000000;
		};
		const gen = () => {
			const n = Math.floor(rand() * 12);
			let s = '';
			for (let i = 0; i < n; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
			return s;
		};
		for (let i = 0; i < 3000; i++) {
			const oldText = gen();
			// 半分は old の局所的な編集版を new にする
			let newText = gen();
			if (rand() < 0.5 && oldText.length > 0) {
				const p = Math.floor(rand() * oldText.length);
				newText = oldText.slice(0, p) + gen() + oldText.slice(p + Math.floor(rand() * 3));
			}
			const d = diffText(oldText, newText);
			expect(oldText.slice(0, d.index) + d.insert + oldText.slice(d.index + d.deleteCount)).toBe(
				newText
			);
			if (isWellFormed(oldText) && isWellFormed(newText)) {
				expect(isWellFormed(d.insert)).toBe(true);
				expect(isWellFormed(oldText.slice(d.index, d.index + d.deleteCount))).toBe(true);
			}
			expect(applyTo(oldText, newText)).toBe(newText);
		}
	});
});

describe('chunkText / 巨大な挿入', () => {
	it('サロゲートペアの途中で切らずに分割し、連結すると元に戻る', () => {
		const text = '😀'.repeat(11);
		const chunks = chunkText(text, 5);
		expect(chunks.join('')).toBe(text);
		for (const c of chunks) {
			expect(c.length).toBeLessThanOrEqual(5);
			expect(isWellFormed(c)).toBe(true);
		}
	});

	it('巨大な挿入は複数の更新に分かれ、結果は同じ', () => {
		const doc = new Y.Doc();
		const ytext = doc.getText('t');
		const updates: Uint8Array[] = [];
		doc.on('update', (u: Uint8Array) => updates.push(u));
		const big = 'あ'.repeat(120_000);
		applyDiffToYText(ytext, '', big, 'local');
		expect(ytext.toString()).toBe(big);
		expect(updates.length).toBeGreaterThanOrEqual(3);
	});
});

describe('applyDiffToYText', () => {
	it('origin が渡る / 変更が無ければ更新を出さない', () => {
		const doc = new Y.Doc();
		const ytext = doc.getText('t');
		const origins: unknown[] = [];
		doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
		expect(applyDiffToYText(ytext, '', 'abc', 'local')).toBe(true);
		expect(applyDiffToYText(ytext, 'abc', 'abc', 'local')).toBe(false);
		expect(origins).toEqual(['local']);
	});
});
