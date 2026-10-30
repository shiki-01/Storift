<script lang="ts">
	import { diffChars, type EditProposal } from '$lib/desktop/edits';
	import { claudeStore, type EditMode, type EditState } from '$lib/stores/claude.svelte';

	interface Props {
		/** 回答が終わる前は提案だけ(状態なし) */
		edit: EditProposal;
		editState?: EditState;
		mode: EditMode;
	}

	let { edit, editState, mode }: Props = $props();
	let busy = $state(false);

	let ops = $derived(diffChars(edit.old, edit.new));
	let added = $derived(ops.reduce((n, op) => n + (op.kind === 'add' ? op.text.length : 0), 0));
	let removed = $derived(ops.reduce((n, op) => n + (op.kind === 'del' ? op.text.length : 0), 0));

	// 判断が要るもの(未反映・反映できない)は開き、済んだものは 1 行に畳む。見出しを押すと開閉
	let userToggled = $state<boolean | null>(null);
	let expanded = $derived(
		userToggled ?? (!editState || editState.status === 'pending' || editState.status === 'failed')
	);
	// ファイル名「01_シーン名.md」からシーン名を出す
	let fileName = $derived(
		edit.file.split('/').slice(-1)[0]?.replace(/\.md$/, '').replace(/^\d+_/, '') ?? edit.file
	);

	const STATUS_LABELS: Record<EditState['status'], string> = {
		pending: '未反映',
		applied: '反映済み',
		rejected: '却下',
		failed: '反映できません',
		reverted: '元に戻しました'
	};

	async function run(action: () => Promise<void> | void) {
		busy = true;
		try {
			await action();
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="edit"
	class:applied={editState?.status === 'applied'}
	class:failed={editState?.status === 'failed'}
>
	<button
		class="edit-header"
		aria-expanded={expanded}
		onclick={() => (userToggled = !expanded)}
		title={expanded ? '差分を畳む' : '差分を表示'}
	>
		<span class="chevron" class:open={expanded}>▸</span>
		<span class="file" title={edit.file}>{editState?.sceneTitle ?? fileName}</span>
		<span class="count"
			><span class="plus">+{added}</span> <span class="minus">−{removed}</span></span
		>
		{#if editState}
			<span class="badge {editState.status}">{STATUS_LABELS[editState.status]}</span>
		{:else}
			<span class="badge">作成中</span>
		{/if}
	</button>
	{#if expanded}
		<div class="diff">
			{#each ops as op, i (i)}<span class={op.kind}>{op.text}</span>{/each}
		</div>
	{/if}
	{#if editState?.error}
		<div class="error">{editState.error}</div>
	{/if}
	{#if editState && mode !== 'suggest'}
		<div class="buttons">
			{#if editState.status === 'pending' || editState.status === 'failed' || editState.status === 'reverted'}
				<button
					class="primary"
					disabled={busy}
					onclick={() => run(() => claudeStore.applyEdit(editState))}
					>{editState.status === 'pending' ? '反映' : '再度反映'}</button
				>
			{/if}
			{#if editState.status === 'pending'}
				<button disabled={busy} onclick={() => claudeStore.rejectEdit(editState)}>却下</button>
			{/if}
			{#if editState.status === 'applied'}
				{#if !editState.reviewed}
					<button class="primary" onclick={() => claudeStore.keepEdit(editState)}>保持</button>
				{/if}
				<button disabled={busy} onclick={() => run(() => claudeStore.revertEdit(editState))}
					>元に戻す</button
				>
				{#if claudeStore.canReveal(editState)}
					<button onclick={() => claudeStore.revealEdit(editState)}>本文で表示</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.edit {
		margin: 8px 0;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		overflow: hidden;
	}

	.edit.applied {
		border-color: color-mix(in srgb, var(--color-success) 60%, var(--color-border));
	}

	.edit.failed {
		border-color: color-mix(in srgb, var(--color-error) 60%, var(--color-border));
	}

	.edit-header {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 10px;
		border: none;
		border-radius: 0;
		background: none;
		font-size: 12px;
		text-align: left;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.edit-header[aria-expanded='true'] {
		border-bottom: 1px solid var(--color-border);
	}

	.chevron {
		display: inline-block;
		transition: transform 0.15s;
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.count {
		flex: none;
		font-variant-numeric: tabular-nums;
	}

	.plus {
		color: var(--color-success);
	}

	.minus {
		color: var(--color-error);
	}

	.file {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.badge {
		flex: none;
		padding: 1px 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}

	.badge.applied {
		color: var(--color-success);
	}

	.badge.failed {
		color: var(--color-error);
	}

	.diff {
		padding: 8px 10px;
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.8;
		max-height: 320px;
		overflow-y: auto;
	}

	.del {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
		text-decoration: line-through;
	}

	.add {
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 16%, transparent);
	}

	.error {
		padding: 0 10px 8px;
		font-size: 12px;
		color: var(--color-error);
	}

	.buttons {
		display: flex;
		gap: 6px;
		padding: 0 10px 10px;
	}

	.buttons button {
		padding: 4px 12px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
		color: inherit;
		background: var(--color-surface);
	}

	.buttons button.primary {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-background);
	}

	.buttons button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
