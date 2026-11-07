export interface Plot {
	id: string;
	projectId: string;
	title: string;
	type: 'scene' | 'chapter' | 'arc';
	status: 'idea' | 'planned' | 'written' | 'revised';
	content: string;
	linkedSceneId?: string;
	linkedChapterId?: string;
	position: {
		x: number;
		y: number;
	};
	color: string;
	/** 手動の並び順(分数順序。無ければ createdAt 順。utils/ordering.ts) */
	order?: number;
	createdAt: number;
	updatedAt: number;
	_version: number;
	_firestoreId?: string;
}

export interface PlotCreateInput {
	id?: string;
	projectId: string;
	title: string;
	type: Plot['type'];
	status?: Plot['status'];
}
