import { describe, it, expect, afterEach } from 'vitest';
import { editorStore } from '$lib/stores/editor.svelte';
import { syncStore } from '$lib/stores/sync.svelte';
import { isSafeToUpdate } from './sw-register';

describe('isSafeToUpdate', () => {
	afterEach(() => {
		editorStore.isDirty = false;
		editorStore.isSaving = false;
		syncStore.isSyncing = false;
	});

	it('何も進行中でなければ更新してよい', () => {
		expect(isSafeToUpdate()).toBe(true);
	});

	it('未保存の本文があるときは待つ', () => {
		editorStore.isDirty = true;
		expect(isSafeToUpdate()).toBe(false);
	});

	it('保存中・同期中も待つ', () => {
		editorStore.isSaving = true;
		expect(isSafeToUpdate()).toBe(false);
		editorStore.isSaving = false;
		syncStore.isSyncing = true;
		expect(isSafeToUpdate()).toBe(false);
	});
});
