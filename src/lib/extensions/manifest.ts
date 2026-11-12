/**
 * 拡張のマニフェスト(`extensions/<id>/manifest.json`)の型と、実行時の検証。
 *
 * マニフェストは、アプリ(同梱する拡張の一覧・同意画面・設定)と紹介サイト(拡張ページ)の両方が読む、
 * 拡張についての単一の情報源。このファイルは紹介サイト(site/)からも読み込むので、
 * 他のモジュールに依存させない(純関数と定数だけを置く)。
 */

import { validateContributions, type PackContributions } from './pack';

/** マニフェストの形式の版。互換性のない変更をしたら上げる */
export const MANIFEST_API_VERSION = 1;

/** 拡張が動作するプラットフォーム。web は Web 版(PWA)、desktop はデスクトップ版(Tauri) */
export type ExtensionPlatform = 'web' | 'desktop';

/**
 * 拡張の種類。
 * - official: アプリに同梱する公式の拡張(特権が必要なものを含む)
 * - pack: コードを含まない JSON(テーマ・辞書など)。通信せず、コードも実行しない
 * - script: sandbox 付きの iframe で隔離して実行するスクリプト。第 3 段階で対応する予定
 */
export type ExtensionKind = 'official' | 'pack' | 'script';

export const EXTENSION_PLATFORMS: readonly ExtensionPlatform[] = ['web', 'desktop'];
export const EXTENSION_KINDS: readonly ExtensionKind[] = ['official', 'pack', 'script'];

/** 拡張が購読を宣言できるイベント */
export const PERMISSION_EVENTS = [
	'page:change',
	'app:visibility',
	'scene:updated',
	'scene:created',
	'session:start',
	'session:update',
	'session:end'
] as const;
export type PermissionEvent = (typeof PERMISSION_EVENTS)[number];

/** 拡張が読み取りを宣言できる本体の情報 */
export const PERMISSION_READS = ['project:title', 'project:chars'] as const;
export type PermissionRead = (typeof PERMISSION_READS)[number];

export interface ExtensionPermissions {
	/** 購読するイベントの名前。宣言していないイベントは購読できない */
	events?: PermissionEvent[];
	/** 読み取る本体の情報。`project:title` を宣言した拡張にだけ作品名を、`project:chars` を宣言した拡張にだけ作品の総文字数を渡す */
	read?: PermissionRead[];
	/** 通信する相手のホスト名(完全一致。ワイルドカード・ポート・パスは書けない) */
	network?: string[];
	/** 端末内に設定などを保存するか */
	storage?: boolean;
}

/** 外部へ送る情報の 1 件(送り先ごと) */
export interface ExtensionPrivacySend {
	/** 送り先(ホスト名や、相手の名前) */
	to: string;
	/** 送る項目 */
	items: string[];
	/** いつ送るか */
	when: string;
}

export interface ExtensionPrivacy {
	/** 外部へ送る情報。送らないなら空の配列 */
	sends: ExtensionPrivacySend[];
	/** 端末内に保存する情報と、その保存場所 */
	stores: string[];
	/** 無効にした(連携を解除した)ときの扱い */
	onDisable: string;
	/** 補足(送らないもの・相手側の規約など) */
	notes?: string[];
}

export interface ExtensionManifest {
	/** 一意な ID。フォルダ名と同じ(英小文字・数字・ハイフン) */
	id: string;
	/** 表示名 */
	name: string;
	/** 説明(1 〜 2 文) */
	description: string;
	/** 拡張の版(semver) */
	version: string;
	author: string;
	kind: ExtensionKind;
	apiVersion: typeof MANIFEST_API_VERSION;
	/** 動作するプラットフォーム。含まれない環境では無効表示になり、読み込みもしない */
	platforms: ExtensionPlatform[];
	/** アイコンの名前(アプリの src/lib/components/editor/icons の SVG) */
	icon: string;
	homepage?: string;
	license?: string;
	/** 最後に更新した日(YYYY-MM-DD)。レジストリの一覧に載せる(ビルドを再現可能にするため、コミット日時ではなくこの値を使う)。パックでは必須 */
	updatedAt?: string;
	permissions: ExtensionPermissions;
	privacy: ExtensionPrivacy;
	/** パック(kind: 'pack')の貢献。貢献の種類ごとに、コンテンツ(JSON)への相対パスを書く */
	contributions?: PackContributions;
}

/** 公式の拡張(アプリに同梱)の ID。kind: 'official' を名乗れるのはこれだけ */
export const OFFICIAL_EXTENSION_IDS: readonly string[] = ['monolog', 'discord'];

