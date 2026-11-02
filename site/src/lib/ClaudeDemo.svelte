<script lang="ts">
	import Icon from '$lib/Icon.svelte';

	// デスクトップ版の Claude Code パネルで、編集案を差分として確かめる場面の再現。ボタンは実際に押せる
	let state = $state<'pending' | 'applied' | 'rejected'>('pending');
</script>

<div class="panel">
	<p class="head"><Icon name="claude" size={15} />Claude Code<span>提案のみ</span></p>
	<p class="q">祖母の台詞、もう少し間を置きたい</p>
	<p class="a">
		読点の位置を「もう」の後ろへ移すと、言い淀む間が生まれます。次のように直す案です。
	</p>

	<div class="edit">
		<p class="edit-head">
			<span>第一章 / 祖母の栞</span>
			{#if state === 'pending'}
				<span class="tag">未反映</span>
			{:else if state === 'applied'}
				<span class="tag ok">反映済み</span>
			{:else}
				<span class="tag off">却下</span>
			{/if}
		</p>
		<p class="diff" aria-live="polite">
			{#if state === 'pending'}
				「この町へは<del>、</del>もう<ins>、</ins>行けないのよ」
			{:else if state === 'applied'}
				「この町へはもう、行けないのよ」
			{:else}
				「この町へは、もう行けないのよ」
			{/if}
		</p>
		<div class="actions">
			{#if state === 'pending'}
				<button type="button" class="b secondary" onclick={() => (state = 'rejected')}>却下</button>
				<button type="button" class="b primary" onclick={() => (state = 'applied')}>反映</button>
			{:else}
				<button type="button" class="b secondary" onclick={() => (state = 'pending')}>
					<Icon name="replay" size={13} />元に戻す
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		font-size: 13px;
		line-height: 1.7;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--color-border);
		font-weight: 600;
	}

	.head :global(svg) {
		color: var(--color-accent);
	}

	.head span {
		margin-left: auto;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 11px;
		font-weight: 400;
		color: var(--color-text-secondary);
	}

	.q {
		align-self: flex-end;
		max-width: 85%;
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--color-surface);
	}

	.edit {
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--editor-background);
		overflow: hidden;
	}

	.edit-head {
		display: flex;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid var(--color-border);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.tag {
		color: var(--color-accent);
	}

	.tag.ok {
		color: var(--color-success);
	}

	.tag.off {
		color: var(--color-text-secondary);
	}

	.diff {
		padding: 14px 12px;
		font-family: var(--font-serif);
		font-size: 15px;
		letter-spacing: 0.04em;
	}

	del {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	ins {
		text-decoration: none;
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 14%, transparent);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 0 12px 12px;
	}

	.b {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 32px;
		padding: 0 14px;
		border: 1px solid transparent;
		border-radius: 8px;
		font: inherit;
		font-size: 12.5px;
		line-height: 1;
		cursor: pointer;
		transition:
			background-color 0.15s,
			transform 0.1s;
	}

	.b:active {
		transform: scale(0.97);
	}

	.b.primary {
		background: var(--color-primary);
		color: var(--color-background);
	}

	.b.primary:hover {
		background: color-mix(in srgb, var(--color-primary) 88%, var(--color-text));
	}

	.b.secondary {
		border-color: var(--color-border);
		background: var(--color-background);
		color: var(--color-text);
	}

	.b.secondary:hover {
		background: var(--hover);
	}
</style>
