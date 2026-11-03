export type RelationCurve = 'bezier' | 'straight' | 'step' | 'smoothstep';

/**
 * 矢印の種類。
 * - single: 片方向(from → to の矢印 1 本)
 * - both: 双方向(1 本の線の両端に矢印。関係は 1 つ)
 * - separate: お互い別(それぞれが相手へ向く矢印を 2 本。関係を 2 つ書く)
 */
export type RelationArrow = 'single' | 'both' | 'separate';

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
	/** 未保存なら、逆向きの関係があれば separate、なければ single */
	arrow?: RelationArrow;
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
