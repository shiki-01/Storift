/**
 * スクリプト拡張を隔離して動かす iframe の管理(DOM 側)。
 *
 * - iframe は sandbox="allow-scripts" のみ(allow-same-origin / allow-forms / allow-popups / allow-top-navigation などは付けない)。
 *   オリジンは不透明になり、アプリの localStorage・IndexedDB・Cookie・DOM には触れない。
 * - 中身は srcdoc のランタイムシェル(runtime/shell.ts)。ハンドシェイクは親ウィンドウの message を 1 回だけ使い、
 *   `event.source === iframe.contentWindow` を確かめたうえで、MessageChannel のポートを 1 本だけ渡す。
 *   以降の通信はそのポートだけ(ホストは、自分が作ったポートからのメッセージだけを受け付ける)。
 * - ホストはシェルへ定期的に確認を送り、応答が無ければ iframe ごと取り除く。
 * - ワーカーを起動できない環境では、何も実行せず 'unsupported' を返す(フェイルクローズ。直接 iframe の中で実行する代替は作らない)。
 */
import { SCRIPT_LIMITS } from './limits';
import { WORKER_BOOTSTRAP, buildShellHtml, createNonce } from './runtime/shell';

export type SandboxEvent =
	| { type: 'started' }
	| { type: 'loaded' }
	/** ワーカーから届いたメッセージ(未検証。ブリッジが検証する) */
	| { type: 'message'; data: unknown }
	| { type: 'unsupported' }
	| {
			type: 'stopped';
			reason: 'hang' | 'shell-hang' | 'flood' | 'error' | 'timeout';
			detail?: string;
	  }
	| { type: 'worker-error'; detail?: string };

export interface SandboxOptions {
	/** 通信を許すホスト(マニフェストの permissions.network。https のみ) */
	hosts: readonly string[];
	/** 拡張のスクリプト(ソース) */
	source: string;
	/** 識別用(iframe の title に使う) */
	label: string;
	onEvent(event: SandboxEvent): void;
}

export interface SandboxProcess {
	/** ワーカーへ送る(構造化クローン可能な値) */
	post(data: unknown): void;
	/** 隔離された環境ごと取り除く */
	destroy(): void;
	readonly iframe: HTMLIFrameElement;
}

/** この環境に、隔離して実行するための機能が最低限あるか(同期の事前確認。ワーカーの起動可否は起動時に確かめる) */
export function sandboxPrerequisites(): boolean {
	try {
		return (
			typeof document !== 'undefined' &&
			typeof Worker !== 'undefined' &&
			typeof Blob !== 'undefined' &&
			typeof MessageChannel !== 'undefined' &&
			typeof URL !== 'undefined' &&
			typeof URL.createObjectURL === 'function' &&
			'srcdoc' in HTMLIFrameElement.prototype &&
			'sandbox' in HTMLIFrameElement.prototype
		);
	} catch {
		return false;
	}
}

