<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	import { exportProject, type ExportOptions } from '$lib/services/export.service';
	import Modal from './Modal.svelte';
	import Select from './Select.svelte';
	import { packRuntime } from '$lib/extensions/packRuntime.svelte';

	interface Props {
		projectId: string;
		projectTitle: string;
		show: boolean;
		onClose: () => void;
	}

	let { projectId, projectTitle, show, onClose }: Props = $props();

	let format = $state<'txt' | 'md' | 'docx' | 'pdf' | 'json' | 'epub'>('txt');
	let includeMetadata = $state(true);
	let chapterNumbers = $state(true);
	let sceneBreaker = $state('***');
	let pageBreaks = $state(false);
	let fontSize = $state(12);
	let isExporting = $state(false);
	/** 有効なパックの書き出しのプリセット(空文字は、変換しない) */
	let presetKey = $state('');
	const presets = $derived(packRuntime.exportPresets);
	const presetApplies = $derived(format === 'txt' || format === 'md');

	const handleExport = async () => {
		isExporting = true;
		try {
			const options: ExportOptions = {
				format,
				includeMetadata,
				chapterNumbers,
				sceneBreaker,
				pageBreaks,
				fontSize
			};
			const preset = presetApplies && presetKey ? packRuntime.findPreset(presetKey) : undefined;
			if (preset) {
				options.notation = {
					ruby: preset.ruby,
					bouten: preset.bouten,
					blankLines: preset.blankLines
				};
			}

			await exportProject(projectId, options);

			// 成功メッセージ
			setTimeout(() => {
				onClose();
			}, 500);
		} catch (error) {
			console.error('Export failed:', error);
			toast.error('エクスポートに失敗しました');
		} finally {
			isExporting = false;
		}
	};
</script>

{#if show}
	<Modal
		title="プロジェクトをエクスポート"
		{onClose}
		onConfirm={handleExport}
		confirmText={isExporting ? 'エクスポート中...' : 'エクスポート'}
		confirmDisabled={isExporting}
	>
		<div class="space-y-4">
			<!-- フォーマット選択 -->
			<div>
				<label for="exportFormat" class="block mb-2 font-semibold">形式</label>
				<Select
					id="exportFormat"
					bind:value={format}
					options={[
						{ value: 'txt', label: 'テキスト (.txt)' },
						{ value: 'md', label: 'Markdown (.md)' },
						{ value: 'pdf', label: 'PDF (.pdf)' },
						{ value: 'docx', label: 'Word互換 (.rtf)' },
						{ value: 'epub', label: 'EPUB (.epub)' },
						{ value: 'json', label: 'JSON (バックアップ)' }
					]}
				/>
			</div>

			{#if presetApplies && presets.length > 0}
				<!-- 有効なパックの書き出しのプリセット -->
				<div>
					<label for="exportPreset" class="block mb-2 font-semibold">記法のプリセット</label>
					<Select
						id="exportPreset"
						bind:value={presetKey}
						options={[
							{ value: '', label: '変換しない' },
							...presets.map((e) => ({ value: e.key, label: `${e.preset.name}(${e.packName})` }))
						]}
					/>
					<p class="text-sm fg:theme-text-secondary mt-1">
						ルビ・傍点・空行の書き方を変えて書き出します。保存している原稿は変わりません
					</p>
				</div>
			{/if}

			{#if format !== 'json'}
				<!-- メタデータ -->
				<div>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={includeMetadata} class="w-4 h-4" />
						<span>メタデータを含める</span>
					</label>
					<p class="text-sm fg:theme-text-secondary ml-6">
						タイトル、説明、作成日などの情報を含めます
					</p>
				</div>

				<!-- 章番号 -->
				<div>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={chapterNumbers} class="w-4 h-4" />
						<span>章番号を含める</span>
					</label>
					<p class="text-sm fg:theme-text-secondary ml-6">「第1章」のように章番号を付けます</p>
				</div>

				<!-- シーン区切り -->
				<div>
					<label for="sceneBreaker" class="block mb-2 font-semibold">シーン区切り記号</label>
					<input
						id="sceneBreaker"
						type="text"
						bind:value={sceneBreaker}
						placeholder="***"
						class="w-full px-3 py-2 border rounded"
					/>
					<p class="text-sm fg:theme-text-secondary mt-1">シーン間に挿入される記号</p>
				</div>

				{#if format === 'pdf'}
					<!-- PDF専用オプション -->
					<div>
						<label class="flex items-center gap-2 cursor-pointer">
							<input type="checkbox" bind:checked={pageBreaks} class="w-4 h-4" />
							<span>章ごとに改ページ</span>
						</label>
					</div>

					<div>
						<label for="fontSize" class="block mb-2 font-semibold">フォントサイズ</label>
						<input
							id="fontSize"
							type="number"
							bind:value={fontSize}
							min="8"
							max="24"
							class="w-32 px-3 py-2 border rounded"
						/>
						<span class="ml-2">pt</span>
					</div>
				{/if}
			{/if}

			<!-- プレビュー情報 -->
			<div class="p-3 bg:theme-surface rounded">
				<p class="text-sm font-semibold mb-1">エクスポート内容</p>
				<p class="text-sm fg:theme-text-secondary">プロジェクト: {projectTitle}</p>
				{#if format === 'json'}
					<p class="text-sm fg:theme-text-secondary">
						章、シーン、キャラクター、プロット、設定資料をすべて含む完全バックアップ
					</p>
				{:else}
					<p class="text-sm fg:theme-text-secondary">すべての章とシーンの本文を含む</p>
				{/if}
			</div>
		</div>
	</Modal>
{/if}
