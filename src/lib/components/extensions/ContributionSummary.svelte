<script lang="ts">
	// パックが足すものの一覧(例: 配色テーマ 2 個)。コンテンツがあれば件数を、無ければ種類だけを出す
	import {
		CONTRIBUTION_LABELS,
		contributionKinds,
		countContent,
		type ContributionKind,
		type PackContent,
		type PackContributions
	} from '$lib/extensions/pack';

	interface Props {
		contributions?: PackContributions;
		/** 検証済みのコンテンツ(あれば件数を出す) */
		content?: PackContent;
		/** 一覧のように、種類だけを渡すとき */
		kinds?: ContributionKind[];
	}

	let { contributions, content, kinds }: Props = $props();

	const UNITS: Record<ContributionKind, string> = {
		themes: '個',
		proofreadRules: '件の規則',
		assistKeys: '個のキー',
		exportPresets: '個'
	};

	const list = $derived(kinds ?? contributionKinds(contributions));
	const counts = $derived(content ? countContent(content) : null);
</script>

{#if list.length > 0}
	<ul class="contrib" aria-label="この拡張が追加するもの">
		{#each list as kind (kind)}
			<li>
				{CONTRIBUTION_LABELS[kind]}{#if counts}<span class="count">
						{counts[kind]}{UNITS[kind]}</span
					>{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.contrib {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.contrib li {
		padding: 3px 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 12px;
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-surface) 45%, var(--color-background));
	}

	.count {
		margin-left: 4px;
		color: var(--color-text-secondary);
	}
</style>
