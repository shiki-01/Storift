import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
	EditorBinding,
	caretFromDelta,
	mapIndexThrough,
	type EditorAdapter,
	type Scheduler,
	type TextSelection
} from './editorBinding';
import { trackLocalGrowth } from './progress';

/** DOM の代わりに文字列と選択だけを持つアダプタ */
class MockAdapter implements EditorAdapter {
	text = '';
	selection: TextSelection | null = null;
	writes = 0;
	attached = true;
	isAttached = () => this.attached;
	getText = () => this.text;
	setText(text: string) {
		this.text = text;
		this.writes++;
		// 実際の DOM と同じく、書き換えると選択は失われる
		this.selection = null;
	}
	getSelection = () => (this.selection ? { ...this.selection } : null);
	setSelection(start: number, end: number) {
		this.selection = { start, end };
	}

	/** ユーザーの入力(DOM を書き換えてキャレットを置く) */
	edit(index: number, deleteCount: number, insert: string) {
		this.text = this.text.slice(0, index) + insert + this.text.slice(index + deleteCount);
		const at = index + insert.length;
		this.selection = { start: at, end: at };
	}
}

/** 手動で進めるスケジューラ(requestAnimationFrame の代わり) */
class ManualScheduler implements Scheduler {
	private queue: (() => void)[] = [];
	request(callback: () => void) {
		this.queue.push(callback);
		return () => {
			this.queue = this.queue.filter((c) => c !== callback);
		};
	}
	get pending() {
		return this.queue.length;
	}
	frame() {
		const run = this.queue;
		this.queue = [];
		for (const callback of run) callback();
	}
}

interface Setup {
	ydoc: Y.Doc;
	ytext: Y.Text;
	adapter: MockAdapter;
	scheduler: ManualScheduler;
	binding: EditorBinding;
	doc: { ydoc: Y.Doc; ytext: Y.Text; readOnly: boolean };
	texts: string[];
}

function setup(initial = '', readOnly = false, clientID?: number): Setup {
	const ydoc = new Y.Doc();
	if (clientID !== undefined) ydoc.clientID = clientID;
	const ytext = ydoc.getText('content');
	if (initial) ytext.insert(0, initial);
	const adapter = new MockAdapter();
	const scheduler = new ManualScheduler();
	const doc = { ydoc, ytext, readOnly };
	const texts: string[] = [];
	const binding = new EditorBinding({
		doc,
		adapter,
		scheduler,
		onText: (text) => texts.push(text)
	});
	return { ydoc, ytext, adapter, scheduler, binding, doc, texts };
}

/** 別の文書で行われた変更(リモート)を届ける */
function remoteEdit(target: Setup, fn: (text: Y.Text) => void): void {
	const other = new Y.Doc();
	Y.applyUpdate(other, Y.encodeStateAsUpdate(target.ydoc));
	let diff: Uint8Array | null = null;
	const before = Y.encodeStateVector(other);
	other.transact(() => fn(other.getText('content')));
	diff = Y.encodeStateAsUpdate(other, before);
	Y.applyUpdate(target.ydoc, diff, 'remote');
}

describe('mapIndexThrough / caretFromDelta', () => {
	it('挿入・削除を通してインデックスを写す', () => {
		const insertAt0 = [[{ insert: 'XX' }]];
		expect(mapIndexThrough(3, insertAt0)).toBe(5);
		const deleteRange = [[{ retain: 1 }, { delete: 2 }]];
		expect(mapIndexThrough(5, deleteRange)).toBe(3);
		// 削除範囲の中は削除の先頭に寄る
		expect(mapIndexThrough(2, deleteRange)).toBe(1);
	});

	it('同じ位置への挿入は assoc で前後が決まる', () => {
		const delta = [[{ retain: 3 }, { insert: 'ab' }]];
		expect(mapIndexThrough(3, delta, 1)).toBe(5);
		expect(mapIndexThrough(3, delta, -1)).toBe(3);
	});

	it('delta の変更位置を返す', () => {
		expect(caretFromDelta([{ retain: 2 }, { insert: 'abc' }])).toBe(5);
		expect(caretFromDelta([{ retain: 2 }, { delete: 3 }])).toBe(2);
		expect(caretFromDelta([{ retain: 2 }])).toBeNull();
	});
});

