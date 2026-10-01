export interface ConfirmOptions {
	title?: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
	resolve: (value: boolean) => void;
}

class ConfirmStore {
	current = $state<PendingConfirm | null>(null);

	ask(options: ConfirmOptions): Promise<boolean> {
		return new Promise((resolve) => {
			this.current?.resolve(false);
			this.current = { ...options, resolve };
		});
	}

	answer(value: boolean) {
		this.current?.resolve(value);
		this.current = null;
	}
}

export const confirmStore = new ConfirmStore();

/** window.confirm の置き換え。独自ダイアログで確認する */
export const confirmDialog = (options: ConfirmOptions | string) =>
	confirmStore.ask(typeof options === 'string' ? { message: options } : options);
