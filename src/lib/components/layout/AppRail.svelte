<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { formatRelativeTime } from '$lib/utils/dateUtils';
	import { projectNavItems, navIcons } from './nav';

	let pathname = $derived(page.url.pathname);
	let projectId = $derived(page.params.id || '');
	let isProjectPage = $derived(pathname.startsWith('/project/'));

	function isActive(path: string): boolean {
		return pathname.includes(`/project/${projectId}/${path}`);
	}

	// 選択中の項目を指す三角は 1 つだけ置き、項目間を滑らせて移動させる
	let groupEl = $state<HTMLElement>();
	let notchTop = $state<number | null>(null);

	$effect(() => {
		void pathname;
		void projectId;
		const el = groupEl?.querySelector<HTMLElement>('.rail-item.active');
		notchTop = el ? el.offsetTop + el.offsetHeight / 2 : null;
	});

	// 執筆を開いている時にもう一度押すと、章・シーン一覧のパネルを開閉する
	function onNavClick(e: MouseEvent, path: string) {
		if (path === 'editor' && isActive('editor')) {
			e.preventDefault();
			editorStore.sceneListOpen = !editorStore.sceneListOpen;
		}
	}

	const syncLabels = {
		synced: '同期済み',
		syncing: '同期中',
		offline: 'オフライン',
		conflict: '競合あり(クリックで解決)',
		error: '同期エラー',
		// Firebase 未設定のとき。オフラインではなく、この端末に保存していることを示す
		local: '同期なし(この端末に保存)'
	};

	let shownStatus = $derived(
		(syncStore.isConfigured ? syncStore.status : 'local') as keyof typeof syncLabels
	);

	let syncTitle = $derived.by(() => {
		let label = syncLabels[shownStatus];
		if (syncStore.lastSyncTime) label += ` ・ ${formatRelativeTime(syncStore.lastSyncTime)}`;
		if (syncStore.error) label += `\n${syncStore.error}`;
		return label;
	});
</script>

