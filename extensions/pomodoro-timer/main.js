// ポモドーロタイマー(Storift スクリプト拡張)。作者: shiki-01 / MIT
// 仕様: docs/SCRIPT_API.md。隔離された Web Worker で動く(document や window は無い)。

const WORK_OPTIONS = [15, 20, 25, 30, 45, 50];
const BREAK_OPTIONS = [3, 5, 10, 15];

let workMinutes = 25;
let breakMinutes = 5;
// 'work' か 'break'
let mode = 'work';
let running = false;
// 動いている間の終了時刻(ミリ秒)と、止めている間の残り時間
let endsAt = 0;
let remainingMs = workMinutes * 60_000;
let ticker = null;

const minutesOf = (m) => (m === 'work' ? workMinutes : breakMinutes);
const label = (m) => (m === 'work' ? '作業' : '休憩');
const pad = (n) => String(n).padStart(2, '0');

function clock(ms) {
	const total = Math.max(0, Math.ceil(ms / 1000));
	return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function currentRemaining() {
	return running ? Math.max(0, endsAt - Date.now()) : remainingMs;
}

function panel() {
	const total = minutesOf(mode) * 60_000;
	const left = currentRemaining();
	return [
		{ type: 'heading', text: `${label(mode)}の時間` },
		{ type: 'text', text: clock(left) },
		{ type: 'progress', value: total > 0 ? 1 - left / total : 0, label: label(mode) },
		running
			? { type: 'button', id: 'stop', label: '一時停止' }
			: { type: 'button', id: 'start', label: '開始', variant: 'primary' },
		{ type: 'button', id: 'reset', label: 'リセット' }
	];
}

function settingsNodes() {
	return [
		{
			type: 'select',
			id: 'work',
			label: '作業の時間',
			value: String(workMinutes),
			options: WORK_OPTIONS.map((m) => ({ value: String(m), label: `${m} 分` }))
		},
		{
			type: 'select',
			id: 'break',
			label: '休憩の時間',
			value: String(breakMinutes),
			options: BREAK_OPTIONS.map((m) => ({ value: String(m), label: `${m} 分` }))
		}
	];
}

async function render() {
	await storift.ui.set('panel', panel(), { badge: running });
	await storift.ui.set('settings', settingsNodes());
}

function stopTicker() {
	if (ticker !== null) clearInterval(ticker);
	ticker = null;
}

function start() {
	if (running) return;
	running = true;
	endsAt = Date.now() + remainingMs;
	ticker = setInterval(tick, 1000);
}

function pause() {
	if (!running) return;
	remainingMs = Math.max(0, endsAt - Date.now());
	running = false;
	stopTicker();
}

function reset() {
	running = false;
	stopTicker();
	mode = 'work';
	remainingMs = minutesOf(mode) * 60_000;
}

async function tick() {
	if (currentRemaining() > 0) {
		await render();
		return;
	}
	// 時間になったら、作業と休憩を入れ替えて、続けて計る
	const finished = mode;
	mode = mode === 'work' ? 'break' : 'work';
	remainingMs = minutesOf(mode) * 60_000;
	endsAt = Date.now() + remainingMs;
	try {
		await storift.notify(
			finished === 'work'
				? '作業が終わりました。休憩しましょう。'
				: '休憩が終わりました。再開しましょう。'
		);
	} catch (error) {
		// 通知の回数の上限に当たっても、タイマーは続ける
		console.warn(error);
	}
	await render();
}

storift.ui.onEvent(async (event) => {
	if (event.id === 'start') start();
	else if (event.id === 'stop') pause();
	else if (event.id === 'reset') reset();
	else if (event.id === 'work' || event.id === 'break') {
		const minutes = Number(event.value);
		if (event.id === 'work' && WORK_OPTIONS.includes(minutes)) workMinutes = minutes;
		if (event.id === 'break' && BREAK_OPTIONS.includes(minutes)) breakMinutes = minutes;
		await storift.storage.set('settings', { workMinutes, breakMinutes });
		if (!running) remainingMs = minutesOf(mode) * 60_000;
	}
	await render();
});

(async () => {
	const saved = await storift.storage.get('settings');
	if (saved && WORK_OPTIONS.includes(saved.workMinutes)) workMinutes = saved.workMinutes;
	if (saved && BREAK_OPTIONS.includes(saved.breakMinutes)) breakMinutes = saved.breakMinutes;
	remainingMs = minutesOf(mode) * 60_000;
	await render();
})();
