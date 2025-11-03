export interface ProgressLog {
	id: string;
	projectId: string;
	date: string; // YYYY-MM-DD
	charactersWritten: number;
	timeSpent: number; // 分単位
	sceneIds: string[];
	createdAt: number;
}

export interface ProgressStats {
	totalCharacters: number;
	averageDaily: number;
	maxDaily: number;
	consecutiveDays: number;
	goalProgress: number; // 0-100
}
