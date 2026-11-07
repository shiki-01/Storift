export interface Worldbuilding {
	id: string;
	projectId: string;
	category: 'term' | 'timeline' | 'location' | 'other';
	title: string;
	content: string;
	tags: string[];
	attachments: Attachment[];
	/** 手動の並び順(分類ごとに並べる。分数順序。無ければ createdAt 順。utils/ordering.ts) */
	order?: number;
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
	id?: string;
	projectId: string;
	category: Worldbuilding['category'];
	title: string;
	content?: string;
}
