import { beforeEach, describe, expect, it, vi } from 'vitest';

let backendImpl: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
const calls: { cmd: string; args: Record<string, unknown> }[] = [];

vi.mock('@tauri-apps/api/core', () => ({
	invoke: (cmd: string, args: Record<string, unknown>) => {
		calls.push({ cmd, args });
		return backendImpl(cmd, args);
	}
}));

const { deleteSecret, getSecret, resetSecretBackend, secretBackend, setSecret } = await import(
	'./secrets'
);

/** キーチェーンのつもりで、メモリに保存する */
function keychain() {
	const store = new Map<string, string>();
	const key = (a: Record<string, unknown>) => `${a.provider}:${a.name}`;
	backendImpl = async (cmd, args) => {
		if (cmd === 'secret_get') return store.get(key(args)) ?? null;
		if (cmd === 'secret_set') {
			store.set(key(args), String(args.value));
			return null;
		}
		if (cmd === 'secret_delete') {
			store.delete(key(args));
			return null;
		}
		throw new Error(`unexpected ${cmd}`);
	};
	return store;
}

beforeEach(() => {
	calls.length = 0;
	resetSecretBackend();
	localStorage.clear();
});

describe('キーチェーンを使える環境', () => {
	it('保存・取得・削除を Rust のコマンドへ渡し、localStorage には残さない', async () => {
		const store = keychain();
		expect(await secretBackend()).toBe('keychain');
		await setSecret('openai-compatible', 'openai', 'sk-secret');
		expect(store.get('openai-compatible:openai')).toBe('sk-secret');
		expect(await getSecret('openai-compatible', 'openai')).toBe('sk-secret');
		expect(await getSecret('openai-compatible', 'other')).toBeNull();
		await deleteSecret('openai-compatible', 'openai');
		expect(await getSecret('openai-compatible', 'openai')).toBeNull();
		expect(localStorage.length).toBe(0);
	});

	it('キーチェーンの失敗(ロック等)では、平文の保存へ黙って切り替えない', async () => {
		backendImpl = async () => {
			throw 'キーチェーンがロックされています';
		};
		await expect(secretBackend()).rejects.toThrow('キーチェーンを利用できません');
		await expect(setSecret('p', 'n', 'v')).rejects.toThrow();
		expect(localStorage.length).toBe(0);
	});
});

describe('キーチェーンを使えない環境(unsupported)', () => {
	beforeEach(() => {
		backendImpl = async () => {
			throw 'unsupported';
		};
	});

	it('localStorage にフォールバックして保存・取得・削除できる', async () => {
		expect(await secretBackend()).toBe('local');
		await setSecret('openai-compatible', 'openai', 'sk-secret');
		expect(await getSecret('openai-compatible', 'openai')).toBe('sk-secret');
		expect(localStorage.getItem('storift:ai-secret:openai-compatible:openai')).toBe('sk-secret');
		await deleteSecret('openai-compatible', 'openai');
		expect(await getSecret('openai-compatible', 'openai')).toBeNull();
		expect(localStorage.length).toBe(0);
	});

	it('判定は一度だけ(以後は Rust を呼ばない)', async () => {
		await secretBackend();
		await setSecret('p', 'n', 'v');
		await getSecret('p', 'n');
		expect(calls.filter((c) => c.cmd === 'secret_get')).toHaveLength(1);
		expect(calls.some((c) => c.cmd === 'secret_set')).toBe(false);
	});

	it('Error として投げられた unsupported も同じに扱う', async () => {
		backendImpl = async () => {
			throw new Error('unsupported');
		};
		expect(await secretBackend()).toBe('local');
	});

	it('プロバイダとプリセットごとに別のキーとして保存する', async () => {
		await setSecret('openai-compatible', 'openai', 'a');
		await setSecret('openai-compatible', 'openrouter', 'b');
		expect(await getSecret('openai-compatible', 'openai')).toBe('a');
		expect(await getSecret('openai-compatible', 'openrouter')).toBe('b');
	});

	it('Anthropic / Gemini のキーも、識別子ごとに別々に保存・削除する', async () => {
		await setSecret('anthropic', 'api-key', 'ant');
		await setSecret('gemini', 'api-key', 'gem');
		expect(await getSecret('anthropic', 'api-key')).toBe('ant');
		expect(await getSecret('gemini', 'api-key')).toBe('gem');
		await deleteSecret('anthropic', 'api-key');
		expect(await getSecret('anthropic', 'api-key')).toBeNull();
		expect(await getSecret('gemini', 'api-key')).toBe('gem');
	});

	it('キーは設定(storift:ai-settings)や同期の保存先には書かれない', async () => {
		await setSecret('gemini', 'api-key', 'gem');
		expect(localStorage.getItem('storift:ai-settings')).toBeNull();
		const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
		expect(keys).toEqual(['storift:ai-secret:gemini:api-key']);
	});
});
