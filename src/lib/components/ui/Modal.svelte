<script lang="ts">
	interface ModalProps {
		isOpen?: boolean;
		title?: string;
		onClose?: () => void;
		onConfirm?: () => void;
		confirmText?: string;
		confirmDisabled?: boolean;
		confirmVariant?: 'primary' | 'secondary' | 'danger';
		cancelText?: string;
		size?: 'small' | 'medium' | 'large';
		children?: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	}

	let {
		isOpen = $bindable(false),
		title = '',
		onClose,
		onConfirm,
		confirmText = '確認',
		confirmDisabled = false,
		confirmVariant = 'primary',
		cancelText = 'キャンセル',
		size = 'medium',
		children,
		footer
	}: ModalProps = $props();

	const sizeClasses = {
		small: 'max-w:400',
		medium: 'max-w:600',
		large: 'max-w:800'
	};

	const handleClose = () => {
		isOpen = false;
		onClose?.();
	};

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			handleClose();
		}
	}
	let dialogEl = $state<HTMLDivElement | null>(null);
	let previousFocus: HTMLElement | null = null;
	const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

	const FOCUSABLE =
		'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

	// 開いたときに入力欄（なければ最初の操作要素）へフォーカスし、閉じたら元に戻す
	$effect(() => {
		if (isOpen && dialogEl) {
			previousFocus = document.activeElement as HTMLElement | null;
			const body = dialogEl.querySelector<HTMLElement>(
				'.modal-body input, .modal-body textarea, .modal-body select'
			);
			(body ?? dialogEl.querySelector<HTMLElement>(FOCUSABLE) ?? dialogEl).focus();
			return () => {
				previousFocus?.focus?.();
			};
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (!isOpen) return;
		if (e.key === 'Escape') {
			e.stopPropagation();
			handleClose();
			return;
		}
		if (e.key === 'Tab' && dialogEl) {
			const items = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE));
			if (items.length === 0) {
				e.preventDefault();
				return;
			}
			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement;
			if (e.shiftKey && (active === first || !dialogEl.contains(active))) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && (active === last || !dialogEl.contains(active))) {
				e.preventDefault();
				first.focus();
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<div
		class="position:fixed inset:0 bg:rgba(0,0,0,0.5) z:1000 flex align-items:center justify-content:center"
		onclick={handleBackdropClick}
		role="presentation"
	>
		<div
			bind:this={dialogEl}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			tabindex="-1"
			class="modal-container bg:theme-background fg:theme-text b:2|solid|theme-text r:12 {sizeClasses[
				size
			]} w:90% max-h:90vh overflow:auto outline:none"
		>
			<div
				class="modal-header flex justify-content:space-between align-items:center p:24 border-bottom:1|solid|theme-border"
			>
				<h2 id={titleId} class="font:20 font-weight:600 m:0">{title}</h2>
				<button
					class="bg:transparent border:none font:24 cursor:pointer p:8 fg:theme-text-secondary fg:theme-text:hover"
					onclick={handleClose}
					aria-label="閉じる"
				>
					×
				</button>
			</div>
			<div class="modal-body p:24">
				{#if children}
					{@render children()}
				{/if}
			</div>
			{#if footer}
				<div class="modal-footer p:24 pt:0">
					{@render footer()}
				</div>
			{:else if onConfirm}
				<div class="modal-footer p:24 pt:0 flex gap:12 justify-content:flex-end">
					<button
						class="px:16 py:8 b:1|solid|theme-border r:6 bg:theme-background fg:theme-text cursor:pointer bg:theme-surface:hover"
						onclick={handleClose}
					>
						{cancelText}
					</button>
					<button
						class="px:16 py:8 b:none r:6 cursor:pointer"
						class:bg:theme-primary={confirmVariant === 'primary'}
						class:bg:theme-text={confirmVariant === 'secondary'}
						class:bg:theme-error={confirmVariant === 'danger'}
						style="color: var(--color-background)"
						class:opacity:0.5={confirmDisabled}
						class:cursor:not-allowed={confirmDisabled}
						onclick={onConfirm}
						disabled={confirmDisabled}
					>
						{confirmText}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	@media (max-width: 768px) {
		.modal-container {
			width: 100%;
			max-width: none;
			max-height: 100vh;
			height: 100%;
			border-radius: 0;
		}

		.modal-header,
		.modal-body,
		.modal-footer {
			padding: 16px;
		}
	}
</style>
