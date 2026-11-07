import { db } from './schema';
import type { Character, CharacterCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { isUnchanged, touchProject, writeOrderChanges } from './utils';
import { moveItem, nextOrder, sortByOrder } from '$lib/utils/ordering';
import { historyDB } from './history';

export const charactersDB = {
	async getByProjectId(projectId: string): Promise<Character[]> {
		return sortByOrder(await db.characters.where('projectId').equals(projectId).toArray());
	},

	async getById(id: string): Promise<Character | undefined> {
		return await db.characters.get(id);
	},

	async create(input: CharacterCreateInput): Promise<Character> {
		const now = Date.now();
		const existing = await this.getByProjectId(input.projectId);
		const character: Character = {
			id: input.id ?? uuidv4(),
			projectId: input.projectId,
			name: input.name,
			role: input.role || '',
			appearance: '',
			personality: '',
			background: '',
			relationships: [],
			order: nextOrder(existing),
			createdAt: now,
			updatedAt: now,
			_version: 1
		};

		await db.characters.add(character);
		await touchProject(input.projectId);

		// 作成履歴を保存
		await historyDB.create('character', character.id, character.projectId, character, 'create');

		return character;
	},

	async update(id: string, changes: Partial<Character>): Promise<void> {
		const character = await db.characters.get(id);
		// 内容が変わらない更新では updatedAt を進めない(他端末との不要な競合を避ける)
		if (isUnchanged(character, changes)) return;
		await db.characters.update(id, {
			...changes,
			updatedAt: Date.now(),
			_version: (character?._version || 0) + 1
		});
		if (character) {
			await touchProject(character.projectId);

			// 更新履歴を保存
			await historyDB.create('character', character.id, character.projectId, character, 'update');
		}
	},

	async delete(id: string): Promise<void> {
		const character = await db.characters.get(id);
		await db.characters.delete(id);
		if (character) {
			await touchProject(character.projectId);
		}
	},

	/**
	 * toIndex 番目(移動後の位置)へ動かす。書いた行の id を返す(通常は 1 行。utils/ordering.ts)。
	 * 並べ替えは内容の編集ではないので、履歴は残さない。同期は呼び出し元が、返った id を queueChanges に渡す。
	 */
	async moveTo(id: string, toIndex: number): Promise<string[]> {
		const character = await db.characters.get(id);
		if (!character) return [];
		const siblings = await this.getByProjectId(character.projectId);
		const changes = moveItem(siblings, id, toIndex).map((u) => ({
			id: u.id,
			changes: { order: u.order } as Partial<Character>
		}));
		return await writeOrderChanges(db.characters, character.projectId, changes);
	},

	/**
	 * リモートからのキャラクターをそのまま追加（IDを保持）
	 */
	async addFromRemote(character: Character): Promise<void> {
		await db.characters.add(character);
	}
};
