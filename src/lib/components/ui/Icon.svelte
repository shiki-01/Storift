<script lang="ts">
	import { getIcon } from '../editor/icons';

	let { name, class: className }: { name: string; class?: string } = $props();
	// name が変わったら追従する(onMount で一度だけ読むと、詳細ペインの再利用で古いアイコンが残る)
	const icon = $derived(getIcon(name) || '');
</script>

<div class={className}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- getIcon が返す固定の SVG -->
	{@html icon}
</div>
