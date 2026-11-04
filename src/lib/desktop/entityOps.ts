/**
 * Claude の propose_create / propose_delete が行う、項目の新規追加・削除・復元の DB 操作。
 *
 * 追加は既存の *DB.create、削除は *DB.delete を使う。キャラクターを削除したときは、
 * 他のキャラクターの関係と相関図の配置・線の見た目から、そのキャラクターへの参照を取り除く
 * (既存の削除 API は参照を掃除しないため)。取り除いたものは Touched に残し、復元時に戻す。
 * 同期キューへの登録は呼び出し側にまとめて任せるため、SyncChange として返す。
 */
import {
	chaptersDB,
	charactersDB,
	db,
	memosDB,
	plotsDB,
	progressLogsDB,
	relationMapsDB,
	touchProject,
	worldbuildingDB
} from '$lib/db';
import type { EntityType } from '$lib/firebase/sync';
import type {
	Chapter,
	Character,
	Memo,
	Plot,
	ProgressLog,
	RelationMap,
	Worldbuilding
} from '$lib/types';
import {
	CREATE_ONLY_FIELDS,
	PLOT_TYPE_LABELS,
	WORLD_LABELS,
	createFieldLabels,
	parseEditableValues,
	type CreatableKind,
	type DeletableKind,
	type EntityKind,
	type EntityMap
} from './entities';
import { entityTable } from './workspace';

export type EntityRecord = EntityMap[EntityKind];

export interface SyncChange {
	type: EntityType;
	id: string;
	action: 'create' | 'update' | 'delete';
}

/** 同期の対象になる項目(それ以外は端末内だけのデータ) */
const SYNCED = new Set<EntityKind>(['chapters', 'characters', 'plots', 'worldbuilding']);

function syncOf(kind: EntityKind, id: string, action: SyncChange['action']): SyncChange[] {
	return SYNCED.has(kind) ? [{ type: kind as EntityType, id, action }] : [];
}

/** Svelte のリアクティブなプロキシを IndexedDB へ渡せないため、プレーンな値にする */
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

/** 項目の削除で書き換えた他の項目(復元のために元の状態を持つ) */
export interface Touched {
	characters?: Character[];
	relationMap?: RelationMap;
}

/** propose_create の検証済みの入力 */
export interface CreateSpec {
	kind: CreatableKind;
	projectId: string;
	/** *DB.create に渡す入力(作品 ID を除く) */
	init: Record<string, unknown>;
	/** 作成後に update で反映する残りの変更 */
	changes: Record<string, unknown>;
}

type Failure = { ok: false; reason: string };

/** fields の値を項目ファイルの書式の文字列にそろえる(数値・文字列の配列も受ける) */
export function normalizeFieldValues(raw: unknown): Record<string, string> | string {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		return 'fields は項目名と値のオブジェクトで指定してください';
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === 'string') out[key] = value;
		else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value);
		else if (Array.isArray(value) && value.every((v) => typeof v === 'string'))
			out[key] = value.join(', ');
		else return `「${key}」の値は文字列か数値で指定してください`;
	}
	return out;
}

function labelValue(labels: Record<string, string>, value: string): string | undefined {
	return Object.entries(labels).find(([, label]) => label === value.trim())?.[0];
}

