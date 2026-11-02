export interface History {
	id: string;
	entityType: 'scene' | 'chapter' | 'character' | 'plot' | 'worldbuilding';
	entityId: string;
	projectId: string;
	snapshot: unknown;
	changeType: 'create' | 'update' | 'delete' | 'conflict' | 'remote-delete';
	createdAt: number;
}
