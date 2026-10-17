// データは端末内の IndexedDB が正で、サーバー側で描画する内容がない。
// クライアントのみで動かすことで、どの URL でも同じ HTML(アプリの殻)で起動でき、
// Service Worker がそれをキャッシュしてオフラインでも開けるようになる。
export const ssr = false;
export const prerender = false;
