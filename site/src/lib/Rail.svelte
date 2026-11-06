<script lang="ts">
	import { page } from '$app/state';
	import { APP_URL, RELEASES_URL } from '$lib/config';
	import Logo from '$lib/Logo.svelte';
	import Icon from '$lib/Icon.svelte';
	import type { IconName } from '$lib/icons';

	// アプリの左レール(src/lib/components/layout/AppRail.svelte)と同じ形。スマホでは下部ナビになる
	const items: { href: string; label: string; icon: IconName }[] = [
		{ href: '/', label: 'ホーム', icon: 'home' },
		{ href: '/features', label: '機能', icon: 'grid' },
		{ href: '/guide', label: '使い方', icon: 'book' },
		{ href: '/faq', label: 'Q&A', icon: 'help' }
	];

	function isActive(href: string, pathname: string) {
		return href === '/' ? pathname === '/' : pathname.startsWith(href);
	}

	// 選択中の項目を指す三角は 1 つだけ置き、項目間を滑らせて移動させる
	let groupEl = $state<HTMLElement>();
	let notchTop = $state<number | null>(null);

	$effect(() => {
		void page.url.pathname;
		const el = groupEl?.querySelector<HTMLElement>('.rail-item[aria-current="page"]');
		notchTop = el ? el.offsetTop + el.offsetHeight / 2 : null;
	});
</script>

<nav class="rail" aria-label="メイン">
	<a class="rail-mark" href="/" aria-label="Storift ホーム">
		<Logo variant="mark" size={26} title="" />
	</a>

	<div class="rail-group" bind:this={groupEl}>
		{#if notchTop !== null}
			<span class="rail-notch" style:transform="translateY({notchTop}px)" aria-hidden="true"></span>
		{/if}
		{#each items as item (item.href)}
			<a
				class="rail-item"
				href={item.href}
				aria-current={isActive(item.href, page.url.pathname) ? 'page' : undefined}
			>
				<Icon name={item.icon} size={22} />
				<span class="rail-label">{item.label}</span>
			</a>
		{/each}
	</div>

	<div class="rail-group rail-bottom">
		<a class="rail-item rail-desktop" href={RELEASES_URL}>
			<Icon name="desktop" size={22} />
			<span class="rail-label">入手</span>
		</a>
		<a class="rail-item rail-open" href={APP_URL}>
			<Icon name="write" size={22} />
			<span class="rail-label">エディタ</span>
		</a>
	</div>
</nav>

<style>
	.rail {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		width: var(--rail-width);
		padding: 12px 0;
		border-right: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.rail-mark {
		display: flex;
		justify-content: center;
		margin: 0 6px 18px;
		padding: 8px 0;
		border-radius: 10px;
		color: inherit;
		transition: background-color 0.15s;
	}

	.rail-mark:hover {
		background: var(--hover);
	}

	.rail-group {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.rail-bottom {
		margin-top: auto;
	}

	.rail-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		margin: 0 6px;
		padding: 8px 0 7px;
		border-radius: 10px;
		color: var(--color-text-secondary);
		text-decoration: none;
		transition:
			color 0.15s,
			background-color 0.15s;
	}

	.rail-item:hover {
		color: var(--color-text);
		background: var(--hover);
	}

	.rail-item[aria-current='page'] {
		color: var(--color-text);
	}

	.rail-item[aria-current='page'] :global(svg),
	.rail-open {
		color: var(--color-primary);
	}

	.rail-label {
		font-size: 10.5px;
		line-height: 1.2;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	/* 選択中の項目を指す小さな三角(境界線の上に乗せる) */
	.rail-notch {
		position: absolute;
		top: -8px;
		right: 0;
		border-style: solid;
		border-width: 8px 8px 8px 0;
		border-color: transparent var(--color-border) transparent transparent;
		transition: transform 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
		pointer-events: none;
	}

	@media (max-width: 760px) {
		.rail {
			inset: auto 0 0 0;
			flex-direction: row;
			width: auto;
			padding: 0 0 env(safe-area-inset-bottom, 0px);
			border-right: none;
			border-top: 1px solid var(--color-border);
		}

		.rail-mark,
		.rail-notch,
		.rail-desktop {
			display: none;
		}

		.rail-group {
			flex-direction: row;
			flex: 4;
			gap: 0;
		}

		.rail-bottom {
			flex: 1;
			margin-top: 0;
		}

		.rail-item {
			flex: 1;
			justify-content: center;
			height: var(--bottom-nav-height);
			margin: 0;
			padding: 0;
			border-radius: 0;
		}
	}
</style>
