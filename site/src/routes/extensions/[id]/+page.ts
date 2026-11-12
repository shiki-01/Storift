import { error } from '@sveltejs/kit';
import { extensions, findExtension } from '$lib/extensions';

export const prerender = true;

/** マニフェストのある拡張すべてのページを、ビルド時に生成する */
export function entries() {
	return extensions.map((e) => ({ id: e.id }));
}

export function load({ params }) {
	const extension = findExtension(params.id);
	if (!extension) error(404, '拡張が見つかりません');
	return { extension };
}
