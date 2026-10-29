import { describe, expect, it } from 'vitest';
import { diffChars, parseEdits, replaceOnce, splitEdits } from './edits';

const block = (file: string, from: string, to: string) =>
	`<storift-edit file="${file}">\n<old>${from}</old>\n<new>${to}</new>\n</storift-edit>`;

describe('splitEdits', () => {
	it('本文と編集案に分ける', () => {
		const text = `誤字を直します。\n\n${block('a.md', 'こんにちわ', 'こんにちは')}\n\n以上です。`;
		const { segments, pending } = splitEdits(text);
		expect(pending).toBe(false);
		expect(segments.map((s) => s.kind)).toEqual(['markdown', 'edit', 'markdown']);
		expect(parseEdits(text)).toEqual([{ file: 'a.md', old: 'こんにちわ', new: 'こんにちは' }]);
	});

	it('書きかけの編集案は隠して pending にする', () => {
		const { segments, pending } = splitEdits('直します。\n<storift-edit file="a.md">\n<old>こん');
		expect(pending).toBe(true);
		expect(segments).toEqual([{ kind: 'markdown', text: '直します。\n' }]);
	});

	it('タグ内側の前後の改行 1 つは除く', () => {
		const text =
			'<storift-edit file="a.md"><old>\n一行目\n二行目\n</old><new>\n一行\n</new></storift-edit>';
		expect(parseEdits(text)[0]).toMatchObject({ old: '一行目\n二行目', new: '一行' });
	});
});

describe('replaceOnce', () => {
	it('1 か所だけなら置き換える', () => {
		expect(replaceOnce('あいうえお', 'いう', 'イウ')).toEqual({ ok: true, content: 'あイウえお' });
	});

	it('見つからない・複数あるときは失敗', () => {
		expect(replaceOnce('あいう', 'か', 'き').ok).toBe(false);
		expect(replaceOnce('あああ', 'あ', 'い').ok).toBe(false);
		expect(replaceOnce('あ', '', 'い').ok).toBe(false);
	});
});

describe('diffChars', () => {
	it('変わった文字だけを差分にする', () => {
		expect(diffChars('こんにちわ世界', 'こんにちは世界')).toEqual([
			{ kind: 'same', text: 'こんにち' },
			{ kind: 'del', text: 'わ' },
			{ kind: 'add', text: 'は' },
			{ kind: 'same', text: '世界' }
		]);
	});

	it('差分を組み立て直すと元と新が得られる', () => {
		const a = '彼は静かに扉を開けた。';
		const b = '彼女はそっと扉を開いた。';
		const ops = diffChars(a, b);
		const rebuild = (skip: 'add' | 'del') =>
			ops
				.filter((o) => o.kind !== skip)
				.map((o) => o.text)
				.join('');
		expect(rebuild('add')).toBe(a);
		expect(rebuild('del')).toBe(b);
	});
});
