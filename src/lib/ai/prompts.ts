/**
 * HTTP 系プロバイダ(自前でエージェントのループを回すもの)が共通で使うシステムプロンプト。
 * Claude Code は自前の指示を持つので使わない。Ollama は Rust 側(ollama.rs)に同じ文面を持つ。
 */
import { EDIT_INSTRUCTIONS } from '$lib/desktop/edits';
import { REFERENCE_INSTRUCTIONS } from './refs';

export { EDIT_INSTRUCTIONS, REFERENCE_INSTRUCTIONS };

export const BASE_SYSTEM_PROMPT =
	'あなたは小説の執筆を支える日本語のアシスタントです。' +
	'作品の原稿・キャラクター・プロット・設定資料は、用意されたツールで読み取ってから答えてください。' +
	'ツールで確かめていないことを事実として述べず、推測のときはそう伝えてください。' +
	'回答は日本語で、簡潔に書いてください。';

/** 会話の最初に置くシステムプロンプト(追加の指示があれば後ろに続ける) */
export function buildSystemPrompt(extra?: string): string {
	return extra ? `${BASE_SYSTEM_PROMPT}\n\n${extra}` : BASE_SYSTEM_PROMPT;
}
