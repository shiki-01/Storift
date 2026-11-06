import { db } from './schema';
import type { Connection } from '$lib/types';

/** ゲスト接続(招待された共有プロジェクトのホスト側 Firebase への接続情報)。端末ごとで、同期の対象外 */
export const connectionsDB = {
	async getAll(): Promise<Connection[]> {
		return await db.connections.toArray();
	},

	async get(id: string): Promise<Connection | undefined> {
		return await db.connections.get(id);
	},

	async getByPid(pid: string): Promise<Connection[]> {
		return await db.connections.where('pid').equals(pid).toArray();
	},

	async put(connection: Connection): Promise<void> {
		await db.connections.put(connection);
	},

	async update(id: string, changes: Partial<Connection>): Promise<void> {
		await db.connections.update(id, changes);
	},

	async delete(id: string): Promise<void> {
		await db.connections.delete(id);
	}
};
