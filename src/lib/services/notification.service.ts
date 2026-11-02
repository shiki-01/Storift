/**
 * 通知サービス
 * ブラウザ通知、執筆リマインダー、同期ステータス通知を管理
 */

export type NotificationType = 'reminder' | 'sync' | 'achievement' | 'system';

export interface NotificationOptions {
	title: string;
	body: string;
	type: NotificationType;
	icon?: string;
	tag?: string;
	requireInteraction?: boolean;
	actions?: Array<{ action: string; title: string }>;
}

/** Service Worker 経由で表示するときに渡すオプション(標準の NotificationOptions に本サービスで使うフィールドを追加) */
export interface ServiceWorkerNotificationOptions extends globalThis.NotificationOptions {
	vibrate: number[];
	data: { type: NotificationType; timestamp: number };
	actions?: Array<{ action: string; title: string }>;
}

export interface WritingGoal {
	id: string;
	projectId: string;
	dailyWordCount: number;
	reminderTime?: string; // HH:mm format
	enabled: boolean;
}

/**
 * 通知権限の状態
 */
export type PermissionState = 'default' | 'granted' | 'denied';

class NotificationService {
	private static readonly STORAGE_KEY = 'storift_notifications';
	private static readonly GOALS_KEY = 'storift_writing_goals';
	private reminderTimers: Map<string, number> = new Map();

	/**
	 * 通知権限をリクエスト
	 */
	async requestPermission(): Promise<PermissionState> {
		if (!('Notification' in window)) {
			console.warn('このブラウザは通知をサポートしていません');
			return 'denied';
		}

		if (Notification.permission === 'granted') {
			return 'granted';
		}

		if (Notification.permission === 'denied') {
			return 'denied';
		}

		const permission = await Notification.requestPermission();
		return permission as PermissionState;
	}

	/**
	 * 現在の通知権限を取得
	 */
	getPermission(): PermissionState {
		if (!('Notification' in window)) {
			return 'denied';
		}
		return Notification.permission as PermissionState;
	}

	/**
	 * 通知を表示
	 */
	async showNotification(options: NotificationOptions): Promise<void> {
		const permission = await this.requestPermission();
		if (permission !== 'granted') {
			console.warn('通知権限が許可されていません');
			return;
		}

		const { title, body, icon, tag, requireInteraction, actions } = options;

		// Service Worker経由で通知を表示
		if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
			try {
				const registration = await navigator.serviceWorker.ready;
				const notificationOptions: ServiceWorkerNotificationOptions = {
					body,
					icon: icon || '/icon-192.png',
					badge: '/icon-192.png',
					tag: tag || `storift-${Date.now()}`,
					requireInteraction,
					vibrate: [200, 100, 200],
					data: { type: options.type, timestamp: Date.now() }
				};

				if (actions && actions.length > 0) {
					notificationOptions.actions = actions.map((a) => ({
						action: a.action,
						title: a.title
					}));
				}

				await registration.showNotification(title, notificationOptions);
			} catch (error) {
				console.error('Service Worker通知の表示に失敗:', error);
				// フォールバック: 通常の通知
				this.showBasicNotification(options);
			}
		} else {
			// Service Worker未対応の場合は通常の通知
			this.showBasicNotification(options);
		}

