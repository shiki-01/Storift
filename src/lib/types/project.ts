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
	/** 省略時は自動採番。サンプル作品のように固定 ID が必要なときだけ指定する */
	id?: string;
	title: string;
	description?: string;
}
