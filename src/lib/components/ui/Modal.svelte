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

	let dialogEl = $state<HTMLDivElement | null>(null);
	let returnFocusTo: HTMLElement | null = null;

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	// 開いたら入力欄(なければ最初の操作要素)へフォーカスし、閉じたら元の位置へ戻す
	$effect(() => {
		if (!isOpen) return;
		returnFocusTo = document.activeElement as HTMLElement | null;
		const frame = requestAnimationFrame(() => {
			const body = dialogEl?.querySelector<HTMLElement>('.modal-body');
			const target =
				body?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select') ??
				dialogEl?.querySelector<HTMLElement>(FOCUSABLE);
			target?.focus({ preventScroll: true });
		});
		return () => {
			cancelAnimationFrame(frame);
			if (returnFocusTo && !returnFocusTo.isContentEditable) {
				returnFocusTo.focus?.({ preventScroll: true });
			}
		};
	});

	// Tab でダイアログの外へ出ないようにし、フォーカスがどこにあっても Esc で閉じる
	$effect(() => {
		if (!isOpen) return;
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				// IME変換中のEscape(変換キャンセル)では閉じない
				if (e.isComposing || e.keyCode === 229) return;
				// 前面にあるダイアログ(確認ダイアログなど)が先に処理する
				if (document.querySelector('[role="alertdialog"]')) return;
				e.preventDefault();
				handleClose();
				return;
			}
			if (e.key !== 'Tab' || !dialogEl) return;
			const items = [...dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
				(el) => el.offsetParent !== null
			);
			if (items.length === 0) return;
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
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	const handleClose = () => {
		isOpen = false;
		onClose?.();
	};

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			handleClose();
		}
	}
</script>

{#if isOpen}
	<!-- キーボード操作(Esc)は window 側で処理している -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="position:fixed inset:0 bg:rgba(0,0,0,0.5) z:1000 flex align-items:center justify-content:center"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
	>
		<div
			bind:this={dialogEl}
			class="modal-container bg:theme-background fg:theme-text r:12 {sizeClasses[
				size
			]} w:90% max-h:90dvh overflow:auto box-shadow:0|8|32|rgba(0,0,0,0.2)"
		>
			<div
				class="modal-header flex justify-content:space-between align-items:center p:24 border-bottom:1|solid|theme-border"
			>
				<h2 class="font:20 font-weight:600 m:0">{title}</h2>
				<button
					class="bg:transparent border:none font:24 cursor:pointer p:8 fg:theme-text-secondary hover:fg:theme-text"
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
						class="px:16 py:8 border:1|solid|theme-border r:6 bg:theme-background fg:theme-text cursor:pointer hover:bg:theme-surface"
						onclick={handleClose}
					>
						{cancelText}
					</button>
					<button
						class="px:16 py:8 border:none r:6 fg:white cursor:pointer"
						class:bg:theme-primary={confirmVariant === 'primary'}
						class:hover:bg:theme-primary={confirmVariant === 'primary'}
						class:bg:gray-600={confirmVariant === 'secondary'}
						class:hover:bg:gray-700={confirmVariant === 'secondary'}
						class:bg:theme-error={confirmVariant === 'danger'}
						class:hover:bg:theme-error={confirmVariant === 'danger'}
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
			max-height: 100dvh;
			height: 100%;
			border-radius: 0;
		}

		.modal-header,
		.modal-body,
		.modal-footer {
			padding: 16px;
		}

		.modal-header {
			padding-top: calc(16px + var(--safe-top));
		}

		.modal-body {
			padding-bottom: calc(16px + var(--safe-bottom));
		}
	}
</style>
