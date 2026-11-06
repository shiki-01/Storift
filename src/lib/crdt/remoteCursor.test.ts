import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
	CURSOR_SEND_INTERVAL_MS,
	createCursorThrottle,
	cursorKey,
	decodeCursor,
	encodeCursor,
	isLabelEmphasized,
	locateTextOffset,
	type NodeLike
} from './remoteCursor';
import type { PresenceCursor } from './presencePolicy';

function makeDoc(text: string) {
	const ydoc = new Y.Doc();
	const ytext = ydoc.getText('content');
	ytext.insert(0, text);
	return { ydoc, ytext };
}

/** ydoc の状態を別の Y.Doc に写す(別端末が同じ文書を持っている状況) */
function clone(ydoc: Y.Doc) {
	const other = new Y.Doc();
	Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc));
	return { ydoc: other, ytext: other.getText('content') };
}

describe('相対位置のシリアライズ', () => {
	it('JSON を経由しても同じ位置に戻る(Firestore を通る形)', () => {
		const { ydoc, ytext } = makeDoc('こんにちは世界');
		const cursor = encodeCursor(ytext, { start: 2, end: 5 });
		const wire = JSON.parse(JSON.stringify(cursor)) as PresenceCursor;
		const peer = clone(ydoc);
		expect(decodeCursor(peer.ydoc, peer.ytext, wire)).toEqual({ anchor: 2, head: 5 });
	});

	it('Firestore に書けるよう、入れ子まで素のオブジェクトになっている(クラスのインスタンスを含まない)', () => {
		const { ytext } = makeDoc('abcdef');
		const isPlain = (v: unknown): boolean =>
			v === null ||
			typeof v !== 'object' ||
			(Object.getPrototypeOf(v) === Object.prototype &&
				Object.values(v as object).every((x) => isPlain(x)));
		const cursor = encodeCursor(ytext, { start: 1, end: 4 });
		expect(isPlain(cursor.anchor)).toBe(true);
		expect(isPlain(cursor.head)).toBe(true);
		expect(JSON.stringify(cursor.anchor)).toContain('"item"');
	});

	it('末尾・先頭・空の本文でも復元できる', () => {
		const { ydoc, ytext } = makeDoc('abc');
		expect(decodeCursor(ydoc, ytext, encodeCursor(ytext, { start: 3, end: 3 }))).toEqual({
			anchor: 3,
			head: 3
		});
		expect(decodeCursor(ydoc, ytext, encodeCursor(ytext, { start: 0, end: 0 }))).toEqual({
			anchor: 0,
			head: 0
		});
		const empty = makeDoc('');
		expect(
			decodeCursor(empty.ydoc, empty.ytext, encodeCursor(empty.ytext, { start: 0, end: 0 }))
		).toEqual({ anchor: 0, head: 0 });
	});

	it('範囲外のインデックスは本文の長さに丸める', () => {
		const { ydoc, ytext } = makeDoc('abc');
		expect(decodeCursor(ydoc, ytext, encodeCursor(ytext, { start: -5, end: 99 }))).toEqual({
			anchor: 0,
			head: 3
		});
	});

	it('編集が入っても同じ文字の隣に留まる(手前への挿入で右へ、後ろへの挿入では動かない)', () => {
		const { ydoc, ytext } = makeDoc('0123456789');
		const cursor = encodeCursor(ytext, { start: 4, end: 7 });
		ytext.insert(0, 'XX');
		expect(decodeCursor(ydoc, ytext, cursor)).toEqual({ anchor: 6, head: 9 });
		ytext.insert(ytext.length, 'YY');
		expect(decodeCursor(ydoc, ytext, cursor)).toEqual({ anchor: 6, head: 9 });
		ytext.delete(0, 3);
		expect(decodeCursor(ydoc, ytext, cursor)).toEqual({ anchor: 3, head: 6 });
	});

	it('壊れた JSON や別の文書を指す位置は null(例外にしない)', () => {
		const { ydoc, ytext } = makeDoc('abc');
		const broken = { anchor: { foo: 1 }, head: { type: 'x' } } as unknown as PresenceCursor;
		expect(decodeCursor(ydoc, ytext, broken)).toBeNull();
		const other = makeDoc('zzz');
		const foreign = encodeCursor(other.ytext, { start: 1, end: 2 });
		expect(decodeCursor(ydoc, ytext, foreign)).toBeNull();
	});

	it('cursorKey: 同じ位置は同じキー、null は別', () => {
		const { ytext } = makeDoc('abcdef');
		const a = encodeCursor(ytext, { start: 1, end: 2 });
		const b = encodeCursor(ytext, { start: 1, end: 2 });
		const c = encodeCursor(ytext, { start: 1, end: 3 });
		expect(cursorKey(a)).toBe(cursorKey(b));
		expect(cursorKey(a)).not.toBe(cursorKey(c));
		expect(cursorKey(null)).toBe('null');
	});
});

