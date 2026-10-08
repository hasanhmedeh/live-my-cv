// The Idea Box's words: what a suggestion can be about, and where it can stand. Shared by the
// kiosk in the fair (world/ideas.ts) and The Ringmaster's Office (ringmaster/ideas.ts).
import type { SuggestionStatus, SuggestionTopic } from './api';

export const TOPICS: Record<SuggestionTopic, { icon: string; label: string }> = {
  attraction: { icon: '🎢', label: 'Rides & games' },
  shop: { icon: '🍭', label: 'Treats & souvenirs' },
  park: { icon: '🌳', label: 'The park' },
  problem: { icon: '🐞', label: 'Something’s wrong' },
  other: { icon: '💡', label: 'Something else' },
};
export const TOPIC_IDS = Object.keys(TOPICS) as SuggestionTopic[];

/** Each status as the member reads it (`label`, `blurb`) and as staff pick it (`label`). */
export const STATUSES: Record<SuggestionStatus, { icon: string; label: string; blurb: string }> = {
  pending: { icon: '📨', label: 'Waiting', blurb: 'In the box. Staff will read it soon.' },
  accepted: { icon: '👍', label: 'Accepted', blurb: 'Staff like it and plan to make it happen.' },
  in_development: { icon: '🛠️', label: 'In development', blurb: 'Being built right now.' },
  done: { icon: '🎉', label: 'Done', blurb: 'It’s in the fair. Go and see!' },
  declined: { icon: '🙅', label: 'Declined', blurb: 'Not this time.' },
};
/** In the order an idea goes through them. */
export const STATUS_IDS = Object.keys(STATUSES) as SuggestionStatus[];
