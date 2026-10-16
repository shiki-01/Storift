<script lang="ts">
	import { applyInsertion, moveCaret, undo, redo, type InsertKind } from '$lib/utils/editorInput';

	interface Props {
		hasPrev?: boolean;
		hasNext?: boolean;
		onPrev?: () => void;
		onNext?: () => void;
		onDismiss?: () => void;
	}

	let { hasPrev = false, hasNext = false, onPrev, onNext, onDismiss }: Props = $props();

	const inserts: { kind: InsertKind; label: string; aria: string; wide?: boolean }[] = [
		{ kind: 'kagi', label: '「」', aria: 'かぎ括弧' },
		{ kind: 'nijukagi', label: '『』', aria: '二重かぎ括弧' },
		{ kind: 'paren', label: '（）', aria: '丸括弧' },
		{ kind: 'ellipsis', label: '……', aria: '三点リーダー' },
		{ kind: 'dash', label: '――', aria: 'ダッシュ' },
		{ kind: 'ruby', label: 'ルビ', aria: 'ルビを挿入', wide: true },
		{ kind: 'bouten', label: '傍点', aria: '傍点を挿入', wide: true },
		{ kind: 'indent', label: '字下げ', aria: '全角スペースを挿入', wide: true }
	];

	// ボタン操作でエディタのフォーカス(=キーボード)と選択範囲を失わないようにする
	function keepFocus(e: Event) {
		e.preventDefault();
	}
</script>

<div class="assist" role="toolbar" aria-label="入力補助">
	<div class="assist-scroll">
		{#each inserts as item (item.kind)}
			<button
				class="key"
				class:wide={item.wide}
				aria-label={item.aria}
				onpointerdown={keepFocus}
				onclick={() => applyInsertion(item.kind)}
			>
				{item.label}
			</button>
		{/each}
		<span class="divider"></span>
		<button class="key" aria-label="元に戻す" onpointerdown={keepFocus} onclick={undo}>↶</button>
		<button class="key" aria-label="やり直す" onpointerdown={keepFocus} onclick={redo}>↷</button>
		<button
			class="key"
			aria-label="カーソルを左へ"
			onpointerdown={keepFocus}
			onclick={() => moveCaret(-1)}>◀</button
		>
		<button
			class="key"
			aria-label="カーソルを右へ"
			onpointerdown={keepFocus}
			onclick={() => moveCaret(1)}>▶</button
		>
		<span class="divider"></span>
		<button
			class="key wide"
			aria-label="前のシーン"
			disabled={!hasPrev}
			onpointerdown={keepFocus}
			onclick={() => onPrev?.()}>前へ</button
		>
		<button
			class="key wide"
			aria-label="次のシーン"
			disabled={!hasNext}
			onpointerdown={keepFocus}
			onclick={() => onNext?.()}>次へ</button
		>
	</div>
	<button
		class="dismiss"
		aria-label="キーボードを閉じる"
		onpointerdown={keepFocus}
		onclick={() => onDismiss?.()}
	>
		<svg
			viewBox="0 0 24 24"
			width="20"
			height="20"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
		>
	</button>
</div>

<style>
	.assist {
		flex: none;
		display: flex;
		align-items: center;
		height: 44px;
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		padding-left: var(--safe-left);
		padding-right: var(--safe-right);
	}

	.assist-scroll {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 8px;
		overflow-x: auto;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}

	.assist-scroll::-webkit-scrollbar {
		display: none;
	}

	.key {
		flex: none;
		min-width: 40px;
		height: 34px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 15px;
		cursor: pointer;
	}

	.key.wide {
		min-width: 52px;
		font-size: 13px;
	}

	.key:active {
		background: color-mix(in srgb, var(--color-primary) 18%, var(--color-background));
	}

	.key:disabled {
		opacity: 0.35;
	}

	.divider {
		flex: none;
		width: 1px;
		height: 20px;
		background: var(--color-border);
		margin: 0 2px;
	}

	.dismiss {
		flex: none;
		width: 44px;
		height: 44px;
		border: none;
		border-left: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
</style>
