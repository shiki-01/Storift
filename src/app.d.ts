// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** package.json の version(vite.config.ts の define で埋め込む) */
	const __APP_VERSION__: string;

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		/** 一覧/詳細(MasterDetail)で開いている項目。URL の hash と対で、ブラウザの戻る/進むの追従に使う */
		interface PageState {
			md?: string | null;
		}
		// interface Platform {}
	}
}

export {};
