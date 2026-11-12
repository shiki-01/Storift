<script lang="ts">
	// 設定のグループ(カードの中の小見出し + 行のまとまり)。拡張固有の設定を、意味ごとに区切って見せる
	interface Props {
		title: string;
		description?: string;
		children?: import('svelte').Snippet;
	}

	let { title, description, children }: Props = $props();
</script>

<section class="group settings-group">
	<header>
		<h5>{title}</h5>
		{#if description}<p>{description}</p>{/if}
	</header>
	<div class="body">
		{#if children}{@render children()}{/if}
	</div>
</section>

<style>
	.group {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-top: 12px;
	}

	:global(.settings-group + .settings-group) {
		margin-top: 8px;
		border-top: 1px solid var(--color-border);
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	h5 {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	header p {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.body {
		display: flex;
		flex-direction: column;
	}

	/* グループの先頭の行は、区切り線を付けない */
	.body > :global(.settings-row:first-child) {
		border-top: none;
	}
</style>
