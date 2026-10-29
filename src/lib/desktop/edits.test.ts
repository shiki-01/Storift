import { describe, expect, it } from 'vitest';
import {
	appliedDecoration,
	diffChars,
	parseEdits,
	pendingDecoration,
	replaceOnce,
	revertAt,
	splitEdits
} from './edits';

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
		expect(replaceOnce('あいうえお', 'いう', 'イウ')).toEqual({
			ok: true,
			content: 'あイウえお',
			index: 1
		});
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

describe('revertAt', () => {
	it('反映した位置で戻す(削除だけの編集も戻せる)', () => {
		// 「とても」を削除した後
		expect(revertAt('彼はうれしかった', 2, '彼は', '', 'とても')).toEqual({
			ok: true,
			content: '彼はとてもうれしかった',
			index: 2
		});
	});

	it('位置がずれていたら置き換え後の文を探して戻す', () => {
		const r = revertAt('前置き。彼は静かに', 0, '', '静かに', 'そっと');
		expect(r).toMatchObject({ ok: true, content: '前置き。彼はそっと' });
	});

	it('削除で前後が変わっていたら戻さない', () => {
		expect(revertAt('別の文章', 2, '彼は', '', 'とても').ok).toBe(false);
	});
});

describe('エディタ上の色付け', () => {
	it('反映済み: 追加した文字に色を付け、消えた文字の位置を示す', () => {
		const content = '前置き。彼は静かに扉を開けた。';
		const deco = appliedDecoration(content, {
			old: '彼わ静かに戸を開けた。',
			new: '彼は静かに扉を開けた。',
			appliedAt: 4
		});
		expect(deco?.marks).toEqual([
			{ start: 5, end: 6, kind: 'add' },
			{ start: 9, end: 10, kind: 'add' }
		]);
		expect(deco?.ghosts).toEqual([
			{ at: 5, kind: 'del', text: 'わ' },
			{ at: 9, kind: 'del', text: '戸' }
		]);
		expect(deco).toMatchObject({ start: 4, end: content.length });
	});

	it('反映した位置がずれていたら、置き換え後の文を探す', () => {
		const deco = appliedDecoration('追記。彼は。', { old: '彼わ。', new: '彼は。', appliedAt: 0 });
		expect(deco?.start).toBe(3);
	});

	it('未反映: 消す文字に色を付け、入る文字の位置を示す', () => {
		const deco = pendingDecoration('彼わ静かに', { old: '彼わ', new: '彼は' });
		expect(deco?.marks).toEqual([{ start: 1, end: 2, kind: 'del' }]);
		expect(deco?.ghosts).toEqual([{ at: 2, kind: 'add', text: 'は' }]);
	});

	it('見つからない・一意でないときは null', () => {
		expect(pendingDecoration('ああ', { old: 'あ', new: 'い' })).toBeNull();
		expect(appliedDecoration('なし', { old: 'a', new: 'b' })).toBeNull();
	});
});
