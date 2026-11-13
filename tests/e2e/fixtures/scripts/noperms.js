// @ts-nocheck
// 攻撃テスト: 宣言していない権限の使用(7)。権限は ui だけ。結果は設定欄に出す。
const results = [];
const note = (name, ok, detail = '') =>
	results.push(`${name}=${ok ? 'pass' : 'FAIL'}${detail ? ':' + String(detail).slice(0, 50) : ''}`);

(async () => {
	for (const name of ['session:start', 'session:end', 'scene:updated', 'page:change']) {
		try {
			await storift.events.on(name, () => {});
			note(`a7-event-${name}`, false, '購読できた');
		} catch (error) {
			note(`a7-event-${name}`, error.code === 'permission', error.code);
		}
	}
	try {
		await storift.storage.get('x');
		note('a7-storage', false, '使えた');
	} catch (error) {
		note('a7-storage', error.code === 'permission', error.code);
	}
	try {
		await storift.notify('勝手な通知');
		note('a7-notify', false, '使えた');
	} catch (error) {
		note('a7-notify', error.code === 'permission', error.code);
	}
	// 生のメッセージでも同じ(SDK を通さない)
	const raw = await new Promise((resolve) => {
		const timer = setTimeout(() => resolve('timeout'), 2000);
		self.addEventListener('message', (e) => {
			if (e.data && e.data.t === 'res' && e.data.id === 9001) {
				clearTimeout(timer);
				resolve(e.data.ok ? 'ok' : e.data.code);
			}
		});
		self.postMessage({ t: 'req', id: 9001, m: 'storage.set', a: { key: 'k', value: 1 } });
	});
	note('a7-raw-storage', raw === 'permission', raw);
	await storift.ui.set('settings', [{ type: 'list', items: results }]);
})();
