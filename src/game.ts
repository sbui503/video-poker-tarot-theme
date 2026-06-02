import { Hand } from "pokersolver";

export type Suit = "cups" | "coins" | "wands" | "swords";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export type Card = {
  id: string;
  rank: Rank;
  suit: Suit;
};

export type PayoutName =
  | "Royal Flush"
  | "Straight Flush"
  | "Four of a Kind"
  | "Full House"
  | "Flush"
  | "Straight"
  | "Three of a Kind"
  | "Two Pair"
  | "Jacks or Better"
  | "No Win";

export type PayoutResult = {
  name: PayoutName;
  multiplier: number;
  solverName: string;
  solverDescription: string;
};

export const ranks: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const suits: Suit[] = ["cups", "coins", "wands", "swords"];

export const payoutTable: Array<{ name: PayoutName; multiplier: number }> = [
  { name: "Royal Flush", multiplier: 800 },
  { name: "Straight Flush", multiplier: 50 },
  { name: "Four of a Kind", multiplier: 25 },
  { name: "Full House", multiplier: 9 },
  { name: "Flush", multiplier: 6 },
  { name: "Straight", multiplier: 4 },
  { name: "Three of a Kind", multiplier: 3 },
  { name: "Two Pair", multiplier: 2 },
  { name: "Jacks or Better", multiplier: 1 },
];

const solverRankByRank: Record<Rank, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "T",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};

const solverSuitBySuit: Record<Suit, string> = {
  cups: "h",
  coins: "d",
  wands: "c",
  swords: "s",
};

const rankPower: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export const tarotSuitMeta: Record<Suit, { title: string; symbol: string; accent: string; meaning: string }> = {
  cups: { title: "Cups", symbol: "V", accent: "#cf4662", meaning: "tide" },
  coins: { title: "Coins", symbol: "O", accent: "#d6a84e", meaning: "fortune" },
  wands: { title: "Wands", symbol: "I", accent: "#e87945", meaning: "spark" },
  swords: { title: "Swords", symbol: "X", accent: "#67b9d1", meaning: "edge" },
};

export function createDeck(): Card[] {
  return suits.flatMap((suit) =>
    ranks.map((rank) => ({
      id: `${rank}-${suit}`,
      rank,
      suit,
    })),
  );
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function solverCode(card: Card): string {
  return `${solverRankByRank[card.rank]}${solverSuitBySuit[card.suit]}`;
}

export function dealFromDeck(deck: Card[], count: number): { cards: Card[]; deck: Card[] } {
  return {
    cards: deck.slice(0, count),
    deck: deck.slice(count),
  };
}

export function replaceCards(hand: Card[], deck: Card[], held: boolean[]): { hand: Card[]; deck: Card[]; drawn: number[] } {
  const nextHand = [...hand];
  const nextDeck = [...deck];
  const drawn: number[] = [];

  for (let index = 0; index < nextHand.length; index += 1) {
    if (!held[index]) {
      const next = nextDeck.shift();
      if (!next) {
        throw new Error("The deck ran out of cards.");
      }
      nextHand[index] = next;
      drawn.push(index);
    }
  }

  return { hand: nextHand, deck: nextDeck, drawn };
}

function hasRoyalRanks(cards: Card[]): boolean {
  const values = new Set(cards.map((card) => card.rank));
  return ["10", "J", "Q", "K", "A"].every((rank) => values.has(rank as Rank));
}

function highPairName(cards: Card[]): PayoutName | undefined {
  const counts = cards.reduce<Record<string, number>>((acc, card) => {
    acc[card.rank] = (acc[card.rank] ?? 0) + 1;
    return acc;
  }, {});
  const highPair = Object.entries(counts).find(([rank, count]) => count === 2 && rankPower[rank as Rank] >= rankPower.J);
  return highPair ? "Jacks or Better" : undefined;
}

export function evaluateHand(cards: Card[]): PayoutResult {
  if (cards.length !== 5) {
    throw new Error("Video poker requires exactly five cards.");
  }

  const solved = Hand.solve(cards.map(solverCode));
  const solverName = solved.name;
  const solverDescription = solved.descr;
  let name: PayoutName = "No Win";
  let multiplier = 0;

  if (solverName === "Straight Flush" && hasRoyalRanks(cards)) {
    name = "Royal Flush";
    multiplier = 800;
  } else if (solverName === "Straight Flush") {
    name = "Straight Flush";
    multiplier = 50;
  } else if (solverName === "Four of a Kind") {
    name = "Four of a Kind";
    multiplier = 25;
  } else if (solverName === "Full House") {
    name = "Full House";
    multiplier = 9;
  } else if (solverName === "Flush") {
    name = "Flush";
    multiplier = 6;
  } else if (solverName === "Straight") {
    name = "Straight";
    multiplier = 4;
  } else if (solverName === "Three of a Kind") {
    name = "Three of a Kind";
    multiplier = 3;
  } else if (solverName === "Two Pair") {
    name = "Two Pair";
    multiplier = 2;
  } else if (solverName === "Pair") {
    const highPair = highPairName(cards);
    if (highPair) {
      name = highPair;
      multiplier = 1;
    }
  }

  return { name, multiplier, solverName, solverDescription };
}

export function formatCard(card: Card): string {
  return `${card.rank} of ${tarotSuitMeta[card.suit].title}`;
}
