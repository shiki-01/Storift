<script lang="ts">
	import { logo } from '$lib/assets/logo';
	import { themes, themeStore } from '$lib/stores/theme.svelte';
</script>

<div
	class="w:100% bg:theme-surface b:1px|solid|theme-border r:8px flex ai:center jc:center"
	style="aspect-ratio: 200 / 284;"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- 固定のロゴ SVG -->
	{@html logo(themes[themeStore.theme.id].colors.text)}
</div>
