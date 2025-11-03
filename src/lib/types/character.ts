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
	projectId: string;
	name: string;
	role?: string;
}
