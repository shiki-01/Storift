<script lang="ts">
	// 拡張の出所のラベル。コミュニティ・個人追加の拡張が、公式のものと誤認されないよう、必ず出す
	import { ORIGIN_LABELS, type ExtensionOrigin } from '$lib/extensions/manifest';

	let { origin }: { origin: ExtensionOrigin } = $props();
</script>

<span class="origin" data-origin={origin} data-testid="origin-badge">{ORIGIN_LABELS[origin]}</span>

<style>
	.origin {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 11px;
		line-height: 1;
		font-weight: 600;
		white-space: nowrap;
		color: var(--color-text-secondary);
		background: color-mix(in srgb, var(--color-surface) 50%, var(--color-background));
	}

	.origin[data-origin='community'] {
		border-color: color-mix(in srgb, var(--color-info) 45%, var(--color-border));
		color: var(--color-info);
		background: color-mix(in srgb, var(--color-info) 9%, var(--color-background));
	}

	.origin[data-origin='personal-file'],
	.origin[data-origin='personal-folder'] {
		border-color: color-mix(in srgb, var(--color-warning) 55%, var(--color-border));
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-warning) 12%, var(--color-background));
	}

	:global(:root[data-scheme='dark']) .origin[data-origin='community'] {
		color: color-mix(in srgb, var(--color-info) 70%, var(--color-text));
	}
</style>
