import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast, toastStore, confirmDialog, confirmStore } from './toast.svelte';

describe('toast', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		toastStore.items.forEach((t) => toast.dismiss(t.id));
		vi.useRealTimers();
	});

	it('一定時間後に自動で消える', () => {
		toast.success('保存しました');
		expect(toastStore.items).toHaveLength(1);
		vi.advanceTimersByTime(4000);
		expect(toastStore.items).toHaveLength(0);
	});

	it('同じ内容が連続しても積み上がらない', () => {
		toast.error('失敗');
		toast.error('失敗');
		expect(toastStore.items).toHaveLength(1);
	});

	it('同時に表示するのは最大3件', () => {
		['a', 'b', 'c', 'd'].forEach((m) => toast.info(m));
		expect(toastStore.items.map((t) => t.message)).toEqual(['b', 'c', 'd']);
	});

	it('操作付きのトーストは長めに残る', () => {
		toast.info('削除しました', { action: { label: '元に戻す', onClick: () => {} } });
		vi.advanceTimersByTime(5000);
		expect(toastStore.items).toHaveLength(1);
	});
});

describe('confirmDialog', () => {
	it('OK で true、キャンセルで false を返す', async () => {
		const yes = confirmDialog('消しますか?');
		expect(confirmStore.pending?.message).toBe('消しますか?');
		confirmStore.answer(true);
		expect(await yes).toBe(true);

		const no = confirmDialog({ message: 'x', danger: true });
		confirmStore.answer(false);
		expect(await no).toBe(false);
		expect(confirmStore.pending).toBeNull();
	});

	it('開いたまま別の確認が来たら、前のものはキャンセル扱い', async () => {
		const first = confirmDialog('1');
		const second = confirmDialog('2');
		expect(await first).toBe(false);
		confirmStore.answer(true);
		expect(await second).toBe(true);
	});
});
