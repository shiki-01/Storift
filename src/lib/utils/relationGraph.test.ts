import { describe, it, expect } from 'vitest';
import type { Character } from '$lib/types';
import {
	buildEdgeSpecs,
	circleLayout,
	curveToEdgeType,
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
		const styles = { [edgeStyleKey('a', 'b', '親友')]: { color: '#ef4444', curve: 'step' as const } };
		const [edge] = buildEdgeSpecs(chars, styles);
		expect(edge).toMatchObject({ source: 'a', target: 'b', label: '親友', color: '#ef4444', curve: 'step' });
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
