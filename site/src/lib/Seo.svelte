<script lang="ts">
	import { page } from '$app/state';
	import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '$lib/config';

	let { title = '', description = SITE_DESCRIPTION }: { title?: string; description?: string } =
		$props();

	const fullTitle = $derived(title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} - 小説執筆アプリ`);
	const url = $derived(SITE_URL + (page.url.pathname === '/' ? '' : page.url.pathname));
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content={`${SITE_URL}/og.png`} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>
