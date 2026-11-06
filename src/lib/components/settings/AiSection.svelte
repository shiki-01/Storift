<script lang="ts">
	// 設定「AI」(デスクトップ版のみ)。現在は Claude Code の設定だけ。
	// 今後の AI 関連の設定は、この中身(ClaudeSettings など)を拡張して追加する
	import ClaudeSettings from '$lib/components/desktop/ClaudeSettings.svelte';
	import SettingsCard from './SettingsCard.svelte';
</script>

<SettingsCard title="Claude Code">
	<ClaudeSettings />
</SettingsCard>
