/**
 * Discord Rich Presence の定数。
 * Application ID は、Discord Developer Portal で作ったアプリケーションの ID(公開してよい値)。
 * Discord 側の表示名と画像(アセット)は、この ID のアプリケーションに登録したものが使われる
 */
export const DISCORD_APPLICATION_ID = '1570411903996661791';

/** Discord に登録した画像(Rich Presence のアセット)のキー(Developer Portal に登録済み) */
export const LARGE_IMAGE_KEY = 'logo';
export const LARGE_IMAGE_TEXT = 'Storift';
/** 小さい画像は、執筆セッション中だけ出す(説明文は、そのときの画面のラベル) */
export const SMALL_IMAGE_KEY = 'writing';

/** Application ID の形式(Discord の ID は数字だけ) */
export function isValidApplicationId(value: string): boolean {
	return /^\d{15,25}$/.test(value);
}

/**
 * 使う Application ID。利用者が設定で上書きしていればその値、空なら既定の ID。
 * 上書きの値が正しい形式でなければ、既定の ID を使う
 */
export function resolveApplicationId(override: string): string {
	const custom = override.trim();
	return custom && isValidApplicationId(custom) ? custom : DISCORD_APPLICATION_ID;
}
