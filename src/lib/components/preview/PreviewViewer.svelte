<script lang="ts">
	import { rubyToHtml } from '$lib/utils/ruby';
	import type { PreviewSettings } from '$lib/types';
	import ManuscriptGrid from './ManuscriptGrid.svelte';

	interface Props {
		content: string;
		settings: PreviewSettings;
	}

	let { content, settings }: Props = $props();

	// プレビューコンテナへの参照
	let containerRef = $state<HTMLDivElement | null>(null);

	// 縦書きモードで縦スクロールを横スクロールに変換
	function handleWheel(e: WheelEvent) {
		if (settings.writingMode === 'vertical' && containerRef) {
			// 縦スクロール（deltaY）がある場合、横スクロールに変換
			if (e.deltaY !== 0) {
				e.preventDefault();
				// 縦書きは右から左に読むので、deltaYの符号を反転
				containerRef.scrollLeft -= e.deltaY;
			}
			// 横スクロール（deltaX）がある場合も反転して適用
			if (e.deltaX !== 0) {
				e.preventDefault();
				containerRef.scrollLeft -= e.deltaX;
			}
		}
	}

	// テキストをHTML形式に変換（ルビ・圏点対応）
	function processContent(text: string, showRuby: boolean, showBouten: boolean): string {
		let processed = text;

		// ルビ処理
		if (showRuby) {
			processed = rubyToHtml(processed);
		} else {
			// ルビ記法を削除
			processed = processed
				.replace(/\|?([^《（\[]+)《[^》]+》/g, '$1')
				.replace(/\|?([^《（\[]+)（[^）]+）/g, '$1')
				.replace(/\|?([^《（\[]+)\[[^\]]+\]/g, '$1');
		}

		// 圏点処理 (《《文字》》形式)
		if (showBouten) {
			processed = processed.replace(
				/《《([^》]+)》》/g,
				'<span class="bouten">$1</span>'
			);
		} else {
			processed = processed.replace(/《《([^》]+)》》/g, '$1');
		}

		// 改行を<br>に変換（段落として扱う）
		processed = processed.replace(/\n/g, '</p><p>');
		processed = '<p>' + processed + '</p>';
		// 空の段落を処理
		processed = processed.replace(/<p><\/p>/g, '<p class="empty-line">&nbsp;</p>');

		return processed;
	}

	// フォントファミリーマップ
	const fontFamilyMap: Record<string, string> = {
		'yu-gothic': '"Yu Gothic", "游ゴシック", YuGothic, "游ゴシック体", sans-serif',
		'gen-shin-mincho': '"源真明朝", "Gen Shin Mincho", serif',
		'hiragino-mincho': '"Hiragino Mincho ProN", "ヒラギノ明朝 ProN", serif',
		'noto-sans': '"Noto Sans JP", sans-serif',
		'noto-serif': '"Noto Serif JP", serif',
		'hannari-mincho': '"はんなり明朝", "Hannari Mincho", serif',
		'sawarabi-mincho': '"さわらび明朝", "Sawarabi Mincho", serif',
		'sawarabi-gothic': '"さわらびゴシック", "Sawarabi Gothic", sans-serif',
	};

	function getFontFamily(font: string): string {
		return fontFamilyMap[font] || font;
	}

	// ページ分割（ページネーション用）
	function splitIntoPages(text: string, linesPerPage: number): string[] {
		const lines = text.split('\n');
		const pages: string[] = [];
		
		for (let i = 0; i < lines.length; i += linesPerPage) {
			pages.push(lines.slice(i, i + linesPerPage).join('\n'));
		}
		
		return pages;
	}

	let pages = $derived(splitIntoPages(content, settings.linesPerPage));
	let processedContent = $derived(processContent(content, settings.showRuby, settings.showBouten));
</script>

<div
	class="preview-container"
	class:vertical={settings.writingMode === 'vertical'}
	class:horizontal={settings.writingMode === 'horizontal'}
	class:manuscript={settings.manuscriptMode}
	class:orientation-upright={settings.writingMode === 'vertical' && settings.textOrientation === 'upright'}
	class:orientation-sideways={settings.writingMode === 'vertical' && settings.textOrientation === 'sideways'}
	style="
		--font-size: {settings.fontSize}px;
		--line-height: {settings.lineHeight};
		--letter-spacing: {settings.letterSpacing}em;
		--font-family: {getFontFamily(settings.fontFamily)};
		--line-length: {settings.lineLength};
	"
>
	{#if settings.manuscriptMode}
		<ManuscriptGrid
			columns={settings.manuscriptColumns}
			rows={settings.manuscriptRows}
			{content}
			writingMode={settings.writingMode}
		/>
	{:else}
		<div class="preview-content">
			{#if settings.showLineNumbers}
				<div class="line-numbers">
					{#each content.split('\n') as _, index}
						<span class="line-number">{index + 1}</span>
					{/each}
				</div>
			{/if}
			
			<div class="text-area">
				{@html processedContent}
			</div>
		</div>
		
		{#if settings.showPageNumbers && pages.length > 1}
			<div class="page-info">
				{pages.length} ページ
			</div>
		{/if}
	{/if}
</div>

<style>
	.preview-container {
		width: 100%;
		height: 100%;
		padding: 2rem;
		overflow: auto;
		background: var(--color-editor-background, #fff);
		color: var(--color-editor-text, #333);
		font-family: var(--font-family);
		font-size: var(--font-size);
		line-height: var(--line-height);
		letter-spacing: var(--letter-spacing);
	}

	/* 縦書きモード */
	.preview-container.vertical {
		writing-mode: vertical-rl;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.preview-container.vertical .preview-content {
		display: inline-block;
		min-width: 100%;
		height: 100%;
	}

	.preview-container.vertical .text-area {
		height: calc(var(--line-length) * var(--font-size) * var(--line-height));
		max-height: 100%;
	}

	/* 英数字の向き - 正立（半角英数字のみ対象） */
	.preview-container.vertical.orientation-upright .text-area {
		text-orientation: mixed;
	}
	.preview-container.vertical.orientation-upright .text-area :global(p) {
		text-combine-upright: none;
	}

	/* 英数字の向き - 横倒し */
	.preview-container.vertical.orientation-sideways .text-area {
		text-orientation: sideways;
	}

	/* 横書きモード */
	.preview-container.horizontal {
		writing-mode: horizontal-tb;
	}

	.preview-container.horizontal .preview-content {
		display: flex;
		flex-direction: row;
	}

	.preview-container.horizontal .text-area {
		max-width: calc(var(--line-length) * 1em);
		flex: 1;
	}

	/* 行番号 */
	.line-numbers {
		display: flex;
		flex-direction: column;
		color: var(--color-text-secondary, #999);
		font-size: 0.75em;
		user-select: none;
		margin-right: 1rem;
	}

	.preview-container.vertical .line-numbers {
		writing-mode: horizontal-tb;
		flex-direction: row;
		margin-right: 0;
		margin-bottom: 1rem;
	}

	.line-number {
		padding: 0 0.5em;
	}

	/* テキストエリア */
	.text-area {
		word-break: break-all;
	}

	.text-area :global(p) {
		margin: 0;
		min-height: 1em;
	}

	.text-area :global(p.empty-line) {
		min-height: calc(var(--line-height) * 1em);
	}

	/* 圏点（ボウテン） */
	.text-area :global(.bouten) {
		text-emphasis: filled sesame;
		text-emphasis-position: over right;
	}

	.preview-container.vertical .text-area :global(.bouten) {
		text-emphasis-position: right;
	}

	/* ルビ */
	.text-area :global(ruby) {
		ruby-align: center;
	}

	.text-area :global(rt) {
		font-size: 0.5em;
	}

	/* ページ情報 */
	.page-info {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		font-size: 0.75em;
		color: var(--color-text-secondary, #999);
		background: var(--color-background, #fff);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
	}

	.preview-container.vertical .page-info {
		bottom: auto;
		top: 1rem;
		left: 1rem;
		right: auto;
	}

	/* 原稿用紙モード */
	.preview-container.manuscript {
		padding: 0;
	}
</style>
