/**
 * 拡張のレジストリ(紹介サイトが配信する一覧とバンドル)の形式と、取得したデータの検証。
 *
 * - 一覧: https://storift.shiki-01.com/extensions-registry/index.json
 * - バンドル: https://storift.shiki-01.com/extensions-registry/<id>/<version>.storiftext.json
 *
 * ビルド用のスクリプト(scripts/build-registry.ts)・アプリの「拡張機能を探す」・テストが同じ実装を使うので、
 * 他のモジュールに依存させない(純関数と定数だけを置く)。
 */
import {
	EXTENSION_KINDS,
	EXTENSION_PLATFORMS,
	summarizePermissions,
	type ExtensionKind,
	type ExtensionManifest,
	type ExtensionPlatform,
	type PermissionSummary
} from './manifest';
import { contributionKinds, type ContributionKind } from './pack';

/** 取得を許可する唯一のホスト(コードに固定する。設定では変えられない) */
export const REGISTRY_HOST = 'storift.shiki-01.com';
export const REGISTRY_ORIGIN = `https://${REGISTRY_HOST}`;
export const REGISTRY_BASE_PATH = '/extensions-registry/';
export const REGISTRY_INDEX_URL = `${REGISTRY_ORIGIN}${REGISTRY_BASE_PATH}index.json`;
/** 一覧の形式の版 */
export const REGISTRY_INDEX_VERSION = 1;
/** 一覧(JSON)の大きさの上限(バイト) */
export const MAX_INDEX_BYTES = 1024 * 1024;

export type RegistrySource = 'official' | 'community';

/** 一覧の 1 件 */
export interface RegistryEntry {
	id: string;
	name: string;
	description: string;
	version: string;
	author: string;
	kind: ExtensionKind;
	platforms: ExtensionPlatform[];
	icon: string;
	license: string | null;
	homepage: string | null;
	/** 権限の要約(同意画面・サイトと同じ文) */
	permissions: PermissionSummary;
	/** プライバシーの要約。詳細はバンドルのマニフェスト(インストール時の同意画面) */
	privacy: { sends: string[]; stores: string[]; onDisable: string };
	/** 貢献の種類(パックのみ) */
	contributes: ContributionKind[];
	/** バンドルの URL。公式(アプリに同梱)は null */
	bundle: string | null;
	/** バンドルの SHA-256(16 進)。公式は null */
	sha256: string | null;
	/** バンドルのバイト数。公式は null */
	size: number | null;
	/** マニフェストの updatedAt(YYYY-MM-DD)。無ければ null */
	updatedAt: string | null;
	source: RegistrySource;
}

/** 失効(キルスイッチ)の 1 件。extensions/revoked.json から作る */
export interface RevokedEntry {
	id: string;
	/** 失効する版。'*' はすべての版 */
	versions: string[] | '*';
	/** 理由(利用者に表示する) */
	reason: string;
	/** 失効させた日(YYYY-MM-DD) */
	at: string;
}

export interface RegistryIndex {
	indexVersion: typeof REGISTRY_INDEX_VERSION;
	extensions: RegistryEntry[];
	/** 失効した拡張。古い一覧には無い(その場合は空) */
	revoked: RevokedEntry[];
}

/** 失効の 1 件の形を検証する。問題があれば null */
export function readRevoked(value: unknown): RevokedEntry | null {
	if (!isRecord(value)) return null;
	const { id, versions, reason, at } = value;
	if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64)
		return null;
	if (typeof reason !== 'string' || reason.trim() === '' || reason.length > 300) return null;
	if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(at)) return null;
	if (versions === '*') return { id, versions: '*', reason, at };
	if (
		!Array.isArray(versions) ||
		versions.length === 0 ||
		versions.length > 100 ||
		!versions.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 64)
	)
		return null;
	return { id, versions: [...(versions as string[])], reason, at };
}

/** その版が、失効の対象か */
export function isRevokedVersion(entry: RevokedEntry, version: string): boolean {
	return entry.versions === '*' || entry.versions.includes(version);
}

/** バンドルの置き場所(サイト上のパス) */
export function bundlePath(id: string, version: string): string {
	return `${REGISTRY_BASE_PATH}${id}/${version}.storiftext.json`;
}

/** マニフェストから一覧の 1 件を作る(バンドルの情報は呼び出し側が渡す) */
export function toRegistryEntry(
	manifest: ExtensionManifest,
	source: RegistrySource,
	bundle: { sha256: string; size: number } | null
): RegistryEntry {
	return {
		id: manifest.id,
		name: manifest.name,
		description: manifest.description,
		version: manifest.version,
		author: manifest.author,
		kind: manifest.kind,
		platforms: [...manifest.platforms],
		icon: manifest.icon,
		license: manifest.license ?? null,
		homepage: manifest.homepage ?? null,
		permissions: summarizePermissions(manifest.permissions),
		privacy: {
			sends: manifest.privacy.sends.map((s) => s.to),
			stores: [...manifest.privacy.stores],
			onDisable: manifest.privacy.onDisable
		},
		contributes: contributionKinds(manifest.contributions),
		bundle: bundle ? `${REGISTRY_ORIGIN}${bundlePath(manifest.id, manifest.version)}` : null,
		sha256: bundle?.sha256 ?? null,
		size: bundle?.size ?? null,
		updatedAt: manifest.updatedAt ?? null,
		source
	};
}

