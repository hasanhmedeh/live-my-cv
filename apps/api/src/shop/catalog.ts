// What the Ticket Booth's shop sells, for tickets. Treats are eaten at the counter and give a short
// perk in the game; souvenirs are bought once, kept, and worn. The game draws each one by its id
// (apps/web/src/world/souvenirs.ts) and applies the perks (apps/web/src/world/perks.ts), so a new
// item needs both sides.

export type ShopKind = 'treat' | 'souvenir';

/** Where a souvenir is worn: one at a time per slot. */
export type SouvenirSlot = 'head' | 'face' | 'leftHand' | 'rightHand';

/** What a treat does in the game: run faster, kick harder, or a longer next drone flight. */
export type Perk = 'speed' | 'kick' | 'drone';

export interface ShopItem {
  id: string;
  kind: ShopKind;
  name: string;
  icon: string;
  /** The price, in tickets. */
  tickets: number;
  blurb: string;
  /** Treats: what it does, if anything, and for how long. */
  perk?: Perk;
  minutes?: number;
  /** Souvenirs: where it's worn. */
  slot?: SouvenirSlot;
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: 'cotton-candy', kind: 'treat', name: 'Cotton Candy', icon: '🍭', tickets: 3, perk: 'speed', minutes: 3, blurb: 'Spun fresh while you wait. Sugar rush: you run 40% faster for 3 minutes.' },
  { id: 'popcorn', kind: 'treat', name: 'Popcorn', icon: '🍿', tickets: 2, perk: 'kick', minutes: 3, blurb: 'Hot and buttery. Power kick: crates and letters fly twice as far for 3 minutes.' },
  { id: 'soda', kind: 'treat', name: 'Fizzy Soda', icon: '🥤', tickets: 2, perk: 'drone', minutes: 60, blurb: 'Ice cold and fizzing. Your next drone flight in the hour gets 60 extra seconds of battery.' },
  { id: 'candy-apple', kind: 'treat', name: 'Candy Apple', icon: '🍎', tickets: 1, blurb: 'A crunchy fairground classic. No superpowers, just delicious.' },
  { id: 'balloon', kind: 'souvenir', slot: 'leftHand', name: 'Balloon', icon: '🎈', tickets: 4, blurb: 'A shiny red balloon on a string, bobbing along wherever you go.' },
  { id: 'shades', kind: 'souvenir', slot: 'face', name: 'Star Shades', icon: '🕶️', tickets: 5, blurb: 'Gold star-shaped sunglasses. Too cool for the queue.' },
  { id: 'cap', kind: 'souvenir', slot: 'head', name: 'Fair Cap', icon: '🧢', tickets: 6, blurb: "The fair's own cap, in candy red with a cream peak." },
  { id: 'foam-finger', kind: 'souvenir', slot: 'rightHand', name: 'Foam Finger', icon: '👆', tickets: 8, blurb: 'Giant, golden and pointing at the next ride.' },
  { id: 'top-hat', kind: 'souvenir', slot: 'head', name: "Ringmaster's Top Hat", icon: '🎩', tickets: 12, blurb: 'Black silk with a red band. Look like you run the place.' },
];

export const shopItem = (id: string) => SHOP_ITEMS.find((i) => i.id === id);

/** A catalog item as it sells today: the price set in The Ringmaster's Office, and what's left. */
export interface ShopItemJson extends ShopItem {
  /** How many are left: 0 is sold out, null is no limit. */
  stock: number | null;
}
