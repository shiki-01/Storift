<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { siteTheme } from '$lib/theme.svelte';
	import Rail from '$lib/Rail.svelte';
	import Footer from '$lib/Footer.svelte';

	let { children } = $props();

	onMount(() => siteTheme.init());
</script>

<Rail />
<div class="shell">
	<main>
		{@render children()}
	</main>
	<Footer />
</div>

<style>
	/* アプリと同じく、左のレールの右側を画面として使う */
	.shell {
		padding-left: var(--rail-width);
	}

	@media (max-width: 760px) {
		.shell {
			padding-left: 0;
			padding-bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
