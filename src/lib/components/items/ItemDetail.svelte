<script lang="ts">
	/**
	 * 一覧の項目の詳細。既定は全文を読める閲覧ビューで、「編集」で同じ場所が編集フォームに切り替わる。
	 * フォームの値と「未保存の変更があるか」は親が持つ(別の項目へ移るときの確認に使うため)。
	 * 保存・キャンセル・削除の実処理も親が行う(保存は update + queueChange、閲覧専用の無効化は従来どおり)。
	 *
	 * - readOnly: 編集・削除のボタンを出さない(閲覧専用)。全文は読める。
	 * - creating: 新規作成。編集フォームだけを出し、キャンセルで閉じる。
	 */
	import type { Snippet } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		heading: string;
		editing: boolean;
		creating?: boolean;
		readOnly?: boolean;
		canSave?: boolean;
		saving?: boolean;
		/** 見出しの左(アバター・アイコン枠など) */
		lead?: Snippet;
		/** 見出しの下(種類・状態などのバッジ) */
		badges?: Snippet;
		/** 閲覧ビューの本体(ItemSection を並べる) */
		body: Snippet;
		/** 編集フォームの入力欄 */
		fields: Snippet;
		/** 閲覧ビューのヘッダーに足す操作 */
		actions?: Snippet;
		/** 閲覧ビューの下に足す内容(更新日など) */
		footnote?: Snippet;
		onedit: () => void;
		onsave: () => void;
		oncancel: () => void;
		ondelete?: () => void;
	}

	let {
		heading,
		editing,
		creating = false,
		readOnly = false,
		canSave = true,
		saving = false,
		lead,
		badges,
		body,
		fields,
		actions,
		footnote,
		onedit,
		onsave,
		oncancel,
		ondelete
	}: Props = $props();

	function onKeydown(e: KeyboardEvent) {
		if (!editing || e.isComposing) return;
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSave && !saving) {
			e.preventDefault();
			onsave();
		}
	}
</script>

<!-- フォーム内のキー操作(Ctrl/Cmd+Enter で保存)を受ける -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article class="detail" aria-label={heading} onkeydown={onKeydown}>
	<header class="head">
		{#if lead}<div class="lead">{@render lead()}</div>{/if}
		<div class="titles">
			{#if editing}
				<h2 class="title">{creating ? '新規作成' : `${heading || '無題'}を編集`}</h2>
			{:else}
				<h2 class="title">{heading || '無題'}</h2>
				{#if badges}<div class="badges">{@render badges()}</div>{/if}
			{/if}
		</div>
		{#if !editing && !readOnly}
			<div class="actions">
				{#if actions}{@render actions()}{/if}
				<Button variant="secondary" size="sm" onclick={onedit}>
					<Icon name="pencil" class="btn-ico" />編集
				</Button>
				{#if ondelete}
					<Button variant="ghost" size="sm" class="danger" onclick={ondelete}>
						<Icon name="trash" class="btn-ico" />削除
					</Button>
				{/if}
			</div>
		{/if}
	</header>

	{#if editing}
		<form
			class="form"
			onsubmit={(e) => {
				e.preventDefault();
				if (canSave && !saving) onsave();
			}}
		>
			<fieldset class="fields" disabled={readOnly || saving}>
				{@render fields()}
			</fieldset>
			<div class="footer">
				<Button variant="ghost" onclick={oncancel} disabled={saving}>キャンセル</Button>
				<Button type="submit" disabled={readOnly || !canSave || saving}>
					{creating ? '作成' : '保存'}
				</Button>
			</div>
		</form>
	{:else}
		<div class="view">
			{@render body()}
		</div>
		{#if footnote}<div class="foot">{@render footnote()}</div>{/if}
	{/if}
</article>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		gap: 20px;
		min-width: 0;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 12px 14px;
	}

	.lead {
		display: flex;
		flex: none;
	}

	.titles {
		display: flex;
		flex: 1 1 14rem;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	.title {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.4;
		letter-spacing: 0.02em;
		overflow-wrap: anywhere;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.actions {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.actions :global(.btn-ico) {
		display: inline-flex;
		width: 14px;
		height: 14px;
	}

	.actions :global(.btn-ico svg) {
		width: 100%;
		height: 100%;
	}

	.actions :global(.danger:hover:not(:disabled)) {
		color: var(--color-error);
	}

	.view {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.foot {
		padding-top: 14px;
		border-top: 1px solid var(--color-border);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.footer {
		position: sticky;
		bottom: 0;
		z-index: 1;
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin: 0 -4px -4px;
		padding: 12px 4px 4px;
		border-top: 1px solid var(--color-border);
		background: var(--color-background);
	}
</style>
