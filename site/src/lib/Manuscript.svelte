<script lang="ts">
	import { parseLine } from '$lib/notation';

	let { text, vertical = false }: { text: string; vertical?: boolean } = $props();
	let lines = $derived(text.split('\n'));
</script>

<!-- 記法を解釈した本文。{@html} を使わず組み立てるので、入力をそのまま渡してよい -->
<div class="manuscript" class:vertical>
	{#each lines as line, i (i)}
		<p>
			{#each parseLine(line) as seg, j (j)}
				{#if seg.kind === 'ruby'}
					<ruby>{seg.text}<rt>{seg.ruby}</rt></ruby>
				{:else if seg.kind === 'dots'}
					<span class="dots">{seg.text}</span>
				{:else}
					{seg.text}
				{/if}
			{/each}
			{#if !line}<br />{/if}
		</p>
	{/each}
</div>

<style>
	.manuscript {
		font-family: var(--font-serif);
		line-height: 2;
		letter-spacing: 0.04em;
		overflow-wrap: anywhere;
	}

	.vertical {
		writing-mode: vertical-rl;
		height: 100%;
		letter-spacing: 0.08em;
	}

	rt {
		font-size: 0.5em;
		letter-spacing: 0.08em;
	}

	.dots {
		text-emphasis: filled sesame;
		-webkit-text-emphasis: filled sesame;
	}
</style>
