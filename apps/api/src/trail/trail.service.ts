import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type RideRound } from '../generated/prisma/client.js';
import { announceQuietly } from '../live/announce.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { roundStats } from '../rides/stats.js';
import { addDays, BOARD_RESET_HOUR, BOARD_TIME_ZONE, boardDay, boardEnd, boardStart, dayDate } from './board-day.js';

/**
 * The quickest a run could possibly be: the 547 m loop flat out on boost all the way would take
 * about 20 s, and a real run takes over 30. Anything faster wasn't driven.
 */
export const TRAIL_MIN_MS = 25_000;
/** A run longer than this isn't a run: the round's clock would have run out long before. */
export const TRAIL_MAX_MS = 15 * 60_000;
/** The run is timed in the browser; its round on the server can't be shorter than it (a little slack for the clocks). */
const CLOCK_SLACK_MS = 2_000;
/**
 * The game hands a run in a few seconds after it crosses the line (the cool-down, the fade) and says
 * how long ago that was (`lineAgoS`): the run counts on the board open when it crossed, up to this
 * long before it was handed in.
 */
const LINE_AGO_MAX_S = 15;
/** How many players today's board shows, and how many the office's does. */
export const BOARD_TOP = 10;
export const OFFICE_TOP = 100;
/** How many boards back the office's history goes. */
const HISTORY_DAYS = 30;

/** One player on a board: their fastest run on it. */
export interface TrailEntryJson {
  rank: number;
  username: string;
  timeMs: number;
  at: string;
  me?: boolean;
}

/** GET /trail/leaderboard: today's board. */
export interface TrailBoardJson {
  day: string;
  startsAt: string;
  resetsAt: string;
  timeZone: string;
  resetHour: number;
  players: number;
  runs: number;
  entries: TrailEntryJson[];
  me: TrailEntryJson | null;
  /** The server's clock as it answered, so the game's countdowns don't depend on the visitor's. */
  now: string;
}

/** Where a finished run left its driver on today's board. */
export interface TrailPlacement {
  day: string;
  timeMs: number;
  bestMs: number;
  rank: number;
  players: number;
  /** This run is the driver's best on the board. */
  improved: boolean;
  resetsAt: string;
  /** It crossed the line just before noon, so it counts on the board that has closed since. */
  closed: boolean;
}

export interface TrailOfficeEntryJson {
  runId: string;
  rank: number;
  userId: string;
  username: string;
  timeMs: number;
  at: string;
  runs: number;
}

/** GET /ringmaster/trail: one board as staff see it, and how the trail does. */
export interface TrailOfficeJson {
  day: string;
  startsAt: string;
  endsAt: string;
  current: boolean;
  today: string;
  timeZone: string;
  resetHour: number;
  board: TrailOfficeEntryJson[];
  disqualified: { id: string; userId: string; username: string; timeMs: number; at: string }[];
  stats: { runs: number; players: number; rounds: number; completed: number; avgMs: number | null; medianMs: number | null };
  record: { timeMs: number; username: string; at: string; day: string } | null;
  daily: { day: string; runs: number; players: number; bestMs: number | null; winner: string | null }[];
}

interface RankedRow {
  runId: string;
  userId: string;
  username: string;
  timeMs: number;
  at: Date;
  rank: number;
  players: number;
  runs: number;
}

/**
 * The Rally Trail's daily leaderboard. Every run that crosses the line is kept with the board day
 * it counts for; a board is just the runs of one day, so the noon turnover deletes nothing (the
 * office looks back at any day). A player's place on a board is their fastest run that isn't
 * disqualified, ties going to whoever set the time first.
 */