describe('ローカル→Y', () => {
	it('初期表示で DOM を Y の本文に合わせる', () => {
		const s = setup('こんにちは');
		expect(s.adapter.text).toBe('こんにちは');
	});

	it('通常の入力が Y に反映され、DOM は書き換えない', () => {
		const s = setup('abcdef');
		const writes = s.adapter.writes;
		s.adapter.edit(3, 0, 'X');
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('abcXdef');
		expect(s.adapter.writes).toBe(writes);
		expect(s.texts.at(-1)).toBe('abcXdef');
		expect(s.scheduler.pending).toBe(0);
	});

	it('origin は local', () => {
		const s = setup('abc');
		const origins: unknown[] = [];
		s.ydoc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
		s.adapter.edit(3, 0, 'd');
		s.binding.handleInput();
		expect(origins).toEqual(['local']);
	});

	it('削除と置換が反映される', () => {
		const s = setup('abcdef');
		s.adapter.edit(1, 2, '');
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('adef');
		s.adapter.edit(0, 2, 'ZZZ');
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('ZZZef');
	});

	it('改行を含む本文を編集できる', () => {
		const s = setup('一行目\n二行目\n\n四行目');
		s.adapter.edit(4, 0, '追加');
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('一行目\n追加二行目\n\n四行目');
		s.adapter.edit(s.adapter.text.length, 0, '\n');
		s.binding.handleInput();
		expect(s.ytext.toString().endsWith('四行目\n')).toBe(true);
	});

	it('サロゲートペアを壊さずに編集できる', () => {
		const s = setup('a😀b');
		s.adapter.edit(1, 2, '😎');
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('a😎b');
		s.adapter.edit(3, 0, '𠮷');
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('a😎𠮷b');
		// 同じ上位サロゲートを持つ絵文字への置換でもペアが割れない
		s.adapter.edit(1, 2, '😁');
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('a😁𠮷b');
		expect(s.ytext.toString().isWellFormed()).toBe(true);
	});

	it('貼り付け(insertText)は選択範囲を置き換え、キャレットを後ろに置く', () => {
		const s = setup('abcdef');
		s.adapter.selection = { start: 1, end: 3 };
		expect(s.binding.insertText('XYZ\n')).toBe(true);
		expect(s.ytext.toString()).toBe('aXYZ\ndef');
		expect(s.adapter.text).toBe('aXYZ\ndef');
		expect(s.adapter.selection).toEqual({ start: 5, end: 5 });
	});

	it('ドロップ: 移動と挿入', () => {
		const s = setup('abcdef');
		// "bc" を末尾へ移動
		expect(s.binding.dropText('bc', 6, { start: 1, end: 3 })).toBe(true);
		expect(s.ytext.toString()).toBe('adefbc');
		expect(s.adapter.text).toBe('adefbc');
		// 移動元の範囲内へは落とせない
		expect(s.binding.dropText('de', 2, { start: 1, end: 3 })).toBe(false);
		// 外部のテキスト
		expect(s.binding.dropText('!!', 0)).toBe(true);
		expect(s.ytext.toString()).toBe('!!adefbc');
	});

	it('beforeinput: 履歴は止めて UndoManager に回し、通常の入力は止めない', () => {
		const s = setup('abc');
		expect(s.binding.handleBeforeInput('insertText')).toBe(false);
		expect(s.binding.handleBeforeInput('insertParagraph')).toBe(false);
		expect(s.binding.handleBeforeInput('deleteContentBackward')).toBe(false);
		expect(s.binding.handleBeforeInput('historyUndo')).toBe(true);
	});
});

