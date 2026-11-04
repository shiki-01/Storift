/**
 * Claude Code に読ませるため、全プロジェクトを Markdown に書き出す。
 *
 * 書き出し先はデスクトップアプリのデータディレクトリ内の workspace/ で、
 * Claude Code はそこを作業ディレクトリとして起動する(src-tauri/src/workspace.rs)。
 * ファイルはアプリ → ディスクの一方向で、ディスク側の変更はアプリに戻らない。
 */
import { db, memosDB } from '$lib/db';
import type { Table } from 'dexie';
import type {
	Chapter,
	Character,
	History,
	Memo,
	Plot,
	ProgressLog,
	Project,
	RelationMap,
	Scene,
	Worldbuilding
} from '$lib/types';
import {
	PLOT_STATUS_LABELS,
	PLOT_TYPE_LABELS,
	WORLD_LABELS,
	entityTitle,
	renderEntity,
	type EntityContext,
	type EntityKind,
	type EntityMap,
	type EntityRef
} from './entities';

export interface WorkspaceFile {
	path: string;
	content: string;
}

export interface WorkspaceExport {
	files: WorkspaceFile[];
	/** プロジェクト ID → フォルダ(ワークスペースからの相対パス) */
	projectDirs: Record<string, string>;
	/** シーン ID → ファイル(ワークスペースからの相対パス) */
	sceneFiles: Record<string, string>;
	/** 項目ファイル(キャラクター・設定資料・プロット・メモ・章の概要・進捗・履歴・相関図) → 種別と ID。編集できるのはこれらだけ(履歴は読み取り専用) */
	entityFiles: Record<string, EntityRef>;
}

export interface WorkspaceData {
	projects: Project[];
	chapters: Chapter[];
	scenes: Scene[];
	characters: Character[];
	plots: Plot[];
	worldbuilding: Worldbuilding[];
	memos: Memo[];
	progressLogs: ProgressLog[];
	history: History[];
	relationMaps: RelationMap[];
}

export const STATUS_LABELS: Record<Project['status'], string> = {
	draft: '構想中',
	writing: '執筆中',
	completed: '完結'
};

/** 作品ごとに履歴ファイルとして書き出す最大件数(新しい順) */
const MAX_HISTORY_FILES = 100;

/** ファイル名に使えない文字を除き、長すぎる名前を切り詰める */
export function safeName(name: string, fallback = '無題'): string {
	const cleaned = name
		// eslint-disable-next-line no-control-regex -- 制御文字はファイル名に使えない
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+|\.+$/g, '')
		.slice(0, 60)
		.trim();
	return cleaned || fallback;
}

function pad(n: number): string {
	return String(n + 1).padStart(2, '0');
}

function byOrder<T extends { order: number }>(items: T[]): T[] {
	return [...items].sort((a, b) => a.order - b.order);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = map.get(k);
		if (list) list.push(item);
		else map.set(k, [item]);
	}
	return map;
}

/** 同名のプロジェクトがあってもフォルダが衝突しないよう、2 つ目以降は ID を添える(更新が新しい順に割り当てる) */
function assignProjectDirs(projects: Project[]): Record<string, string> {
	const used = new Set<string>();
	const out: Record<string, string> = {};
	for (const project of [...projects].sort((a, b) => b.updatedAt - a.updatedAt)) {
		let dirName = safeName(project.title);
		if (used.has(dirName)) dirName = `${dirName}-${project.id.slice(0, 6)}`;
		used.add(dirName);
		out[project.id] = `projects/${dirName}`;
	}
	return out;
}

/** 項目ファイルを置くフォルダ名(章の概要は本文の下なのでここには無い) */
const ENTITY_DIR_NAMES: Partial<Record<EntityKind, string>> = {
	characters: 'キャラクター',
	worldbuilding: '設定資料',
	plots: 'プロット',
	memos: 'メモ',
	progressLogs: '進捗',
	relationMaps: '相関図',
	history: '履歴'
};

