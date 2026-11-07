<script lang="ts">
	import Icon from './Icon.svelte';

	type SaveStateValue = 'saving' | 'dirty' | 'error' | 'saved';

	let { state, class: className = '' }: { state: SaveStateValue; class?: string } = $props();

	const items = [
		{ key: 'saved', label: '保存済み', icon: 'check' },
		{ key: 'saving', label: '保存中', icon: 'loader-2' },
		{ key: 'dirty', label: '未保存', icon: 'circle-dot' },
		{ key: 'error', label: '保存失敗', icon: 'alert-triangle' }
	] as const;
</script>

<!-- 4 つの状態のラベルを同じセルに重ね、見えるのは現在の状態だけ。
     幅は最長のラベルで決まるので、状態が変わっても右側のボタンの位置は動かない -->
<span class="save-state {className}" data-state={state} role="status">
	{#each items as item (item.key)}
		<span class="item" class:current={item.key === state} aria-hidden={item.key !== state}>
			<span class="glyph" class:spin={item.key === 'saving'}>
				<Icon name={item.icon} />
			</span>
			<span class="label">{item.label}</span>
		</span>
	{/each}
</span>

<style>
	.save-state {
		display: inline-grid;
		color: var(--color-text-secondary);
		white-space: nowrap;
		font-size: 12px;
	}

	.item {
		grid-area: 1 / 1;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		visibility: hidden;
	}

	.item.current {
		visibility: visible;
	}

	.glyph {
		display: inline-flex;
		flex: none;
		width: 14px;
		height: 14px;
	}

	.glyph :global(div) {
		display: flex;
	}

	.glyph :global(svg) {
		width: 14px;
		height: 14px;
	}

	.save-state[data-state='saved'] .glyph {
		color: var(--color-success);
	}

	.save-state[data-state='dirty'] .glyph {
		color: var(--color-warning);
	}

	.save-state[data-state='saving'] .glyph {
		color: var(--color-info);
	}

	.save-state[data-state='error'],
	.save-state[data-state='error'] .glyph {
		color: var(--color-error);
	}

	.spin {
		animation: save-spin 1s linear infinite;
	}

	@keyframes save-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
		}
	}
</style>
