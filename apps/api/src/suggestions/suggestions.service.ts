import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { User } from '../generated/prisma/client.js';
import { announceQuietly } from '../live/announce.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateSuggestionDto } from './dto/create-suggestion.dto.js';
import { SUGGESTIONS_PER_DAY, toSuggestionJson, type SuggestionJson } from './suggestion-json.js';

/** How many of their own suggestions a member sees at the Idea Box. */
const LIST_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Idea Box: members leave suggestions for the park and follow what becomes of them. Staff
 * answer in The Ringmaster's Office (RingmasterService), which marks the suggestion unread for
 * its author and tells their open game tabs at once.
 */
@Injectable()
export class SuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The member's own suggestions, newest first, and how many have news they haven't seen. */
  async mine(userId: string): Promise<{ suggestions: SuggestionJson[]; total: number; unread: number }> {
    const [rows, total, unread] = await Promise.all([
      this.prisma.suggestion.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIST_LIMIT }),
      this.prisma.suggestion.count({ where: { userId } }),
      this.prisma.suggestion.count({ where: { userId, unread: true } }),
    ]);
    return { suggestions: rows.map(toSuggestionJson), total, unread };
  }

  /**
   * Leaves a suggestion. Open whatever the park's state: it's a note to staff, not a sale. 429 with
   * code 'suggestion_limit' once the member has left SUGGESTIONS_PER_DAY in the last 24 hours.
   */
  async create(user: User, dto: CreateSuggestionDto): Promise<SuggestionJson> {
    const recent = await this.prisma.suggestion.findMany({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      take: SUGGESTIONS_PER_DAY,
    });
    if (recent.length >= SUGGESTIONS_PER_DAY) {
      // the oldest of those leaves the window first
      const nextAt = new Date(recent[recent.length - 1].createdAt.getTime() + DAY_MS);
      throw new HttpException(
        {
          ...HttpException.createBody(
            `That's ${SUGGESTIONS_PER_DAY} ideas in a day already. The box opens again for you tomorrow.`,
            'Too Many Requests',
            HttpStatus.TOO_MANY_REQUESTS,
          ),
          code: 'suggestion_limit',
          nextAt: nextAt.toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const row = await this.prisma.suggestion.create({ data: { userId: user.id, topic: dto.topic, message: dto.message } });
    await announceQuietly(this.prisma, { t: 'office', kind: 'suggestions' });
    return toSuggestionJson(row);
  }

  /** The member has read staff's news: nothing of theirs is unread any more (in every tab they have open). */
  async markSeen(userId: string): Promise<void> {
    const { count } = await this.prisma.suggestion.updateMany({ where: { userId, unread: true }, data: { unread: false } });
    if (count) await announceQuietly(this.prisma, { t: 'suggestions', userId });
  }
}