@Injectable()
export class TrailService {
  private readonly logger = new Logger(TrailService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A Rally Trail round just finished: if it crossed the line in a believable time, its run goes on
   * today's board. Returns where that leaves the driver, or null when it doesn't count (no time,
   * or one the round's own length rules out).
   */
  async record(round: RideRound): Promise<TrailPlacement | null> {
    const stats = roundStats(round);
    const time = stats?.runTimeS;
    if (round.ride !== 'trail' || !round.completed || !round.endedAt || typeof time !== 'number') return null;
    const timeMs = Math.round(time * 1000);
    const lasted = round.endedAt.getTime() - round.startedAt.getTime();
    if (timeMs < TRAIL_MIN_MS || timeMs > TRAIL_MAX_MS || timeMs > lasted + CLOCK_SLACK_MS) return null;

    // when it crossed the line: a run at 11:59:58 counts on that board, even handed in after noon
    const ago = typeof stats?.lineAgoS === 'number' ? Math.min(LINE_AGO_MAX_S, Math.max(0, stats.lineAgoS)) : 0;
    const crossed = new Date(Math.max(round.startedAt.getTime(), round.endedAt.getTime() - ago * 1000));
    const day = boardDay(crossed);
    const before = await this.prisma.trailRun.aggregate({
      where: { userId: round.userId, day: dayDate(day), disqualified: false },
      _min: { timeMs: true },
    });
    try {
      await this.prisma.trailRun.create({ data: { roundId: round.id, userId: round.userId, timeMs, day: dayDate(day), createdAt: crossed } });
    } catch (err) {
      // the round's run is on the board already (one run per round)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
    await announceQuietly(this.prisma, { t: 'leaderboard' });
    await announceQuietly(this.prisma, { t: 'office', kind: 'trail' });

    const [mine] = await this.ranked(day, 0, round.userId);
    const previous = before._min.timeMs;
    return {
      day,
      timeMs,
      bestMs: mine?.timeMs ?? timeMs,
      rank: mine?.rank ?? 1,
      players: mine?.players ?? 1,
      improved: previous === null || timeMs < previous,
      resetsAt: boardEnd(day).toISOString(),
      closed: day !== boardDay(),
    };
  }

  /** `record`, without ever failing the round's finish: the round is saved already, and a lost run is only logged. */
  async recordQuietly(round: RideRound): Promise<TrailPlacement | null> {
    try {
      return await this.record(round);
    } catch (err) {
      this.logger.error(`Couldn't put round ${round.id} on the Rally Trail's leaderboard: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Today's board: the top ten, and where `userId` stands on it. */
  async board(userId: string | null): Promise<TrailBoardJson> {
    const day = boardDay();
    const [rows, runs] = await Promise.all([
      this.ranked(day, BOARD_TOP, userId),
      this.prisma.trailRun.count({ where: { day: dayDate(day), disqualified: false } }),
    ]);
    const entry = (r: RankedRow): TrailEntryJson => ({
      rank: r.rank,
      username: r.username,
      timeMs: r.timeMs,
      at: r.at.toISOString(),
      ...(r.userId === userId ? { me: true } : {}),
    });
    const mine = userId ? rows.find((r) => r.userId === userId) : undefined;
    return {
      day,
      startsAt: boardStart(day).toISOString(),
      resetsAt: boardEnd(day).toISOString(),
      timeZone: BOARD_TIME_ZONE,
      resetHour: BOARD_RESET_HOUR,
      players: rows[0]?.players ?? 0,
      runs,
      entries: rows.filter((r) => r.rank <= BOARD_TOP).map(entry),
      me: mine ? entry(mine) : null,
      now: new Date().toISOString(),
    };
  }

  /** One board as the office sees it (today's without a day), with the trail's numbers and its history. */
  async office(day?: string): Promise<TrailOfficeJson> {
    const today = boardDay();
    const shown = day ?? today;
    const start = boardStart(shown);
    const end = boardEnd(shown);
    const date = dayDate(shown);
    // raw queries take the day as text, cast to a date: a timestamp parameter would shift with the database's time zone
    const since = addDays(today, -(HISTORY_DAYS - 1));
    const [board, disqualified, [totals], rounds, completed, [record], perDay, winners] = await Promise.all([
      this.ranked(shown, OFFICE_TOP, null),
      this.prisma.trailRun.findMany({
        where: { day: date, disqualified: true },
        include: { user: { select: { username: true } } },
        orderBy: [{ timeMs: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.$queryRaw<[{ runs: number; players: number; avgMs: number | null; medianMs: number | null }]>`
        SELECT (COUNT(*))::int AS runs, (COUNT(DISTINCT user_id))::int AS players,
               (AVG(time_ms))::float8 AS "avgMs",
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY time_ms))::float8 AS "medianMs"
        FROM trail_runs WHERE day = ${shown}::date AND NOT disqualified`,
      this.prisma.rideRound.count({ where: { ride: 'trail', startedAt: { gte: start, lt: end } } }),
      this.prisma.rideRound.count({ where: { ride: 'trail', completed: true, startedAt: { gte: start, lt: end } } }),
      this.prisma.$queryRaw<{ timeMs: number; username: string; at: Date; day: string }[]>`
        SELECT r.time_ms AS "timeMs", u.username, r.created_at AS at, to_char(r.day, 'YYYY-MM-DD') AS day
        FROM trail_runs r JOIN users u ON u.id = r.user_id
        WHERE NOT r.disqualified
        ORDER BY r.time_ms ASC, r.created_at ASC, r.id ASC
        LIMIT 1`,
      this.prisma.$queryRaw<{ day: string; runs: number; players: number; bestMs: number }[]>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, (COUNT(*))::int AS runs, (COUNT(DISTINCT user_id))::int AS players, MIN(time_ms) AS "bestMs"
        FROM trail_runs WHERE day >= ${since}::date AND NOT disqualified GROUP BY day`,
      this.prisma.$queryRaw<{ day: string; username: string }[]>`
        SELECT DISTINCT ON (r.day) to_char(r.day, 'YYYY-MM-DD') AS day, u.username
        FROM trail_runs r JOIN users u ON u.id = r.user_id
        WHERE r.day >= ${since}::date AND NOT r.disqualified
        ORDER BY r.day, r.time_ms ASC, r.created_at ASC, r.id ASC`,
    ]);

    const byDay = new Map(perDay.map((d) => [d.day, d]));
    const winner = new Map(winners.map((w) => [w.day, w.username]));
    const daily: TrailOfficeJson['daily'] = [];
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const row = byDay.get(d);
      daily.push({ day: d, runs: row?.runs ?? 0, players: row?.players ?? 0, bestMs: row?.bestMs ?? null, winner: winner.get(d) ?? null });
    }
    return {
      day: shown,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      current: shown === today,
      today,
      timeZone: BOARD_TIME_ZONE,
      resetHour: BOARD_RESET_HOUR,
      board: board.map((r) => ({ runId: r.runId, rank: r.rank, userId: r.userId, username: r.username, timeMs: r.timeMs, at: r.at.toISOString(), runs: r.runs })),
      disqualified: disqualified.map((r) => ({ id: r.id, userId: r.userId, username: r.user.username, timeMs: r.timeMs, at: r.createdAt.toISOString() })),
      stats: {
        runs: totals?.runs ?? 0,
        players: totals?.players ?? 0,
        rounds,
        completed,
        avgMs: totals?.avgMs ?? null,
        medianMs: totals?.medianMs ?? null,
      },
      record: record ? { timeMs: record.timeMs, username: record.username, at: record.at.toISOString(), day: record.day } : null,
      daily,
    };
  }

