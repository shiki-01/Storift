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
