<script lang="ts">
	/**
	 * 独自のセレクト(ボタン + ポップアップのリストボックス)。ブラウザ標準の <select> の代わりに使う。
	 * - ポップアップは body に出し、position: fixed で空きの広い側(上/下)へ開く。親の overflow で切れない。
	 * - キーボード: ↑↓ / Home / End で移動、Enter / Space で確定、Esc で閉じる、文字入力で先頭一致ジャンプ。
	 * - size="sm" は文中・ツールバー向けの小さい枠なし表示、"md" は設定画面などの入力欄の見た目。
	 */
	import { tick, type Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import {
		computePlacement,
		findTypeahead,
		firstEnabled,
		lastEnabled,
		stepEnabled,
		type Placement,
		type SelectOption
	} from './selectLogic';

	interface Props {
		options: SelectOption[];
		value?: string;
		placeholder?: string;
		/** 見えるラベルがないときのアクセシブルな名前 */
		'aria-label'?: string;
		/** <label for> から参照するための id(トリガーのボタンに付く) */
		id?: string;
		/** 見えるラベル(ボタンの名前に使う) */
		label?: string;
		disabled?: boolean;
		size?: 'sm' | 'md';
		/** ポップアップの最小幅(px)。トリガーが狭いときに広げる */
		menuMinWidth?: number;
		class?: string;
		/** トリガーの左に出す飾り(アイコンなど) */
		leading?: Snippet;
		onchange?: (value: string) => void;
	}

	let {
		options,
		value = $bindable(''),
		placeholder = '選択してください',
		'aria-label': ariaLabel,
		id,
		label,
		disabled = false,
		size = 'md',
		menuMinWidth = 0,
		class: className = '',
		leading,
		onchange
	}: Props = $props();

	const uid = $props.id();
	const listId = `${uid}-list`;
	const optionId = (i: number) => `${uid}-opt-${i}`;

	let triggerEl = $state<HTMLButtonElement>();
	let popupEl = $state<HTMLDivElement>();
	let open = $state(false);
	let activeIndex = $state(-1);
	let placement = $state<Placement | null>(null);

	let selectedIndex = $derived(options.findIndex((o) => o.value === value));
	let selected = $derived(selectedIndex >= 0 ? options[selectedIndex] : undefined);
	let hasDescriptions = $derived(options.some((o) => o.description));

	/** 先頭一致ジャンプ用の入力バッファ(少し間が空いたら消す) */
	let typeBuffer = '';
	let typeTimer: ReturnType<typeof setTimeout> | undefined;

	function commit(index: number) {
		const option = options[index];
		if (!option || option.disabled) return;
		const changed = option.value !== value;
		value = option.value;
		if (changed) onchange?.(option.value);
	}

	async function openList() {
		if (disabled || open || options.length === 0) return;
		activeIndex =
			selectedIndex >= 0 && !options[selectedIndex].disabled
				? selectedIndex
				: firstEnabled(options);
		placement = null;
		open = true;
		await tick();
		place();
		scrollActiveIntoView();
	}

	function closeList(refocus = false) {
		if (!open) return;
		open = false;
		placement = null;
		typeBuffer = '';
		if (refocus) triggerEl?.focus();
	}

	/** トリガーの位置と、ポップアップの本来の高さから、開く向きと位置を決める */
	function place() {
		if (!open || !triggerEl || !popupEl) return;
		const rect = triggerEl.getBoundingClientRect();
		placement = computePlacement(
			rect,
			popupEl.scrollHeight,
			{ width: window.innerWidth, height: window.innerHeight },
			Math.max(menuMinWidth, 0)
		);
	}

	function scrollActiveIntoView() {
		if (activeIndex < 0) return;
		document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
	}

	function setActive(index: number) {
		if (index < 0) return;
		activeIndex = index;
		scrollActiveIntoView();
	}

	/** 開いている間だけ、外側の操作と画面の変化を見る */
	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (triggerEl?.contains(target) || popupEl?.contains(target)) return;
			closeList();
		};
		const onViewportChange = (e: Event) => {
			// ポップアップ自身のスクロールでは動かさない
			if (e.target instanceof Node && popupEl?.contains(e.target)) return;
			place();
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('resize', onViewportChange);
		window.addEventListener('scroll', onViewportChange, true);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('resize', onViewportChange);
			window.removeEventListener('scroll', onViewportChange, true);
		};
	});

	/** ポップアップを body の直下へ移す(親の overflow や transform に影響されない) */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function onTypeahead(char: string): boolean {
		clearTimeout(typeTimer);
		typeBuffer += char;
		typeTimer = setTimeout(() => (typeBuffer = ''), 600);
		const found = findTypeahead(options, typeBuffer, open ? activeIndex : selectedIndex);
		if (found < 0) return true;
		if (open) setActive(found);
		else commit(found);
		return true;
	}

	function onKeydown(e: KeyboardEvent) {
		if (disabled || e.isComposing) return;
		const key = e.key;

		if (!open) {
			if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
				e.preventDefault();
				void openList();
			} else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
				e.preventDefault();
				onTypeahead(key);
			}
			return;
		}

		switch (key) {
			case 'ArrowDown':
				e.preventDefault();
				setActive(activeIndex < 0 ? firstEnabled(options) : stepEnabled(options, activeIndex, 1));
				return;
			case 'ArrowUp':
				e.preventDefault();
				setActive(activeIndex < 0 ? lastEnabled(options) : stepEnabled(options, activeIndex, -1));
				return;
			case 'Home':
				e.preventDefault();
				setActive(firstEnabled(options));
				return;
			case 'End':
				e.preventDefault();
				setActive(lastEnabled(options));
				return;
			case 'Escape':
				// 外側のダイアログなどまで閉じないよう、ここで止める
				e.preventDefault();
				e.stopPropagation();
				closeList(true);
				return;
			case 'Tab':
				closeList();
				return;
			case 'Enter':
				e.preventDefault();
				commit(activeIndex);
				closeList(true);
				return;
			case ' ':
				e.preventDefault();
				if (typeBuffer) onTypeahead(' ');
				else {
					commit(activeIndex);
					closeList(true);
				}
				return;
		}
		if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			onTypeahead(key);
		}
	}

	function onTriggerClick() {
		// Safari ではクリックでボタンにフォーカスが移らないので、キー操作のために明示する
		triggerEl?.focus();
		if (open) closeList();
		else void openList();
	}

	function onBlur(e: FocusEvent) {
		// ポップアップの中の操作では閉じない(ポップアップ側は mousedown でフォーカスを動かさない)
		if (popupEl && e.relatedTarget instanceof Node && popupEl.contains(e.relatedTarget)) return;
		closeList();
	}

	$effect(() => {
		// 無効になったら閉じる
		if (disabled) closeList();
	});
