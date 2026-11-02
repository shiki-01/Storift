<script lang="ts">
	import { THEMES, siteTheme } from '$lib/theme.svelte';
</script>

<!-- 選ぶとサイト全体の配色が変わる。アプリの設定画面の配色と同じ四つ -->
<div class="themes" role="group" aria-label="配色">
	{#each THEMES as t (t.id)}
		<button
			type="button"
			class="theme"
			aria-pressed={siteTheme.current === t.id}
			onclick={() => siteTheme.set(t.id)}
		>
			<span class="sample" style:background={t.bg} aria-hidden="true">
				<span class="page" style:background={t.paper} style:color={t.ink}>
					<span class="line" style:background={t.ink}></span>
					<span class="line short" style:background={t.ink}></span>
					<span class="line" style:background={t.ink}></span>
					<span class="spine" style:background={t.accent}></span>
				</span>
			</span>
			<span class="name">{t.name}</span>
		</button>
	{/each}
</div>

<style>
	.themes {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}

	.theme {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 8px 10px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 13.5px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			transform 0.15s;
	}

	.theme:hover {
		transform: translateY(-2px);
	}

	.theme[aria-pressed='true'] {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 1px var(--color-primary);
	}

	.sample {
		display: flex;
		justify-content: center;
		padding: 12px 12px 0;
		border-radius: 7px;
		overflow: hidden;
	}

	.page {
		position: relative;
		display: flex;
		flex-direction: row-reverse;
		justify-content: flex-start;
		gap: 6px;
		width: 72%;
		height: 72px;
		padding: 10px 10px 0 14px;
		border-radius: 3px 3px 0 0;
		box-shadow: 0 1px 6px rgb(0 0 0 / 0.14);
	}

	.line {
		width: 2px;
		height: 44px;
		border-radius: 2px;
		opacity: 0.6;
	}

	.line.short {
		height: 28px;
	}

	.spine {
		position: absolute;
		inset: 0 auto 0 0;
		width: 4px;
	}

	.name {
		text-align: center;
		line-height: 1.4;
	}

	@media (max-width: 560px) {
		.themes {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
