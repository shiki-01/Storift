<script lang="ts">
	import { confirmStore } from '$lib/stores/confirm.svelte';
	import Modal from './Modal.svelte';

	let isOpen = $state(false);
	const current = $derived(confirmStore.current);

	$effect(() => {
		isOpen = current !== null;
	});
</script>

<Modal
	bind:isOpen
	title={current?.title ?? '確認'}
	size="small"
	confirmText={current?.confirmText ?? 'OK'}
	cancelText={current?.cancelText ?? 'キャンセル'}
	confirmVariant={current?.danger ? 'danger' : 'primary'}
	onConfirm={() => confirmStore.answer(true)}
	onClose={() => confirmStore.answer(false)}
>
	<p class="m:0 white-space:pre-wrap">{current?.message}</p>
</Modal>
