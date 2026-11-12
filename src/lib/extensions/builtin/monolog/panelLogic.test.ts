import { describe, expect, it } from 'vitest';
import {
	CONNECTION_LABELS,
	formatDeltaChars,
	formatElapsed,
	isConnectedStatus
} from './panelLogic';

describe('formatElapsed', () => {
	it('1 時間未満は m:ss、以上は h:mm:ss', () => {
		expect(formatElapsed(0)).toBe('0:00');
		expect(formatElapsed(65_000)).toBe('1:05');
		expect(formatElapsed(59 * 60_000 + 59_999)).toBe('59:59');
		expect(formatElapsed(3600_000)).toBe('1:00:00');
		expect(formatElapsed(3600_000 + 125_000)).toBe('1:02:05');
	});

	it('負の値は 0 にする', () => {
		expect(formatElapsed(-5000)).toBe('0:00');
	});
});

describe('formatDeltaChars', () => {
	it('符号と桁区切りを付ける', () => {
		expect(formatDeltaChars(1234)).toBe('+1,234字');
		expect(formatDeltaChars(-120)).toBe('-120字');
		expect(formatDeltaChars(0)).toBe('±0字');
	});
});

describe('接続状態', () => {
	it('未接続・接続中・要再接続の表示名', () => {
		expect(CONNECTION_LABELS.disconnected).toBe('未接続');
		expect(CONNECTION_LABELS.connected).toBe('接続中');
		expect(CONNECTION_LABELS.reauth).toBe('要再接続');
	});

	it('接続済みとして扱うのは connected と unreachable', () => {
		expect(isConnectedStatus('connected')).toBe(true);
		expect(isConnectedStatus('unreachable')).toBe(true);
		expect(isConnectedStatus('reauth')).toBe(false);
		expect(isConnectedStatus('disconnected')).toBe(false);
	});
});
