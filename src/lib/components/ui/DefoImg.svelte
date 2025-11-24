<script lang="ts">
	import { logo } from '$lib/assets/logo';
	import { themes, themeStore } from '$lib/stores/theme.svelte';
</script>

<div class="w:200px h:284px bg:theme-surface b:2px|solid|theme-border r:8px flex ai:center jc:center">
	{@html logo(themes[themeStore.theme.id].colors.text)}
</div>
