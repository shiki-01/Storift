import { SITE_URL } from '$lib/config';

export const prerender = true;

export function GET() {
	return new Response(`User-agent: *\nDisallow:\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
}
