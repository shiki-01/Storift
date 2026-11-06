import { describe, it, expect } from 'vitest';
import type { ProjectSharing } from '$lib/types/project';
import { classifyLocalOnly, planDownload } from './syncPlan';
import {
	PRIMARY_KEY,
	collectionPathOf,
	docPathOf,
	effectiveTargetKey,
	isUnguessableProjectId,
	mirrorPidOf,
	needsResume,
	parseTargetKey,
	sharedProjectCopyPath,
	sharedRef,
	sharedTargetKey,
	targetKeyForEntity,
	targetKeyForProject,
	withoutSecrets,
	withoutSharedChildren
} from './syncTarget';

const PID = '3b1d6a1e-6f0a-4c2e-9a53-0d3f2b7e8c41';

const sharing = (over: Partial<ProjectSharing> = {}): ProjectSharing => ({
	pid: PID,
	role: 'owner',
	visibility: 'private',
	status: 'active',
	startedAt: 1,
	...over
});

describe('ターゲットのキーとパス', () => {
	it('primary は従来の最上位パス', () => {
		expect(collectionPathOf(parseTargetKey(PRIMARY_KEY)!, 'scenes')).toBe('scenes');
		expect(docPathOf(parseTargetKey(PRIMARY_KEY)!, 'chapters', 'c1')).toBe('chapters/c1');
	});

	it('shared は shared/{pid}/{type}/{id}', () => {
		const ref = sharedRef(PID);
		expect(ref.key).toBe(`shared/${PID}`);
		expect(collectionPathOf(ref, 'scenes')).toBe(`shared/${PID}/scenes`);
		expect(docPathOf(ref, 'worldbuilding', 'w1')).toBe(`shared/${PID}/worldbuilding/w1`);
		expect(sharedProjectCopyPath(PID)).toBe(`shared/${PID}/projects/${PID}`);
	});

	it('キーの往復。接続つきのキーは primary / 主 Firebase の shared と区別される', () => {
		expect(parseTargetKey(sharedTargetKey(PID))).toEqual({
			key: `shared/${PID}`,
			kind: 'shared',
			pid: PID
		});
		const guest = parseTargetKey(sharedTargetKey(PID, 'conn1'));
		expect(guest).toMatchObject({ kind: 'shared', pid: PID, connectionId: 'conn1' });
		expect(guest!.key).not.toBe(sharedTargetKey(PID));
		expect(parseTargetKey('garbage')).toBeNull();
		expect(parseTargetKey('shared/')).toBeNull();
	});
});

describe('エンティティのターゲット解決', () => {
	it('共有していなければ primary、active / migrating なら shared', () => {
		expect(targetKeyForProject(undefined)).toBe(PRIMARY_KEY);
		expect(targetKeyForProject({})).toBe(PRIMARY_KEY);
		expect(targetKeyForProject({ sharing: sharing({ status: 'active' }) })).toBe(`shared/${PID}`);
		expect(targetKeyForProject({ sharing: sharing({ status: 'migrating' }) })).toBe(
			`shared/${PID}`
		);
		expect(targetKeyForProject({ sharing: sharing({ status: 'error' }) })).toBe(PRIMARY_KEY);
		expect(targetKeyForProject({ sharing: sharing({ connectionId: 'c' }) })).toBe(
			`c:shared/${PID}`
		);
	});

	it('projects 型(ポインタ)は共有中でも常に primary。子要素は shared', () => {
		const project = { sharing: sharing() };
		expect(targetKeyForEntity('projects', project)).toBe(PRIMARY_KEY);
		expect(targetKeyForEntity('scenes', project)).toBe(`shared/${PID}`);
		expect(targetKeyForEntity('scenes', {})).toBe(PRIMARY_KEY);
		// プロジェクトが見つからない子要素は primary(従来どおり)
		expect(targetKeyForEntity('scenes', undefined)).toBe(PRIMARY_KEY);
	});

	it('共有側へのミラーは主 Firebase の共有中プロジェクトだけ', () => {
		expect(mirrorPidOf({})).toBeNull();
		expect(mirrorPidOf({ sharing: sharing() })).toBe(PID);
		expect(mirrorPidOf({ sharing: sharing({ status: 'migrating' }) })).toBe(PID);
		expect(mirrorPidOf({ sharing: sharing({ status: 'error' }) })).toBeNull();
		expect(mirrorPidOf({ sharing: sharing({ connectionId: 'c' }) })).toBeNull();
	});

	it('共有側のコピーから secrets を除く(元は変更しない)', () => {
		const original = { id: PID, sharing: sharing({ secrets: { viewer: 'v', editor: 'e' } }) };
		const copy = withoutSecrets(original);
		expect(copy.sharing).not.toHaveProperty('secrets');
		expect(copy.sharing).toMatchObject({ pid: PID, visibility: 'private' });
		expect(original.sharing.secrets).toEqual({ viewer: 'v', editor: 'e' });
		const plain: { id: string; sharing?: ProjectSharing } = { id: 'x' };
		expect(withoutSecrets(plain)).toEqual({ id: 'x' });
	});
});

