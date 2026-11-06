import { differingKeys } from './conflictContent';

/**
 * 競合ダイアログの表示用データ(純粋なロジック)。
 * 種類・題名・差のあるフィールドの抜粋を作る。日時の整形は表示側で行う。
 */

const ENTITY_LABELS: Record<string, string> = {
	projects: 'プロジェクト',
	chapters: '章',
	scenes: 'シーン',
	characters: '人物',
	plots: 'プロット',
	worldbuilding: '設定資料'
};

const FIELD_LABELS: Record<string, string> = {
	title: '題名',
	name: '名前',
	content: '本文',
	synopsis: 'あらすじ',
	description: '説明',
	order: '並び順',
	tags: 'タグ',
	characterCount: '文字数',
	chapterId: '所属する章',
	role: '役割',
	appearance: '外見',
	personality: '性格',
	background: '背景',
	relationships: '人間関係',
	type: '種類',
	status: '状態',
	category: '分類',
	color: '色',
	position: '位置',
	attachments: '添付',
	settings: '設定',
	sharing: '共有設定'
};

/** 抜粋の長さ(文字数) */
const EXCERPT_LENGTH = 40;
const LONG_TEXT_LENGTH = 60;

export interface FieldDiff {
	key: string;
	label: string;
	local: string;
	remote: string;
	/** 補足(本文の文字数差など) */
	note?: string;
}

export interface ConflictSummary {
	kindLabel: string;
	/** 題名(シーン名・章名・人物名など)。無ければ空文字 */
	title: string;
	diffs: FieldDiff[];
}

export const entityKindLabel = (type: string): string => ENTITY_LABELS[type] ?? type;

export function entityTitle(entity: object): string {
	const e = entity as { title?: unknown; name?: unknown };
	const value = typeof e.title === 'string' && e.title ? e.title : e.name;
	return typeof value === 'string' ? value : '';
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** 値の短い抜粋。長い文字列は先頭だけと全体の文字数 */
export function excerptOf(value: unknown): string {
	if (value === undefined || value === null || value === '') return '(なし)';
	if (typeof value === 'string') {
		const text = oneLine(value);
		if (value.length <= LONG_TEXT_LENGTH) return text || '(空白のみ)';
		return `${text.slice(0, EXCERPT_LENGTH)}…(全${value.length}文字)`;
	}
	if (typeof value === 'object') {
		const json = JSON.stringify(value);
		return json.length <= LONG_TEXT_LENGTH
			? json
			: `${json.slice(0, EXCERPT_LENGTH)}…(全${json.length}文字)`;
	}
	return String(value);
}

export function describeConflict(type: string, local: object, remote: object): ConflictSummary {
	const l = local as Record<string, unknown>;
	const r = remote as Record<string, unknown>;
	const diffs = differingKeys(local, remote).map((key): FieldDiff => {
		const diff: FieldDiff = {
			key,
			label: FIELD_LABELS[key] ?? key,
			local: excerptOf(l[key]),
			remote: excerptOf(r[key])
		};
		if (typeof l[key] === 'string' && typeof r[key] === 'string' && key === 'content') {
			const delta = (r[key] as string).length - (l[key] as string).length;
			diff.note = `他の端末は この端末より ${delta >= 0 ? '+' : ''}${delta}文字`;
		}
		return diff;
	});
	return {
		kindLabel: entityKindLabel(type),
		title: entityTitle(remote) || entityTitle(local),
		diffs
	};
}
