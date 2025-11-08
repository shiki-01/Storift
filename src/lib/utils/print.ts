/**
 * 印刷プレビュー用のユーティリティ
 */

export interface PrintOptions {
	/** 縦書き/横書き */
	writingMode: 'horizontal' | 'vertical';
	/** フォントサイズ */
	fontSize: number;
	/** フォントファミリー */
	fontFamily: string;
	/** 行間 */
	lineHeight: number;
	/** 余白（mm） */
	margin: {
		top: number;
		right: number;
		bottom: number;
		left: number;
	};
	/** 用紙サイズ */
	paperSize: 'A4' | 'A5' | 'B5' | 'letter';
	/** ヘッダー・フッター */
	header?: string;
	footer?: string;
	/** ページ番号表示 */
	showPageNumber: boolean;
	/** 章番号表示 */
	showChapterNumber: boolean;
}

export const defaultPrintOptions: PrintOptions = {
	writingMode: 'horizontal',
	fontSize: 12,
	fontFamily: "'游明朝', 'Yu Mincho', serif",
	lineHeight: 1.8,
	margin: {
		top: 20,
		right: 20,
		bottom: 20,
		left: 20
	},
	paperSize: 'A4',
	showPageNumber: true,
	showChapterNumber: true
};

/**
 * 用紙サイズの寸法（mm）
 */
export const paperSizes: Record<string, { width: number; height: number }> = {
	A4: { width: 210, height: 297 },
	A5: { width: 148, height: 210 },
	B5: { width: 182, height: 257 },
	letter: { width: 216, height: 279 }
};

/**
 * 印刷用CSSを生成
 */
export function generatePrintCSS(options: PrintOptions): string {
	const { width, height } = paperSizes[options.paperSize];
	const isVertical = options.writingMode === 'vertical';

	return `
		@page {
			size: ${width}mm ${height}mm;
			margin: ${options.margin.top}mm ${options.margin.right}mm ${options.margin.bottom}mm ${options.margin.left}mm;
		}

		@media print {
			body {
				font-family: ${options.fontFamily};
				font-size: ${options.fontSize}pt;
				line-height: ${options.lineHeight};
				color: #000;
				background: #fff;
			}

			.print-content {
				${
					isVertical
						? `
					writing-mode: vertical-rl;
					-webkit-writing-mode: vertical-rl;
					-ms-writing-mode: tb-rl;
				`
						: `
					writing-mode: horizontal-tb;
				`
				}
			}

			.chapter-title {
				font-size: ${options.fontSize * 1.5}pt;
				font-weight: bold;
				margin-bottom: 1em;
				${isVertical ? 'margin-right: 2em;' : 'margin-bottom: 2em;'}
			}

			.scene-break {
				${
					isVertical
						? `
					width: 1px;
					height: 3em;
					margin: 2em auto;
				`
						: `
					height: 1px;
					width: 3em;
					margin: 2em auto;
				`
				}
				background: #000;
			}

			.page-break {
				page-break-after: always;
				break-after: page;
			}

			.no-print {
				display: none !important;
			}

			ruby {
				ruby-position: over;
			}

			rt {
				font-size: 0.5em;
			}

			@page :first {
				margin-top: ${options.margin.top * 2}mm;
			}

			${
				options.showPageNumber
					? `
				@page {
					@bottom-center {
						content: counter(page);
					}
				}
			`
					: ''
			}
		}
	`;
}

/**
 * 印刷プレビューを開く
 */
export function openPrintPreview(
	content: string,
	options: PrintOptions = defaultPrintOptions
): void {
	const printWindow = window.open('', '_blank');
	if (!printWindow) {
		alert('ポップアップがブロックされました。ポップアップを許可してください。');
		return;
	}

	const css = generatePrintCSS(options);

	printWindow.document.write(`
		<!DOCTYPE html>
		<html lang="ja">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>印刷プレビュー</title>
			<style>${css}</style>
			<style>
				body {
					font-family: ${options.fontFamily};
					font-size: ${options.fontSize}pt;
					line-height: ${options.lineHeight};
					padding: 20mm;
					max-width: ${paperSizes[options.paperSize].width}mm;
					margin: 0 auto;
				}

				.print-toolbar {
					position: fixed;
					top: 20px;
					right: 20px;
					background: white;
					padding: 12px;
					border-radius: 8px;
					box-shadow: 0 2px 8px rgba(0,0,0,0.1);
					z-index: 1000;
				}

				.print-toolbar button {
					padding: 8px 16px;
					margin: 0 4px;
					border: 1px solid #ddd;
					border-radius: 4px;
					background: white;
					cursor: pointer;
					font-size: 14px;
				}

				.print-toolbar button:hover {
					background: #f0f0f0;
				}

				.print-content {
					${
						options.writingMode === 'vertical'
							? `
						writing-mode: vertical-rl;
						-webkit-writing-mode: vertical-rl;
						height: calc(${paperSizes[options.paperSize].height}mm - 40mm);
					`
							: ''
					}
				}

				@media print {
					.print-toolbar {
						display: none !important;
					}
				}
			</style>
		</head>
		<body>
			<div class="print-toolbar no-print">
				<button onclick="window.print()">🖨️ 印刷</button>
				<button onclick="window.close()">❌ 閉じる</button>
			</div>
			<div class="print-content">
				${content}
			</div>
		</body>
		</html>
	`);

	printWindow.document.close();
}

/**
 * コンテンツを印刷用HTMLに整形
 */
export function formatForPrint(
	chapters: Array<{
		title: string;
		scenes: Array<{ title: string; content: string }>;
	}>,
	options: PrintOptions
): string {
	console.log('formatForPrint called with', { chaptersCount: chapters.length, options });
	let html = '';

	for (let i = 0; i < chapters.length; i++) {
		const chapter = chapters[i];

		// 章タイトル
		if (options.showChapterNumber) {
			html += `<h2 class="chapter-title">第${i + 1}章 ${chapter.title}</h2>`;
		} else {
			html += `<h2 class="chapter-title">${chapter.title}</h2>`;
		}

		// シーン
		for (let j = 0; j < chapter.scenes.length; j++) {
			const scene = chapter.scenes[j];

			// シーン内容
			html += `<div class="scene-content">${scene.content.replace(/\n/g, '<br>')}</div>`;

			// シーン区切り（最後のシーン以外）
			if (j < chapter.scenes.length - 1) {
				html += '<div class="scene-break"></div>';
			}
		}

		// 章の区切り（最後の章以外）
		if (i < chapters.length - 1) {
			html += '<div class="page-break"></div>';
		}
	}

	return html;
}
