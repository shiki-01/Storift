/**
 * 拡張のマニフェスト(`extensions/<id>/manifest.json`)の型と、実行時の検証。
 *
 * マニフェストは、アプリ(同梱する拡張の一覧・同意画面・設定)と紹介サイト(拡張ページ)の両方が読む、
 * 拡張についての単一の情報源。このファイルは紹介サイト(site/)からも読み込むので、
 * パックの検証(pack.ts)以外のモジュールに依存させない(純関数と定数だけを置く)。
 */

import { validateContributions, type PackContributions } from './pack';
import { SCRIPT_LIMITS } from './script/limits';

// 紹介サイト(site/)は manifest.ts だけを読み込むので、表示に使うパックの定数もここから出す
export {
	ALLOWED_LICENSES,
	CONTRIBUTION_LABELS,
	PACK_LIMITS,
	contributionKinds,
	type ContributionKind
} from './pack';

/** マニフェストの形式の版。互換性のない変更をしたら上げる */
export const MANIFEST_API_VERSION = 1;

/** 拡張が動作するプラットフォーム。web は Web 版(PWA)、desktop はデスクトップ版(Tauri) */
export type ExtensionPlatform = 'web' | 'desktop';

/**
 * 拡張の種類。
 * - official: アプリに同梱する公式の拡張(特権が必要なものを含む)
 * - pack: コードを含まない JSON(テーマ・辞書など)。通信せず、コードも実行しない
 * - script: sandbox 付きの iframe の中の Web Worker で隔離して実行するスクリプト(docs/SCRIPT_API.md)
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
	/** 通知(トースト)を出すか。スクリプトだけ */
	notify?: boolean;
	/** 画面(ツールバーのポップアップ・設定欄)を宣言的に描画するか。スクリプトだけ */
	ui?: boolean;
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
	/** スクリプト(kind: 'script')の本体のファイル名(拡張のフォルダ直下の 1 ファイル) */
	entry?: string;
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
// スクリプトの本体のファイル名(拡張のフォルダ直下の .js)
const ENTRY_PATTERN = /^[a-z0-9][a-z0-9_-]*\.js$/;
// 通信先に使えないホスト(内部のネットワークを指すもの)
const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp'];

/** 通信先として宣言できるホスト名か(完全一致のホスト名のみ。IP アドレス・localhost・内部用の名前は不可) */
export function isDeclarableHost(host: unknown): host is string {
	if (typeof host !== 'string' || !HOSTNAME_PATTERN.test(host)) return false;
	// IP アドレス(IPv4 の形)は不可。最後のラベルが数字だけのものも不可
	const labels = host.split('.');
	if (/^\d+$/.test(labels[labels.length - 1])) return false;
	if (host === 'localhost' || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix)))
		return false;
	return true;
}

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
	'contributions',
	'entry'
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
	for (const key of unknownKeys(value, ['events', 'read', 'network', 'storage', 'notify', 'ui'])) {
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
				if (!isDeclarableHost(host))
					errors.push(
						`permissions.network はホスト名(小文字。完全一致。ワイルドカード・IP・localhost・内部用の名前は不可)で指定してください: ${String(host)}`
					);
			}
		if (Array.isArray(value.network) && new Set(value.network).size !== value.network.length)
			errors.push('permissions.network に同じホストが重複しています');
	}
	for (const key of ['storage', 'notify', 'ui'] as const) {
		if (value[key] !== undefined && typeof value[key] !== 'boolean') {
			errors.push(`permissions.${key} は true / false で指定してください`);
		}
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

/** スクリプト(kind: script)の決まり。通信先の宣言と、送る情報の説明の整合も見る */
function validateScriptRules(input: Record<string, unknown>, errors: string[]): void {
	if (typeof input.entry !== 'string' || !ENTRY_PATTERN.test(input.entry)) {
		errors.push(
			`スクリプトには entry(本体のファイル名。小文字英数字・ハイフン・アンダースコアの .js。例: main.js)が必要です`
		);
	} else if (input.entry.length > SCRIPT_LIMITS.entryNameLength) {
		errors.push(`entry は ${SCRIPT_LIMITS.entryNameLength} 文字までです`);
	}
	if (!isText(input.license)) errors.push('スクリプトには license(ライセンス)が必要です');
	if (input.updatedAt === undefined) errors.push('スクリプトには updatedAt(更新日)が必要です');
	const permissions = isRecord(input.permissions) ? input.permissions : {};
	const privacy = isRecord(input.privacy) ? input.privacy : {};
	const hosts = Array.isArray(permissions.network)
		? permissions.network.filter((h): h is string => typeof h === 'string')
		: [];
	const sends = Array.isArray(privacy.sends) ? privacy.sends : [];
	// permissions.network の各ホストは、privacy.sends[].to のどこかに現れること(宣言と説明の整合)
	const targets = sends.map((send) =>
		isRecord(send) && typeof send.to === 'string' ? send.to : ''
	);
	for (const host of hosts) {
		if (!targets.some((to) => to.toLowerCase().includes(host))) {
			errors.push(
				`permissions.network の「${host}」が、privacy.sends[].to のどこにも書かれていません(送り先として説明してください)`
			);
		}
	}
	if (sends.length > 0 && hosts.length === 0) {
		errors.push(
			'privacy.sends を書いたスクリプトは、permissions.network に通信先のホストを宣言してください(通信できるのは宣言したホストだけです)'
		);
	}
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
	}
	if (input.kind !== 'script') {
		if (input.entry !== undefined) errors.push('entry は kind: script の拡張だけが持てます');
		const permissions = isRecord(input.permissions) ? input.permissions : {};
		for (const key of ['notify', 'ui']) {
			if (permissions[key] === true)
				errors.push(`permissions.${key} は kind: script の拡張だけが宣言できます`);
		}
	}
	if (input.kind === 'script') validateScriptRules(input, errors);
	if (input.kind !== 'pack') return;
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
	community: 'コミュニティ(レビュー済み)',
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
	/** 通知(トースト)を出すか */
	notify: boolean;
	/** 画面(ポップアップ・設定欄)を描画するか */
	ui: boolean;
}

