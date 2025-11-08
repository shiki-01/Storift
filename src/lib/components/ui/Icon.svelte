<script lang="ts">
	import { onMount } from "svelte";
    import { getIcon } from "../editor/icons";

    let { name, class: className }: { name: string; class?: string } = $props();
    let icon = $state('');

    onMount(() => {
        icon = getIcon(name) || '';
    })
</script>

<div class={className}>
    {@html icon}
</div>
