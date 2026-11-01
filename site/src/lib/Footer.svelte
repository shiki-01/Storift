<script lang="ts">
	import { APP_URL, NAV, RELEASES_URL } from '$lib/config';
	import Logo from '$lib/Logo.svelte';
</script>

<footer>
	<div class="wrap inner">
		<div class="about">
			<Logo height={22} />
			<p>小説を書くための、ひとつの場所。</p>
		</div>
		<nav aria-label="サイト">
			<p class="head">サイト</p>
			<a href="/">ホーム</a>
			{#each NAV as item (item.href)}
				<a href={item.href}>{item.label}</a>
			{/each}
		</nav>
		<nav aria-label="アプリ">
			<p class="head">アプリ</p>
			<a href={APP_URL}>エディタを開く(Web)</a>
			<a href={RELEASES_URL}>デスクトップ版</a>
		</nav>
		<nav aria-label="ガイドと規約">
			<p class="head">ガイドと規約</p>
			<a href="/guide/firebase">Firebase 設定ガイド</a>
			<a href="/privacy">プライバシーポリシー</a>
			<a href="/terms">利用規約</a>
		</nav>
		<p class="copy">© {new Date().getFullYear()} Storift</p>
	</div>
</footer>

<style>
	footer {
		margin-top: 96px;
		border-top: 1px solid var(--color-border);
		background: var(--color-surface);
		padding: 48px 0 40px;
		font-size: 13.5px;
		color: var(--color-text-secondary);
	}

	.inner {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		gap: 32px 48px;
	}

	.about {
		display: flex;
		flex-direction: column;
		gap: 12px;
		color: var(--color-text);
	}

	.about p {
		color: var(--color-text-secondary);
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.head {
		font-size: 12px;
		letter-spacing: 0.08em;
		margin-bottom: 4px;
	}

	nav a {
		color: var(--color-text);
		text-decoration: none;
	}

	nav a:hover {
		text-decoration: underline;
	}

	.copy {
		grid-column: 1 / -1;
		padding-top: 24px;
		border-top: 1px solid var(--color-border);
		font-size: 12.5px;
	}

	@media (max-width: 640px) {
		.inner {
			grid-template-columns: 1fr 1fr;
		}

		.about {
			grid-column: 1 / -1;
		}
	}
</style>
