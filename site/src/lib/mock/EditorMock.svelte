<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import type { IconName } from '$lib/icons';

	// アプリの左レール(src/lib/components/layout/AppRail.svelte)と同じ並び
	const rail: { icon: IconName; label: string; active?: boolean }[] = [
		{ icon: 'write', label: '執筆', active: true },
		{ icon: 'plot', label: 'プロット' },
		{ icon: 'characters', label: '人物' },
		{ icon: 'world', label: '設定資料' },
		{ icon: 'progress', label: '進捗' }
	];

	const chapters = [
		{ title: '第一章　雨の古書店', scenes: ['一', '二', '三'], open: true },
		{ title: '第二章　知らない町', scenes: [], open: false },
		{ title: '第三章　帰り道', scenes: [], open: false }
	];
</script>

<div class="window" aria-hidden="true">
	<div class="titlebar">
		<span class="crumb">雨の日の栞<span class="sep">/</span>第一章<span class="sep">/</span>二</span
		>
		<span class="saved"><span class="dot"></span>保存しました</span>
	</div>

	<div class="body">
		<div class="rail">
			<span class="rail-home"><Icon name="home" size={18} /></span>
			{#each rail as r (r.label)}
				<span class="rail-item" class:active={r.active}>
					<Icon name={r.icon} size={18} />
					<span>{r.label}</span>
				</span>
			{/each}
			<span class="rail-item rail-bottom"><Icon name="settings" size={18} /><span>設定</span></span>
		</div>

		<div class="tree">
			<p class="tree-head">原稿</p>
			{#each chapters as c (c.title)}
				<p class="chapter" class:open={c.open}>
					<span class="chev">{c.open ? '▾' : '▸'}</span>{c.title}
				</p>
				{#each c.scenes as s (s)}
					<p class="scene" class:active={s === '二'}>
						{s}<span class="count">{s === '一' ? '3,412' : s === '二' ? '2,184' : '—'}</span>
					</p>
				{/each}
			{/each}
		</div>

		<div class="editor">
			<p class="scene-title">二</p>
			<div class="text">
				<p>　坂の上の古書店は、雨の日にだけ灯りをともす。</p>
				<p>
					　<ruby>栞<rt>しおり</rt></ruby
					>の挟まった頁をひらくと、そこには祖母の字で、私の知らない町の名前が書かれていた。
				</p>
				<p>　「この町へは、もう行けないのよ」</p>
				<p class="current">
					　そう言って笑った顔を、私はいまでも覚えている<span class="caret"></span>
				</p>
			</div>
			<div class="status">
				<span>2,184 字</span>
				<span class="goal">
					今日 1,240 / 2,000 字
					<span class="bar"><span style:width="62%"></span></span>
				</span>
			</div>
		</div>
	</div>
</div>

<style>
	.window {
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		overflow: hidden;
		font-size: 12.5px;
		line-height: 1.6;
		user-select: none;
	}

	.titlebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 36px;
		padding: 0 14px;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		font-size: 12px;
	}

	.sep {
		margin: 0 6px;
		opacity: 0.5;
	}

	.saved {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-success);
	}

	.body {
		display: grid;
		grid-template-columns: 60px 190px 1fr;
		min-height: 380px;
	}

	.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 10px 0;
		border-right: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-secondary);
	}

	.rail-home {
		padding: 6px 0 10px;
	}

	.rail-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		width: 48px;
		padding: 6px 0 4px;
		border-radius: 8px;
		font-size: 9.5px;
		letter-spacing: 0;
	}

	.rail-item.active {
		background: var(--selected);
		color: var(--color-primary);
	}

	.rail-bottom {
		margin-top: auto;
	}

	.tree {
		padding: 14px 10px;
		border-right: 1px solid var(--color-border);
	}

	.tree-head {
		padding: 0 8px 8px;
		font-size: 11px;
		letter-spacing: 0.08em;
		color: var(--color-text-secondary);
	}

	.chapter,
	.scene {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border-radius: 6px;
		white-space: nowrap;
		overflow: hidden;
	}

	.chapter {
		color: var(--color-text-secondary);
	}

	.chapter.open {
		color: var(--color-text);
	}

	.chev {
		width: 12px;
		font-size: 9px;
	}

	.scene {
		padding-left: 24px;
		justify-content: space-between;
	}

	.scene.active {
		background: var(--selected);
	}

	.count {
		font-size: 10.5px;
		color: var(--color-text-secondary);
	}

	.editor {
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--editor-background);
	}

	.scene-title {
		padding: 28px 40px 0;
		font-family: var(--font-serif);
		font-size: 15px;
		font-weight: 600;
	}

	.text {
		flex: 1;
		padding: 14px 40px 24px;
		font-family: var(--font-serif);
		font-size: 14.5px;
		line-height: 2.1;
		letter-spacing: 0.04em;
	}

	.text p.current {
		margin: 0 -40px;
		padding: 0 40px;
		background: var(--editor-line-highlight);
	}

	ruby rt {
		font-size: 0.5em;
		letter-spacing: 0.1em;
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

	.status {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 16px;
		border-top: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		font-size: 11.5px;
		background: var(--color-background);
	}

	.goal {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.bar {
		width: 64px;
		height: 4px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-text) 12%, transparent);
		overflow: hidden;
	}

	.bar span {
		display: block;
		height: 100%;
		background: var(--color-primary);
	}

	@media (max-width: 860px) {
		.body {
			grid-template-columns: 52px 1fr;
		}

		.tree {
			display: none;
		}
	}

	@media (max-width: 560px) {
		.body {
			grid-template-columns: 1fr;
			min-height: 0;
		}

		.rail {
			display: none;
		}

		.scene-title,
		.text {
			padding-left: 20px;
			padding-right: 20px;
		}

		.text p.current {
			margin: 0 -20px;
			padding: 0 20px;
		}

		.crumb {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
