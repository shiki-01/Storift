export interface Character {
	id: string;
	projectId: string;
	name: string;
	role: string;
	age?: number;
	gender?: string;
	appearance: string;
	personality: string;
	background: string;
	relationships: CharacterRelationship[];
	imageUrl?: string;
	/** 手動の並び順(分数順序。無ければ createdAt 順。utils/ordering.ts) */
	order?: number;
	createdAt: number;
	updatedAt: number;
	_version: number;
	_firestoreId?: string;
}

export interface CharacterRelationship {
	characterId: string;
	relation: string;
}

export interface CharacterCreateInput {
	id?: string;
	projectId: string;
	name: string;
	role?: string;
}
