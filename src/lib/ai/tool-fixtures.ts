/**
 * アプリのツール定義(src-tauri/src/mcp.rs の tool_definitions と同じ内容)のテスト用の写し。
 * 本番のコードからは読み込まない。mcp.rs を変えたら、ここも合わせる
 * (名前の食い違いは tool-fixtures.test.ts が検出する)。
 */
import type { ToolSpec } from './http/agent';

const project = { type: 'string', description: '省略時は開いている作品' };
const kindList = {
	type: 'string',
	enum: ['characters', 'plots', 'worldbuilding', 'memos', 'progressLogs', 'relationMaps', 'history']
};
const kindItem = {
	type: 'string',
	enum: [
		'chapters',
		'characters',
		'plots',
		'worldbuilding',
		'memos',
		'progressLogs',
		'relationMaps',
		'history'
	]
};

export const STORIFT_TOOLS: ToolSpec[] = [
	{
		name: 'list_projects',
		description: '作品の一覧(id, title)を返す',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'get_outline',
		description: '作品の章とシーンの構成を返す',
		inputSchema: { type: 'object', properties: { projectId: project } }
	},
	{
		name: 'list_items',
		description: '項目の軽量な一覧(id, title, sub)を返す。本文は get_item で取る',
		inputSchema: {
			type: 'object',
			properties: {
				kind: kindList,
				projectId: project,
				limit: { type: 'integer', minimum: 1 },
				cursor: { type: 'string', description: '前回の nextCursor' }
			},
			required: ['kind']
		}
	},
	{
		name: 'get_scene',
		description: 'シーン本文を返す。長いときは offset(文字位置)と limit で分割',
		inputSchema: {
			type: 'object',
			properties: {
				sceneId: { type: 'string' },
				offset: { type: 'integer', minimum: 0 },
				limit: { type: 'integer', minimum: 1 }
			},
			required: ['sceneId']
		}
	},
	{
		name: 'get_item',
		description: '項目 1 件の全文を返す(章の概要は kind=chapters)',
		inputSchema: {
			type: 'object',
			properties: { kind: kindItem, id: { type: 'string' } },
			required: ['kind', 'id']
		}
	},
	{
		name: 'search',
		description: 'シーン本文と各項目を全文検索する',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				kinds: { type: 'array', items: { type: 'string' } },
				projectId: project,
				limit: { type: 'integer', minimum: 1 }
			},
			required: ['query']
		}
	},
	{
		name: 'get_history',
		description: '変更履歴の一覧を返す。id を指定するとその 1 件の詳細',
		inputSchema: { type: 'object', properties: { id: { type: 'string' } } }
	},
	{
		name: 'propose_edit',
		description:
			'シーンや項目の本文を old から new へ置換する編集を提案する(old は一意に一致すること)',
		inputSchema: {
			type: 'object',
			properties: {
				kind: {
					type: 'string',
					enum: [
						'scene',
						'characters',
						'plots',
						'worldbuilding',
						'memos',
						'progressLogs',
						'relationMaps',
						'chapters'
					]
				},
				id: { type: 'string' },
				old: { type: 'string', description: '置換前の文。対象内で 1 か所だけ一致すること' },
				new: { type: 'string' }
			},
			required: ['kind', 'id', 'old', 'new']
		}
	},
	{
		name: 'propose_create',
		description:
			'項目(キャラクター・プロット・設定資料・メモ・進捗・章)の新規追加を提案する。fields は項目名と値(get_item の「## 節」の名前。作成時は名前・タイトル・種類・分類も必須)',
		inputSchema: {
			type: 'object',
			properties: {
				kind: {
					type: 'string',
					enum: ['characters', 'plots', 'worldbuilding', 'memos', 'progressLogs', 'chapters']
				},
				fields: {
					type: 'object',
					description: '項目名 → 値。characters は 名前(必須)・役割・外見・性格・背景、など',
					additionalProperties: { type: ['string', 'number'] }
				},
				projectId: project
			},
			required: ['kind', 'fields']
		}
	},
	{
		name: 'propose_delete',
		description:
			'項目(キャラクター・プロット・設定資料・メモ・進捗)の削除を提案する。シーン・章・履歴・相関図は削除できない',
		inputSchema: {
			type: 'object',
			properties: {
				kind: {
					type: 'string',
					enum: ['characters', 'plots', 'worldbuilding', 'memos', 'progressLogs']
				},
				id: { type: 'string' }
			},
			required: ['kind', 'id']
		}
	}
];
