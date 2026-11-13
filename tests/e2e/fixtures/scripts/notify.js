// @ts-nocheck
// 攻撃テスト: 通知の連打(1 分あたりの回数と長さの上限)。
const results = [];
const note = (name, ok, detail = '') =>
	results.push(`${name}=${ok ? 'pass' : 'FAIL'}${detail ? ':' + String(detail).slice(0, 50) : ''}`);

(async () => {
	let accepted = 0;
	let rejected = 0;
	let code = '';
	for (let i = 0; i < 8; i++) {
		try {
			await storift.notify(`通知 ${i}`);
			accepted++;
		} catch (error) {
			rejected++;
			code = error.code;
		}
	}
	note(
		'a6-notify-rate',
		accepted === 5 && rejected === 3 && code === 'rate',
		`ok=${accepted} ng=${rejected} ${code}`
	);
	try {
		await storift.notify('あ'.repeat(500));
		note('a6-notify-length', false, '受理された');
	} catch (error) {
		note('a6-notify-length', error.code === 'limit', error.code);
	}
	await storift.ui.set('settings', [{ type: 'list', items: results }]);
})();
