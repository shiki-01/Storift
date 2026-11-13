// @ts-nocheck
// 攻撃テスト: 静的な検査(lint)に引っかかる、そのままの書き方(4)。
// インストールの経路では拒否されるので、E2E は隔離環境へ直接読み込んで、CSP が拒否することを確かめる。
const results = [];
const note = (name, ok, detail = '') =>
	results.push(`${name}=${ok ? 'pass' : 'FAIL'}${detail ? ':' + String(detail).slice(0, 50) : ''}`);

async function attempt(name, fn) {
	try {
		const value = await fn();
		note(name, false, `実行できた: ${String(value).slice(0, 30)}`);
	} catch (error) {
		note(name, true, `${error && error.name}`);
	}
}

(async () => {
	await attempt('raw-eval', () => eval('1 + 1'));
	await attempt('raw-indirect-eval', () => (0, eval)('1 + 1'));
	await attempt('raw-new-Function', () => new Function('return 1')());
	await attempt('raw-importScripts', () => importScripts('https://ok.example.com/evil.js'));
	await attempt('raw-dynamic-import', () => import('https://ok.example.com/module.js'));
	await attempt(
		'raw-dynamic-import-blob',
		() => import(URL.createObjectURL(new Blob(['export default 1'], { type: 'text/javascript' })))
	);
	await attempt(
		'raw-wasm',
		() => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
	);
	await storift.ui.set('settings', [{ type: 'list', items: results }]);
})();
