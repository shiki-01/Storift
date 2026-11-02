import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearErrorLogs, getErrorLogs, initializeErrorHandler } from './errorHandler';
import { toast } from '$lib/stores/toast.svelte';

function fireError(message: string) {
	window.dispatchEvent(new ErrorEvent('error', { message }));
}

describe('initializeErrorHandler', () => {
	beforeAll(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		initializeErrorHandler();
	});

	beforeEach(() => {
		clearErrorLogs();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(toast, 'error').mockClear();
	});

	it.each([
		'ResizeObserver loop completed with undelivered notifications.',
		'ResizeObserver loop limit exceeded'
	])('ResizeObserver の通知はエラーとして扱わない: %s', (message) => {
		fireError(message);

		expect(getErrorLogs()).toHaveLength(0);
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('通常のエラーは記録して知らせる', () => {
		fireError('boom');

		expect(getErrorLogs()[0].message).toBe('boom');
		expect(toast.error).toHaveBeenCalledOnce();
	});
});
