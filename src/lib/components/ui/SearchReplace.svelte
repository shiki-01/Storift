<script lang="ts">
	import { searchInProject, replaceInProject, validateRegex } from '$lib/services/search.service';
	import type { SearchOptions, SearchResult } from '$lib/services/search.service';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';

	interface Props {
		projectId: string;
		show: boolean;
		onClose: () => void;
	}

	let { projectId, show, onClose }: Props = $props();

	let searchQuery = $state('');
	let replaceWith = $state('');
	let caseSensitive = $state(false);
	let wholeWord = $state(false);
	let useRegex = $state(false);
	let searchResults = $state<SearchResult[]>([]);
	let isSearching = $state(false);
	let showReplace = $state(false);
	let regexError = $state('');
	let replaceCount = $state(0);

	let selectedScopes = $state<Array<'scenes' | 'chapters' | 'characters' | 'plots' | 'worldbuilding'>>([
		'scenes'
	]);

	// 検索実行
	async function handleSearch() {
		if (!searchQuery) return;

		// 正規表現の検証
		if (useRegex) {
			const validation = validateRegex(searchQuery);
			if (!validation.valid) {
				regexError = validation.error || '無効な正規表現です';
				return;
			}
		}
		regexError = '';

		isSearching = true;
		try {
			const options: SearchOptions = {
				query: searchQuery,
				caseSensitive,
				wholeWord,
				regex: useRegex,
				scopes: selectedScopes
			};

			searchResults = await searchInProject(projectId, options);
		} catch (error) {
			console.error('Search failed:', error);
		} finally {
			isSearching = false;
		}
	}

	// 置換実行
	async function handleReplace() {
		if (!searchQuery || !replaceWith) return;

		const confirmed = confirm(
			`"${searchQuery}" を "${replaceWith}" に置換します。よろしいですか？`
		);
		if (!confirmed) return;

		try {
			const options = {
				query: searchQuery,
				replaceWith,
				caseSensitive,
				wholeWord,
				regex: useRegex,
				replaceAll: true,
				scopes: selectedScopes
			};

			const result = await replaceInProject(projectId, options);
			replaceCount = result.replaced;

			// 置換後に再検索
			await handleSearch();

			setTimeout(() => {
				replaceCount = 0;
			}, 3000);
		} catch (error) {
			console.error('Replace failed:', error);
		}
	}

	// スコープの切り替え
	function toggleScope(scope: typeof selectedScopes[number]) {
		if (selectedScopes.includes(scope)) {
			selectedScopes = selectedScopes.filter((s) => s !== scope);
		} else {
			selectedScopes = [...selectedScopes, scope];
		}
	}

	// Enterキーで検索
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSearch();
		}
	}
</script>

