<script lang="ts">
	import { APP_URL, NAV, SITE_NAME } from '$lib/config';
</script>

<footer>
	<div class="wrap inner">
		<p class="name">{SITE_NAME}</p>
		<nav aria-label="フッター">
			{#each NAV as item (item.href)}
				<a href={item.href}>{item.label}</a>
			{/each}
			<a href={APP_URL}>エディタを開く</a>
		</nav>
		<p class="copy">© {new Date().getFullYear()} Storift</p>
	</div>
</footer>

<style>
	footer {
		margin-top: 64px;
		border-top: 1px solid var(--border);
		padding: 32px 0 48px;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.inner {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 28px;
		align-items: center;
	}
	.name {
		font-family: var(--serif);
		font-weight: 700;
		color: var(--fg);
		margin-right: auto;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 20px;
	}
	nav a {
		color: var(--muted);
	}
	.copy {
		flex-basis: 100%;
	}
</style>
