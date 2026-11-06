import { describe, it, expect } from 'vitest';
import type { Character } from '$lib/types';
import {
	DEFAULT_EDGE_GAP,
	buildEdgeSpecs,
	remapEdgeStyles,
	circleLayout,
	curveToEdgeType,
	defaultEdgeOffset,
	edgeStyleKey,
	insideRect
} from './relationGraph';

const char = (id: string, rels: { characterId: string; relation: string }[] = []): Character =>
	({
		id,
		projectId: 'p',
		name: id,
		role: '',
		appearance: '',
		personality: '',
		background: '',
		relationships: rels,
		createdAt: 0,
		updatedAt: 0,
		_version: 1
	}) as Character;

describe('buildEdgeSpecs', () => {
	it('関係から有向の線を作り、保存済みの見た目を反映する', () => {
		const chars = [char('a', [{ characterId: 'b', relation: '親友' }]), char('b')];
		const styles = {
			[edgeStyleKey('a', 'b', '親友')]: { color: '#ef4444', curve: 'step' as const }
		};
		const [edge] = buildEdgeSpecs(chars, styles);
		expect(edge).toMatchObject({
			source: 'a',
			target: 'b',
			label: '親友',
			color: '#ef4444',
			curve: 'step'
		});
	});

	it('存在しないキャラクターへの関係は描かない', () => {
		expect(buildEdgeSpecs([char('a', [{ characterId: 'zzz', relation: '?' }])], {})).toEqual([]);
	});

	it('同じ相手への複数の関係はそれぞれ別の線になる', () => {
		const chars = [
			char('a', [
				{ characterId: 'b', relation: '友人' },
				{ characterId: 'b', relation: '同僚' }
			]),
			char('b')
		];
		const ids = buildEdgeSpecs(chars, {}).map((e) => e.id);
		expect(new Set(ids).size).toBe(2);
	});
});

describe('defaultEdgeOffset', () => {
	it('直線に垂直な方向へ既定の距離だけずらす', () => {
		const offset = defaultEdgeOffset('a', { x: 0, y: 0 }, 'b', { x: 100, y: 0 });
		expect(offset).toEqual({ x: 0, y: DEFAULT_EDGE_GAP });
	});

	it('向きを入れ替えると反対側にずれる', () => {
		const ab = defaultEdgeOffset('a', { x: 10, y: 20 }, 'b', { x: 70, y: 90 });
		const ba = defaultEdgeOffset('b', { x: 70, y: 90 }, 'a', { x: 10, y: 20 });
		expect(ba.x).toBe(-ab.x);
		expect(ba.y).toBe(-ab.y);
	});

	it('ずれの大きさは直線の向きによらず既定値に近い', () => {
		const offset = defaultEdgeOffset('a', { x: 0, y: 0 }, 'b', { x: 30, y: -70 });
		expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(DEFAULT_EDGE_GAP, 0);
	});

	it('始点と終点が同じ位置なら動かさない', () => {
		expect(defaultEdgeOffset('a', { x: 5, y: 5 }, 'b', { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
	});
});

describe('buildEdgeSpecs の既定のずれ', () => {
	const pair = () => [
		char('a', [{ characterId: 'b', relation: '友人' }]),
		char('b', [{ characterId: 'a', relation: '友人' }])
	];
	const positions = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } };

	it('逆向きの関係があると既定のずれを持ち、両線は反対側に膨らむ', () => {
		const [ab, ba] = buildEdgeSpecs(pair(), {}, positions);
		expect(ab.hasReverse).toBe(true);
		expect(ba.hasReverse).toBe(true);
		expect(ab.offset.y).toBe(DEFAULT_EDGE_GAP);
		expect(ba.offset.y).toBe(-DEFAULT_EDGE_GAP);
	});

	it('逆向きが無い関係のずれは 0 になる', () => {
		const chars = [char('a', [{ characterId: 'b', relation: '友人' }]), char('b')];
		const [edge] = buildEdgeSpecs(chars, {}, positions);
		expect(edge.hasReverse).toBe(false);
		expect(edge.offset).toEqual({ x: 0, y: 0 });
	});

	it('保存済みのずれは既定値より優先する', () => {
		const styles = { [edgeStyleKey('a', 'b', '友人')]: { offset: { x: 12, y: -34 } } };
		const [ab, ba] = buildEdgeSpecs(pair(), styles, positions);
		expect(ab.offset).toEqual({ x: 12, y: -34 });
		expect(ba.offset.y).toBe(-DEFAULT_EDGE_GAP);
	});
});

describe('circleLayout', () => {
	it('保存済みの位置は動かさず、未配置だけを並べる', () => {
		const result = circleLayout(['a', 'b', 'c'], { a: { x: 5, y: 6 } });
		expect(result.a).toEqual({ x: 5, y: 6 });
		expect(result.b).toBeDefined();
		expect(result.c).toBeDefined();
		expect(result.b).not.toEqual(result.c);
	});
});

describe('その他', () => {
	it('曲線の種類を組み込みエッジ種別に変換する', () => {
		expect(curveToEdgeType('bezier')).toBe('default');
		expect(curveToEdgeType('smoothstep')).toBe('smoothstep');
		expect(curveToEdgeType(undefined)).toBe('default');
	});

	it('矩形の内外を判定する', () => {
		const rect = { x: 0, y: 0, width: 100, height: 50 };
		expect(insideRect(10, 10, rect)).toBe(true);
		expect(insideRect(101, 10, rect)).toBe(false);
	});
});

describe('矢印の種類', () => {
	const mk = (id: string, rels: [string, string][]): Character =>
		({
			id,
			name: id,
			relationships: rels.map(([characterId, relation]) => ({ characterId, relation }))
		}) as unknown as Character;

	it('逆向きが無ければ single、あればお互い別(separate)で並べる', () => {
		const one = buildEdgeSpecs([mk('a', [['b', '友']]), mk('b', [])], {});
		expect(one[0].arrow).toBe('single');
		expect(one[0].lane).toBe(0);

		const two = buildEdgeSpecs([mk('a', [['b', '友']]), mk('b', [['a', '敵']])], {});
		expect(two.map((e) => e.arrow)).toEqual(['separate', 'separate']);
		expect(two.map((e) => e.lane)).toEqual([1, 1]);
	});

	it('保存された矢印の種類を使う', () => {
		const specs = buildEdgeSpecs([mk('a', [['b', '友']]), mk('b', [])], {
			'a>b>友': { arrow: 'both' }
		});
		expect(specs[0].arrow).toBe('both');
		expect(specs[0].lane).toBe(0);
	});
});

describe('remapEdgeStyles', () => {
	it('関係の名前を変えたら、見た目を新しい関係へ移す', () => {
		const styles = { 'a>b>友': { color: '#ef4444' }, 'a>c>敵': { arrow: 'both' as const } };
		const next = remapEdgeStyles(
			styles,
			'a',
			[
				{ characterId: 'b', relation: '友' },
				{ characterId: 'c', relation: '敵' }
			],
			[
				{ characterId: 'b', relation: '親友' },
				{ characterId: 'c', relation: '敵' }
			]
		);
		expect(next).toEqual({ 'a>b>親友': { color: '#ef4444' }, 'a>c>敵': { arrow: 'both' } });
	});

	it('関係を消したら見た目も捨てる', () => {
		const next = remapEdgeStyles(
			{ 'a>b>友': { color: '#ef4444' } },
			'a',
			[{ characterId: 'b', relation: '友' }],
			[]
		);
		expect(next).toEqual({});
	});
});
