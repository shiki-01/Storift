<script lang="ts">
	import { page } from '$app/state';
	import { APP_URL, NAV, SITE_NAME } from '$lib/config';
</script>

<header>
	<div class="wrap bar">
		<a class="brand" href="/">
			<img src="/favicon.svg" alt="" width="28" height="28" />
			<span>{SITE_NAME}</span>
		</a>
		<nav aria-label="メイン">
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}
					>{item.label}</a
				>
			{/each}
		</nav>
		<a class="btn small" href={APP_URL}>エディタを開く</a>
	</div>
</header>

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 10;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--border);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 20px;
		height: 60px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--serif);
		font-weight: 700;
		font-size: 1.15rem;
		color: var(--fg);
		text-decoration: none;
		margin-right: auto;
	}
	.brand img {
		border-radius: 6px;
	}
	nav {
		display: flex;
		gap: 4px;
	}
	nav a {
		padding: 6px 12px;
		border-radius: 8px;
		color: var(--muted);
		text-decoration: none;
		font-size: 0.95rem;
	}
	nav a:hover,
	nav a[aria-current='page'] {
		color: var(--fg);
		background: var(--accent-soft);
	}
	@media (max-width: 560px) {
		.bar {
			gap: 8px;
		}
		nav a {
			padding: 6px 8px;
			font-size: 0.85rem;
		}
		.brand span {
			display: none;
		}
	}
</style>
