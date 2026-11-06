import type { ProjectSharing, SecretKind } from '$lib/types/project';

/**
 * 招待リンクに入れる秘密の決定(純粋関数)。
 * トークン方式(ランダム生成)の秘密だけをリンクに含める。パスワード方式はリンクに入れず、別途伝える。
 */

/** generateSecretToken が作る形(32 バイトの base64url、パディング無し = 43 文字) */
const GENERATED_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * 秘密の方式。記録(secretKinds)があればそれに従う。
 * 無い(記録を持たない旧データ)ときは、生成されたトークンの形をしていればトークン、そうでなければパスワードとみなす
 * (誤ってパスワードをリンクに含めないよう、迷う場合はパスワード側に倒す)。
 */
export function secretKindOf(
	sharing: ProjectSharing,
	role: 'viewer' | 'editor'
): SecretKind | null {
	const value = sharing.secrets?.[role];
	if (!value) return null;
	const recorded = sharing.secretKinds?.[role];
	if (recorded) return recorded;
	return GENERATED_TOKEN.test(value) ? 'token' : 'password';
}

export type InviteSecret =
	| { kind: 'token'; value: string }
	/** パスワード方式: リンクには入れない */
	| { kind: 'password' };

/** 招待リンクに入れる秘密。この端末が秘密を持っていない(null)ときは発行できない */
export function inviteSecretFor(
	sharing: ProjectSharing,
	role: 'viewer' | 'editor'
): InviteSecret | null {
	const kind = secretKindOf(sharing, role);
	if (!kind) return null;
	return kind === 'token' ? { kind, value: sharing.secrets![role]! } : { kind };
}
