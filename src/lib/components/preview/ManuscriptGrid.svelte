<script lang="ts">
	import type { WritingMode } from '$lib/types';

	interface Props {
		columns: 20 | 25 | 30;
		rows: 10 | 20;
		content: string;
		writingMode: WritingMode;
	}

	let { columns, rows, content, writingMode }: Props = $props();

	// コンテンツを文字単位で分割
	function getCharacters(text: string): string[] {
		// 改行を含めて文字を配列に
		return [...text];
	}

	// グリッドセルの計算
	function calculateGridCells(chars: string[], cols: number, rowCount: number): string[][] {
		const grid: string[][] = [];
		const totalCells = cols * rowCount;
		
		let charIndex = 0;
		
		if (writingMode === 'vertical') {
			// 縦書き: 列ごとに上から下へ
			for (let col = 0; col < cols; col++) {
				const column: string[] = [];
				for (let row = 0; row < rowCount; row++) {
					if (charIndex < chars.length) {
						const char = chars[charIndex];
						if (char === '\n') {
							// 改行: 残りを空白で埋めて次の列へ
							while (column.length < rowCount) {
								column.push('');
							}
							charIndex++;
							break;
						} else {
							column.push(char);
							charIndex++;
						}
					} else {
						column.push('');
					}
				}
				while (column.length < rowCount) {
					column.push('');
				}
				grid.push(column);
			}
		} else {
			// 横書き: 行ごとに左から右へ
			for (let row = 0; row < rowCount; row++) {
				const rowArr: string[] = [];
				for (let col = 0; col < cols; col++) {
					if (charIndex < chars.length) {
						const char = chars[charIndex];
						if (char === '\n') {
							// 改行: 残りを空白で埋めて次の行へ
							while (rowArr.length < cols) {
								rowArr.push('');
							}
							charIndex++;
							break;
						} else {
							rowArr.push(char);
							charIndex++;
						}
					} else {
						rowArr.push('');
					}
				}
				while (rowArr.length < cols) {
					rowArr.push('');
				}
				grid.push(rowArr);
			}
		}
		
		return grid;
	}

	let characters = $derived(getCharacters(content));
	let grid = $derived(calculateGridCells(characters, columns, rows));

	// セルサイズの計算
	const cellSize = 24; // px
</script>

<div
	class="manuscript-container"
	class:vertical={writingMode === 'vertical'}
	class:horizontal={writingMode === 'horizontal'}
	style="
		--cell-size: {cellSize}px;
		--columns: {columns};
		--rows: {rows};
	"
>
	<div class="manuscript-paper">
		{#if writingMode === 'vertical'}
			<!-- 縦書き: 右から左へ列を配置 -->
			<div class="vertical-grid">
				{#each grid as column, colIndex}
					<div class="column">
						{#each column as char, rowIndex}
							<div class="cell" class:empty={!char}>
								<span class="char">{char}</span>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		{:else}
			<!-- 横書き: 上から下へ行を配置 -->
			<div class="horizontal-grid">
				{#each grid as row, rowIndex}
					<div class="row">
						{#each row as char, colIndex}
							<div class="cell" class:empty={!char}>
								<span class="char">{char}</span>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.manuscript-container {
		width: 100%;
		height: 100%;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: 2rem;
		overflow: auto;
		background: #f5f5f0;
	}

	.manuscript-paper {
		background: #fff;
		border: 2px solid #c4a77d;
		padding: 1rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	/* 縦書きグリッド */
	.vertical-grid {
		display: flex;
		flex-direction: row-reverse;
	}

	.vertical-grid .column {
		display: flex;
		flex-direction: column;
		border-left: 1px solid #d4c4a0;
	}

	.vertical-grid .column:first-child {
		border-right: 1px solid #d4c4a0;
	}

	/* 横書きグリッド */
	.horizontal-grid {
		display: flex;
		flex-direction: column;
	}

	.horizontal-grid .row {
		display: flex;
		flex-direction: row;
		border-bottom: 1px solid #d4c4a0;
	}

	.horizontal-grid .row:first-child {
		border-top: 1px solid #d4c4a0;
	}

	/* セル */
	.cell {
		width: var(--cell-size);
		height: var(--cell-size);
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #e8dcc8;
		box-sizing: border-box;
		font-family: "Noto Serif JP", "Yu Mincho", "游明朝", serif;
		font-size: calc(var(--cell-size) * 0.7);
		color: #333;
	}

	.vertical-grid .cell {
		border-left: none;
		border-bottom: 1px solid #e8dcc8;
	}

	.horizontal-grid .cell {
		border-bottom: none;
		border-right: 1px solid #e8dcc8;
	}

	.cell.empty {
		background: transparent;
	}

	.char {
		line-height: 1;
	}

	/* 縦書き時の文字調整 */
	.manuscript-container.vertical .char {
		writing-mode: vertical-rl;
	}

	/* 装飾線（原稿用紙の罫線） */
	.manuscript-paper::before {
		content: "";
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 1px;
		background: #c4a77d;
		opacity: 0.5;
	}
</style>
