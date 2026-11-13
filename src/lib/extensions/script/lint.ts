/**
 * スクリプトの静的な検査。アプリ(インストール時)・PR の CI(scripts/validate-extensions.ts)・テストが同じ実装を使う。
 *
 * これは「実行を許す前の足切り」で、安全の根拠ではない。本当の防御は、実行環境の CSP(eval / new Function /
 * importScripts / 宣言していない通信先をブラウザが拒否する)と、iframe の sandbox。ここで見つけるのは、
 * 悪意のない書き間違いと、明らかな回避の試み。コメントや文字列の中の語(`<script`・`eval` など)は対象にしない。
 *
 * errors は拒否、warnings は PR でレビューする人が読む(難読化・圧縮が疑われるもの)。
 */
import { SCRIPT_LIMITS } from './limits';
import { byteLength } from '../pack';

export interface ScriptLintResult {
	errors: string[];
	warnings: string[];
}

interface Scanned {
	/** コメントを取り除き、文字列・テンプレート・正規表現の中身を空にしたコード(行番号は保つ) */
	code: string;
	/** 文字列リテラル(テンプレートの文字の部分を含む) */
	strings: { text: string; line: number }[];
}

const REGEX_PRECEDERS = new Set([
	'',
	'(',
	',',
	'=',
	':',
	'[',
	'!',
	'&',
	'|',
	'?',
	'{',
	'}',
	';',
	'+',
	'-',
	'*',
	'%',
	'<',
	'>',
	'~',
	'^'
]);
const REGEX_KEYWORDS =
	/(?:^|[^\w$.])(?:return|typeof|case|do|else|in|of|void|delete|throw|new|yield|await)$/;

/** コメント・文字列・テンプレート・正規表現を取り除いたコードと、文字列の一覧を作る(簡易な字句解析) */
export function scanSource(src: string): Scanned {
	const out: string[] = [];
	const strings: Scanned['strings'] = [];
	let line = 1;
	let i = 0;
	// テンプレートリテラルの ${ } の中にいるとき、波括弧の深さを積む
	const braceStack: number[] = [];
	let braceDepth = 0;
	const lastSignificant = () => {
		for (let k = out.length - 1; k >= 0; k--) {
			const ch = out[k];
			if (ch !== ' ' && ch !== '\n' && ch !== '\t' && ch !== '\r') return ch;
		}
		return '';
	};
	const tail = () => out.slice(-12).join('');

	/** テンプレートの文字の部分を読む。` で終わるなら true、${ に入るなら false */
	const readTemplate = (): boolean => {
		let text = '';
		const startLine = line;
		while (i < src.length) {
			const c = src[i];
			if (c === '\\') {
				text += src.slice(i, i + 2);
				if (src[i + 1] === '\n') line++;
				i += 2;
			} else if (c === '`') {
				i++;
				strings.push({ text, line: startLine });
				out.push('``');
				return true;
			} else if (c === '$' && src[i + 1] === '{') {
				i += 2;
				strings.push({ text, line: startLine });
				out.push('`${');
				braceStack.push(braceDepth);
				braceDepth = 0;
				return false;
			} else {
				if (c === '\n') {
					line++;
					out.push('\n');
				}
				text += c;
				i++;
			}
		}
		return true;
	};

	while (i < src.length) {
		const c = src[i];
		const next = src[i + 1];
		if (c === '/' && next === '/') {
			while (i < src.length && src[i] !== '\n') i++;
		} else if (c === '/' && next === '*') {
			i += 2;
			while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
				if (src[i] === '\n') {
					line++;
					out.push('\n');
				}
				i++;
			}
			i += 2;
			out.push(' ');
		} else if (c === "'" || c === '"') {
			const startLine = line;
			let text = '';
			i++;
			while (i < src.length && src[i] !== c && src[i] !== '\n') {
				if (src[i] === '\\') {
					text += src.slice(i, i + 2);
					if (src[i + 1] === '\n') line++;
					i += 2;
				} else {
					text += src[i++];
				}
			}
			i++;
			strings.push({ text, line: startLine });
			out.push('""');
		} else if (c === '`') {
			i++;
			readTemplate();
		} else if (c === '{') {
			braceDepth++;
			out.push(c);
			i++;
		} else if (c === '}') {
			if (braceStack.length > 0 && braceDepth === 0) {
				// ${ } の終わり。テンプレートの続きへ
				braceDepth = braceStack.pop()!;
				i++;
				out.push('}');
				if (!readTemplate()) continue;
			} else {
				braceDepth = Math.max(0, braceDepth - 1);
				out.push(c);
				i++;
			}
		} else if (c === '/') {
			const prev = lastSignificant();
			if (REGEX_PRECEDERS.has(prev) || REGEX_KEYWORDS.test(tail())) {
				// 正規表現リテラル
				i++;
				let inClass = false;
				while (i < src.length && src[i] !== '\n') {
					if (src[i] === '\\') i += 2;
					else if (src[i] === '[') {
						inClass = true;
						i++;
					} else if (src[i] === ']') {
						inClass = false;
						i++;
					} else if (src[i] === '/' && !inClass) break;
					else i++;
				}
				i++;
				while (/[a-z]/i.test(src[i] ?? '')) i++;
				out.push('/ /');
			} else {
				out.push(c);
				i++;
			}
		} else {
			if (c === '\n') line++;
			out.push(c);
			i++;
		}
	}
	return { code: out.join(''), strings };
}

