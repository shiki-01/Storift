<script lang="ts">
	import { confirmDialog, toast } from '$lib/stores/toast.svelte';
	import { searchInProject, replaceInProject, validateRegex } from '$lib/services/search.service';
	import type { SearchOptions, SearchResult } from '$lib/services/search.service';
	import Sheet from '$lib/components/mobile/Sheet.svelte';

	type Scope = 'scenes' | 'chapters' | 'characters' | 'plots' | 'worldbuilding';

	interface Props {
		projectId: string;
		show: boolean;
		onClose: () => void;
		/** 結果のシーンをタップしたとき */
		onOpenScene?: (sceneId: string) => void;
	}

	let { projectId, show, onClose, onOpenScene }: Props = $props();

	let searchQuery = $state('');
	let replaceWith = $state('');
	let caseSensitive = $state(false);
	let wholeWord = $state(false);
	let useRegex = $state(false);
	let showReplace = $state(false);
	let searchResults = $state<SearchResult[]>([]);
	let isSearching = $state(false);
	let hasSearched = $state(false);
	let regexError = $state('');
	let selectedScopes = $state<Scope[]>(['scenes']);

	const scopeLabels: { id: Scope; label: string }[] = [
		{ id: 'scenes', label: 'シーン' },
		{ id: 'chapters', label: '章' },
		{ id: 'characters', label: 'キャラクター' },
		{ id: 'plots', label: 'プロット' },
		{ id: 'worldbuilding', label: '設定資料' }
	];

	const typeLabels: Record<SearchResult['type'], string> = {
		scene: 'シーン',
		chapter: '章',
		character: 'キャラクター',
		plot: 'プロット',
		worldbuilding: '設定資料'
	};

	let open = $derived(show);

	function buildOptions(): SearchOptions {
		return {
			query: searchQuery,
			caseSensitive,
			wholeWord,
			regex: useRegex,
			scopes: selectedScopes
		};
	}

	async function handleSearch() {
		if (!searchQuery) return;
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
			searchResults = await searchInProject(projectId, buildOptions());
			hasSearched = true;
		} catch (error) {
			console.error('Search failed:', error);
			toast.error('検索に失敗しました');
		} finally {
			isSearching = false;
		}
	}

	async function handleReplace() {
		if (!searchQuery) return;
		const total = searchResults.reduce((n, r) => n + r.matches, 0);
		const ok = await confirmDialog({
			title: '一括置換',
			message: `「${searchQuery}」を「${replaceWith}」に置換します(${total}か所)。この操作は元に戻せません。`,
			confirmText: '置換する',
			danger: true
		});
		if (!ok) return;
		try {
			const result = await replaceInProject(projectId, {
				...buildOptions(),
				replaceWith,
				replaceAll: true
			});
			toast.success(`${result.replaced}か所を置換しました`);
			await handleSearch();
		} catch (error) {
			console.error('Replace failed:', error);
			toast.error('置換に失敗しました');
		}
	}

	function toggleScope(scope: Scope) {
		selectedScopes = selectedScopes.includes(scope)
			? selectedScopes.filter((s) => s !== scope)
			: [...selectedScopes, scope];
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.isComposing) {
			e.preventDefault();
			void handleSearch();
		}
	}

	function openResult(result: SearchResult) {
		if (result.type === 'scene' && onOpenScene) {
			onClose();
			onOpenScene(result.id);
		}
	}
</script>

<Sheet {open} title="検索と置換" size="full" onClose={() => onClose()}>
	<div class="search">
		<label class="field">
			<span>検索</span>
			<input
				type="search"
				bind:value={searchQuery}
				onkeydown={onKeydown}
				placeholder="検索ワード"
				enterkeyhint="search"
			/>
		</label>
		{#if regexError}<p class="error" role="alert">{regexError}</p>{/if}

		{#if showReplace}
			<label class="field">
				<span>置換後</span>
				<input type="text" bind:value={replaceWith} placeholder="置換後のテキスト" />
			</label>
		{/if}

		<div class="chips" role="group" aria-label="検索範囲">
			{#each scopeLabels as scope (scope.id)}
				<button
					class="chip"
					class:on={selectedScopes.includes(scope.id)}
					aria-pressed={selectedScopes.includes(scope.id)}
					onclick={() => toggleScope(scope.id)}
				>
					{scope.label}
				</button>
			{/each}
		</div>

		<div class="options">
			<label><input type="checkbox" bind:checked={caseSensitive} />大文字小文字を区別</label>
			<label><input type="checkbox" bind:checked={wholeWord} />単語単位</label>
			<label><input type="checkbox" bind:checked={useRegex} />正規表現</label>
			<label><input type="checkbox" bind:checked={showReplace} />置換</label>
		</div>

		<div class="actions">
			<button class="primary" onclick={handleSearch} disabled={isSearching || !searchQuery}>
				{isSearching ? '検索中...' : '検索'}
			</button>
			{#if showReplace}
				<button
					class="danger"
					onclick={handleReplace}
					disabled={!searchQuery || searchResults.length === 0}
				>
					すべて置換
				</button>
			{/if}
		</div>

		{#if searchResults.length > 0}
			<h3>検索結果 ({searchResults.length}件)</h3>
			<ul class="results">
				{#each searchResults as result (result.type + result.id)}
					<li>
						<button
							class="result"
							disabled={result.type !== 'scene' || !onOpenScene}
							onclick={() => openResult(result)}
						>
							<span class="result-head">
								<strong>{result.title}</strong>
								<small>{typeLabels[result.type]}・{result.matches}件</small>
							</span>
							<span class="preview">{result.preview}</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else if hasSearched && searchQuery && !isSearching}
			<p class="empty">検索結果がありません</p>
		{/if}
	</div>
</Sheet>

<style>
	.search {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 0 16px 24px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.field input {
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 16px;
		font-family: inherit;
	}

	.error {
		margin: 0;
		font-size: 13px;
		color: var(--color-error);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		height: 32px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-background);
		color: var(--color-text-secondary);
		font-size: 13px;
		cursor: pointer;
	}

	.chip.on {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 14%, var(--color-background));
		color: var(--color-primary);
		font-weight: 600;
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		font-size: 13px;
	}

	.options label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}

	.actions {
		display: flex;
		gap: 8px;
	}

	.actions button {
		flex: 1;
		height: 44px;
		border-radius: 12px;
		font-size: 14px;
		cursor: pointer;
	}

	.actions .primary {
		border: none;
		background: var(--color-primary);
		color: #fff;
		font-weight: 600;
	}

	.actions .danger {
		border: 1px solid var(--color-border);
		background: var(--color-background);
		color: var(--color-error);
	}

	.actions button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	h3 {
		margin: 4px 0 0;
		font-size: 14px;
	}

	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.results li {
		border-bottom: 1px solid var(--color-border);
	}

	.result {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 4px;
		border: none;
		background: transparent;
		color: var(--color-text);
		text-align: left;
		cursor: pointer;
	}

	.result:disabled {
		cursor: default;
	}

	.result-head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: baseline;
	}

	.result-head small {
		flex: none;
		color: var(--color-text-secondary);
	}

	.preview {
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-secondary);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.empty {
		margin: 24px 0;
		text-align: center;
		font-size: 14px;
		color: var(--color-text-secondary);
	}
</style>
