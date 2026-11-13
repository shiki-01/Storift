<script lang="ts">
	// 「拡張機能を探す」。開いたときだけ、紹介サイトの拡張の一覧を取得する(起動時には取得しない)。
	// 一覧(検索・種類と出所での絞り込み)→ 詳細 → インストール。取得先は storift.shiki-01.com だけ。
	// インストールは「取得 → SHA-256 の確認 → マニフェストの再検証 → 保存」まで。同意と有効化は onInstalled の先で行う
	import IconBadge from '$lib/components/items/IconBadge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import {
		KIND_LABELS,
		ORIGIN_LABELS,
		ORIGIN_NOTES,
		PLATFORM_LABELS,
		type ExtensionOrigin
	} from '$lib/extensions/manifest';
	import { packManager, type InstallResult } from '$lib/extensions/packManager.svelte';
	import type { RegistryEntry } from '$lib/extensions/registryIndex';
	import { registryState } from '$lib/extensions/registryState.svelte';
	import { currentPlatform } from '$lib/extensions/registry';
	import { toast } from '$lib/stores/toast.svelte';
	import ContributionSummary from './ContributionSummary.svelte';
	import OriginBadge from './OriginBadge.svelte';

	interface Props {
		open: boolean;
		/** インストールできたとき(同意と有効化は呼び出し側が行う) */
		oninstalled: (result: InstallResult) => void;
	}

	let { open = $bindable(), oninstalled }: Props = $props();

	let query = $state('');
	let kindFilter = $state('all');
	let sourceFilter = $state('all');
	let selectedId = $state<string | null>(null);
	let installing = $state(false);

	const platform = currentPlatform();

	// 開くたびに取得する(閉じたあとの古い一覧を、そのまま信じない)
	$effect(() => {
		if (open) {
			selectedId = null;
			void registryState.load();
		}
	});

	const entries = $derived(registryState.index?.extensions ?? []);
	// 公式を先に、コミュニティをあとに(それぞれ名前順)
	const sorted = $derived(
		[...entries].sort(
			(a, b) =>
				Number(b.source === 'official') - Number(a.source === 'official') ||
				a.name.localeCompare(b.name, 'ja')
		)
	);
	const filtered = $derived(
		sorted.filter((e) => {
			if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
			if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
			const q = query.trim().toLowerCase();
			if (!q) return true;
			return [e.name, e.description, e.author, e.id].some((v) => v.toLowerCase().includes(q));
		})
	);
	const selected = $derived(entries.find((e) => e.id === selectedId) ?? null);

	function originOf(entry: RegistryEntry): ExtensionOrigin {
		return entry.source === 'official' ? 'official' : 'community';
	}

	function stateOf(entry: RegistryEntry): 'bundled' | 'installed' | 'update' | 'new' {
		if (entry.source === 'official') return 'bundled';
		if (!packManager.info(entry.id)) return 'new';
		return packManager.updateAvailable(entry) ? 'update' : 'installed';
	}

	function formatSize(bytes: number | null): string {
		if (bytes === null) return '-';
		return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
	}

	const supported = (entry: RegistryEntry) => entry.platforms.includes(platform);
	/** インストール(または更新)できる状態か */
	const installable = (entry: RegistryEntry) =>
		supported(entry) && ['new', 'update'].includes(stateOf(entry));

	async function install(entry: RegistryEntry) {
		installing = true;
		try {
			const result = await packManager.installFromRegistry(entry);
			open = false;
			oninstalled(result);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'インストールできませんでした');
		} finally {
			installing = false;
		}
	}

	const KIND_OPTIONS = [
		{ value: 'all', label: 'すべての種類' },
		{ value: 'official', label: KIND_LABELS.official },
		{ value: 'pack', label: KIND_LABELS.pack },
		{ value: 'script', label: KIND_LABELS.script }
	];
	const SOURCE_OPTIONS = [
		{ value: 'all', label: 'すべての出所' },
		{ value: 'official', label: ORIGIN_LABELS.official },
		{ value: 'community', label: ORIGIN_LABELS.community }
	];
</script>

