import { db } from '$lib/db';
import type { Project } from '$lib/types/project';
import type { Chapter } from '$lib/types/chapter';
import type { Scene } from '$lib/types/scene';

export interface ExportOptions {
	format: 'txt' | 'md' | 'docx' | 'pdf' | 'json' | 'epub';
	includeMetadata?: boolean;
	chapterNumbers?: boolean;
	sceneBreaker?: string;
	pageBreaks?: boolean;
	fontSize?: number;
	fontFamily?: string;
}

/**
 * プロジェクトをエクスポート
 */
export async function exportProject(projectId: string, options: ExportOptions): Promise<void> {
	const project = await db.projects.get(projectId);
	if (!project) throw new Error('Project not found');

	const chapters = await db.chapters.where('projectId').equals(projectId).sortBy('order');
	const scenes = await db.scenes.where('projectId').equals(projectId).toArray();

	switch (options.format) {
		case 'txt':
			return exportAsText(project, chapters, scenes, options);
		case 'md':
			return exportAsMarkdown(project, chapters, scenes, options);
		case 'docx':
			return exportAsDocx(project, chapters, scenes, options);
		case 'pdf':
			return exportAsPdf(project, chapters, scenes, options);
		case 'json':
			return exportAsJson(projectId);
		case 'epub':
			return exportAsEpub(project, chapters, scenes);
		default:
			throw new Error(`Unsupported format: ${options.format}`);
	}
}

/**
 * テキストファイルとしてエクスポート
 */
async function exportAsText(
	project: Project,
	chapters: Chapter[],
	scenes: Scene[],
	options: ExportOptions
): Promise<void> {
	const { saveAs } = await import('file-saver');
	let content = '';

	// メタデータ
	if (options.includeMetadata) {
		content += `タイトル: ${project.title}\n`;
		content += `説明: ${project.description}\n`;
		content += `作成日: ${new Date(project.createdAt).toLocaleDateString('ja-JP')}\n`;
		content += `\n${'='.repeat(50)}\n\n`;
	}

	// 章とシーンの内容
	for (const chapter of chapters) {
		const chapterScenes = scenes
			.filter((s) => s.chapterId === chapter.id)
			.sort((a, b) => a.order - b.order);

		if (options.chapterNumbers) {
			content += `第${chapter.order + 1}章 ${chapter.title}\n\n`;
		} else {
			content += `${chapter.title}\n\n`;
		}

		for (const scene of chapterScenes) {
			content += scene.content;
			if (options.sceneBreaker) {
				content += `\n\n${options.sceneBreaker}\n\n`;
			} else {
				content += '\n\n';
			}
		}

		content += '\n\n';
	}

	const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
	saveAs(blob, `${project.title}.txt`);
}

/**
 * Markdownファイルとしてエクスポート
 */
async function exportAsMarkdown(
	project: Project,
	chapters: Chapter[],
	scenes: Scene[],
	options: ExportOptions
): Promise<void> {
	const { saveAs } = await import('file-saver');
	let content = '';

	// メタデータ
	if (options.includeMetadata) {
		content += `# ${project.title}\n\n`;
		content += `**説明:** ${project.description}\n\n`;
		content += `**作成日:** ${new Date(project.createdAt).toLocaleDateString('ja-JP')}\n\n`;
		content += `---\n\n`;
	}

	// 章とシーンの内容
	for (const chapter of chapters) {
		const chapterScenes = scenes
			.filter((s) => s.chapterId === chapter.id)
			.sort((a, b) => a.order - b.order);

		if (options.chapterNumbers) {
			content += `## 第${chapter.order + 1}章 ${chapter.title}\n\n`;
		} else {
			content += `## ${chapter.title}\n\n`;
		}

		if (chapter.synopsis) {
			content += `> ${chapter.synopsis}\n\n`;
		}

		for (const scene of chapterScenes) {
			content += scene.content;
			if (options.sceneBreaker) {
				content += `\n\n${options.sceneBreaker}\n\n`;
			} else {
				content += '\n\n';
			}
		}

		content += '\n\n';
	}

	const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
	saveAs(blob, `${project.title}.md`);
}

/**
 * PDFファイルとしてエクスポート
 */
