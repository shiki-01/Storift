/**
 * キャラクター・設定資料・プロット・メモ・章の概要・進捗ログ・履歴・相関図の配置を、
 * 1 項目 1 ファイルの Markdown にする定義と、
 * Claude の編集案を適用した結果のファイルを各フィールドへ書き戻すための解析。
 *
 * ファイルは「# 見出し」+ 読み取り専用の情報 + 編集できるフィールドごとの「## フィールド名」節からなる。
 * 編集案を適用したあとのファイルを読み直し、編集できるフィールド以外(名前・関係の相手など)が
 * 変わっていないことを確かめてから、変わったフィールドだけを返す。
 */
import type { ReplaceResult } from './edits';
import type {
	Chapter,
	Character,
	History,
	Memo,
	Plot,
	ProgressLog,
	RelationMap,
	Worldbuilding
} from '$lib/types';

/**
 * 項目ファイルに対応する種別。chapters・characters・plots・worldbuilding は同期対象(EntityType と同じ名前)、
 * それ以外は端末内だけのデータ。history は読み取り専用。
 */
export type EntityKind =
	| 'chapters'
	| 'characters'
	| 'plots'
	| 'worldbuilding'
	| 'memos'
	| 'progressLogs'
	| 'history'
	| 'relationMaps';

export interface EntityRef {
	kind: EntityKind;
	id: string;
}

export interface EntityMap {
	chapters: Chapter;
	characters: Character;
	plots: Plot;
	worldbuilding: Worldbuilding;
	memos: Memo;
	progressLogs: ProgressLog;
	history: History;
	relationMaps: RelationMap;
}

/** ファイルを組み立てるときに必要な、他の項目の情報 */
export interface EntityContext {
	/** キャラクター ID → 名前(関係の表示用) */
	characterNames: Map<string, string>;
	/** シーン ID → タイトル(メモの表示用) */
	sceneTitles: Map<string, string>;
}

export const WORLD_LABELS: Record<Worldbuilding['category'], string> = {
	term: '用語',
	location: '場所',
	timeline: '年表',
	other: 'その他'
};

export const PLOT_TYPE_LABELS: Record<Plot['type'], string> = {
	arc: '全体の流れ',
	chapter: '章',
	scene: 'シーン'
};

export const PLOT_STATUS_LABELS: Record<Plot['status'], string> = {
	idea: 'アイデア',
	planned: '予定',
	written: '執筆済み',
	revised: '推敲済み'
};

interface FieldDef<T> {
	label: string;
	/** ファイルに書く文字列 */
	get: (entity: T, ctx: EntityContext) => string;
	/** ファイルの文字列から、項目に書き戻す変更を作る。値が不正なら null */
	parse: (value: string, entity: T) => Partial<T> | null;
}

