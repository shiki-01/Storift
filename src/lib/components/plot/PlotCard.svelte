<script lang="ts">
	/**
	 * プロットのカード(ボードの列・タイムラインで共通)。
	 * 本文は冒頭だけを数行で見せ、あふれるときは「もっと見る」でカードの中で全文に広げられる。
	 * カードを押すと(文字を選択中を除く)詳細を開く。操作メニュー(状態の変更・上へ/下へ・複製・削除)は閲覧専用では出さない。
	 */
	import { onMount, tick, type Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import IconBadge from '$lib/components/items/IconBadge.svelte';
	import { formatDate } from '$lib/utils/dateUtils';
	import type { Plot } from '$lib/types';

	interface Props {
		plot: Plot;
		variant?: 'board' | 'timeline';
		selected?: boolean;
		readOnly?: boolean;
		/** タイムラインでの通し番号(1 始まり) */
		number?: number;
		/** タイムラインの最後(レールの線を伸ばさない) */
		last?: boolean;
		/** ボードのカードで、ハンドルを置く場所 */
		handle?: Snippet;
		typeLabel: string;
		statusLabel: string;
		statusOptions: { value: string; label: string }[];
		canMoveUp?: boolean;
		canMoveDown?: boolean;
		/** 並べ替えを使える(メニューに上へ/下へを出す) */
		sortable?: boolean;
		onopen: () => void;
		onstatus: (status: Plot['status']) => void;
		onmoveup?: () => void;
		onmovedown?: () => void;
		onduplicate: () => void;
		ondelete: () => void;
		oncontextmenu?: (e: MouseEvent) => void;
	}

	let {
		plot,
		variant = 'board',
		selected = false,
		readOnly = false,
		number,
		last = false,
		handle,
		typeLabel,
		statusLabel,
		statusOptions,
		canMoveUp = false,
		canMoveDown = false,
		sortable = false,
		onopen,
		onstatus,
		onmoveup,
		onmovedown,
		onduplicate,
		ondelete,
		oncontextmenu
	}: Props = $props();

	/** 以前の既定の色(鮮やかな青)。色を選んでいない旧データは、アプリの基調色で見せる */
	const LEGACY_DEFAULT_COLOR = '#3b82f6';
	const accent = $derived(
		plot.color && plot.color.toLowerCase() !== LEGACY_DEFAULT_COLOR
			? plot.color
			: 'var(--color-primary)'
	);

	const uid = $props.id();
	let expanded = $state(false);
	let overflowing = $state(false);
	let bodyEl = $state<HTMLElement>();

	/** 折りたたみ中に、本文が行数を超えてあふれているか */
	function measure() {
		if (!bodyEl || expanded) return;
		overflowing = bodyEl.scrollHeight > bodyEl.clientHeight + 1;
	}

	onMount(() => {
		if (!bodyEl) return;
		const observer = new ResizeObserver(measure);
		observer.observe(bodyEl);
		return () => observer.disconnect();
	});

	$effect(() => {
		void plot.content;
		void tick().then(measure);
	});

	function onCardClick(e: MouseEvent) {
		// 本文を選択している途中(ドラッグで選んだあと)は開かない
		if (window.getSelection()?.toString()) return;
		if ((e.target as HTMLElement).closest('button, [role="combobox"], a')) return;
		onopen();
	}

	/* ---------- 操作メニュー ---------- */

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
			// セレクトのポップアップは body の直下に出るので、外側とみなさない
			if (menuEl?.contains(t) || menuBtn?.contains(t) || t.closest('[role="listbox"]')) return;
			menuOpen = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			// セレクトが開いているときは、セレクトの Escape に任せる
			if (document.querySelector('[role="listbox"]')) return;
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

	function run(fn: (() => void) | undefined) {
		menuOpen = false;
		fn?.();
	}
</script>

{#snippet menuButton()}
	{#if !readOnly}
		<button
			bind:this={menuBtn}
			type="button"
			class="icon-btn"
			aria-label="{plot.title}の操作"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={toggleMenu}
		>
			<Icon name="dots" class="ico" />
		</button>
	{/if}
{/snippet}

<div class="wrap" data-variant={variant}>
	{#if variant === 'timeline'}
		<div class="rail" class:last aria-hidden="true">
			<IconBadge size={28} shape="circle" tone="primary" text={String(number ?? '')} />
		</div>
	{/if}
	<!-- カード全体のクリックはマウス向けの近道。キーボードではタイトルのボタンで開く -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<article
		class="card"
		class:selected
		style:--accent={accent}
		data-plot-id={plot.id}
		onclick={onCardClick}
		{oncontextmenu}
	>
		<div class="top">
			{#if handle}{@render handle()}{/if}
			<span class="tag">{typeLabel}</span>
			{#if variant === 'timeline'}<span class="tag status">{statusLabel}</span>{/if}
			<span class="spacer"></span>
			{@render menuButton()}
		</div>
		<h4 class="title">
			<button type="button" class="open" onclick={onopen}>{plot.title || '無題'}</button>
		</h4>
		{#if plot.content.trim()}
			<p
				bind:this={bodyEl}
				id="{uid}-body"
				class="body selectable"
				class:clamped={!expanded}
				data-clamp={variant === 'board' ? 4 : 5}
			>
				{plot.content}
			</p>
			{#if overflowing || expanded}
				<button
					type="button"
					class="more"
					aria-expanded={expanded}
					aria-controls="{uid}-body"
					onclick={() => {
						expanded = !expanded;
						void tick().then(measure);
					}}
				>
					<Icon name={expanded ? 'chevron-up' : 'chevron-down'} class="ico" />
					{expanded ? '閉じる' : 'もっと見る'}
				</button>
			{/if}
		{:else}
			<p class="body none">本文はまだありません</p>
		{/if}
		<footer class="foot">更新 {formatDate(plot.updatedAt, 'yyyy/MM/dd')}</footer>
	</article>
</div>

{#if menuOpen}
	<div
		bind:this={menuEl}
		class="menu"
		role="group"
		aria-label="{plot.title}の操作"
		style:top={menuPos ? `${menuPos.top}px` : '0'}
		style:left={menuPos ? `${menuPos.left}px` : '0'}
		style:visibility={menuPos ? undefined : 'hidden'}
	>
		<div class="menu-field">
			<span class="menu-label" id="{uid}-status-label">状態を変更</span>
			<Select
				options={statusOptions}
				value={plot.status}
				aria-label="状態を変更"
				onchange={(v) => run(() => onstatus(v as Plot['status']))}
			/>
		</div>
		{#if sortable}
			<button type="button" class="menu-item" disabled={!canMoveUp} onclick={() => run(onmoveup)}>
				<Icon name="arrow-up" class="ico" />上へ
			</button>
			<button
				type="button"
				class="menu-item"
				disabled={!canMoveDown}
				onclick={() => run(onmovedown)}
			>
				<Icon name="arrow-down" class="ico" />下へ
			</button>
		{/if}
		<button type="button" class="menu-item" onclick={() => run(onduplicate)}>
			<Icon name="files" class="ico" />複製
		</button>
		<button type="button" class="menu-item danger" onclick={() => run(ondelete)}>
			<Icon name="trash" class="ico" />削除
		</button>
	</div>
{/if}

<style>
	.wrap {
		display: flex;
		align-items: stretch;
		gap: 12px;
		min-width: 0;
	}

	.rail {
		position: relative;
		display: flex;
		flex: none;
		flex-direction: column;
		align-items: center;
		width: 28px;
		padding-top: 10px;
	}

	.rail:not(.last)::after {
		content: '';
		flex: 1;
		width: 2px;
		margin: 4px 0 -12px;
		border-radius: 1px;
		background: var(--color-border);
	}

	.card {
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 8px;
		box-sizing: border-box;
		min-width: 0;
		padding: 10px 14px 10px 16px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--editor-background, var(--color-background));
		color: var(--color-text);
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}

	/* 左端の色の帯(プロットの色)。角丸に沿わせる */
	.card::before {
		content: '';
		position: absolute;
		top: 8px;
		bottom: 8px;
		left: 0;
		width: 3px;
		border-radius: 0 3px 3px 0;
		background: var(--accent, var(--color-primary));
	}

	.card:hover {
		border-color: color-mix(in srgb, var(--color-text) 25%, var(--color-border));
	}

	.card.selected {
		border-color: var(--color-primary);
		background: color-mix(
			in srgb,
			var(--color-primary) 6%,
			var(--editor-background, var(--color-background))
		);
	}

	.top {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		margin-left: -6px;
	}

	.spacer {
		flex: 1;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 11.5px;
		white-space: nowrap;
	}

	.tag.status {
		border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
		color: var(--color-primary);
	}

	.title {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.5;
	}

	.open {
		display: -webkit-box;
		width: 100%;
		padding: 0;
		overflow: hidden;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.open:hover {
		color: var(--color-primary);
	}

	.body {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.75;
		color: var(--color-text-secondary);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		cursor: text;
	}

	.body.none {
		font-size: 12.5px;
		opacity: 0.7;
		cursor: inherit;
	}

	.body.clamped {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
	}

	.body.clamped[data-clamp='5'] {
		-webkit-line-clamp: 5;
		line-clamp: 5;
	}

	.more {
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
		gap: 2px;
		height: 24px;
		margin-left: -4px;
		padding: 0 6px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--color-primary);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}

	.more:hover {
		background: var(--hover);
	}

	.foot {
		font-size: 11.5px;
		color: var(--color-text-secondary);
		opacity: 0.85;
	}

	.icon-btn {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 7px;
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
			width: 36px;
			height: 36px;
		}
	}

	.card :global(.ico),
	.menu :global(.ico) {
		display: inline-flex;
		flex: none;
		width: 16px;
		height: 16px;
	}

	.card :global(.ico svg),
	.menu :global(.ico svg) {
		width: 100%;
		height: 100%;
	}

	.more :global(.ico) {
		width: 14px;
		height: 14px;
	}

	.menu {
		position: fixed;
		z-index: 1200;
		display: flex;
		flex-direction: column;
		gap: 2px;
		box-sizing: border-box;
		width: 232px;
		padding: 6px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: var(--shadow-float);
		-webkit-user-select: none;
		user-select: none;
	}

	.menu-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 4px 4px 8px;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 4px;
	}

	.menu-label {
		font-size: 11.5px;
		color: var(--color-text-secondary);
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
		.card {
			transition: none;
		}
	}
</style>