describe('リモート→DOM', () => {
	it('リモートの更新は requestAnimationFrame でまとめて DOM に書く', () => {
		const s = setup('abcdef');
		const writes = s.adapter.writes;
		remoteEdit(s, (t) => t.insert(0, 'X'));
		remoteEdit(s, (t) => t.insert(0, 'Y'));
		remoteEdit(s, (t) => t.delete(0, 1));
		expect(s.adapter.writes).toBe(writes);
		expect(s.scheduler.pending).toBe(1);
		s.scheduler.frame();
		expect(s.adapter.writes).toBe(writes + 1);
		expect(s.adapter.text).toBe(s.ytext.toString());
		expect(s.adapter.text).toBe('Xabcdef');
	});

	it('選択範囲(キャレット)を更新後に復元する', () => {
		const s = setup('abcdef');
		s.adapter.selection = { start: 3, end: 3 };
		remoteEdit(s, (t) => t.insert(0, '前置き'));
		s.scheduler.frame();
		expect(s.adapter.text).toBe('前置きabcdef');
		expect(s.adapter.selection).toEqual({ start: 6, end: 6 });
	});

	it('範囲選択も写す。キャレットより後ろの変更では動かない', () => {
		const s = setup('0123456789');
		s.adapter.selection = { start: 2, end: 5 };
		remoteEdit(s, (t) => t.insert(8, '後ろ'));
		s.scheduler.frame();
		expect(s.adapter.selection).toEqual({ start: 2, end: 5 });
		remoteEdit(s, (t) => t.delete(0, 1));
		s.scheduler.frame();
		expect(s.adapter.selection).toEqual({ start: 1, end: 4 });
	});

	it('フォーカスが無い(選択が無い)ときは選択を作らない', () => {
		const s = setup('abc');
		remoteEdit(s, (t) => t.insert(0, 'X'));
		s.scheduler.frame();
		expect(s.adapter.selection).toBeNull();
	});

	it('フレームの前に入力があっても、リモートの変更を消さない', () => {
		const s = setup('abcdef');
		remoteEdit(s, (t) => t.insert(0, 'XX')); // DOM にはまだ無い
		s.adapter.edit(3, 0, 'Q'); // ユーザーは古い DOM の 3 文字目に入力した
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('XXabcQdef');
		expect(s.adapter.text).toBe('XXabcQdef');
		expect(s.adapter.selection).toEqual({ start: 6, end: 6 });
	});

	it('サロゲートペアと改行を含む本文へのリモートの挿入', () => {
		const s = setup('😀\n日本語');
		s.adapter.selection = { start: 3, end: 3 };
		remoteEdit(s, (t) => t.insert(3, '🎉'));
		s.scheduler.frame();
		expect(s.adapter.text).toBe('😀\n🎉日本語');
		expect(s.adapter.selection).toEqual({ start: 5, end: 5 });
	});

	it('DOM が外れている間は書かず、resync で合わせる', () => {
		const s = setup('abc');
		s.adapter.attached = false;
		const writes = s.adapter.writes;
		remoteEdit(s, (t) => t.insert(3, 'd'));
		s.scheduler.frame();
		expect(s.adapter.writes).toBe(writes);
		s.adapter.attached = true;
		s.binding.resync();
		expect(s.adapter.text).toBe('abcd');
	});
});

