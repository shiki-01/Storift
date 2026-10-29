/**
 * Claude Code に読ませるため、全プロジェクトを Markdown に書き出す。
 *
 * 書き出し先はデスクトップアプリのデータディレクトリ内の workspace/ で、
 * Claude Code はそこを作業ディレクトリとして起動する(src-tauri/src/workspace.rs)。
 * ファイルはアプリ → ディスクの一方向で、ディスク側の変更はアプリに戻らない。
 */
import { db } from '$lib/db';
import type { Chapter, Character, Plot, Project, Scene, Worldbuilding } from '$lib/types';

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
}

export interface WorkspaceData {
	projects: Project[];
	chapters: Chapter[];
	scenes: Scene[];
	characters: Character[];
	plots: Plot[];
	worldbuilding: Worldbuilding[];
}

const STATUS_LABELS: Record<Project['status'], string> = {
	draft: '構想中',
	writing: '執筆中',
	completed: '完結'
};

const WORLD_LABELS: Record<Worldbuilding['category'], string> = {
	term: '用語',
	location: '場所',
	timeline: '年表',
	other: 'その他'
};

const PLOT_TYPE_LABELS: Record<Plot['type'], string> = {
	arc: '全体の流れ',
	chapter: '章',
	scene: 'シーン'
};

const PLOT_STATUS_LABELS: Record<Plot['status'], string> = {
	idea: 'アイデア',
	planned: '予定',
	written: '執筆済み',
	revised: '推敲済み'
};

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

/** IndexedDB の内容から、ワークスペースに置くファイル一式を作る */
export function buildWorkspace(data: WorkspaceData): WorkspaceExport {
	const files: WorkspaceFile[] = [];
	const projectDirs: Record<string, string> = {};
	const sceneFiles: Record<string, string> = {};

	const chaptersByProject = groupBy(data.chapters, (c) => c.projectId);
	const scenesByChapter = groupBy(data.scenes, (s) => s.chapterId);
	const charactersByProject = groupBy(data.characters, (c) => c.projectId);
	const plotsByProject = groupBy(data.plots, (p) => p.projectId);
	const worldByProject = groupBy(data.worldbuilding, (w) => w.projectId);

	// 同名のプロジェクトがあってもフォルダが衝突しないよう、2 つ目以降は ID を添える
	const usedDirs = new Set<string>();
	const projects = [...data.projects].sort((a, b) => b.updatedAt - a.updatedAt);
	const index: string[] = [];

	for (const project of projects) {
		let dirName = safeName(project.title);
		if (usedDirs.has(dirName)) dirName = `${dirName}-${project.id.slice(0, 6)}`;
		usedDirs.add(dirName);
		const dir = `projects/${dirName}`;
		projectDirs[project.id] = dir;

		const chapters = byOrder(chaptersByProject.get(project.id) ?? []);
		const toc: string[] = [];
		let totalChars = 0;

		chapters.forEach((chapter, ci) => {
			const chapterDir = `${dir}/本文/${pad(ci)}_${safeName(chapter.title)}`;
			const scenes = byOrder(scenesByChapter.get(chapter.id) ?? []);
			toc.push(`- 第${ci + 1}章 ${chapter.title}`);
			if (chapter.synopsis?.trim()) {
				files.push({
					path: `${chapterDir}/00_章の概要.md`,
					content: `# ${chapter.title}(概要)\n\n${chapter.synopsis.trim()}\n`
				});
			}
			scenes.forEach((scene, si) => {
				const path = `${chapterDir}/${pad(si)}_${safeName(scene.title)}.md`;
				sceneFiles[scene.id] = path;
				const chars = scene.content.length;
				totalChars += chars;
				toc.push(`  - ${scene.title}(${chars}字): \`${path.slice(dir.length + 1)}\``);
				files.push({ path, content: `# ${scene.title}\n\n${scene.content}\n` });
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
	return { files, projectDirs, sceneFiles };
}

function claudeMd(index: string[]): string {
	return `# Storift ワークスペース

このディレクトリは小説執筆アプリ Storift の全プロジェクトを書き出したものです。
あなたは執筆を支援するアシスタントとして、ユーザーの文章チェックや相談に応えます。

## 構成

- \`projects/<作品名>/概要.md\`: 作品の説明・目次・文字数
- \`projects/<作品名>/本文/<章番号>_<章名>/<シーン番号>_<シーン名>.md\`: 本文(1 シーン 1 ファイル)
- \`projects/<作品名>/キャラクター.md\` / \`設定資料.md\` / \`プロット.md\`

## 注意

- ここのファイルはアプリから自動で書き出した読み取り専用の写しです。編集してもアプリには反映されません。
  修正を提案するときは、ファイルを書き換えずに「元の文 → 修正案」の形で回答に書いてください。
- ユーザーのメッセージ冒頭の <storift_context> は、アプリで今開いている作品・シーンの情報です。
  <attached_text> はユーザーが添付した文章(未保存の最新の本文を含むことがあります)で、ファイルより優先します。
- 回答は日本語で、簡潔に。指摘には該当箇所(ファイルと引用)を添えてください。
- 作品をまたいだ質問(設定の使い回し、表記の統一など)には、必要な作品のファイルを Grep / Read して答えてください。

## 作品一覧

${index.length ? index.join('\n') : '(まだ作品がありません)'}
`;
}

/** IndexedDB から全プロジェクトを読み込む */
export async function loadWorkspaceData(): Promise<WorkspaceData> {
	const [projects, chapters, scenes, characters, plots, worldbuilding] = await Promise.all([
		db.projects.toArray(),
		db.chapters.toArray(),
		db.scenes.toArray(),
		db.characters.toArray(),
		db.plots.toArray(),
		db.worldbuilding.toArray()
	]);
	return { projects, chapters, scenes, characters, plots, worldbuilding };
}
