// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
/**
 * ワーカー側の SDK(`storift` オブジェクト)。拡張のコードの前に連結されて、同じ Web Worker で動く。
 * 通信はすべて postMessage 上のリクエスト/応答。権限や上限の判断はホストが行う(ここでは信用されない)。
 * 仕様は docs/SCRIPT_API.md。
 */
(() => {
	'use strict';
	const post = self.postMessage.bind(self);
	const listen = self.addEventListener.bind(self);

	let seq = 0;
	const waiting = new Map();
	const handlers = new Map();
	let uiHandler = null;

	function request(method, args) {
		return new Promise((resolve, reject) => {
			const id = ++seq;
			waiting.set(id, { resolve, reject });
			post({ t: 'req', id, m: method, a: args });
		});
	}

	listen('message', (event) => {
		const d = event.data;
		if (!d || typeof d !== 'object') return;
		if (d.t === 'ping') {
			post({ t: 'pong' });
		} else if (d.t === 'res') {
			const entry = waiting.get(d.id);
			if (!entry) return;
			waiting.delete(d.id);
			if (d.ok) {
				entry.resolve(d.v);
			} else {
				const error = new Error(d.msg);
				error.code = d.code;
				entry.reject(error);
			}
		} else if (d.t === 'ev') {
			for (const handler of [...(handlers.get(d.n) || [])]) {
				try {
					const result = handler(d.p);
					if (result && typeof result.catch === 'function') {
						result.catch((error) => console.error('[storift] イベントの処理で例外:', error));
					}
				} catch (error) {
					console.error('[storift] イベントの処理で例外:', error);
				}
			}
		} else if (d.t === 'ui') {
			if (uiHandler) {
				try {
					uiHandler({ id: d.id, kind: d.kind, value: d.v });
				} catch (error) {
					console.error('[storift] 画面の操作の処理で例外:', error);
				}
			}
		}
	});

	const storift = {
		apiVersion: 1,
		events: {
			/** イベントを購読する。宣言していないイベントは拒否される。解除する関数を返す(Promise) */
			async on(name, handler) {
				if (typeof name !== 'string' || typeof handler !== 'function')
					throw new TypeError('events.on(name, handler)');
				let list = handlers.get(name);
				if (!list) {
					list = new Set();
					handlers.set(name, list);
					try {
						await request('events.on', { name });
					} catch (error) {
						handlers.delete(name);
						throw error;
					}
				}
				list.add(handler);
				return () => {
					const current = handlers.get(name);
					if (!current || !current.delete(handler)) return;
					if (current.size === 0) {
						handlers.delete(name);
						request('events.off', { name }).catch(() => {});
					}
				};
			}
		},
		storage: {
			get: (key) => request('storage.get', { key }),
			set: (key, value) => request('storage.set', { key, value }),
			delete: (key) => request('storage.delete', { key }),
			list: (prefix) => request('storage.list', { prefix })
		},
		ui: {
			/** 画面を更新する。target は 'panel'(ツールバーのポップアップ)か 'settings'(設定欄)。nodes は要素の配列(null で消す) */
			set(target, nodes, options) {
				return request('ui.set', {
					target,
					nodes,
					badge: options && options.badge === true ? true : undefined
				});
			},
			/** 画面の操作(ボタンを押した・値を変えた)を受け取る。{ id, kind: 'press' | 'change', value } */
			onEvent(handler) {
				if (typeof handler !== 'function') throw new TypeError('ui.onEvent(handler)');
				uiHandler = handler;
			}
		},
		notify: (message) => request('notify', { message })
	};
	Object.freeze(storift.events);
	Object.freeze(storift.storage);
	Object.freeze(storift.ui);
	Object.freeze(storift);
	Object.defineProperty(self, 'storift', { value: storift, enumerable: true });

	post({ t: 'boot' });
	// 拡張のコードの最上位が終わったあと(例外で止まらなかったとき)に、読み込み完了を知らせる
	setTimeout(() => post({ t: 'loaded' }), 0);
})();
