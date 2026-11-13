// Discord Webhook 投稿(Storift スクリプト拡張)。作者: shiki-01 / MIT
// 仕様: docs/SCRIPT_API.md。通信先は manifest.json で宣言した discord.com だけ。

const WEBHOOK_PREFIX = 'https://discord.com/api/webhooks/';

let webhookUrl = '';
let enabled = true;
let includeTitle = false;
// 最後の操作の結果(画面に出す短い文)
let status = '';

const hasWebhook = () => webhookUrl.startsWith(WEBHOOK_PREFIX);

async function load() {
	webhookUrl = (await storift.storage.get('webhookUrl')) ?? '';
	enabled = (await storift.storage.get('enabled')) ?? true;
	includeTitle = (await storift.storage.get('includeTitle')) ?? false;
}

async function render() {
	await storift.ui.set('settings', [
		{
			type: 'input',
			id: 'webhook',
			label: 'Webhook の URL',
			secret: true,
			// 保存済みの URL は、画面に戻さない(入れ直したいときだけ入力する)
			placeholder: hasWebhook() ? '設定済み(変えるときだけ入力)' : `${WEBHOOK_PREFIX}…`,
			description: 'この端末の中にだけ保存します。Discord へ投稿するとき以外は、使いません。'
		},
		{ type: 'toggle', id: 'enabled', label: '終了時に投稿する', value: enabled },
		{
			type: 'toggle',
			id: 'title',
			label: '作品名を含める',
			value: includeTitle,
			description: 'オンにすると、投稿に作品名が入ります(既定はオフ)。'
		},
		{ type: 'button', id: 'test', label: 'テスト送信', disabled: !hasWebhook() },
		...(status ? [{ type: 'text', text: status, tone: 'muted' }] : [])
	]);
}

const plus = (n) => (n > 0 ? `+${n}` : String(n));

/** 投稿する文。メンション(@everyone など)は無効にして送る */
function buildMessage(session) {
	const minutes = Math.max(
		0,
		Math.round(((session.endedAt ?? session.lastEditAt) - session.startedAt) / 60_000)
	);
	const lines = ['執筆セッションが終わりました。'];
	if (includeTitle && typeof session.projectTitle === 'string' && session.projectTitle) {
		lines.push(`作品: ${session.projectTitle.slice(0, 100)}`);
	}
	lines.push(`増減した文字数: ${plus(session.netChars)} 文字`);
	lines.push(`所要時間: ${minutes} 分`);
	return lines.join('\n');
}

async function post(content) {
	const response = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username: 'Storift', content, allowed_mentions: { parse: [] } })
	});
	if (!response.ok) throw new Error(`Discord が ${response.status} を返しました`);
}

async function send(content) {
	try {
		await post(content);
		status = '投稿しました。';
	} catch (error) {
		status = '投稿できませんでした。';
		await storift.notify(
			`Discord に投稿できませんでした: ${String(error.message ?? error).slice(0, 100)}`
		);
	}
	await render();
}

storift.ui.onEvent(async (event) => {
	if (event.id === 'webhook' && typeof event.value === 'string') {
		const url = event.value.trim();
		if (url === '') return;
		if (!url.startsWith(WEBHOOK_PREFIX)) {
			status = `Webhook の URL は ${WEBHOOK_PREFIX} で始まるものを入れてください。`;
		} else {
			webhookUrl = url;
			await storift.storage.set('webhookUrl', url);
			status = 'Webhook の URL を保存しました。';
		}
	} else if (event.id === 'enabled') {
		enabled = event.value === true;
		await storift.storage.set('enabled', enabled);
	} else if (event.id === 'title') {
		includeTitle = event.value === true;
		await storift.storage.set('includeTitle', includeTitle);
	} else if (event.id === 'test' && hasWebhook()) {
		await send('Storift からのテスト送信です。');
		return;
	}
	await render();
});

(async () => {
	await load();
	await storift.events.on('session:end', async (session) => {
		if (!enabled || !hasWebhook()) return;
		await send(buildMessage(session));
	});
	await render();
})();
