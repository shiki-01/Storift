// ColorPicker.svelte の純粋な色の計算(#rrggbb と HSV の変換・入力の正規化)

export interface Hsv {
	/** 0〜360 */
	h: number;
	/** 0〜1 */
	s: number;
	/** 0〜1 */
	v: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** "#abc" / "abc" / "#aabbcc" を "#aabbcc"(小文字)にする。解釈できなければ null */
export function normalizeHex(input: string): string | null {
	const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input.trim());
	if (!m) return null;
	const body = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
	return `#${body.toLowerCase()}`;
}

export function hexToHsv(hex: string): Hsv {
	const n = normalizeHex(hex) ?? '#000000';
	const r = parseInt(n.slice(1, 3), 16) / 255;
	const g = parseInt(n.slice(3, 5), 16) / 255;
	const b = parseInt(n.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	let h = 0;
	if (d !== 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
	const hh = ((h % 360) + 360) % 360;
	const ss = clamp(s, 0, 1);
	const vv = clamp(v, 0, 1);
	const c = vv * ss;
	const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
	const m = vv - c;
	const [r, g, b] =
		hh < 60
			? [c, x, 0]
			: hh < 120
				? [x, c, 0]
				: hh < 180
					? [0, c, x]
					: hh < 240
						? [0, x, c]
						: hh < 300
							? [x, 0, c]
							: [c, 0, x];
	const to = (n: number) =>
		Math.round((n + m) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${to(r)}${to(g)}${to(b)}`;
}

/** 色の上に載せる文字を白・黒のどちらにするか(コントラストが高い方) */
export function readableOn(hex: string): '#ffffff' | '#000000' {
	const n = normalizeHex(hex) ?? '#000000';
	const lin = (i: number) => {
		const c = parseInt(n.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const l = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
	return l > 0.35 ? '#000000' : '#ffffff';
}

/** ColorPicker の既定のプリセット */
export const DEFAULT_PRESETS = [
	'#6b7280',
	'#ef4444',
	'#f97316',
	'#f59e0b',
	'#84cc16',
	'#10b981',
	'#06b6d4',
	'#3b82f6',
	'#6366f1',
	'#8b5cf6',
	'#ec4899',
	'#92400e'
] as const;
