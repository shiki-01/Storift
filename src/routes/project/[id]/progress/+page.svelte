<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { progressLogsDB } from '$lib/db';
	import type { ProgressLog, ProgressStats } from '$lib/types';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { onMount } from 'svelte';
	import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, subMonths, addMonths } from 'date-fns';
	import { ja } from 'date-fns/locale';

	let progressLogs = $state<ProgressLog[]>([]);
	let isLoading = $state(true);
	let currentMonth = $state(new Date());
	let selectedDate = $state<Date | null>(null);
	let showLogModal = $state(false);
	let stats = $state<ProgressStats>({
		totalCharacters: 0,
		averageDaily: 0,
		maxDaily: 0,
		consecutiveDays: 0,
		goalProgress: 0
	});

	// フォーム状態
	let logForm = $state({
		date: '',
		charactersWritten: 0,
		timeSpent: 0
	});

	onMount(async () => {
		await loadProgressLogs();
		calculateStats();
	});

	async function loadProgressLogs() {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			progressLogs = await progressLogsDB.getByProjectId(currentProjectStore.project.id);
		} finally {
			isLoading = false;
		}
	}

	function calculateStats() {
		if (progressLogs.length === 0) {
			stats = {
				totalCharacters: 0,
				averageDaily: 0,
				maxDaily: 0,
				consecutiveDays: 0,
				goalProgress: 0
			};
			return;
		}

		const totalCharacters = progressLogs.reduce((sum, log) => sum + log.charactersWritten, 0);
		const averageDaily = Math.round(totalCharacters / progressLogs.length);
		const maxDaily = Math.max(...progressLogs.map((log) => log.charactersWritten));

		// 連続日数計算
		const sortedLogs = [...progressLogs].sort((a, b) => b.date.localeCompare(a.date));
		let consecutiveDays = 0;
		const today = format(new Date(), 'yyyy-MM-dd');
		
		if (sortedLogs.length > 0 && sortedLogs[0].date === today) {
			consecutiveDays = 1;
			for (let i = 1; i < sortedLogs.length; i++) {
				const prevDate = new Date(sortedLogs[i - 1].date);
				const currDate = new Date(sortedLogs[i].date);
				const diffDays = Math.floor((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
				if (diffDays === 1) {
					consecutiveDays++;
				} else {
					break;
				}
			}
		}

		// 目標進捗計算
		const goal = currentProjectStore.project?.settings?.goal;
		let goalProgress = 0;
		if (goal) {
			if (goal.type === 'daily') {
				const todayLog = progressLogs.find((log) => log.date === today);
				goalProgress = todayLog ? Math.min(100, (todayLog.charactersWritten / goal.target) * 100) : 0;
			} else if (goal.type === 'total') {
				goalProgress = Math.min(100, (totalCharacters / goal.target) * 100);
			}
		}

		stats = {
			totalCharacters,
			averageDaily,
			maxDaily,
			consecutiveDays,
			goalProgress: Math.round(goalProgress)
		};
	}

	function getCalendarDays() {
		const start = startOfMonth(currentMonth);
		const end = endOfMonth(currentMonth);
		const days = eachDayOfInterval({ start, end });

		// 月初の曜日を取得して空白を追加
		const firstDayOfWeek = start.getDay();
		const emptyDays = Array(firstDayOfWeek).fill(null);

		return [...emptyDays, ...days];
	}

	function getLogForDate(date: Date): ProgressLog | undefined {
		const dateStr = format(date, 'yyyy-MM-dd');
		return progressLogs.find((log) => log.date === dateStr);
	}

	function getHeatmapColor(charactersWritten: number): string {
		if (charactersWritten === 0) return 'bg:gray-100';
		if (charactersWritten < 500) return 'bg:green-200';
		if (charactersWritten < 1000) return 'bg:green-400';
		if (charactersWritten < 2000) return 'bg:green-600';
		return 'bg:green-800';
	}

	function openLogModal(date: Date) {
		selectedDate = date;
		const dateStr = format(date, 'yyyy-MM-dd');
		const existingLog = getLogForDate(date);

		logForm = {
			date: dateStr,
			charactersWritten: existingLog?.charactersWritten || 0,
			timeSpent: existingLog?.timeSpent || 0
		};

		showLogModal = true;
	}

	async function handleSaveLog() {
		if (!currentProjectStore.project || !selectedDate) return;

		const dateStr = format(selectedDate, 'yyyy-MM-dd');
		const existingLog = await progressLogsDB.getByDate(currentProjectStore.project.id, dateStr);

		if (existingLog) {
			await progressLogsDB.update(existingLog.id, {
				charactersWritten: logForm.charactersWritten,
				timeSpent: logForm.timeSpent
			});
		} else {
			const newLog = await progressLogsDB.create(currentProjectStore.project.id, dateStr);
			await progressLogsDB.update(newLog.id, {
				charactersWritten: logForm.charactersWritten,
				timeSpent: logForm.timeSpent
			});
		}

		await loadProgressLogs();
		calculateStats();
		showLogModal = false;
	}

	function previousMonth() {
		currentMonth = subMonths(currentMonth, 1);
	}

	function nextMonth() {
		currentMonth = addMonths(currentMonth, 1);
	}

	function goToToday() {
		currentMonth = new Date();
	}

	$effect(() => {
		calculateStats();
	});

	let recentLogs = $derived(
		[...progressLogs]
			.sort((a, b) => b.date.localeCompare(a.date))
			.slice(0, 7)
	);

	let monthlyTotal = $derived(
		progressLogs
			.filter((log) => {
				const logDate = parseISO(log.date);
				return logDate.getMonth() === currentMonth.getMonth() &&
					logDate.getFullYear() === currentMonth.getFullYear();
			})
			.reduce((sum, log) => sum + log.charactersWritten, 0)
	);
</script>

<div class="p:32 h:100vh overflow:auto">
	<!-- ヘッダー -->
	<div class="flex justify-content:space-between align-items:center mb:24">
		<div>
			<h1 class="font:32 font:bold mb:8">進捗管理</h1>
			<p class="fg:gray-600">執筆の進捗を記録・可視化します</p>
		</div>
	</div>

	{#if isLoading}
		<div class="flex justify-content:center align-items:center h:400">
			<p class="fg:gray-600">読み込み中...</p>
		</div>
	{:else}
		<!-- 統計サマリー -->
		<div class="grid cols:5 gap:16 mb:24">
			<Card>
				<div class="p:20 text-align:center">
					<p class="fg:gray-600 font:14 mb:8">累計文字数</p>
					<p class="font:32 font:bold fg:blue-600">{stats.totalCharacters.toLocaleString()}</p>
					<p class="fg:gray-500 font:12 mt:4">文字</p>
				</div>
			</Card>

			<Card>
				<div class="p:20 text-align:center">
					<p class="fg:gray-600 font:14 mb:8">平均執筆量</p>
					<p class="font:32 font:bold fg:green-600">{stats.averageDaily.toLocaleString()}</p>
					<p class="fg:gray-500 font:12 mt:4">文字/日</p>
				</div>
			</Card>

			<Card>
				<div class="p:20 text-align:center">
					<p class="fg:gray-600 font:14 mb:8">最高記録</p>
					<p class="font:32 font:bold fg:purple-600">{stats.maxDaily.toLocaleString()}</p>
					<p class="fg:gray-500 font:12 mt:4">文字/日</p>
				</div>
			</Card>

			<Card>
				<div class="p:20 text-align:center">
					<p class="fg:gray-600 font:14 mb:8">連続執筆</p>
					<p class="font:32 font:bold fg:orange-600">{stats.consecutiveDays}</p>
					<p class="fg:gray-500 font:12 mt:4">日間</p>
				</div>
			</Card>

			<Card>
				<div class="p:20 text-align:center">
					<p class="fg:gray-600 font:14 mb:8">目標達成率</p>
					<p class="font:32 font:bold fg:red-600">{stats.goalProgress}%</p>
					<p class="fg:gray-500 font:12 mt:4">達成</p>
				</div>
			</Card>
		</div>

		<div class="grid cols:3 gap:16">
			<!-- カレンダー -->
			<div class="col:span-2">
				<Card>
					<div class="p:24">
						<!-- カレンダーヘッダー -->
						<div class="flex justify-content:space-between align-items:center mb:20">
							<h2 class="font:20 font:semibold">
								{format(currentMonth, 'yyyy年M月', { locale: ja })}
							</h2>
							<div class="flex gap:8">
								<Button variant="secondary" onclick={previousMonth}>←</Button>
								<Button variant="secondary" onclick={goToToday}>今日</Button>
								<Button variant="secondary" onclick={nextMonth}>→</Button>
							</div>
						</div>

						<!-- 月間合計 -->
						<div class="mb:16 p:12 bg:blue-50 r:8">
							<p class="fg:blue-800 font:14">
								今月の合計: <span class="font:bold">{monthlyTotal.toLocaleString()}</span> 文字
							</p>
						</div>

						<!-- 曜日ヘッダー -->
						<div class="grid cols:7 gap:4 mb:8">
							{#each ['日', '月', '火', '水', '木', '金', '土'] as day}
								<div class="text-align:center font:12 font:semibold fg:gray-600 py:8">
									{day}
								</div>
							{/each}
						</div>

						<!-- カレンダーグリッド -->
						<div class="grid cols:7 gap:4">
							{#each getCalendarDays() as day}
								{#if day === null}
									<div class="aspect:1/1"></div>
								{:else}
									{@const log = getLogForDate(day)}
									{@const isToday = isSameDay(day, new Date())}
									<button
										class="aspect:1/1 r:8 p:8 {getHeatmapColor(log?.charactersWritten || 0)} 
											{isToday ? 'ring:2|solid|blue-500' : ''} 
											hover:opacity:80 transition:all|200ms flex flex:col align-items:center justify-content:center"
										onclick={() => openLogModal(day)}
									>
										<span class="font:14 font:semibold mb:4">{format(day, 'd')}</span>
										{#if log}
											<span class="font:10 fg:gray-700">{log.charactersWritten}</span>
										{/if}
									</button>
								{/if}
							{/each}
						</div>

						<!-- 凡例 -->
						<div class="flex align-items:center gap:8 mt:16 pt:16 bt:1|solid|gray-200">
							<span class="font:12 fg:gray-600">執筆量:</span>
							<div class="flex align-items:center gap:4">
								<div class="w:16 h:16 bg:gray-100 r:4"></div>
								<span class="font:12 fg:gray-600">0</span>
							</div>
							<div class="flex align-items:center gap:4">
								<div class="w:16 h:16 bg:green-200 r:4"></div>
								<span class="font:12 fg:gray-600">~500</span>
							</div>
							<div class="flex align-items:center gap:4">
								<div class="w:16 h:16 bg:green-400 r:4"></div>
								<span class="font:12 fg:gray-600">~1000</span>
							</div>
							<div class="flex align-items:center gap:4">
								<div class="w:16 h:16 bg:green-600 r:4"></div>
								<span class="font:12 fg:gray-600">~2000</span>
							</div>
							<div class="flex align-items:center gap:4">
								<div class="w:16 h:16 bg:green-800 r:4"></div>
								<span class="font:12 fg:gray-600">2000+</span>
							</div>
						</div>
					</div>
				</Card>
			</div>

			<!-- 最近の記録 -->
			<div>
				<Card>
					<div class="p:24">
						<h3 class="font:18 font:semibold mb:16">最近の記録</h3>
						<div class="flex flex:col gap:12">
							{#each recentLogs as log (log.id)}
								<div class="p:12 bg:gray-50 r:8">
									<div class="flex justify-content:space-between align-items:start mb:8">
										<span class="font:14 font:semibold">
											{format(parseISO(log.date), 'M月d日(E)', { locale: ja })}
										</span>
										<button
											class="px:8 py:4 bg:blue-50 fg:blue-600 r:4 font:12 hover:bg:blue-100"
											onclick={() => openLogModal(parseISO(log.date))}
										>
											編集
										</button>
									</div>
									<div class="flex flex:col gap:4">
										<div class="flex justify-content:space-between">
											<span class="font:12 fg:gray-600">執筆量</span>
											<span class="font:14 font:semibold">
												{log.charactersWritten.toLocaleString()}文字
											</span>
										</div>
										{#if log.timeSpent > 0}
											<div class="flex justify-content:space-between">
												<span class="font:12 fg:gray-600">執筆時間</span>
												<span class="font:14 font:semibold">
													{Math.floor(log.timeSpent / 60)}時間{log.timeSpent % 60}分
												</span>
											</div>
										{/if}
									</div>
								</div>
							{/each}

							{#if recentLogs.length === 0}
								<p class="fg:gray-500 font:14 text-align:center py:20">
									まだ記録がありません
								</p>
							{/if}
						</div>
					</div>
				</Card>
			</div>
		</div>
	{/if}
</div>

<!-- 進捗記録モーダル -->
<Modal bind:isOpen={showLogModal} title="進捗記録">
	{#snippet children()}
		{#if selectedDate}
			<div class="flex flex:col gap:16">
				<div class="p:16 bg:gray-50 r:8">
					<p class="font:14 fg:gray-600 mb:4">日付</p>
					<p class="font:18 font:semibold">
						{format(selectedDate, 'yyyy年M月d日(E)', { locale: ja })}
					</p>
				</div>

				<div>
					<label for="characters-written" class="block mb:8 font:14 font:semibold">執筆文字数</label>
					<input
						id="characters-written"
						type="number"
						bind:value={logForm.charactersWritten}
						placeholder="0"
						class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
					/>
				</div>

				<div>
					<label for="time-spent" class="block mb:8 font:14 font:semibold">執筆時間(分)</label>
					<input
						id="time-spent"
						type="number"
						bind:value={logForm.timeSpent}
						placeholder="0"
						class="w:full px:12 py:10 b:1|solid|gray-300 r:8 outline:none focus:b:blue-500"
					/>
				</div>
			</div>
		{/if}
	{/snippet}

	{#snippet footer()}
		<div class="flex gap:12">
			<Button variant="secondary" onclick={() => (showLogModal = false)}>キャンセル</Button>
			<Button onclick={handleSaveLog}>保存</Button>
		</div>
	{/snippet}
</Modal>

<style>
	.aspect\:1\/1 {
		aspect-ratio: 1 / 1;
	}
</style>
