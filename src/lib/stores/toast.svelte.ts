/**
 * トースト通知と確認ダイアログ。
 * alert / confirm の代わりに使う(ブロッキングでなく、PWA でも浮かない)。
 */
export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
	label: string;
	onClick: () => void;
}

export interface ToastItem {
	id: number;
	kind: ToastKind;
	message: string;
	action?: ToastAction;
}

interface ToastOptions {
	action?: ToastAction;
	/** 表示時間(ms)。0 で自動では消えない */
	duration?: number;
}

let items = $state<ToastItem[]>([]);
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function dismiss(id: number) {
	const timer = timers.get(id);
	if (timer) clearTimeout(timer);
	timers.delete(id);
	items = items.filter((t) => t.id !== id);
}

function push(kind: ToastKind, message: string, options: ToastOptions = {}): number {
	const id = nextId++;
	// 同じ内容が連続したときは積み上げず、直前のものを差し替える
	const last = items[items.length - 1];
	if (last && last.kind === kind && last.message === message) dismiss(last.id);
	items = [...items.slice(-2), { id, kind, message, action: options.action }];
	const duration = options.duration ?? (options.action ? 8000 : kind === 'error' ? 6000 : 3500);
	if (duration > 0)
		timers.set(
			id,
			setTimeout(() => dismiss(id), duration)
		);
	return id;
}

export const toast = {
	success: (message: string, options?: ToastOptions) => push('success', message, options),
	error: (message: string, options?: ToastOptions) => push('error', message, options),
	info: (message: string, options?: ToastOptions) => push('info', message, options),
	dismiss
};

export const toastStore = {
	get items() {
		return items;
	}
};

// ===== 確認ダイアログ =====
export interface ConfirmOptions {
	title?: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	/** 削除など取り消せない操作。確認ボタンを警告色にし、初期フォーカスをキャンセルに置く */
	danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
	resolve: (value: boolean) => void;
}

let pending = $state<PendingConfirm | null>(null);

export function confirmDialog(options: string | ConfirmOptions): Promise<boolean> {
	const opts = typeof options === 'string' ? { message: options } : options;
	return new Promise((resolve) => {
		// 既に開いているダイアログがあれば、キャンセル扱いで閉じる
		pending?.resolve(false);
		pending = { ...opts, resolve };
	});
}

export const confirmStore = {
	get pending() {
		return pending;
	},
	answer(value: boolean) {
		const current = pending;
		pending = null;
		current?.resolve(value);
	}
};
