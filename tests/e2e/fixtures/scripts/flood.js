// @ts-nocheck
// 攻撃テスト: メッセージのフラッディング(6)。SDK を通さず、生のメッセージを大量に送る。
for (let i = 1; i <= 20000; i++) {
	self.postMessage({ t: 'req', id: i, m: 'ui.set', a: { target: 'settings', nodes: [] } });
}
