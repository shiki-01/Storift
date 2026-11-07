<script lang="ts">
	/**
	 * 作品のメモ。執筆画面の右側(デスクトップ版は AI パネルと同じ位置)と、
	 * スマホの参照シートのメモタブで使う。範囲メモは本文の選択から作られ、一覧から本文の位置へ戻れる。
	 */
	import { tick } from 'svelte';
	import { dataChange } from '$lib/stores/dataChange.svelte';
	import { memosDB } from '$lib/db';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { aiStore } from '$lib/stores/ai.svelte';
	import { confirmDialog, toast } from '$lib/stores/toast.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import type { Memo } from '$lib/types';
	import TagInput from './TagInput.svelte';
	import {
		DEFAULT_MEMO_TAGS,
		TODO_TAG,
		buildTodoPrompt,
		filterMemos,
		isOpenTodo,
		mergeTags,
		resolveAnchor
	} from '$lib/utils/memos';

	interface Props {
		projectId: string;
		/** 引用を押したとき、そのメモの範囲へ移る(執筆画面だけ) */
		onJump?: (memo: Memo) => void;
		onClose?: () => void;
		/** プロットへ移す(スマホの参照シートだけ) */
		onToPlot?: (memo: Memo) => void;
		/** 参照シートの中に入れるとき。幅を合わせ、入力欄へ自動でフォーカスしない */
		sheet?: boolean;
	}

	let { projectId, onJump, onClose, onToPlot, sheet = false }: Props = $props();

	// AI への依頼はデスクトップ版だけ
	const desktop = isDesktop();

	let memos = $state<Memo[]>([]);
	let scope = $state<'scene' | 'all'>(editorStore.currentScene ? 'scene' : 'all');
	let tagFilter = $state<string | null>(null);
	let query = $state('');
	let openOnly = $state(false);

	let draftText = $state('');
	let draftTags = $state<string[]>([]);
	let inputEl = $state<HTMLTextAreaElement>();

	let editingId = $state<string | null>(null);
	let editText = $state('');
	let editTags = $state<string[]>([]);

	let sceneId = $derived(editorStore.currentScene?.id ?? null);
	// 開いているシーンがなければ「すべて」だけ
	let effectiveScope = $derived<'scene' | 'all'>(sceneId ? scope : 'all');
	let draft = $derived(editorStore.memoDraft);
	let sceneTitles = $derived(new Map(currentProjectStore.scenes.map((s) => [s.id, s.title])));
	let allTags = $derived([...new Set([...DEFAULT_MEMO_TAGS, ...memos.flatMap((m) => m.tags)])]);
	let visible = $derived(
		filterMemos(memos, {
			scope: effectiveScope,
			sceneId,
			tag: tagFilter,
			query,
			openOnly
		})
	);
	let openTodos = $derived(memos.filter(isOpenTodo));

	// メモの変更を読み直す(自分の操作も、本文の強調表示も、同じ通知で更新される)
	$effect(() => {
		void editorStore.memoVersion;
		void dataChange.revision('memos');
		let cancelled = false;
		memosDB
			.getByProject(projectId)
			.then((list) => {
				if (!cancelled) memos = list;
			})
			.catch((error) => console.error('Failed to load memos:', error));
		return () => {
			cancelled = true;
		};
	});

	// パネルを開き直すたびに入力欄へフォーカスし、本文から来た範囲があれば「このシーン」に切り替える
	$effect(() => {
		void editorStore.memoRequest;
		if (editorStore.memoDraft) scope = 'scene';
		if (sheet) return;
		void tick().then(() => inputEl?.focus({ preventScroll: true }));
	});

	function sceneTitleOf(memo: Memo): string | undefined {
		return memo.sceneId ? sceneTitles.get(memo.sceneId) : undefined;
	}

	/** 引用が本文から消えていれば true(位置不明) */
	function anchorLost(memo: Memo): boolean {
		if (!memo.anchor || !memo.sceneId) return false;
		const text =
			memo.sceneId === sceneId
				? editorStore.content
				: currentProjectStore.scenes.find((s) => s.id === memo.sceneId)?.content;
		if (text === undefined) return false;
		return resolveAnchor(text, memo.anchor) === null;
	}

	async function addMemo() {
		const text = draftText.trim();
		if (!text) return;
		const pending = editorStore.memoDraft;
		try {
			await memosDB.create({
				projectId,
				text,
				tags: mergeTags(draftTags, text),
				sceneId: pending?.sceneId ?? sceneId ?? undefined,
				anchor: pending?.anchor
			});
		} catch (error) {
			console.error('Failed to save memo:', error);
			toast.error('メモを保存できませんでした');
			return;
		}
		draftText = '';
		draftTags = [];
		editorStore.memoDraft = null;
		editorStore.bumpMemos();
	}

	async function toggleDone(memo: Memo) {
		const done = !memo.done;
		memos = memos.map((m) => (m.id === memo.id ? { ...m, done } : m));
		try {
			await memosDB.update(memo.id, { done });
		} catch (error) {
			console.error('Failed to update memo:', error);
			toast.error('完了の状態を保存できませんでした');
		}
		editorStore.bumpMemos();
	}

	function startEdit(memo: Memo) {
		editingId = memo.id;
		editText = memo.text;
		editTags = [...memo.tags];
	}

	function cancelEdit() {
		editingId = null;
	}

	async function saveEdit(memo: Memo) {
		const text = editText.trim();
		if (!text) return;
		try {
			await memosDB.update(memo.id, { text, tags: mergeTags(editTags, text) });
		} catch (error) {
			console.error('Failed to update memo:', error);
			toast.error('メモを保存できませんでした');
			return;
		}
		editingId = null;
		editorStore.bumpMemos();
	}

	async function removeMemo(memo: Memo) {
		if (!(await confirmDialog('このメモを削除しますか?'))) return;
		try {
			await memosDB.delete(memo.id);
		} catch (error) {
			console.error('Failed to delete memo:', error);
			toast.error('メモを削除できませんでした');
		}
		editorStore.bumpMemos();
	}

	/** 未完了の TODO を番号付きの依頼文にして、AI パネルで送る */
	async function requestTodos() {
		const targets = openTodos;
		if (targets.length === 0) return;
		if (aiStore.isRunning) {
			toast.info('AI が回答中です。終わってから依頼してください');
			return;
		}
		const prompt = buildTodoPrompt(
			targets.map((m) => ({
				text: m.text,
				sceneTitle: sceneTitleOf(m),
				quote: m.anchor?.quote
			}))
		);
		const now = Date.now();
		try {
			await Promise.all(targets.map((m) => memosDB.update(m.id, { requestedAt: now })));
		} catch (error) {
			console.error('Failed to mark memos as requested:', error);
			toast.error('依頼の記録に失敗しました');
			return;
		}
		editorStore.bumpMemos();
		editorStore.memoOpen = false;
		aiStore.open = true;
		// 完了チェックはユーザーが行うので、送っただけでは完了にしない
		void aiStore.send(prompt, { quote: null });
	}

	function onDraftKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
			e.preventDefault();
			void addMemo();
		}
	}

	function onEditKeydown(e: KeyboardEvent, memo: Memo) {
		if (e.isComposing) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void saveEdit(memo);
		}
	}