const KEYWORDS = new Set(
	(
		'break case catch class const continue debugger default delete do else export extends finally for ' +
		'function if import in instanceof let new return super switch this throw try typeof var void while ' +
		'with yield async await of null true false undefined static get set'
	).split(' ')
);

function lineOf(code: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i++) if (code.charCodeAt(i) === 10) line++;
	return line;
}

/** 禁止する書き方(実行環境の CSP でも拒否される)。名前 → 理由 */
const FORBIDDEN: { pattern: RegExp; message: string }[] = [
	{ pattern: /\beval\b/g, message: 'eval は使えません(コードの文字列実行は禁止です)' },
	{
		pattern: /\bnew\s+Function\b|\bFunction\s*\(/g,
		message: 'new Function / Function() は使えません(コードの文字列実行は禁止です)'
	},
	{
		pattern: /\bimportScripts\b/g,
		message: 'importScripts は使えません(スクリプトは 1 ファイルです)'
	},
	{ pattern: /\bWebAssembly\b/g, message: 'WebAssembly は使えません' },
	{ pattern: /\bimport\s*\(/g, message: '動的 import() は使えません(スクリプトは 1 ファイルです)' },
	{
		pattern: /(?:^|[\n;{}])\s*import\s+[\w{*"'`]/g,
		message: 'import 文は使えません(スクリプトは 1 ファイルの通常のスクリプトです)'
	},
	{ pattern: /(?:^|[\n;{}])\s*export\s+/g, message: 'export 文は使えません' }
];

const NETWORK_APIS = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/g;

/**
 * スクリプトのソースを検査する。
 * @param source スクリプトの内容
 * @param network マニフェストの permissions.network(宣言した通信先)
 */
export function lintScript(source: string, network: readonly string[] = []): ScriptLintResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const size = byteLength(source);
	if (source.trim() === '') errors.push('スクリプトが空です');
	if (size > SCRIPT_LIMITS.sourceBytes) {
		errors.push(
			`スクリプトが大きすぎます(${Math.round(size / 1024)}KB。${Math.round(SCRIPT_LIMITS.sourceBytes / 1024)}KB まで)`
		);
	}
	// 見た目と実際の順序が食い違う文字(Trojan Source)・NUL
	// eslint-disable-next-line no-control-regex
	if (/[\u202a-\u202e\u2066-\u2069\u0000]/.test(source)) {
		errors.push('書字方向を変える制御文字または NUL が含まれています');
	}

	const { code, strings } = scanSource(source);

	for (const { pattern, message } of FORBIDDEN) {
		pattern.lastIndex = 0;
		const seen = new Set<number>();
		for (const m of code.matchAll(pattern)) {
			const line = lineOf(code, m.index ?? 0);
			if (seen.has(line)) continue;
			seen.add(line);
			errors.push(`${line} 行目: ${message}`);
		}
	}

	// 通信: 宣言していないのに通信の API を使っている
	if (network.length === 0) {
		for (const m of code.matchAll(NETWORK_APIS)) {
			errors.push(
				`${lineOf(code, m.index ?? 0)} 行目: ${m[0]} を使っていますが、permissions.network に通信先を宣言していません`
			);
			break;
		}
	}
	// 文字列の URL が、宣言していないホストを指している(UI のリンクの可能性もあるので警告)
	for (const { text, line } of strings) {
		const m = /^(https?):\/\/([^/\s:?#]+)/i.exec(text);
		if (!m) continue;
		const host = m[2].toLowerCase();
		if (m[1].toLowerCase() === 'http') {
			warnings.push(
				`${line} 行目: http:// の URL があります(通信できるのは宣言した https のホストだけです): ${host}`
			);
		} else if (!network.includes(host)) {
			warnings.push(
				`${line} 行目: 宣言していないホストの URL があります(通信には使えません。リンクなら問題ありません): ${host}`
			);
		}
	}

	// 難読化・圧縮の疑い(警告。PR で人が見る)
	const lines = source.split('\n');
	const longLine = lines.findIndex((l) => l.length > 1000);
	if (longLine >= 0) {
		warnings.push(
			`${longLine + 1} 行目: 1 行が極端に長い(${lines[longLine].length} 文字)ため、圧縮・難読化されたコードの可能性があります`
		);
	}
	const identifiers = (code.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((id) => !KEYWORDS.has(id));
	if (identifiers.length >= 100) {
		const single = identifiers.filter((id) => id.length === 1).length;
		if (single / identifiers.length >= 0.45) {
			warnings.push(
				`1 文字の変数名が多すぎます(${Math.round((single / identifiers.length) * 100)}%)。圧縮・難読化されたコードの可能性があります`
			);
		}
	}
	if (/\b_0x[0-9a-f]{3,}\b/i.test(code)) {
		warnings.push('難読化ツールが作る形の識別子(_0x…)があります');
	}
	const escapes = strings.reduce(
		(n, s) => n + (s.text.match(/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/gi)?.length ?? 0),
		0
	);
	if (escapes > 30) {
		warnings.push(`文字列の中のエスケープ(\\x..・\\u....)が多すぎます(${escapes} 個)`);
	}
	return { errors, warnings };
}