</script>

<button
	bind:this={triggerEl}
	{id}
	type="button"
	class="select {className}"
	class:open
	data-size={size}
	role="combobox"
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-controls={open ? listId : undefined}
	aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
	aria-label={ariaLabel}
	{disabled}
	onclick={onTriggerClick}
	onkeydown={onKeydown}
	onblur={onBlur}
>
	{#if leading}<span class="leading">{@render leading()}</span>{/if}
	{#if label}<span class="select-label">{label}</span>{/if}
	<span class="current" class:placeholder={!selected} title={selected?.label}>
		{selected?.label ?? placeholder}
	</span>
	<span class="chevron" aria-hidden="true"><Icon name="chevron-down" /></span>
</button>

{#if open}
	<!-- フォーカスはトリガーに残す(aria-activedescendant で現在の項目を伝える) -->
	<div
		bind:this={popupEl}
		use:portal
		id={listId}
		class="select-popup"
		class:wide={hasDescriptions}
		data-side={placement?.side ?? 'down'}
		data-size={size}
		role="listbox"
		tabindex="-1"
		aria-label={ariaLabel ?? label}
		style={placement
			? `top:${placement.top}px;left:${placement.left}px;width:${placement.width}px;max-height:${placement.maxHeight}px`
			: 'top:0;left:0;visibility:hidden'}
		onpointerdown={(e) => e.preventDefault()}
	>
		{#each options as option, i (option.value)}
			<!-- キー操作はトリガー側で受ける(フォーカスはトリガーに残す) -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				id={optionId(i)}
				class="option"
				class:active={i === activeIndex}
				class:selected={i === selectedIndex}
				class:disabled={option.disabled}
				role="option"
				tabindex="-1"
				aria-selected={i === selectedIndex}
				aria-disabled={option.disabled || undefined}
				onclick={() => {
					if (option.disabled) return;
					commit(i);
					closeList(true);
				}}
				onpointermove={() => {
					if (!option.disabled && activeIndex !== i) activeIndex = i;
				}}
			>
				<span class="texts">
					<span class="option-label" title={option.label}>{option.label}</span>
					{#if option.description}
						<span class="option-desc" title={option.description}>{option.description}</span>
					{/if}
				</span>
				<span class="select-check" aria-hidden="true">
					{#if i === selectedIndex}<Icon name="check" />{/if}
				</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.select {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		box-sizing: border-box;
		min-width: 0;
		max-width: 100%;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 0.15s,
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.select[data-size='md'] {
		width: 100%;
		height: 36px;
	}

	/* 文中・ツールバー向け: 枠なしの小さい表示 */
	.select[data-size='sm'] {
		height: 26px;
		padding: 0 4px 0 8px;
		gap: 4px;
		border-color: transparent;
		border-radius: 7px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 11.5px;
	}

	.select:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
	}

	.select[data-size='sm']:hover:not(:disabled),
	.select[data-size='sm'].open {
		border-color: transparent;
		background: var(--hover);
		color: var(--color-text);
	}

	.select:focus-visible,
	.select.open {
		outline: none;
		border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-border));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
	}

	.select[data-size='sm']:focus-visible,
	.select[data-size='sm'].open {
		border-color: transparent;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 35%, transparent);
	}

	.select:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.leading {
		display: inline-flex;
		flex: none;
	}

	.select-label {
		flex: none;
		color: var(--color-text-secondary);
	}

	.current {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.current.placeholder {
		color: var(--color-text-secondary);
	}

	.chevron {
		display: inline-flex;
		flex: none;
		width: 14px;
		height: 14px;
		color: var(--color-text-secondary);
		transition: transform 0.15s;
	}

	.select.open .chevron {
		transform: rotate(180deg);
	}

	.chevron :global(div),
	.chevron :global(svg) {
		display: flex;
		width: 100%;
		height: 100%;
	}

	.select[data-size='sm'] .chevron {
		width: 12px;
		height: 12px;
	}

	@media (pointer: coarse) {
		.select[data-size='md'] {
			min-height: 44px;
		}
	}

	/* ポップアップは body 直下に移されるので、このコンポーネントのスタイルは :global を介さず scoped のまま当たる */
	.select-popup {
		position: fixed;
		z-index: 1300;
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: var(--shadow-float);
		font-size: 13px;
		outline: none;
		animation: select-pop-down 0.12s ease-out;
		transform-origin: top center;
		-webkit-user-select: none;
		user-select: none;
	}

	.select-popup[data-side='up'] {
		animation-name: select-pop-up;
		transform-origin: bottom center;
	}

	.select-popup.wide {
		font-size: 13px;
	}

	.option {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		padding: 6px 8px 6px 10px;
		border-radius: 7px;
		cursor: pointer;
	}

	.option.active {
		background: var(--hover);
	}

	.option.selected {
		color: var(--color-primary);
	}

	.option.disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.texts {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.option-label,
	.option-desc {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.option-desc {
		font-size: 11.5px;
		color: var(--color-text-secondary);
		/* 長い説明は 2 行まで */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		white-space: normal;
	}

	.select-check {
		display: inline-flex;
		flex: none;
		width: 16px;
		height: 16px;
		color: var(--color-primary);
	}

	.select-check :global(div),
	.select-check :global(svg) {
		display: flex;
		width: 100%;
		height: 100%;
	}

	@media (pointer: coarse), (max-width: 768px) {
		.option {
			min-height: 44px;
		}
	}

	@keyframes select-pop-down {
		from {
			opacity: 0;
			transform: translateY(-4px) scale(0.98);
		}
	}

	@keyframes select-pop-up {
		from {
			opacity: 0;
			transform: translateY(4px) scale(0.98);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.select-popup {
			animation: none;
		}

		.select,
		.chevron {
			transition: none;
		}
	}
</style>
