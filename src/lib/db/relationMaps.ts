import { db } from './schema';
import type { RelationMap } from '$lib/types';

export const relationMapsDB = {
	async get(projectId: string): Promise<RelationMap> {
		const found = await db.relationMaps.get(projectId);
		return (
			found ?? {
				id: projectId,
				projectId,
				positions: {},
				groups: [],
				edgeStyles: {},
				updatedAt: Date.now()
			}
		);
	},

	async save(map: RelationMap): Promise<void> {
		// Svelte のリアクティブなプロキシを IndexedDB へ渡せないため、プレーンな値に変換する
		const plain: RelationMap = JSON.parse(JSON.stringify({ ...map, updatedAt: Date.now() }));
		await db.relationMaps.put(plain);
	}
};
