import type { Suggestion, SuggestionStatus, SuggestionTopic } from '../generated/prisma/client.js';

/** The most a suggestion, or staff's answer to it, can say (a CHECK constraint backs it up). */
export const SUGGESTION_MAX = 500;

/** How many suggestions one member can leave in a day. */
export const SUGGESTIONS_PER_DAY = 5;

/** A suggestion as its author sees it at the Idea Box: what they said, where it stands, and staff's answer. */
export interface SuggestionJson {
  id: string;
  topic: SuggestionTopic;
  message: string;
  status: SuggestionStatus;
  statusChangedAt: string | null;
  reply: string | null;
  repliedAt: string | null;
  /** The username of the member of staff who answered. */
  repliedBy: string | null;
  /** Staff answered or changed the status since the author last looked. */
  unread: boolean;
  createdAt: string;
}

export function toSuggestionJson(s: Suggestion): SuggestionJson {
  return {
    id: s.id,
    topic: s.topic,
    message: s.message,
    status: s.status,
    statusChangedAt: s.statusChangedAt?.toISOString() ?? null,
    reply: s.reply,
    repliedAt: s.repliedAt?.toISOString() ?? null,
    repliedBy: s.repliedByName,
    unread: s.unread,
    createdAt: s.createdAt.toISOString(),
  };
}