/** 公式以外が使えない ID(公式と誤認させない)。`official-` で始まるものも不可 */
export const RESERVED_EXTENSION_IDS: readonly string[] = [...OFFICIAL_EXTENSION_IDS, 'submit'];

/** 公式以外が使えない ID か */
export function isReservedId(id: string): boolean {
	return RESERVED_EXTENSION_IDS.includes(id) || id.startsWith('official-');
}

export type ManifestValidation =
	| { ok: true; manifest: ExtensionManifest }
	| { ok: false; errors: string[] };

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ICON_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// https://semver.org の正規表現(先頭の v は認めない)
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
// ホスト名(ラベルを . でつないだもの。スキーム・ポート・パス・ワイルドカードは不可)
const HOSTNAME_PATTERN =
	/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const MANIFEST_KEYS = [
	'id',
	'name',
	'description',
	'version',
	'author',
	'kind',
	'apiVersion',
	'platforms',
	'icon',
	'homepage',
	'license',
	'updatedAt',
	'permissions',
	'privacy',
	'contributions'
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isTextArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isText);
}

function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[]): string[] {
	return Object.keys(obj).filter((key) => !allowed.includes(key));
}

/** YYYY-MM-DD の実在する日付か */
function isIsoDate(value: unknown): boolean {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isHttpsUrl(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}

function validatePermissions(value: unknown, errors: string[]): void {
	if (!isRecord(value)) {
		errors.push('permissions はオブジェクトで指定してください(何も使わないなら {})');
		return;
	}
	for (const key of unknownKeys(value, ['events', 'read', 'network', 'storage'])) {
		errors.push(`permissions.${key} は使えない項目です`);
	}
	if (value.events !== undefined) {
		if (!Array.isArray(value.events)) errors.push('permissions.events は配列で指定してください');
		else
			for (const name of value.events) {
				if (!(PERMISSION_EVENTS as readonly unknown[]).includes(name))
					errors.push(`permissions.events に使えないイベントがあります: ${String(name)}`);
			}
	}
	if (value.read !== undefined) {
		if (!Array.isArray(value.read)) errors.push('permissions.read は配列で指定してください');
		else
			for (const name of value.read) {
				if (!(PERMISSION_READS as readonly unknown[]).includes(name))
					errors.push(`permissions.read に使えない項目があります: ${String(name)}`);
			}
	}
	if (value.network !== undefined) {
		if (!Array.isArray(value.network)) errors.push('permissions.network は配列で指定してください');
		else
			for (const host of value.network) {
				if (typeof host !== 'string' || !HOSTNAME_PATTERN.test(host))
					errors.push(
						`permissions.network はホスト名(小文字。完全一致)で指定してください: ${String(host)}`
					);
			}
	}
	if (value.storage !== undefined && typeof value.storage !== 'boolean') {
		errors.push('permissions.storage は true / false で指定してください');
	}
}

function validatePrivacy(value: unknown, errors: string[]): void {
	if (!isRecord(value)) {
		errors.push('privacy はオブジェクトで指定してください');
		return;
	}
	for (const key of unknownKeys(value, ['sends', 'stores', 'onDisable', 'notes'])) {
		errors.push(`privacy.${key} は使えない項目です`);
	}
	if (!Array.isArray(value.sends)) {
		errors.push('privacy.sends は配列で指定してください(外部へ送らないなら [])');
	} else {
		value.sends.forEach((send, i) => {
			if (!isRecord(send)) {
				errors.push(`privacy.sends[${i}] はオブジェクトで指定してください`);
				return;
			}
			for (const key of unknownKeys(send, ['to', 'items', 'when'])) {
				errors.push(`privacy.sends[${i}].${key} は使えない項目です`);
			}
			if (!isText(send.to)) errors.push(`privacy.sends[${i}].to(送り先)を書いてください`);
			if (!isTextArray(send.items) || send.items.length === 0)
				errors.push(`privacy.sends[${i}].items(送る項目)を 1 つ以上書いてください`);
			if (!isText(send.when)) errors.push(`privacy.sends[${i}].when(いつ送るか)を書いてください`);
		});
	}
	if (!isTextArray(value.stores))
		errors.push('privacy.stores は文字列の配列で指定してください(保存しないなら [])');
	if (!isText(value.onDisable))
		errors.push('privacy.onDisable(無効にしたときの扱い)を書いてください');
	if (value.notes !== undefined && !isTextArray(value.notes))
		errors.push('privacy.notes は文字列の配列で指定してください');
}

/** 種類(kind)ごとの決まり。パックは通信せず、イベントも購読せず、本体の情報も読まない */
function validateKindRules(input: Record<string, unknown>, errors: string[]): void {
	const id = typeof input.id === 'string' ? input.id : '';
	if (input.kind !== 'official' && id && isReservedId(id)) {
		errors.push(`id「${id}」は予約されています(公式と誤認させないため、別の ID にしてください)`);
	}
	if (input.kind !== 'pack') {
		if (input.contributions !== undefined)
			errors.push('contributions は kind: pack の拡張だけが持てます');
		return;
	}
	if (input.contributions === undefined) {
		errors.push('パックには contributions(貢献するコンテンツ)が必要です');
	} else {
		validateContributions(input.contributions, errors);
	}
	if (!isText(input.license)) errors.push('パックには license(ライセンス)が必要です');
	if (input.updatedAt === undefined) errors.push('パックには updatedAt(更新日)が必要です');
	const permissions = isRecord(input.permissions) ? input.permissions : {};
	for (const key of ['network', 'events', 'read']) {
		const value = permissions[key];
		if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
			errors.push(
				`パックは permissions.${key} を持てません(通信せず、本体のイベントも情報も扱いません)`
			);
		}
	}
	const privacy = isRecord(input.privacy) ? input.privacy : {};
	if (Array.isArray(privacy.sends) && privacy.sends.length > 0) {
		errors.push('パックは外部へ情報を送れません(privacy.sends は [] にしてください)');
	}
}

