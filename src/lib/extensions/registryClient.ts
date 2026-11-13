/**
 * レジストリ(紹介サイトが配信する拡張の一覧とバンドル)の取得。
 *
 * - 取得先は storift.shiki-01.com だけ(registryIndex.ts の isRegistryUrl。コードに固定)。
 * - 一覧は「拡張機能を探す」を開いたときだけ取得する(起動時には取得しない)。
 * - バンドルは、取得したバイト列の SHA-256 が一覧の値と一致したときだけ受け付け、マニフェストを再検証する。
 * - 失敗しても何も壊さない(例外はメッセージ付きの RegistryError として返し、呼び出し側が表示する)。
 */
import { consentFingerprint } from './manifest';
import { parseBundleText, type ParsedBundle } from './packBundle';
import { PACK_LIMITS } from './pack';
import {
	MAX_INDEX_BYTES,
	REGISTRY_INDEX_URL,
	isRegistryUrl,
	sha256Hex,
	validateRegistryIndex,
	type RegistryEntry,
	type RegistryIndex
} from './registryIndex';

export class RegistryError extends Error {
	constructor(
		message: string,
		readonly kind: 'offline' | 'http' | 'format' | 'integrity' | 'blocked'
	) {
		super(message);
		this.name = 'RegistryError';
	}
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_INIT: RequestInit = {
	credentials: 'omit',
	redirect: 'error',
	referrerPolicy: 'no-referrer'
};

/** 上限つきで本文を読む(長さの申告が無い・偽りでも、上限を超えたら打ち切る) */
async function readBytes(response: Response, limit: number): Promise<Uint8Array> {
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > limit) {
		throw new RegistryError('取得したデータが大きすぎます', 'format');
	}
	const reader = response.body?.getReader();
	if (!reader) {
		const buffer = new Uint8Array(await response.arrayBuffer());
		if (buffer.length > limit) throw new RegistryError('取得したデータが大きすぎます', 'format');
		return buffer;
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > limit) {
			await reader.cancel();
			throw new RegistryError('取得したデータが大きすぎます', 'format');
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

async function get(url: string, limit: number, fetchFn: FetchLike): Promise<Uint8Array> {
	if (!isRegistryUrl(url)) {
		throw new RegistryError('取得先が許可されていません', 'blocked');
	}
	let response: Response;
	try {
		response = await fetchFn(url, { ...REQUEST_INIT, cache: 'no-cache' });
	} catch {
		throw new RegistryError(
			'接続できませんでした。オフラインか、サーバーに接続できません',
			'offline'
		);
	}
	if (!response.ok) {
		throw new RegistryError(`取得できませんでした(HTTP ${response.status})`, 'http');
	}
	return readBytes(response, limit);
}

/** 拡張の一覧を取得する */
export async function fetchRegistryIndex(
	fetchFn: FetchLike = (u, i) => fetch(u, i)
): Promise<RegistryIndex> {
	const bytes = await get(REGISTRY_INDEX_URL, MAX_INDEX_BYTES, fetchFn);
	let data: unknown;
	try {
		data = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new RegistryError('拡張の一覧を読み込めませんでした', 'format');
	}
	const result = validateRegistryIndex(data);
	if (!result.ok) throw new RegistryError(result.error, 'format');
	return result.index;
}

export interface FetchedBundle extends ParsedBundle {
	sha256: string;
}

/**
 * 一覧の 1 件のバンドルを取得して検証する。
 * SHA-256 が一覧と一致しない・マニフェストが一覧と食い違う・検証に通らないときは失敗する
 */
export async function fetchBundle(
	entry: RegistryEntry,
	fetchFn: FetchLike = (u, i) => fetch(u, i)
): Promise<FetchedBundle> {
	if (!entry.bundle || !entry.sha256) {
		throw new RegistryError('この拡張は、アプリに同梱されています(取得できません)', 'blocked');
	}
	const bytes = await get(entry.bundle, PACK_LIMITS.bundleBytes, fetchFn);
	const actual = await sha256Hex(bytes);
	if (actual !== entry.sha256) {
		throw new RegistryError(
			'ダウンロードした内容が一覧の記録と一致しません。インストールを中止しました',
			'integrity'
		);
	}
	const parsed = parseBundleText(new TextDecoder().decode(bytes));
	if (!parsed.ok) {
		throw new RegistryError(`拡張の内容が正しくありません: ${parsed.errors[0]}`, 'format');
	}
	const { manifest } = parsed.bundle;
	if (manifest.id !== entry.id || manifest.version !== entry.version) {
		throw new RegistryError('拡張の ID または版が、一覧と一致しません', 'integrity');
	}
	return { ...parsed.bundle, sha256: actual };
}

/** 更新で、権限・プライバシーが変わるか(変わると再同意が必要) */
export function needsReconsent(
	installed: Parameters<typeof consentFingerprint>[0],
	next: Parameters<typeof consentFingerprint>[0]
): boolean {
	return consentFingerprint(installed) !== consentFingerprint(next);
}
