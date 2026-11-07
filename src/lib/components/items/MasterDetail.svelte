<script lang="ts">
	/**
	 * 一覧と詳細のレイアウト。
	 * - 広いとき: 一覧と詳細を並べる(それぞれ独立してスクロール)。
	 *   listLayout="sidebar": 左に一覧(幅 320〜380px)、右に詳細(読みやすい幅)。
	 *   listLayout="fill": 一覧(プロットのボードなど)が広がり、項目を選ぶと右に詳細ペインが出る。
	 * - 狭いとき(スマホ): 一覧が全画面。項目を開くと詳細が全画面に切り替わり、ヘッダーの「戻る」で一覧へ戻る。
	 *   一覧は裏に残すので、戻ったときのスクロール位置は保たれる。
	 * - 選択中の項目は URL の hash(#<id>)に持つ。リロードで復元でき、狭いときは履歴に積むので、
	 *   ブラウザ/Android の戻るで一覧へ戻れる。広いときは履歴に積まず(replace)、localStorage にも覚えて次回復元する。
	 *
	 * 選択の変更は、このコンポーネントの open() / close() / replace() を使う(bind:this で呼ぶ)。
	 * selectedId は読み取り用に bind できる。未保存の変更があるとき(guard)は、開く・閉じる前に確認する。
	 */
	import { onMount, untrack, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { pushState, replaceState } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		/** 選択中の項目の ID(読み取り用。変更は open / close / replace で) */
		selectedId?: string | null;
		/** 広いレイアウトか(読み取り用。狭いとき、ページ側で上のヘッダーを畳むのに使う) */
		wide?: boolean;
		/** 一覧の読み込みが終わった。終わるまでは、存在しない ID でも選択を捨てない */
		ready?: boolean;
		/** ID の項目が存在するか(消された項目の選択を外す) */
		exists?: (id: string) => boolean;
		listLayout?: 'sidebar' | 'fill';
		/** この幅(コンテナ幅 px)以上を「広い」とみなす */
		wideMin?: number;
		/** 詳細ヘッダーの見出し(狭いときの戻るボタンの隣) */
		detailTitle?: string;
		/** localStorage に選択を覚えるキー(作品ごとに分ける。省略で覚えない) */
		storageKey?: string;
		/** 広いとき、何も選ばれていなければこの項目を開く */
		fallbackId?: string | null;
		/** 未保存の変更の確認 */
		guard?: { dirty: () => boolean; confirm: () => Promise<boolean> };
		list: Snippet;
		detail: Snippet;
		/** 一覧の上の検索・絞り込み */
		listHeader?: Snippet;
		/** 広いとき、何も選ばれていない詳細ペインの内容(sidebar のみ) */
		placeholder?: Snippet;
		/** 詳細ヘッダーの右側(狭いとき・fill の詳細ペイン) */
		headerActions?: Snippet;
		class?: string;
	}

	let {
		selectedId = $bindable(null),
		wide = $bindable(false),
		ready = true,
		exists,
		listLayout = 'sidebar',
		wideMin = 900,
		detailTitle = '詳細',
		storageKey,
		fallbackId = null,
		guard,
		list,
		detail,
		listHeader,
		placeholder,
		headerActions,
		class: className = ''
	}: Props = $props();

	let rootEl = $state<HTMLElement>();
	let width = $state(0);
	const isWide = $derived(width >= wideMin);
	let mounted = $state(false);
	$effect.pre(() => {
		wide = isWide;
	});
	/** この ID を履歴に積んで開いた(戻るボタンで history.back() してよい) */
	let pushedFor: string | null = null;

	/** 起動時(リロード・直接開いたとき)の選択は URL の hash から復元する */
	function hashOf(): string | null {
		if (typeof location === 'undefined') return null;
		const raw = location.hash.slice(1);
		if (!raw) return null;
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}

	// 注意: SvelteKit の pushState / replaceState は page.url を更新しない(page.state だけが変わる)。
	// そのため選択の正は selectedId とし、履歴には { md: id } を持たせて、戻る/進むの追従に使う。
	selectedId = hashOf();
	let firstState = true;
	let confirming = false;

	$effect(() => {
		const next = (page.state as { md?: string | null }).md ?? null;
		if (firstState) {
			firstState = false;
			return;
		}
		untrack(() => {
			if (next === selectedId) return;
			// 未保存の変更があるまま、ブラウザの戻る/進むで離れた: 確認し、やめたら元の項目へ戻す
			if (guard?.dirty() && !confirming) {
				const keep = selectedId;
				confirming = true;
				void guard.confirm().then((ok) => {
					confirming = false;
					if (ok) selectedId = next;
					else shallow('push', keep);
				});
				return;
			}
			selectedId = next;
		});
	});

	const hasSelection = $derived(selectedId !== null);

	function urlFor(id: string | null): string {
		const base = page.url.pathname + page.url.search;
		return id === null ? base : `${base}#${encodeURIComponent(id)}`;
	}

	/** 現在のページ自身の URL(hash だけが変わる)を履歴に積む / 置き換える */
	function shallow(mode: 'push' | 'replace', id: string | null) {
		const url = urlFor(id);
		/* eslint-disable svelte/no-navigation-without-resolve -- 同じページ内の hash の変更で、別の経路へは移らない */
		if (mode === 'push') pushState(url, { md: id });
		else replaceState(url, { md: id });
		/* eslint-enable svelte/no-navigation-without-resolve */
	}

	async function allowLeave(): Promise<boolean> {
		if (!guard?.dirty()) return true;
		return await guard.confirm();
	}

	/** 項目を開く。狭いときは履歴に積む。未保存の変更があれば確認し、やめたら false */
	export async function open(id: string): Promise<boolean> {
		if (id === selectedId) return true;
		if (!(await allowLeave())) return false;
		selectedId = id;
		if (!isWide) {
			shallow('push', id);
			pushedFor = id;
		} else {
			shallow('replace', id);
		}
		return true;
	}

	/** 詳細を閉じて一覧へ戻る(戻るボタン)。未保存の変更があれば確認し、やめたら false */
	export async function close(): Promise<boolean> {
		if (selectedId === null) return true;
		if (!(await allowLeave())) return false;
		if (pushedFor === selectedId) {
			// 開くときに積んだ履歴を戻る(popstate で page.state が変わり、選択が外れる)。先に外しておく
			pushedFor = null;
			selectedId = null;
			history.back();
		} else {
			selectedId = null;
			shallow('replace', null);
		}
		return true;
	}

	/** 履歴に積まずに選択を置き換える(削除後・作成直後など)。null で選択を外す */
	export function replace(id: string | null) {
		if (id === selectedId) return;
		pushedFor = null;
		selectedId = id;
		shallow('replace', id);
	}

	onMount(() => {
		mounted = true;
		if (!rootEl) return;
		width = rootEl.clientWidth;
		const observer = new ResizeObserver(() => {
			width = rootEl!.clientWidth;
		});
		observer.observe(rootEl);
		return () => observer.disconnect();
	});

	const memoryKey = $derived(storageKey ? `storift:selected:${storageKey}` : null);

	// 広いとき、選択が無ければ前回の項目(なければ fallbackId)を開く
	let restored = false;
	$effect(() => {
		if (!mounted || !ready || restored || width === 0) return;
		restored = true;
		if (selectedId !== null || !isWide) return;
		let remembered: string | null = null;
		try {
			remembered = memoryKey ? localStorage.getItem(memoryKey) : null;
		} catch {
			// ストレージが使えない環境
		}
		const candidate = [remembered, fallbackId].find((id) => id && (!exists || exists(id)));
		if (candidate) replace(candidate);
	});

	// 消された項目の選択を外す
	$effect(() => {
		if (!mounted || !ready || selectedId === null || !exists) return;
		if (!exists(selectedId)) replace(null);
	});

	// 選択を覚える
	$effect(() => {
		if (!memoryKey || !ready || selectedId === null || (exists && !exists(selectedId))) return;
		try {
			localStorage.setItem(memoryKey, selectedId);
		} catch {
			// ストレージが使えない環境
		}
	});

	const overlay = $derived(!isWide && hasSelection);