function entityDirOf(projectDir: string, kind: EntityKind): string {
	return `${projectDir}/${ENTITY_DIR_NAMES[kind]}`;
}

function chapterDirOf(projectDir: string, index: number, chapter: Chapter): string {
	return `${projectDir}/本文/${pad(index)}_${safeName(chapter.title)}`;
}

function synopsisPathOf(chapterDir: string): string {
	return `${chapterDir}/00_章の概要.md`;
}

function scenePathOf(chapterDir: string, index: number, scene: Scene): string {
	return `${chapterDir}/${pad(index)}_${safeName(scene.title)}.md`;
}

/** 書き出す順に並べた項目(プロットは order、メモは作成順、進捗は日付順) */
function sortedItems<K extends EntityKind>(kind: K, items: EntityMap[K][]): EntityMap[K][] {
	if (kind === 'plots') return byOrder(items as unknown as Plot[]) as unknown as EntityMap[K][];
	if (kind === 'memos')
		return [...(items as unknown as Memo[])].sort(
			(a, b) => a.createdAt - b.createdAt
		) as unknown as EntityMap[K][];
	if (kind === 'progressLogs')
		return [...(items as unknown as ProgressLog[])].sort((a, b) =>
			a.date.localeCompare(b.date)
		) as unknown as EntityMap[K][];
	return items;
}

/** 項目 ID → ファイル名(拡張子なし)。同名は ID を添えて分ける */
function uniqueFileNames<K extends EntityKind>(
	kind: K,
	items: EntityMap[K][]
): Map<string, string> {
	const used = new Set<string>();
	const names = new Map<string, string>();
	for (const item of items) {
		let name = safeName(entityTitle(kind, item));
		if (used.has(name)) name = `${name}-${item.id.slice(0, 6)}`;
		used.add(name);
		names.set(item.id, name);
	}
	return names;
}

/** メモ一覧。タグ・完了状態・引用を付け、作成の古い順に並べる */
function memosMarkdown(project: Project, memos: Memo[], sceneTitles: Map<string, string>): string {
	const lines = [`# メモ(${project.title})\n`];
	for (const m of [...memos].sort((a, b) => a.createdAt - b.createdAt)) {
		const [first, ...rest] = m.text.trim().split('\n');
		lines.push(`## ${m.done ? '[完了]' : '[未完了]'} ${first.slice(0, 60)}\n`);
		const meta = [
			m.tags.length && `タグ: ${m.tags.map((t) => `#${t}`).join(' ')}`,
			m.sceneId && sceneTitles.has(m.sceneId) && `シーン: ${sceneTitles.get(m.sceneId)}`,
			m.anchor?.quote && `本文の引用: 「${m.anchor.quote.replace(/\s+/g, ' ')}」`,
			m.requestedAt && '依頼: Claude に依頼済み'
		].filter(Boolean);
		if (meta.length) lines.push(meta.map((x) => `- ${x}`).join('\n') + '\n');
		if (rest.length) lines.push(`${rest.join('\n')}\n`);
	}
	return lines.join('\n');
}

function section(title: string, body: string | undefined): string {
	const text = body?.trim();
	return text ? `### ${title}\n\n${text}\n` : '';
}

function charactersMarkdown(project: Project, characters: Character[]): string {
	const names = new Map(characters.map((c) => [c.id, c.name]));
	const lines = [`# キャラクター(${project.title})\n`];
	for (const c of characters) {
		lines.push(`## ${c.name}\n`);
		const meta = [
			c.role && `役割: ${c.role}`,
			c.age != null && `年齢: ${c.age}`,
			c.gender && `性別: ${c.gender}`
		].filter(Boolean);
		if (meta.length) lines.push(meta.map((m) => `- ${m}`).join('\n') + '\n');
		lines.push(section('外見', c.appearance));
		lines.push(section('性格', c.personality));
		lines.push(section('背景', c.background));
		const relations = (c.relationships ?? [])
			.filter((r) => names.has(r.characterId))
			.map((r) => `- ${names.get(r.characterId)}: ${r.relation}`);
		if (relations.length) lines.push(`### 関係\n\n${relations.join('\n')}\n`);
	}
	return lines.filter(Boolean).join('\n');
}

