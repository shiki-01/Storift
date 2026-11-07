<script lang="ts">
	/**
	 * 色の選択。ブラウザ標準の <input type="color"> の代わりに使う。
	 * - プリセットの色(スウォッチ)から選ぶ。allowCustom ならカスタム色(彩度・明度の面 + 色相 + #コード)も選べる。
	 * - 既定は並べて表示(インライン)。popover にすると、色を示す小さなボタンから開く(スペースが狭い場所向け)。
	 *   ポップアップは body に出し、position: fixed で開くので、親の overflow で切れない。
	 */
	import { tick } from 'svelte';
	import Icon from './Icon.svelte';
	import { computePlacement, type Placement } from './selectLogic';
	import {
		DEFAULT_PRESETS,
		hexToHsv,
		hsvToHex,
		normalizeHex,
		readableOn,
		type Hsv
	} from './colorLogic';

	interface Props {
		/** #rrggbb */
		value?: string;
		presets?: readonly string[];
		allowCustom?: boolean;
		/** 小さなボタンからポップアップで開く */
		popover?: boolean;
		id?: string;
		'aria-label'?: string;
		disabled?: boolean;
		class?: string;
		onchange?: (value: string) => void;
	}

	let {
		value = $bindable('#6b7280'),
		presets = DEFAULT_PRESETS,
		allowCustom = true,
		popover = false,
		id,
		'aria-label': ariaLabel,
		disabled = false,
		class: className = '',
		onchange
	}: Props = $props();

	const groupLabel = $derived(ariaLabel ?? '色');
	const current = $derived(normalizeHex(value) ?? '#000000');
	const inPresets = $derived(presets.some((p) => normalizeHex(p) === current));
	let customOpen = $state(false);
	let hsv = $state<Hsv>({ h: 0, s: 0, v: 0 });
	let hexDraft = $state('');
	let hexInvalid = $state(false);

	// 外から値が変わったら、カスタムの面と入力欄を合わせる(自分が出した値では動かさない)
	let lastEmitted = '';
	$effect(() => {
		const v = current;
		if (v === lastEmitted) return;
		hsv = hexToHsv(v);
		hexDraft = v;
		hexInvalid = false;
	});

	function set(hex: string, fromPanel = false) {
		const n = normalizeHex(hex);
		if (!n || n === current) return;
		lastEmitted = fromPanel ? n : '';
		value = n;
		if (!fromPanel) {
			hsv = hexToHsv(n);
		}
		hexDraft = n;
		hexInvalid = false;
		onchange?.(n);
	}

	function setHsv(next: Partial<Hsv>) {
		hsv = { ...hsv, ...next };
		set(hsvToHex(hsv), true);
	}

	// --- 彩度・明度の面 ---
	let areaEl = $state<HTMLDivElement>();
	let dragging = false;

	function fromPointer(e: PointerEvent) {
		if (!areaEl) return;
		const r = areaEl.getBoundingClientRect();
		const s = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
		const v = 1 - Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
		setHsv({ s, v });
	}

	function onAreaDown(e: PointerEvent) {
		if (disabled || e.button !== 0) return;
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		fromPointer(e);
	}

	function onAreaMove(e: PointerEvent) {
		if (dragging) fromPointer(e);
	}

	function onAreaUp(e: PointerEvent) {
		dragging = false;
		const el = e.currentTarget as HTMLElement;
		if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
	}

	function onAreaKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.1 : 0.02;
		if (e.key === 'ArrowLeft') setHsv({ s: Math.max(0, hsv.s - step) });
		else if (e.key === 'ArrowRight') setHsv({ s: Math.min(1, hsv.s + step) });
		else if (e.key === 'ArrowUp') setHsv({ v: Math.min(1, hsv.v + step) });
		else if (e.key === 'ArrowDown') setHsv({ v: Math.max(0, hsv.v - step) });
		else return;
		e.preventDefault();
	}

	function commitHex() {
		const n = normalizeHex(hexDraft);
		if (!n) {
			hexInvalid = true;
			return;
		}
		set(n);
	}

	// --- ポップアップ ---
	let triggerEl = $state<HTMLButtonElement>();
	let popupEl = $state<HTMLDivElement>();
	let open = $state(false);
	let placement = $state<Placement | null>(null);

	async function openPopup() {
		if (disabled || open) return;
		placement = null;
		open = true;
		await tick();
		place();
	}

	function closePopup(refocus = false) {
		if (!open) return;
		open = false;
		placement = null;
		if (refocus) triggerEl?.focus();
	}

	function place() {
		if (!open || !triggerEl || !popupEl) return;
		placement = computePlacement(
			triggerEl.getBoundingClientRect(),
			popupEl.scrollHeight,
			{ width: window.innerWidth, height: window.innerHeight },
			232
		);
	}

	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (triggerEl?.contains(target) || popupEl?.contains(target)) return;
			closePopup();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			// 外側のダイアログなどまで閉じない
			e.preventDefault();
			e.stopPropagation();
			closePopup(true);
		};
		const onViewportChange = (e: Event) => {
			if (e.target instanceof Node && popupEl?.contains(e.target)) return;
			place();
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('resize', onViewportChange);
		window.addEventListener('scroll', onViewportChange, true);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('resize', onViewportChange);
			window.removeEventListener('scroll', onViewportChange, true);
		};
	});

	$effect(() => {
		if (disabled) closePopup();
	});

	// カスタムの面を開閉すると高さが変わるので、置き直す
	$effect(() => {
		void customOpen;
		if (open) void tick().then(place);
	});

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}
</script>

