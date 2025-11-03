export interface Chapter {
	id: string;
	projectId: string;
	title: string;
	order: number;
	synopsis: string;
	createdAt: number;
	updatedAt: number;
	_version: number;
	_firestoreId?: string;
}

export interface ChapterCreateInput {
	projectId: string;
	title: string;
	synopsis?: string;
}