describe('createCursorThrottle', () => {
	const cur = (n: number): PresenceCursor => ({ anchor: { n }, head: { n } });

	function setup() {
		let time = 0;
		const timers: { at: number; cb: () => void; id: number }[] = [];
		let nextId = 1;
		const sent: (PresenceCursor | null)[] = [];
		const throttle = createCursorThrottle({
			send: (c) => sent.push(c),
			now: () => time,
			setTimer: (cb, ms) => {
				const id = nextId++;
				timers.push({ at: time + ms, cb, id });
				return id;
			},
			clearTimer: (h) => {
				const i = timers.findIndex((t) => t.id === h);
				if (i >= 0) timers.splice(i, 1);
			}
		});
		const advance = (ms: number) => {
			const end = time + ms;
			for (;;) {
				timers.sort((a, b) => a.at - b.at);
				const next = timers[0];
				if (!next || next.at > end) break;
				timers.shift();
				time = next.at;
				next.cb();
			}
			time = end;
		};
		return { throttle, sent, advance, timers };
	}

	it('最初の変化は即送る', () => {
		const { throttle, sent } = setup();
		throttle.push(cur(1));
		expect(sent).toEqual([cur(1)]);
	});

	it('間隔内の変化はまとめ、間隔が空いた時点で最後の位置だけ送る(trailing)', () => {
		const { throttle, sent, advance } = setup();
		throttle.push(cur(1));
		advance(500);
		throttle.push(cur(2));
		advance(500);
		throttle.push(cur(3));
		expect(sent).toEqual([cur(1)]);
		advance(CURSOR_SEND_INTERVAL_MS - 1000 - 1);
		expect(sent).toEqual([cur(1)]);
		advance(1);
		expect(sent).toEqual([cur(1), cur(3)]);
	});

	it('どの 2 回の書き込みも間隔以上あく(連続した変化を流し込んでも)', () => {
		let time = 0;
		const times: number[] = [];
		const timers: { at: number; cb: () => void }[] = [];
		const throttle = createCursorThrottle({
			send: () => times.push(time),
			now: () => time,
			setTimer: (cb, ms) => {
				const t = { at: time + ms, cb };
				timers.push(t);
				return t;
			},
			clearTimer: (h) => {
				const i = timers.indexOf(h as (typeof timers)[number]);
				if (i >= 0) timers.splice(i, 1);
			}
		});
		for (let step = 0; step < 100; step++) {
			time = step * 250;
			for (const t of [...timers].sort((a, b) => a.at - b.at)) {
				if (t.at <= time) {
					timers.splice(timers.indexOf(t), 1);
					t.cb();
				}
			}
			throttle.push(cur(step));
		}
		expect(times.length).toBeGreaterThan(1);
		for (let i = 1; i < times.length; i++) {
			expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(CURSOR_SEND_INTERVAL_MS);
		}
	});

	it('同じ位置は書かない。元に戻れば予約も取り消す', () => {
		const { throttle, sent, advance, timers } = setup();
		throttle.push(cur(1));
		throttle.push(cur(1));
		expect(sent).toHaveLength(1);
		advance(1000);
		throttle.push(cur(2));
		expect(timers).toHaveLength(1);
		throttle.push(cur(1));
		expect(timers).toHaveLength(0);
		advance(10_000);
		expect(sent).toHaveLength(1);
	});

	it('null(フォーカスを失った)も間引きの対象で、最後には必ず送られる', () => {
		const { throttle, sent, advance } = setup();
		throttle.push(cur(1));
		advance(100);
		throttle.push(null);
		expect(sent).toHaveLength(1);
		advance(CURSOR_SEND_INTERVAL_MS);
		expect(sent).toEqual([cur(1), null]);
	});

	it('markSent: 別経路で送った値は送信済み扱い(予約を取り消し、間隔も数え直す)', () => {
		const { throttle, sent, advance, timers } = setup();
		throttle.push(cur(1));
		advance(100);
		throttle.push(cur(2));
		throttle.markSent(cur(2));
		expect(timers).toHaveLength(0);
		advance(1000);
		expect(sent).toEqual([cur(1)]);
		expect(throttle.latest).toEqual(cur(2));
		throttle.push(cur(3));
		expect(sent).toEqual([cur(1)]);
		advance(CURSOR_SEND_INTERVAL_MS);
		expect(sent).toEqual([cur(1), cur(3)]);
	});

	it('dispose 後は送らない', () => {
		const { throttle, sent, advance } = setup();
		throttle.push(cur(1));
		throttle.push(cur(2));
		throttle.dispose();
		advance(10_000);
		expect(sent).toEqual([cur(1)]);
	});
});

