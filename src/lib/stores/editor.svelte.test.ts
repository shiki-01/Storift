import { afterEach, describe, expect, it } from 'vitest';
import { editorStore } from './editor.svelte';
import type { Scene } from '$lib/types';

const scene = (id: string, content: string): Scene => ({
	id,
	chapterId: 'c1',
	projectId: 'p1',
	title: id,
	content,
	order: 0,
	characterCount: content.length,
	tags: [],
	createdAt: 0,
	updatedAt: 0,
	_version: 1
});

afterEach(() => {
	editorStore.crdtSceneId = null;
	editorStore.externalTextSink = null;
	editorStore.currentScene = null;
});

describe('editorStore', () => {
	it('通常は currentScene を設定すると本文が差し替わり、未保存ではなくなる', () => {
		editorStore.currentScene = scene('a', '本文A');
		expect(editorStore.content).toBe('本文A');
		expect(editorStore.isDirty).toBe(false);
		editorStore.content = '編集した';
		expect(editorStore.isDirty).toBe(true);
	});

	it('setContentFromSource は未保存にしない', () => {
		editorStore.currentScene = scene('a', 'x');
		editorStore.setContentFromSource('共同編集の本文');
		expect(editorStore.content).toBe('共同編集の本文');
		expect(editorStore.isDirty).toBe(false);
	});

	it('共同編集中は、同じシーンのメタ情報の差し替えで本文を巻き戻さない', () => {
		editorStore.currentScene = scene('a', '古いミラー');
		editorStore.crdtSceneId = 'a';
		editorStore.setContentFromSource('最新の共同編集の本文');
		editorStore.currentScene = { ...scene('a', '古いミラー'), title: '改名' };
		expect(editorStore.content).toBe('最新の共同編集の本文');
		expect(editorStore.currentScene?.title).toBe('改名');
	});

	it('共同編集中でも、別のシーンへ切り替えれば本文が差し替わる', () => {
		editorStore.currentScene = scene('a', 'A');
		editorStore.crdtSceneId = 'a';
		editorStore.currentScene = scene('b', 'B');
		expect(editorStore.content).toBe('B');
	});

	it('applyExternalText: 登録された入口があればそこへ、無ければ従来どおり本文を更新する', () => {
		editorStore.currentScene = scene('a', 'x');
		const received: string[] = [];
		editorStore.externalTextSink = (text) => {
			received.push(text);
			return true;
		};
		expect(editorStore.applyExternalText('Claude の編集')).toBe(true);
		expect(received).toEqual(['Claude の編集']);
		expect(editorStore.content).toBe('x');

		editorStore.externalTextSink = null;
		expect(editorStore.applyExternalText('通常の編集')).toBe(true);
		expect(editorStore.content).toBe('通常の編集');
		expect(editorStore.isDirty).toBe(true);
	});

	it('入口が false を返したら(読み取り専用)、false を返す', () => {
		editorStore.externalTextSink = () => false;
		expect(editorStore.applyExternalText('x')).toBe(false);
	});
});
