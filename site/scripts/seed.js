// アプリの dev サーバーのページ内で実行する。撮影用の作品を入れる(使い捨てプロファイルのみ)
(async () => {
	const {
		projectsDB,
		chaptersDB,
		scenesDB,
		charactersDB,
		plotsDB,
		worldbuildingDB,
		progressLogsDB,
		db
	} = await import('/src/lib/db/index.ts');
	const P = 'cap-project';
	await projectsDB.create({
		id: P,
		title: '雨の日の栞',
		description: '坂の上の古書店で見つけた栞を手がかりに、祖母の知らない町を探す物語。'
	});
	await projectsDB.create({
		id: 'cap-2',
		title: '灯台守の手紙',
		description: '潮見町の灯台に届く、差出人のない手紙の話。'
	});
	await projectsDB.create({ id: 'cap-3', title: '最初の一行', description: '短編集。' });

	const scene = async (id, chapterId, title, lines) => {
		const content = lines.join('\n');
		await scenesDB.create({ id, chapterId, projectId: P, title, content });
		await scenesDB.update(id, { content, characterCount: content.length });
	};
	const c1 = await chaptersDB.create({
		id: 'c1',
		projectId: P,
		title: '第一章 雨の古書店',
		synopsis: ''
	});
	await scene('s1', c1.id, '坂の上の灯り', [
		'　雨の音で目が覚めた。',
		'　坂を上りきったところに、その店はある。晴れた日に訪ねても、いつも札は「閉店」のままだった。'
	]);
	await scene('s2', c1.id, '祖母の栞', [
		'　坂の上の古書店は、雨の日にだけ灯りをともす。',
		'　｜栞《しおり》の挟まった頁をひらくと、そこには祖母の字で、私の知らない町の名前が書かれていた。',
		'　「この町へは、もう行けないのよ」',
		'　そう言って笑った顔を、私はいまでも覚えている。',
		'　店主の真柴さんは、老眼鏡の奥で目を細めた。',
		'　「それはね、《《売り物じゃない》》んだ。ずっと預かっていただけで」',
		'　窓の外で、雨脚が少しだけ強くなった。'
	]);
	await scene('s3', c1.id, '地図にない名前', ['　図書館の古い地図を、端から順にひらいていった。']);
	const c2 = await chaptersDB.create({
		id: 'c2',
		projectId: P,
		title: '第二章 知らない町',
		synopsis: ''
	});
	await scene('s4', c2.id, '始発列車', ['　始発の列車は、私のほかに誰も乗せていなかった。']);
	await scene('s5', c2.id, '消えた駅', ['　時刻表には、その駅の名前だけが載っていなかった。']);
	const c3 = await chaptersDB.create({
		id: 'c3',
		projectId: P,
		title: '第三章 帰り道',
		synopsis: ''
	});
	await scene('s6', c3.id, '祖母の手紙', ['　封筒の宛名は、私の名前だった。']);

	const person = async (id, name, role, fields) => {
		await charactersDB.create({ id, projectId: P, name, role });
		await charactersDB.update(id, fields);
	};
	await person('p1', '朝倉 灯', '主人公', {
		age: 17,
		appearance: '肩で切りそろえた黒髪。雨の日はいつも祖母の傘を持ち歩く。',
		personality: '人見知りだが、気になったことは調べずにいられない。',
		background: '祖母の遺品の整理を手伝ううちに、一枚の栞を見つける。',
		relationships: [
			{ characterId: 'p2', relation: '孫' },
			{ characterId: 'p3', relation: '古書店の常連' },
			{ characterId: 'p4', relation: '同級生' }
		]
	});
	await person('p2', '朝倉 静', '祖母', {
		appearance: '小柄で背筋の伸びた人。字がきれいだった。',
		personality: '穏やかで、昔のことはあまり話さない。',
		background: '若い頃に暮らした町のことを、家族の誰にも語らなかった。',
		relationships: [{ characterId: 'p3', relation: '旧友' }]
	});
	await person('p3', '真柴 蓮', '古書店の店主', {
		appearance: '丸い老眼鏡に、くたびれた前掛け。',
		personality: '無口だが、本の話になると止まらない。',
		background: '坂の上で五十年、店を続けている。',
		relationships: [{ characterId: 'p2', relation: '旧友' }]
	});
	await person('p4', '瀬尾 湊', '同級生', {
		appearance: '背が高く、いつも自転車を押している。',
		personality: '明るく、思ったことをすぐ口にする。',
		background: '地図が好きで、灯の町探しを手伝いはじめる。',
		relationships: [{ characterId: 'p1', relation: '同級生' }]
	});

	const plot = async (id, title, type, status, content, color) => {
		await plotsDB.create({ id, projectId: P, title, type, status });
		await plotsDB.update(id, { content, color });
	};
	await plot(
		'pl1',
		'店主は祖母を知っていた?',
		'scene',
		'idea',
		'栞を見せたときの反応を伏線にする。',
		'#b0812c'
	);
	await plot(
		'pl2',
		'消えた駅の時刻表',
		'scene',
		'idea',
		'第二章の途中で、地図との食い違いに気づかせる。',
		'#b0812c'
	);
	await plot(
		'pl3',
		'町はすでに地図から消えていた',
		'arc',
		'planned',
		'ダム建設で沈んだ町だと分かる。物語の転換点。',
		'#33507a'
	);
	await plot(
		'pl4',
		'祖母が町を離れた理由',
		'chapter',
		'planned',
		'手紙の差出人と、栞の意味が重なる。',
		'#33507a'
	);
	await plot(
		'pl5',
		'栞に書かれた町を探しはじめる',
		'chapter',
		'written',
		'湊を巻き込んで、図書館と古地図をあたる。',
		'#557a4c'
	);
	await plot(
		'pl6',
		'雨の日、古書店で栞を見つける',
		'scene',
		'revised',
		'物語の入口。雨の日にだけ開く店。',
		'#6b5b7b'
	);

	const world = async (id, category, title, content, tags = []) => {
		await worldbuildingDB.create({ id, projectId: P, category, title, content });
		if (tags.length) await worldbuildingDB.update(id, { tags });
	};
	await world(
		'w1',
		'location',
		'坂の上の古書店',
		'雨の日にだけ灯りをともす店。屋号は掠れて読めない。奥の棚には売り物ではない本が並ぶ。\n\n店主の真柴が五十年、ひとりで守っている。',
		['舞台', '現在']
	);
	await world(
		'w2',
		'location',
		'霧ヶ沢',
		'栞に書かれていた町の名前。昭和四十年代にダムの底へ沈んだ。',
		['舞台', '過去']
	);
	await world(
		'w3',
		'term',
		'預かり本',
		'店主が持ち主に代わって保管している本のこと。値札がついていない。',
		['古書店']
	);
	await world('w5', 'term', '栞の符丁', '栞の裏に鉛筆で書かれた小さな数字。町の番地を表す。', [
		'古書店',
		'過去'
	]);
	await world(
		'w4',
		'timeline',
		'町の年表',
		'昭和三十八年 ダム計画の発表 / 昭和四十一年 集団移転 / 昭和四十三年 湛水開始',
		['過去']
	);
	await world('w6', 'other', '祖母の傘', '雨の日にいつも持ち歩いていた、柄の長い黒い傘。', [
		'現在'
	]);

	// 進捗: 直近 40 日ぶん、決まった並びで記録する
	const pat = [
		820, 1240, 0, 640, 1560, 980, 1320, 0, 410, 1120, 1760, 900, 0, 1280, 700, 1480, 1050, 0, 920,
		1640
	];
	const now = new Date();
	for (let i = 0; i < 40; i++) {
		const d = new Date(now.getTime() - i * 864e5);
		const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		const n = pat[i % pat.length];
		if (n) await progressLogsDB.addProgress(P, iso, n, Math.round(n / 25));
	}
	return 'seeded';
})();
