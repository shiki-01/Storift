<script lang="ts">
	// 設定「エディタ」: 自動保存、書式、ショートカットキー、通知とリマインダー
	import { onMount } from 'svelte';
	import {
		DEFAULT_SHORTCUTS,
		FIXED_SHORTCUTS,
		SHORTCUT_LABELS,
		eventToShortcut,
		findConflicts,
		type ShortcutAction
	} from '$lib/utils/shortcuts';
	import Button from '$lib/components/ui/Button.svelte';
	import NotificationSettings from '$lib/components/ui/NotificationSettings.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { getAutoOpen, setAutoOpen } from '$lib/utils/siteLink';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { settingsDB } from '$lib/db';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import SortableList from '$lib/components/items/SortableList.svelte';
	import { extensionHost } from '$lib/extensions/host.svelte';
	import {
		FIXED_LAST_ID,
		orderedItems,
		reorderStored,
		setInMenu,
		splitToolbar,
		type ToolbarItem
	} from '$lib/utils/toolbarItems';
	import SettingsCard from './SettingsCard.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import type { SettingsForm } from './settingsForm.svelte';

	let { form }: { form: SettingsForm } = $props();

	let recordingAction = $state<ShortcutAction | null>(null);
	let conflicts = $derived(findConflicts(form.settings.shortcuts));

	let autoOpenFromSite = $state(false);

	onMount(() => {
		if (!isDesktop()) autoOpenFromSite = getAutoOpen();
		// 設定画面を直接開いたときも、保存済みのツールバー設定を反映する
		void settingsDB
			.get()
			.then((saved) => {
				settingsStore.toolbarMenuItems = saved.toolbarMenuItems ?? [];
				settingsStore.toolbarOrder = saved.toolbarOrder ?? [];
			})
			.catch(() => undefined);
	});

	// 自動保存
	const handleAutoSaveToggle = async () => {
		form.settings.autoSave = !form.settings.autoSave;
		await form.save();
	};

	const handleAutoSaveSeconds = async () => {
		const seconds = Math.min(Math.max(Math.round(Number(form.autoSaveSeconds)) || 30, 5), 300);
		form.autoSaveSeconds = seconds;
		form.settings.autoSaveInterval = seconds * 1000;
		await form.save();
	};

	// ショートカットの割り当て: 「変更」を押したあとに押したキーを記録する
	const startRecording = (action: ShortcutAction) => {
		recordingAction = action;
	};

	const resetShortcut = async (action: ShortcutAction) => {
		form.settings.shortcuts[action] = DEFAULT_SHORTCUTS[action];
		await form.save();
	};

	$effect(() => {
		if (!recordingAction) return;
		const action = recordingAction;
		const onKeydown = async (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				recordingAction = null;
				return;
			}
			const shortcut = eventToShortcut(e);
			if (!shortcut) return; // 修飾キーだけの間は待つ
			e.preventDefault();
			e.stopPropagation();
			form.settings.shortcuts[action] = shortcut;
			recordingAction = null;
			await form.save();
		};
		window.addEventListener('keydown', onKeydown, true);
		return () => window.removeEventListener('keydown', onKeydown, true);
	});

	const resetFormatting = () => {
		form.settings.editorFormatting = {
			fontSize: 16,
			lineHeight: 2,
			letterSpacing: 0,
			paragraphSpacing: 16
		};
		form.save();
	};

	// 執筆画面のツールバー: ボタンの並び順と、常時表示するボタン/三点メニュー(…)にまとめるボタン
	const desktop = isDesktop();
	// 有効で、このプラットフォームに対応する拡張の項目(無効な拡張の項目は一覧に出さない)
	const extensionItems = $derived<ToolbarItem[]>(
		extensionHost.toolbarItems.map((e) => ({ id: e.itemId, label: e.label, icon: e.icon }))
	);
	const allItems = $derived(orderedItems(settingsStore.toolbarOrder, { desktop }, extensionItems));
	// AI パネルのボタンは並べ替えの対象外(右端側に固定)
	const sortableItems = $derived(allItems.filter((i) => i.id !== FIXED_LAST_ID));
	const fixedItem = $derived(allItems.find((i) => i.id === FIXED_LAST_ID));
	const pinnedIds = $derived(
		new Set(
			splitToolbar(
				settingsStore.toolbarMenuItems,
				{ desktop },
				{ order: settingsStore.toolbarOrder, extensions: extensionItems }
			).pinned.map((i) => i.id)
		)
	);

	async function saveToolbar(changes: { toolbarMenuItems?: string[]; toolbarOrder?: string[] }) {
		try {
			await settingsDB.update(changes);
		} catch (error) {
			console.error('Failed to save toolbar settings:', error);
		}
	}

	async function setPinned(id: string, pinned: boolean) {
		const next = setInMenu(settingsStore.toolbarMenuItems, id, !pinned);
		settingsStore.toolbarMenuItems = next;
		await saveToolbar({ toolbarMenuItems: next });
	}

	async function moveToolbarItem(id: string, toIndex: number) {
		const next = reorderStored(
			settingsStore.toolbarOrder,
			id,
			toIndex,
			{ desktop },
			extensionItems
		);
		settingsStore.toolbarOrder = next;
		await saveToolbar({ toolbarOrder: next });
	}

	async function resetToolbar() {
		settingsStore.toolbarMenuItems = [];
		settingsStore.toolbarOrder = [];
		await saveToolbar({ toolbarMenuItems: [], toolbarOrder: [] });
	}