export function startSandbox(options: SandboxOptions): SandboxProcess {
	const nonce = createNonce();
	const iframe = document.createElement('iframe');
	// 順序が大事: sandbox は src / srcdoc より先に設定する
	iframe.setAttribute('sandbox', 'allow-scripts');
	iframe.setAttribute('referrerpolicy', 'no-referrer');
	iframe.setAttribute('allow', '');
	iframe.setAttribute('aria-hidden', 'true');
	iframe.tabIndex = -1;
	iframe.title = `拡張機能の隔離環境: ${options.label}`;
	iframe.dataset.storiftSandbox = '1';
	iframe.style.cssText =
		'position:fixed;left:-10px;top:-10px;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';

	let channel: MessageChannel | null = null;
	let destroyed = false;
	let pingTimer: ReturnType<typeof setInterval> | undefined;
	let outstandingSince = 0;
	let started = false;

	const emit = (event: SandboxEvent) => {
		if (!destroyed) options.onEvent(event);
	};

	const destroy = () => {
		if (destroyed) return;
		destroyed = true;
		clearInterval(pingTimer);
		clearTimeout(startTimer);
		window.removeEventListener('message', onHandshake);
		try {
			channel?.port1.postMessage({ k: 'stop' });
		} catch {
			// 無視
		}
		if (channel) {
			channel.port1.onmessage = null;
			channel.port1.close();
		}
		iframe.remove();
	};

	const stopWith = (
		reason: 'hang' | 'shell-hang' | 'flood' | 'error' | 'timeout',
		detail?: string
	) => {
		if (destroyed) return;
		destroy();
		options.onEvent({ type: 'stopped', reason, detail });
	};

	/** ハンドシェイク: シェルが親に「準備できた」と知らせたら、ポートを 1 本渡す */
	function onHandshake(event: MessageEvent): void {
		// iframe の中のウィンドウからのメッセージだけを受け付ける
		if (event.source !== iframe.contentWindow) return;
		const data = event.data as { t?: unknown; nonce?: unknown } | null;
		if (!data || data.t !== 'storift-shell-hello' || data.nonce !== nonce) return;
		window.removeEventListener('message', onHandshake);
		channel = new MessageChannel();
		channel.port1.onmessage = onPort;
		// 不透明オリジンには targetOrigin を指定できないため '*'。送るのはコードと(転送する)ポートだけで、
		// 宛先は、いま contentWindow を検証したウィンドウ(sandbox により自分で別のページへ移れない)
		iframe.contentWindow!.postMessage(
			{ t: 'init', code: WORKER_BOOTSTRAP + '\n' + options.source },
			'*',
			[channel.port2]
		);
		// シェルの生存確認
		pingTimer = setInterval(() => {
			const now = Date.now();
			if (outstandingSince) {
				if (now - outstandingSince > SCRIPT_LIMITS.shellHangMs) stopWith('shell-hang');
				return;
			}
			outstandingSince = now;
			channel?.port1.postMessage({ k: 'ping' });
		}, SCRIPT_LIMITS.heartbeatMs);
	}

	/** シェルからのメッセージ(自分が作ったポートから届いたものだけ) */
	function onPort(event: MessageEvent): void {
		const msg = event.data as { k?: unknown; e?: unknown; d?: unknown; m?: unknown } | null;
		if (!msg || typeof msg !== 'object') return;
		if (msg.k === 'w') {
			emit({ type: 'message', data: msg.d });
			return;
		}
		if (msg.k !== 's') return;
		const detail = typeof msg.m === 'string' ? msg.m : undefined;
		switch (msg.e) {
			case 'pong':
				outstandingSince = 0;
				break;
			case 'started':
				started = true;
				emit({ type: 'started' });
				break;
			case 'loaded':
				clearTimeout(startTimer);
				emit({ type: 'loaded' });
				break;
			case 'unsupported':
				destroy();
				options.onEvent({ type: 'unsupported' });
				break;
			case 'hang':
				stopWith('hang');
				break;
			case 'flood':
				stopWith('flood', 'ワーカーからのメッセージが多すぎます');
				break;
			case 'load-error':
			case 'worker-failed':
				stopWith('error', detail);
				break;
			case 'startup-timeout':
				stopWith('timeout');
				break;
			case 'worker-error':
				emit({ type: 'worker-error', detail });
				break;
		}
	}

	window.addEventListener('message', onHandshake);
	// シェルが起動しない・ハンドシェイクが来ないとき
	const startTimer = setTimeout(() => {
		if (!started) stopWith('timeout');
	}, SCRIPT_LIMITS.startupMs + 2000);
	iframe.srcdoc = buildShellHtml(nonce, options.hosts);
	document.body.appendChild(iframe);

	return {
		iframe,
		post(data) {
			if (destroyed || !channel) return;
			channel.port1.postMessage({ k: 'w', d: data });
		},
		destroy
	};
}