describe('isLabelEmphasized', () => {
	it('変化から 2 秒未満だけ濃く出す', () => {
		expect(isLabelEmphasized(1000, 1000)).toBe(true);
		expect(isLabelEmphasized(1000, 2999)).toBe(true);
		expect(isLabelEmphasized(1000, 3000)).toBe(false);
	});
});

// ---- DOM 非依存のノード(テスト用) ----
const text = (value: string): NodeLike => ({
	nodeType: 3,
	nodeName: '#text',
	textContent: value,
	childNodes: []
});
const el = (name: string, ...children: NodeLike[]): NodeLike => ({
	nodeType: 1,
	nodeName: name,
	textContent: children.map((c) => c.textContent ?? '').join(''),
	childNodes: children
});
const br = () => el('BR');

describe('locateTextOffset', () => {
	it('テキストノード内の位置(複数ノードをまたぐ)', () => {
		const a = text('abc');
		const b = text('def');
		const root = el('DIV', a, b);
		expect(locateTextOffset(root, 0)).toEqual({ node: a, offset: 0 });
		// ノードの境目は前のノードの末尾に寄せる
		expect(locateTextOffset(root, 3)).toEqual({ node: a, offset: 3 });
		expect(locateTextOffset(root, 4)).toEqual({ node: b, offset: 1 });
		expect(locateTextOffset(root, 6)).toEqual({ node: b, offset: 3 });
	});

	it('<br> は改行 1 文字: 行頭は次のテキストノードの先頭', () => {
		const a = text('ab');
		const b = text('cd');
		const root = el('DIV', a, br(), b);
		expect(locateTextOffset(root, 2)).toEqual({ node: a, offset: 2 });
		expect(locateTextOffset(root, 3)).toEqual({ node: b, offset: 0 });
		expect(locateTextOffset(root, 5)).toEqual({ node: b, offset: 2 });
	});

	it('空行は <br> の手前(親, 子の番号)になる', () => {
		const a = text('ab');
		const b = text('cd');
		const second = br();
		const root = el('DIV', a, br(), second, b);
		// "ab\n\ncd": 3 が空行
		expect(locateTextOffset(root, 3)).toEqual({ node: root, offset: 2 });
		expect(locateTextOffset(root, 4)).toEqual({ node: b, offset: 0 });
	});

	it('2 つ目以降の <div> は改行 1 文字(1 つ目は数えない)', () => {
		const a = text('ab');
		const b = text('cd');
		const root = el('DIV', el('DIV', a), el('DIV', b));
		expect(locateTextOffset(root, 2)).toEqual({ node: a, offset: 2 });
		expect(locateTextOffset(root, 3)).toEqual({ node: b, offset: 0 });
		expect(locateTextOffset(root, 5)).toEqual({ node: b, offset: 2 });
	});

	it('空の <div>(<br> だけの行)も扱える', () => {
		const a = text('ab');
		const inner = br();
		const emptyDiv = el('DIV', inner);
		const c = text('cd');
		const root = el('DIV', el('DIV', a), emptyDiv, el('DIV', c));
		// "ab\n\ncd"
		expect(locateTextOffset(root, 3)).toEqual({ node: emptyDiv, offset: 0 });
		// 数え方は textOffsetAt と同じ(空の <div> は div 1 + br 1)。次の行の手前は親の子の番号になる
		expect(locateTextOffset(root, 4)).toEqual({ node: root, offset: 2 });
		expect(locateTextOffset(root, 5)).toEqual({ node: c, offset: 0 });
	});

	it('本文より後ろ・負の値は末尾/先頭に丸める', () => {
		const a = text('ab');
		const root = el('DIV', a);
		expect(locateTextOffset(root, 99)).toEqual({ node: root, offset: 1 });
		expect(locateTextOffset(root, -3)).toEqual({ node: a, offset: 0 });
		const empty = el('DIV');
		expect(locateTextOffset(empty, 0)).toEqual({ node: empty, offset: 0 });
	});
});
