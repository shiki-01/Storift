/** アプリと同じ記法(｜漢字《かんじ》・《《強調》》)を、描画用の断片に分ける */
export type Segment =
	| { kind: 'text'; text: string }
	| { kind: 'ruby'; text: string; ruby: string }
	| { kind: 'dots'; text: string };

const PATTERN = /[｜|]([^｜|《》\n]+)《([^《》\n]+)》|《《([^《》\n]+)》》/g;

export function parseLine(line: string): Segment[] {
	const out: Segment[] = [];
	let last = 0;
	for (const m of line.matchAll(PATTERN)) {
		if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) });
		if (m[3]) out.push({ kind: 'dots', text: m[3] });
		else out.push({ kind: 'ruby', text: m[1], ruby: m[2] });
		last = m.index + m[0].length;
	}
	if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
	return out;
}

/** 記号を除いた、読者が読む本文の文字列 */
export function plainText(text: string): string {
	return text
		.split('\n')
		.map((line) =>
			parseLine(line)
				.map((s) => s.text)
				.join('')
		)
		.join('\n');
}
