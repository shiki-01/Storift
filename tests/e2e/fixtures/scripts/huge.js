// @ts-nocheck
// 攻撃テスト: 巨大なペイロード(6)。
self.postMessage({
	t: 'req',
	id: 1,
	m: 'storage.set',
	a: { key: 'k', value: 'x'.repeat(8_000_000) }
});
