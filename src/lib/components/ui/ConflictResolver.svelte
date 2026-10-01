<script lang="ts">
	import Modal from './Modal.svelte';
	import type { ConflictData } from '$lib/firebase/conflict';
	import { formatDate } from '$lib/utils/dateUtils';

	interface ConflictResolverProps<T> {
		isOpen?: boolean;
		conflictData?: ConflictData<T>;
		/** 対象の名前（作品名・章タイトルなど） */
		label?: string;
		/** 対象の種類（「シーン」など） */
		typeLabel?: string;
		/** 複数ある場合の進捗表示（例: "1 / 3"） */
		position?: string;
		/** 解決後にモーダルを閉じるか（複数の競合を順に解決するときは false） */
		closeOnResolve?: boolean;
		onResolve?: (resolution: 'local' | 'remote') => void;
		onClose?: () => void;
	}

	let {
		isOpen = $bindable(false),
		conflictData,
		label = '',
		typeLabel = '',
		position = '',
		closeOnResolve = true,
		onResolve,
		onClose
	}: ConflictResolverProps<any> = $props();

	function handleResolve(resolution: 'local' | 'remote') {
		onResolve?.(resolution);
		if (closeOnResolve) isOpen = false;
	}

	function formatValue(value: unknown): string {
		if (value === undefined || value === null || value === '') return '（空）';
		return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
	}

	const sides = [
		{ key: 'local', title: 'この端末の変更', action: 'この端末の変更を採用' },
		{ key: 'remote', title: '他の端末の変更', action: '他の端末の変更を採用' }
	] as const;
</script>

{#if conflictData}
	<Modal
		bind:isOpen
		title={position ? `変更の競合 (${position})` : '変更の競合'}
		{onClose}
		size="large"
	>
		<div class="flex flex:column gap:16">
			<p class="m:0">
				{#if label}<strong>{typeLabel}「{label}」</strong
					>は{:else}このデータは{/if}複数の端末で変更されています。どちらのバージョンを採用しますか?
			</p>

			<div class="conflict-grid">
				{#each sides as side}
					{@const data = conflictData[side.key]}
					<div class="b:2|solid|theme-border r:8 p:16 flex flex:column gap:12">
						<h3 class="font:16 font-weight:600 m:0">{side.title}</h3>
						{#if data.updatedAt}
							<p class="font:12 fg:theme-text-secondary m:0">更新: {formatDate(data.updatedAt)}</p>
						{/if}
						<div class="bg:theme-surface b:1|solid|theme-border p:12 r:6 max-h:300 overflow-y:auto">
							{#each conflictData.conflictFields as field}
								<div class="mb:12">
									<div class="font:12 font-weight:600 fg:theme-text-secondary mb:4">{field}</div>
									<div class="font:13 white-space:pre-wrap word-break:break-all">
										{formatValue(data[field])}
									</div>
								</div>
							{/each}
						</div>
						<button
							type="button"
							class="px:16 py:8 r:6 b:2|solid|theme-text cursor:pointer font:14 {side.key ===
							'local'
								? 'bg:theme-text fg:theme-background'
								: 'bg:theme-background fg:theme-text'}"
							onclick={() => handleResolve(side.key)}
						>
							{side.action}
						</button>
					</div>
				{/each}
			</div>

			<div class="p:12 b:1|solid|theme-warning r:6">
				<p class="font:12 fg:theme-warning m:0">
					採用しなかった変更は失われます。重要な内容がある場合は、事前にコピーしておいてください。
				</p>
			</div>
		</div>
	</Modal>
{/if}

<style>
	.conflict-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	@media (max-width: 768px) {
		.conflict-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
