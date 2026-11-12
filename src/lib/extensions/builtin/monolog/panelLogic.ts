/** ツールバーのポップアップ(MonologPanel)の表示用ロジック。DOM・状態に依存しない */
import type { ConnectionStatus } from './service.svelte';

export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
	unknown: '確認中',
	checking: '確認中',
	connected: '接続中',
	disconnected: '未接続',
	reauth: '要再接続',
	unreachable: '接続中(いまは確認できません)'
};

/** 経過時間。1 時間未満は `m:ss`、以上は `h:mm:ss`(負の値は 0 とする) */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 増減した文字数。`+1,234字` / `-120字` / `±0字` */
export function formatDeltaChars(delta: number): string {
	if (delta === 0) return '±0字';
	return `${delta < 0 ? '-' : '+'}${Math.abs(delta).toLocaleString('en-US')}字`;
}

/** 接続済みとして扱う状態(確認できないときも、トークンはあるので接続中として扱う) */
export function isConnectedStatus(status: ConnectionStatus): boolean {
	return status === 'connected' || status === 'unreachable';
}
