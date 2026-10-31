/**
 * チュートリアルから任意で作るサンプル作品。自動では作らない。
 * 作品 ID と子要素の ID を固定しているので、端末や同期先で重複して作られない。
 */
import { projectsDB, chaptersDB, scenesDB, charactersDB, plotsDB, worldbuildingDB } from '$lib/db';
import { queueChange } from '$lib/services/sync.service';
import type { Project } from '$lib/types';

export const SAMPLE_PROJECT_ID = 'sample-project-v1';

export async function hasSampleProject(): Promise<boolean> {
	return !!(await projectsDB.getById(SAMPLE_PROJECT_ID));
}

/**
 * サンプル作品を作る。既に存在すれば新規作成せず、その作品を返す(created: false)。
 * 途中で失敗したときは、中途半端な作品を残さないよう削除してから例外を投げ直す。
 */
export async function createSampleProject(): Promise<{ project: Project; created: boolean }> {
	const existing = await projectsDB.getById(SAMPLE_PROJECT_ID);
	if (existing) return { project: existing, created: false };

	try {
		const project = await projectsDB.create({
			id: SAMPLE_PROJECT_ID,
			title: 'サンプル作品',
			description:
				'Storift の操作を試すための短い作品です。自由に編集してかまいません。不要になったら削除できます。'
		});
		const projectId = project.id;

		// 章・シーンは順に作ることで、並び順(order)も通常の作成と同じになる
		const chapter1 = await chaptersDB.create({
			id: 'sample-chapter-1',
			projectId,
			title: '第一章 消えた灯り',
			synopsis: '潮見町の灯台の明かりが消えた朝、ミナトは異変に気づく。'
		});
		await scenesDB.create({
			id: 'sample-scene-1-1',
			chapterId: chapter1.id,
			projectId,
			title: '朝の灯台',
			content: [
				'夜明け前、潮見町の灯台は、いつものように光を回さなかった。',
				'ミナトは階段を駆け上がり、灯室の扉を開ける。レンズは曇ったまま、火は消えていた。',
				'「父さんは、どこへ行ったんだろう」',
				'返事の代わりに、窓の外で海鳥が一度だけ鳴いた。'
			].join('\n')
		});
		await scenesDB.create({
			id: 'sample-scene-1-2',
			chapterId: chapter1.id,
			projectId,
			title: '港の噂',
			content: [
				'港では、夜のうちに一隻の漁船が戻らなかったという話が広まっていた。',
				'幼なじみのハルは、網をたたみながら声を潜める。',
				'「あの船、灯台の火が消えた時間に沖にいたらしいよ」',
				'ミナトは黙って、消えた灯りのことを考えた。偶然にしては、重なりすぎている。'
			].join('\n')
		});

		const chapter2 = await chaptersDB.create({
			id: 'sample-chapter-2',
			projectId,
			title: '第二章 夜の海',
			synopsis: 'ハルと港を出た二人は、霧の中で父の手がかりを見つける。'
		});
		await scenesDB.create({
			id: 'sample-scene-2-1',
			chapterId: chapter2.id,
			projectId,
			title: '霧の中へ',
			content: [
				'その夜、二人は小さな帆船で港を出た。',
				'霧は白く重く、櫂の音だけが水面に響く。',
				'やがて、流れてきた浮きが一つ、ミナトの足元に引っかかった。父が仕掛けた印の色だった。',
				'「ここだ」とミナトは言った。「父さんは、この先にいる」'
			].join('\n')
		});

		// キャラクターは作成後に人物像を書き足す(相関図で関係が見えるよう、互いを参照する)
		await charactersDB.create({
			id: 'sample-character-1',
			projectId,
			name: 'ミナト',
			role: '主人公'
		});
		await charactersDB.update('sample-character-1', {
			appearance: '黒髪を短く切った十七歳の少年。日に焼けた腕をしている。',
			personality: '慎重で口数が少ないが、一度決めたら引かない。',
			background:
				'潮見町の灯台守の家に生まれた。父が行方を絶ってから、灯台の仕事を一人で引き受けている。',
			relationships: [{ characterId: 'sample-character-2', relation: '幼なじみ' }]
		});

		await charactersDB.create({
			id: 'sample-character-2',
			projectId,
			name: 'ハル',
			role: '相棒'
		});
		await charactersDB.update('sample-character-2', {
			appearance: '栗色の髪を一つに結んだ少女。港の網元の娘。',
			personality: '明るく率直で、思ったことをすぐ口にする。',
			background: '子どもの頃からミナトと港で遊んで育った。船の扱いはミナトより上手い。',
			relationships: [{ characterId: 'sample-character-1', relation: '幼なじみ' }]
		});

		await plotsDB.create({
			id: 'sample-plot-1',
			projectId,
			title: '灯台の火が消えた夜',
			type: 'arc',
			status: 'planned'
		});
		await plotsDB.update('sample-plot-1', {
			content:
				'第一章: ミナトが灯台の異変に気づく。\n第二章: ハルと海へ出て、父の手がかりを見つける。'
		});

		await worldbuildingDB.create({
			id: 'sample-worldbuilding-1',
			projectId,
			category: 'location',
			title: '潮見町(しおみちょう)',
			content:
				'海に面した小さな町。坂の上の灯台は、夜になると沖の船に港の位置を知らせてきた。町の人々は、灯りが消えると不安を覚える。'
		});

		// 同期キューへは、すべて作成し終えてから積む(途中で失敗した作品を送らないため)
		await queueChange('projects', projectId, 'create');
		for (const id of ['sample-chapter-1', 'sample-chapter-2']) {
			await queueChange('chapters', id, 'create');
		}
		for (const id of ['sample-scene-1-1', 'sample-scene-1-2', 'sample-scene-2-1']) {
			await queueChange('scenes', id, 'create');
		}
		for (const id of ['sample-character-1', 'sample-character-2']) {
			await queueChange('characters', id, 'create');
		}
		await queueChange('plots', 'sample-plot-1', 'create');
		await queueChange('worldbuilding', 'sample-worldbuilding-1', 'create');

		return { project, created: true };
	} catch (error) {
		await projectsDB.delete(SAMPLE_PROJECT_ID).catch((cleanupError) => {
			console.error('Failed to clean up partial sample project:', cleanupError);
		});
		throw error;
	}
}
