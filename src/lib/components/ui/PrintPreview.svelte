<script lang="ts">
	import {
		openPrintPreview,
		formatForPrint,
		defaultPrintOptions,
		type PrintOptions
	} from '$lib/utils/print';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	interface Props {
		chapters: Array<{
			title: string;
			scenes: Array<{ title: string; content: string }>;
		}>;
		isOpen: boolean;
		onClose: () => void;
	}

	let { chapters, isOpen, onClose }: Props = $props();

	let options = $state<PrintOptions>({ ...defaultPrintOptions });

	const handlePrint = () => {
		if (!chapters || chapters.length === 0) {
			toast.error('印刷するコンテンツがありません。先に章とシーンを作成してください。');
			return;
		}

		const content = formatForPrint(chapters, options);
		openPrintPreview(content, options);
	};
</script>

{#if isOpen}
	<Modal title="印刷プレビュー設定" {onClose} size="medium">
		<div class="print-settings p:24 space-y:20">
			<!-- 書式設定 -->
			<div>
				<h3 class="font:16 font:semibold fg:theme-text mb:12">書式設定</h3>

				<div class="space-y:12">
					<!-- 書字方向-->
					<div>
						<div class="font:14 fg:theme-text mb:6">書字方向</div>
						<div class="flex gap:8">
							<button
								class="flex-1 py:8 px:16 r:8 cursor:pointer transition:all|.2s {options.writingMode ===
								'horizontal'
									? 'b:2|solid|theme-text bg:theme-text fg:theme-background'
									: 'b:2|solid|theme-border bg:theme-background fg:theme-text'}"
								onclick={() => (options.writingMode = 'horizontal')}
							>
								横書き
							</button>
							<button
								class="flex-1 py:8 px:16 r:8 cursor:pointer transition:all|.2s {options.writingMode ===
								'vertical'
									? 'b:2|solid|theme-text bg:theme-text fg:theme-background'
									: 'b:2|solid|theme-border bg:theme-background fg:theme-text'}"
								onclick={() => (options.writingMode = 'vertical')}
							>
								縦書き
							</button>
						</div>
					</div>

					<!-- フォントサイズ -->
					<div>
						<label for="fontSize" class="font:14 fg:theme-text mb:6 block">フォントサイズ</label>
						<div class="flex align-items:center gap:12">
							<input
								id="fontSize"
								type="range"
								min="8"
								max="24"
								step="1"
								bind:value={options.fontSize}
								class="flex-grow"
							/>
							<span class="font:14 fg:theme-text w:60 text-align:right">{options.fontSize}pt</span>
						</div>
					</div>

					<!-- 行間 -->
					<div>
						<label for="lineHeight" class="font:14 fg:theme-text mb:6 block">行間</label>
						<div class="flex align-items:center gap:12">
							<input
								id="lineHeight"
								type="range"
								min="1.0"
								max="3.0"
								step="0.1"
								bind:value={options.lineHeight}
								class="flex-grow"
							/>
							<span class="font:14 fg:theme-text w:60 text-align:right"
								>{options.lineHeight.toFixed(1)}</span
							>
						</div>
					</div>

					<!-- フォント -->
					<div>
						<label for="fontFamily" class="font:14 fg:theme-text mb:6 block">フォント</label>
						<select
							id="fontFamily"
							bind:value={options.fontFamily}
							class="w:full py:8 px:12 r:8 b:1|solid|theme-border bg:theme-background fg:theme-text font:14"
						>
							<option value="'游明朝', 'Yu Mincho', serif">游明朝</option>
							<option value="'ヒラギノ明朝 ProN', 'Hiragino Mincho ProN', serif"
								>ヒラギノ明朝</option
							>
							<option value="'メイリオ', Meiryo, sans-serif">メイリオ</option>
							<option value="'游ゴシック', 'Yu Gothic', sans-serif">游ゴシック</option>
							<option value="'MS 明朝', 'MS Mincho', serif">MS 明朝</option>
						</select>
					</div>
				</div>
			</div>

			<!-- 用紙設定 -->
			<div>
				<h3 class="font:16 font:semibold fg:theme-text mb:12">用紙設定</h3>

				<div class="space-y:12">
					<!-- 用紙サイズ -->
					<div>
						<div class="font:14 fg:theme-text mb:6">用紙サイズ</div>
						<div class="grid grid-cols:2 gap:8">
							{#each ['A4', 'A5', 'B5', 'letter'] as size}
								<button
									class="py:8 px:16 r:8 cursor:pointer transition:all|.2s {options.paperSize ===
									size
										? 'b:2|solid|theme-text bg:theme-text fg:theme-background'
										: 'b:2|solid|theme-border bg:theme-background fg:theme-text'}"
									onclick={() => (options.paperSize = size as any)}
								>
									{size}
								</button>
							{/each}
						</div>
					</div>

					<!-- 余白 -->
					<div>
						<div class="font:14 fg:theme-text mb:6">余白 (mm)</div>
						<div class="grid grid-cols:2 gap:8">
							<div>
								<label for="marginTop" class="font:12 fg:theme-text-secondary mb:4 block">上</label>
								<input
									id="marginTop"
									type="number"
									bind:value={options.margin.top}
									min="10"
									max="50"
									class="w:full py:6 px:10 r:6 b:1|solid|theme-border bg:theme-background fg:theme-text font:14"
								/>
							</div>
							<div>
								<label for="marginBottom" class="font:12 fg:theme-text-secondary mb:4 block"
									>下</label
								>
								<input
									id="marginBottom"
									type="number"
									bind:value={options.margin.bottom}
									min="10"
									max="50"
									class="w:full py:6 px:10 r:6 b:1|solid|theme-border bg:theme-background fg:theme-text font:14"
								/>
							</div>
							<div>
								<label for="marginLeft" class="font:12 fg:theme-text-secondary mb:4 block">左</label
								>
								<input
									id="marginLeft"
									type="number"
									bind:value={options.margin.left}
									min="10"
									max="50"
									class="w:full py:6 px:10 r:6 b:1|solid|theme-border bg:theme-background fg:theme-text font:14"
								/>
							</div>
							<div>
								<label for="marginRight" class="font:12 fg:theme-text-secondary mb:4 block"
									>右</label
								>
								<input
									id="marginRight"
									type="number"
									bind:value={options.margin.right}
									min="10"
									max="50"
									class="w:full py:6 px:10 r:6 b:1|solid|theme-border bg:theme-background fg:theme-text font:14"
								/>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- 表示オプション -->
			<div>
				<h3 class="font:16 font:semibold fg:theme-text mb:12">表示オプション</h3>

				<div class="space-y:8">
					<label class="flex align-items:center gap:8 cursor:pointer">
						<input type="checkbox" bind:checked={options.showPageNumber} class="w:18 h:18" />
						<span class="font:14 fg:theme-text">ページ番号を表示</span>
					</label>

					<label class="flex align-items:center gap:8 cursor:pointer">
						<input type="checkbox" bind:checked={options.showChapterNumber} class="w:18 h:18" />
						<span class="font:14 fg:theme-text">章番号を表示</span>
					</label>
				</div>
			</div>

			<!-- アクションボタン -->
			<div class="flex gap:12 justify-content:flex-end pt:16 border-top:1|solid|theme-border">
				<Button variant="secondary" onclick={onClose}>キャンセル</Button>
				<Button variant="primary" onclick={handlePrint}>🖨️ プレビュー表示</Button>
			</div>
		</div>
	</Modal>
{/if}

<style>
	input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		height: 6px;
		border-radius: 3px;
		background: var(--color-border);
		outline: none;
	}

	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--color-primary);
		cursor: pointer;
	}

	input[type='range']::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--color-primary);
		cursor: pointer;
		border: none;
	}

	input[type='checkbox'] {
		cursor: pointer;
		accent-color: var(--color-primary);
	}
</style>