{#if show}
	<Modal title="検索と置換" {onClose} size="large">
		<div class="space-y-4">
			<!-- 検索フォーム -->
			<div>
				<label for="searchQuery" class="block mb-2 font-semibold">検索</label>
				<input
					id="searchQuery"
					type="text"
					bind:value={searchQuery}
					onkeydown={handleKeydown}
					placeholder="検索ワードを入力..."
					class="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-primary"
				/>
				{#if regexError}
					<p class="text-red-600 text-sm mt-1">{regexError}</p>
				{/if}
			</div>

			<!-- 置換フォーム -->
			{#if showReplace}
				<div>
					<label for="replaceWith" class="block mb-2 font-semibold">置換</label>
					<input
						id="replaceWith"
						type="text"
						bind:value={replaceWith}
						placeholder="置換後のテキストを入力..."
						class="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-primary"
					/>
				</div>
			{/if}

			<!-- オプション -->
			<div class="flex flex-wrap gap-4">
				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={caseSensitive} class="w-4 h-4" />
					<span>大文字小文字を区別</span>
				</label>

				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={wholeWord} class="w-4 h-4" />
					<span>単語単位で検索</span>
				</label>

				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={useRegex} class="w-4 h-4" />
					<span>正規表現を使用</span>
				</label>

				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={showReplace} class="w-4 h-4" />
					<span>置換を表示</span>
				</label>
			</div>

			<!-- 検索範囲 -->
			<div>
				<div class="block mb-2 font-semibold">検索範囲</div>
				<div class="flex flex-wrap gap-2">
					<button
						onclick={() => toggleScope('scenes')}
						class="px-3 py-1 rounded border transition-colors"
						class:bg-primary={selectedScopes.includes('scenes')}
						class:text-white={selectedScopes.includes('scenes')}
						class:bg-gray-100={!selectedScopes.includes('scenes')}
					>
						シーン
					</button>
					<button
						onclick={() => toggleScope('chapters')}
						class="px-3 py-1 rounded border transition-colors"
						class:bg-primary={selectedScopes.includes('chapters')}
						class:text-white={selectedScopes.includes('chapters')}
						class:bg-gray-100={!selectedScopes.includes('chapters')}
					>
						章
					</button>
					<button
						onclick={() => toggleScope('characters')}
						class="px-3 py-1 rounded border transition-colors"
						class:bg-primary={selectedScopes.includes('characters')}
						class:text-white={selectedScopes.includes('characters')}
						class:bg-gray-100={!selectedScopes.includes('characters')}
					>
						キャラクター
					</button>
					<button
						onclick={() => toggleScope('plots')}
						class="px-3 py-1 rounded border transition-colors"
						class:bg-primary={selectedScopes.includes('plots')}
						class:text-white={selectedScopes.includes('plots')}
						class:bg-gray-100={!selectedScopes.includes('plots')}
					>
						プロット
					</button>
					<button
						onclick={() => toggleScope('worldbuilding')}
						class="px-3 py-1 rounded border transition-colors"
						class:bg-primary={selectedScopes.includes('worldbuilding')}
						class:text-white={selectedScopes.includes('worldbuilding')}
						class:bg-gray-100={!selectedScopes.includes('worldbuilding')}
					>
						設定資料
					</button>
				</div>
			</div>

			<!-- アクションボタン -->
			<div class="flex gap-2">
				<Button onclick={handleSearch} disabled={isSearching || !searchQuery} class="flex-1">
					{isSearching ? '検索中...' : '検索'}
				</Button>

				{#if showReplace}
					<Button
						onclick={handleReplace}
						variant="secondary"
						disabled={!searchQuery || !replaceWith}
						class="flex-1"
					>
						すべて置換
					</Button>
				{/if}
			</div>

			<!-- 置換結果 -->
			{#if replaceCount > 0}
				<div class="p-3 bg-green-100 text-green-800 rounded">
					{replaceCount}箇所を置換しました
				</div>
			{/if}

			<!-- 検索結果 -->
			{#if searchResults.length > 0}
				<div>
					<h3 class="font-semibold mb-2">検索結果 ({searchResults.length}件)</h3>
					<div class="max-h-96 overflow-y-auto space-y-2">
						{#each searchResults as result}
							<div class="p-3 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer">
								<div class="flex items-center justify-between mb-1">
									<span class="font-semibold">{result.title}</span>
									<span class="text-sm text-gray-600">
										{result.type === 'scene'
											? 'シーン'
											: result.type === 'chapter'
												? '章'
												: result.type === 'character'
													? 'キャラクター'
													: result.type === 'plot'
														? 'プロット'
														: '設定資料'}
										・{result.matches}件
									</span>
								</div>
								<p class="text-sm text-gray-700 line-clamp-2">{result.preview}</p>
							</div>
						{/each}
					</div>
				</div>
			{:else if searchQuery && !isSearching}
				<div class="text-center text-gray-600 py-8">検索結果がありません</div>
			{/if}
		</div>
	</Modal>
{/if}

<style>
	.bg-primary {
		background-color: var(--color-primary);
	}

	.text-white {
		color: white;
	}

	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
