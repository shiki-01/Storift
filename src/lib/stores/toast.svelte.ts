export type ToastType = 'success' | 'error' | 'info';

export interface ToastAction {
	label: string;
	onclick: () => void;
}

export interface Toast {
	id: number;
	type: ToastType;
	message: string;
	action?: ToastAction;
}

class ToastStore {
	items = $state<Toast[]>([]);
	private nextId = 1;

	show(type: ToastType, message: string, options: { action?: ToastAction; duration?: number } = {}) {
		const id = this.nextId++;
		this.items.push({ id, type, message, action: options.action });
		const duration = options.duration ?? (options.action ? 6000 : type === 'error' ? 6000 : 3000);
		setTimeout(() => this.dismiss(id), duration);
		return id;
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toastStore = new ToastStore();

export const toast = {
	success: (message: string, options?: { action?: ToastAction; duration?: number }) =>
		toastStore.show('success', message, options),
	error: (message: string, options?: { action?: ToastAction; duration?: number }) =>
		toastStore.show('error', message, options),
	info: (message: string, options?: { action?: ToastAction; duration?: number }) =>
		toastStore.show('info', message, options)
};