describe('IME', () => {
	it('変換中の入力は Y に入れず、確定時に反映する', () => {
		const s = setup('ABCDEF');
		s.adapter.selection = { start: 3, end: 3 };
		s.binding.compositionStart();
		s.adapter.edit(3, 0, 'か'); // 変換中の文字
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('ABCDEF');
		s.adapter.edit(3, 1, 'かん');
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('ABCDEF');
		s.adapter.edit(3, 2, '漢');
		s.binding.compositionEnd();
		expect(s.ytext.toString()).toBe('ABC漢DEF');
		expect(s.adapter.text).toBe('ABC漢DEF');
	});

	it('変換中にリモートがキャレットより前へ挿入しても、確定した文字は正しい位置に入る', () => {
		const s = setup('ABCDEF');
		s.adapter.selection = { start: 3, end: 3 };
		s.binding.compositionStart();
		s.adapter.edit(3, 0, 'か');
		remoteEdit(s, (t) => t.insert(0, 'XX'));
		// 変換中は DOM に書かない
		s.scheduler.frame();
		expect(s.adapter.text).toBe('ABCかDEF');
		s.adapter.edit(3, 1, '蚊');
		s.binding.compositionEnd();
		expect(s.ytext.toString()).toBe('XXABC蚊DEF');
		expect(s.adapter.text).toBe('XXABC蚊DEF');
		expect(s.adapter.selection).toEqual({ start: 6, end: 6 });
	});

	it('変換中にリモートが後ろへ挿入・前を削除しても追従する', () => {
		const s = setup('0123456789');
		s.adapter.selection = { start: 5, end: 5 };
		s.binding.compositionStart();
		s.adapter.edit(5, 0, 'あ');
		remoteEdit(s, (t) => t.delete(0, 2));
		remoteEdit(s, (t) => t.insert(t.length, '末尾'));
		s.binding.compositionEnd();
		expect(s.ytext.toString()).toBe('234あ56789末尾');
	});

	it('選択範囲を変換で置き換える(リモートの挿入あり)', () => {
		const s = setup('ABCDEF');
		s.adapter.selection = { start: 2, end: 4 };
		s.binding.compositionStart();
		s.adapter.edit(2, 2, 'ひ');
		remoteEdit(s, (t) => t.insert(0, '>>'));
		s.adapter.edit(2, 1, '碑');
		s.binding.compositionEnd();
		expect(s.ytext.toString()).toBe('>>AB碑EF');
	});

	it('置き換え範囲にリモートの編集が入ったときは削除せず挿入だけにして、破損させない', () => {
		const s = setup('ABCDEF');
		s.adapter.selection = { start: 2, end: 4 };
		s.binding.compositionStart();
		s.adapter.edit(2, 2, '碑');
		remoteEdit(s, (t) => {
			t.delete(2, 1);
			t.insert(2, 'zz');
		});
		s.binding.compositionEnd();
		const result = s.ytext.toString();
		expect(result).toContain('碑');
		expect(result).toContain('zz');
		expect(result.startsWith('AB')).toBe(true);
		expect(result.endsWith('EF')).toBe(true);
	});

	it('自動修正でキャレットから離れた位置が変わっても、本文を壊さない', () => {
		const s = setup('teh cat sat');
		s.adapter.selection = { start: 11, end: 11 };
		s.binding.compositionStart();
		s.adapter.edit(0, 3, 'the'); // 先頭の綴りを自動修正
		s.adapter.edit(11, 0, 'あ');
		s.binding.compositionEnd();
		expect(s.ytext.toString()).toBe('the cat satあ');
	});

	it('変換を取り消したら、保留していたリモートの変更を反映する', () => {
		const s = setup('abc');
		s.adapter.selection = { start: 3, end: 3 };
		s.binding.compositionStart();
		s.adapter.edit(3, 0, 'x');
		remoteEdit(s, (t) => t.insert(0, 'R'));
		s.adapter.edit(3, 1, '');
		s.binding.compositionEnd();
		expect(s.adapter.text).toBe('Rabc');
		expect(s.ytext.toString()).toBe('Rabc');
	});

	it('変換中はリモートの DOM 反映も undo も保留する', () => {
		const s = setup('abc');
		s.adapter.selection = { start: 3, end: 3 };
		s.binding.compositionStart();
		const writes = s.adapter.writes;
		remoteEdit(s, (t) => t.insert(0, 'R'));
		s.scheduler.frame();
		expect(s.adapter.writes).toBe(writes);
		expect(s.binding.undo()).toBe(false);
		expect(s.binding.isComposing).toBe(true);
	});

	it('2 回目の変換も正しく扱う', () => {
		const s = setup('ab');
		s.adapter.selection = { start: 2, end: 2 };
		for (const ch of ['あ', 'い']) {
			s.binding.compositionStart();
			s.adapter.edit(s.adapter.text.length, 0, ch);
			s.binding.compositionEnd();
		}
		expect(s.ytext.toString()).toBe('abあい');
	});
});

describe('undo / redo', () => {
	it('自分の編集だけを戻し、他者の編集は戻さない', () => {
		const s = setup('base');
		s.adapter.edit(4, 0, '-mine');
		s.binding.handleInput();
		remoteEdit(s, (t) => t.insert(0, 'THEIRS-'));
		s.scheduler.frame();
		expect(s.ytext.toString()).toBe('THEIRS-base-mine');

		expect(s.binding.undo()).toBe(true);
		expect(s.ytext.toString()).toBe('THEIRS-base');
		expect(s.adapter.text).toBe('THEIRS-base');
		// 他者の編集は履歴に無い
		expect(s.binding.canUndo()).toBe(false);
		expect(s.binding.undo()).toBe(false);
		expect(s.ytext.toString()).toBe('THEIRS-base');

		expect(s.binding.redo()).toBe(true);
		expect(s.ytext.toString()).toBe('THEIRS-base-mine');
		expect(s.adapter.text).toBe('THEIRS-base-mine');
	});

	it('undo 後のキャレットは戻した場所に置く', () => {
		const s = setup('abc');
		s.adapter.edit(3, 0, 'XYZ');
		s.binding.handleInput();
		s.binding.undo();
		expect(s.adapter.selection).toEqual({ start: 3, end: 3 });
	});

	it('undo の結果は local として扱われ、リモート扱いにならない', () => {
		const s = setup('abc');
		s.adapter.edit(3, 0, 'd');
		s.binding.handleInput();
		const origins: unknown[] = [];
		s.ydoc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
		s.binding.undo();
		expect(origins).toHaveLength(1);
		expect(origins[0]).not.toBe('remote');
	});

	it('リモートの編集で undo のスタックが壊れない', () => {
		const s = setup('hello');
		s.adapter.edit(5, 0, ' world');
		s.binding.handleInput();
		remoteEdit(s, (t) => t.insert(0, '>> '));
		s.scheduler.frame();
		s.binding.undo();
		expect(s.ytext.toString()).toBe('>> hello');
	});

	it('読み取り専用では undo できない', () => {
		const s = setup('abc', true);
		expect(s.binding.undo()).toBe(false);
		expect(s.binding.handleBeforeInput('insertText')).toBe(true);
	});

	it('外部からの置き換え(執筆支援など)も undo の対象になる', () => {
		const s = setup('abc');
		expect(s.binding.setExternalText('abc!')).toBe(true);
		s.scheduler.frame();
		expect(s.adapter.text).toBe('abc!');
		s.binding.undo();
		expect(s.ytext.toString()).toBe('abc');
		expect(s.adapter.text).toBe('abc');
	});
});