/** 取得先として許してよい URL か(https・固定のホスト・レジストリのパス配下・ポートや認証情報なし) */
export function isRegistryUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	return (
		parsed.protocol === 'https:' &&
		parsed.hostname === REGISTRY_HOST &&
		parsed.port === '' &&
		parsed.username === '' &&
		parsed.password === '' &&
		parsed.pathname.startsWith(REGISTRY_BASE_PATH) &&
		!parsed.pathname.includes('..') &&
		parsed.search === '' &&
		parsed.hash === ''
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** 一覧の 1 件の形を検証する(アプリが表示に使う項目だけ)。問題があれば null */
function readEntry(value: unknown): RegistryEntry | null {
	if (!isRecord(value)) return null;
	const strings = ['id', 'name', 'description', 'version', 'author', 'icon'] as const;
	for (const key of strings) if (typeof value[key] !== 'string' || !value[key]) return null;
	if (!(EXTENSION_KINDS as readonly unknown[]).includes(value.kind)) return null;
	if (value.source !== 'official' && value.source !== 'community') return null;
	if (
		!Array.isArray(value.platforms) ||
		!value.platforms.every((p) => (EXTENSION_PLATFORMS as readonly unknown[]).includes(p))
	)
		return null;
	if (!isRecord(value.permissions) || !isRecord(value.privacy)) return null;
	const perms = value.permissions;
	if (
		!Array.isArray(perms.receives) ||
		!Array.isArray(perms.network) ||
		typeof perms.storage !== 'boolean'
	)
		return null;
	const privacy = value.privacy;
	if (!Array.isArray(privacy.sends) || !Array.isArray(privacy.stores)) return null;
	if (typeof privacy.onDisable !== 'string') return null;
	if (value.bundle !== null && (typeof value.bundle !== 'string' || !isRegistryUrl(value.bundle)))
		return null;
	if (value.bundle !== null) {
		if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) return null;
		if (typeof value.size !== 'number' || !Number.isInteger(value.size) || value.size <= 0)
			return null;
	}
	return {
		id: value.id as string,
		name: value.name as string,
		description: value.description as string,
		version: value.version as string,
		author: value.author as string,
		kind: value.kind as ExtensionKind,
		platforms: value.platforms as ExtensionPlatform[],
		icon: value.icon as string,
		license: typeof value.license === 'string' ? value.license : null,
		homepage: typeof value.homepage === 'string' ? value.homepage : null,
		permissions: {
			receives: (perms.receives as unknown[]).filter((v): v is string => typeof v === 'string'),
			network: (perms.network as unknown[]).filter((v): v is string => typeof v === 'string'),
			storage: perms.storage,
			notify: perms.notify === true,
			ui: perms.ui === true
		},
		privacy: {
			sends: (privacy.sends as unknown[]).filter((v): v is string => typeof v === 'string'),
			stores: (privacy.stores as unknown[]).filter((v): v is string => typeof v === 'string'),
			onDisable: privacy.onDisable
		},
		contributes: Array.isArray(value.contributes)
			? (value.contributes as unknown[]).filter((v): v is ContributionKind => typeof v === 'string')
			: [],
		bundle: (value.bundle as string | null) ?? null,
		sha256: (value.sha256 as string | null) ?? null,
		size: (value.size as number | null) ?? null,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
		source: value.source
	};
}

export type IndexValidation = { ok: true; index: RegistryIndex } | { ok: false; error: string };

/** 取得した一覧を検証する。形の合わない項目は捨てる(一覧全体が壊れているときだけ失敗) */
export function validateRegistryIndex(input: unknown): IndexValidation {
	if (!isRecord(input) || input.indexVersion !== REGISTRY_INDEX_VERSION) {
		return { ok: false, error: '拡張の一覧の形式が正しくありません(アプリを更新してください)' };
	}
	if (!Array.isArray(input.extensions)) {
		return { ok: false, error: '拡張の一覧の形式が正しくありません' };
	}
	const seen = new Set<string>();
	const extensions: RegistryEntry[] = [];
	for (const raw of input.extensions) {
		const entry = readEntry(raw);
		if (!entry || seen.has(entry.id)) continue;
		seen.add(entry.id);
		extensions.push(entry);
	}
	const revoked: RevokedEntry[] = [];
	if (Array.isArray(input.revoked)) {
		for (const raw of input.revoked.slice(0, 1000)) {
			const entry = readRevoked(raw);
			if (entry) revoked.push(entry);
		}
	}
	return { ok: true, index: { indexVersion: REGISTRY_INDEX_VERSION, extensions, revoked } };
}

/** SHA-256(16 進)。ブラウザ・Node・Bun の Web Crypto を使う */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
	const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** semver の比較(a > b なら正)。ビルドメタデータは無視し、プレリリースは正式版より小さい */
export function compareVersions(a: string, b: string): number {
	const parse = (v: string) => {
		const [core, pre] = v.split('+')[0].split('-', 2);
		return { nums: core.split('.').map((n) => Number(n) || 0), pre: pre ?? null };
	};
	const x = parse(a);
	const y = parse(b);
	for (let i = 0; i < 3; i++) {
		const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
		if (d !== 0) return d;
	}
	if (x.pre === y.pre) return 0;
	if (x.pre === null) return 1;
	if (y.pre === null) return -1;
	return x.pre < y.pre ? -1 : 1;
}
