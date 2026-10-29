import type { EntityType } from './sync';

export interface PendingChange {
	type: EntityType;
	id: string;
	action: 'create' | 'update' | 'delete';
}

const BASE_KEY = 'storift_sync_base';
const PENDING_KEY = 'storift_sync_pending';

function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (error) {
		console.warn('Failed to persist sync metadata:', error);
	}
}

const keyOf = (type: EntityType, id: string) => `${type}/${id}`;

let bases: Record<string, number> | null = null;

function loadBases(): Record<string, number> {
	if (!bases) bases = read<Record<string, number>>(BASE_KEY, {});
	return bases;
}

/** 両端末が最後に一致していた版の updatedAt */
export function getBase(type: EntityType, id: string): number | undefined {
	return loadBases()[keyOf(type, id)];
}

export function setBase(type: EntityType, id: string, updatedAt: number): void {
	loadBases()[keyOf(type, id)] = updatedAt;
	write(BASE_KEY, bases);
}

export function removeBase(type: EntityType, id: string): void {
	delete loadBases()[keyOf(type, id)];
	write(BASE_KEY, bases);
}

export function loadPendingChanges(): PendingChange[] {
	return read<PendingChange[]>(PENDING_KEY, []);
}

export function savePendingChanges(changes: PendingChange[]): void {
	write(PENDING_KEY, changes);
}