async function exportAsPdf(
	project: Project,
	chapters: Chapter[],
	scenes: Scene[],
	options: ExportOptions
): Promise<void> {
	const { default: jsPDF } = await import('jspdf');

	const doc = new jsPDF({
		orientation: 'portrait',
		unit: 'mm',
		format: 'a4'
	});

	// 日本語フォント対応が必要な場合は別途設定
	const fontSize = options.fontSize || 12;
	const lineHeight = fontSize * 1.5;
	const margin = 20;
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const maxWidth = pageWidth - margin * 2;

	let y = margin;

	// タイトルページ
	if (options.includeMetadata) {
		doc.setFontSize(24);
		doc.text(project.title, pageWidth / 2, y, { align: 'center' });
		y += 20;

		doc.setFontSize(12);
		doc.text(project.description, margin, y, { maxWidth });
		y += 30;
	}

	// 章とシーンの内容
	doc.setFontSize(fontSize);

	for (const chapter of chapters) {
		const chapterScenes = scenes
			.filter((s) => s.chapterId === chapter.id)
			.sort((a, b) => a.order - b.order);

		// 新しいページで章を開始
		if (options.pageBreaks && y > margin) {
			doc.addPage();
			y = margin;
		}

		// 章タイトル
		doc.setFontSize(fontSize + 4);
		const chapterTitle = options.chapterNumbers
			? `第${chapter.order + 1}章 ${chapter.title}`
			: chapter.title;
		doc.text(chapterTitle, margin, y);
		y += lineHeight * 2;

		doc.setFontSize(fontSize);

		// シーンの内容
		for (const scene of chapterScenes) {
			const lines = doc.splitTextToSize(scene.content, maxWidth);

			for (const line of lines) {
				if (y + lineHeight > pageHeight - margin) {
					doc.addPage();
					y = margin;
				}
				doc.text(line, margin, y);
				y += lineHeight;
			}

			y += lineHeight; // シーン間のスペース
		}

		y += lineHeight * 2; // 章間のスペース
	}

	doc.save(`${project.title}.pdf`);
}

/**
 * DOCXファイルとしてエクスポート
 */
async function exportAsDocx(
	project: Project,
	chapters: Chapter[],
	scenes: Scene[],
	options: ExportOptions
): Promise<void> {
	const { saveAs } = await import('file-saver');
	const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } = await import(
		'docx'
	);

	type DocChild = InstanceType<typeof Paragraph>;
	const docChildren: DocChild[] = [];

	// メタデータ
	if (options.includeMetadata) {
		docChildren.push(
			new Paragraph({
				text: project.title,
				heading: HeadingLevel.TITLE,
				alignment: AlignmentType.CENTER
			}),
			new Paragraph({
				text: project.description,
				spacing: { after: 400 }
			}),
			new Paragraph({ text: '' })
		);
	}

	// 章とシーンの内容
	for (const chapter of chapters) {
		const chapterScenes = scenes
			.filter((s) => s.chapterId === chapter.id)
			.sort((a, b) => a.order - b.order);

		const chapterTitle = options.chapterNumbers
			? `第${chapter.order + 1}章 ${chapter.title}`
			: chapter.title;

		docChildren.push(
			new Paragraph({
				text: chapterTitle,
				heading: HeadingLevel.HEADING_1,
				spacing: { before: 400, after: 200 }
			})
		);

		for (const scene of chapterScenes) {
			const paragraphs = scene.content.split('\n').filter((p) => p.trim());
			for (const text of paragraphs) {
				docChildren.push(
					new Paragraph({
						children: [new TextRun(text)],
						spacing: { after: 200 }
					})
				);
			}

			if (options.sceneBreaker) {
				docChildren.push(
					new Paragraph({
						text: options.sceneBreaker,
						alignment: AlignmentType.CENTER,
						spacing: { before: 200, after: 200 }
					})
				);
			}
		}

		docChildren.push(new Paragraph({ text: '' }));
	}

	const doc = new Document({
		sections: [
			{
				properties: {},
				children: docChildren
			}
		]
	});

	const blob = await Packer.toBlob(doc);
	saveAs(blob, `${project.title}.docx`);
}

/**
 * EPUBファイルとしてエクスポート
 */
