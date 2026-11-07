<script lang="ts">
	import { flip } from 'svelte/animate';
	import Icon from '$lib/Icon.svelte';
	import { COLUMNS, PLOTS, type PlotStatus } from './data';

	let {
		plots,
		drag
	}: {
		plots: Record<string, PlotStatus>;
		/** つかんで動かしているカード(動かした量) */
		drag: { id: string; x: number; y: number } | null;
	} = $props();
</script>

<div class="page">
	<header>
		<h3>プロット<small>{PLOTS.length} 件</small></h3>
		<span class="seg">
			<i class="on"><Icon name="columns" size={13} />ボード</i>
			<i><Icon name="timeline" size={13} />タイムライン</i>
		</span>
		<span class="new"><Icon name="plus" size={13} />新規プロット</span>
	</header>

	<div class="toolbar">
		<span class="field search">タイトル・内容で検索</span>
		<span class="field">すべての種類<Icon name="chevron" size={13} /></span>
		<span class="field">手動順<Icon name="chevron" size={13} /></span>
	</div>

	<div class="board">
		{#each COLUMNS as col (col.status)}
			{@const items = PLOTS.filter((p) => plots[p.id] === col.status)}
			<section data-t="col-{col.status}">
				<p class="col-head">
					<b>{col.label}</b><span class="count">{items.length}</span>
					<Icon name="plus" size={14} />
				</p>
				<div class="col">
					{#each items as p (p.id)}
						<article
							animate:flip={{ duration: 280 }}
							class:lifted={drag?.id === p.id}
							style:--accent={p.color}
							style:transform={drag?.id === p.id
								? `translate(${drag.x}px, ${drag.y}px) rotate(1.5deg)`
								: undefined}
						>
							<p class="top">
								<span class="grip" data-t="grip-{p.id}"><Icon name="grip" size={14} /></span>
								<span class="tag">{p.type}</span>
								<span class="dots"><Icon name="dots" size={14} /></span>
							</p>
							<p class="title">{p.title}</p>
							<p class="body">{p.body}</p>
							<p class="foot">更新 2026/06/14</p>
						</article>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	header {
		flex: none;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 18px 8px;
	}

	h3 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-right: auto;
		font-size: 18px;
		line-height: 1.3;
	}

	h3 small {
		font-size: 11px;
		font-weight: 400;
		color: var(--color-text-secondary);
	}

	.seg {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
		font-size: 11px;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.seg i {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 9px;
		border-radius: 7px;
		font-style: normal;
	}

	.seg i.on {
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
	}

	.new {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 6px 12px;
		border-radius: 8px;
		background: var(--color-primary);
		color: var(--color-background);
		font-size: 11.5px;
		white-space: nowrap;
	}

	.toolbar {
		flex: none;
		display: flex;
		gap: 8px;
		padding: 0 18px 10px;
		border-bottom: 1px solid var(--color-border);
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.field {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 5px 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		white-space: nowrap;
	}

	.field.search {
		width: 190px;
	}

	.board {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
		padding: 12px 18px 14px;
	}

	section {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.col-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 4px 7px;
		color: var(--color-text-secondary);
	}

	.col-head b {
		color: var(--color-text);
		font-size: 12.5px;
	}

	.col-head :global(svg) {
		margin-left: auto;
	}

	.count {
		min-width: 18px;
		border-radius: 999px;
		background: var(--color-surface);
		font-size: 10px;
		text-align: center;
	}

	.col {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-surface);
	}

	article {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 7px 10px 7px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--editor-background);
	}

	/* 左端の色の帯(アプリのプロットのカードと同じ) */
	article::before {
		content: '';
		position: absolute;
		top: 7px;
		bottom: 7px;
		left: 0;
		width: 3px;
		border-radius: 0 3px 3px 0;
		background: var(--accent);
	}

	article.lifted {
		z-index: 3;
		border-color: var(--color-primary);
		box-shadow: var(--shadow-float);
		transition: box-shadow 0.15s;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-left: -4px;
		color: var(--color-text-secondary);
	}

	.grip {
		display: inline-flex;
	}

	.dots {
		display: inline-flex;
		margin-left: auto;
	}

	.tag {
		padding: 0 7px;
		border-radius: 6px;
		background: var(--color-surface);
		font-size: 10px;
		line-height: 1.7;
	}

	.title {
		font-weight: 600;
		line-height: 1.4;
	}

	.body {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: 11px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.foot {
		font-size: 10px;
		color: var(--color-text-secondary);
	}

	@media (max-width: 760px) {
		header {
			padding: 10px 12px 6px;
		}

		.seg,
		.new,
		.toolbar,
		.foot,
		.body,
		.top .dots {
			display: none;
		}

		.board {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			grid-template-rows: repeat(2, minmax(0, 1fr));
			gap: 6px 8px;
			padding: 8px 12px 12px;
		}

		.col {
			gap: 5px;
			padding: 5px;
		}

		.title {
			font-size: 11px;
		}

		article {
			padding: 5px 7px 5px 9px;
		}
	}
</style>
