<script lang="ts">
	/**
	 * 記号パレット。押した記号を onpick で返す(挿入は呼び出し側)。
	 * 最近使った記号は、この端末にだけ覚える(最大 10 個)。
	 * ボタンはエディタの選択範囲を奪わないよう、pointerdown の既定動作を止める。
	 */
	import { SYMBOL_GROUPS, type SymbolItem } from '$lib/utils/symbols';

	interface Props {
		onpick: (item: SymbolItem) => void;
	}

	let { onpick }: Props = $props();

	const RECENT_KEY = 'storift:recent-symbols';
	const RECENT_MAX = 10;
	const byText = new Map(SYMBOL_GROUPS.flatMap((g) => g.items).map((i) => [i.text, i]));

	function loadRecent(): SymbolItem[] {
		try {
			const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
			if (!Array.isArray(raw)) return [];
			return raw
				.map((t) => (typeof t === 'string' ? byText.get(t) : undefined))
				.filter((i): i is SymbolItem => !!i)
				.slice(0, RECENT_MAX);
		} catch {
			return [];
		}
	}

	let recent = $state<SymbolItem[]>(loadRecent());

	function pick(item: SymbolItem) {
		recent = [item, ...recent.filter((i) => i.text !== item.text)].slice(0, RECENT_MAX);
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(recent.map((i) => i.text)));
		} catch {
			// 覚えられなくても挿入はできる
		}
		onpick(item);
	}

	const label = (item: SymbolItem) => (item.close ? `${item.text}${item.close}` : item.text);
</script>

{#snippet grid(items: SymbolItem[])}
	<div class="grid">
		{#each items as item (item.text)}
			<button
				type="button"
				class="sym"
				class:pair={!!item.close}
				title={item.name}
				aria-label={item.name}
				data-symbol={item.text}
				onpointerdown={(e) => e.preventDefault()}
				onclick={() => pick(item)}>{label(item)}</button
			>
		{/each}
	</div>
{/snippet}

<div class="palette" data-testid="symbol-palette">
	{#if recent.length > 0}
		<section>
			<h3>最近使った記号</h3>
			{@render grid(recent)}
		</section>
	{/if}
	{#each SYMBOL_GROUPS as group (group.id)}
		<section>
			<h3>{group.label}</h3>
			{@render grid(group.items)}
		</section>
	{/each}
	<p class="hint">括弧は、選んでいる文字を囲みます。</p>
</div>

<style>
	.palette {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	h3 {
		margin: 0 0 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-secondary);
		letter-spacing: 0.04em;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
		gap: 4px;
	}

	.sym {
		height: 34px;
		padding: 0 2px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
		white-space: nowrap;
	}

	.sym.pair {
		font-size: 14px;
	}

	.sym:hover {
		border-color: var(--color-primary);
	}

	.sym:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.sym:active {
		background: color-mix(in srgb, var(--color-primary) 18%, var(--color-surface));
	}

	.hint {
		margin: 0;
		font-size: 11px;
		color: var(--color-text-secondary);
	}
</style>
