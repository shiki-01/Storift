<script lang="ts">
	import { page } from '$app/state';
	import { APP_URL, NAV } from '$lib/config';
	import Logo from '$lib/Logo.svelte';
</script>

<header>
	<div class="wrap bar">
		<a class="brand" href="/" aria-label="Storift ホーム">
			<Logo height={26} />
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
		<a class="btn primary sm" href={APP_URL}>エディタを開く</a>
	</div>
</header>

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 10;
		background: color-mix(in srgb, var(--color-background) 90%, transparent);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--color-border);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 24px;
		height: 60px;
	}

	.brand {
		display: inline-flex;
		color: var(--color-text);
		margin-right: auto;
	}

	nav {
		display: flex;
		gap: 2px;
	}

	nav a {
		position: relative;
		padding: 6px 12px;
		border-radius: 8px;
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 14px;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	nav a:hover {
		color: var(--color-text);
		background: var(--hover);
	}

	nav a[aria-current='page'] {
		color: var(--color-text);
		background: var(--selected);
	}

	@media (max-width: 560px) {
		.bar {
			gap: 6px;
		}

		nav a {
			padding: 6px 8px;
			font-size: 13px;
		}

		.brand :global(svg) {
			height: 22px;
			width: auto;
		}

		.bar > .btn {
			display: none;
		}
	}
</style>
