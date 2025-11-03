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
	order: number;
	createdAt: number;
	updatedAt: number;
	_version: number;
	_firestoreId?: string;
}

export interface PlotCreateInput {
	projectId: string;
	title: string;
	type: Plot['type'];
	status?: Plot['status'];
}
