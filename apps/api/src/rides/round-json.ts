import type { Attraction, RideRound } from '../generated/prisma/client.js';
import { roundStats, type Stats } from './stats.js';

/** A round as the web client sees it. */
export interface RoundJson {
  id: string;
  ride: Attraction;
  ticketsSpent: number;
  startedAt: string;
  /** Null while the round is still being played. */
  endedAt: string | null;
  completed: boolean;
  stats: Stats | null;
}

export function toRoundJson(round: RideRound): RoundJson {
  return {
    id: round.id,
    ride: round.ride,
    ticketsSpent: round.ticketsSpent,
    startedAt: round.startedAt.toISOString(),
    endedAt: round.endedAt?.toISOString() ?? null,
    completed: round.completed,
    stats: roundStats(round),
  };
}
