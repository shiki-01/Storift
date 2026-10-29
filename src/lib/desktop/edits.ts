/**
 * Claude が回答に書く本文の編集案(<storift-edit>)の解析・差分・適用。
 *
 * Claude Code にはファイルの書き換えを許可せず、編集は回答の中に決まった形式で書かせる。
 * アプリがそれを読み取り、設定に応じて差分を見せて確認するか、そのまま本文へ反映する。
 */

export interface EditProposal {
	/** ワークスペースからの相対パス */
	file: string;
	old: string;
	new: string;
}

export type Segment = { kind: 'markdown'; text: string } | { kind: 'edit'; edit: EditProposal };

const EDIT_RE =
	/<storift-edit\s+file="([^"]+)"\s*>\s*<old>([\s\S]*?)<\/old>\s*<new>([\s\S]*?)<\/new>\s*<\/storift-edit>/g;
const OPEN_TAG = '<storift-edit';

/** タグ直後・直前の改行 1 つは書式上のものとして除く */
function trimTagNewlines(text: string): string {
	return text.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

/**
 * 回答の本文を、Markdown と編集案に分ける。
 * 書きかけ(閉じタグがまだ来ていない)の編集案は pending として返し、本文には出さない。
 */
export function splitEdits(text: string): { segments: Segment[]; pending: boolean } {
	const segments: Segment[] = [];
	let last = 0;
	for (const m of text.matchAll(EDIT_RE)) {
		const before = text.slice(last, m.index);
		if (before.trim()) segments.push({ kind: 'markdown', text: before });
		segments.push({
			kind: 'edit',
			edit: { file: m[1], old: trimTagNewlines(m[2]), new: trimTagNewlines(m[3]) }
		});
		last = m.index + m[0].length;
	}
	let rest = text.slice(last);
	const open = rest.indexOf(OPEN_TAG);
	const pending = open !== -1;
	if (pending) rest = rest.slice(0, open);
	if (rest.trim()) segments.push({ kind: 'markdown', text: rest });
	return { segments, pending };
}

export function parseEdits(text: string): EditProposal[] {
	return splitEdits(text)
		.segments.filter((s) => s.kind === 'edit')
		.map((s) => (s as { edit: EditProposal }).edit);
}

function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) count++;
	return count;
}

export type ReplaceResult = { ok: true; content: string } | { ok: false; reason: string };

/** 本文中にちょうど 1 回現れる from を to に置き換える */
export function replaceOnce(content: string, from: string, to: string): ReplaceResult {
	if (!from) return { ok: false, reason: '置き換える元の文が空です' };
	const count = countOccurrences(content, from);
	if (count === 0)
		return { ok: false, reason: '該当箇所が見つかりません(本文が変わった可能性があります)' };
	if (count > 1) return { ok: false, reason: `該当箇所が ${count} か所あり、特定できません` };
	const i = content.indexOf(from);
	return { ok: true, content: content.slice(0, i) + to + content.slice(i + from.length) };
}

export type DiffOp = { kind: 'same' | 'del' | 'add'; text: string };

/** これより大きい組み合わせは文字単位の差分を取らず、全体の置き換えとして見せる */
const DIFF_LIMIT = 2_000_000;

function push(ops: DiffOp[], kind: DiffOp['kind'], text: string) {
	if (!text) return;
	const last = ops[ops.length - 1];
	if (last?.kind === kind) last.text += text;
	else ops.push({ kind, text });
}

/** 文字単位の差分(共通の前後を除いてから LCS) */
export function diffChars(a: string, b: string): DiffOp[] {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const ops: DiffOp[] = [];
	push(ops, 'same', a.slice(0, start));
	const x = a.slice(start, endA);
	const y = b.slice(start, endB);

	if (x.length * y.length > DIFF_LIMIT) {
		push(ops, 'del', x);
		push(ops, 'add', y);
	} else {
		// dp[i][j] = x[i..] と y[j..] の最長共通部分列の長さ
		const w = y.length + 1;
		const dp = new Uint32Array((x.length + 1) * w);
		for (let i = x.length - 1; i >= 0; i--) {
			for (let j = y.length - 1; j >= 0; j--) {
				dp[i * w + j] =
					x[i] === y[j]
						? dp[(i + 1) * w + j + 1] + 1
						: Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		while (i < x.length && j < y.length) {
			if (x[i] === y[j]) {
				push(ops, 'same', x[i]);
				i++;
				j++;
			} else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
				push(ops, 'del', x[i++]);
			} else {
				push(ops, 'add', y[j++]);
			}
		}
		push(ops, 'del', x.slice(i));
		push(ops, 'add', y.slice(j));
	}

	push(ops, 'same', a.slice(endA));
	return ops;
}

/** Claude に編集案の書き方を伝える指示(編集を許可しているときだけ付ける) */
export const EDIT_INSTRUCTIONS = `ユーザーは本文の編集を許可しています。本文(projects/<作品>/本文/ 以下のシーンファイル)を直すときは、ファイルを書き換えずに、回答の中に次の形式で編集案を書いてください。アプリが読み取って本文へ反映します。

<storift-edit file="projects/<作品>/本文/<章>/<シーン>.md">
<old>置き換える元の文</old>
<new>置き換え後の文</new>
</storift-edit>

- file はワークスペースからの相対パス。本文のシーンファイル以外(概要・キャラクター・設定資料など)は編集できません。
- old は本文からそのまま正確に抜き出し、本文中で 1 回だけ現れるよう前後を含めて十分な長さにする。見出し行(# シーン名)は含めない。
- 直す箇所が複数あるときはブロックを分ける。1 ブロックはなるべく短く。
- 編集案の前後に、何をなぜ直したかを簡潔に書く。
- ユーザーが直しを求めていないときは、編集案を書かない。`;
