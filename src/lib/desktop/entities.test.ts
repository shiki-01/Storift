import { describe, expect, it } from 'vitest';
import { editEntityFile, renderEntity, type EntityContext } from './entities';
import { replaceOnce } from './edits';
import type { Character, History, Plot, ProgressLog, RelationMap, Memo, Chapter } from '$lib/types';

const ctx: EntityContext = {
	characterNames: new Map([
		['c1', '太郎'],
		['c2', '花子']
	]),
	sceneTitles: new Map([['s1', '出会い']])
};

const character: Character = {
	id: 'c1',
	projectId: 'p',
	name: '太郎',
	role: '主人公',
	age: 17,
	gender: '男',
	appearance: '背が高い',
	personality: '無口',
	background: '田舎の出身',
	relationships: [{ characterId: 'c2', relation: '幼なじみ' }],
	createdAt: 0,
	updatedAt: 0,
	_version: 1
};

const edit = (from: string, to: string) => (content: string) => replaceOnce(content, from, to);

describe('キャラクター', () => {
	it('編集できるフィールドの変更だけを返す', () => {
		const file = renderEntity('characters', character, ctx);
		const r = editEntityFile('characters', character, ctx, file, edit('無口', '無口だが優しい'));
		expect(r).toMatchObject({ ok: true, changes: { personality: '無口だが優しい' } });
		if (r.ok) expect(Object.keys(r.changes)).toEqual(['personality']);
	});

	it('名前・見出し・関係の相手は変更できない', () => {
		const file = renderEntity('characters', character, ctx);
		expect(editEntityFile('characters', character, ctx, file, edit('# 太郎', '# 次郎')).ok).toBe(
			false
		);
		expect(editEntityFile('characters', character, ctx, file, edit('花子', '花')).ok).toBe(false);
		expect(
			editEntityFile('characters', character, ctx, file, edit('年齢: 17', '年齢: 18')).ok
		).toBe(false);
	});

	it('編集フィールドの見出しを壊す変更は失敗する', () => {
		const file = renderEntity('characters', character, ctx);
		expect(editEntityFile('characters', character, ctx, file, edit('## 性格', '## 性質')).ok).toBe(
			false
		);
	});

	it('節の中に「## 」の行を入れる変更は失敗する', () => {
		const file = renderEntity('characters', character, ctx);
		expect(
			editEntityFile('characters', character, ctx, file, edit('無口', '無口\n## 追加')).ok
		).toBe(false);
	});

	it('編集フィールドの中に「## 」の行がある項目は編集できない', () => {
		const odd = { ...character, background: 'a\n## b\nc' };
		const file = renderEntity('characters', odd, ctx);
		expect(editEntityFile('characters', odd, ctx, file, edit('田舎', '都会')).ok).toBe(false);
	});
});

describe('プロット・設定資料・メモ・章', () => {
	const plot: Plot = {
		id: 'pl',
		projectId: 'p',
		title: '序盤',
		type: 'arc',
		status: 'idea',
		content: '旅立つ',
		position: { x: 0, y: 0 },
		color: '',
		order: 0,
		createdAt: 0,
		updatedAt: 0,
		_version: 1
	};

	it('プロットの状態を日本語ラベルから戻す。不正な値は失敗', () => {
		const file = renderEntity('plots', plot, ctx);
		expect(editEntityFile('plots', plot, ctx, file, edit('アイデア', '執筆済み'))).toMatchObject({
			ok: true,
			changes: { status: 'written' }
		});
		expect(editEntityFile('plots', plot, ctx, file, edit('アイデア', '謎')).ok).toBe(false);
		expect(editEntityFile('plots', plot, ctx, file, edit('種類: 全体の流れ', '種類: 章')).ok).toBe(
			false
		);
	});

	it('メモのタグをカンマ区切りから戻す', () => {
		const memo: Memo = {
			id: 'm',
			projectId: 'p',
			text: '直す',
			tags: ['a'],
			done: false,
			createdAt: 0,
			updatedAt: 0
		};
		const file = renderEntity('memos', memo, ctx);
		expect(
			editEntityFile('memos', memo, ctx, file, edit('## タグ\n\na', '## タグ\n\na, #b、c'))
		).toMatchObject({
			ok: true,
			changes: { tags: ['a', 'b', 'c'] }
		});
		expect(editEntityFile('memos', memo, ctx, file, edit('完了: いいえ', '完了: はい')).ok).toBe(
			false
		);
	});

	it('章の概要が空でも書き足せる', () => {
		const chapter: Chapter = {
			id: 'ch',
			projectId: 'p',
			title: '第一章',
			order: 0,
			synopsis: '',
			createdAt: 0,
			updatedAt: 0,
			_version: 1
		};
		const file = renderEntity('chapters', chapter, ctx);
		expect(
			editEntityFile('chapters', chapter, ctx, file, edit('## 概要\n\n', '## 概要\n\n旅の始まり\n'))
		).toMatchObject({
			ok: true,
			changes: { synopsis: '旅の始まり' }
		});
	});
});

