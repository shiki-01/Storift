/** OpenAI 互換 API のプリセット(Base URL と、モデル名の例) */

export interface OpenAiPreset {
	id: string;
	label: string;
	baseUrl: string;
	/** モデル名の例(入力欄の placeholder)。実際に使えるモデルは接続後の一覧で確かめる */
	modelExample: string;
	/** API キーが必須か(ローカルのサーバーなどは不要) */
	keyRequired: boolean;
	note?: string;
}

export const OPENAI_PRESETS: readonly OpenAiPreset[] = [
	{
		id: 'openai',
		label: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		modelExample: 'gpt-4.1-mini',
		keyRequired: true
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		baseUrl: 'https://openrouter.ai/api/v1',
		modelExample: 'openai/gpt-4.1-mini',
		keyRequired: true,
		note: '多くの会社のモデルを 1 つのキーで使えます。'
	},
	{
		id: 'lmstudio',
		label: 'LM Studio(ローカル)',
		baseUrl: 'http://localhost:1234/v1',
		modelExample: 'qwen3-8b',
		keyRequired: false,
		note: 'LM Studio のローカルサーバーを起動しておきます。キーは不要です。'
	},
	{
		id: 'groq',
		label: 'Groq',
		baseUrl: 'https://api.groq.com/openai/v1',
		modelExample: 'llama-3.3-70b-versatile',
		keyRequired: true
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		baseUrl: 'https://api.deepseek.com/v1',
		modelExample: 'deepseek-chat',
		keyRequired: true
	},
	{
		id: 'mistral',
		label: 'Mistral',
		baseUrl: 'https://api.mistral.ai/v1',
		modelExample: 'mistral-large-latest',
		keyRequired: true
	},
	{
		id: 'custom',
		label: 'カスタム',
		baseUrl: '',
		modelExample: 'モデル名',
		keyRequired: false,
		note: 'vLLM など、/chat/completions に対応したサーバーの Base URL を入力します。キーが不要なサーバーでは空のままで構いません。'
	}
];

export function findPreset(id: string): OpenAiPreset {
	return OPENAI_PRESETS.find((p) => p.id === id) ?? OPENAI_PRESETS[OPENAI_PRESETS.length - 1];
}