{#snippet icon(name: keyof typeof navIcons)}
	<svg
		viewBox="0 0 24 24"
		width="22"
		height="22"
		fill="none"
		stroke="currentColor"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- 固定のアイコン定義 -->
		{@html navIcons[name]}
	</svg>
{/snippet}

<nav class="rail" aria-label="メイン">
	<a
		href={resolve('/home')}
		class="rail-mark"
		aria-label="ホームへ戻る"
		title="ホームへ戻る"
		onclick={(e) => {
			e.preventDefault();
			goto(resolve('/home'));
		}}
	>
		<svg viewBox="0 0 36 32" width="26" height="24" aria-hidden="true">
			<path
				d="M28.27.47a1.6 1.6 0 0 1 2.27 0l4.22 4.22a1.6 1.6 0 0 1 0 2.27L20.02 21.71a1.6 1.6 0 0 1-.82.44l-5.28 1.06a1.6 1.6 0 0 1-1.89-1.89l1.06-5.28c.06-.3.21-.58.43-.8z"
				fill="currentColor"
			/>
			<path d="M.7 27h33.74M.7 30.43h33.74" stroke="currentColor" stroke-width="1.4" />
		</svg>
	</a>

	<div class="rail-group rail-main" bind:this={groupEl}>
		{#if notchTop !== null}
			<span class="rail-notch" style="transform: translateY({notchTop}px)" aria-hidden="true"
			></span>
		{/if}
		{#if isProjectPage}
			{#each projectNavItems as item (item.path)}
				{@const active = isActive(item.path)}
				<a
					href={resolve(`/project/${projectId}/${item.path}`)}
					class="rail-item"
					class:active
					aria-current={active ? 'page' : undefined}
					title={item.path === 'editor' && active ? '章・シーン一覧の表示切替' : item.label}
					data-tour="nav-{item.path}"
					onclick={(e) => onNavClick(e, item.path)}
				>
					{@render icon(item.icon)}
					<span class="rail-label">{item.label}</span>
				</a>
			{/each}
		{:else}
			<a
				href={resolve('/home')}
				class="rail-item"
				class:active={pathname === '/home'}
				aria-current={pathname === '/home' ? 'page' : undefined}
			>
				{@render icon('home')}
				<span class="rail-label">作品</span>
			</a>
		{/if}
	</div>

	<div class="rail-group rail-bottom">
		{#if isProjectPage}
			<a href={resolve('/home')} class="rail-item" title="作品一覧へ戻る">
				{@render icon('home')}
				<span class="rail-label">作品一覧</span>
			</a>
		{/if}
		<a
			href={resolve('/settings')}
			class="rail-item"
			class:active={pathname === '/settings'}
			aria-current={pathname === '/settings' ? 'page' : undefined}
		>
			{@render icon('settings')}
			<span class="rail-label">設定</span>
		</a>
		<svelte:element
			this={shownStatus === 'conflict' ? 'button' : 'div'}
			class="rail-sync"
			data-status={shownStatus}
			title={syncTitle}
			role={shownStatus === 'conflict' ? 'button' : 'status'}
			aria-label={syncLabels[shownStatus]}
			onclick={shownStatus === 'conflict' ? () => (syncStore.conflictDialogOpen = true) : undefined}
		>
			<span class="dot"></span>
			<span class="rail-sync-label"
				>{shownStatus === 'synced' ? '同期' : syncLabels[shownStatus].split('(')[0]}</span
			>
		</svelte:element>
	</div>
</nav>

<style>
	.rail {
		flex: none;
		width: var(--rail-width);
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
		padding: 14px 0 12px;
		background: var(--color-surface);
		border-right: 1px solid var(--color-border);
		/* 選択中の項目の切り欠きを境界線の外へはみ出させる */
		position: relative;
		z-index: 4;
	}

	.rail-mark {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 40px;
		margin: 0 12px 14px;
		border-radius: 10px;
		color: var(--color-text);
	}

	.rail-mark:hover {
		background: var(--hover);
	}

	.rail-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.rail-bottom {
		margin-top: auto;
	}

	.rail-item {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		margin: 0 6px;
		padding: 8px 0 7px;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		text-decoration: none;
		cursor: pointer;
		transition:
			color 0.15s,
			background-color 0.15s;
	}

	.rail-item:hover {
		color: var(--color-text);
		background: var(--hover);
	}

	.rail-item.active {
		color: var(--color-text);
	}

	.rail-item.active svg {
		color: var(--color-primary);
	}

	.rail-main {
		position: relative;
	}

	/* 選択中の項目を指す小さな三角(境界線の上に乗せる)。項目間を滑って移動する */
	.rail-notch {
		position: absolute;
		top: -8px;
		right: 0;
		border-style: solid;
		border-width: 8px 8px 8px 0;
		border-color: transparent var(--color-border) transparent transparent;
		transition: transform 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
		animation: notch-in 0.22s ease-out;
		pointer-events: none;
	}

	@keyframes notch-in {
		from {
			opacity: 0;
		}
	}

	.rail-label {
		font-size: 10.5px;
		line-height: 1.2;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.rail-sync {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
		margin: 8px 6px 0;
		padding: 8px 0 2px;
		border: none;
		border-top: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
	}

	button.rail-sync {
		cursor: pointer;
	}

	.rail-sync .dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-success);
	}

	.rail-sync[data-status='syncing'] .dot {
		background: var(--color-info);
		animation: pulse 1.2s ease-in-out infinite;
	}

	.rail-sync[data-status='offline'] .dot,
	.rail-sync[data-status='local'] .dot {
		background: var(--color-text-secondary);
	}

	.rail-sync[data-status='conflict'] .dot,
	.rail-sync[data-status='error'] .dot {
		background: var(--color-error);
	}

	.rail-sync[data-status='conflict'],
	.rail-sync[data-status='error'] {
		color: var(--color-error);
	}

	.rail-sync-label {
		font-size: 10px;
		white-space: nowrap;
	}

	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rail-notch {
			transition: none;
		}

		.rail-sync[data-status='syncing'] .dot {
			animation: none;
		}
	}
</style>