describe('進捗ログ', () => {
	const log: ProgressLog = {
		id: 'l',
		projectId: 'p',
		date: '2026-01-02',
		charactersWritten: 1000,
		timeSpent: 30,
		sceneIds: ['s1'],
		createdAt: 0
	};
	const file = renderEntity('progressLogs', log, ctx);

	it('日付・文字数・時間を数値として戻す', () => {
		const r = editEntityFile('progressLogs', log, ctx, file, edit('\n1000\n', '\n1500\n'));
		expect(r).toMatchObject({ ok: true, changes: { charactersWritten: 1500 } });
		expect(
			editEntityFile(
				'progressLogs',
				log,
				ctx,
				file,
				edit('2026-01-02\n\n## 文字数', '2026-01-03\n\n## 文字数')
			)
		).toMatchObject({ ok: true, changes: { date: '2026-01-03' } });
	});

	it('不正な日付・数値、書いたシーンの変更は失敗する', () => {
		expect(editEntityFile('progressLogs', log, ctx, file, edit('\n1000\n', '\n-5\n')).ok).toBe(
			false
		);
		expect(
			editEntityFile('progressLogs', log, ctx, file, edit('\n1000\n', '\nたくさん\n')).ok
		).toBe(false);
		expect(
			editEntityFile(
				'progressLogs',
				log,
				ctx,
				file,
				edit('2026-01-02\n\n## 文字数', '2026-02-30\n\n## 文字数')
			).ok
		).toBe(false);
		expect(editEntityFile('progressLogs', log, ctx, file, edit('- 出会い', '- 別れ')).ok).toBe(
			false
		);
	});
});

describe('履歴', () => {
	it('どんな編集も受け付けない', () => {
		const history: History = {
			id: 'h',
			entityType: 'character',
			entityId: 'c1',
			projectId: 'p',
			snapshot: { name: '太郎' },
			changeType: 'update',
			createdAt: 0
		};
		const file = renderEntity('history', history, ctx);
		expect(file).toContain('太郎');
		const r = editEntityFile('history', history, ctx, file, edit('太郎', '次郎'));
		expect(r.ok).toBe(false);
	});
});

describe('相関図の配置', () => {
	const map: RelationMap = {
		id: 'p',
		projectId: 'p',
		positions: { c1: { x: 10, y: 20.5 }, c2: { x: -5, y: 0 } },
		groups: [{ id: 'g1', label: '家族', color: '#fff', x: 0, y: 0, width: 100, height: 80 }],
		edgeStyles: {},
		updatedAt: 0
	};
	const file = renderEntity('relationMaps', map, ctx);

	it('座標を数値として書き戻し、他のノードとグループの色・名前は保つ', () => {
		const r = editEntityFile(
			'relationMaps',
			map,
			ctx,
			file,
			edit('[c1]: 10, 20.5', '[c1]: 30, 40')
		);
		expect(r).toMatchObject({
			ok: true,
			changes: { positions: { c1: { x: 30, y: 40 }, c2: { x: -5, y: 0 } } }
		});
		const g = editEntityFile(
			'relationMaps',
			map,
			ctx,
			file,
			edit('0, 0, 100, 80', '5, 6, 200, 90')
		);
		expect(g).toMatchObject({
			ok: true,
			changes: {
				groups: [{ id: 'g1', label: '家族', color: '#fff', x: 5, y: 6, width: 200, height: 90 }]
			}
		});
	});

	it('行の削除・id の変更・数値でない値・大きさ 0 は失敗する', () => {
		expect(editEntityFile('relationMaps', map, ctx, file, edit('- 花子 [c2]: -5, 0', '')).ok).toBe(
			false
		);
		expect(editEntityFile('relationMaps', map, ctx, file, edit('[c2]', '[c9]')).ok).toBe(false);
		expect(
			editEntityFile('relationMaps', map, ctx, file, edit('[c1]: 10,', '[c1]: ほげ,')).ok
		).toBe(false);
		expect(editEntityFile('relationMaps', map, ctx, file, edit('100, 80', '0, 80')).ok).toBe(false);
	});
});

