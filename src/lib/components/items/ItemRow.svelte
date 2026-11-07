<script lang="ts" module>
	export interface RowMenuItem {
		label: string;
		icon?: string;
		danger?: boolean;
		disabled?: boolean;
		onselect: () => void;
	}
</script>

<script lang="ts">
	/**
	 * 一覧の 1 行(人物・設定資料)。左にアバター/アイコン枠、名前(1 行、あふれたら省略)、補足(muted の 1 行)、
	 * 右端に操作メニューと並べ替えのハンドル。操作は右端に集約し、行の本体を押すと詳細を開く。
	 *
	 * - 行の高さは 60px 以上、押せる範囲(本体・メニュー・ハンドル)はタッチで 44px 以上。
	 * - 左右の余白は --row-pad-x(既定 12px。狭い画面では呼び出し側が 16px にする)。
	 * - メニューの項目(menuItems)が無ければメニューを出さない(閲覧専用)。ハンドルは SortableList から渡される。
	 */
	import { tick, type Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		id: string;
		title: string;
		subtitle?: string;
		selected?: boolean;
		/** 先頭のアバター・アイコン枠(IconBadge) */
		lead: Snippet;
		/** 並べ替えのハンドル(SortableList の ctx.handle。並べ替えできないときは渡さない) */
		handle?: Snippet;
		menuItems?: RowMenuItem[];
		testid?: string;
		onopen: () => void;
		oncontextmenu?: (e: MouseEvent) => void;
	}

	let {
		id,
		title,
		subtitle = '',
		selected = false,
		lead,
		handle,
		menuItems = [],
		testid,
		onopen,
		oncontextmenu
	}: Props = $props();

	let menuOpen = $state(false);
	let menuBtn = $state<HTMLButtonElement>();
	let menuEl = $state<HTMLElement>();
	let menuPos = $state<{ top: number; left: number } | null>(null);

	async function toggleMenu() {
		if (menuOpen) {
			menuOpen = false;
			return;
		}
		menuPos = null;
		menuOpen = true;
		await tick();
		placeMenu();
	}

	function placeMenu() {
		if (!menuBtn || !menuEl) return;
		const b = menuBtn.getBoundingClientRect();
		const w = menuEl.offsetWidth;
		const h = menuEl.offsetHeight;
		const left = Math.max(8, Math.min(window.innerWidth - w - 8, b.right - w));
		const below = b.bottom + 4;
		const top = below + h > window.innerHeight - 8 ? Math.max(8, b.top - h - 4) : below;
		menuPos = { top, left };
	}

	$effect(() => {
		if (!menuOpen) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as HTMLElement;
			if (menuEl?.contains(t) || menuBtn?.contains(t)) return;
			menuOpen = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.stopPropagation();
			menuOpen = false;
			menuBtn?.focus();
		};
		window.addEventListener('pointerdown', onDown, true);
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('resize', placeMenu);
		return () => {
			window.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('resize', placeMenu);
		};
	});

	function run(item: RowMenuItem) {
		menuOpen = false;
		item.onselect();
	}
</script>

<div
	class="item-row"
	class:selected
	data-item-id={id}
	data-testid={testid}
	{oncontextmenu}
	role="presentation"
>
	<button type="button" class="open" aria-current={selected ? 'true' : undefined} onclick={onopen}>
		{@render lead()}
		<span class="texts">
			<span class="title">{title || '無題'}</span>
			{#if subtitle}<span class="sub">{subtitle}</span>{/if}
		</span>
	</button>
	{#if menuItems.length > 0}
		<button
			bind:this={menuBtn}
			type="button"
			class="icon-btn"
			aria-label="{title}の操作"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={toggleMenu}
		>
			<Icon name="dots" class="ico" />
		</button>
	{/if}
	{#if handle}{@render handle()}{/if}
</div>

{#if menuOpen}
	<div
		bind:this={menuEl}
		class="menu"
		role="group"
		aria-label="{title}の操作"
		style:top={menuPos ? `${menuPos.top}px` : '0'}
		style:left={menuPos ? `${menuPos.left}px` : '0'}
		style:visibility={menuPos ? undefined : 'hidden'}
	>
		{#each menuItems as item (item.label)}
			<button
				type="button"
				class="menu-item"
				class:danger={item.danger}
				disabled={item.disabled}
				onclick={() => run(item)}
			>
				{#if item.icon}<Icon name={item.icon} class="ico" />{/if}{item.label}
			</button>
		{/each}
	</div>
{/if}

<style>
	.item-row {
		display: flex;
		align-items: center;
		gap: 2px;
		box-sizing: border-box;
		min-height: 60px;
		padding: 4px var(--row-pad-x, 12px);
		border-radius: var(--row-radius, 10px);
		color: var(--color-text);
		transition: background-color 0.15s;
	}

	.item-row:hover {
		background: var(--hover);
	}

	.item-row.selected {
		background: var(--selected);
	}

	.open {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 12px;
		min-width: 0;
		min-height: 52px;
		margin: 0;
		padding: 4px 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.open:focus-visible,
	.icon-btn:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.texts {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.title {
		overflow: hidden;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.4;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sub {
		overflow: hidden;
		color: var(--color-text-secondary);
		font-size: 13px;
		line-height: 1.4;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.icon-btn {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.icon-btn:hover,
	.icon-btn[aria-expanded='true'] {
		background: var(--hover);
		color: var(--color-text);
	}

	@media (pointer: coarse) {
		.icon-btn {
			width: 44px;
			height: 44px;
		}
	}

	.item-row :global(.ico),
	.menu :global(.ico) {
		display: inline-flex;
		flex: none;
		width: 16px;
		height: 16px;
	}

	.item-row :global(.ico svg),
	.menu :global(.ico svg) {
		width: 100%;
		height: 100%;
	}

	.menu {
		position: fixed;
		z-index: 1200;
		display: flex;
		flex-direction: column;
		gap: 2px;
		box-sizing: border-box;
		width: 200px;
		padding: 6px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: var(--shadow-float);
		-webkit-user-select: none;
		user-select: none;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 34px;
		padding: 0 10px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 13.5px;
		text-align: left;
		cursor: pointer;
	}

	.menu-item:hover:not(:disabled) {
		background: var(--hover);
	}

	.menu-item:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.menu-item.danger {
		color: var(--color-error);
	}

	@media (pointer: coarse) {
		.menu-item {
			min-height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.item-row {
			transition: none;
		}
	}
</style>