/** 追加の入力を検証し、DB に書く内容(spec)と、差分表示用の仮の項目(draft)を作る */
export async function prepareCreate(
	kind: CreatableKind,
	projectId: string,
	raw: unknown
): Promise<{ ok: true; spec: CreateSpec; draft: EntityRecord } | Failure> {
	const fields = normalizeFieldValues(raw);
	if (typeof fields === 'string') return { ok: false, reason: fields };
	const allowed = createFieldLabels(kind);
	const unknown = Object.keys(fields).find((k) => !allowed.includes(k));
	if (unknown)
		return {
			ok: false,
			reason: `未対応の項目名です: ${unknown}(使える項目: ${allowed.join('・')})`
		};
	const createOnly = CREATE_ONLY_FIELDS[kind] ?? [];
	const missing = createOnly.find((k) => !fields[k]?.trim());
	if (missing) return { ok: false, reason: `「${missing}」は必須です` };

	const editable = Object.fromEntries(
		Object.entries(fields).filter(([k]) => !createOnly.includes(k))
	);
	const oneLine = (label: string) => fields[label].replace(/\s+/g, ' ').trim();
	const init: Record<string, unknown> = {};
	const now = Date.now();
	const base = { id: '(新規)', projectId, createdAt: now, updatedAt: now };
	let draft: EntityRecord;

	switch (kind) {
		case 'chapters': {
			init.title = oneLine('タイトル');
			draft = { ...base, title: init.title, order: 0, synopsis: '', _version: 1 } as Chapter;
			break;
		}
		case 'characters': {
			init.name = oneLine('名前');
			draft = {
				...base,
				name: init.name,
				role: '',
				appearance: '',
				personality: '',
				background: '',
				relationships: [],
				_version: 1
			} as Character;
			break;
		}
		case 'plots': {
			const type = labelValue(PLOT_TYPE_LABELS, fields['種類']);
			if (!type)
				return {
					ok: false,
					reason: `「種類」は ${Object.values(PLOT_TYPE_LABELS).join('・')} のいずれかです`
				};
			init.title = oneLine('タイトル');
			init.type = type;
			draft = {
				...base,
				title: init.title,
				type,
				status: 'idea',
				content: '',
				position: { x: 0, y: 0 },
				color: '#3b82f6',
				order: 0,
				_version: 1
			} as Plot;
			break;
		}
		case 'worldbuilding': {
			const category = labelValue(WORLD_LABELS, fields['分類']);
			if (!category)
				return {
					ok: false,
					reason: `「分類」は ${Object.values(WORLD_LABELS).join('・')} のいずれかです`
				};
			init.title = oneLine('タイトル');
			init.category = category;
			draft = {
				...base,
				title: init.title,
				category,
				content: '',
				tags: [],
				attachments: [],
				_version: 1
			} as Worldbuilding;
			break;
		}
		case 'memos': {
			draft = { ...base, text: '', tags: [], done: false } as Memo;
			break;
		}
		case 'progressLogs': {
			draft = {
				...base,
				date: '',
				charactersWritten: 0,
				timeSpent: 0,
				sceneIds: []
			} as ProgressLog;
			break;
		}
	}

	const parsed = parseEditableValues(kind, draft as never, editable);
	if (!parsed.ok) return parsed;
	const changes: Record<string, unknown> = { ...parsed.changes };
	draft = { ...draft, ...changes } as EntityRecord;

	if (kind === 'memos') {
		if (!(draft as Memo).text.trim()) return { ok: false, reason: '「本文」は必須です' };
		init.text = (draft as Memo).text;
		init.tags = (draft as Memo).tags;
		delete changes.text;
		delete changes.tags;
	}
	if (kind === 'progressLogs') {
		const date = (draft as ProgressLog).date;
		if (!date) return { ok: false, reason: '「日付」は必須です(YYYY-MM-DD)' };
		if (await progressLogsDB.getByDate(projectId, date))
			return { ok: false, reason: `${date} の進捗は既にあります` };
		init.date = date;
		delete changes.date;
	}
	return { ok: true, spec: { kind, projectId, init, changes }, draft };
}

/** spec のとおりに項目を追加する */
export async function createEntity(
	spec: CreateSpec
): Promise<{ record: EntityRecord; sync: SyncChange[] }> {
	const { kind, projectId, init, changes } = spec;
	let id: string;
	switch (kind) {
		case 'chapters':
			id = (await chaptersDB.create({ projectId, title: init.title as string })).id;
			if (Object.keys(changes).length) await chaptersDB.update(id, changes as Partial<Chapter>);
			break;
		case 'characters':
			id = (await charactersDB.create({ projectId, name: init.name as string })).id;
			if (Object.keys(changes).length) await charactersDB.update(id, changes as Partial<Character>);
			break;
		case 'plots':
			id = (
				await plotsDB.create({
					projectId,
					title: init.title as string,
					type: init.type as Plot['type']
				})
			).id;
			if (Object.keys(changes).length) await plotsDB.update(id, changes as Partial<Plot>);
			break;
		case 'worldbuilding':
			id = (
				await worldbuildingDB.create({
					projectId,
					title: init.title as string,
					category: init.category as Worldbuilding['category']
				})
			).id;
			if (Object.keys(changes).length)
				await worldbuildingDB.update(id, changes as Partial<Worldbuilding>);
			break;
		case 'memos':
			id = (
				await memosDB.create({ projectId, text: init.text as string, tags: init.tags as string[] })
			).id;
			if (Object.keys(changes).length) await memosDB.update(id, changes as Partial<Memo>);
			break;
		case 'progressLogs':
			id = (await progressLogsDB.create(projectId, init.date as string)).id;
			if (Object.keys(changes).length)
				await progressLogsDB.update(id, changes as Partial<ProgressLog>);
			break;
	}
	const record = (await entityTable(kind).get(id)) as EntityRecord;
	return { record: plain(record), sync: syncOf(kind, id, 'create') };
}

