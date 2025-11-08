const svgModules = import.meta.glob<string>('./*.svg', {
	eager: true,
	query: '?raw',
	import: 'default'
});

export const getIcon = (name: string): string | undefined => {
	const path = `./${name}.svg`;
	return svgModules[path];
};

export const getIconNames = (): string[] => {
	return Object.keys(svgModules).map((path) => path.replace('./', '').replace('.svg', ''));
};

export const getAllIcons = (): Record<string, string> => {
	const icons: Record<string, string> = {};
	for (const [path, content] of Object.entries(svgModules)) {
		const name = path.replace('./', '').replace('.svg', '');
		icons[name] = content;
	}
	return icons;
};
