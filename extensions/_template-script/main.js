// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./sdk.d.ts" />
// スクリプト拡張のひな形。仕様は docs/SCRIPT_API.md。
// このファイルは、隔離された Web Worker の中で動きます(document や window はありません)。

let finished = 0;

async function render() {
	await storift.ui.set('panel', [
		{ type: 'heading', text: '執筆セッション' },
		{ type: 'text', text: `終わったセッション: ${finished} 回`, tone: 'muted' },
		{ type: 'button', id: 'reset', label: '数え直す' }
	]);
}

storift.ui.onEvent(async (event) => {
	if (event.id === 'reset') {
		finished = 0;
		await storift.storage.set('finished', 0);
		await render();
	}
});

(async () => {
	finished = (await storift.storage.get('finished')) ?? 0;
	// manifest.json の permissions.events に宣言したイベントだけ購読できます
	await storift.events.on('session:end', async (session) => {
		finished += 1;
		await storift.storage.set('finished', finished);
		await storift.notify(`セッション終了: ${session.netChars} 文字`);
		await render();
	});
	await render();
})();
