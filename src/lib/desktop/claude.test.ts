import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tauri のイベントとコマンドを差し替え、ネイティブ側の振る舞いをテストから操作する
type Handler = (e: { payload: unknown }) => void;
const handlers = new Map<string, Handler[]>();
let attachImpl: () => Promise<unknown> = async () => null;

vi.mock('@tauri-apps/api/event', () => ({
	listen: async (name: string, handler: Handler) => {
		handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		return () =>
			handlers.set(
				name,
				(handlers.get(name) ?? []).filter((h) => h !== handler)
			);
	}
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: (cmd: string) => (cmd === 'claude_attach' ? attachImpl() : Promise.resolve(null))
}));

const { attachClaude } = await import('./claude');

function emit(name: string, payload: unknown) {
	for (const h of handlers.get(name) ?? []) h({ payload });
}

const exit = { requestId: 'r', code: 0, cancelled: false, stderr: '' };

describe('attachClaude', () => {
	beforeEach(() => handlers.clear());

	it('記録が無ければ null を返す', async () => {
		attachImpl = async () => null;
		expect(await attachClaude('r', () => {})).toBeNull();
	});

	it('終わった実行は、溜まっていた行と終了の情報をそのまま返す', async () => {
		attachImpl = async () => ({ lines: ['a', 'b'], exit });
		const lines: string[] = [];
		expect(await attachClaude('r', (l) => lines.push(l))).toEqual(exit);
		expect(lines).toEqual(['a', 'b']);
	});

	it('受け取り直しの間に届いた行は、重複を除いて順に流し、終了まで待つ', async () => {
		attachImpl = async () => {
			// 受け取り直しの最中に、記録済みの行(1)と新しい行(2)が届く
			emit('claude://line', { requestId: 'r', index: 1, line: 'b' });
			emit('claude://line', { requestId: 'r', index: 2, line: 'c' });
			emit('claude://line', { requestId: 'other', index: 3, line: 'x' });
			return { lines: ['a', 'b'], exit: null };
		};
		const lines: string[] = [];
		const done = attachClaude('r', (l) => lines.push(l));
		await vi.waitFor(() => expect(lines).toEqual(['a', 'b', 'c']));
		emit('claude://line', { requestId: 'r', index: 2, line: 'c' });
		emit('claude://line', { requestId: 'r', index: 3, line: 'd' });
		emit('claude://exit', exit);
		expect(await done).toEqual(exit);
		expect(lines).toEqual(['a', 'b', 'c', 'd']);
	});
});
