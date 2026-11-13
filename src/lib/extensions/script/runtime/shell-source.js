// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
/**
 * ランタイムシェル: スクリプト拡張を隔離して動かす iframe(sandbox="allow-scripts"。不透明オリジン)の中身。
 * ホストが生成する HTML(shell.ts)に、nonce 付きの <script> として埋め込まれる。拡張のコードはここでは動かさない。
 *
 * やること:
 *  1. ホストとのハンドシェイク(window の message を 1 回だけ受け、MessagePort を 1 本受け取る)
 *  2. Web Worker が使えるかの検出(使えなければ何も実行せず 'unsupported' を返す)
 *  3. 拡張のコードを Blob から Web Worker として起動し、ホストとの間でメッセージを中継する
 *  4. ウォッチドッグ: ワーカーが一定時間応答しなければ terminate する
 *  5. ワーカーのメッセージが多すぎれば terminate する
 * シェルは受け取ったデータを eval / innerHTML などで扱わない。
 */
(() => {
	'use strict';
	const HEARTBEAT_MS = 250;
	const HANG_MS = 3000;
	const STARTUP_MS = 5000;
	const MAX_FROM_WORKER_PER_SEC = 400;

	const nonce = (document.currentScript && document.currentScript.nonce) || '';
	let port = null;
	let worker = null;
	let inited = false;
	let loaded = false;
	let outstandingSince = 0;
	let timer = 0;
	let received = 0;
	let windowStart = 0;

	const toHost = (message) => {
		try {
			if (port) port.postMessage(message);
		} catch {
			// ホストが閉じたあとの送信は無視する
		}
	};
	const report = (event, detail) =>
		toHost({
			k: 's',
			e: event,
			...(detail === undefined ? {} : { m: String(detail).slice(0, 200) })
		});

	function kill(event, detail) {
		clearInterval(timer);
		if (worker) {
			try {
				worker.terminate();
			} catch {
				// すでに終了している
			}
			worker = null;
		}
		if (event) report(event, detail);
	}

	/** Web Worker を Blob から起動できるか。小さなワーカーを 1 つ起動して確かめる */
	function probe(done) {
		let finished = false;
		let probeWorker = null;
		let url = '';
		let startup = 0;
		const finish = (ok) => {
			if (finished) return;
			finished = true;
			clearTimeout(startup);
			try {
				if (probeWorker) probeWorker.terminate();
				if (url) URL.revokeObjectURL(url);
			} catch {
				// 後始末の失敗は無視する
			}
			done(ok);
		};
		startup = setTimeout(() => finish(false), STARTUP_MS);
		try {
			url = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
			probeWorker = new Worker(url);
			probeWorker.onmessage = () => finish(true);
			probeWorker.onerror = () => finish(false);
		} catch {
			finish(false);
		}
	}

	function startWorker(code) {
		let url = '';
		try {
			url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
			worker = new Worker(url);
		} catch (error) {
			kill('worker-failed', error && error.message);
			return;
		}
		worker.onmessage = onWorker;
		worker.onerror = (event) => {
			if (event.preventDefault) event.preventDefault();
			if (!loaded) {
				// 読み込み中の例外(構文エラーを含む)は、起動の失敗として止める
				kill('load-error', event.message);
			} else {
				report('worker-error', event.message);
			}
		};
		worker.onmessageerror = () => report('worker-error', 'messageerror');
		// 起動できなかったときの時間切れ
		setTimeout(() => {
			if (!loaded && worker) kill('startup-timeout');
		}, STARTUP_MS);
		timer = setInterval(heartbeat, HEARTBEAT_MS);
		// URL はワーカーが読み込んだあとで不要になる
		setTimeout(() => {
			try {
				URL.revokeObjectURL(url);
			} catch {
				// 無視
			}
		}, STARTUP_MS * 2);
	}

	function heartbeat() {
		if (!worker) return;
		const now = Date.now();
		if (outstandingSince) {
			// 確認を送ってから返事が無いまま HANG_MS を過ぎた(無限ループなど)
			if (now - outstandingSince > HANG_MS) kill('hang');
		} else {
			outstandingSince = now;
			worker.postMessage({ t: 'ping' });
		}
	}

	function onWorker(event) {
		const now = Date.now();
		if (now - windowStart >= 1000) {
			windowStart = now;
			received = 0;
		}
		if (++received > MAX_FROM_WORKER_PER_SEC) {
			kill('flood');
			return;
		}
		const data = event.data;
		if (data && typeof data === 'object' && !Array.isArray(data)) {
			if (data.t === 'pong') {
				outstandingSince = 0;
				return;
			}
			if (data.t === 'boot') return;
			if (data.t === 'loaded') {
				if (!loaded) {
					loaded = true;
					report('loaded');
				}
				return;
			}
		}
		// それ以外は、ワーカーのメッセージとしてホストへ(ホストが検証する)
		toHost({ k: 'w', d: data });
	}

	function onHost(event) {
		const msg = event.data;
		if (!msg || typeof msg !== 'object') return;
		if (msg.k === 'ping') {
			toHost({ k: 's', e: 'pong' });
		} else if (msg.k === 'w') {
			if (worker) worker.postMessage(msg.d);
		} else if (msg.k === 'stop') {
			kill();
		}
	}

	window.addEventListener('message', (event) => {
		// ホスト(親ウィンドウ)からの、最初の 1 回だけ。ポートは 1 本だけ受け付ける
		if (inited || event.source !== parent || !event.ports || event.ports.length !== 1) return;
		const data = event.data;
		if (!data || data.t !== 'init' || typeof data.code !== 'string') return;
		inited = true;
		port = event.ports[0];
		port.onmessage = onHost;
		probe((ok) => {
			if (!ok) {
				report('unsupported');
				return;
			}
			report('started');
			startWorker(data.code);
		});
	});

	// ハンドシェイクの開始: 親に、準備ができたことを知らせる(ホストが event.source を検証する)
	parent.postMessage({ t: 'storift-shell-hello', nonce }, '*');
})();
