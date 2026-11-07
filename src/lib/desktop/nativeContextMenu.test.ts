import { describe, it, expect, afterEach } from 'vitest';
import {
	installNativeContextMenuPolicy,
	isEditableTarget,
	shouldBlockNativeMenu
} from './nativeContextMenu';

const el = (html: string) => {
	const host = document.createElement('div');
	host.innerHTML = html;
	document.body.appendChild(host);
	return host;
};

afterEach(() => {
	document.body.innerHTML = '';
});

describe('isEditableTarget', () => {
	it('テキスト入力・textarea・contenteditable は編集できる場所', () => {
		const host = el(
			'<input id="a" type="text"><textarea id="b"></textarea><div contenteditable="true"><p id="c">x</p></div><input id="d" type="search">'
		);
		for (const id of ['a', 'b', 'c', 'd']) {
			expect(isEditableTarget(host.querySelector('#' + id))).toBe(true);
		}
	});

	it('ボタン類の input や通常の要素は編集できない', () => {
		const host = el(
			'<input id="a" type="checkbox"><input id="b" type="range"><p id="c">x</p><div contenteditable="false" id="d"></div>'
		);
		for (const id of ['a', 'b', 'c', 'd']) {
			expect(isEditableTarget(host.querySelector('#' + id))).toBe(false);
		}
		expect(isEditableTarget(null)).toBe(false);
	});
});

describe('shouldBlockNativeMenu', () => {
	const p = document.createElement('p');
	it('非編集領域で選択が無ければ止める', () => {
		expect(shouldBlockNativeMenu({ target: p, defaultPrevented: false, selectionText: '' })).toBe(
			true
		);
		expect(shouldBlockNativeMenu({ target: p, defaultPrevented: false, selectionText: '  ' })).toBe(
			true
		);
	});

	it('選択テキストがあれば残す', () => {
		expect(
			shouldBlockNativeMenu({ target: p, defaultPrevented: false, selectionText: '本文' })
		).toBe(false);
	});

	it('入力欄では残す', () => {
		const input = document.createElement('input');
		expect(
			shouldBlockNativeMenu({ target: input, defaultPrevented: false, selectionText: '' })
		).toBe(false);
	});

	it('自前のメニューが処理済みなら触らない', () => {
		expect(shouldBlockNativeMenu({ target: p, defaultPrevented: true, selectionText: '' })).toBe(
			false
		);
	});
});

describe('installNativeContextMenuPolicy', () => {
	const fire = (target: Element) => {
		const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		target.dispatchEvent(e);
		return e.defaultPrevented;
	};

	it('デスクトップの本番ビルドでは非編集領域のメニューを止める', () => {
		const host = el('<p id="p">x</p><input id="i">');
		const stop = installNativeContextMenuPolicy({ desktop: true, dev: false });
		expect(fire(host.querySelector('#p')!)).toBe(true);
		expect(fire(host.querySelector('#i')!)).toBe(false);
		stop();
		expect(fire(host.querySelector('#p')!)).toBe(false);
	});

	it('開発ビルドと Web では何もしない', () => {
		const host = el('<p id="p">x</p>');
		const a = installNativeContextMenuPolicy({ desktop: true, dev: true });
		expect(fire(host.querySelector('#p')!)).toBe(false);
		a();
		const b = installNativeContextMenuPolicy({ desktop: false, dev: false });
		expect(fire(host.querySelector('#p')!)).toBe(false);
		b();
	});
});
