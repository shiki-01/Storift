export interface Scene {
	id: string;
	chapterId: string;
	projectId: string;
	title: string;
	content: string;
	order: number;
	characterCount: number;
	tags: string[];
	createdAt: number;
	updatedAt: number;
	_version: number;
	_firestoreId?: string;
}

export interface SceneCreateInput {
	chapterId: string;
	projectId: string;
	title: string;
	content?: string;
}
