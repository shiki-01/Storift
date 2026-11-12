import { SITE_URL } from '$lib/config';
import { extensions } from '$lib/extensions';

export const prerender = true;

const paths = [
	'',
	'/features',
	'/guide',
	'/guide/firebase',
	'/extensions',
	'/extensions/submit',
	...extensions.map((e) => `/extensions/${e.id}`),
	'/faq',
	'/privacy',
	'/terms'
];

export function GET() {
	const urls = paths.map((p) => `\t<url><loc>${SITE_URL}${p}</loc></url>`).join('\n');
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
	return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
