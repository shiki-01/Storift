/** プロバイダの登録と検索 */
import type { AiProvider, AiProviderId, AiSettings } from './types';

/** 登録がないときや、保存された ID が今は無いときに使うプロバイダ */
export const FALLBACK_PROVIDER_ID: AiProviderId = 'claude-code';

export class ProviderRegistry {
	private readonly providers = new Map<AiProviderId, AiProvider>();

	register(provider: AiProvider): void {
		if (this.providers.has(provider.id))
			throw new Error(`AI プロバイダが重複して登録されました: ${provider.id}`);
		this.providers.set(provider.id, provider);
	}

	has(id: AiProviderId): boolean {
		return this.providers.has(id);
	}

	get(id: AiProviderId): AiProvider | undefined {
		return this.providers.get(id);
	}

	/** 登録順の一覧 */
	list(): AiProvider[] {
		return [...this.providers.values()];
	}

	/** 登録のない ID は既定のプロバイダに読み替える */
	resolve(id: AiProviderId): AiProvider {
		const found = this.providers.get(id) ?? this.providers.get(FALLBACK_PROVIDER_ID);
		if (!found) throw new Error('AI プロバイダが登録されていません');
		return found;
	}

	/**
	 * セッション ID を発行したプロバイダ。接頭辞で見分け、どれにも当たらなければ
	 * 接頭辞のない ID を発行する既定のプロバイダ(Claude Code)のもの
	 */
	ownerOfSession(sessionId: string): AiProviderId {
		for (const p of this.providers.values()) {
			if (p.sessionPrefix && sessionId.startsWith(p.sessionPrefix)) return p.id;
		}
		return FALLBACK_PROVIDER_ID;
	}
}

/** アプリで使う登録簿。組み込みのプロバイダは providers/index.ts が登録する */
export const registry = new ProviderRegistry();

/**
 * パネルに出す「プロバイダ名・モデル名」。モデルが未選択(Claude Code の既定など)ならプロバイダ名だけ。
 * どのプロバイダの設定にも `model` があるので、settingsKey で引く。
 */
export function describeActiveModel(provider: AiProvider, settings: AiSettings): string {
	const model = (settings[provider.settingsKey] as { model?: string }).model?.trim();
	return model ? `${provider.label}・${model}` : provider.label;
}
