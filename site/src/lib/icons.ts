/** 24x24 の線画アイコン(svg の中身だけ)。執筆画面などはアプリの src/lib/components/layout/nav.ts と同じ形 */
export const icons = {
	write: '<path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4"/><path d="M13.5 6.5l4 4"/>',
	plot: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17" cy="6" r="2"/><circle cx="14" cy="18" r="2"/>',
	characters:
		'<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.4c1.8.9 3 2.8 3 5.6"/>',
	world:
		'<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/>',
	progress: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
	home: '<path d="M4 6.5h6l2 2h8V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 6.5V6a2 2 0 0 1 2-2h3l2 2.5"/>',
	settings:
		'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
	ai: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
	vertical: '<path d="M17 4v16M12 4v16M7 4v9"/>',
	offline:
		'<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/><path d="M12 11v5M10 14l2 2 2-2"/>',
	sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
	history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
	export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
	check: '<path d="M4 12.5l5 5L20 6.5"/>',
	desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
	phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
	arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
	grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
	book: '<path d="M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2z"/><path d="M12 6.5v14"/>',
	help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.8 2.1c-.8.5-1.3 1-1.3 1.9"/><path d="M12 17h.01"/>',
	play: '<path d="M7 4.5v15l12-7.5z"/>',
	pause: '<path d="M8 5v14M16 5v14"/>',
	replay: '<path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5"/><path d="M4 4v4.5h4.5"/>',
	split: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16"/>',
	eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
	panel: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.5 4v16"/>',
	print:
		'<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
	palette:
		'<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.9-.9 1.9-1.9 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h2.1a4.2 4.2 0 0 0 3.7-4.2c0-3.7-3.8-6.5-8.5-6.5z"/><circle cx="7.8" cy="11.5" r="1"/><circle cx="10.5" cy="7.8" r="1"/><circle cx="15" cy="8" r="1"/>'
} as const;

export type IconName = keyof typeof icons;