function worldbuildingMarkdown(project: Project, items: Worldbuilding[]): string {
	const lines = [`# 設定資料(${project.title})\n`];
	const groups = groupBy(items, (w) => w.category);
	for (const category of Object.keys(WORLD_LABELS) as Worldbuilding['category'][]) {
		const list = groups.get(category);
		if (!list?.length) continue;
		lines.push(`## ${WORLD_LABELS[category]}\n`);
		for (const w of list) {
			lines.push(`### ${w.title}\n`);
			if (w.tags?.length) lines.push(`タグ: ${w.tags.join(', ')}\n`);
			if (w.content?.trim()) lines.push(`${w.content.trim()}\n`);
		}
	}
	return lines.join('\n');
}

function plotMarkdown(project: Project, plots: Plot[]): string {
	const lines = [`# プロット(${project.title})\n`];
	for (const p of byOrder(plots)) {
		lines.push(`## ${p.title}\n`);
		lines.push(`- 種類: ${PLOT_TYPE_LABELS[p.type] ?? p.type}`);
		lines.push(`- 状態: ${PLOT_STATUS_LABELS[p.status] ?? p.status}\n`);
		if (p.content?.trim()) lines.push(`${p.content.trim()}\n`);
	}
	return lines.join('\n');
}

/** 項目ファイルの組み立て・解析に必要な、他の項目の情報 */
export function entityContext(data: WorkspaceData): EntityContext {
	return {
		characterNames: new Map(data.characters.map((c) => [c.id, c.name])),
		sceneTitles: new Map(data.scenes.map((s) => [s.id, s.title]))
	};
}

/**
 * IndexedDB の内容から、ワークスペースに置くファイル一式を作る。
 * overrides はシーン ID → 本文で、エディタの未保存の本文を反映するのに使う
 * (本文を毎回プロンプトに添付せず、Claude が必要なときにファイルを読めば済むようにするため)。
 */
