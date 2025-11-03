<script lang="ts">
	import { onMount } from 'svelte';

	interface MenuItem {
		label: string;
		icon?: string;
		action: () => void;
		disabled?: boolean;
		divider?: boolean;
		shortcut?: string;
		danger?: boolean;
	}

	interface Props {
		items: MenuItem[];
		x?: number;
		y?: number;
		visible?: boolean;
		onClose?: () => void;
	}

	let { items, x = 0, y = 0, visible = false, onClose }: Props = $props();

	let menuElement: HTMLDivElement | null = $state(null);

	// 画面外に出ないように位置を調整
	$effect(() => {
		if (visible && menuElement) {
			const rect = menuElement.getBoundingClientRect();
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;

			// 右端からはみ出る場合
			if (x + rect.width > viewportWidth) {
				x = viewportWidth - rect.width - 10;
			}

			// 下端からはみ出る場合
			if (y + rect.height > viewportHeight) {
				y = viewportHeight - rect.height - 10;
			}

			// 最小位置
			if (x < 10) x = 10;
			if (y < 10) y = 10;
		}
	});

	function handleItemClick(item: MenuItem) {
		if (!item.disabled) {
			item.action();
			onClose?.();
		}
	}

	function handleClickOutside(event: MouseEvent) {
		if (menuElement && !menuElement.contains(event.target as Node)) {
			onClose?.();
		}
	}

	function handleEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onClose?.();
		}
	}

	onMount(() => {
		if (visible) {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleEscape);

			return () => {
				document.removeEventListener('click', handleClickOutside);
				document.removeEventListener('keydown', handleEscape);
			};
		}
	});
</script>

{#if visible}
	<div
		bind:this={menuElement}
		class="context-menu bg:white z:9999"
		style="left: {x}px; top: {y}px;"
		role="menu"
		tabindex="-1"
	>
		{#each items as item}
			{#if item.divider}
				<div class="divider"></div>
			{:else}
				<button
					class="menu-item"
					class:disabled={item.disabled}
					class:danger={item.danger}
					disabled={item.disabled}
					onclick={() => handleItemClick(item)}
					role="menuitem"
				>
					{#if item.icon}
						<span class="icon">{item.icon}</span>
					{/if}
					<span class="label">{item.label}</span>
					{#if item.shortcut}
						<span class="shortcut">{item.shortcut}</span>
					{/if}
				</button>
			{/if}
		{/each}
	</div>
	<button
		aria-label="close"
		onclick={() => (visible = false)}
		class="w:100dvw h:100dvh fixed top:0 left:0 z:9998"
	></button>
{/if}

<style>
	.context-menu {
		position: fixed;
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		min-width: 200px;
		padding: 4px;
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 12px;
		border: none;
		background: none;
		color: var(--text);
		font-size: 14px;
		text-align: left;
		cursor: pointer;
		border-radius: 4px;
		transition: background-color 0.15s;
	}

	.menu-item:hover:not(.disabled) {
		background: var(--hover);
	}

	.menu-item.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.menu-item.danger {
		color: var(--error);
	}

	.menu-item.danger:hover:not(.disabled) {
		background: var(--error-bg, rgba(220, 38, 38, 0.1));
	}

	.icon {
		flex-shrink: 0;
		width: 16px;
		text-align: center;
	}

	.label {
		flex: 1;
	}

	.shortcut {
		flex-shrink: 0;
		font-size: 12px;
		opacity: 0.6;
	}

	.divider {
		height: 1px;
		background: var(--border);
		margin: 4px 0;
	}
</style>
