<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { projectsStore } from '$lib/stores/projects.svelte';
	import { projectsDB } from '$lib/db';
	import { SAMPLE_PROJECT_ID, createSampleProject, hasSampleProject } from '$lib/tutorial/sample';
	import { tutorialSteps, type TutorialLink } from './steps';

	interface TutorialModalProps {
		isOpen?: boolean;
		onClose?: () => void;
	}

	let { isOpen = $bindable(false), onClose }: TutorialModalProps = $props();

	const total = tutorialSteps.length;
	let index = $state(0);
	let lastProjectId = $state<string | null>(null);
	let sampleExists = $state(false);
	let sampleBusy = $state(false);

	let step = $derived(tutorialSteps[index]);
	let isFirst = $derived(index === 0);
	let isLast = $derived(index === total - 1);

	// 開くたびに最初のステップから始め、作品の有無はそのときの状態で確認する
	$effect(() => {
		if (!isOpen) return;
		index = 0;
		void refreshState();
	});

	// 矢印キーでステップを移動する(Esc で閉じる処理は Modal が行う)
	$effect(() => {
		if (!isOpen) return;
		const onKeydown = (e: KeyboardEvent) => {
			// 前面に確認ダイアログが出ているときは、そちらの操作を優先する
			if (document.querySelector('[role="alertdialog"]')) return;
			if (e.key === 'ArrowRight') next();
			else if (e.key === 'ArrowLeft') prev();
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	async function refreshState() {
		try {
			// 最後に開いた作品が消えていれば、作品への「ここを開く」は出さない
			let id: string | null = null;
			try {
				id = localStorage.getItem('storift:last-project');
			} catch {
				id = null;
			}
			lastProjectId = id && (await projectsDB.getById(id)) ? id : null;
			sampleExists = await hasSampleProject();
		} catch (error) {
			console.error('Failed to load tutorial state:', error);
		}
	}

	function next() {
		if (index < total - 1) index += 1;
	}

	function prev() {
		if (index > 0) index -= 1;
	}

	function close() {
		isOpen = false;
		onClose?.();
	}

	function linkHref(link: TutorialLink): string | null {
		if (link.target === 'home') return '/home';
		if (link.target === 'settings') return '/settings';
		return lastProjectId ? `/project/${lastProjectId}/${link.page}` : null;
	}

	function openLink(link: TutorialLink) {
		const href = linkHref(link);
		if (!href) return;
		close();
		void goto(href);
	}

	async function handleSample() {
		if (sampleBusy) return;

		// 既にあれば作り直さず、開くだけにする
		if (sampleExists) {
			close();
			void goto(`/project/${SAMPLE_PROJECT_ID}/editor`);
			return;
		}

		sampleBusy = true;
		try {
			const { project, created } = await createSampleProject();
			sampleExists = true;
			if (created) {
				projectsStore.projects = [
					project,
					...projectsStore.projects.filter((p) => p.id !== project.id)
				];
				toast.success('サンプル作品を作成しました');
			}
		} catch (error) {
			console.error('Failed to create sample project:', error);
			toast.error('サンプル作品の作成に失敗しました');
		} finally {
			sampleBusy = false;
		}
	}
</script>

<Modal bind:isOpen title={step.title} {onClose} size="medium">
	{#snippet footer()}
		<div class="tutorial-footer">
			<Button variant="ghost" onclick={close}>閉じる</Button>
			<div class="tutorial-nav">
				<Button variant="secondary" onclick={prev} disabled={isFirst}>前へ</Button>
				{#if isLast}
					<Button onclick={close}>完了</Button>
				{:else}
					<Button onclick={next}>次へ</Button>
				{/if}
			</div>
		</div>
	{/snippet}

	<div class="tutorial">
		<p class="tutorial-count">{index + 1} / {total}</p>

		{#each step.body as paragraph, i (i)}
			<p class="tutorial-text">{paragraph}</p>
		{/each}

		{#if step.sample}
			<div>
				<Button variant="secondary" onclick={handleSample} disabled={sampleBusy}>
					{sampleBusy ? '作成中...' : sampleExists ? 'サンプル作品を開く' : 'サンプル作品を作る'}
				</Button>
			</div>
		{/if}

		{#if step.link}
			{@const link = step.link}
			{#if linkHref(link)}
				<div>
					<Button variant="ghost" onclick={() => openLink(link)}>{link.label} →</Button>
				</div>
			{/if}
		{/if}
	</div>
</Modal>

<style>
	.tutorial {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 14px;
	}

	.tutorial-count {
		margin: 0;
		font-size: 12px;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	.tutorial-text {
		margin: 0;
		font-size: 14.5px;
		line-height: 1.8;
		color: var(--color-text);
	}

	.tutorial-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.tutorial-nav {
		display: flex;
		gap: 8px;
		margin-left: auto;
	}
</style>
