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
	/** 共有の状態。共有していないプロジェクトには無い */
	sharing?: ProjectSharing;
}

/**
 * プロジェクトの共有情報(docs/SHARING_RULES.md 参照)。
 * Firestore に保存するときに undefined のキーを含めないこと(connectionId / secrets / migration は無ければキーごと省く)。
 */
export interface ProjectSharing {
	/** 共有側のパス(shared/{pid})の ID。プロジェクト ID と同じ */
	pid: string;
	role: 'owner' | 'editor' | 'viewer';
	/** 主 Firebase 以外(ゲスト接続)のとき、その接続の ID。undefined は主 Firebase */
	connectionId?: string;
	visibility: 'private' | 'link';
	status: 'active' | 'migrating' | 'error';
	/** 招待リンクに使う秘密。オーナーだけが持つ。共有側のコピーには入れない */
	secrets?: { viewer?: string; editor?: string };
	startedAt: number;
	/** status が 'migrating' のとき、どちらの移行の途中か(再開時の判断に使う) */
	migration?: 'start' | 'stop';
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