describe('viewer(読み取り専用)', () => {
	it('入力は Y に書かれず、DOM は Y に戻る', () => {
		const s = setup('abc', true);
		const before = Y.encodeStateAsUpdate(s.ydoc);
		s.adapter.edit(3, 0, 'x');
		s.binding.handleInput();
		expect(s.ytext.toString()).toBe('abc');
		expect(s.adapter.text).toBe('abc');
		expect(Y.encodeStateAsUpdate(s.ydoc)).toEqual(before);
	});

	it('貼り付け・ドロップ・外部置き換えは何もしない', () => {
		const s = setup('abc', true);
		expect(s.binding.insertText('x')).toBe(false);
		expect(s.binding.dropText('x', 0)).toBe(false);
		expect(s.binding.setExternalText('zzz')).toBe(false);
		expect(s.ytext.toString()).toBe('abc');
	});

	it('リモートの更新は反映する', () => {
		const s = setup('abc', true);
		remoteEdit(s, (t) => t.insert(3, 'd'));
		s.scheduler.frame();
		expect(s.adapter.text).toBe('abcd');
	});

	it('変換が確定しても Y には書かない', () => {
		const s = setup('abc', true);
		s.adapter.selection = { start: 3, end: 3 };
		s.binding.compositionStart();
		s.adapter.edit(3, 0, 'あ');
		s.binding.compositionEnd();
		expect(s.ytext.toString()).toBe('abc');
		expect(s.adapter.text).toBe('abc');
	});
});

