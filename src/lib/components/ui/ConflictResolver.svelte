<script lang="ts" generics="T">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import type { ConflictData } from '$lib/firebase/conflict';
	import { formatDate } from '$lib/utils/dateUtils';

	interface ConflictResolverProps<T> {
		isOpen?: boolean;
		conflictData?: ConflictData<T>;
		onResolve?: (resolution: 'local' | 'remote') => void;
		onClose?: () => void;
	}

	let {
		isOpen = $bindable(false),
		conflictData,
		onResolve,
		onClose
	}: ConflictResolverProps<T> = $props();

	function handleResolve(resolution: 'local' | 'remote') {
		onResolve?.(resolution);
		isOpen = false;
	}

	// 競合の対象は呼び出し側のエンティティ型のため、表示に使うキーだけをここで読む
	function updatedAtOf(entity: T): number | undefined {
		return (entity as { updatedAt?: number }).updatedAt;
	}

	function fieldOf(entity: T, key: string): unknown {
		return (entity as Record<string, unknown>)[key];
	}
</script>

{#if conflictData}
	{@const localUpdatedAt = updatedAtOf(conflictData.local)}
	{@const remoteUpdatedAt = updatedAtOf(conflictData.remote)}
	<Modal bind:isOpen title="変更の競合" {onClose}>
		<div class="mb:24">
			<p class="fg:theme-text-secondary mb:16">
				このデータが複数の端末で変更されています。どちらのバージョンを採用しますか?
			</p>

			<div class="display:grid grid-template-columns:1fr|1fr gap:16">
				<!-- ローカル版 -->
				<div class="border:1|solid|theme-border r:8 p:16">
					<h3 class="font:16 font-weight:600 mb:12 fg:theme-primary">この端末の変更</h3>
					{#if localUpdatedAt}
						<p class="font:12 fg:theme-text-secondary mb:12">
							更新: {formatDate(localUpdatedAt)}
						</p>
					{/if}
					<div class="bg:theme-surface p:12 r:6 max-h:300 overflow-y:auto">
						{#each conflictData.conflictFields as field (field)}
							<div class="mb:12">
								<div class="font:12 font-weight:600 fg:theme-text-secondary mb:4">{field}:</div>
								<div class="font:13 fg:theme-text white-space:pre-wrap">
									{JSON.stringify(fieldOf(conflictData.local, field), null, 2)}
								</div>
							</div>
						{/each}
					</div>
					<Button onclick={() => handleResolve('local')} variant="primary" class="w:full mt:12">
						この端末の変更を採用
					</Button>
				</div>

				<!-- リモート版 -->
				<div class="border:1|solid|theme-border r:8 p:16">
					<h3 class="font:16 font-weight:600 mb:12 fg:theme-success">他の端末の変更</h3>
					{#if remoteUpdatedAt}
						<p class="font:12 fg:theme-text-secondary mb:12">
							更新: {formatDate(remoteUpdatedAt)}
						</p>
					{/if}
					<div class="bg:theme-surface p:12 r:6 max-h:300 overflow-y:auto">
						{#each conflictData.conflictFields as field (field)}
							<div class="mb:12">
								<div class="font:12 font-weight:600 fg:theme-text-secondary mb:4">{field}:</div>
								<div class="font:13 fg:theme-text white-space:pre-wrap">
									{JSON.stringify(fieldOf(conflictData.remote, field), null, 2)}
								</div>
							</div>
						{/each}
					</div>
					<Button onclick={() => handleResolve('remote')} variant="secondary" class="w:full mt:12">
						他の端末の変更を採用
					</Button>
				</div>
			</div>

			<div class="mt:16 p:12 bg:theme-surface border:1|solid|theme-warning r:6">
				<p class="font:12 fg:theme-warning">
					⚠️
					採用しなかった変更は失われます。重要な内容がある場合は、事前にコピーしておいてください。
				</p>
			</div>
		</div>
	</Modal>
{/if}