<Modal bind:isOpen={open} title={selected ? selected.name : '拡張機能を探す'} size="large">
	<div class="browser" data-testid="pack-browser">
		{#if registryState.status === 'loading' && !registryState.index}
			<p class="state" role="status">拡張の一覧を取得しています…</p>
		{:else if registryState.status === 'error'}
			<div class="state error" role="alert" data-testid="registry-error">
				<Icon name="alert-triangle" class="state-ico" />
				<div>
					<p class="state-title">
						{registryState.errorKind === 'offline'
							? 'オフラインのため、一覧を取得できません'
							: '一覧を取得できませんでした'}
					</p>
					<p>{registryState.error}</p>
					<p>すでに入れた拡張機能は、そのまま使えます。</p>
				</div>
				<Button variant="secondary" size="sm" onclick={() => void registryState.load()}
					>再試行</Button
				>
			</div>
		{:else if selected}
			{@const entry = selected}
			{@const state = stateOf(entry)}
			<div class="detail" data-testid="pack-detail">
				<button type="button" class="back" onclick={() => (selectedId = null)}>
					<Icon name="chevron-left" class="back-ico" />一覧に戻る
				</button>
				<header class="d-head">
					<IconBadge size={52} shape="square" icon={entry.icon} />
					<div class="d-title">
						<div class="chips">
							<span class="chip kind">{KIND_LABELS[entry.kind]}</span>
							{#if entry.source !== 'official'}<OriginBadge origin={originOf(entry)} />{/if}
						</div>
						<p class="d-desc">{entry.description}</p>
					</div>
				</header>

				{#if originOf(entry) !== 'official'}
					<p class="notice">{ORIGIN_NOTES[originOf(entry)]}</p>
				{/if}

				<dl class="facts">
					<div>
						<dt>作者</dt>
						<dd>{entry.author}</dd>
					</div>
					<div>
						<dt>ライセンス</dt>
						<dd>{entry.license ?? '-'}</dd>
					</div>
					<div>
						<dt>版</dt>
						<dd>{entry.version}</dd>
					</div>
					<div>
						<dt>サイズ</dt>
						<dd>{formatSize(entry.size)}</dd>
					</div>
					<div>
						<dt>更新日</dt>
						<dd>{entry.updatedAt ?? '-'}</dd>
					</div>
					<div>
						<dt>対応環境</dt>
						<dd>{entry.platforms.map((p) => PLATFORM_LABELS[p]).join('・')}</dd>
					</div>
				</dl>

				{#if entry.contributes.length > 0}
					<section>
						<h4>この拡張が追加するもの</h4>
						<ContributionSummary kinds={entry.contributes} />
					</section>
				{/if}

				<section>
					<h4>権限</h4>
					<ul>
						{#each entry.permissions.receives as item, i (i)}<li>受け取る: {item}</li>{/each}
						{#if entry.permissions.network.length > 0}
							<li>通信できる相手: {entry.permissions.network.join(' / ')}</li>
						{:else}
							<li>通信しません</li>
						{/if}
						{#if entry.permissions.storage}<li>この端末に内容を保存します</li>{/if}
						{#if entry.permissions.notify}<li>画面に通知(トースト)を出します</li>{/if}
						{#if entry.permissions.ui}<li>操作画面(ポップアップ・設定欄)を表示します</li>{/if}
					</ul>
					{#if entry.kind === 'script'}
						<p class="small" data-testid="script-browser-note">
							スクリプトは隔離された環境で動きますが、通信先に送られた情報は取り消せません。運営者は内容を保証しません。
						</p>
					{/if}
				</section>

				<section>
					<h4>プライバシー</h4>
					<ul>
						{#if entry.privacy.sends.length === 0}
							<li>外部へは何も送りません</li>
						{:else}
							<li>送り先: {entry.privacy.sends.join(' / ')}</li>
						{/if}
						{#each entry.privacy.stores as store, i (i)}<li>保存: {store}</li>{/each}
						<li>無効にしたとき: {entry.privacy.onDisable}</li>
					</ul>
					<p class="small">
						詳しい内容は、インストール後の同意画面で確認できます(同意するまで有効になりません)。
					</p>
				</section>

				<div class="d-actions">
					{#if state === 'bundled'}
						<p class="small">Storift に同梱されています。設定の一覧から有効にします。</p>
					{:else if !supported(entry)}
						<p class="small">この環境({PLATFORM_LABELS[platform]})では使えません。</p>
					{:else if state === 'installed'}
						<span class="done"><Icon name="check" class="done-ico" />インストール済み</span>
					{/if}
				</div>
			</div>
		{:else}
			<div class="filters">
				<label class="search">
					<span class="sr-only">拡張機能を検索</span>
					<span class="search-ico" aria-hidden="true"><Icon name="search" /></span>
					<input
						type="search"
						placeholder="名前・説明・作者で検索"
						bind:value={query}
						data-testid="pack-search"
					/>
				</label>
				<div class="selects">
					<Select bind:value={kindFilter} options={KIND_OPTIONS} aria-label="種類で絞り込み" />
					<Select bind:value={sourceFilter} options={SOURCE_OPTIONS} aria-label="出所で絞り込み" />
				</div>
			</div>

			{#if filtered.length === 0}
				<p class="state">条件に合う拡張機能はありません。</p>
			{:else}
				<ul class="rows">
					{#each filtered as entry (entry.id)}
						{@const state = stateOf(entry)}
						<li>
							<button
								type="button"
								class="row"
								data-testid={`pack-row-${entry.id}`}
								onclick={() => (selectedId = entry.id)}
							>
								<IconBadge size={40} shape="square" icon={entry.icon} />
								<span class="r-body">
									<span class="r-title">
										<span class="r-name">{entry.name}</span>
										<span class="chip kind">{KIND_LABELS[entry.kind]}</span>
										{#if entry.source !== 'official'}<OriginBadge origin={originOf(entry)} />{/if}
									</span>
									<span class="r-desc">{entry.description}</span>
									<span class="r-meta">
										{entry.author}・版 {entry.version}
										{#if state === 'installed'}・<b>インストール済み</b>{/if}
										{#if state === 'update'}・<b class="upd">更新あり</b>{/if}
										{#if state === 'bundled'}・同梱{/if}
									</span>
								</span>
								<Icon name="chevron-right" class="r-chev" />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
	{#snippet footer()}
		<div class="foot">
			<p class="small">取得先: storift.shiki-01.com のみ。開いたときだけ取得します。</p>
			<div class="foot-btns">
				{#if selected && installable(selected)}
					<Button
						disabled={installing}
						onclick={() => void install(selected)}
						data-testid="pack-install"
					>
						{installing
							? 'インストール中…'
							: stateOf(selected) === 'update'
								? '更新'
								: 'インストール'}
					</Button>
				{/if}
				<Button
					variant="secondary"
					size="sm"
					disabled={registryState.status === 'loading'}
					onclick={() => void registryState.load()}>更新を確認</Button
				>
				<Button variant="secondary" size="sm" onclick={() => (open = false)}>閉じる</Button>
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	/* 内容が長くても、下のボタンが常に見えるよう、内容だけをスクロールさせる */
	.browser {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: 240px;
		max-height: min(62dvh, 560px);
		overflow-y: auto;
		padding-right: 4px;
		overscroll-behavior: contain;
	}

	@media (max-width: 768px) {
		.browser {
			max-height: calc(100dvh - 210px - var(--safe-top, 0px));
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.filters {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.search {
		position: relative;
		display: block;
	}

	.search-ico {
		position: absolute;
		inset: 0 auto 0 10px;
		display: flex;
		align-items: center;
		color: var(--color-text-secondary);
		pointer-events: none;
	}

	.search-ico :global(svg),
	.search-ico :global(div) {
		display: flex;
		width: 16px;
		height: 16px;
	}

	.search input {
		width: 100%;
		height: 38px;
		padding: 0 12px 0 32px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 14px;
	}

	.search input:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.selects {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}

	.row:hover {
		border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
		background: color-mix(in srgb, var(--color-surface) 40%, var(--color-background));
	}

	.row:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.r-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.r-title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
	}

	.r-name {
		font-size: 14px;
		font-weight: 600;
	}

	.r-desc {
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.r-meta {
		font-size: 11.5px;
		color: var(--color-text-secondary);
	}

	.r-meta .upd {
		color: var(--color-info);
	}

	.row :global(.r-chev) {
		flex: none;
		width: 18px;
		height: 18px;
		color: var(--color-text-secondary);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 11px;
		line-height: 1;
		color: var(--color-text-secondary);
	}

	.chip.kind {
		border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 9%, var(--color-background));
		font-weight: 600;
	}

	:global(:root[data-scheme='dark']) .chip.kind {
		color: color-mix(in srgb, var(--color-primary) 65%, var(--color-text));
	}

	.state {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 0;
		padding: 24px 4px;
		font-size: 13.5px;
		color: var(--color-text-secondary);
	}

	.state.error {
		flex-wrap: wrap;
		padding: 16px;
		border: 1px solid color-mix(in srgb, var(--color-warning) 55%, var(--color-border));
		border-radius: 10px;
		background: color-mix(in srgb, var(--color-warning) 8%, var(--color-background));
		color: var(--color-text);
	}

	.state.error p {
		margin: 0;
		font-size: 13px;
		line-height: 1.6;
	}

	.state.error :global(.state-ico) {
		flex: none;
		width: 20px;
		height: 20px;
		color: var(--color-warning);
	}

	.state-title {
		font-weight: 600;
	}

	.detail {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.back {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 32px;
		padding: 0 8px 0 2px;
		border: none;
		background: none;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}

	.back:hover {
		color: var(--color-text);
	}

	.back :global(.back-ico) {
		width: 16px;
		height: 16px;
	}

	.d-head {
		display: flex;
		align-items: flex-start;
		gap: 14px;
	}

	.d-title {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.d-desc {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.7;
		color: var(--color-text-secondary);
	}

	.notice {
		margin: 0;
		padding: 10px 12px;
		border: 1px solid color-mix(in srgb, var(--color-warning) 50%, var(--color-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-warning) 7%, var(--color-background));
		font-size: 12.5px;
		line-height: 1.7;
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 10px 16px;
		margin: 0;
	}

	.facts div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.facts dt {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	.facts dd {
		margin: 0;
		font-size: 13px;
		overflow-wrap: anywhere;
	}

	.detail section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.detail h4 {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
	}

	.detail ul {
		margin: 0;
		padding-left: 1.2em;
		list-style: disc;
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 13px;
		line-height: 1.65;
		color: var(--color-text-secondary);
	}

	.small {
		margin: 0;
		font-size: 12px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.d-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-top: 4px;
	}

	.done {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--color-success);
	}

	.done :global(.done-ico) {
		width: 16px;
		height: 16px;
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px 12px;
	}

	.foot-btns {
		display: flex;
		gap: 8px;
	}
</style>
