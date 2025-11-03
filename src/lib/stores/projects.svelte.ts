import type { Project } from '$lib/types';

let projects = $state<Project[]>([]);
let isLoading = $state(false);
let searchQuery = $state('');

export const projectsStore = {
	get projects() {
		return projects;
	},
	set projects(value: Project[]) {
		projects = value;
	},
	get isLoading() {
		return isLoading;
	},
	set isLoading(value: boolean) {
		isLoading = value;
	},
	get searchQuery() {
		return searchQuery;
	},
	set searchQuery(value: string) {
		searchQuery = value;
	},
	get filteredProjects() {
		if (!searchQuery) return projects;
		const query = searchQuery.toLowerCase();
		return projects.filter(
			(p) =>
				p.title.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)
		);
	}
};
