<script lang="ts">
	// 拡張が貢献する設定(Extension.settings)を読み込んで表示する。有効なときだけ読み込む
	import type { Component } from 'svelte';
	import type { Extension } from '$lib/extensions/types';

	let { extension }: { extension: Extension } = $props();

	let Loaded = $state<Component | null>(null);
	let failed = $state(false);

	$effect(() => {
		const load = extension.settings;
		Loaded = null;
		failed = false;
		if (!load) return;
		let cancelled = false;
		load().then(
			(module) => {
				if (!cancelled) Loaded = module.default;
			},
			(error) => {
				console.error('拡張の設定を読み込めませんでした:', error);
				if (!cancelled) failed = true;
			}
		);
		return () => {
			cancelled = true;
		};
	});
</script>

{#if Loaded}
	<Loaded />
{:else if failed}
	<p class="failed" role="alert">この拡張の設定を読み込めませんでした。</p>
{/if}

<style>
	.failed {
		margin: 0;
		font-size: 13px;
		color: var(--color-error);
	}
</style>
