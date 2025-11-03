<script lang="ts">
	import { exportProject, type ExportOptions } from '$lib/services/export.service';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';

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

	async function handleExport() {
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

			await exportProject(projectId, options);

			// 成功メッセージ
			setTimeout(() => {
				onClose();
			}, 500);
		} catch (error) {
			console.error('Export failed:', error);
			alert('エクスポートに失敗しました');
		} finally {
			isExporting = false;
		}
	}
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
				<select id="exportFormat" bind:value={format} class="w-full px-3 py-2 border rounded">
					<option value="txt">テキスト (.txt)</option>
					<option value="md">Markdown (.md)</option>
					<option value="pdf">PDF (.pdf)</option>
					<option value="docx">Word互換 (.rtf)</option>
					<option value="epub">EPUB (.epub)</option>
					<option value="json">JSON (バックアップ)</option>
				</select>
			</div>

			{#if format !== 'json'}
				<!-- メタデータ -->
				<div>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={includeMetadata} class="w-4 h-4" />
						<span>メタデータを含める</span>
					</label>
					<p class="text-sm text-gray-600 ml-6">
						タイトル、説明、作成日などの情報を含めます
					</p>
				</div>

				<!-- 章番号 -->
				<div>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={chapterNumbers} class="w-4 h-4" />
						<span>章番号を含める</span>
					</label>
					<p class="text-sm text-gray-600 ml-6">「第1章」のように章番号を付けます</p>
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
					<p class="text-sm text-gray-600 mt-1">シーン間に挿入される記号</p>
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
			<div class="p-3 bg-gray-50 rounded">
				<p class="text-sm font-semibold mb-1">エクスポート内容</p>
				<p class="text-sm text-gray-700">プロジェクト: {projectTitle}</p>
				{#if format === 'json'}
					<p class="text-sm text-gray-700">
						章、シーン、キャラクター、プロット、設定資料をすべて含む完全バックアップ
					</p>
				{:else}
					<p class="text-sm text-gray-700">すべての章とシーンの本文を含む</p>
				{/if}
			</div>
		</div>
	</Modal>
{/if}
