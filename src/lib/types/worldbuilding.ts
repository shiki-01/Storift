export interface Worldbuilding {
	id: string;
	projectId: string;
	category: 'term' | 'timeline' | 'location' | 'other';
	title: string;
	content: string;
	tags: string[];
	attachments: Attachment[];
	createdAt: number;
	updatedAt: number;
	_version: number;
	_firestoreId?: string;
}

export interface Attachment {
	name: string;
	url: string;
	type: string;
}

export interface WorldbuildingCreateInput {
	projectId: string;
	category: Worldbuilding['category'];
	title: string;
	content?: string;
}
