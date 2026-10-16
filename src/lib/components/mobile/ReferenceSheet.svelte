<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { charactersDB, worldbuildingDB, plotsDB } from '$lib/db';
	import type { Character, Worldbuilding } from '$lib/types';
	import { queueChange } from '$lib/services/sync.service';
	import { addMemo, removeMemo, loadMemos, saveMemos, type Memo } from '$lib/utils/memos';

	interface Props {
		open?: boolean;
		projectId: string;
		/** 開いたときに最初に表示するタブ */
		initialTab?: 'characters' | 'world' | 'memo';
		onPlotCreated?: () => void;
	}

	let {
		open = $bindable(false),
		projectId,
		initialTab = 'characters',
		onPlotCreated
	}: Props = $props();

	let tab = $state<'characters' | 'world' | 'memo'>('characters');
	let query = $state('');
	let characters = $state<Character[]>([]);
	let world = $state<Worldbuilding[]>([]);
	let memos = $state<Memo[]>([]);
	let memoDraft = $state('');
	let expandedId = $state<string | null>(null);
	let loading = $state(false);
	let notice = $state('');

	const categoryLabels: Record<Worldbuilding['category'], string> = {
		term: '用語',
		timeline: '年表',
		location: '場所',
		other: 'その他'
	};

	$effect(() => {
		if (!open) return;
		tab = initialTab;
		query = '';
		expandedId = null;
		notice = '';
		memos = loadMemos(projectId);
		loading = true;
		Promise.all([charactersDB.getByProjectId(projectId), worldbuildingDB.getByProjectId(projectId)])
			.then(([c, w]) => {
				characters = c;
				world = w;
			})
			.catch((error) => console.error('Failed to load reference data:', error))
			.finally(() => (loading = false));
	});

	let q = $derived(query.trim().toLowerCase());
	let filteredCharacters = $derived(
		characters.filter(
			(c) =>
				!q ||
				[c.name, c.role, c.personality, c.appearance, c.background].some((t) =>
					t?.toLowerCase().includes(q)
				)
		)
	);
	let filteredWorld = $derived(
		world.filter(
			(w) =>
				!q ||
				w.title.toLowerCase().includes(q) ||
				w.content.toLowerCase().includes(q) ||
				w.tags.some((t) => t.toLowerCase().includes(q))
		)
	);

	function toggle(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	function submitMemo(e: Event) {
		e.preventDefault();
		memos = addMemo(memos, memoDraft);
		saveMemos(projectId, memos);
		memoDraft = '';
	}

	function deleteMemo(id: string) {
		memos = removeMemo(memos, id);
		saveMemos(projectId, memos);
	}

	async function memoToPlot(memo: Memo) {
		try {
			const firstLine = memo.text.split('\n')[0].slice(0, 40);
			const plot = await plotsDB.create({
				projectId,
				title: firstLine,
				type: 'scene',
				status: 'idea'
			});
			if (memo.text.length > firstLine.length) {
				await plotsDB.update(plot.id, { content: memo.text });
			}
			await queueChange('plots', plot.id, 'create');
			deleteMemo(memo.id);
			notice = 'プロットに追加しました';
			onPlotCreated?.();
		} catch (error) {
			console.error('Failed to create plot from memo:', error);
			notice = 'プロットへの追加に失敗しました';
		}
	}

	const tabs = [
		{ id: 'characters', label: 'キャラクター' },
		{ id: 'world', label: '設定資料' },
		{ id: 'memo', label: 'メモ' }
	] as const;
</script>

<Sheet bind:open title="参照" size="half">
	<div class="ref">
		<div class="tabs" role="tablist">
			{#each tabs as t (t.id)}
				<button
					role="tab"
					aria-selected={tab === t.id}
					class="tab"
					class:active={tab === t.id}
					onclick={() => (tab = t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>

		{#if tab !== 'memo'}
			<input class="search" type="search" placeholder="検索" aria-label="検索" bind:value={query} />
		{/if}

		{#if tab === 'characters'}
			{#if loading}
				<p class="empty">読み込み中...</p>
			{:else if filteredCharacters.length === 0}
				<p class="empty">{characters.length === 0 ? 'キャラクターがまだありません' : '該当なし'}</p>
			{:else}
				<ul class="list">
					{#each filteredCharacters as c (c.id)}
						<li>
							<button class="row" onclick={() => toggle(c.id)} aria-expanded={expandedId === c.id}>
								<span class="row-title">{c.name}</span>
								<span class="row-sub">{c.role || ''}</span>
							</button>
							{#if expandedId === c.id}
								<dl class="detail">
									{#if c.age || c.gender}
										<dt>基本</dt>
										<dd>{[c.age ? `${c.age}歳` : '', c.gender].filter(Boolean).join(' / ')}</dd>
									{/if}
									{#if c.appearance}<dt>外見</dt>
										<dd>{c.appearance}</dd>{/if}
									{#if c.personality}<dt>性格</dt>
										<dd>{c.personality}</dd>{/if}
									{#if c.background}<dt>背景</dt>
										<dd>{c.background}</dd>{/if}
									{#if c.relationships.length > 0}
										<dt>関係</dt>
										<dd>
											{#each c.relationships as r}
												{@const other = characters.find((x) => x.id === r.characterId)}
												<div>{other?.name ?? '(不明)'}: {r.relation}</div>
											{/each}
										</dd>
									{/if}
								</dl>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else if tab === 'world'}
			{#if loading}
				<p class="empty">読み込み中...</p>
			{:else if filteredWorld.length === 0}
				<p class="empty">{world.length === 0 ? '設定資料がまだありません' : '該当なし'}</p>
			{:else}
				<ul class="list">
					{#each filteredWorld as w (w.id)}
						<li>
							<button class="row" onclick={() => toggle(w.id)} aria-expanded={expandedId === w.id}>
								<span class="row-title">{w.title}</span>
								<span class="row-sub">{categoryLabels[w.category]}</span>
							</button>
							{#if expandedId === w.id}
								<div class="detail body">{w.content}</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<form class="memo-form" onsubmit={submitMemo}>
				<textarea
					class="memo-input"
					rows="2"
					placeholder="思いついたことをすぐ書き留める"
					aria-label="メモ"
					bind:value={memoDraft}
				></textarea>
				<button class="add" type="submit" disabled={!memoDraft.trim()}>追加</button>
			</form>
			{#if notice}<p class="notice" role="status">{notice}</p>{/if}
			{#if memos.length === 0}
				<p class="empty">メモはまだありません</p>
			{:else}
				<ul class="list">
					{#each memos as m (m.id)}
						<li class="memo">
							<p class="memo-text">{m.text}</p>
							<div class="memo-actions">
								<button class="link" onclick={() => memoToPlot(m)}>プロットへ</button>
								<button class="link danger" onclick={() => deleteMemo(m.id)}>削除</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</Sheet>

<style>
	.ref {
		padding: 0 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.tabs {
		display: flex;
		gap: 4px;
		padding: 3px;
		border-radius: 10px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	.tab {
		flex: 1;
		height: 34px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 13px;
		cursor: pointer;
	}

	.tab.active {
		background: var(--color-background);
		color: var(--color-text);
		font-weight: 600;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
	}

	.search,
	.memo-input {
		width: 100%;
		box-sizing: border-box;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 16px;
		font-family: inherit;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.list > li {
		border-bottom: 1px solid var(--color-border);
	}

	.row {
		width: 100%;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 4px;
		border: none;
		background: transparent;
		color: var(--color-text);
		text-align: left;
		cursor: pointer;
	}

	.row-title {
		font-size: 15px;
		font-weight: 600;
	}

	.row-sub {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.detail {
		margin: 0;
		padding: 0 4px 12px;
		font-size: 14px;
		line-height: 1.7;
		color: var(--color-text);
	}

	.detail dt {
		font-size: 12px;
		color: var(--color-text-secondary);
		margin-top: 8px;
	}

	.detail dd {
		margin: 0;
		white-space: pre-wrap;
	}

	.detail.body {
		white-space: pre-wrap;
	}

	.empty {
		margin: 24px 0;
		text-align: center;
		font-size: 14px;
		color: var(--color-text-secondary);
	}

	.memo-form {
		display: flex;
		gap: 8px;
		align-items: flex-end;
	}

	.memo-input {
		resize: none;
		flex: 1;
	}

	.add {
		flex: none;
		height: 40px;
		padding: 0 16px;
		border: none;
		border-radius: 10px;
		background: var(--color-primary);
		color: #fff;
		font-size: 14px;
		cursor: pointer;
	}

	.add:disabled {
		opacity: 0.4;
	}

	.memo {
		padding: 12px 4px;
	}

	.memo-text {
		margin: 0;
		font-size: 14px;
		line-height: 1.7;
		white-space: pre-wrap;
	}

	.memo-actions {
		display: flex;
		gap: 16px;
		margin-top: 6px;
	}

	.link {
		border: none;
		background: transparent;
		padding: 4px 0;
		font-size: 13px;
		color: var(--color-primary);
		cursor: pointer;
	}

	.link.danger {
		color: var(--color-error);
	}

	.notice {
		margin: 0;
		font-size: 13px;
		color: var(--color-success);
	}
</style>