</script>

<!-- エディタ(自動保存) -->
<SettingsCard title="保存と入力" description="本文の保存のしかたを設定します。">
	<SettingsRow
		label="自動保存を有効にする"
		description="入力が止まって約2秒後に保存します。オフにすると、Ctrl+S や「今すぐ保存」で保存します。"
		labelFor="autoSave"
	>
		<input
			id="autoSave"
			type="checkbox"
			checked={form.settings.autoSave}
			onchange={handleAutoSaveToggle}
		/>
	</SettingsRow>

	{#if form.settings.autoSave}
		<SettingsRow
			label="最大の待ち時間(秒)"
			description="入力し続けているときに、保存せずに待つ最大の時間です(5 〜 300 秒)。"
			labelFor="autoSaveSeconds"
		>
			<input
				id="autoSaveSeconds"
				type="number"
				min="5"
				max="300"
				step="5"
				bind:value={form.autoSaveSeconds}
				onchange={handleAutoSaveSeconds}
				class="w:8rem px:.75rem py:.5rem b:1px|solid|theme-border r:8px bg:theme-background fg:theme-text"
			/>
		</SettingsRow>
	{/if}

	{#if !isDesktop()}
		<SettingsRow
			label="サイトを開いたとき、自動でエディタを開く"
			description="Web 版の機能です。紹介サイトのトップを開いたときに、この画面を経由せずエディタへ移動します。"
			labelFor="autoOpenFromSite"
		>
			<input
				id="autoOpenFromSite"
				type="checkbox"
				checked={autoOpenFromSite}
				onchange={(e) => {
					autoOpenFromSite = e.currentTarget.checked;
					setAutoOpen(autoOpenFromSite);
				}}
			/>
		</SettingsRow>
	{/if}
</SettingsCard>

<!-- 書式設定 -->
<SettingsCard title="書式" description="エディタのテキスト表示形式を一括で調整できます。">
	<SettingsRow
		stacked
		label="フォントサイズ"
		labelFor="fontSize"
		value="{form.settings.editorFormatting.fontSize}px"
		description="小 (12px) 〜 大 (24px)"
	>
		<input
			id="fontSize"
			type="range"
			bind:value={form.settings.editorFormatting.fontSize}
			onchange={form.save}
			min="12"
			max="24"
			step="1"
			class="w:full"
		/>
	</SettingsRow>

	<SettingsRow
		stacked
		label="行間"
		labelFor="lineHeight"
		value={form.settings.editorFormatting.lineHeight.toFixed(1)}
		description="狭い (1.0) 〜 広い (3.0)"
	>
		<input
			id="lineHeight"
			type="range"
			bind:value={form.settings.editorFormatting.lineHeight}
			onchange={form.save}
			min="1.0"
			max="3.0"
			step="0.1"
			class="w:full"
		/>
	</SettingsRow>

	<SettingsRow
		stacked
		label="字間"
		labelFor="letterSpacing"
		value="{form.settings.editorFormatting.letterSpacing.toFixed(2)}em"
		description="狭い (-0.05em) 〜 広い (0.2em)"
	>
		<input
			id="letterSpacing"
			type="range"
			bind:value={form.settings.editorFormatting.letterSpacing}
			onchange={form.save}
			min="-0.05"
			max="0.2"
			step="0.01"
			class="w:full"
		/>
	</SettingsRow>

	<SettingsRow
		stacked
		label="段落間隔"
		labelFor="paragraphSpacing"
		value="{form.settings.editorFormatting.paragraphSpacing}px"
		description="なし (0px) 〜 広い (48px)"
	>
		<input
			id="paragraphSpacing"
			type="range"
			bind:value={form.settings.editorFormatting.paragraphSpacing}
			onchange={form.save}
			min="0"
			max="48"
			step="4"
			class="w:full"
		/>
	</SettingsRow>

	<!-- プレビュー -->
	<div class="p:1rem b:1px|solid|theme-border r:8px bg:theme-surface mt:8">
		<p class="font:.75rem fg:theme-text-secondary mb:.5rem">プレビュー</p>
		<div
			class="fg:theme-text"
			style="
			font-size: {form.settings.editorFormatting.fontSize}px;
			line-height: {form.settings.editorFormatting.lineHeight};
			letter-spacing: {form.settings.editorFormatting.letterSpacing}em;
		"
		>
			<p style="margin-bottom: {form.settings.editorFormatting.paragraphSpacing}px;">
				吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。
			</p>
			<p>何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。</p>
		</div>
	</div>

	<!-- リセットボタン -->
	<div class="mt:16">
		<Button onclick={resetFormatting} variant="secondary" class="w:fit">デフォルトに戻す</Button>
	</div>
</SettingsCard>

<!-- ツールバー -->
<SettingsCard
	title="ツールバー"
	description="執筆画面の上部のボタンの並び順と、常に表示するか三点メニュー(…)にまとめるかを選びます。ハンドルをドラッグするか、ハンドルで Space を押して↑↓キーで並べ替えます。有効にした拡張機能のボタンも並びます。スマホの上部バーには影響しません。"
	data-tour="settings-toolbar"
>
	<SortableList
		items={sortableItems}
		label="ツールバーのボタンの並び"
		titleOf={(i) => i.label}
		onmove={(id, toIndex) => void moveToolbarItem(id, toIndex)}
		class="toolbar-list"
	>
		{#snippet item(it)}
			{@render toolbarRow(it)}
		{/snippet}
	</SortableList>
	{#if fixedItem}
		<div class="toolbar-fixed">
			{@render toolbarRow(fixedItem)}
			<p class="toolbar-fixed-note">AI パネルのボタンは、並べ替えずに右端側に固定されます。</p>
		</div>
	{/if}
	<SettingsRow
		label="既定に戻す"
		description="ボタンの並びを既定の順に戻し、すべてのボタンをツールバーに表示します。"
	>
		<Button
			variant="secondary"
			size="sm"
			disabled={settingsStore.toolbarMenuItems.length === 0 &&
				settingsStore.toolbarOrder.length === 0}
			onclick={() => void resetToolbar()}>既定に戻す</Button
		>
	</SettingsRow>
</SettingsCard>

{#snippet toolbarRow(item: ToolbarItem)}
	<div class="toolbar-row">
		<Icon name={item.icon} class="toolbar-row-icon" />
		<span class="toolbar-row-label">{item.label}</span>
		<label class="toolbar-row-pin">
			<input
				id={`toolbar-item-${item.id}`}
				type="checkbox"
				checked={pinnedIds.has(item.id)}
				aria-label={`${item.label}をツールバーに常時表示する`}
				onchange={(e) => void setPinned(item.id, e.currentTarget.checked)}
			/>
			<span>{pinnedIds.has(item.id) ? '常時表示' : '三点メニュー'}</span>
		</label>
	</div>
{/snippet}

<!-- ショートカットキー -->
<SettingsCard
	title="ショートカットキー"
	description="「変更」を押してからキーを押すと割り当てられます(Ctrl または Alt と組み合わせてください)。Mac では Cmd が Ctrl として扱われます。"
>
	{#each Object.entries(form.settings.shortcuts) as [name, key] (name)}
		{@const action = name as ShortcutAction}
		{@const fixed = FIXED_SHORTCUTS.includes(action)}
		<SettingsRow label={SHORTCUT_LABELS[action]}>
			<kbd class="shortcut-key" class:recording={recordingAction === action}>
				{recordingAction === action ? 'キーを押してください…' : key}
			</kbd>
			{#if fixed}
				<span class="fg:theme-text-secondary font:.75rem">固定</span>
			{:else}
				<button class="link-btn" onclick={() => startRecording(action)}>変更</button>
				{#if key !== DEFAULT_SHORTCUTS[action]}
					<button class="link-btn" onclick={() => resetShortcut(action)}>初期値</button>
				{/if}
			{/if}
		</SettingsRow>
	{/each}

	{#each conflicts as group (group.join())}
		<p class="fg:theme-warning font:.875rem mt:12" role="alert">
			{group.map((a) => SHORTCUT_LABELS[a]).join('・')} に同じキーが割り当てられています。
		</p>
	{/each}
</SettingsCard>

<!-- Phase 2: 通知設定 -->
<SettingsCard
	title="通知とリマインダー"
	description="執筆目標とリマインダーの通知を設定します(プロジェクトごと)。"
>
	{#if currentProjectStore.project}
		<NotificationSettings projectId={currentProjectStore.project.id} />
	{:else}
		<p class="fg:theme-text-secondary">プロジェクトを開いて通知を設定してください</p>
	{/if}
</SettingsCard>

<style>
	:global(.toolbar-list) {
		--sortable-gap: 2px;
		padding-top: 8px;
	}

	.toolbar-row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		padding: 0 4px;
		font-size: 14px;
	}

	.toolbar-row :global(.toolbar-row-icon) {
		display: flex;
		flex: none;
		width: 18px;
		height: 18px;
		color: var(--color-text-secondary);
	}

	.toolbar-row :global(.toolbar-row-icon svg) {
		width: 100%;
		height: 100%;
	}

	.toolbar-row-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toolbar-row-pin {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	/* 並べ替えの対象外の行は、ハンドルの分だけ字下げして一覧にそろえる */
	.toolbar-fixed {
		padding: 4px 0 8px 32px;
		border-top: 1px solid var(--color-border);
		margin-top: 8px;
	}

	.toolbar-fixed-note {
		margin: 0;
		padding-left: 4px;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.shortcut-key {
		padding: 2px 8px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface);
		font-family: inherit;
		font-size: 13px;
	}

	.shortcut-key.recording {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.link-btn {
		border: none;
		background: transparent;
		padding: 4px 6px;
		font-size: 13px;
		color: var(--color-primary);
		cursor: pointer;
	}
</style>
