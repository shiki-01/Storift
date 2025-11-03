export interface Project {
	id: string;
	title: string;
	description: string;
	createdAt: number;
	updatedAt: number;
	syncedAt?: number;
	status: 'draft' | 'writing' | 'completed';
	settings: ProjectSettings;
	_version: number;
	_firestoreId?: string;
}

export interface ProjectSettings {
	writingMode: 'vertical' | 'horizontal';
	fontSize: number;
	theme: string;
	goal: {
		type: 'daily' | 'total';
		target: number;
	};
}

export interface ProjectCreateInput {
	title: string;
	description?: string;
}
