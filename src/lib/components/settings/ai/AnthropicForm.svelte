<script lang="ts">
	// 設定「AI」: Anthropic API の項目
	import ApiKeyProviderForm from './ApiKeyProviderForm.svelte';
	import { ANTHROPIC_MODEL_EXAMPLES, PROVIDER_ID, SECRET_NAME } from '$lib/ai/providers/anthropic';
	import { DEFAULT_ANTHROPIC_MAX_TOKENS, DEFAULT_ANTHROPIC_URL } from '$lib/ai/settings';
</script>

<ApiKeyProviderForm
	providerId={PROVIDER_ID}
	secretName={SECRET_NAME}
	defaultBaseUrl={DEFAULT_ANTHROPIC_URL}
	modelExamples={ANTHROPIC_MODEL_EXAMPLES}
	keyHint="Anthropic Console(console.anthropic.com)で発行した API キーを入力します。Claude の利用料金とは別に、API の利用分が課金されます。"
	tokens={{
		key: 'maxTokens',
		label: '最大トークン数',
		hint: '1 回の応答で生成する上限です(Anthropic API では必須。既定 8192)。長い回答が途中で切れるときは増やします。',
		optional: false,
		defaultValue: DEFAULT_ANTHROPIC_MAX_TOKENS
	}}
/>
