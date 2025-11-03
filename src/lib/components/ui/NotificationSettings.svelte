<script lang="ts">
	import { onMount } from 'svelte';
	import {
		notificationService,
		type WritingGoal,
		type PermissionState
	} from '$lib/services/notification.service';
	import Button from './Button.svelte';
	import Input from './Input.svelte';
	import Card from './Card.svelte';

	interface Props {
		projectId: string;
	}

	let { projectId }: Props = $props();

	let permission = $state<PermissionState>('default');
	let goal = $state<WritingGoal | null>(null);
	let dailyWordCount = $state(2000);
	let reminderTime = $state('20:00');
	let reminderEnabled = $state(false);
	let notificationHistory = $state<Array<any>>([]);
	let showHistory = $state(false);

	onMount(() => {
		permission = notificationService.getPermission();
		loadGoal();
		loadHistory();
	});

	const loadGoal = () => {
		const existingGoal = notificationService.getGoal(projectId);
		if (existingGoal) {
			goal = existingGoal;
			dailyWordCount = existingGoal.dailyWordCount;
			reminderTime = existingGoal.reminderTime || '20:00';
			reminderEnabled = existingGoal.enabled;
		}
	}

	const loadHistory = () => {
		notificationHistory = notificationService.getNotificationHistory().slice(0, 10);
	}

	const handleRequestPermission = async() => {
		permission = await notificationService.requestPermission();
		if (permission === 'granted') {
			await notificationService.notifySystem('通知が有効になりました');
		}
	}

	const handleSaveGoal = () => {
		const updatedGoal: WritingGoal = {
			id: goal?.id || crypto.randomUUID(),
			projectId,
			dailyWordCount,
			reminderTime: reminderEnabled ? reminderTime : undefined,
			enabled: reminderEnabled
		};

		notificationService.updateGoal(updatedGoal);
		goal = updatedGoal;

		notificationService.notifySystem('執筆目標を保存しました');
	}

	const handleTestNotification = async() => {
		await notificationService.showNotification({
			title: 'テスト通知',
			body: 'Storiftの通知が正常に動作しています',
			type: 'system'
		});
		loadHistory();
	}

	const handleClearHistory = () => {
		notificationService.clearNotificationHistory();
		notificationHistory = [];
	}

	function getNotificationTypeLabel(type: string): string {
		const labels: Record<string, string> = {
			reminder: 'リマインダー',
			sync: '同期',
			achievement: '達成',
			system: 'システム'
		};
		return labels[type] || type;
	}

	function formatTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor(diff / (1000 * 60));

		if (hours < 1) {
			return `${minutes}分前`;
		} else if (hours < 24) {
			return `${hours}時間前`;
		} else {
			return date.toLocaleDateString('ja-JP', {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		}
	}
</script>

<div class="notification-settings space-y:20">
	<!-- 通知権限 -->
	<Card>
		<h3 class="font:16 font:semibold fg:gray-900 mb:12">通知権限</h3>

		<div class="space-y:12">
			{#if permission === 'granted'}
				<div class="flex align-items:center gap:8 p:12 bg:green-50 border:1|solid|green-200 r:8">
					<span class="font:20">✓</span>
					<span class="font:14 fg:green-800">通知が有効です</span>
				</div>
			{:else if permission === 'denied'}
				<div class="flex align-items:center gap:8 p:12 bg:red-50 border:1|solid|red-200 r:8">
					<span class="font:20">✗</span>
					<div class="flex-grow">
						<p class="font:14 fg:red-800">通知が無効です</p>
						<p class="font:12 fg:red-600 mt:4">ブラウザの設定から通知を許可してください</p>
					</div>
				</div>
			{:else}
				<div class="space-y:12">
					<p class="font:14 fg:gray-700">
						通知を有効にすると、執筆リマインダーや同期ステータスなどの通知を受け取れます。
					</p>
					<Button variant="primary" onclick={handleRequestPermission}>通知を許可</Button>
				</div>
			{/if}

			{#if permission === 'granted'}
				<Button variant="secondary" onclick={handleTestNotification}>テスト通知を送信</Button>
			{/if}
		</div>
	</Card>

	<!-- 執筆目標とリマインダー -->
	<Card>
		<h3 class="font:16 font:semibold fg:gray-900 mb:12">執筆目標とリマインダー</h3>

		<div class="space-y:16">
			<!-- 1日の目標文字数 -->
			<div>
				<label for="dailyGoal" class="font:14 fg:gray-700 mb:6 block"> 1日の目標文字数 </label>
				<div class="flex align-items:center gap:12">
					<input
						id="dailyGoal"
						type="range"
						min="500"
						max="10000"
						step="500"
						bind:value={dailyWordCount}
						class="flex-grow"
					/>
					<span class="font:14 fg:gray-700 w:80 text-align:right"
						>{dailyWordCount.toLocaleString()}文字</span
					>
				</div>
			</div>

			<!-- リマインダー設定 -->
			<div>
				<label class="flex align-items:center gap:8 cursor:pointer mb:12">
					<input
						type="checkbox"
						bind:checked={reminderEnabled}
						class="w:18 h:18"
						disabled={permission !== 'granted'}
					/>
					<span class="font:14 fg:gray-700">執筆リマインダーを有効にする</span>
				</label>

				{#if reminderEnabled}
					<div class="ml:26">
						<label for="reminderTime" class="font:14 fg:gray-700 mb:6 block">
							リマインダー時刻
						</label>
						<input
							id="reminderTime"
							type="time"
							bind:value={reminderTime}
							class="py:8 px:12 r:8 border:1|solid|gray-300 font:14"
						/>
					</div>
				{/if}
			</div>

			<Button variant="primary" onclick={handleSaveGoal} disabled={permission !== 'granted'}>
				設定を保存
			</Button>
		</div>
	</Card>

	<!-- 通知履歴 -->
	<Card>
		<div class="flex justify-content:space-between align-items:center mb:12">
			<h3 class="font:16 font:semibold fg:gray-900">通知履歴</h3>
			<button
				class="font:14 fg:blue-600 cursor:pointer hover:fg:blue-700"
				onclick={() => (showHistory = !showHistory)}
			>
				{showHistory ? '非表示' : '表示'}
			</button>
		</div>

		{#if showHistory}
			<div class="space-y:8">
				{#if notificationHistory.length === 0}
					<p class="font:14 fg:gray-500 text-align:center py:16">通知履歴はありません</p>
				{:else}
					{#each notificationHistory as notification}
						<div class="p:12 border:1|solid|gray-200 r:8">
							<div class="flex justify-content:space-between align-items:start mb:4">
								<div class="flex-grow">
									<div class="flex align-items:center gap:8 mb:4">
										<span class="font:14 font:semibold fg:gray-900">
											{notification.title}
										</span>
										<span class="px:6 py:2 bg:gray-100 fg:gray-600 font:11 r:4">
											{getNotificationTypeLabel(notification.type)}
										</span>
									</div>
									<p class="font:13 fg:gray-700">{notification.body}</p>
								</div>
								<span class="font:12 fg:gray-500 whitespace:nowrap ml:12">
									{formatTimestamp(notification.timestamp)}
								</span>
							</div>
						</div>
					{/each}

					<div class="flex justify-content:flex-end pt:8">
						<Button variant="secondary" onclick={handleClearHistory}>履歴をクリア</Button>
					</div>
				{/if}
			</div>
		{/if}
	</Card>
</div>

<style>
	input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		height: 6px;
		border-radius: 3px;
		background: #e5e7eb;
		outline: none;
	}

	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
	}

	input[type='range']::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
		border: none;
	}

	input[type='checkbox'] {
		cursor: pointer;
		accent-color: #3b82f6;
	}

	input[type='time'] {
		cursor: pointer;
	}
</style>
