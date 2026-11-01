import type { Character, RelationCurve, RelationEdgeStyle } from '$lib/types';

export const RELATION_COLORS = [
	'#6b7280',
	'#3b82f6',
	'#ef4444',
	'#10b981',
	'#f59e0b',
	'#8b5cf6'
] as const;

export const RELATION_CURVES: { id: RelationCurve; label: string }[] = [
	{ id: 'bezier', label: '曲線' },
	{ id: 'straight', label: '直線' },
	{ id: 'step', label: '折れ線' },
	{ id: 'smoothstep', label: '角丸' }
];

/** Svelte Flow の組み込みエッジ種別へ変換 */
export function curveToEdgeType(curve: RelationCurve | undefined): string {
	switch (curve) {
		case 'straight':
			return 'straight';
		case 'step':
			return 'step';
		case 'smoothstep':
			return 'smoothstep';
		default:
			return 'default';
	}
}

/** 線の見た目を保存するキー。ラベルを変えたら付け替える */
export function edgeStyleKey(from: string, to: string, label: string): string {
	return `${from}>${to}>${label}`;
}

/** 逆向きの線と重ならないための既定のずれ(px) */
export const DEFAULT_EDGE_GAP = 40;

interface Point {
	x: number;
	y: number;
}

/**
 * 逆向きの関係がある線の既定のずれ。直線に垂直な方向へ DEFAULT_EDGE_GAP ずらす。
 * 向きで符号が反転しないよう、id の小さい側から大きい側へのベクトルで法線を決める。
 * (A→B と B→A は必ず反対側に膨らむ)
 */
export function defaultEdgeOffset(
	sourceId: string,
	source: Point,
	targetId: string,
	target: Point
): Point {
	const forward = sourceId < targetId;
	const lo = forward ? source : target;
	const hi = forward ? target : source;
	const dx = hi.x - lo.x;
	const dy = hi.y - lo.y;
	const len = Math.hypot(dx, dy);
	if (len === 0) return { x: 0, y: 0 };
	const sign = forward ? 1 : -1;
	// `|| 0` で -0 を 0 に揃える
	return {
		x: Math.round((sign * -dy * DEFAULT_EDGE_GAP) / len) || 0,
		y: Math.round((sign * dx * DEFAULT_EDGE_GAP) / len) || 0
	};
}

export interface RelationEdgeSpec {
	id: string;
	source: string;
	target: string;
	label: string;
	/** 元の Character.relationships 上の位置 */
	index: number;
	color: string;
	curve: RelationCurve;
	/** 逆向き(target→source)の関係が存在するか */
	hasReverse: boolean;
	/** 保存済み、または既定のずれ。逆向きが無ければ {0,0} */
	offset: Point;
}

/**
 * 関係の線を組み立てる。positions はノードの座標(既定のずれの計算に使う)。
 */
export function buildEdgeSpecs(
	characters: Character[],
	edgeStyles: Record<string, RelationEdgeStyle>,
	positions: Record<string, Point> = {}
): RelationEdgeSpec[] {
	const ids = new Set(characters.map((c) => c.id));
	const pairs = new Set<string>();
	for (const character of characters) {
		for (const rel of character.relationships) {
			if (ids.has(rel.characterId)) pairs.add(`${character.id}>${rel.characterId}`);
		}
	}
	const at = (id: string): Point => positions[id] ?? { x: 0, y: 0 };

	const specs: RelationEdgeSpec[] = [];
	for (const character of characters) {
		character.relationships.forEach((rel, index) => {
			if (!ids.has(rel.characterId)) return; // 削除済みキャラへの関係は描かない
			const style = edgeStyles[edgeStyleKey(character.id, rel.characterId, rel.relation)];
			const hasReverse = pairs.has(`${rel.characterId}>${character.id}`);
			const offset =
				style?.offset ??
				(hasReverse
					? defaultEdgeOffset(character.id, at(character.id), rel.characterId, at(rel.characterId))
					: { x: 0, y: 0 });
			specs.push({
				id: `${character.id}:${index}`,
				source: character.id,
				target: rel.characterId,
				label: rel.relation,
				index,
				color: style?.color ?? RELATION_COLORS[0],
				curve: style?.curve ?? 'bezier',
				hasReverse,
				offset: { x: offset.x, y: offset.y }
			});
		});
	}
	return specs;
}

/** 位置が未保存のキャラクターを円周上に並べる */
export function circleLayout(
	ids: string[],
	existing: Record<string, { x: number; y: number }> = {}
): Record<string, { x: number; y: number }> {
	const result: Record<string, { x: number; y: number }> = { ...existing };
	const missing = ids.filter((id) => !existing[id]);
	if (missing.length === 0) return result;
	const radius = Math.max(140, missing.length * 40);
	missing.forEach((id, i) => {
		const angle = (2 * Math.PI * i) / missing.length - Math.PI / 2;
		result[id] = {
			x: Math.round(Math.cos(angle) * radius),
			y: Math.round(Math.sin(angle) * radius)
		};
	});
	return result;
}

/** 点(cx,cy)がグループの矩形内にあるか */
export function insideRect(
	cx: number,
	cy: number,
	rect: { x: number; y: number; width: number; height: number }
): boolean {
	return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
}
