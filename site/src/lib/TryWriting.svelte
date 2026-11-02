<script lang="ts">
	import Manuscript from '$lib/Manuscript.svelte';
	import { plainText } from '$lib/notation';

	// 入力はこの頁の中だけで完結する。どこにも保存・送信しない
	let text = $state(
		[
			'　坂の上の古書店は、雨の日にだけ灯りをともす。',
			'　｜栞《しおり》の挟まった頁をひらくと、《《知らない町》》の名前が書かれていた。'
		].join('\n')
	);
	let mode = $state<'horizontal' | 'vertical' | 'paper'>('vertical');
	let area: HTMLTextAreaElement;

	const modes = [
		{ id: 'horizontal', label: '横書き' },
		{ id: 'vertical', label: '縦書き' },
		{ id: 'paper', label: '原稿用紙' }
	] as const;

	let count = $derived(plainText(text).replace(/\s/g, '').length);

	// 原稿用紙: 20 字 × 12 行に流し込む(改行で次の行へ)
	const PER_LINE = 20;
	const LINES = 12;
	let cells = $derived.by(() => {
		const rows = plainText(text)
			.split('\n')
			.flatMap((line) => {
				const chars = [...line];
				if (!chars.length) return [[]];
				const out: string[][] = [];
				for (let i = 0; i < chars.length; i += PER_LINE) out.push(chars.slice(i, i + PER_LINE));
				return out;
			});
		return Array.from({ length: LINES }, (_, r) =>
			Array.from({ length: PER_LINE }, (_, c) => rows[r]?.[c] ?? '')
		);
	});

	/** アプリと同じく、選んだ文字を記号で囲む。何も選んでいなければ見本を入れる */
	async function wrap(before: string, after: string, fallback: string) {
		const { selectionStart: a, selectionEnd: b } = area;
		const picked = text.slice(a, b) || fallback;
		text = text.slice(0, a) + before + picked + after + text.slice(b);
		const caret = a + before.length + picked.length + after.length;
		area.focus();
		// 値の反映を待ってからカーソルを戻す
		await Promise.resolve();
		requestAnimationFrame(() => area.setSelectionRange(caret, caret));
	}
</script>

<div class="try">
	<div class="input">
		<div class="tools">
			<button type="button" class="tool" onclick={() => wrap('｜', '《かんじ》', '漢字')}
				>ルビ</button
			>
			<button type="button" class="tool" onclick={() => wrap('《《', '》》', '強調')}>傍点</button>
			<span class="count">{count.toLocaleString()} 字</span>
		</div>
		<textarea
			bind:this={area}
			bind:value={text}
			aria-label="試し書きの本文"
			spellcheck="false"
			rows="9"
		></textarea>
		<p class="hint">自由に書き換えてみてください。入力した内容は保存も送信もされません。</p>
	</div>

	<div class="output">
		<div class="segmented" role="group" aria-label="表示の形式">
			{#each modes as m (m.id)}
				<button type="button" aria-pressed={mode === m.id} onclick={() => (mode = m.id)}>
					{m.label}
				</button>
			{/each}
		</div>
		<div class="sheet" class:is-vertical={mode === 'vertical'} class:is-paper={mode === 'paper'}>
			{#if mode === 'paper'}
				<div class="paper" aria-label="原稿用紙の表示" role="img">
					{#each cells as row, r (r)}
						<div class="paper-line">
							{#each row as ch, c (c)}<span>{ch}</span>{/each}
						</div>
					{/each}
				</div>
			{:else}
				<Manuscript {text} vertical={mode === 'vertical'} />
			{/if}
		</div>
	</div>
</div>

<style>
	.try {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		overflow: hidden;
	}

	.input {
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-right: 1px solid var(--color-border);
		background: var(--editor-background);
	}

	.tools,
	.output .segmented {
		flex: none;
	}

	.tools {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 53px;
		padding: 0 12px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-background);
	}

	.tool {
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.tool:hover {
		background: var(--hover);
	}

	.count {
		margin-left: auto;
		font-size: 12px;
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	textarea {
		flex: 1;
		width: 100%;
		min-height: 260px;
		padding: 20px 24px;
		border: none;
		outline: none;
		resize: none;
		background: transparent;
		color: var(--color-text);
		font-family: var(--font-serif);
		font-size: 15px;
		line-height: 2;
		letter-spacing: 0.04em;
	}

	.hint {
		padding: 10px 16px;
		border-top: 1px solid var(--color-border);
		background: var(--color-background);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.output {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.output .segmented {
		align-self: flex-start;
		margin: 8px 12px;
	}

	.sheet {
		flex: 1;
		min-height: 300px;
		height: 340px;
		padding: 20px 24px;
		border-top: 1px solid var(--color-border);
		background: var(--editor-background);
		font-size: 15px;
		overflow: auto;
	}

	.sheet.is-vertical {
		display: flex;
		justify-content: flex-end;
	}

	.sheet.is-paper {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 16px;
	}

	/* 横に行が流れる升目。右から左へ読むので、列を右端から置く */
	.paper {
		display: flex;
		flex-direction: row-reverse;
		border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
	}

	.paper-line {
		display: flex;
		flex-direction: column;
	}

	.paper-line + .paper-line {
		margin-right: 3px;
		border-right: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
	}

	.paper-line span {
		width: 20px;
		height: 15px;
		border-bottom: 1px solid color-mix(in srgb, var(--color-accent) 22%, transparent);
		font-family: var(--font-serif);
		font-size: 11px;
		line-height: 15px;
		text-align: center;
	}

	.paper-line span:last-child {
		border-bottom: none;
	}

	@media (max-width: 860px) {
		.try {
			grid-template-columns: minmax(0, 1fr);
		}

		.input {
			border-right: none;
			border-bottom: 1px solid var(--color-border);
		}

		textarea {
			min-height: 200px;
		}
	}
</style>
