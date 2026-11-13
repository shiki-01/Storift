// @ts-nocheck
// 攻撃テスト: 権限のない操作の繰り返し(7)。権限は何も無い。
(async () => {
	for (let i = 0; i < 30; i++) {
		try {
			await storift.storage.set('k', i);
		} catch {
			// 拒否される
		}
	}
})();
