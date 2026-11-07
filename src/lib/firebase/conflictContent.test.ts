import { describe, expect, it } from 'vitest';
import { reconcile } from './reconcile';
import { contentDiffers, decideConflict, differingKeys } from './conflictContent';
import { describeConflict, excerptOf } from './conflictView';

// 報告された競合: base 以降に両端末が updatedAt を進めたが、内容(メタ項目を除く)は同一
const scene = (over: Record<string, unknown> = {}) => ({
	id: 's1',
	chapterId: 'c1',
	projectId: 'p1',
	title: '第一場',
	content: '本文',
	order: 0,
	characterCount: 2,
	tags: [],
	createdAt: 1,
	updatedAt: 1793978571789,
	_version: 3,
	syncedAt: 1793959226376,
	...over
});

describe('contentDiffers / differingKeys', () => {
	it('updatedAt / _version / syncedAt だけの違いは内容の違いではない', () => {
		const a = scene();
		const b = scene({ updatedAt: 1793978572928, _version: 4, syncedAt: 1793978606069 });
		expect(contentDiffers(a, b)).toBe(false);
		expect(differingKeys(a, b)).toEqual([]);
	});

	it('内容の違いを検出する(片側にしかないキーも)', () => {
		const a = scene();
		expect(contentDiffers(a, scene({ title: '別' }))).toBe(true);
		expect(differingKeys(a, scene({ title: '別', extra: 1 }))).toEqual(['extra', 'title']);
	});
});

describe('decideConflict', () => {
	const local = scene();
	const remote = scene({ updatedAt: local.updatedAt + 1139, _version: 4, syncedAt: 1793978606069 });

	it('再現: reconcile は競合と判定するが、内容が同一なら自動で新しい方を採用する', () => {
		expect(reconcile(local, remote, 1793959226376)).toBe('conflict');
		expect(decideConflict('scenes', local, remote, 'manual')).toEqual({
			kind: 'auto',
			action: 'apply-remote',
			reason: 'same-content'
		});
		expect(decideConflict('chapters', remote, local, 'manual')).toMatchObject({
			action: 'push-local',
			reason: 'same-content'
		});
	});

	it('内容が違う競合は従来どおり手動(ポリシーが manual の場合)', () => {
		const other = { ...remote, title: '別' };
		expect(decideConflict('scenes', local, other, 'manual')).toEqual({ kind: 'manual' });
	});

	it('内容が違えば、ポリシー local / remote に従う', () => {
		const other = { ...remote, title: '別' };
		expect(decideConflict('scenes', local, other, 'local')).toMatchObject({
			action: 'push-local',
			reason: 'policy-local'
		});
		expect(decideConflict('scenes', local, other, 'remote')).toMatchObject({
			action: 'apply-remote',
			reason: 'policy-remote'
		});
	});

	it('プロジェクトと CRDT 化したシーンは、内容が違っても新しい方(従来どおり)', () => {
		const other = { ...remote, title: '別' };
		expect(decideConflict('projects', local, other, 'manual')).toMatchObject({
			action: 'apply-remote',
			reason: 'newest-wins'
		});
		expect(decideConflict('scenes', other, local, 'manual', true)).toMatchObject({
			action: 'push-local',
			reason: 'newest-wins'
		});
	});
});

describe('decideConflict: 並べ替え(order)だけの違い', () => {
	const row = (over: Record<string, unknown> = {}) => ({
		id: 'c1',
		projectId: 'p1',
		name: '人物',
		role: '主人公',
		order: 1024,
		createdAt: 1,
		updatedAt: 1000,
		_version: 2,
		...over
	});

	it('人物・設定資料・プロットは、order だけの違いなら新しい updatedAt の方を採用する', () => {
		const local = row({ order: 2048, updatedAt: 3000, _version: 3 });
		const remote = row({ order: 512, updatedAt: 5000, _version: 4, syncedAt: 9 });
		for (const type of ['characters', 'worldbuilding', 'plots']) {
			expect(decideConflict(type, local, remote, 'manual')).toEqual({
				kind: 'auto',
				action: 'apply-remote',
				reason: 'order-only'
			});
			expect(decideConflict(type, remote, local, 'manual')).toEqual({
				kind: 'auto',
				action: 'push-local',
				reason: 'order-only'
			});
		}
	});

	it('order 以外(題名・分類・状態など)も違えば、従来どおり手動', () => {
		const local = row({ order: 2048, updatedAt: 3000 });
		expect(
			decideConflict('characters', local, row({ order: 1, name: '別', updatedAt: 5000 }), 'manual')
		).toEqual({ kind: 'manual' });
		expect(
			decideConflict(
				'worldbuilding',
				row({ category: 'term', order: 1 }),
				row({ category: 'place', order: 2, updatedAt: 5000 }),
				'manual'
			)
		).toEqual({ kind: 'manual' });
	});

	it('order を持たない種別(シーンなど)には適用しない', () => {
		const local = row({ order: 2048, updatedAt: 3000 });
		const remote = row({ order: 512, updatedAt: 5000 });
		expect(decideConflict('memos', local, remote, 'manual')).toEqual({ kind: 'manual' });
	});

	it('order が片側に無い(旧データ)場合も、order だけの違いとして扱う', () => {
		const local = row({ updatedAt: 3000 });
		const remote = row({ updatedAt: 5000 });
		delete (local as Record<string, unknown>).order;
		expect(decideConflict('plots', local, remote, 'manual')).toMatchObject({
			action: 'apply-remote',
			reason: 'order-only'
		});
	});

	it('contentDiffers(リモート適用の判断)は order の違いを内容の違いとして扱い続ける', () => {
		expect(contentDiffers(row({ order: 1 }), row({ order: 2 }))).toBe(true);
	});
});

