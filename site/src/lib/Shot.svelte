<script lang="ts">
	let {
		name,
		alt,
		eager = false
	}: {
		/** static/shots/ の画像名(-light / -dark を除く)。site/scripts/capture-shots.mjs で撮る */
		name: string;
		alt: string;
		eager?: boolean;
	} = $props();
</script>

<!-- アプリの実画面。配色の明暗に合う方だけが表示され、読み込まれる -->
<div class="shot">
	<img
		class="shade-light"
		src="/shots/{name}-light.webp"
		{alt}
		width="1920"
		height="1200"
		loading={eager ? 'eager' : 'lazy'}
		decoding="async"
	/>
	<img
		class="shade-dark"
		src="/shots/{name}-dark.webp"
		{alt}
		width="1920"
		height="1200"
		loading="lazy"
		decoding="async"
	/>
</div>

<style>
	.shot {
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-surface);
		box-shadow: var(--shadow-float);
		overflow: hidden;
	}

	img {
		width: 100%;
		height: auto;
	}
</style>