describe('2 つの文書の収束', () => {
	/** 2 つの文書を模擬チャネルでつなぐ(送信は手動で配送する) */
	function pair() {
		const a = setup('', false, 1);
		const b = setup('', false, 2);
		// 共通の初期状態
		const seed = new Y.Doc();
		seed.getText('content').insert(0, '吾輩は猫である。\n名前はまだ無い。\n');
		Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(seed), 'restore');
		Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(seed), 'restore');
		a.binding.resync();
		b.binding.resync();
		const outbox: { to: Setup; update: Uint8Array }[] = [];
		for (const [from, to] of [
			[a, b],
			[b, a]
		] as const) {
			from.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
				if (origin === 'remote' || origin === 'restore') return;
				outbox.push({ to, update });
			});
		}
		const deliver = () => {
			for (const { to, update } of outbox.splice(0)) Y.applyUpdate(to.ydoc, update, 'remote');
			a.scheduler.frame();
			b.scheduler.frame();
		};
		return { a, b, deliver };
	}

	it('同時に別の位置へ入力しても、両方の文書が同じ本文に収束する', () => {
		const { a, b, deliver } = pair();
		a.adapter.edit(0, 0, 'A:');
		a.binding.handleInput();
		b.adapter.edit(b.adapter.text.length, 0, ':B');
		b.binding.handleInput();
		deliver();
		expect(a.ytext.toString()).toBe(b.ytext.toString());
		expect(a.adapter.text).toBe(b.adapter.text);
		expect(a.adapter.text).toContain('A:');
		expect(a.adapter.text).toContain(':B');
	});

	it('同じ位置への同時入力も収束し、双方の入力が残る', () => {
		const { a, b, deliver } = pair();
		a.adapter.edit(4, 0, 'あああ');
		a.binding.handleInput();
		b.adapter.edit(4, 0, 'いいい');
		b.binding.handleInput();
		deliver();
		expect(a.adapter.text).toBe(b.adapter.text);
		expect(a.adapter.text).toContain('あああ');
		expect(a.adapter.text).toContain('いいい');
	});

	it('A が変換中に B が前へ入力しても、双方が収束し確定文字が残る', () => {
		const { a, b, deliver } = pair();
		a.adapter.selection = { start: 4, end: 4 };
		a.binding.compositionStart();
		a.adapter.edit(4, 0, 'ね');
		b.adapter.edit(0, 0, '【前】');
		b.binding.handleInput();
		deliver();
		expect(a.adapter.text).toContain('ね'); // 変換中の DOM は触らない
		a.adapter.edit(4, 1, '猫');
		a.binding.compositionEnd();
		deliver();
		expect(a.ytext.toString()).toBe('【前】吾輩は猫猫である。\n名前はまだ無い。\n');
		expect(a.ytext.toString()).toBe(b.ytext.toString());
		expect(a.adapter.text).toBe(b.adapter.text);
		expect(a.adapter.text.indexOf('【前】')).toBe(0);
	});

	it('A の undo は A の編集だけを戻し、B にも伝わる', () => {
		const { a, b, deliver } = pair();
		a.adapter.edit(0, 0, 'A');
		a.binding.handleInput();
		b.adapter.edit(b.adapter.text.length, 0, 'B');
		b.binding.handleInput();
		deliver();
		a.binding.undo();
		deliver();
		expect(a.ytext.toString()).toBe(b.ytext.toString());
		expect(a.adapter.text.startsWith('A')).toBe(false);
		expect(a.adapter.text.endsWith('B')).toBe(true);
		expect(b.adapter.text).toBe(a.adapter.text);
	});

	it('ランダムな同時編集でも収束する', () => {
		const { a, b, deliver } = pair();
		let seed = 12345;
		const rand = (n: number) => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		for (let round = 0; round < 40; round++) {
			for (const s of [a, b]) {
				const text = s.adapter.text;
				const len = text.length;
				// サロゲートペアの途中は選ばない(ブラウザの編集もペアの途中では起きない)
				const boundary = (i: number) => {
					const code = text.charCodeAt(i);
					return i > 0 && i < len && code >= 0xdc00 && code <= 0xdfff ? i - 1 : i;
				};
				const index = boundary(rand(len + 1));
				const del = rand(3) === 0 ? boundary(Math.min(index + rand(3), len)) - index : 0;
				const ins = ['x', '😀', '\n', 'あい', ''][rand(5)];
				s.adapter.edit(index, del, ins);
				s.binding.handleInput();
			}
			if (round % 3 === 0) deliver();
		}
		deliver();
		deliver();
		expect(a.ytext.toString()).toBe(b.ytext.toString());
		expect(a.adapter.text).toBe(a.ytext.toString());
		expect(b.adapter.text).toBe(b.ytext.toString());
		expect(a.ytext.toString().isWellFormed()).toBe(true);
	});
});

describe('進捗の集計(ローカルの変更の純増分のみ)', () => {
	it('自分の入力は数え、リモートの変更は数えない', () => {
		const s = setup('abc');
		const tracker = trackLocalGrowth(s.ytext);
		s.adapter.edit(3, 0, 'defgh');
		s.binding.handleInput();
		remoteEdit(s, (t) => t.insert(0, '他者が書いた長い文章です'));
		expect(tracker.peek()).toBe(5);
		expect(tracker.take()).toBe(5);
		expect(tracker.take()).toBe(0);
		tracker.dispose();
	});

	it('削除は純増分から引き、負になったら 0 として扱う', () => {
		const s = setup('0123456789');
		const tracker = trackLocalGrowth(s.ytext);
		s.adapter.edit(0, 6, '');
		s.binding.handleInput();
		s.adapter.edit(0, 0, 'ab');
		s.binding.handleInput();
		expect(tracker.take()).toBe(0);
		s.adapter.edit(0, 0, 'xyz');
		s.binding.handleInput();
		expect(tracker.take()).toBe(3);
		tracker.dispose();
	});

	it('保存済み状態の読み込み(restore)は数えない', () => {
		const s = setup('');
		const tracker = trackLocalGrowth(s.ytext);
		const other = new Y.Doc();
		other.getText('content').insert(0, '読み込まれた本文');
		Y.applyUpdate(s.ydoc, Y.encodeStateAsUpdate(other), 'restore');
		expect(tracker.take()).toBe(0);
		tracker.dispose();
	});
});
