/**
 * 画面を離れて戻ったときに、スクロール位置を戻すための記憶。
 * キー(シーン ID など)ごとに位置を覚え、タブを閉じるまで sessionStorage にも残す。
 */
const STORAGE_KEY = 'storift:scroll-positions';
const MAX_ENTRIES = 200;

let positions: Map<string, number> | null = null;

function load(): Map<string, number> {
	if (positions) return positions;
	positions = new Map();
	try {
		const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (parsed && typeof parsed === 'object') {
			for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
				if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
					positions.set(key, value);
				}
			}
		}
	} catch {
		// 読めなくても、このタブの間は Map で覚える
	}
	return positions;
}

export function rememberScroll(key: string, top: number): void {
	const map = load();
	map.delete(key);
	map.set(key, Math.max(0, Math.round(top)));
	// 古いものから捨てる
	while (map.size > MAX_ENTRIES) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

export function recallScroll(key: string): number | undefined {
	return load().get(key);
}

/** sessionStorage へ書き出す(画面を離れるときに呼ぶ) */
export function persistScroll(): void {
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(load())));
	} catch {
		// 保存できなくても動作には影響しない
	}
}

/** テスト用: 記憶を捨てる */
export function resetScrollMemory(): void {
	positions = null;
}

/**
 * 中身の描画を待ちながら、scrollTop を target へ戻す。
 * 中身が足りずに届かない間は、数フレームだけ待ってやり直す。完了(または打ち切り)で done を呼ぶ。
 */
export function restoreScroll(
	el: HTMLElement,
	target: number,
	done: () => void,
	maxFrames = 90
): () => void {
	let frame = 0;
	let handle = 0;
	let cancelled = false;
	const step = () => {
		if (cancelled) return;
		el.scrollTop = target;
		const reachable = el.scrollHeight - el.clientHeight >= target - 1;
		if (reachable || frame >= maxFrames) {
			done();
			return;
		}
		frame++;
		handle = requestAnimationFrame(step);
	};
	step();
	return () => {
		cancelled = true;
		cancelAnimationFrame(handle);
		done();
	};
}
