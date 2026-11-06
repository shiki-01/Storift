<script lang="ts">
	// 設定「AI」: Gemini API の項目
	import ApiKeyProviderForm from './ApiKeyProviderForm.svelte';
	import { GEMINI_MODEL_EXAMPLES, PROVIDER_ID, SECRET_NAME } from '$lib/ai/providers/gemini';
	import { DEFAULT_GEMINI_URL } from '$lib/ai/settings';
</script>

<ApiKeyProviderForm
	providerId={PROVIDER_ID}
	secretName={SECRET_NAME}
	defaultBaseUrl={DEFAULT_GEMINI_URL}
	modelExamples={GEMINI_MODEL_EXAMPLES}
	keyHint="Google AI Studio(aistudio.google.com)で発行した API キーを入力します。キーは通信のヘッダーだけに載せ、URL には付けません。"
	tokens={{
		key: 'maxOutputTokens',
		label: '最大トークン数',
		hint: '1 回の応答で生成する上限です。空ならモデルの既定に任せます。',
		optional: true
	}}
/>
