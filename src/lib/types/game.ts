export interface GameTeam {
	image: string;
	name: string;
}

export interface GameEntry {
	team: GameTeam;
	game: { image: string; name: string };
	turnover: number;
	betCount: number;
}

export function gameImageUrl(uuid: string): string {
	return `https://engine.io/api/asset/image/${uuid}`;
}