export function buildWorkspace(
	data: WorkspaceData,
	overrides: Record<string, string> = {}
): WorkspaceExport {
	const files: WorkspaceFile[] = [];
	const projectDirs: Record<string, string> = {};
	const sceneFiles: Record<string, string> = {};
	const entityFiles: Record<string, EntityRef> = {};
	const ctx = entityContext(data);

	/** 項目 1 つ 1 ファイルで書き出す(同名は ID を添えて分ける) */
	const addEntityFiles = <K extends EntityKind>(dir: string, kind: K, items: EntityMap[K][]) => {
		const names = uniqueFileNames(kind, items);
		for (const item of items) {
			const path = `${dir}/${names.get(item.id)}.md`;
			entityFiles[path] = { kind, id: item.id };
			files.push({ path, content: renderEntity(kind, item, ctx) });
		}
	};

	const chaptersByProject = groupBy(data.chapters, (c) => c.projectId);
	const scenesByChapter = groupBy(data.scenes, (s) => s.chapterId);
	const charactersByProject = groupBy(data.characters, (c) => c.projectId);
	const plotsByProject = groupBy(data.plots, (p) => p.projectId);
	const worldByProject = groupBy(data.worldbuilding, (w) => w.projectId);
	const memosByProject = groupBy(data.memos, (m) => m.projectId);
	const logsByProject = groupBy(data.progressLogs, (l) => l.projectId);
	const historyByProject = groupBy(data.history, (h) => h.projectId);
	const mapsByProject = groupBy(data.relationMaps, (m) => m.projectId);
	const sceneTitles = new Map(data.scenes.map((s) => [s.id, s.title]));

	const projects = [...data.projects].sort((a, b) => b.updatedAt - a.updatedAt);
	const dirs = assignProjectDirs(data.projects);
	const index: string[] = [];

	for (const project of projects) {
		const dir = dirs[project.id];
		projectDirs[project.id] = dir;

		const chapters = byOrder(chaptersByProject.get(project.id) ?? []);
		const toc: string[] = [];
		let totalChars = 0;

		chapters.forEach((chapter, ci) => {
			const chapterDir = chapterDirOf(dir, ci, chapter);
			const scenes = byOrder(scenesByChapter.get(chapter.id) ?? []);
			toc.push(`- 第${ci + 1}章 ${chapter.title}`);
			// 概要が空でも書き出し、Claude が書き足せるようにする
			const synopsisPath = synopsisPathOf(chapterDir);
			entityFiles[synopsisPath] = { kind: 'chapters', id: chapter.id };
			files.push({ path: synopsisPath, content: renderEntity('chapters', chapter, ctx) });
			scenes.forEach((scene, si) => {
				const path = scenePathOf(chapterDir, si, scene);
				sceneFiles[scene.id] = path;
				const content = overrides[scene.id] ?? scene.content;
				const chars = content.length;
				totalChars += chars;
				toc.push(`  - ${scene.title}(${chars}字): \`${path.slice(dir.length + 1)}\``);
				files.push({ path, content: `# ${scene.title}\n\n${content}\n` });
			});
		});

		const characters = charactersByProject.get(project.id) ?? [];
		const plots = plotsByProject.get(project.id) ?? [];
		const world = worldByProject.get(project.id) ?? [];
		if (characters.length)
			files.push({
				path: `${dir}/キャラクター.md`,
				content: charactersMarkdown(project, characters)
			});
		if (world.length)
			files.push({ path: `${dir}/設定資料.md`, content: worldbuildingMarkdown(project, world) });
		if (plots.length)
			files.push({ path: `${dir}/プロット.md`, content: plotMarkdown(project, plots) });
		const memos = memosByProject.get(project.id) ?? [];
		if (memos.length)
			files.push({
				path: `${dir}/メモ.md`,
				content: memosMarkdown(project, memos, sceneTitles)
			});
		addEntityFiles(entityDirOf(dir, 'characters'), 'characters', characters);
		addEntityFiles(entityDirOf(dir, 'worldbuilding'), 'worldbuilding', world);
		addEntityFiles(entityDirOf(dir, 'plots'), 'plots', byOrder(plots));
		addEntityFiles(entityDirOf(dir, 'memos'), 'memos', sortedItems('memos', memos));
		addEntityFiles(
			entityDirOf(dir, 'progressLogs'),
			'progressLogs',
			sortedItems('progressLogs', logsByProject.get(project.id) ?? [])
		);
		addEntityFiles(
			entityDirOf(dir, 'relationMaps'),
			'relationMaps',
			mapsByProject.get(project.id) ?? []
		);
		// 履歴は件数が増え続けるため、新しい順に上限までにする
		addEntityFiles(
			entityDirOf(dir, 'history'),
			'history',
			[...(historyByProject.get(project.id) ?? [])]
				.sort((a, b) => b.createdAt - a.createdAt)
				.slice(0, MAX_HISTORY_FILES)
		);

		files.push({
			path: `${dir}/概要.md`,
			content: [
				`# ${project.title}\n`,
				`- 状態: ${STATUS_LABELS[project.status] ?? project.status}`,
				`- 文字数: ${totalChars}`,
				`- 書字方向: ${project.settings?.writingMode === 'vertical' ? '縦書き' : '横書き'}\n`,
				project.description?.trim() ? `## 説明\n\n${project.description.trim()}\n` : '',
				`## 目次\n`,
				toc.length ? toc.join('\n') : '(まだ章がありません)',
				''
			].join('\n')
		});
		index.push(`- ${project.title}: \`${dir}/\`(${totalChars}字)`);
	}

	files.push({ path: 'CLAUDE.md', content: claudeMd(index) });
	return { files, projectDirs, sceneFiles, entityFiles };
}