		// 通知履歴を保存
		this.saveNotificationHistory(options);
	}

	/**
	 * 基本的な通知を表示(Service Worker非対応時のフォールバック)
	 */
	private showBasicNotification(options: NotificationOptions): void {
		const notification = new Notification(options.title, {
			body: options.body,
			icon: options.icon || '/icon-192.png',
			tag: options.tag
		});

		notification.onclick = () => {
			window.focus();
			notification.close();
		};
	}

	/**
	 * 執筆リマインダーを設定
	 */
	setWritingReminder(goal: WritingGoal): void {
		// 既存のタイマーをクリア
		this.clearReminder(goal.id);

		if (!goal.enabled || !goal.reminderTime) {
			return;
		}

		const [hours, minutes] = goal.reminderTime.split(':').map(Number);
		const now = new Date();
		const scheduledTime = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			hours,
			minutes,
			0
		);

		// 指定時刻が過去の場合は翌日に設定
		if (scheduledTime < now) {
			scheduledTime.setDate(scheduledTime.getDate() + 1);
		}

		const delay = scheduledTime.getTime() - now.getTime();

		const timerId = window.setTimeout(async () => {
			await this.showNotification({
				title: '執筆リマインダー',
				body: `今日の目標: ${goal.dailyWordCount}文字`,
				type: 'reminder',
				tag: `reminder-${goal.id}`,
				requireInteraction: true,
				actions: [
					{ action: 'start', title: '執筆を開始' },
					{ action: 'dismiss', title: '後で' }
				]
			});

			// 翌日のリマインダーを再設定
			this.setWritingReminder(goal);
		}, delay);

		this.reminderTimers.set(goal.id, timerId);
		this.saveGoals();
	}

	/**
	 * リマインダーをクリア
	 */
	clearReminder(goalId: string): void {
		const timerId = this.reminderTimers.get(goalId);
		if (timerId) {
			clearTimeout(timerId);
			this.reminderTimers.delete(goalId);
		}
	}

	/**
	 * 執筆目標を保存
	 */
	saveGoals(): void {
		try {
			const goals = this.getAllGoals();
			localStorage.setItem(NotificationService.GOALS_KEY, JSON.stringify(goals));
		} catch (error) {
			console.error('執筆目標の保存に失敗:', error);
		}
	}

	/**
	 * 執筆目標を取得
	 */
	getGoal(projectId: string): WritingGoal | null {
		const goals = this.getAllGoals();
		return goals.find((g) => g.projectId === projectId) || null;
	}

	/**
	 * 全ての執筆目標を取得
	 */
	getAllGoals(): WritingGoal[] {
		try {
			const data = localStorage.getItem(NotificationService.GOALS_KEY);
			return data ? JSON.parse(data) : [];
		} catch {
			return [];
		}
	}

	/**
	 * 執筆目標を更新
	 */
	updateGoal(goal: WritingGoal): void {
		const goals = this.getAllGoals();
		const index = goals.findIndex((g) => g.id === goal.id);

		if (index >= 0) {
			goals[index] = goal;
		} else {
			goals.push(goal);
		}

		localStorage.setItem(NotificationService.GOALS_KEY, JSON.stringify(goals));

		// リマインダーを再設定
		if (goal.enabled) {
			this.setWritingReminder(goal);
		} else {
			this.clearReminder(goal.id);
		}
	}

	/**
	 * 執筆目標を削除
	 */
	deleteGoal(goalId: string): void {
		this.clearReminder(goalId);
		const goals = this.getAllGoals().filter((g) => g.id !== goalId);
		localStorage.setItem(NotificationService.GOALS_KEY, JSON.stringify(goals));
	}

	/**
	 * 同期完了通知
	 */
	async notifySyncComplete(status: 'success' | 'error', message?: string): Promise<void> {
		await this.showNotification({
			title: status === 'success' ? '同期完了' : '同期エラー',
			body:
				message ||
				(status === 'success' ? 'データが正常に同期されました' : '同期中にエラーが発生しました'),
			type: 'sync',
			tag: 'sync-status',
			icon: status === 'success' ? '/icon-192.png' : undefined
		});
	}

	/**
	 * 達成通知
	 */
	async notifyAchievement(title: string, description: string): Promise<void> {
		await this.showNotification({
			title: `🎉 ${title}`,
			body: description,
			type: 'achievement',
			requireInteraction: true
		});
	}

	/**
	 * システム通知
	 */
	async notifySystem(message: string): Promise<void> {
		await this.showNotification({
			title: 'Storift',
			body: message,
			type: 'system'
		});
	}

	/**
	 * 通知履歴を保存
	 */
	private saveNotificationHistory(notification: NotificationOptions): void {
		try {
			const history = this.getNotificationHistory();
			history.unshift({
				...notification,
				timestamp: Date.now()
			});

			// 最新100件のみ保持
			if (history.length > 100) {
				history.splice(100);
			}

			localStorage.setItem(NotificationService.STORAGE_KEY, JSON.stringify(history));
		} catch (error) {
			console.error('通知履歴の保存に失敗:', error);
		}
	}

	/**
	 * 通知履歴を取得
	 */
	getNotificationHistory(): Array<NotificationOptions & { timestamp: number }> {
		try {
			const data = localStorage.getItem(NotificationService.STORAGE_KEY);
			return data ? JSON.parse(data) : [];
		} catch {
			return [];
		}
	}

	/**
	 * 通知履歴をクリア
	 */
	clearNotificationHistory(): void {
		localStorage.removeItem(NotificationService.STORAGE_KEY);
	}

	/**
	 * 全てのリマインダーを初期化(アプリ起動時に実行)
	 */
	initializeReminders(): void {
		const goals = this.getAllGoals();
		goals.forEach((goal) => {
			if (goal.enabled && goal.reminderTime) {
				this.setWritingReminder(goal);
			}
		});
	}

	/**
	 * 全てのリマインダーをクリーンアップ
	 */
	cleanup(): void {
		this.reminderTimers.forEach((timerId) => {
			clearTimeout(timerId);
		});
		this.reminderTimers.clear();
	}
}

// シングルトンインスタンスをエクスポート
export const notificationService = new NotificationService();
