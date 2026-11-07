<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import type { IconName } from '$lib/icons';
	import { WORLD, WORLD_CHIPS, type WorldCategory } from './data';

	let {
		chip,
		opened,
		pressed
	}: {
		/** 選んでいる分類のチップ */
		chip: 'all' | WorldCategory;
		/** 一覧で開いている資料の ID(なければ空) */
		opened: string;
		pressed: string | null;
	} = $props();

	const meta: Record<WorldCategory, { icon: IconName; label: string; tone: string }> = {
		term: { icon: 'term', label: '用語', tone: 'primary' },
		location: { icon: 'buildings', label: '場所', tone: 'secondary' },
		timeline: { icon: 'timeline', label: '年表', tone: 'success' },
		other: { icon: 'book', label: 'その他', tone: 'neutral' }
	};

	let counts = $derived(
		Object.fromEntries(
			WORLD_CHIPS.map((c) => [
				c.value,
				c.value === 'all' ? WORLD.length : WORLD.filter((w) => w.category === c.value).length
			])
		)
	);
	let visible = $derived(WORLD.filter((w) => chip === 'all' || w.category === chip));
	let current = $derived(WORLD.find((w) => w.id === opened));
</script>

<div class="page">
	<header>
		<h3>設定資料<small>{WORLD.length} 件</small></h3>
		<span class="new"><Icon name="plus" size={13} />新規資料</span>
	</header>

	<div class="master">
		<div class="list">
			<p class="chips">
				{#each WORLD_CHIPS as c (c.value)}
					<span
						class="chip"
						class:on={chip === c.value}
						class:press={pressed === `chip-${c.value}`}
						data-t="chip-{c.value}">{c.label}<small>{counts[c.value]}</small></span
					>
				{/each}
			</p>
			<p class="toolbar">
				<span class="field search">タイトル・タグ・内容で検索</span>
				<span class="field">手動順<Icon name="chevron" size={13} /></span>
			</p>
			{#each visible as w (w.id)}
				<p
					class="row"
					class:selected={w.id === opened}
					class:press={pressed === `row-${w.id}`}
					data-t="row-{w.id}"
				>
					<span class="icon {meta[w.category].tone}"
						><Icon name={meta[w.category].icon} size={17} /></span
					>
					<span class="texts"><b>{w.title}</b><small>{w.body}</small></span>
				</p>
			{/each}
		</div>

		<div class="detail">
			{#if current}
				<div class="who">
					<span class="icon big {meta[current.category].tone}">
						<Icon name={meta[current.category].icon} size={24} />
					</span>
					<div>
						<h4>{current.title}</h4>
						<p class="tags">
							<em class="cat">{meta[current.category].label}</em>
							{#each current.tags as t (t)}<em>#{t}</em>{/each}
						</p>
					</div>
				</div>
				<p class="label">内容</p>
				<p class="content">{current.body}</p>
			{:else}
				<p class="blank">資料を選ぶと、ここに全文が出ます</p>
			{/if}
		</div>
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

	.master {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px;
		border-right: 1px solid var(--color-border);
		overflow: hidden;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-bottom: 6px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 11px;
		color: var(--color-text-secondary);
		white-space: nowrap;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.chip small {
		font-size: 10px;
	}

	.chip.on {
		border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
		background: var(--selected);
		color: var(--color-primary);
	}

	.chip.press {
		background: var(--hover);
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

	/* 正方形の角丸のアイコン。色は分類ごと(アプリの IconBadge と同じ) */
	.icon {
		--tone: var(--color-primary);
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: 1px solid color-mix(in srgb, var(--tone) 28%, var(--color-border));
		border-radius: 9px;
		background: color-mix(in srgb, var(--tone) 12%, var(--color-background));
		color: var(--tone);
	}

	.icon.secondary {
		--tone: color-mix(in srgb, var(--color-primary) 55%, var(--color-accent));
	}

	.icon.success {
		--tone: var(--color-success);
	}

	.icon.neutral {
		--tone: var(--color-text-secondary);
	}

	.icon.big {
		width: 48px;
		height: 48px;
		border-radius: 12px;
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

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-top: 4px;
	}

	.tags em {
		padding: 0 8px;
		border-radius: 6px;
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 10.5px;
		font-style: normal;
	}

	.tags em.cat {
		color: var(--color-primary);
	}

	.label {
		font-size: 10.5px;
		color: var(--color-text-secondary);
	}

	.content {
		font-size: 12.5px;
		line-height: 1.7;
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

		.toolbar {
			display: none;
		}
	}
</style>
