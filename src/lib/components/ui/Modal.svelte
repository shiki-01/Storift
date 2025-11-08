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
</script>

{#if isOpen}
	<div
		class="position:fixed inset:0 bg:rgba(0,0,0,0.5) z:1000 flex align-items:center justify-content:center"
		onclick={handleBackdropClick}
		onkeydown={(e) => {
			if (e.key === 'Escape') handleClose();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="bg:white r:12 {sizeClasses[
				size
			]} w:90% max-h:90vh overflow:auto box-shadow:0|8|32|rgba(0,0,0,0.2)"
		>
			<div
				class="flex justify-content:space-between align-items:center p:24 border-bottom:1|solid|gray-200"
			>
				<h2 class="font:20 font-weight:600 m:0">{title}</h2>
				<button
					class="bg:transparent border:none font:24 cursor:pointer p:8 fg:gray-600 fg:gray-900:hover"
					onclick={handleClose}
					aria-label="閉じる"
				>
					×
				</button>
			</div>
			<div class="p:24">
				{#if children}
					{@render children()}
				{/if}
			</div>
			{#if footer}
				<div class="p:24 pt:0">
					{@render footer()}
				</div>
			{:else if onConfirm}
				<div class="p:24 pt:0 flex gap:12 justify-content:flex-end">
					<button
						class="px:16 py:8 border:1|solid|gray-300 r:6 bg:white fg:gray-700 cursor:pointer bg:gray-50:hover"
						onclick={handleClose}
					>
						{cancelText}
					</button>
					<button
						class="px:16 py:8 border:none r:6 fg:white cursor:pointer"
						class:bg:blue-600={confirmVariant === 'primary'}
						class:bg:blue-700:hover={confirmVariant === 'primary'}
						class:bg:gray-600={confirmVariant === 'secondary'}
						class:bg:gray-700:hover={confirmVariant === 'secondary'}
						class:bg:red-600={confirmVariant === 'danger'}
						class:bg:red-700:hover={confirmVariant === 'danger'}
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
