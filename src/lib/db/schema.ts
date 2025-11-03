import Dexie, { type Table } from 'dexie';
import type {
	Project,
	Chapter,
	Scene,
	Character,
	Plot,
	Worldbuilding,
	History,
	ProgressLog,
	AppSettings
} from '$lib/types';

export class StoriftDB extends Dexie {
	projects!: Table<Project>;
	chapters!: Table<Chapter>;
	scenes!: Table<Scene>;
	characters!: Table<Character>;
	plots!: Table<Plot>;
	worldbuilding!: Table<Worldbuilding>;
	history!: Table<History>;
	progressLogs!: Table<ProgressLog>;
	settings!: Table<AppSettings>;

	constructor() {
		super('StoriftDB');
		
		this.version(1).stores({
			projects: 'id, title, status, createdAt, updatedAt, syncedAt',
			chapters: 'id, projectId, order, createdAt, updatedAt',
			scenes: 'id, projectId, chapterId, order, createdAt, updatedAt',
			characters: 'id, projectId, name, createdAt, updatedAt',
			plots: 'id, projectId, type, status, order, createdAt, updatedAt',
			worldbuilding: 'id, projectId, category, createdAt, updatedAt',
			history: 'id, projectId, [entityType+entityId], createdAt',
			progressLogs: 'id, projectId, date, createdAt',
			settings: 'id'
		});
	}
}

export const db = new StoriftDB();
