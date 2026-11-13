// @ts-nocheck
// 攻撃テスト: 無限ループ(5)。起動して 300ms 後に UI を固めようとする。
storift.ui.set('settings', [{ type: 'text', text: 'ループを始めます' }]);
setTimeout(() => {
	while (true) {
		// 何もしない
	}
}, 300);