describe('保存済みの変更の行き先', () => {
	const none = () => undefined;

	it('旧形式(target なし)は primary', () => {
		expect(effectiveTargetKey(undefined, none)).toBe(PRIMARY_KEY);
	});

	it('shared のままでよいのは、そのプロジェクトがまだ共有中のとき', () => {
		const key = sharedTargetKey(PID);
		expect(effectiveTargetKey(key, () => ({ sharing: sharing() }))).toBe(key);
		expect(effectiveTargetKey(key, () => ({ sharing: sharing({ status: 'migrating' }) }))).toBe(
			key
		);
	});

	it('共有が止まった/ローカルに共有情報が無いプロジェクトは primary に付け替える', () => {
		const key = sharedTargetKey(PID);
		expect(effectiveTargetKey(key, () => ({}))).toBe(PRIMARY_KEY);
	});

	it('プロジェクトがローカルに無い(削除済み)なら、積んだときの行き先のまま', () => {
		const key = sharedTargetKey(PID);
		expect(effectiveTargetKey(key, none)).toBe(key);
	});

	it('接続つきのキーや解釈できないキーはそのまま', () => {
		const guest = sharedTargetKey(PID, 'c1');
		expect(effectiveTargetKey(guest, () => ({}))).toBe(guest);
		expect(effectiveTargetKey('weird', () => ({}))).toBe('weird');
	});
});

describe('primary の取得・削除判定から共有中の子要素を外す', () => {
	const remotes = [
		{ id: 'a', projectId: 'own' },
		{ id: 'b', projectId: PID },
		{ id: 'c', projectId: 'own' }
	];

	it('取得結果から共有中プロジェクトの子要素を除く', () => {
		expect(withoutSharedChildren(remotes, new Set([PID])).map((r) => r.id)).toEqual(['a', 'c']);
		expect(withoutSharedChildren(remotes, new Set()).map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});

	it('除いた母集団では「ローカルにだけある」ものが出ず、push / 削除の対象にならない', () => {
		// 完全取得: primary のリモートは共有中の子要素 b を含まない(最上位から移行済み)。
		// ローカルの母集団からも b を外せば(localIdsInScope)、b は removals にも uploads にもならない
		const plan = { mode: 'full' as const };
		const remoteIds = new Set(['a', 'c']);
		const withShared = classifyLocalOnly(
			plan,
			['a', 'b', 'c'],
			remoteIds,
			() => false,
			(id) => id === 'b' // 共有前の primary の base が残っている
		);
		expect(withShared.removals).toEqual(['b']); // 外さなければ削除扱いになってしまう

		const scoped = classifyLocalOnly(
			plan,
			['a', 'c'],
			remoteIds,
			() => false,
			() => true
		);
		expect(scoped).toEqual({ removals: [], uploads: [] });
	});

	it('shared ターゲットの母集団は、そのプロジェクトのローカルだけ', () => {
		const plan = { mode: 'full' as const };
		// shared の base は無いので、shared 側に無いローカルは「未アップロード」として shared へ送られる
		const result = classifyLocalOnly(
			plan,
			['b'],
			new Set(),
			() => false,
			() => false
		);
		expect(result).toEqual({ removals: [], uploads: ['b'] });
	});

	it('取得時刻はターゲットごとに持てる(planDownload を target 単位で呼ぶ)', () => {
		const now = 10_000_000;
		const primary = planDownload({
			now,
			trigger: 'periodic',
			types: ['scenes'],
			lastFullSyncAt: now,
			lastSyncTimes: { scenes: now - 1000 },
			localCounts: { scenes: 5 }
		});
		const shared = planDownload({
			now,
			trigger: 'periodic',
			types: ['scenes'],
			lastFullSyncAt: undefined,
			lastSyncTimes: {},
			localCounts: { scenes: 5 }
		});
		expect(primary.scenes.mode).toBe('diff');
		expect(shared.scenes.mode).toBe('full'); // 共有したばかり(最終同期時刻なし)は完全取得
	});
});

describe('起動時の再開判定', () => {
	it('オーナーの migrating で、移行の向きが分かるものだけ再開する', () => {
		expect(needsResume({})).toBe(false);
		expect(needsResume({ sharing: sharing({ status: 'active' }) })).toBe(false);
		expect(needsResume({ sharing: sharing({ status: 'migrating', migration: 'start' }) })).toBe(
			true
		);
		expect(needsResume({ sharing: sharing({ status: 'migrating', migration: 'stop' }) })).toBe(
			true
		);
		// 向きが無い・error・ゲスト・オーナー以外は再開しない
		expect(needsResume({ sharing: sharing({ status: 'migrating' }) })).toBe(false);
		expect(needsResume({ sharing: sharing({ status: 'error', migration: 'start' }) })).toBe(false);
		expect(
			needsResume({
				sharing: sharing({ status: 'migrating', migration: 'start', connectionId: 'c' })
			})
		).toBe(false);
		expect(
			needsResume({ sharing: sharing({ status: 'migrating', migration: 'start', role: 'editor' }) })
		).toBe(false);
	});
});

describe('pid にしてよいプロジェクト ID', () => {
	it('UUID v4 だけを許す(サンプル作品などの固定 ID は不可)', () => {
		expect(isUnguessableProjectId(PID)).toBe(true);
		expect(isUnguessableProjectId('sample-project-v1')).toBe(false);
		expect(isUnguessableProjectId('')).toBe(false);
		expect(isUnguessableProjectId('1'.repeat(36))).toBe(false);
	});
});
