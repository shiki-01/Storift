<script lang="ts">
	import { onMount } from 'svelte';
	import SettingsCard from '$lib/components/settings/SettingsCard.svelte';
	import SettingsRow from '$lib/components/settings/SettingsRow.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { settingsDB } from '$lib/db';
	import { settingsStore } from '$lib/stores/settings.svelte';

	// 共同編集中に他の人のカーソル/選択範囲を表示するか(この端末だけの設定。未設定は表示)
	let enabled = $state(settingsStore.settings.showRemoteCursors !== false);

	// ストアは読み込み前かもしれないので、保存されている値を読み直す
	onMount(async () => {
		try {
			enabled = (await settingsDB.get()).showRemoteCursors !== false;
		} catch (error) {
			console.error('Failed to load remote cursor setting:', error);
		}
	});

	async function toggle() {
		const next = !enabled;
		enabled = next;
		try {
			await settingsDB.update({ showRemoteCursors: next });
			settingsStore.settings = { ...settingsStore.settings, showRemoteCursors: next };
		} catch (error) {
			console.error('Failed to save remote cursor setting:', error);
			enabled = !next;
			toast.error('設定を保存できませんでした');
		}
	}
</script>

<SettingsCard
	title="共同編集のカーソル表示"
	description="共有プロジェクトで同じシーンを開いている人のカーソルを表示するかを選びます。"
>
	<SettingsRow
		label="他の人のカーソルを表示"
		labelFor="showRemoteCursors"
		description="カーソルと選択範囲を本文に色付きで表示します。オフにすると、通信量を抑えるため自分のカーソルも他の人に送りません(誰がどのシーンを開いているかの表示は変わりません)。この端末だけの設定です。"
	>
		<input id="showRemoteCursors" type="checkbox" checked={enabled} onchange={toggle} />
	</SettingsRow>
</SettingsCard>
