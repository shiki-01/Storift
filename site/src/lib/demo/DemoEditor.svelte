<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import Manuscript from '$lib/Manuscript.svelte';
	import { plainText } from '$lib/notation';

	let {
		text,
		split,
		saving,
		pressed
	}: { text: string; split: boolean; saving: boolean; pressed: string | null } = $props();

	let lines = $derived(text.split('\n'));
	let count = $derived(plainText(text).replace(/\s/g, '').length);

	const sceneCounts: Record<string, string> = {
		坂の上の灯り: '1,206',
		地図にない名前: '874',
		始発列車: '1,032',
		消えた駅: '618'
	};

	const chapters = [
		{
			title: '第一章 雨の古書店',
			count: 2184,
			scenes: ['坂の上の灯り', '祖母の栞', '地図にない名前']
		},
		{ title: '第二章 知らない町', count: 1650, scenes: ['始発列車', '消えた駅'] }
	];
</script>

<div class="editor" class:split>
	<aside class="list">
		<div class="search"><span>シーンを検索</span><b>＋ 章</b></div>
		{#each chapters as c (c.title)}
			<p class="chapter"><span>⌄</span><strong>{c.title}</strong></p>
			{#each c.scenes as s (s)}
				<p class="scene" class:active={s === '祖母の栞'}>
					{s}<small>{s === '祖母の栞' ? count.toLocaleString() : sceneCounts[s]}字</small>
				</p>
			{/each}
		{/each}
	</aside>

	<div class="pane">
		<div class="bar">
			<Icon name="panel" size={16} />
			<div class="crumb"><small>第一章 雨の古書店</small><strong>祖母の栞</strong></div>
			<span class="count">{count} 字</span>
			<div class="tools">
				<span class="modes">
					<i class:on={!split}><Icon name="write" size={14} /></i>
					<i class:on={split} class:press={pressed === 'mode-split'} data-t="mode-split">
						<Icon name="split" size={14} />
					</i>
					<i><Icon name="eye" size={14} /></i>
				</span>
				<span class="extra">
					<Icon name="export" size={15} /><Icon name="print" size={15} /><Icon
						name="history"
						size={15}
					/><Icon name="search" size={15} />
				</span>
				<span class="saved" class:saving><i></i>{saving ? '保存中' : '保存済み'}</span>
			</div>
		</div>

		<div class="body">
			<div class="source">
				{#each lines as line, i (i)}
					<p>
						{line}{#if i === lines.length - 1}<span class="caret" data-t="text-end"></span>{/if}
					</p>
				{/each}
			</div>
			{#if split}
				<div class="preview">
					<Manuscript {text} vertical />
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.editor {
		display: grid;
		grid-template-columns: 190px minmax(0, 1fr);
		height: 100%;
		min-height: 0;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px;
		border-right: 1px solid var(--color-border);
		overflow: hidden;
		white-space: nowrap;
	}

	.search {
		display: flex;
		gap: 6px;
		margin-bottom: 8px;
		color: var(--color-text-secondary);
		font-size: 11.5px;
	}

	.search span {
		flex: 1;
		padding: 5px 9px;
		border: 1px solid var(--color-border);
		border-radius: 7px;
	}

	.search b {
		padding: 5px 8px;
		border-radius: 7px;
		background: var(--selected);
		color: var(--color-primary);
		font-weight: 400;
	}

	.chapter {
		display: flex;
		gap: 6px;
		padding: 7px 4px 3px;
		overflow: hidden;
	}

	.chapter span {
		color: var(--color-text-secondary);
	}

	.chapter strong {
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 600;
	}

	.scene {
		display: flex;
		flex-direction: column;
		padding: 5px 8px 5px 20px;
		border-radius: 8px;
		line-height: 1.4;
	}

	.scene small {
		font-size: 10px;
		color: var(--color-text-secondary);
	}

	.scene.active {
		background: var(--selected);
		color: var(--color-primary);
	}

	.pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--editor-background);
	}

	.bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: 10px;
		height: 44px;
		padding: 0 12px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-background);
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.crumb {
		display: flex;
		flex-direction: column;
		line-height: 1.25;
	}

	.crumb small {
		font-size: 9.5px;
	}

	.crumb strong {
		color: var(--color-text);
		font-size: 12px;
		font-weight: 600;
	}

	.count {
		padding-left: 10px;
		border-left: 1px solid var(--color-border);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.tools {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-left: auto;
	}

	.modes {
		display: inline-flex;
		gap: 1px;
		padding: 2px;
		border-radius: 8px;
		background: var(--color-surface);
	}

	.modes i {
		display: inline-flex;
		padding: 4px 6px;
		border-radius: 6px;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.modes i.on {
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
	}

	.modes i.press {
		background: var(--selected);
	}

	.extra {
		display: inline-flex;
		gap: 10px;
	}

	.saved {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10.5px;
	}

	.saved i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--color-success);
		transition: background-color 0.2s;
	}

	.saved.saving i {
		background: var(--color-text-secondary);
	}

	.body {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	.source {
		flex: 1;
		min-width: 0;
		padding: 24px 40px;
		font-family: var(--font-serif);
		font-size: 14px;
		line-height: 2.1;
		letter-spacing: 0.04em;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.split .source {
		padding: 20px 24px;
		font-size: 13px;
	}

	.caret {
		display: inline-block;
		width: 1.5px;
		height: 1.1em;
		margin-left: 1px;
		vertical-align: -0.15em;
		background: var(--color-primary);
		animation: blink 1.1s steps(1) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	.preview {
		flex: 1;
		min-width: 0;
		display: flex;
		justify-content: flex-end;
		padding: 22px 20px;
		border-left: 1px solid var(--color-border);
		background: var(--color-background);
		font-size: 13px;
		overflow: hidden;
		animation: reveal 0.32s cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	@keyframes reveal {
		from {
			opacity: 0;
			transform: translateX(14px);
		}
	}

	@media (max-width: 1040px) {
		.editor {
			grid-template-columns: minmax(0, 1fr);
		}

		.list,
		.extra {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.crumb small,
		.bar > :global(svg),
		.saved {
			display: none;
		}

		.source {
			padding: 16px;
			font-size: 13px;
		}

		/* 狭い画面では、二画面ではなく上下に分けて見せる */
		.split .body {
			flex-direction: column;
		}

		.split .source {
			flex: none;
			height: 46%;
			padding: 10px 14px;
			font-size: 12px;
			line-height: 1.8;
			display: flex;
			flex-direction: column;
			justify-content: flex-end;
		}

		.preview {
			padding: 12px;
			border-left: none;
			border-top: 1px solid var(--color-border);
			font-size: 12px;
		}
	}
</style>
