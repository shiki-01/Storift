<script lang="ts">
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
	}: ConflictResolverProps<any> = $props();

	function handleResolve(resolution: 'local' | 'remote') {
		onResolve?.(resolution);
		isOpen = false;
	}
</script>

{#if conflictData}
	<Modal bind:isOpen title="変更の競合" {onClose}>
		<div class="mb:24">
			<p class="fg:gray-700 mb:16">
				このデータが複数の端末で変更されています。どちらのバージョンを採用しますか?
			</p>

			<div class="display:grid grid-template-columns:1fr|1fr gap:16">
				<!-- ローカル版 -->
				<div class="border:1|solid|gray-300 r:8 p:16">
					<h3 class="font:16 font-weight:600 mb:12 fg:blue-700">この端末の変更</h3>
					{#if conflictData.local.updatedAt}
						<p class="font:12 fg:gray-600 mb:12">
							更新: {formatDate(conflictData.local.updatedAt)}
						</p>
					{/if}
					<div class="bg:gray-50 p:12 r:6 max-h:300 overflow-y:auto">
						{#each conflictData.conflictFields as field}
							<div class="mb:12">
								<div class="font:12 font-weight:600 fg:gray-700 mb:4">{field}:</div>
								<div class="font:13 fg:gray-900 white-space:pre-wrap">
									{JSON.stringify(conflictData.local[field], null, 2)}
								</div>
							</div>
						{/each}
					</div>
					<Button onclick={() => handleResolve('local')} variant="primary" class="w:full mt:12">
						この端末の変更を採用
					</Button>
				</div>

				<!-- リモート版 -->
				<div class="border:1|solid|gray-300 r:8 p:16">
					<h3 class="font:16 font-weight:600 mb:12 fg:green-700">他の端末の変更</h3>
					{#if conflictData.remote.updatedAt}
						<p class="font:12 fg:gray-600 mb:12">
							更新: {formatDate(conflictData.remote.updatedAt)}
						</p>
					{/if}
					<div class="bg:gray-50 p:12 r:6 max-h:300 overflow-y:auto">
						{#each conflictData.conflictFields as field}
							<div class="mb:12">
								<div class="font:12 font-weight:600 fg:gray-700 mb:4">{field}:</div>
								<div class="font:13 fg:gray-900 white-space:pre-wrap">
									{JSON.stringify(conflictData.remote[field], null, 2)}
								</div>
							</div>
						{/each}
					</div>
					<Button onclick={() => handleResolve('remote')} variant="secondary" class="w:full mt:12">
						他の端末の変更を採用
					</Button>
				</div>
			</div>

			<div class="mt:16 p:12 bg:yellow-50 border:1|solid|yellow-300 r:6">
				<p class="font:12 fg:yellow-900">
					⚠️
					採用しなかった変更は失われます。重要な内容がある場合は、事前にコピーしておいてください。
				</p>
			</div>
		</div>
	</Modal>
{/if}
