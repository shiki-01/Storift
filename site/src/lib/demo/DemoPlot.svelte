<script lang="ts">
	import { flip } from 'svelte/animate';
	import { COLUMNS, PLOTS, type PlotStatus } from './data';

	let { plots, pressed }: { plots: Record<string, PlotStatus>; pressed: string | null } = $props();
</script>

<div class="page">
	<header>
		<div>
			<h3>プロット管理</h3>
			<p>作品の構成を計画・管理します</p>
		</div>
		<span class="new">＋ 新規プロット</span>
	</header>

	<div class="board">
		{#each COLUMNS as col (col.status)}
			{@const items = PLOTS.filter((p) => plots[p.id] === col.status)}
			<section>
				<p class="col-head">{col.label}<span>{items.length}</span></p>
				<div class="col">
					{#each items as p (p.id)}
						<article animate:flip={{ duration: 280 }}>
							<p class="type"><i style:background={p.color}></i>{p.type}</p>
							<p class="title">{p.title}</p>
							<span class="advance" class:press={pressed === `next-${p.id}`} data-t="next-{p.id}">
								次へ →
							</span>
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
		justify-content: space-between;
		gap: 12px;
		padding: 14px 20px;
		border-bottom: 1px solid var(--color-border);
	}

	h3 {
		font-size: 17px;
		line-height: 1.3;
	}

	header p {
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.new {
		padding: 6px 12px;
		border-radius: 8px;
		background: var(--color-primary);
		color: var(--color-background);
		font-size: 11.5px;
		white-space: nowrap;
	}

	.board {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
		padding: 16px 20px;
	}

	section {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.col-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
		font-weight: 600;
	}

	.col-head span {
		min-width: 20px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 10px;
		font-weight: 400;
		text-align: center;
		color: var(--color-text-secondary);
	}

	.col {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
		overflow: hidden;
	}

	article {
		padding: 9px 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
	}

	.type {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		color: var(--color-text-secondary);
	}

	.type i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}

	.title {
		margin: 4px 0 8px;
		font-weight: 600;
		line-height: 1.45;
	}

	.advance {
		display: block;
		padding: 3px 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		font-size: 10.5px;
		text-align: center;
		transition: background-color 0.12s;
	}

	.advance.press {
		background: var(--selected);
	}

	@media (max-width: 760px) {
		.board {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			grid-template-rows: repeat(2, minmax(0, 1fr));
			gap: 8px;
			padding: 10px;
		}

		.col {
			padding: 5px;
			gap: 5px;
		}

		article {
			padding: 5px 7px;
		}

		.type {
			display: none;
		}

		.title {
			margin: 0 0 4px;
			font-size: 11px;
		}

		header {
			padding: 10px 12px;
		}

		.new {
			display: none;
		}
	}
</style>
