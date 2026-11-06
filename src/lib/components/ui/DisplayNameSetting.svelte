<script lang="ts">
	import { onMount } from 'svelte';
	import Button from './Button.svelte';
	import SettingsCard from '$lib/components/settings/SettingsCard.svelte';
	import SettingsRow from '$lib/components/settings/SettingsRow.svelte';
	import Input from './Input.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { settingsDB } from '$lib/db';
	import { settingsStore } from '$lib/stores/settings.svelte';

	// 共有プロジェクトで他のメンバーに見せる名前(参加時のメンバー一覧と、執筆画面の在席表示に使う)
	let name = $state('');
	let saved = $state('');
	let saving = $state(false);

	onMount(async () => {
		try {
			saved = name = (await settingsDB.get()).displayName ?? '';
		} catch (error) {
			console.error('Failed to load display name:', error);
		}
	});

	async function save() {
		saving = true;
		try {
			const value = name.trim();
			await settingsDB.update({ displayName: value || undefined });
			settingsStore.settings = { ...settingsStore.settings, displayName: value || undefined };
			saved = name = value;
			toast.success('表示名を保存しました');
		} catch (error) {
			console.error('Failed to save display name:', error);
			toast.error('表示名の保存に失敗しました');
		} finally {
			saving = false;
		}
	}
</script>

<SettingsCard
	title="共有時の表示名"
	description="共有プロジェクトで他のメンバーに表示される名前です。"
>
	<SettingsRow
		stacked
		label="表示名"
		description="未設定のときは、オーナーは「オーナー」、ゲストは「ゲスト-xxxx」になります。参加時に使われる名前は、参加した時点のものです。"
	>
		<Input bind:value={name} placeholder="例: 山田" ariaLabel="共有時の表示名" />
		<div>
			<Button onclick={save} disabled={saving || name.trim() === saved}>
				{saving ? '保存中...' : '保存'}
			</Button>
		</div>
	</SettingsRow>
</SettingsCard>