/** マニフェストを検証する。問題があれば、すべての問題を日本語の文で返す */
export function validateManifest(input: unknown): ManifestValidation {
	if (!isRecord(input)) return { ok: false, errors: ['マニフェストは JSON のオブジェクトです'] };
	const errors: string[] = [];

	for (const key of unknownKeys(input, MANIFEST_KEYS)) errors.push(`${key} は使えない項目です`);

	if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id) || input.id.length > 64)
		errors.push('id は英小文字・数字・ハイフンで指定してください(64 文字まで)');
	if (!isText(input.name)) errors.push('name(表示名)を書いてください');
	if (!isText(input.description)) errors.push('description(説明)を書いてください');
	if (typeof input.version !== 'string' || !SEMVER_PATTERN.test(input.version))
		errors.push('version は semver(例: 1.0.0)で指定してください');
	if (!isText(input.author)) errors.push('author(作者)を書いてください');
	if (!(EXTENSION_KINDS as readonly unknown[]).includes(input.kind))
		errors.push(`kind は ${EXTENSION_KINDS.join(' / ')} のいずれかです`);
	if (input.apiVersion !== MANIFEST_API_VERSION)
		errors.push(`apiVersion は ${MANIFEST_API_VERSION} を指定してください`);

	if (!Array.isArray(input.platforms) || input.platforms.length === 0) {
		errors.push('platforms は web / desktop を 1 つ以上指定してください');
	} else {
		for (const p of input.platforms) {
			if (!(EXTENSION_PLATFORMS as readonly unknown[]).includes(p))
				errors.push(`platforms に使えない値があります: ${String(p)}`);
		}
		if (new Set(input.platforms).size !== input.platforms.length)
			errors.push('platforms に同じ値が重複しています');
	}

	if (typeof input.icon !== 'string' || !ICON_PATTERN.test(input.icon))
		errors.push('icon はアイコンの名前(英小文字・数字・ハイフン)で指定してください');
	if (input.homepage !== undefined && !isHttpsUrl(input.homepage))
		errors.push('homepage は https:// の URL で指定してください');
	if (input.license !== undefined && !isText(input.license))
		errors.push('license は文字列で指定してください');
	if (input.updatedAt !== undefined && !isIsoDate(input.updatedAt))
		errors.push('updatedAt は実在する日付を YYYY-MM-DD の形式で指定してください');

	validatePermissions(input.permissions, errors);
	validatePrivacy(input.privacy, errors);

	validateKindRules(input, errors);

	// 宣言と説明の食い違い: 通信を宣言したのに、送る情報の説明が無い
	if (
		errors.length === 0 &&
		isRecord(input.permissions) &&
		Array.isArray(input.permissions.network) &&
		input.permissions.network.length > 0 &&
		isRecord(input.privacy) &&
		Array.isArray(input.privacy.sends) &&
		input.privacy.sends.length === 0
	) {
		errors.push('permissions.network を宣言した拡張は、privacy.sends に送る情報を書いてください');
	}

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, manifest: input as unknown as ExtensionManifest };
}

