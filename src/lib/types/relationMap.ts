export type RelationCurve = 'bezier' | 'straight' | 'step' | 'smoothstep';

export interface RelationGroup {
	id: string;
	label: string;
	color: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RelationEdgeStyle {
	color?: string;
	curve?: RelationCurve;
	/** 始点と終点を結ぶ直線の中点からの制御点のずれ(フロー座標)。未保存なら既定値 */
	offset?: { x: number; y: number };
}

/**
 * 相関図キャンバスの配置情報。関係そのものは Character.relationships が正で、
 * ここにはノードの位置・グループ・線の見た目だけを持つ(端末ごと。同期対象外)。
 */
export interface RelationMap {
	id: string; // projectId と同じ
	projectId: string;
	positions: Record<string, { x: number; y: number }>;
	groups: RelationGroup[];
	edgeStyles: Record<string, RelationEdgeStyle>;
	updatedAt: number;
}
