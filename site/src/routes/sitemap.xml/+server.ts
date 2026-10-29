import { SITE_URL } from '$lib/config';

export const prerender = true;

const paths = ['', '/features', '/guide', '/faq'];

export function GET() {
	const urls = paths.map((p) => `\t<url><loc>${SITE_URL}${p}</loc></url>`).join('\n');
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
	return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
