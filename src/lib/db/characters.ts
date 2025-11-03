import { db } from './schema';
import type { Character, CharacterCreateInput } from '$lib/types';
import { v4 as uuidv4 } from 'uuid';
import { touchProject } from './utils';
import { historyDB } from './history';

export const charactersDB = {
	async getByProjectId(projectId: string): Promise<Character[]> {
		return await db.characters.where('projectId').equals(projectId).toArray();
	},

	async getById(id: string): Promise<Character | undefined> {
		return await db.characters.get(id);
	},

	async create(input: CharacterCreateInput): Promise<Character> {
		const now = Date.now();
		const character: Character = {
			id: uuidv4(),
			projectId: input.projectId,
			name: input.name,
			role: input.role || '',
			appearance: '',
			personality: '',
			background: '',
			relationships: [],
			createdAt: now,
			updatedAt: now,
			_version: 1
		};

		await db.characters.add(character);
		await touchProject(input.projectId);
		
		// 作成履歴を保存
		await historyDB.create(
			'character',
			character.id,
			character.projectId,
			character,
			'create'
		);
		
		return character;
	},

	async update(id: string, changes: Partial<Character>): Promise<void> {
		const character = await db.characters.get(id);
		await db.characters.update(id, {
			...changes,
			updatedAt: Date.now(),
			_version: ((character?._version || 0) + 1)
		});
		if (character) {
			await touchProject(character.projectId);
			
			// 更新履歴を保存
			await historyDB.create(
				'character',
				character.id,
				character.projectId,
				character,
				'update'
			);
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
	 * リモートからのキャラクターをそのまま追加（IDを保持）
	 */
	async addFromRemote(character: Character): Promise<void> {
		await db.characters.add(character);
	}
};