export function summarizePermissions(permissions: ExtensionPermissions): PermissionSummary {
	return {
		receives: [
			...(permissions.events ?? []).map((name) => EVENT_LABELS[name]),
			...(permissions.read ?? []).map((name) => READ_LABELS[name])
		],
		network: [...(permissions.network ?? [])],
		storage: permissions.storage === true,
		notify: permissions.notify === true,
		ui: permissions.ui === true
	};
}

const SCRIPT_EVENT_LINES: Record<PermissionEvent, string> = {
	'page:change': '開いている画面の種類(ホーム・執筆・プロットなど)を受け取ります',
	'app:visibility': 'アプリが前面にあるか(別のウィンドウに移ったか)を受け取ります',
	'scene:updated': '本文が保存されたこと(文字数の増減だけ。本文は含みません)を受け取ります',
	'scene:created': 'シーンが作成されたことを受け取ります',
	'session:start': '執筆の開始を受け取ります',
	'session:update': '執筆中の経過(最後に編集した時刻と、増減した文字数)を受け取ります',
	'session:end': '執筆の終了を受け取ります'
};

/**
 * スクリプトの権限を、平易な日本語の文にする(同意画面・サイトで同じ文を出す)。
 * 宣言していないことは書かない。本文・設定・API キーなどに触れないことは、別に必ず示す
 */
export function describeScriptPermissions(permissions: ExtensionPermissions): string[] {
	const lines: string[] = [];
	const events = permissions.events ?? [];
	const hasStart = events.includes('session:start');
	const hasEnd = events.includes('session:end');
	if (hasStart && hasEnd) lines.push('あなたの執筆の開始・終了を受け取ります');
	for (const name of events) {
		if (hasStart && hasEnd && (name === 'session:start' || name === 'session:end')) continue;
		lines.push(SCRIPT_EVENT_LINES[name]);
	}
	if (permissions.read?.includes('project:title')) lines.push('作品名を受け取ります');
	if (permissions.read?.includes('project:chars')) lines.push('作品の総文字数を受け取ります');
	if (permissions.network?.length)
		lines.push(`次のサーバーと通信します: ${permissions.network.join('、')}`);
	if (permissions.storage)
		lines.push(
			'この端末の中に、設定などを保存します(同期・バックアップ・書き出しには含まれません)'
		);
	if (permissions.notify) lines.push('画面に通知(トースト)を出します');
	if (permissions.ui)
		lines.push('Storift の画面に、ボタンや入力欄などの操作画面(ポップアップ・設定欄)を表示します');
	return lines;
}

/** スクリプトの同意画面・詳細ページに必ず出す、隔離についての説明 */
export const SCRIPT_ISOLATION_NOTES: readonly string[] = [
	'このコードは隔離された環境で動きます。作品の本文・Firebase の設定・AI の API キー・Monolog. のトークンなど、Storift の保存領域には触れません。',
	'ただし、通信先に送られた情報は取り消せません。送られた情報の扱いは、作者と通信先に従います。',
	'運営者は、スクリプトの内容を保証しません。'
];

/** 対応プラットフォームの表示(例: 「Web 版・デスクトップ版」「デスクトップ版のみ」) */
export function platformsLabel(platforms: readonly ExtensionPlatform[]): string {
	const labels = EXTENSION_PLATFORMS.filter((p) => platforms.includes(p)).map(
		(p) => PLATFORM_LABELS[p]
	);
	return labels.length === 1 ? `${labels[0]}のみ` : labels.join('・');
}
