import { describe, expect, it } from 'vitest';
import { parseEmulatorEnv } from './emulator';

describe('parseEmulatorEnv', () => {
	it('Firestore と Auth の host:port を読む', () => {
		expect(parseEmulatorEnv('127.0.0.1:8080,127.0.0.1:9099')).toEqual({
			firestore: { host: '127.0.0.1', port: 8080 },
			auth: { host: '127.0.0.1', port: 9099 }
		});
	});

	it('未設定・空・形式が違うときは null(エミュレータにつながない)', () => {
		expect(parseEmulatorEnv(undefined)).toBeNull();
		expect(parseEmulatorEnv('')).toBeNull();
		expect(parseEmulatorEnv('127.0.0.1:8080')).toBeNull();
		expect(parseEmulatorEnv('localhost,localhost')).toBeNull();
		expect(parseEmulatorEnv('127.0.0.1:99999,127.0.0.1:9099')).toBeNull();
	});
});
