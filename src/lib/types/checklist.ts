export interface ChecklistItem {
	id: number;
	parentId: number | null;
	text: string;
	type: 'group' | 'item';
	sortOrder: number;
	children: ChecklistItem[];
}