function claudeMd(index: string[]): string {
	return `# Storift ワークスペース

このディレクトリは小説執筆アプリ Storift の全プロジェクトを書き出したものです。
あなたは執筆を支援するアシスタントとして、ユーザーの文章チェックや相談に応えます。

## 構成

- \`projects/<作品名>/概要.md\`: 作品の説明・目次・文字数
- \`projects/<作品名>/本文/<章番号>_<章名>/<シーン番号>_<シーン名>.md\`: 本文(1 シーン 1 ファイル)
- \`projects/<作品名>/キャラクター.md\` / \`設定資料.md\` / \`プロット.md\` / \`メモ.md\`(タグ・完了状態・引用付き): 一覧。読む用で、編集の対象にはならない
- \`projects/<作品名>/キャラクター/<名前>.md\` / \`設定資料/\` / \`プロット/\` / \`メモ/\`: 1 項目 1 ファイル。「## フィールド名」の節が編集できる部分
- \`projects/<作品名>/本文/<章>/00_章の概要.md\`: 章の概要
- \`projects/<作品名>/進捗/\` / \`相関図/\`: 進捗ログ(日付・文字数・時間)と相関図の配置(座標)。\`履歴/\` は読み取り専用

## 注意

- ここのファイルはアプリから自動で書き出した読み取り専用の写しです。編集してもアプリには反映されません。
  修正を提案するときは、ファイルを書き換えずに「元の文 → 修正案」の形で回答に書いてください。
- ユーザーのメッセージ冒頭の <storift_context> は、アプリで今開いている作品・シーンの情報です。
  開いているシーンのファイルには、エディタの未保存の本文も反映済みです。「このシーン」と言われたらそのファイルを読んでください。
- <quote> はユーザーがエディタで選択して引用した部分です。質問はその部分についてのものとして答えてください。
  前後の文脈が必要なら、属性 file のファイルを読んでください。
- 回答は日本語で、簡潔に。指摘には該当箇所(ファイルと引用)を添えてください。
- 作品をまたいだ質問(設定の使い回し、表記の統一など)には、必要な作品のファイルを Grep / Read して答えてください。

## 作品一覧

${index.length ? index.join('\n') : '(まだ作品がありません)'}
`;
}

/* 項目 1 件だけを DB から読む(全件を読み込まずに、提案の検証や反映をするため) */

const ENTITY_TABLES: { [K in EntityKind]: () => Table<EntityMap[K], string> } = {
	chapters: () => db.chapters,
	characters: () => db.characters,
	plots: () => db.plots,
	worldbuilding: () => db.worldbuilding,
	memos: () => db.memos,
	progressLogs: () => db.progressLogs,
	history: () => db.history,
	relationMaps: () => db.relationMaps
};

/** 項目のテーブル(IndexedDB) */
export function entityTable<K extends EntityKind>(kind: K): Table<EntityMap[K], string> {
	return ENTITY_TABLES[kind]() as Table<EntityMap[K], string>;
}

