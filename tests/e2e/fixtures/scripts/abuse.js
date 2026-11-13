// @ts-nocheck
// 攻撃テスト: ストレージ上限・UI の上限・UI への HTML の混入(6・8)。結果は設定欄に出す。
const results = [];
const note = (name, ok, detail = '') =>
	results.push(`${name}=${ok ? 'pass' : 'FAIL'}${detail ? ':' + String(detail).slice(0, 50) : ''}`);

(async () => {
	// 6. ストレージの上限(合計 256KB・値 64KB・キー数)
	let accepted = 0;
	let lastCode = '';
	for (let i = 0; i < 12; i++) {
		try {
			await storift.storage.set(`k${i}`, 'x'.repeat(60_000));
			accepted++;
		} catch (error) {
			lastCode = error.code;
			break;
		}
	}
	note(
		'a6-storage-total',
		accepted <= 4 && lastCode === 'quota',
		`accepted=${accepted} code=${lastCode}`
	);
	try {
		await storift.storage.set('big', 'x'.repeat(70_000));
		note('a6-storage-value', false, '受理された');
	} catch (error) {
		note('a6-storage-value', error.code === 'quota', error.code);
	}
	try {
		await storift.storage.set('', 1);
		note('a6-storage-key', false, '受理された');
	} catch (error) {
		note('a6-storage-key', error.code === 'invalid', error.code);
	}
	try {
		await storift.storage.set('fn', () => 1);
		note('a6-storage-fn', false);
	} catch (error) {
		note('a6-storage-fn', true, error.name);
	}

	// 6. UI の要素数
	const many = Array.from({ length: 1000 }, (_, i) => ({ type: 'text', text: `t${i}` }));
	try {
		await storift.ui.set('settings', many);
		note('a6-ui-nodes', false, '受理された');
	} catch (error) {
		note('a6-ui-nodes', error.code === 'limit', error.code);
	}
	try {
		await storift.ui.set('settings', [{ type: 'text', text: 'あ'.repeat(5000) }]);
		note('a6-ui-text', false, '受理された');
	} catch (error) {
		note('a6-ui-text', error.code === 'limit', error.code);
	}

	// 8. UI への HTML / javascript: URL の混入
	try {
		await storift.ui.set('settings', [
			{ type: 'link', label: 'クリック', url: 'javascript:alert(document.domain)' }
		]);
		note('a8-js-url', false, '受理された');
	} catch (error) {
		note('a8-js-url', error.code === 'limit', error.code);
	}
	try {
		await storift.ui.set('settings', [
			{ type: 'link', label: 'データ', url: 'data:text/html,<script>alert(1)</script>' }
		]);
		note('a8-data-url', false, '受理された');
	} catch (error) {
		note('a8-data-url', error.code === 'limit', error.code);
	}
	try {
		await storift.ui.set('settings', [{ type: 'script', src: 'x' }]);
		note('a8-unknown-type', false, '受理された');
	} catch (error) {
		note('a8-unknown-type', error.code === 'limit', error.code);
	}

	// 8. HTML を含む文字は、そのまま文字として出る(受理される)
	await storift.ui.set('settings', [
		{ type: 'heading', text: '<img src=x onerror="document.title=1">' },
		{ type: 'text', text: '<script>document.body.dataset.pwned="1"</script><b>太字</b>' },
		{ type: 'button', id: 'b1', label: '<u>下線</u>' },
		{ type: 'input', id: 'i1', label: '<i>斜体</i>', value: '"><svg onload=alert(1)>' },
		{ type: 'list', items: results.slice(0, 40) },
		{ type: 'link', label: 'https のリンク', url: 'https://example.com/docs' }
	]);
})();