{#snippet panel()}
	<div class="swatches" role="group" aria-label={groupLabel}>
		{#each presets as color (color)}
			{@const on = normalizeHex(color) === current}
			<button
				type="button"
				class="swatch"
				class:on
				style:--c={color}
				style:--on-c={readableOn(color)}
				aria-label={color}
				aria-pressed={on}
				{disabled}
				onclick={() => set(color)}
			>
				{#if on}<Icon name="check" class="swatch-check" />{/if}
			</button>
		{/each}
		{#if allowCustom}
			<button
				type="button"
				class="swatch custom"
				class:on={!inPresets}
				class:open={customOpen}
				style:--c={inPresets ? undefined : current}
				style:--on-c={readableOn(current)}
				aria-label="カスタム色"
				aria-expanded={customOpen}
				aria-pressed={!inPresets}
				{disabled}
				onclick={() => (customOpen = !customOpen)}
			>
				{#if !inPresets}<Icon name="check" class="swatch-check" />{:else}<Icon
						name="plus"
						class="swatch-plus"
					/>{/if}
			</button>
		{/if}
	</div>

	{#if allowCustom && customOpen}
		<div class="custom-panel">
			<div
				bind:this={areaEl}
				class="area"
				style:--hue={`hsl(${hsv.h} 100% 50%)`}
				role="slider"
				tabindex={disabled ? -1 : 0}
				aria-label="彩度と明度"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(hsv.s * 100)}
				aria-valuetext={`彩度 ${Math.round(hsv.s * 100)}%、明度 ${Math.round(hsv.v * 100)}%`}
				onpointerdown={onAreaDown}
				onpointermove={onAreaMove}
				onpointerup={onAreaUp}
				onpointercancel={onAreaUp}
				onkeydown={onAreaKey}
			>
				<span
					class="thumb"
					style:left={`${hsv.s * 100}%`}
					style:top={`${(1 - hsv.v) * 100}%`}
					style:background={current}
				></span>
			</div>
			<input
				class="hue"
				type="range"
				min="0"
				max="360"
				step="1"
				aria-label="色相"
				value={hsv.h}
				{disabled}
				oninput={(e) => setHsv({ h: Number(e.currentTarget.value) })}
			/>
			<div class="hex-row">
				<span class="preview" style:background={current} aria-hidden="true"></span>
				<input
					class="hex"
					type="text"
					aria-label="色コード"
					aria-invalid={hexInvalid ? 'true' : undefined}
					class:invalid={hexInvalid}
					maxlength="7"
					spellcheck="false"
					autocomplete="off"
					bind:value={hexDraft}
					{disabled}
					oninput={() => {
						hexInvalid = false;
						const n = normalizeHex(hexDraft);
						if (n && hexDraft.trim().length >= 6) set(n);
					}}
					onblur={commitHex}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							commitHex();
						}
					}}
				/>
			</div>
		</div>
	{/if}
{/snippet}

{#if popover}
	<button
		bind:this={triggerEl}
		{id}
		type="button"
		class="trigger {className}"
		class:open
		style:--c={current}
		aria-label={`${groupLabel}(${current})`}
		aria-haspopup="dialog"
		aria-expanded={open}
		{disabled}
		onclick={() => (open ? closePopup() : void openPopup())}
	></button>
	{#if open}
		<div
			bind:this={popupEl}
			use:portal
			class="color-popup"
			role="dialog"
			aria-label={groupLabel}
			style={placement
				? `top:${placement.top}px;left:${placement.left}px;width:${placement.width}px;max-height:${placement.maxHeight}px`
				: 'top:0;left:0;visibility:hidden'}
		>
			{@render panel()}
		</div>
	{/if}
{:else}
	<div class="inline {className}" {id}>
		{@render panel()}
	</div>
{/if}

<style>
	.inline {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.swatch {
		position: relative;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 2px solid var(--color-background);
		border-radius: 50%;
		background: var(--c, var(--color-surface));
		box-shadow: 0 0 0 1px var(--color-border);
		color: var(--on-c, var(--color-text));
		cursor: pointer;
		transition:
			transform 0.1s,
			box-shadow 0.15s;
	}

	.swatch:hover:not(:disabled) {
		transform: scale(1.08);
	}

	.swatch:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 1px var(--color-border),
			0 0 0 3px color-mix(in srgb, var(--color-primary) 55%, transparent);
	}

	.swatch.on {
		box-shadow: 0 0 0 2px var(--color-text);
	}

	.swatch:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	/* カスタムは、未選択のときは虹色の輪 */
	.swatch.custom:not(.on) {
		background: conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #ef4444);
		color: #fff;
	}

	.swatch :global(.swatch-check),
	.swatch :global(.swatch-plus) {
		display: inline-flex;
		width: 14px;
		height: 14px;
	}

	.swatch :global(.swatch-check svg),
	.swatch :global(.swatch-plus svg) {
		width: 100%;
		height: 100%;
		stroke-width: 3;
	}

	.custom-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		max-width: 232px;
	}

	.area {
		position: relative;
		width: 100%;
		height: 120px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background:
			linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, var(--hue));
		cursor: crosshair;
		touch-action: none;
	}

	.area:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 30%, transparent);
	}

	.thumb {
		position: absolute;
		width: 16px;
		height: 16px;
		border: 2px solid #fff;
		border-radius: 50%;
		box-shadow:
			0 0 0 1px rgb(0 0 0 / 0.4),
			0 1px 3px rgb(0 0 0 / 0.4);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	/* 色相のスライダー: 共通の range の見た目(app.css)のうち、トラックだけ虹色にする */
	.hue::-webkit-slider-runnable-track {
		background: linear-gradient(
			to right,
			#f00,
			#ff0 17%,
			#0f0 33%,
			#0ff 50%,
			#00f 67%,
			#f0f 83%,
			#f00
		);
	}

	.hue::-moz-range-track {
		background: linear-gradient(
			to right,
			#f00,
			#ff0 17%,
			#0f0 33%,
			#0ff 50%,
			#00f 67%,
			#f0f 83%,
			#f00
		);
	}

	.hex-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.preview {
		flex: none;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		box-shadow: 0 0 0 1px var(--color-border);
	}

	.hex {
		flex: 1;
		min-width: 0;
		height: 32px;
		box-sizing: border-box;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 13px;
	}

	.hex.invalid {
		border-color: var(--color-error);
	}

	.hex:focus-visible {
		outline: none;
		border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-border));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
	}

	/* --- popover --- */
	.trigger {
		box-sizing: border-box;
		flex: none;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 2px solid var(--color-background);
		border-radius: 8px;
		background: var(--c);
		box-shadow: 0 0 0 1px var(--color-border);
		cursor: pointer;
	}

	.trigger:hover:not(:disabled),
	.trigger.open {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 55%, var(--color-border));
	}

	.trigger:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 45%, transparent);
	}

	.trigger:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.color-popup {
		position: fixed;
		z-index: 1300;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
	}
</style>
