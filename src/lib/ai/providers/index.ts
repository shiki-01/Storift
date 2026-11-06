/** 組み込みのプロバイダを登録簿に登録する */
import { registry } from '../registry';
import { anthropicProvider } from './anthropic';
import { claudeCodeProvider } from './claudeCode';
import { geminiProvider } from './gemini';
import { ollamaProvider } from './ollama';
import { openaiCompatibleProvider } from './openaiCompatible';

let registered = false;

/** 組み込みのプロバイダを登録する(何度呼んでも 1 回だけ) */
export function registerBuiltinProviders(): void {
	if (registered) return;
	registered = true;
	// 設定画面の並び順
	for (const p of [
		claudeCodeProvider,
		openaiCompatibleProvider,
		anthropicProvider,
		geminiProvider,
		ollamaProvider
	])
		registry.register(p);
}