describe('2 端末のフィードバックのシミュレーション', () => {
	// 簡易モデル: 端末 A / B とリモート。突き合わせ(reconcile + decideConflict)で収束するか
	type Doc = ReturnType<typeof scene>;
	interface Device {
		doc: Doc;
		base: number | undefined;
	}

	/** device がリモート remote を受け取って突き合わせる。返り値は更新後のリモート */
	function sync(device: Device, remote: Doc, manual: string[]): Doc {
		let action = reconcile(device.doc, remote, device.base);
		if (action === 'conflict') {
			const d = decideConflict('scenes', device.doc, remote, 'manual');
			if (d.kind === 'manual') {
				manual.push('conflict');
				return remote;
			}
			action = d.action;
		}
		if (action === 'apply-remote') {
			device.doc = { ...remote };
			device.base = remote.updatedAt;
		} else if (action === 'push-local') {
			remote = { ...device.doc, syncedAt: remote.syncedAt + 1 };
			device.base = device.doc.updatedAt;
		} else {
			device.base = remote.updatedAt;
		}
		return remote;
	}

	it('両端末が自動書き込みで updatedAt だけ進めても、競合を出さず同じ版に収束する', () => {
		const manual: string[] = [];
		const initial = scene({ updatedAt: 1000 });
		let remote: Doc = { ...initial, syncedAt: 1 };
		const a: Device = { doc: { ...initial }, base: 1000 };
		const b: Device = { doc: { ...initial }, base: 1000 };

		// 同じ内容のまま、ほぼ同時に両端末が updatedAt を進める
		a.doc = { ...a.doc, updatedAt: 5000, _version: 4 };
		b.doc = { ...b.doc, updatedAt: 6139, _version: 4 };

		for (let i = 0; i < 4; i++) {
			remote = sync(a, remote, manual);
			remote = sync(b, remote, manual);
		}

		expect(manual).toEqual([]);
		expect(a.doc.updatedAt).toBe(b.doc.updatedAt);
		expect(remote.updatedAt).toBe(a.doc.updatedAt);
		// 収束したら以降は何もしない
		expect(reconcile(a.doc, remote, a.base)).toBe('skip');
		expect(reconcile(b.doc, remote, b.base)).toBe('skip');
	});

	it('内容が違えば(実際の同時編集)、手動の競合になる', () => {
		const manual: string[] = [];
		const initial = scene({ updatedAt: 1000 });
		const remote: Doc = { ...initial, syncedAt: 1 };
		const a: Device = { doc: { ...initial, title: 'A', updatedAt: 5000 }, base: 1000 };
		const incoming = { ...remote, title: 'B', updatedAt: 6000 };
		sync(a, incoming, manual);
		expect(manual).toEqual(['conflict']);
	});
});

describe('describeConflict', () => {
	it('種類・題名・差のあるフィールドだけを抜粋して返す', () => {
		const local = scene({ content: 'あ'.repeat(100) });
		const remote = scene({ content: 'あ'.repeat(106), title: '第一場(改)', updatedAt: 9 });
		const summary = describeConflict('scenes', local, remote);
		expect(summary.kindLabel).toBe('シーン');
		expect(summary.title).toBe('第一場(改)');
		expect(summary.diffs.map((d) => d.key)).toEqual(['content', 'title']);
		const content = summary.diffs[0];
		expect(content.local).toBe(`${'あ'.repeat(40)}…(全100文字)`);
		expect(content.note).toContain('+6文字');
		expect(summary.diffs[1]).toMatchObject({
			label: '題名',
			local: '第一場',
			remote: '第一場(改)'
		});
	});

	it('人物は name を題名にする', () => {
		expect(describeConflict('characters', { name: '太郎' }, { name: '次郎' }).title).toBe('次郎');
	});

	it('excerptOf: 未設定・長い配列も短くする', () => {
		expect(excerptOf(undefined)).toBe('(なし)');
		expect(excerptOf('短い')).toBe('短い');
		expect(excerptOf(Array.from({ length: 50 }, (_, i) => i))).toContain('…(全');
	});
});