describe('キャラクターの関係', () => {
	const hanako: Character = { ...character, id: 'c2', name: '花子', relationships: [] };
	const rctx: EntityContext = {
		...ctx,
		characters: [character, hanako]
	};

	it('関係の行を [id] ごとに読み書きし、ほかの項目は変えない', () => {
		const file = renderEntity('characters', character, rctx);
		expect(file).toContain('- 花子 [c2]: 幼なじみ');
		const r = editEntityFile('characters', character, rctx, file, edit('幼なじみ', '恋人'));
		expect(r).toMatchObject({
			ok: true,
			changes: { relationships: [{ characterId: 'c2', relation: '恋人' }] }
		});
	});

	it('関係を追加・削除できる', () => {
		const file = renderEntity('characters', character, rctx);
		const added = editEntityFile(
			'characters',
			character,
			rctx,
			file,
			edit('- 花子 [c2]: 幼なじみ', '- 花子 [c2]: 幼なじみ\n- 花子 [c2]: 憧れ')
		);
		expect(added).toMatchObject({
			ok: true,
			changes: {
				relationships: [
					{ characterId: 'c2', relation: '幼なじみ' },
					{ characterId: 'c2', relation: '憧れ' }
				]
			}
		});
		const removed = editEntityFile(
			'characters',
			character,
			rctx,
			file,
			edit('- 花子 [c2]: 幼なじみ', '(なし)')
		);
		expect(removed).toMatchObject({ ok: true, changes: { relationships: [] } });
	});

	it('存在しない相手・自分自身・名前の食い違い・重複は失敗する', () => {
		const file = renderEntity('characters', character, rctx);
		const bad = (to: string) =>
			editEntityFile('characters', character, rctx, file, edit('- 花子 [c2]: 幼なじみ', to)).ok;
		expect(bad('- 花子 [c9]: 友')).toBe(false);
		expect(bad('- 太郎 [c1]: 自分')).toBe(false);
		expect(bad('- 次郎 [c2]: 友')).toBe(false);
		expect(bad('- 花子 [c2]: 友\n- 花子 [c2]: 友')).toBe(false);
	});

	it('削除済みのキャラクターへの関係は触らずに残す', () => {
		const withGhost = {
			...character,
			relationships: [...character.relationships, { characterId: 'gone', relation: '旧友' }]
		};
		const file = renderEntity('characters', withGhost, rctx);
		const r = editEntityFile('characters', withGhost, rctx, file, edit('幼なじみ', '恋人'));
		expect(r).toMatchObject({
			ok: true,
			changes: {
				relationships: [
					{ characterId: 'c2', relation: '恋人' },
					{ characterId: 'gone', relation: '旧友' }
				]
			}
		});
	});
});

describe('相関図の線の見た目', () => {
	const hanako: Character = {
		...character,
		id: 'c2',
		name: '花子',
		relationships: []
	};
	const map: RelationMap = {
		id: 'p',
		projectId: 'p',
		positions: { c1: { x: 0, y: 0 }, c2: { x: 200, y: 0 } },
		groups: [],
		edgeStyles: {},
		updatedAt: 0
	};
	const mctx: EntityContext = { ...ctx, characters: [character, hanako] };
	const file = renderEntity('relationMaps', map, mctx);
	const row = '- 太郎 → 花子「幼なじみ」 [c1|c2]: #6b7280, 曲線, 片方向, 0, 0';

	it('関係ごとに 1 行で、既定の見た目を出す', () => {
		expect(file).toContain(row);
	});

	it('色・曲線・矢印・ずれを書き戻す', () => {
		const r = editEntityFile(
			'relationMaps',
			map,
			mctx,
			file,
			edit(row, '- 太郎 → 花子「幼なじみ」 [c1|c2]: #ef4444, 直線, 双方向, 12, -8')
		);
		expect(r).toMatchObject({
			ok: true,
			changes: {
				edgeStyles: {
					'c1>c2>幼なじみ': {
						color: '#ef4444',
						curve: 'straight',
						arrow: 'both',
						offset: { x: 12, y: -8 }
					}
				}
			}
		});
	});

	it('不正な値・存在しない線・行の削除は失敗する', () => {
		const bad = (to: string) => editEntityFile('relationMaps', map, mctx, file, edit(row, to)).ok;
		expect(bad('- 太郎 → 花子「幼なじみ」 [c1|c2]: 赤, 曲線, 片方向, 0, 0')).toBe(false);
		expect(bad('- 太郎 → 花子「幼なじみ」 [c1|c2]: #ef4444, 波線, 片方向, 0, 0')).toBe(false);
		expect(bad('- 太郎 → 花子「幼なじみ」 [c1|c2]: #ef4444, 曲線, 両方, 0, 0')).toBe(false);
		expect(bad('- 太郎 → 花子「友達」 [c1|c2]: #ef4444, 曲線, 片方向, 0, 0')).toBe(false);
		expect(bad('(なし)')).toBe(false);
	});

	it('逆向きの関係があると「双方向」にできない', () => {
		const both = { ...hanako, relationships: [{ characterId: 'c1', relation: '憧れ' }] };
		const bctx: EntityContext = { ...ctx, characters: [character, both] };
		const f = renderEntity('relationMaps', map, bctx);
		const r = editEntityFile('relationMaps', map, bctx, f, (c) =>
			replaceOnce(c, '#6b7280, 曲線, お互い別, 0, 0', '#6b7280, 曲線, 双方向, 0, 0')
		);
		expect(r.ok).toBe(false);
	});
});
