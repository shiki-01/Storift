<script lang="ts">
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { progressLogsDB, projectsDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { ProgressLog, ProgressStats, ProjectSettings } from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import FormField from '$lib/components/ui/FormField.svelte';
	import ModalActions from '$lib/components/ui/ModalActions.svelte';
	import { buttonClass, fieldClass } from '$lib/components/ui/formStyles';
	import { deleteWithUndo } from '$lib/utils/undoDelete';
	import { onMount } from 'svelte';
	import {
		format,
		startOfMonth,
		endOfMonth,
		eachDayOfInterval,
		isSameDay,
		parseISO,
		subMonths,
		addMonths
	} from 'date-fns';
	import { ja } from 'date-fns/locale';

	type GoalType = ProjectSettings['goal']['type'];

	let progressLogs = $state<ProgressLog[]>([]);
	let isLoading = $state(true);
	let currentMonth = $state(new Date());
	let selectedDate = $state<Date | null>(null);
	let showLogModal = $state(false);
	let showGoalModal = $state(false);
	let isSaving = $state(false);

	let logForm = $state({ charactersWritten: 0, timeSpent: 0 });
	let goalForm = $state<{ type: GoalType; target: number }>({ type: 'daily', target: 2000 });

	const goalTypeLabels: Record<GoalType, string> = {
		daily: '1日あたりの目標',
		total: '全体の目標'
	};

	let goal = $derived(currentProjectStore.project?.settings?.goal ?? null);

	let selectedLog = $derived(selectedDate ? getLogForDate(selectedDate) : undefined);

	let stats = $derived.by<ProgressStats>(() => {
		if (progressLogs.length === 0) {
			return {
				totalCharacters: 0,
				averageDaily: 0,
				maxDaily: 0,
				consecutiveDays: 0,
				goalProgress: 0
			};
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
				const diffDays = Math.round(
					(prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
				);
				if (diffDays === 1) {
					consecutiveDays++;
				} else {
					break;
				}
			}
		}

		// 目標進捗計算
		let goalProgress = 0;
		if (goal && goal.target > 0) {
			if (goal.type === 'daily') {
				const todayLog = progressLogs.find((log) => log.date === today);
				goalProgress = todayLog
					? Math.min(100, (todayLog.charactersWritten / goal.target) * 100)
					: 0;
			} else {
				goalProgress = Math.min(100, (totalCharacters / goal.target) * 100);
			}
		}

		return {
			totalCharacters,
			averageDaily,
			maxDaily,
			consecutiveDays,
			goalProgress: Math.round(goalProgress)
		};
	});

	let recentLogs = $derived(
		[...progressLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7)
	);

	let monthlyTotal = $derived(
		progressLogs
			.filter((log) => {
				const logDate = parseISO(log.date);
				return (
					logDate.getMonth() === currentMonth.getMonth() &&
					logDate.getFullYear() === currentMonth.getFullYear()
				);
			})
			.reduce((sum, log) => sum + log.charactersWritten, 0)
	);

	let calendarDays = $derived.by(() => {
		const start = startOfMonth(currentMonth);
		const days = eachDayOfInterval({ start, end: endOfMonth(currentMonth) });
		// 月初の曜日ぶんの空白を追加
		return [...Array<null>(start.getDay()).fill(null), ...days];
	});

	onMount(async () => {
		await loadProgressLogs();
	});

	const loadProgressLogs = async () => {
		if (!currentProjectStore.project) return;
		isLoading = true;
		try {
			progressLogs = await progressLogsDB.getByProjectId(currentProjectStore.project.id);
		} catch (error) {
			console.error('Failed to load progress logs:', error);
			toast.error('進捗の読み込みに失敗しました');
		} finally {
			isLoading = false;
		}
	};

	function getLogForDate(date: Date): ProgressLog | undefined {
		const dateStr = format(date, 'yyyy-MM-dd');
		return progressLogs.find((log) => log.date === dateStr);
	}

	function getHeatmapColor(charactersWritten: number): string {
		if (charactersWritten === 0) return 'bg:theme-surface';
		if (charactersWritten < 500) return 'bg:$(theme.primary)/.08';
		if (charactersWritten < 1000) return 'bg:$(theme.primary)/.16';
		if (charactersWritten < 2000) return 'bg:$(theme.primary)/.24';
		return 'bg:$(theme.primary)/.32';
	}

	const heatmapLegend = [
		{ label: '0', className: 'bg:theme-surface' },
		{ label: '~500', className: 'bg:$(theme.primary)/.08' },
		{ label: '~1000', className: 'bg:$(theme.primary)/.16' },
		{ label: '~2000', className: 'bg:$(theme.primary)/.24' },
		{ label: '2000+', className: 'bg:$(theme.primary)/.32' }
	];

	function calendarDayClass(charactersWritten: number, isToday: boolean): string {
		return [
			'w:full aspect:1/1 r:8 p:4 flex flex-direction:column align-items:center justify-content:center gap:2 transition:all|.2s cursor:pointer fg:theme-text',
			getHeatmapColor(charactersWritten),
			isToday ? 'b:2|solid|theme-text' : 'b:1|solid|theme-border',
			'bg:theme-surface:hover'
		].join(' ');
	}

	function openLogModal(date: Date) {
		selectedDate = date;
		const existingLog = getLogForDate(date);
		logForm = {
			charactersWritten: existingLog?.charactersWritten || 0,
			timeSpent: existingLog?.timeSpent || 0
		};
		showLogModal = true;
	}

	const handleSaveLog = async () => {
		if (!currentProjectStore.project || !selectedDate || isSaving) return;
		isSaving = true;
		const dateStr = format(selectedDate, 'yyyy-MM-dd');
		const changes = {
			charactersWritten: Math.max(0, Math.round(Number(logForm.charactersWritten) || 0)),
			timeSpent: Math.max(0, Math.round(Number(logForm.timeSpent) || 0))
		};
		try {
			const log = await progressLogsDB.create(currentProjectStore.project.id, dateStr);
			await progressLogsDB.update(log.id, changes);
			showLogModal = false;
			await loadProgressLogs();
			toast.success(`${format(selectedDate, 'M月d日', { locale: ja })}の進捗を記録しました`);
		} catch (error) {
			console.error('Failed to save progress log:', error);
			toast.error('進捗の保存に失敗しました');
		} finally {
			isSaving = false;
		}
	};

	async function handleDeleteLog() {
		const log = selectedLog ? ($state.snapshot(selectedLog) as ProgressLog) : null;
		if (!log) return;
		showLogModal = false;
		await deleteWithUndo({
			targetLabel: `${format(parseISO(log.date), 'M月d日', { locale: ja })}の進捗記録`,
			remove: async () => {
				await progressLogsDB.delete(log.id);
				await loadProgressLogs();
			},
			restore: async () => {
				await progressLogsDB.addFromRemote(log);
				await loadProgressLogs();
			}
		});
	}

	function openGoalModal() {
		goalForm = {
			type: goal?.type ?? 'daily',
			target: goal?.target ?? 2000
		};
		showGoalModal = true;
	}

	const handleSaveGoal = async () => {
		const project = currentProjectStore.project;
		const target = Math.round(Number(goalForm.target));
		if (!project || !(target > 0) || isSaving) return;
		isSaving = true;
		try {
			const settings = {
				...$state.snapshot(project.settings),
				goal: { type: goalForm.type, target }
			};
			await projectsDB.update(project.id, { settings });
			await queueChange('projects', project.id, 'update');
			currentProjectStore.project = { ...project, settings };
			showGoalModal = false;
			toast.success('目標を保存しました');
		} catch (error) {
			console.error('Failed to save goal:', error);
			toast.error('目標の保存に失敗しました');
		} finally {
			isSaving = false;
		}
	};

	const previousMonth = () => (currentMonth = subMonths(currentMonth, 1));
	const nextMonth = () => (currentMonth = addMonths(currentMonth, 1));
	const goToToday = () => (currentMonth = new Date());
</script>

<svelte:head>
	<title>進捗 | Storift</title>
</svelte:head>

<div class="flex flex-direction:column w:100% h:100% bg:theme-background fg:theme-text">
	<PageHeader title="進捗" description="執筆の進捗を記録・可視化します">
		{#snippet actions()}
			<button
				type="button"
				class={buttonClass('secondary')}
				onclick={openGoalModal}
				disabled={!currentProjectStore.project}
			>
				目標を設定
			</button>
			<button
				type="button"
				class={buttonClass('primary')}
				onclick={() => openLogModal(new Date())}
				disabled={!currentProjectStore.project}
			>
				今日の記録
			</button>
		{/snippet}
	</PageHeader>

	<main class="flex-grow:1 overflow-y:auto">
		<div class="max-w:1280 mx:auto w:100% px:24 py:24 flex flex-direction:column gap:24">
			{#if isLoading}
				<div class="flex justify-content:center align-items:center h:320">
					<p class="fg:theme-text-secondary font:14">読み込み中...</p>
				</div>
			{:else}
				<div class="flex flex-wrap:wrap gap:16">
					{#each [{ label: '累計文字数', value: stats.totalCharacters.toLocaleString(), unit: '文字' }, { label: '平均執筆量', value: stats.averageDaily.toLocaleString(), unit: '文字/日' }, { label: '最高記録', value: stats.maxDaily.toLocaleString(), unit: '文字/日' }, { label: '連続執筆', value: String(stats.consecutiveDays), unit: '日間' }] as item (item.label)}
						<Card class="flex:1 min-w:160 text-align:center flex flex-direction:column gap:4">
							<p class="font:14 fg:theme-text-secondary m:0">{item.label}</p>
							<p class="font:28 font-weight:600 fg:theme-text m:0">{item.value}</p>
							<p class="font:12 fg:theme-text-secondary m:0">{item.unit}</p>
						</Card>
					{/each}

					<Card class="flex:1 min-w:240 flex flex-direction:column gap:8">
						<div class="flex justify-content:space-between align-items:center">
							<p class="font:14 fg:theme-text-secondary m:0">目標達成率</p>
							<button
								type="button"
								class="font:12 bg:transparent b:none p:0 cursor:pointer fg:theme-text-secondary fg:theme-text:hover text-decoration:underline"
								onclick={openGoalModal}
							>
								変更
							</button>
						</div>
						{#if goal}
							<p class="font:28 font-weight:600 fg:theme-text m:0">{stats.goalProgress}%</p>
							<div
								class="h:8 r:full bg:theme-background b:1|solid|theme-border overflow:hidden"
								role="progressbar"
								aria-label="目標達成率"
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={stats.goalProgress}
							>
								<div class="h:full bg:theme-text" style="width: {stats.goalProgress}%"></div>
							</div>
							<p class="font:12 fg:theme-text-secondary m:0">
								{goalTypeLabels[goal.type]}: {goal.target.toLocaleString()}文字
							</p>
						{:else}
							<p class="font:14 fg:theme-text-secondary m:0">目標が未設定です</p>
						{/if}
					</Card>
				</div>

				<div
					class="grid gap:16 grid-template-columns:minmax(0,1fr) lg:grid-template-columns:repeat(3,minmax(0,1fr))"
				>
					<div class="calendar-col">
						<Card class="flex flex-direction:column gap:16">
							<div class="flex justify-content:space-between align-items:center">
								<h2 class="font:20 font-weight:600 fg:theme-text m:0">
									{format(currentMonth, 'yyyy年M月', { locale: ja })}
								</h2>
								<div class="flex gap:8">
									<button
										type="button"
										class={buttonClass('secondary', 'px:12')}
										aria-label="前の月"
										onclick={previousMonth}>←</button
									>
									<button
										type="button"
										class={buttonClass('secondary', 'px:12')}
										onclick={goToToday}>今日</button
									>
									<button
										type="button"
										class={buttonClass('secondary', 'px:12')}
										aria-label="次の月"
										onclick={nextMonth}>→</button
									>
								</div>
							</div>

							<div class="p:12 bg:theme-surface r:8 b:1|solid|theme-border">
								<p class="font:14 fg:theme-text m:0">
									今月の合計: <span class="font-weight:600">{monthlyTotal.toLocaleString()}</span> 文字
								</p>
							</div>

							<div class="grid gap:4 grid-template-columns:repeat(7,minmax(0,1fr))">
								{#each ['日', '月', '火', '水', '木', '金', '土'] as day (day)}
									<div
										class="text-align:center font:12 font-weight:600 fg:theme-text-secondary py:4"
									>
										{day}
									</div>
								{/each}
								{#each calendarDays as day, i (i)}
									{#if day === null}
										<div class="w:full aspect:1/1"></div>
									{:else}
										{@const log = getLogForDate(day)}
										<button
											type="button"
											class={calendarDayClass(
												log?.charactersWritten || 0,
												isSameDay(day, new Date())
											)}
											aria-label={`${format(day, 'M月d日', { locale: ja })} ${
												log ? `${log.charactersWritten.toLocaleString()}文字` : '記録なし'
											}`}
											onclick={() => openLogModal(day)}
										>
											<span class="font:14 font-weight:600">{format(day, 'd')}</span>
											{#if log}
												<span class="font:10 fg:theme-text-secondary">{log.charactersWritten}</span>
											{/if}
										</button>
									{/if}
								{/each}
							</div>

							<div
								class="flex align-items:center gap:8 pt:16 bt:1|solid|theme-border flex-wrap:wrap"
							>
								<span class="font:12 fg:theme-text-secondary">執筆量:</span>
								{#each heatmapLegend as level (level.label)}
									<div class="flex align-items:center gap:4">
										<div class="w:16 h:16 r:4 b:1|solid|theme-border {level.className}"></div>
										<span class="font:12 fg:theme-text-secondary">{level.label}</span>
									</div>
								{/each}
							</div>
						</Card>
					</div>

					<Card class="flex flex-direction:column gap:16">
						<h2 class="font:18 font-weight:600 fg:theme-text m:0">最近の記録</h2>
						<div class="flex flex-direction:column gap:12">
							{#each recentLogs as log (log.id)}
								<div
									class="p:12 bg:theme-surface r:8 b:1|solid|theme-border flex flex-direction:column gap:8"
								>
									<div class="flex justify-content:space-between align-items:center">
										<span class="font:14 font-weight:600 fg:theme-text">
											{format(parseISO(log.date), 'M月d日(E)', { locale: ja })}
										</span>
										<button
											type="button"
											class={buttonClass('secondary', 'px:10 py:4 font:12')}
											aria-label={`${format(parseISO(log.date), 'M月d日', { locale: ja })}の記録を編集`}
											onclick={() => openLogModal(parseISO(log.date))}
										>
											編集
										</button>
									</div>
									<div class="flex justify-content:space-between">
										<span class="font:12 fg:theme-text-secondary">執筆量</span>
										<span class="font:14 font-weight:600 fg:theme-text">
											{log.charactersWritten.toLocaleString()}文字
										</span>
									</div>
									{#if log.timeSpent > 0}
										<div class="flex justify-content:space-between">
											<span class="font:12 fg:theme-text-secondary">執筆時間</span>
											<span class="font:14 font-weight:600 fg:theme-text">
												{Math.floor(log.timeSpent / 60)}時間{log.timeSpent % 60}分
											</span>
										</div>
									{/if}
								</div>
							{:else}
								<p class="fg:theme-text-secondary font:14 text-align:center py:16 m:0">
									まだ記録がありません
								</p>
							{/each}
						</div>
					</Card>
				</div>
			{/if}
		</div>
	</main>
</div>

<Modal bind:isOpen={showLogModal} title="進捗記録">
	{#if selectedDate}
		<div class="flex flex-direction:column gap:16">
			<div class="p:16 bg:theme-surface r:8 b:1|solid|theme-border">
				<p class="font:14 fg:theme-text-secondary m:0 mb:4">日付</p>
				<p class="font:18 font-weight:600 fg:theme-text m:0">
					{format(selectedDate, 'yyyy年M月d日(E)', { locale: ja })}
				</p>
			</div>

			<FormField label="執筆文字数">
				{#snippet children(id)}
					<input
						{id}
						type="number"
						min="0"
						bind:value={logForm.charactersWritten}
						placeholder="0"
						class={fieldClass}
					/>
				{/snippet}
			</FormField>

			<FormField label="執筆時間(分)">
				{#snippet children(id)}
					<input
						{id}
						type="number"
						min="0"
						bind:value={logForm.timeSpent}
						placeholder="0"
						class={fieldClass}
					/>
				{/snippet}
			</FormField>
		</div>
	{/if}

	{#snippet footer()}
		<ModalActions
			submitLabel="保存"
			submitDisabled={isSaving}
			onsubmit={handleSaveLog}
			oncancel={() => (showLogModal = false)}
		>
			{#snippet extra()}
				{#if selectedLog}
					<button type="button" class={buttonClass('danger')} onclick={handleDeleteLog}>
						記録を削除
					</button>
				{/if}
			{/snippet}
		</ModalActions>
	{/snippet}
</Modal>

<Modal bind:isOpen={showGoalModal} title="執筆目標の設定">
	<div class="flex flex-direction:column gap:16">
		<FormField label="目標の種類">
			{#snippet children(id)}
				<select {id} bind:value={goalForm.type} class={fieldClass}>
					{#each Object.entries(goalTypeLabels) as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			{/snippet}
		</FormField>

		<FormField
			label="目標文字数"
			required
			hint={goalForm.type === 'daily'
				? '1日に書く文字数の目標です。今日の執筆量との比較で達成率を計算します。'
				: '作品全体の目標文字数です。累計文字数との比較で達成率を計算します。'}
		>
			{#snippet children(id)}
				<input
					{id}
					type="number"
					min="1"
					step="100"
					bind:value={goalForm.target}
					placeholder="2000"
					class={fieldClass}
				/>
			{/snippet}
		</FormField>
	</div>

	{#snippet footer()}
		<ModalActions
			submitLabel="保存"
			submitDisabled={!(Number(goalForm.target) > 0) || isSaving}
			onsubmit={handleSaveGoal}
			oncancel={() => (showGoalModal = false)}
		/>
	{/snippet}
</Modal>

<style>
	@media (min-width: 1024px) {
		.calendar-col {
			grid-column: span 2;
		}
	}

	.aspect\:1\/1 {
		aspect-ratio: 1 / 1;
	}
</style>
