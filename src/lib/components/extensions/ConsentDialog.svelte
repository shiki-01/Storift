<script lang="ts">
	// 拡張を有効にするときの確認画面。マニフェストの permissions / privacy から作った「扱う情報」を見せ、
	// 同意したときだけ有効にする(同意の記録は端末内。版や内容が変わったら、もう一度出す)
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import IconBadge from '$lib/components/items/IconBadge.svelte';
	import type { ExtensionManifest, ExtensionOrigin } from '$lib/extensions/manifest';
	import type { PackContent } from '$lib/extensions/pack';
	import PrivacyInfo from './PrivacyInfo.svelte';

	interface Props {
		open: boolean;
		manifest: ExtensionManifest;
		/** enable: 新しく有効にする / review: すでに有効で、内容の確認を求める */
		mode?: 'enable' | 'review';
		/** 変わった内容の説明(再同意のとき) */
		reason?: string;
		onconsent: () => void | Promise<void>;
		/** 出所(公式以外は、出所のラベルと注意を出す) */
		origin?: ExtensionOrigin;
		/** パックのコンテンツ */
		content?: PackContent;
	}

	let {
		open = $bindable(),
		manifest,
		mode = 'enable',
		reason,
		onconsent,
		origin = 'official',
		content
	}: Props = $props();

	const confirmText = $derived(mode === 'enable' ? '同意して有効にする' : '確認した');
</script>

<Modal
	bind:isOpen={open}
	title={mode === 'enable'
		? `「${manifest.name}」を有効にする`
		: `「${manifest.name}」の内容を確認`}
	size="medium"
>
	<div class="consent">
		<div class="head">
			<IconBadge size={40} shape="square" icon={manifest.icon} />
			<p>
				{#if reason}{reason}{:else if mode === 'enable'}この拡張は、次の情報を扱います。内容を確認して、よければ同意してください。同意は端末内に記録され、拡張の版や扱う情報が変わったときは、もう一度確認します。{:else}この拡張が扱う情報を確認してください。{/if}
			</p>
		</div>
		<!-- キーボードだけでも、長い内容をスクロールして読めるようにする -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="scroll" tabindex="0" role="region" aria-label="この拡張が扱う情報">
			<PrivacyInfo {manifest} {origin} {content} />
		</div>
	</div>
	{#snippet footer()}
		<!-- 内容が長くても、押す場所が常に見えるよう、下に貼り付ける -->
		<div class="foot">
			<Button variant="secondary" onclick={() => (open = false)}>キャンセル</Button>
			<Button
				data-testid="consent-confirm"
				onclick={() => {
					open = false;
					void onconsent();
				}}>{confirmText}</Button
			>
		</div>
	{/snippet}
</Modal>

<style>
	/* 内容が長くても、押す場所(下のボタン)が常に見えるよう、内容だけをスクロールさせる */
	.scroll {
		max-height: 48dvh;
		overflow-y: auto;
		padding-right: 4px;
		overscroll-behavior: contain;
	}

	.foot {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 8px;
	}

	.consent {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.head {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}

	.head p {
		margin: 0;
		font-size: 13px;
		line-height: 1.65;
		color: var(--color-text-secondary);
	}
</style>
