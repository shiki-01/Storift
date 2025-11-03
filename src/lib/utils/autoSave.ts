/**
 * 自動保存ユーティリティ
 */

export interface AutoSaveOptions {
	/** 保存間隔(ミリ秒) デフォルト: 30秒 */
	interval?: number;
	/** 保存関数 */
	onSave: () => Promise<void>;
	/** 変更検知関数 */
	isDirty: () => boolean;
	/** エラーハンドラー */
	onError?: (error: Error) => void;
	/** 保存成功時のコールバック */
	onSuccess?: () => void;
	/** 即座に保存するか */
	immediate?: boolean;
}

export class AutoSave {
	private timer: number | null = null;
	private options: Required<AutoSaveOptions>;
	private isSaving = false;
	private lastSaveTime = 0;

	constructor(options: AutoSaveOptions) {
		this.options = {
			interval: options.interval || 30000,
			onSave: options.onSave,
			isDirty: options.isDirty,
			onError: options.onError || ((error) => console.error('Auto-save error:', error)),
			onSuccess: options.onSuccess || (() => {}),
			immediate: options.immediate || false
		};
	}

	/**
	 * 自動保存を開始
	 */
	start(): void {
		if (this.timer !== null) {
			console.warn('Auto-save already started');
			return;
		}

		console.log('🔄 Auto-save started (interval:', this.options.interval, 'ms)');

		// 即座に保存する場合
		if (this.options.immediate) {
			this.save();
		}

		this.timer = window.setInterval(() => {
			this.save();
		}, this.options.interval);
	}

	/**
	 * 自動保存を停止
	 */
	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
			console.log('⏹️ Auto-save stopped');
		}
	}

	/**
	 * 保存を実行
	 */
	async save(): Promise<void> {
		// 既に保存中の場合はスキップ
		if (this.isSaving) {
			console.log('⏭️ Auto-save skipped (already saving)');
			return;
		}

		// 変更がない場合はスキップ
		if (!this.options.isDirty()) {
			console.log('⏭️ Auto-save skipped (no changes)');
			return;
		}

		this.isSaving = true;

		try {
			console.log('💾 Auto-saving...');
			await this.options.onSave();
			this.lastSaveTime = Date.now();
			this.options.onSuccess();
			console.log('✅ Auto-save successful');
		} catch (error) {
			console.error('❌ Auto-save failed:', error);
			this.options.onError(error as Error);
		} finally {
			this.isSaving = false;
		}
	}

	/**
	 * 強制的に保存
	 */
	async forceSave(): Promise<void> {
		await this.save();
	}

	/**
	 * 最終保存時刻を取得
	 */
	getLastSaveTime(): number {
		return this.lastSaveTime;
	}

	/**
	 * 保存中かどうか
	 */
	getIsSaving(): boolean {
		return this.isSaving;
	}

	/**
	 * 保存間隔を変更
	 */
	setInterval(interval: number): void {
		this.options.interval = interval;
		
		// タイマーが動いている場合は再起動
		if (this.timer !== null) {
			this.stop();
			this.start();
		}
	}
}

/**
 * 離脱前の未保存警告
 */
export function enableUnsavedWarning(isDirty: () => boolean): () => void {
	const handler = (e: BeforeUnloadEvent) => {
		if (isDirty()) {
			e.preventDefault();
			e.returnValue = '未保存の変更があります。本当に離脱しますか?';
			return e.returnValue;
		}
	};

	window.addEventListener('beforeunload', handler);

	// クリーンアップ関数を返す
	return () => {
		window.removeEventListener('beforeunload', handler);
	};
}

/**
 * 可視性変更時の自動保存
 * タブが非アクティブになる前に保存
 */
export function enableVisibilityAutoSave(onSave: () => Promise<void>): () => void {
	const handler = async () => {
		if (document.hidden) {
			console.log('👁️ Tab hidden, auto-saving...');
			try {
				await onSave();
			} catch (error) {
				console.error('Visibility auto-save failed:', error);
			}
		}
	};

	document.addEventListener('visibilitychange', handler);

	// クリーンアップ関数を返す
	return () => {
		document.removeEventListener('visibilitychange', handler);
	};
}
