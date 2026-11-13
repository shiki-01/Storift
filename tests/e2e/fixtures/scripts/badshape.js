// @ts-nocheck
// 攻撃テスト: 決められた形でないメッセージ(6)。
self.postMessage({ t: 'req', id: 1, m: 'host.eval', a: 'document.cookie' });