/** 項目を削除する。戻り値の snapshot と touched があれば restoreEntity で元に戻せる */
export async function removeEntity(
	kind: DeletableKind | 'chapters',
	id: string
): Promise<{ ok: true; snapshot: EntityRecord; touched: Touched; sync: SyncChange[] } | Failure> {
	const found = await entityTable(kind).get(id);
	if (!found) return { ok: false, reason: `項目が見つかりません: ${kind} ${id}` };
	const snapshot = plain(found) as EntityRecord;
	const touched: Touched = {};
	const sync: SyncChange[] = [];

	if (kind === 'chapters') {
		// 章を消すと中のシーンも消えるため、シーンがある章は消さない
		if ((await db.scenes.where('chapterId').equals(id).count()) > 0)
			return { ok: false, reason: '章にシーンがあるため削除できません' };
		await chaptersDB.delete(id);
	} else if (kind === 'characters') {
		await charactersDB.delete(id);
		const others = (
			await db.characters.where('projectId').equals(snapshot.projectId).toArray()
		).filter((c) => c.id !== id && c.relationships?.some((r) => r.characterId === id));
		if (others.length) touched.characters = plain(others);
		for (const other of others) {
			await charactersDB.update(other.id, {
				relationships: other.relationships
					.filter((r) => r.characterId !== id)
					.map((r) => ({ characterId: r.characterId, relation: r.relation }))
			});
			sync.push(...syncOf('characters', other.id, 'update'));
		}
		const map = await db.relationMaps.get(snapshot.projectId);
		if (
			map &&
			(id in map.positions || Object.keys(map.edgeStyles).some((k) => edgeTouches(k, id)))
		) {
			touched.relationMap = plain(map);
			const positions = { ...map.positions };
			delete positions[id];
			const edgeStyles = Object.fromEntries(
				Object.entries(map.edgeStyles).filter(([k]) => !edgeTouches(k, id))
			);
			await relationMapsDB.save({ ...map, positions, edgeStyles });
		}
	} else if (kind === 'plots') await plotsDB.delete(id);
	else if (kind === 'worldbuilding') await worldbuildingDB.delete(id);
	else if (kind === 'memos') await memosDB.delete(id);
	else await progressLogsDB.delete(id);

	sync.push(...syncOf(kind, id, 'delete'));
	return { ok: true, snapshot, touched, sync };
}

/** 線の見た目のキー(from>to>label)が、そのキャラクターにつながる線か */
function edgeTouches(key: string, characterId: string): boolean {
	const [from, to] = key.split('>');
	return from === characterId || to === characterId;
}

/** removeEntity で消した項目を、同じ ID で元に戻す */
export async function restoreEntity(
	kind: EntityKind,
	snapshot: EntityRecord,
	touched: Touched = {}
): Promise<{ ok: true; sync: SyncChange[] } | Failure> {
	const record = plain(snapshot);
	if (kind === 'progressLogs') {
		const same = await progressLogsDB.getByDate(record.projectId, (record as ProgressLog).date);
		if (same && same.id !== record.id)
			return {
				ok: false,
				reason: `${(record as ProgressLog).date} の進捗が既にあるため戻せません`
			};
	}
	await entityTable(kind).put(record as never);
	await touchProject(record.projectId);
	const sync = syncOf(kind, record.id, 'create');

	// 取り除いた参照だけを戻す(その後のほかの変更は残す)
	for (const original of touched.characters ?? []) {
		const current = await db.characters.get(original.id);
		if (!current) continue;
		const restored = original.relationships.filter(
			(r) =>
				r.characterId === record.id &&
				!current.relationships.some((c) => c.characterId === record.id && c.relation === r.relation)
		);
		if (!restored.length) continue;
		await charactersDB.update(current.id, {
			relationships: [...current.relationships, ...restored].map((r) => ({
				characterId: r.characterId,
				relation: r.relation
			}))
		});
		sync.push(...syncOf('characters', current.id, 'update'));
	}
	if (touched.relationMap) {
		const original = touched.relationMap;
		const current = await relationMapsDB.get(original.projectId);
		const edgeStyles = { ...current.edgeStyles };
		for (const [key, style] of Object.entries(original.edgeStyles))
			if (edgeTouches(key, record.id)) edgeStyles[key] = style;
		const positions = { ...current.positions };
		if (original.positions[record.id]) positions[record.id] = original.positions[record.id];
		await relationMapsDB.save({ ...current, positions, edgeStyles });
	}
	return { ok: true, sync };
}