async function exportAsEpub(project: Project, chapters: Chapter[], scenes: Scene[]): Promise<void> {
	const { saveAs } = await import('file-saver');
	const { default: JSZip } = await import('jszip');
	const zip = new JSZip();

	// EPUB構造
	zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

	const metaInf = zip.folder('META-INF');
	metaInf?.file(
		'container.xml',
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
	);

	const oebps = zip.folder('OEBPS');

	// content.opf
	let manifestItems = '';
	let spineItems = '';
	let tocItems = '';

	chapters.forEach((chapter, idx) => {
		const filename = `chapter${idx + 1}.xhtml`;
		manifestItems += `<item id="chapter${idx + 1}" href="${filename}" media-type="application/xhtml+xml"/>\n`;
		spineItems += `<itemref idref="chapter${idx + 1}"/>\n`;
		tocItems += `<navPoint id="navPoint-${idx + 1}" playOrder="${idx + 1}">
      <navLabel><text>${chapter.title}</text></navLabel>
      <content src="${filename}"/>
    </navPoint>\n`;
	});

	oebps?.file(
		'content.opf',
		`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${project.title}</dc:title>
    <dc:language>ja</dc:language>
    <dc:identifier id="BookId">urn:uuid:${project.id}</dc:identifier>
    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
  </metadata>
  <manifest>
    ${manifestItems}
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`
	);

	// toc.ncx
	oebps?.file(
		'toc.ncx',
		`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${project.id}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${project.title}</text></docTitle>
  <navMap>
    ${tocItems}
  </navMap>
</ncx>`
	);

	// 各章のXHTML
	for (let i = 0; i < chapters.length; i++) {
		const chapter = chapters[i];
		const chapterScenes = scenes
			.filter((s) => s.chapterId === chapter.id)
			.sort((a, b) => a.order - b.order);

		let chapterContent = '';
		for (const scene of chapterScenes) {
			chapterContent += `<p>${scene.content.replace(/\n/g, '</p><p>')}</p>\n`;
		}

		oebps?.file(
			`chapter${i + 1}.xhtml`,
			`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
<head>
  <title>${chapter.title}</title>
</head>
<body>
  <h1>${chapter.title}</h1>
  ${chapterContent}
</body>
</html>`
		);
	}

	const blob = await zip.generateAsync({ type: 'blob' });
	saveAs(blob, `${project.title}.epub`);
}

/**
 * JSONファイルとしてエクスポート(全データ)
 */
export async function exportAsJson(projectId: string): Promise<void> {
	const { saveAs } = await import('file-saver');
	const project = await db.projects.get(projectId);
	const chapters = await db.chapters.where('projectId').equals(projectId).toArray();
	const scenes = await db.scenes.where('projectId').equals(projectId).toArray();
	const characters = await db.characters.where('projectId').equals(projectId).toArray();
	const plots = await db.plots.where('projectId').equals(projectId).toArray();
	const worldbuilding = await db.worldbuilding.where('projectId').equals(projectId).toArray();
	const progressLogs = await db.progressLogs.where('projectId').equals(projectId).toArray();

	const exportData = {
		version: '1.0.0',
		exportedAt: new Date().toISOString(),
		project,
		chapters,
		scenes,
		characters,
		plots,
		worldbuilding,
		progressLogs
	};

	const blob = new Blob([JSON.stringify(exportData, null, 2)], {
		type: 'application/json;charset=utf-8'
	});
	saveAs(blob, `${project?.title || 'project'}-backup.json`);
}

/**
 * 全プロジェクトをエクスポート
 */
interface ProjectExportData {
	project: Project;
	chapters: Chapter[];
	scenes: Scene[];
	characters: unknown[];
	plots: unknown[];
	worldbuilding: unknown[];
	progressLogs: unknown[];
}

export async function exportAllProjects(): Promise<void> {
	const { saveAs } = await import('file-saver');
	const projects = await db.projects.toArray();
	const allData: {
		version: string;
		exportedAt: string;
		projectCount: number;
		projects: ProjectExportData[];
	} = {
		version: '1.0.0',
		exportedAt: new Date().toISOString(),
		projectCount: projects.length,
		projects: []
	};

	for (const project of projects) {
		const chapters = await db.chapters.where('projectId').equals(project.id).toArray();
		const scenes = await db.scenes.where('projectId').equals(project.id).toArray();
		const characters = await db.characters.where('projectId').equals(project.id).toArray();
		const plots = await db.plots.where('projectId').equals(project.id).toArray();
		const worldbuilding = await db.worldbuilding.where('projectId').equals(project.id).toArray();
		const progressLogs = await db.progressLogs.where('projectId').equals(project.id).toArray();

		allData.projects.push({
			project,
			chapters,
			scenes,
			characters,
			plots,
			worldbuilding,
			progressLogs
		});
	}

	const blob = new Blob([JSON.stringify(allData, null, 2)], {
		type: 'application/json;charset=utf-8'
	});
	saveAs(blob, `storift-backup-${new Date().toISOString().split('T')[0]}.json`);
}