  /**
   * One board, ranked in Postgres: each player's fastest run that isn't disqualified (ties to the
   * earlier one), numbered from 1. Returns the first `limit` places, plus `userId`'s wherever it is.
   */
  private ranked(day: string, limit: number, userId: string | null): Promise<RankedRow[]> {
    return this.prisma.$queryRaw<RankedRow[]>`
      WITH best AS (
        SELECT DISTINCT ON (user_id) id, user_id, time_ms, created_at
        FROM trail_runs
        WHERE day = ${day}::date AND NOT disqualified
        ORDER BY user_id, time_ms ASC, created_at ASC, id ASC
      ), counts AS (
        SELECT user_id, (COUNT(*))::int AS runs
        FROM trail_runs
        WHERE day = ${day}::date AND NOT disqualified
        GROUP BY user_id
      ), ranked AS (
        SELECT best.*, (ROW_NUMBER() OVER (ORDER BY time_ms ASC, created_at ASC, id ASC))::int AS rank, (COUNT(*) OVER ())::int AS players
        FROM best
      )
      SELECT ranked.id AS "runId", ranked.user_id AS "userId", u.username, ranked.time_ms AS "timeMs", ranked.created_at AS at,
             ranked.rank, ranked.players, counts.runs
      FROM ranked
      JOIN users u ON u.id = ranked.user_id
      JOIN counts ON counts.user_id = ranked.user_id
      WHERE ranked.rank <= ${limit} OR ranked.user_id = ${userId ?? ''}
      ORDER BY ranked.rank`;
  }
}
