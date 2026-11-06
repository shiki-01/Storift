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
	AppSettings,
	RelationMap,
	Memo,
	Connection
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
	relationMaps!: Table<RelationMap>;
	memos!: Table<Memo>;
	connections!: Table<Connection>;

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

		// v2: 相関図キャンバスの配置情報
		this.version(2).stores({
			relationMaps: 'id, projectId, updatedAt'
		});

		// v3: 作品ごとのメモ(端末ごと。同期対象外)
		this.version(3).stores({
			memos: 'id, projectId, sceneId, updatedAt'
		});

		// v4: ゲスト接続(招待された共有プロジェクトの、ホスト側 Firebase への接続情報)。テーブルの追加だけで、既存データは変更しない
		this.version(4).stores({
			connections: 'id, pid, status'
		});
	}
}

export const db = new StoriftDB();
