/**
 * AI の回答中の資料リンク(src/lib/ai/refs.ts)の、索引づくりと遷移。
 */
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { resolve } from '$app/paths';
import { charactersDB, memosDB, plotsDB, worldbuildingDB } from '$lib/db';
import { currentProjectStore } from '$lib/stores/currentProject.svelte';
import { editorStore } from '$lib/stores/editor.svelte';
import { selectAndGo } from './refNav';
import type { RefKind, RefLookup } from '$lib/ai/refs';
import { entityTitle } from './entities';

/** 作品の人物・プロット・設定資料・シーン・メモを、id から引ける索引にする */
export async function loadRefIndex(projectId: string): Promise<RefLookup> {
	const [characters, plots, worlds, memos] = await Promise.all([
		charactersDB.getByProjectId(projectId),
		plotsDB.getByProjectId(projectId),
		worldbuildingDB.getByProjectId(projectId),
		memosDB.getByProject(projectId)
	]);
	const map = new Map<string, { kind: RefKind; name: string }>();
	for (const c of characters) map.set(c.id, { kind: 'character', name: c.name });
	for (const p of plots) map.set(p.id, { kind: 'plot', name: p.title });
	for (const w of worlds) map.set(w.id, { kind: 'worldbuilding', name: w.title });
	for (const m of memos) map.set(m.id, { kind: 'memo', name: entityTitle('memos', m) });
	for (const s of currentProjectStore.scenes)
		if (s.projectId === projectId) map.set(s.id, { kind: 'scene', name: s.title });
	return (id) => map.get(id);
}

/* eslint-disable svelte/no-navigation-without-resolve -- path は resolve() 済み */
const go = (path: string) => goto(path);
/* eslint-enable svelte/no-navigation-without-resolve */

/** 参照先の画面を開き、その項目を選ぶ */
export async function openRef(kind: RefKind, id: string, projectId: string): Promise<void> {
	switch (kind) {
		case 'character': {
			const path = resolve('/project/[id]/characters', { id: projectId });
			return selectAndGo(path, id, page.url.pathname, go);
		}
		case 'plot': {
			const path = resolve('/project/[id]/plot', { id: projectId });
			return selectAndGo(path, id, page.url.pathname, go);
		}
		case 'worldbuilding': {
			const path = resolve('/project/[id]/worldbuilding', { id: projectId });
			return selectAndGo(path, id, page.url.pathname, go);
		}
		case 'scene': {
			const path = resolve('/project/[id]/editor', { id: projectId });
			return selectAndGo(path, id, page.url.pathname, go);
		}
		case 'memo': {
			editorStore.requestMemo(null);
			return void (await goto(resolve('/project/[id]/editor', { id: projectId })));
		}
	}
}
