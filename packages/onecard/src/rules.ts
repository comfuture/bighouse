/**
 * Which card may be played on the table, shared by the authoritative server
 * and the browser client so the hand never offers a card the server rejects.
 */
export type Suit = "S" | "H" | "C" | "D";

/** The part of the table that decides whether a card is playable. */
export type PlayTable = {
  discardPile: string[];
  activeAttackCount: number;
  activeAttackCard?: string;
  chosenSuit?: Suit;
};

export function isJoker(card: string): boolean {
  return card === "BJ" || card === "CJ";
}

/** Rank of a card; a Joker is its own rank. */
export function rankOf(card: string): string {
  return isJoker(card) ? card : card.slice(0, -1);
}

/** Suit of a card; Jokers have none. */
export function suitOf(card: string): Suit | "J" {
  return isJoker(card) ? "J" : (card.slice(-1) as Suit);
}

/** Why `card` may not be played on `table`, or null when it may. */
export function cardPlayProblem(table: PlayTable, card: string): string | null {
  const topCard = table.discardPile[table.discardPile.length - 1];
  if (!topCard) return null;

  const cardRank = rankOf(card);

  // An attack is on the table: only a defending card may be played.
  if (table.activeAttackCount > 0 && table.activeAttackCard) {
    const attackCard = table.activeAttackCard;
    const attackRank = rankOf(attackCard);
    if (attackRank === "2") {
      return cardRank === "2" || cardRank === "A" || isJoker(card) ? null : "Must defend attack with a 2, A, or Joker";
    }
    if (attackRank === "A") {
      return cardRank === "A" || isJoker(card) ? null : "Must defend Ace attack with an Ace or Joker";
    }
    if (attackCard === "BJ") {
      return card === "CJ" ? null : "Must defend Black Joker with a Color Joker";
    }
    if (attackCard === "CJ") {
      return "Color Joker attack cannot be defended";
    }
  }

  if (isJoker(card)) return null;

  const topIsJoker = isJoker(topCard);
  const topRank = rankOf(topCard);

  // After a Joker or a 7 the called suit rules. Same rank still matches, so a 7 answers a 7.
  if ((topIsJoker || topRank === "7") && table.chosenSuit) {
    if (suitOf(card) === table.chosenSuit || (!topIsJoker && cardRank === topRank)) return null;
    return `Must match the chosen suit: ${table.chosenSuit}`;
  }

  if (suitOf(card) === suitOf(topCard) || cardRank === topRank) return null;
  return "Card must match the top card's suit or number";
}
