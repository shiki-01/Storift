// @ts-nocheck
// 攻撃テスト用ではなく、宣言したイベントが絞り込まれて届くことの確認(app:visibility だけ宣言)。
const log = [];
(async () => {
	await storift.events.on('app:visibility', async (payload) => {
		log.push(JSON.stringify(payload).slice(0, 70));
		await storift.ui.set('settings', [{ type: 'list', items: log.slice(-10) }]);
	});
	await storift.ui.set('settings', [{ type: 'text', text: '購読しました' }]);
})();