</script>

<div
	bind:this={rootEl}
	class="md {className}"
	data-layout={listLayout}
	data-wide={isWide}
	data-detail-open={hasSelection}
>
	<section
		class="list-pane"
		aria-label="一覧"
		inert={overlay}
		aria-hidden={overlay ? 'true' : undefined}
	>
		{#if listHeader}<div class="list-head">{@render listHeader()}</div>{/if}
		<div class="list-body">
			{@render list()}
		</div>
	</section>

	{#if hasSelection}
		<section class="detail-pane" aria-label={detailTitle}>
			{#if !isWide || listLayout === 'fill'}
				<header class="detail-head">
					<button
						type="button"
						class="back"
						onclick={() => void close()}
						aria-label={isWide ? '詳細を閉じる' : '一覧に戻る'}
					>
						<Icon name={isWide ? 'x' : 'chevron-left'} class="back-ico" />
						{#if !isWide}<span>一覧</span>{/if}
					</button>
					<span class="detail-title">{detailTitle}</span>
					{#if headerActions}<div class="head-actions">{@render headerActions()}</div>{/if}
				</header>
			{/if}
			<div class="detail-scroll scroll-stable">
				<div class="detail-inner">
					{@render detail()}
				</div>
			</div>
		</section>
	{:else if isWide && listLayout === 'sidebar' && placeholder}
		<section class="detail-pane" aria-label={detailTitle}>
			<div class="detail-scroll scroll-stable">
				<div class="detail-inner">{@render placeholder()}</div>
			</div>
		</section>
	{/if}
</div>

<style>
	.md {
		position: relative;
		display: flex;
		flex: 1;
		width: 100%;
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow: hidden;
	}

	.list-pane {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}

	.list-head {
		flex: none;
	}

	.list-body {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.detail-pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--color-background);
	}

	.detail-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.detail-inner {
		box-sizing: border-box;
		width: 100%;
		padding: 28px 32px 48px;
	}

	.detail-head {
		display: flex;
		flex: none;
		align-items: center;
		gap: 8px;
		min-height: 48px;
		padding: 0 12px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-background);
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-width: 36px;
		height: 36px;
		padding: 0 8px 0 6px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--color-primary);
		font: inherit;
		font-size: 14px;
	}

	.back:hover {
		background: var(--hover);
	}

	.detail-head :global(.back-ico) {
		display: flex;
		width: 20px;
		height: 20px;
	}

	.detail-head :global(.back-ico svg) {
		width: 100%;
		height: 100%;
	}

	.detail-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.head-actions {
		display: flex;
		flex: none;
		align-items: center;
		gap: 6px;
	}

	/* 広い: sidebar = 左に一覧、右に詳細 */
	.md[data-wide='true'][data-layout='sidebar'] .list-pane {
		flex: 0 0 clamp(320px, 32%, 380px);
		border-right: 1px solid var(--color-border);
	}

	.md[data-wide='true'][data-layout='sidebar'] .detail-pane {
		flex: 1;
	}

	.md[data-wide='true'][data-layout='sidebar'] .detail-inner {
		max-width: 52rem;
		margin: 0 auto;
	}

	/* 広い: fill = 一覧が広がり、右に詳細ペイン */
	.md[data-wide='true'][data-layout='fill'] .detail-pane {
		flex: 0 0 clamp(360px, 34%, 460px);
		border-left: 1px solid var(--color-border);
	}

	.md[data-wide='true'][data-layout='fill'] .detail-inner {
		padding: 20px 24px 48px;
	}

	/* 狭い: 詳細を全画面で重ねる(一覧は裏に残し、スクロール位置を保つ) */
	.md[data-wide='false'] .detail-pane {
		position: absolute;
		inset: 0;
		z-index: 3;
	}

	.md[data-wide='false'] .detail-inner {
		padding: 16px 16px 40px;
	}

	.md[data-wide='false'] .list-pane[inert] {
		visibility: hidden;
	}

	@media (prefers-reduced-motion: no-preference) {
		.md[data-wide='false'] .detail-pane {
			animation: detail-in 0.2s cubic-bezier(0.2, 0.7, 0.2, 1);
		}
	}

	@keyframes detail-in {
		from {
			opacity: 0;
			transform: translateX(16px);
		}
	}
</style>
