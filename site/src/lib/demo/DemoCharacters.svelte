<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import DemoRelation from './DemoRelation.svelte';
	import { CHARACTERS, type CharMode } from './data';

	let {
		mode,
		opened,
		mover,
		dragging,
		pressed
	}: {
		mode: CharMode;
		/** 一覧で人物を開いている(詳細に全文が出ている) */
		opened: boolean;
		mover: { x: number; y: number };
		dragging: boolean;
		pressed: string | null;
	} = $props();
</script>

<div class="page">
	<header>
		<h3>人物<small>{CHARACTERS.length} 人</small></h3>
		<span class="seg">
			<i class:on={mode === 'list'}><Icon name="list" size={13} />一覧</i>
			<i class:on={mode === 'graph'} class:press={pressed === 'seg-graph'} data-t="seg-graph">
				<Icon name="characters" size={13} />相関図
			</i>
		</span>
		<span class="new"><Icon name="plus" size={13} />新規人物</span>
	</header>

	{#if mode === 'graph'}
		<div class="graph"><DemoRelation {mover} {dragging} /></div>
	{:else}
		<div class="master">
			<div class="list">
				<p class="toolbar">
					<span class="field search">名前・役割・本文で検索</span>
					<span class="field">手動順<Icon name="chevron" size={13} /></span>
				</p>
				{#each CHARACTERS as c (c.id)}
					<p
						class="row"
						class:selected={opened && c.id === 'akari'}
						class:press={pressed === `row-${c.id}`}
						data-t="row-{c.id}"
					>
						<span class="avatar {c.tone}">{c.mark}</span>
						<span class="texts"><b>{c.name}</b><small>{c.sub}</small></span>
						<span class="ico"><Icon name="dots" size={14} /><Icon name="grip" size={14} /></span>
					</p>
				{/each}
			</div>

			<div class="detail">
				{#if opened}
					<div class="who">
						<span class="avatar big primary">朝</span>
						<div>
							<h4>朝倉 灯</h4>
							<p>主人公 ・ 17歳</p>
						</div>
					</div>
					<dl>
						<dt>外見</dt>
						<dd>肩で切りそろえた黒髪。雨の日はいつも祖母の傘を持ち歩く。</dd>
						<dt>性格</dt>
						<dd>人見知りだが、気になったことは調べずにいられない。</dd>
						<dt>背景</dt>
						<dd>祖母の遺品の整理を手伝ううちに、一枚の栞を見つける。</dd>
						<dt>関係</dt>
						<dd class="rels">
							<span><em>孫</em><i class="avatar xs primary">朝</i>朝倉 静</span>
							<span><em>古書店の常連</em><i class="avatar xs accent">真</i>真柴 蓮</span>
							<span><em>同級生</em><i class="avatar xs secondary">瀬</i>瀬尾 湊</span>
						</dd>
					</dl>
				{:else}
					<p class="blank">人物を選ぶと、ここに全文が出ます</p>
				{/if}
			</div>
		</div>
	{/if}
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
		padding: 12px 18px;
		border-bottom: 1px solid var(--color-border);
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
		transition: background-color 0.15s;
	}

	.seg i.on {
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
	}

	.seg i.press {
		background: var(--selected);
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

	.graph {
		flex: 1;
		min-height: 0;
	}

	.master {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px;
		border-right: 1px solid var(--color-border);
		overflow: hidden;
	}

	.toolbar {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.field {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 5px 9px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		white-space: nowrap;
	}

	.field.search {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		border-radius: 10px;
		transition: background-color 0.15s;
	}

	.row.selected,
	.row.press {
		background: var(--selected);
	}

	.texts {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		line-height: 1.4;
	}

	.texts b {
		overflow: hidden;
		font-size: 13px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.texts small {
		overflow: hidden;
		font-size: 11px;
		color: var(--color-text-secondary);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ico {
		display: inline-flex;
		gap: 4px;
		color: var(--color-text-secondary);
	}

	/* 円形のアバター。色は人物ごとに基調色を薄く敷く(アプリの IconBadge と同じ) */
	.avatar {
		--tone: var(--color-primary);
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: 1px solid color-mix(in srgb, var(--tone) 28%, var(--color-border));
		border-radius: 50%;
		background: color-mix(in srgb, var(--tone) 12%, var(--color-background));
		color: var(--tone);
		font-size: 14px;
		font-style: normal;
		font-weight: 600;
		line-height: 1;
	}

	.avatar.accent {
		--tone: var(--color-accent);
	}

	.avatar.secondary {
		--tone: color-mix(in srgb, var(--color-primary) 55%, var(--color-accent));
	}

	.avatar.big {
		width: 48px;
		height: 48px;
		font-size: 20px;
	}

	.avatar.xs {
		width: 18px;
		height: 18px;
		font-size: 9px;
	}

	.detail {
		min-width: 0;
		padding: 18px 22px;
		overflow: hidden;
	}

	.who {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-bottom: 14px;
	}

	h4 {
		margin: 0;
		font-weight: 600;
		font-size: 17px;
		line-height: 1.3;
	}

	.who p {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	dl {
		margin: 0;
	}

	dt {
		margin-top: 10px;
		font-size: 10.5px;
		color: var(--color-text-secondary);
	}

	dd {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.6;
	}

	.rels {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-top: 4px;
	}

	.rels span {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		color: var(--color-primary);
	}

	.rels em {
		padding: 0 8px;
		border-radius: 6px;
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 10.5px;
		font-style: normal;
		font-weight: 400;
	}

	.blank {
		padding-top: 40px;
		text-align: center;
		color: var(--color-text-secondary);
	}

	@media (max-width: 760px) {
		header {
			padding: 10px 12px;
		}

		.new {
			display: none;
		}

		.master {
			grid-template-columns: minmax(0, 1fr);
		}

		.detail {
			display: none;
		}

		.list {
			border-right: none;
		}
	}
</style>