interface EntityDef<T> {
	/** ファイル名・見出しに使う名前 */
	title: (entity: T) => string;
	/** 先頭の見出しと、編集できない情報(「# 見出し」から最初の編集フィールドまで) */
	head: (entity: T, ctx: EntityContext) => string[];
	fields: FieldDef<T>[];
	/** 編集フィールドのあとに置く、編集できない情報 */
	tail?: (entity: T, ctx: EntityContext) => string[];
	/** 編集できないものを Claude に伝える短い説明 */
	readonly: string;
	/** 指定すると、そのファイルは一切編集できない(理由を返す) */
	locked?: string;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function textField<T>(label: string, key: keyof T & string): FieldDef<T> {
	return {
		label,
		get: (e) => String(e[key] ?? ''),
		parse: (v) => ({ [key]: v }) as Partial<T>
	};
}

function tagsField<T extends { tags: string[] }>(): FieldDef<T> {
	return {
		label: 'タグ',
		get: (e) => (e.tags ?? []).join(', '),
		parse: (v) =>
			({
				tags: v
					.split(/[,、\n]/)
					.map((t) => t.trim().replace(/^#/, ''))
					.filter(Boolean)
			}) as Partial<T>
	};
}

function lines(rows: string[]): string {
	return rows.length ? rows.join('\n') : '(なし)';
}

function isDate(v: string): boolean {
	const t = v.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
	const date = new Date(t + 'T00:00:00Z');
	// 13 月などは Invalid Date になり、toISOString は例外を投げる
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(t);
}

function intField<T>(label: string, key: keyof T & string): FieldDef<T> {
	return {
		label,
		get: (e) => String(e[key] ?? 0),
		parse: (v) => (/^\d{1,9}$/.test(v.trim()) ? ({ [key]: Number(v.trim()) } as Partial<T>) : null)
	};
}

/** 「- 名前 [id]: 数値, 数値…」の行を読む。形式が違う行・数値でない値があれば null */
function parseRows(value: string, count: number): { id: string; nums: number[] }[] | null {
	if (value.trim() === '(なし)' || !value.trim()) return [];
	const rows: { id: string; nums: number[] }[] = [];
	for (const line of value.split('\n')) {
		if (!line.trim()) continue;
		const m = /\[([^[\]]+)\]:\s*([^[\]]+)$/.exec(line);
		if (!m) return null;
		const parts = m[2].split(',').map((x) => x.trim());
		if (parts.length !== count || !parts.every((x) => /^-?\d+(\.\d+)?$/.test(x))) return null;
		rows.push({ id: m[1], nums: parts.map(Number) });
	}
	return rows;
}

function sameIds(a: string[], b: string[]): boolean {
	return a.length === b.length && new Set(a).size === a.length && b.every((id) => a.includes(id));
}

const DEFS: { [K in EntityKind]: EntityDef<EntityMap[K]> } = {
	chapters: {
		title: (c) => c.title,
		head: (c) => [`# ${oneLine(c.title)}(章の概要)\n`],
		fields: [textField('概要', 'synopsis')],
		readonly: '章の名前'
	},
	characters: {
		title: (c) => c.name,
		head: (c) => {
			const meta = [c.age != null && `年齢: ${c.age}`, c.gender && `性別: ${c.gender}`].filter(
				Boolean
			);
			return [
				`# ${oneLine(c.name)}\n`,
				...(meta.length ? [meta.map((m) => `- ${m}`).join('\n'), ''] : [])
			];
		},
		fields: [
			textField('役割', 'role'),
			textField('外見', 'appearance'),
			textField('性格', 'personality'),
			textField('背景', 'background')
		],
		tail: (c, ctx) => {
			const relations = (c.relationships ?? [])
				.filter((r) => ctx.characterNames.has(r.characterId))
				.map((r) => `- ${ctx.characterNames.get(r.characterId)}: ${r.relation}`);
			return [`## 関係(編集不可)\n`, relations.length ? relations.join('\n') : '(なし)', ''];
		},
		readonly: '名前・年齢・性別・関係'
	},
	plots: {
		title: (p) => p.title,
		head: (p) => [`# ${oneLine(p.title)}\n`, `- 種類: ${PLOT_TYPE_LABELS[p.type] ?? p.type}\n`],
		fields: [
			{
				label: '状態',
				get: (p) => PLOT_STATUS_LABELS[p.status] ?? p.status,
				parse: (v) => {
					const entry = Object.entries(PLOT_STATUS_LABELS).find(([, label]) => label === v.trim());
					return entry ? { status: entry[0] as Plot['status'] } : null;
				}
			},
			textField('内容', 'content')
		],
		readonly: 'タイトル・種類'
	},
	worldbuilding: {
		title: (w) => w.title,
		head: (w) => [`# ${oneLine(w.title)}\n`, `- 分類: ${WORLD_LABELS[w.category] ?? w.category}\n`],
		fields: [tagsField<Worldbuilding>(), textField('内容', 'content')],
		readonly: 'タイトル・分類'
	},
	memos: {
		title: (m) => oneLine(m.text.split('\n')[0] ?? ''),
		head: (m, ctx) => {
			const meta = [
				`完了: ${m.done ? 'はい' : 'いいえ'}`,
				m.sceneId && ctx.sceneTitles.has(m.sceneId) && `シーン: ${ctx.sceneTitles.get(m.sceneId)}`,
				m.anchor?.quote && `本文の引用: 「${oneLine(m.anchor.quote)}」`
			].filter(Boolean);
			return ['# メモ\n', meta.map((x) => `- ${x}`).join('\n'), ''];
		},
		fields: [textField('本文', 'text'), tagsField<Memo>()],
		readonly: '完了状態・関連シーン・本文の引用'
	},
	progressLogs: {
		title: (l) => l.date,
		head: (l) => [`# 進捗 ${l.date}\n`],
		fields: [
			{
				label: '日付',
				get: (l) => l.date,
				parse: (v) => (isDate(v) ? { date: v.trim() } : null)
			},
			intField('文字数', 'charactersWritten'),
			intField('時間(分)', 'timeSpent')
		],
		tail: (l, ctx) => {
			const scenes = (l.sceneIds ?? []).map(
				(id) => `- ${ctx.sceneTitles.get(id) ?? '(削除されたシーン)'}`
			);
			return [`## 書いたシーン(編集不可)\n`, scenes.length ? scenes.join('\n') : '(なし)', ''];
		},
		readonly: '書いたシーン'
	},
	history: {
		title: (h) =>
			`${new Date(h.createdAt).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}_${h.entityType}_${h.changeType}`,
		head: (h) => [
			`# 履歴(読み取り専用)\n`,
			[
				`- 日時: ${new Date(h.createdAt).toISOString()}`,
				`- 対象: ${h.entityType}`,
				`- 変更: ${h.changeType}`
			].join('\n') + '\n',
			'```json',
			JSON.stringify(h.snapshot, null, 2) ?? 'null',
			'```',
			''
		],
		fields: [],
		readonly: 'すべて',
		locked: '履歴は読み取り専用のため、編集も削除もできません'
	},
	relationMaps: {
		title: () => '相関図の配置',
		head: () => [
			'# 相関図の配置\n',
			'キャラクター同士の関係そのものは各キャラクターのファイルが正で、ここでは変えられません。変えられるのは座標と大きさの数値だけです。\n'
		],
		fields: [
			{
				label: 'ノード座標',
				get: (m, ctx) =>
					lines(
						Object.entries(m.positions ?? {}).map(
							([id, p]) =>
								`- ${oneLine(ctx.characterNames.get(id) ?? '不明')} [${id}]: ${p.x}, ${p.y}`
						)
					),
				parse: (v, m) => {
					const rows = parseRows(v, 2);
					if (
						!rows ||
						!sameIds(
							rows.map((r) => r.id),
							Object.keys(m.positions ?? {})
						)
					)
						return null;
					return {
						positions: Object.fromEntries(rows.map((r) => [r.id, { x: r.nums[0], y: r.nums[1] }]))
					};
				}
			},
			{
				label: 'グループ(x, y, 幅, 高さ)',
				get: (m) =>
					lines(
						(m.groups ?? []).map(
							(g) => `- ${oneLine(g.label)} [${g.id}]: ${g.x}, ${g.y}, ${g.width}, ${g.height}`
						)
					),
				parse: (v, m) => {
					const rows = parseRows(v, 4);
					if (
						!rows ||
						!sameIds(
							rows.map((r) => r.id),
							(m.groups ?? []).map((g) => g.id)
						)
					)
						return null;
					if (rows.some((r) => r.nums[2] <= 0 || r.nums[3] <= 0)) return null;
					const byId = new Map(rows.map((r) => [r.id, r.nums]));
					return {
						groups: (m.groups ?? []).map((g) => {
							const [x, y, width, height] = byId.get(g.id)!;
							return { ...g, x, y, width, height };
						})
					};
				}
			}
		],
		readonly: '関係・ノードやグループの増減・名前・色・線の見た目'
	}
};

export function entityTitle<K extends EntityKind>(kind: K, entity: EntityMap[K]): string {
	return DEFS[kind].title(entity);
}

/** Claude が propose_edit で編集できる項目の種類(履歴は読み取り専用) */
export const EDITABLE_KINDS = [
	'chapters',
	'characters',
	'plots',
	'worldbuilding',
	'memos',
	'progressLogs',
	'relationMaps'
] as const satisfies readonly EntityKind[];

export type EditableKind = (typeof EDITABLE_KINDS)[number];

export function isEditableKind(kind: string): kind is EditableKind {
	return (EDITABLE_KINDS as readonly string[]).includes(kind);
}

/** 編集できるフィールドの見出し名 */
export function editableFields(kind: EntityKind): string[] {
	return DEFS[kind].fields.map((f) => f.label);
}

/** 編集できないものの説明(指示文用) */
export function readonlyNote(kind: EntityKind): string {
	return DEFS[kind].readonly;
}

export function renderEntity<K extends EntityKind>(
	kind: K,
	entity: EntityMap[K],
	ctx: EntityContext
): string {
	const def = DEFS[kind] as EntityDef<EntityMap[K]>;
	const out = [...def.head(entity, ctx)];
	for (const f of def.fields) out.push(`## ${f.label}\n`, f.get(entity, ctx).trim(), '');
	if (def.tail) out.push(...def.tail(entity, ctx));
	return out.join('\n');
}

interface Split {
	/** 編集フィールドの中身を除いた残り(見出し行を含む) */
	frame: string;
	fields: Map<string, string>;
}

/** 「## <編集フィールド名>」の節と、それ以外に分ける。見出しの欠落・重複は理由を返す */
function splitFields(content: string, labels: string[]): Split | string {
	const frame: string[] = [];
	const bodies = new Map<string, string[]>();
	let current: string[] | null = null;
	for (const line of content.split('\n')) {
		const m = /^## (.*?)\s*$/.exec(line);
		if (m) {
			frame.push(line);
			if (labels.includes(m[1])) {
				if (bodies.has(m[1])) return `見出し「## ${m[1]}」が重複しています`;
				current = [];
				bodies.set(m[1], current);
			} else current = null;
		} else if (current) current.push(line);
		else frame.push(line);
	}
	const fields = new Map<string, string>();
	for (const label of labels) {
		const body = bodies.get(label);
		if (!body) return `見出し「## ${label}」が見つかりません`;
		fields.set(label, body.join('\n').trim());
	}
	return { frame: frame.join('\n'), fields };
}

export type EntityEditResult =
	| { ok: true; content: string; index: number; changes: Partial<EntityMap[EntityKind]> }
	| { ok: false; reason: string };

/**
 * 項目ファイルの内容(content)に change を適用し、その結果を各フィールドへの変更として返す。
 * 編集できない部分が変わる・見出しが壊れる・値が不正なときは失敗にする。
 */
export function editEntityFile<K extends EntityKind>(
	kind: K,
	entity: EntityMap[K],
	ctx: EntityContext,
	content: string,
	change: (content: string) => ReplaceResult
): EntityEditResult {
	const def = DEFS[kind] as EntityDef<EntityMap[K]>;
	const labels = def.fields.map((f) => f.label);
	if (def.locked) return { ok: false, reason: def.locked };

	const before = splitFields(content, labels);
	if (typeof before === 'string') return { ok: false, reason: before };
	// 本文に「## 」で始まる行があるなど、ファイルから項目を復元できないものは書き戻せない
	for (const f of def.fields) {
		if (before.fields.get(f.label) !== f.get(entity, ctx).trim())
			return {
				ok: false,
				reason: `「${f.label}」に「## 」で始まる行があるため、このファイルは編集できません`
			};
	}

	const result = change(content);
	if (!result.ok) return result;
	const after = splitFields(result.content, labels);
	if (typeof after === 'string') return { ok: false, reason: after };
	if (after.frame !== before.frame)
		return {
			ok: false,
			reason: `編集できない部分(${def.readonly}・見出しなど)が変わるため反映できません。編集できるのは ${labels.map((l) => `「${l}」`).join('')} だけです`
		};

	const changes: Partial<EntityMap[K]> = {};
	for (const f of def.fields) {
		const value = after.fields.get(f.label)!;
		if (value === before.fields.get(f.label)) continue;
		const parsed = f.parse(value, entity);
		if (!parsed) return { ok: false, reason: `「${f.label}」の値が不正です` };
		Object.assign(changes, parsed);
	}
	return { ok: true, content: result.content, index: result.index, changes };
}

/** propose_create で新規追加できる項目の種類(シーンの本文・履歴・相関図は対象外) */
export const CREATABLE_KINDS = [
	'characters',
	'plots',
	'worldbuilding',
	'memos',
	'progressLogs',
	'chapters'
] as const satisfies readonly EntityKind[];

/** propose_delete で削除できる項目の種類(章・履歴・相関図は対象外) */
export const DELETABLE_KINDS = [
	'characters',
	'plots',
	'worldbuilding',
	'memos',
	'progressLogs'
] as const satisfies readonly EntityKind[];

export type CreatableKind = (typeof CREATABLE_KINDS)[number];
export type DeletableKind = (typeof DELETABLE_KINDS)[number];

export function isCreatableKind(kind: string): kind is CreatableKind {
	return (CREATABLE_KINDS as readonly string[]).includes(kind);
}

export function isDeletableKind(kind: string): kind is DeletableKind {
	return (DELETABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * 新規追加のときだけ指定する項目(編集では変えられない名前・種類など)。
 * ここにある項目はすべて省略できない。
 */
export const CREATE_ONLY_FIELDS: Partial<Record<EntityKind, string[]>> = {
	chapters: ['タイトル'],
	characters: ['名前'],
	plots: ['タイトル', '種類'],
	worldbuilding: ['タイトル', '分類']
};

/** 新規追加で受け付ける項目名(作成時のみの項目 + 編集できる項目) */
export function createFieldLabels(kind: EntityKind): string[] {
	return [...(CREATE_ONLY_FIELDS[kind] ?? []), ...editableFields(kind)];
}

/**
 * 項目名 → 値(文字列)を、編集できるフィールドの変更に変換する(項目ファイルの「## 節」と同じ書式・検証)。
 * 項目名が違う・値が不正なら理由を返す。
 */
export function parseEditableValues<K extends EntityKind>(
	kind: K,
	entity: EntityMap[K],
	values: Record<string, string>
): { ok: true; changes: Partial<EntityMap[K]> } | { ok: false; reason: string } {
	const def = DEFS[kind] as EntityDef<EntityMap[K]>;
	const changes: Partial<EntityMap[K]> = {};
	for (const [label, value] of Object.entries(values)) {
		const field = def.fields.find((f) => f.label === label);
		if (!field) return { ok: false, reason: `未対応の項目名です: ${label}` };
		const parsed = field.parse(value.trim(), entity);
		if (!parsed) return { ok: false, reason: `「${label}」の値が不正です` };
		Object.assign(changes, parsed);
	}
	return { ok: true, changes };
}