/** 検証に通らなければ例外にする(同梱する拡張の読み込み用。ビルド・起動時に気付けるようにする) */
export function parseManifest(input: unknown, label = 'manifest'): ExtensionManifest {
	const result = validateManifest(input);
	if (!result.ok) {
		throw new Error(
			`拡張のマニフェストが正しくありません(${label}):\n- ${result.errors.join('\n- ')}`
		);
	}
	return result.manifest;
}

/** キーの順序に左右されない JSON 文字列(同意したときの内容との比較用) */
function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.filter((key) => value[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

/**
 * 同意の対象になる内容(permissions と privacy)を、比較できる文字列にする。
 * 同意したときの値と違えば、扱う情報が変わったとみなして再同意を求める
 */
export function consentFingerprint(
	manifest: Pick<ExtensionManifest, 'permissions' | 'privacy'>
): string {
	return stableStringify({ permissions: manifest.permissions, privacy: manifest.privacy });
}

export const PLATFORM_LABELS: Record<ExtensionPlatform, string> = {
	web: 'Web 版',
	desktop: 'デスクトップ版'
};

export const KIND_LABELS: Record<ExtensionKind, string> = {
	official: '公式',
	pack: 'パック',
	script: 'スクリプト'
};

/**
 * 拡張の出所。UI では必ずラベルを出し、公式と誤認させない。
 * - official: Storift に同梱
 * - community: 公式リポジトリの extensions/<id>/ に PR で追加されたもの(リポジトリ上でレビューされる)
 * - personal-file: 「ファイルから追加」で入れたもの(未審査)
 * - personal-folder: デスクトップ版の「拡張フォルダ」から読み込んだもの(未審査)
 */
export type ExtensionOrigin = 'official' | 'community' | 'personal-file' | 'personal-folder';

export const ORIGIN_LABELS: Record<ExtensionOrigin, string> = {
	official: '公式',
	community: 'コミュニティ',
	'personal-file': '個人追加(未審査)',
	'personal-folder': '個人フォルダ(未審査)'
};

/** 出所の補足(詳細・同意画面に出す) */
export const ORIGIN_NOTES: Record<ExtensionOrigin, string> = {
	official: 'Storift に同梱している拡張です。',
	community:
		'コミュニティの作者が公開した拡張です。公式のものではありません。公開前にリポジトリ上でレビューされますが、内容は保証されません。',
	'personal-file':
		'ファイルから追加した拡張です。未審査で、公式のものではありません。内容を確認できるものだけを追加してください(自己責任)。',
	'personal-folder':
		'拡張フォルダから読み込んだ拡張です。未審査で、公式のものではありません。内容を確認できるものだけを置いてください(自己責任)。'
};

const EVENT_LABELS: Record<PermissionEvent, string> = {
	'page:change': '開いている画面(ホーム・執筆・プロットなど。固定の種類だけ)',
	'app:visibility': 'アプリが前面にあるか(別のウィンドウに移ったか)',
	'scene:updated': '本文が保存されたこと(シーンと文字数。本文は含みません)',
	'scene:created': 'シーンが作成されたこと',
	'session:start': '執筆セッションの開始',
	'session:update': '執筆セッションの経過(最後の編集の時刻・増減した文字数)',
	'session:end': '執筆セッションの終了'
};

const READ_LABELS: Record<PermissionRead, string> = {
	'project:title': '作品名',
	'project:chars': '作品の総文字数'
};

/** 権限の説明(同意画面・設定・サイトで同じ文を出す) */
export interface PermissionSummary {
	/** 本体から受け取る情報 */
	receives: string[];
	/** 通信する相手のホスト名 */
	network: string[];
	/** 端末内に保存するか */
	storage: boolean;
}

export function summarizePermissions(permissions: ExtensionPermissions): PermissionSummary {
	return {
		receives: [
			...(permissions.events ?? []).map((name) => EVENT_LABELS[name]),
			...(permissions.read ?? []).map((name) => READ_LABELS[name])
		],
		network: [...(permissions.network ?? [])],
		storage: permissions.storage === true
	};
}

/** 対応プラットフォームの表示(例: 「Web 版・デスクトップ版」「デスクトップ版のみ」) */
export function platformsLabel(platforms: readonly ExtensionPlatform[]): string {
	const labels = EXTENSION_PLATFORMS.filter((p) => platforms.includes(p)).map(
		(p) => PLATFORM_LABELS[p]
	);
	return labels.length === 1 ? `${labels[0]}のみ` : labels.join('・');
}
