<script lang="ts">
	import { tick } from 'svelte';
	import { toast, toastStore, confirmStore } from '$lib/stores/toast.svelte';

	let confirmEl = $state<HTMLDivElement | null>(null);
	let cancelBtn = $state<HTMLButtonElement | null>(null);
	let okBtn = $state<HTMLButtonElement | null>(null);
	let returnFocusTo: HTMLElement | null = null;

	let pending = $derived(confirmStore.pending);

	$effect(() => {
		if (pending) {
			returnFocusTo = document.activeElement as HTMLElement | null;
			void tick().then(() => (pending?.danger ? cancelBtn : okBtn)?.focus());
		} else if (returnFocusTo) {
			if (!returnFocusTo.isContentEditable) returnFocusTo.focus?.({ preventScroll: true });
			returnFocusTo = null;
		}
	});

	function onKeydown(e: KeyboardEvent) {
		if (!pending) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			confirmStore.answer(false);
		} else if (e.key === 'Tab') {
			// フォーカスをダイアログ内に閉じ込める
			const buttons = [cancelBtn, okBtn].filter(Boolean) as HTMLButtonElement[];
			const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
			e.preventDefault();
			buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="toasts" aria-live="polite">
	{#each toastStore.items as item (item.id)}
		<div class="toast {item.kind}" role={item.kind === 'error' ? 'alert' : 'status'}>
			<span class="dot" aria-hidden="true"></span>
			<span class="message">{item.message}</span>
			{#if item.action}
				<button
					class="action"
					onclick={() => {
						item.action?.onClick();
						toast.dismiss(item.id);
					}}
				>
					{item.action.label}
				</button>
			{/if}
			<button class="close" aria-label="閉じる" onclick={() => toast.dismiss(item.id)}>×</button>
		</div>
	{/each}
</div>

{#if pending}
	<div class="overlay" role="presentation">
		<button
			class="backdrop"
			aria-label="キャンセル"
			tabindex="-1"
			onclick={() => confirmStore.answer(false)}
		></button>
		<div
			bind:this={confirmEl}
			class="dialog"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
			aria-describedby="confirm-message"
		>
			<h2 id="confirm-title">{pending.title ?? (pending.danger ? '削除の確認' : '確認')}</h2>
			<p id="confirm-message">{pending.message}</p>
			<div class="buttons">
				<button bind:this={cancelBtn} class="cancel" onclick={() => confirmStore.answer(false)}>
					{pending.cancelText ?? 'キャンセル'}
				</button>
				<button
					bind:this={okBtn}
					class="ok"
					class:danger={pending.danger}
					onclick={() => confirmStore.answer(true)}
				>
					{pending.confirmText ?? (pending.danger ? '削除' : 'OK')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.toasts {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--safe-bottom) + 16px);
		z-index: 1100;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		pointer-events: none;
	}

	/* スマホの下部タブ(プロジェクト内)と重ならないように持ち上げる */
	@media (max-width: 768px) {
		.toasts {
			bottom: calc(var(--safe-bottom) + var(--bottom-nav-height) + 12px);
		}
	}

	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: min(480px, 100%);
		padding: 10px 12px 10px 14px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: var(--shadow-float);
		font-size: 14px;
		animation: toast-in 0.2s ease-out;
	}

	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-info);
	}

	.toast.success .dot {
		background: var(--color-success);
	}

	.toast.error .dot {
		background: var(--color-error);
	}

	.message {
		flex: 1;
		min-width: 0;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.action {
		flex: none;
		padding: 4px 8px;
		border: none;
		background: transparent;
		color: var(--color-primary);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.close {
		flex: none;
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
	}

	.overlay {
		position: fixed;
		inset: 0;
		z-index: 1200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.backdrop {
		position: absolute;
		inset: 0;
		border: none;
		background: rgba(0, 0, 0, 0.45);
	}

	.dialog {
		position: relative;
		width: min(360px, 100%);
		padding: 20px;
		border: 1px solid var(--color-border);
		border-radius: 16px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: var(--shadow-float);
		animation: toast-in 0.18s ease-out;
	}

	.dialog h2 {
		margin: 0 0 8px;
		font-size: 16px;
		font-weight: 600;
	}

	.dialog p {
		margin: 0 0 20px;
		font-size: 14px;
		line-height: 1.7;
		color: var(--color-text-secondary);
		white-space: pre-wrap;
	}

	.buttons {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	.buttons button {
		min-width: 88px;
		height: 40px;
		padding: 0 16px;
		border-radius: 10px;
		font-size: 14px;
		cursor: pointer;
	}

	.cancel {
		border: 1px solid var(--color-border);
		background: var(--color-background);
		color: var(--color-text);
	}

	.ok {
		border: none;
		background: var(--color-primary);
		color: var(--color-background);
		font-weight: 600;
	}

	.ok.danger {
		background: var(--color-error);
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toast,
		.dialog {
			animation: none;
		}
	}
</style>
