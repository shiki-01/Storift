<script lang="ts">
	// スクリプト拡張の画面(宣言的な UI 記述)の描画。拡張は DOM やスタイルに触れず、ホストがここで描画する。
	// 文字はすべてテキストとして描画する({@html} は使わない)。リンクは https の URL のみで、押すと確認してから開く
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import type { UiEventKind, UiNode } from '$lib/extensions/script/ui';
	import { confirmDialog } from '$lib/stores/toast.svelte';

	interface Props {
		nodes: UiNode[];
		/** 操作(ボタンを押した・値を変えた)。値は toggle=boolean、input / select=string */
		onevent: (id: string, kind: UiEventKind, value?: string | boolean) => void;
	}

	let { nodes, onevent }: Props = $props();

	const uid = $props.id();

	// 入力欄は、確定(フォーカスが外れる・Enter)するまでの入力を手元に持つ。記述が更新されたら捨てる
	let drafts = $state<Record<string, string>>({});
	$effect(() => {
		void nodes;
		drafts = {};
	});

	async function openLink(url: string) {
		const host = new URL(url).hostname;
		const ok = await confirmDialog({
			title: '外部サイトを開きます',
			message: `拡張機能が指定したリンクです。内容は確認されていません。\n${host}\n\n${url}`,
			confirmText: '開く'
		});
		if (!ok) return;
		if (isDesktop()) {
			const { openUrl } = await import('@tauri-apps/plugin-opener');
			await openUrl(url);
		} else {
			window.open(url, '_blank', 'noopener,noreferrer');
		}
	}
</script>

<div class="ui" data-testid="script-ui">
	{#each nodes as node, i (i)}
		{#if node.type === 'heading'}
			<h5 class="heading">{node.text}</h5>
		{:else if node.type === 'text'}
			<p class="text" data-tone={node.tone}>{node.text}</p>
		{:else if node.type === 'button'}
			<div class="row">
				<Button
					variant={node.variant}
					size="sm"
					disabled={node.disabled}
					data-testid={`script-btn-${node.id}`}
					onclick={() => onevent(node.id, 'press')}>{node.label}</Button
				>
			</div>
		{:else if node.type === 'toggle'}
			<div class="field toggle">
				<div class="field-text">
					<span id={`${uid}-${node.id}`} class="label">{node.label}</span>
					{#if node.description}<span class="hint">{node.description}</span>{/if}
				</div>
				<Switch
					checked={node.value}
					disabled={node.disabled}
					aria-labelledby={`${uid}-${node.id}`}
					onchange={(v) => onevent(node.id, 'change', v)}
				/>
			</div>
		{:else if node.type === 'input'}
			<div class="field">
				<label class="label" for={`${uid}-${node.id}`}>{node.label}</label>
				<input
					id={`${uid}-${node.id}`}
					class="input"
					type={node.secret ? 'password' : 'text'}
					autocomplete="off"
					spellcheck="false"
					placeholder={node.placeholder}
					disabled={node.disabled}
					value={drafts[node.id] ?? node.value}
					oninput={(e) => (drafts[node.id] = e.currentTarget.value)}
					onchange={(e) => onevent(node.id, 'change', e.currentTarget.value)}
					data-testid={`script-input-${node.id}`}
				/>
				{#if node.description}<span class="hint">{node.description}</span>{/if}
			</div>
		{:else if node.type === 'select'}
			<div class="field">
				<label class="label" for={`${uid}-${node.id}`}>{node.label}</label>
				<Select
					id={`${uid}-${node.id}`}
					options={node.options}
					value={node.value}
					disabled={node.disabled}
					onchange={(v) => onevent(node.id, 'change', v)}
				/>
				{#if node.description}<span class="hint">{node.description}</span>{/if}
			</div>
		{:else if node.type === 'list'}
			<ul class="list">
				{#each node.items as item, j (j)}
					<li>
						<span>{item.text}</span>
						{#if item.detail}<span class="detail">{item.detail}</span>{/if}
					</li>
				{/each}
			</ul>
		{:else if node.type === 'progress'}
			<div class="progress">
				{#if node.label}<span class="label">{node.label}</span>{/if}
				<div
					class="track"
					role="progressbar"
					aria-label={node.label || '進捗'}
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round(node.value * 100)}
				>
					<div class="fill" style={`width: ${node.value * 100}%`}></div>
				</div>
			</div>
		{:else if node.type === 'divider'}
			<hr class="divider" />
		{:else if node.type === 'link'}
			<div class="row">
				<button
					type="button"
					class="link"
					data-testid="script-link"
					onclick={() => void openLink(node.url)}
				>
					<span>{node.label}</span>
					<Icon name="external-link" class="link-ico" />
				</button>
			</div>
		{/if}
	{/each}
</div>

<style>
	.ui {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text);
	}

	.heading {
		margin: 4px 0 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.text {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.text[data-tone='muted'] {
		font-size: 12.5px;
		color: var(--color-text-secondary);
	}

	.text[data-tone='warning'] {
		padding: 8px 10px;
		border: 1px solid color-mix(in srgb, var(--color-warning) 50%, var(--color-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-warning) 9%, var(--color-background));
	}

	.text[data-tone='error'] {
		color: var(--color-error);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.field.toggle {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.field-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.label {
		font-size: 13px;
		font-weight: 500;
	}

	.hint {
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.input {
		width: 100%;
		min-width: 0;
		height: 36px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 13px;
	}

	.input:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.input:disabled {
		opacity: 0.55;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		overflow: hidden;
	}

	.list li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 10px;
		overflow-wrap: anywhere;
	}

	.list li + li {
		border-top: 1px solid var(--color-border);
	}

	.detail {
		flex: none;
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.progress {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.track {
		height: 8px;
		border-radius: 999px;
		background: var(--color-border);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		border-radius: 999px;
		background: var(--color-primary);
		transition: width 0.3s;
	}

	.divider {
		width: 100%;
		margin: 0;
		border: 0;
		border-top: 1px solid var(--color-border);
	}

	.link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 32px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-primary);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
		text-align: left;
	}

	:global(:root[data-scheme='dark']) .link {
		color: color-mix(in srgb, var(--color-primary) 70%, var(--color-text));
	}

	.link :global(.link-ico) {
		width: 14px;
		height: 14px;
		flex: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.fill {
			transition: none;
		}
	}
</style>