</script>

<aside class="memo" class:sheet aria-label="メモ" data-tour="memo-panel">
	{#if !sheet}
		<header class="head">
			<h2 class="title">メモ</h2>
			{#if onClose}
				<button
					type="button"
					class="icon"
					onclick={onClose}
					aria-label="メモを閉じる"
					title="閉じる"
				>
					×
				</button>
			{/if}
		</header>
	{/if}

	<div class="bar">
		<div class="seg" role="group" aria-label="表示の範囲">
			<button
				type="button"
				class:on={effectiveScope === 'scene'}
				aria-pressed={effectiveScope === 'scene'}
				disabled={!sceneId}
				onclick={() => (scope = 'scene')}>このシーン</button
			>
			<button
				type="button"
				class:on={effectiveScope === 'all'}
				aria-pressed={effectiveScope === 'all'}
				onclick={() => (scope = 'all')}>すべて</button
			>
		</div>
		<label class="check">
			<input type="checkbox" bind:checked={openOnly} />
			未完了のみ
		</label>
	</div>

	<div class="search">
		<input type="search" bind:value={query} placeholder="メモを検索" aria-label="メモを検索" />
	</div>

	{#if allTags.length > 0}
		<div class="tags" aria-label="タグで絞り込み">
			{#each allTags as tag (tag)}
				<button
					type="button"
					class="tag"
					class:on={tagFilter === tag}
					aria-pressed={tagFilter === tag}
					onclick={() => (tagFilter = tagFilter === tag ? null : tag)}>#{tag}</button
				>
			{/each}
		</div>
	{/if}

	<form
		class="composer"
		onsubmit={(e) => {
			e.preventDefault();
			void addMemo();
		}}
	>
		{#if draft}
			<div class="draft">
				<span class="draft-quote">選択範囲: 「{draft.anchor.quote}」</span>
				<button type="button" class="link" onclick={() => (editorStore.memoDraft = null)}>
					外す
				</button>
			</div>
		{/if}
		<textarea
			bind:this={inputEl}
			bind:value={draftText}
			onkeydown={onDraftKeydown}
			rows="3"
			placeholder="メモを入力(Ctrl+Enter で追加)"
			aria-label="メモの内容"
		></textarea>
		<TagInput
			bind:value={draftTags}
			suggestions={allTags}
			label="タグ"
			placeholder="タグ(Enter で確定)"
		/>
		<div class="composer-actions">
			<button type="submit" class="primary" disabled={!draftText.trim()}>追加</button>
		</div>
	</form>

	{#if desktop && openTodos.length > 0}
		<div class="todo-request">
			<button
				type="button"
				class="primary wide"
				onclick={requestTodos}
				disabled={aiStore.isRunning}
			>
				todo を AI に依頼({openTodos.length}件)
			</button>
		</div>
	{/if}

	<ul class="list">
		{#each visible as memo (memo.id)}
			<li class="item" class:done={memo.done}>
				{#if editingId === memo.id}
					<textarea
						bind:value={editText}
						onkeydown={(e) => onEditKeydown(e, memo)}
						rows="3"
						aria-label="メモを編集"
					></textarea>
					<TagInput bind:value={editTags} suggestions={allTags} label="タグを編集" />
					<div class="actions">
						<button type="button" class="link" onclick={cancelEdit}>キャンセル</button>
						<button
							type="button"
							class="link strong"
							onclick={() => saveEdit(memo)}
							disabled={!editText.trim()}>保存</button
						>
					</div>
				{:else}
					<div class="row">
						{#if memo.tags.includes(TODO_TAG)}
							<input
								type="checkbox"
								class="done-check"
								checked={memo.done}
								onchange={() => toggleDone(memo)}
								aria-label="完了"
							/>
						{/if}
						<div class="main">
							<p class="text selectable">{memo.text}</p>
							{#if memo.anchor}
								<button
									type="button"
									class="quote"
									onclick={() => onJump?.(memo)}
									disabled={!onJump || !memo.sceneId}
									title={onJump ? '本文の位置へ移動' : undefined}
								>
									「{memo.anchor.quote}」
								</button>
							{/if}
							<div class="meta">
								{#if effectiveScope === 'all' && sceneTitleOf(memo)}
									<span>{sceneTitleOf(memo)}</span>
								{/if}
								{#if anchorLost(memo)}
									<span class="badge warn">位置不明</span>
								{/if}
								{#if memo.requestedAt}
									<span class="badge">依頼済み</span>
								{/if}
								{#each memo.tags as tag (tag)}
									<button type="button" class="tag tiny" onclick={() => (tagFilter = tag)}
										>#{tag}</button
									>
								{/each}
							</div>
							<div class="actions">
								<button type="button" class="link" onclick={() => startEdit(memo)}>編集</button>
								{#if onToPlot}
									<button type="button" class="link" onclick={() => onToPlot(memo)}
										>プロットへ</button
									>
								{/if}
								<button type="button" class="link danger" onclick={() => removeMemo(memo)}
									>削除</button
								>
							</div>
						</div>
					</div>
				{/if}
			</li>
		{:else}
			<li class="empty">
				{memos.length === 0 ? 'メモはまだありません' : '該当するメモがありません'}
			</li>
		{/each}
	</ul>
</aside>

<style>
	.memo {
		flex: none;
		display: flex;
		flex-direction: column;
		width: 340px;
		height: 100%;
		min-height: 0;
		border-left: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 14px;
	}

	.memo.sheet {
		width: auto;
		height: auto;
		border: none;
		background: transparent;
	}

	.head {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 48px;
		padding: 0 8px 0 14px;
		border-bottom: 1px solid var(--color-border);
	}

	.title {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
	}

	.bar,
	.search,
	.tags,
	.composer,
	.todo-request {
		flex: none;
		padding: 8px 12px;
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.seg {
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: 8px;
		background: var(--color-background);
		border: 1px solid var(--color-border);
	}

	.seg button {
		padding: 3px 8px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-text);
		font-size: 12px;
		cursor: pointer;
	}

	.seg button.on {
		background: var(--selected);
		color: var(--color-primary);
		font-weight: 600;
	}

	.seg button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	input[type='search'],
	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 6px 8px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 13px;
	}

	textarea {
		resize: vertical;
		line-height: 1.6;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding-top: 0;
	}

	.tag {
		padding: 2px 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-background);
		color: var(--color-text-secondary);
		font-size: 12px;
		cursor: pointer;
	}

	.tag.on {
		background: var(--selected);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.tag.tiny {
		padding: 0 6px;
		font-size: 11px;
	}

	.composer {
		display: flex;
		flex-direction: column;
		gap: 6px;
		border-bottom: 1px solid var(--color-border);
	}

	.draft {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		font-size: 12px;
	}

	.draft-quote {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.composer-actions {
		display: flex;
		justify-content: flex-end;
	}

	button {
		font: inherit;
		cursor: pointer;
	}

	.primary {
		padding: 5px 14px;
		border: none;
		border-radius: 8px;
		background: var(--color-primary);
		color: var(--color-background);
		font-size: 13px;
	}

	.primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.primary.wide {
		width: 100%;
		padding: 7px 10px;
	}

	.link {
		padding: 2px 0;
		border: none;
		background: transparent;
		color: var(--color-primary);
		font-size: 12px;
	}

	.link.strong {
		font-weight: 600;
	}

	.link.danger {
		color: var(--color-error);
	}

	.link:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.icon {
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text);
		font-size: 18px;
	}

	.icon:hover,
	.seg button:hover:not(.on) {
		background: var(--hover);
	}

	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		margin: 0;
		padding: 4px 12px 16px;
		list-style: none;
	}

	.memo.sheet .list {
		overflow: visible;
	}

	.item {
		padding: 10px 0;
		border-bottom: 1px solid var(--color-border);
	}

	.row {
		display: flex;
		gap: 8px;
	}

	.done-check {
		flex: none;
		margin-top: 3px;
	}

	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.item.done .text {
		text-decoration: line-through;
		color: var(--color-text-secondary);
	}

	.text {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.quote {
		align-self: flex-start;
		max-width: 100%;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 12px;
		line-height: 1.5;
		text-align: left;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.quote:not(:disabled):hover {
		color: var(--color-primary);
	}

	.quote:disabled {
		cursor: default;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 6px;
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.badge {
		padding: 0 6px;
		border-radius: 4px;
		background: var(--hover);
	}

	.badge.warn {
		color: var(--color-warning);
	}

	.actions {
		display: flex;
		gap: 14px;
	}

	.empty {
		margin: 24px 0;
		text-align: center;
		color: var(--color-text-secondary);
		font-size: 13px;
		list-style: none;
	}

	.memo.sheet input[type='search'],
	.memo.sheet textarea {
		font-size: 16px;
	}
</style>