/** 項目 1 件ぶんのファイルを組み立てるのに必要な、他の項目の情報だけを読む */
export async function entityContextFor<K extends EntityKind>(
	kind: K,
	entity: EntityMap[K]
): Promise<EntityContext> {
	const characterIds: string[] = [];
	const sceneIds: string[] = [];
	if (kind === 'characters')
		characterIds.push(...(entity as Character).relationships.map((r) => r.characterId));
	if (kind === 'relationMaps') characterIds.push(...Object.keys((entity as RelationMap).positions));
	if (kind === 'memos' && (entity as Memo).sceneId) sceneIds.push((entity as Memo).sceneId!);
	if (kind === 'progressLogs') sceneIds.push(...((entity as ProgressLog).sceneIds ?? []));
	const [characters, scenes] = await Promise.all([
		characterIds.length ? db.characters.bulkGet(characterIds) : [],
		sceneIds.length ? db.scenes.bulkGet(sceneIds) : []
	]);
	return {
		characterNames: new Map(characters.filter((c) => !!c).map((c) => [c!.id, c!.name])),
		sceneTitles: new Map(scenes.filter((s) => !!s).map((s) => [s!.id, s!.title]))
	};
}

/** 項目 1 件と、そのファイルの描画に必要な情報を読む。無ければ undefined */
export async function loadEntity<K extends EntityKind>(ref: {
	kind: K;
	id: string;
}): Promise<{ entity: EntityMap[K]; ctx: EntityContext } | undefined> {
	const entity = await entityTable(ref.kind).get(ref.id);
	if (!entity) return undefined;
	return { entity, ctx: await entityContextFor(ref.kind, entity) };
}

/** シーンのファイルのパス(ワークスペースからの相対)。見つからなければ空文字 */
export async function sceneFilePath(sceneId: string): Promise<string> {
	const scene = await db.scenes.get(sceneId);
	if (!scene) return '';
	const [projects, chapters, siblings] = await Promise.all([
		db.projects.toArray(),
		db.chapters.where('projectId').equals(scene.projectId).toArray(),
		db.scenes.where('chapterId').equals(scene.chapterId).toArray()
	]);
	const dir = assignProjectDirs(projects)[scene.projectId];
	const sorted = byOrder(chapters);
	const ci = sorted.findIndex((c) => c.id === scene.chapterId);
	if (!dir || ci < 0) return '';
	const si = byOrder(siblings).findIndex((s) => s.id === scene.id);
	return scenePathOf(chapterDirOf(dir, ci, sorted[ci]), si, scene);
}

/** 項目ファイルのパス(ワークスペースからの相対)。見つからなければ空文字 */
export async function entityFilePath(
	kind: EntityKind,
	entity: EntityMap[EntityKind]
): Promise<string> {
	const projectId = entity.projectId;
	const projects = await db.projects.toArray();
	const dir = assignProjectDirs(projects)[projectId];
	if (!dir) return '';
	if (kind === 'chapters') {
		const chapters = byOrder(await db.chapters.where('projectId').equals(projectId).toArray());
		const ci = chapters.findIndex((c) => c.id === entity.id);
		return ci < 0 ? '' : synopsisPathOf(chapterDirOf(dir, ci, chapters[ci]));
	}
	const table = entityTable(kind) as unknown as Table<EntityMap[EntityKind], string>;
	const items = sortedItems(
		kind as 'plots',
		(await table.where('projectId').equals(projectId).toArray()) as Plot[]
	);
	const name = uniqueFileNames(kind as 'plots', items).get(entity.id);
	return name ? `${entityDirOf(dir, kind)}/${name}.md` : '';
}

/** IndexedDB から全プロジェクトを読み込む */
export async function loadWorkspaceData(): Promise<WorkspaceData> {
	const [
		projects,
		chapters,
		scenes,
		characters,
		plots,
		worldbuilding,
		memos,
		progressLogs,
		history,
		relationMaps
	] = await Promise.all([
		db.projects.toArray(),
		db.chapters.toArray(),
		db.scenes.toArray(),
		db.characters.toArray(),
		db.plots.toArray(),
		db.worldbuilding.toArray(),
		memosDB.getAll(),
		db.progressLogs.toArray(),
		db.history.toArray(),
		db.relationMaps.toArray()
	]);
	return {
		projects,
		chapters,
		scenes,
		characters,
		plots,
		worldbuilding,
		memos,
		progressLogs,
		history,
		relationMaps
	};
}
