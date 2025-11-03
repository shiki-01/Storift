export interface History {
	id: string;
	entityType: 'scene' | 'chapter' | 'character' | 'plot' | 'worldbuilding';
	entityId: string;
	projectId: string;
	snapshot: any;
	changeType: 'create' | 'update' | 'delete';
	createdAt: number;
}
