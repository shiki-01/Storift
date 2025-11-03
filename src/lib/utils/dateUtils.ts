import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

export function formatDate(timestamp: number, formatStr = 'yyyy/MM/dd HH:mm'): string {
	return format(timestamp, formatStr, { locale: ja });
}

export function formatRelativeTime(timestamp: number): string {
	return formatDistanceToNow(timestamp, { addSuffix: true, locale: ja });
}

export function formatDateLabel(timestamp: number): string {
	if (isToday(timestamp)) return '今日';
	if (isYesterday(timestamp)) return '昨日';
	return format(timestamp, 'yyyy/MM/dd', { locale: ja });
}

export function getDateKey(timestamp: number): string {
	return format(timestamp, 'yyyy-MM-dd');
}

export function parseDateKey(dateKey: string): Date {
	return parseISO(dateKey);
}
