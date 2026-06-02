import { describe, expect, it } from "vitest";
import { Card, evaluateHand } from "./game";

function c(rank: Card["rank"], suit: Card["suit"]): Card {
  return { id: `${rank}-${suit}`, rank, suit };
}

describe("evaluateHand", () => {
  it("pays the top prize for a royal flush", () => {
    const result = evaluateHand([c("10", "cups"), c("J", "cups"), c("Q", "cups"), c("K", "cups"), c("A", "cups")]);
    expect(result.name).toBe("Royal Flush");
    expect(result.multiplier).toBe(800);
  });

  it("distinguishes a straight flush from a royal flush", () => {
    const result = evaluateHand([c("5", "swords"), c("6", "swords"), c("7", "swords"), c("8", "swords"), c("9", "swords")]);
    expect(result.name).toBe("Straight Flush");
    expect(result.multiplier).toBe(50);
  });

  it("requires jacks or better for one-pair payouts", () => {
    expect(evaluateHand([c("J", "cups"), c("J", "coins"), c("5", "wands"), c("8", "swords"), c("A", "cups")]).name).toBe(
      "Jacks or Better",
    );
    expect(evaluateHand([c("10", "cups"), c("10", "coins"), c("5", "wands"), c("8", "swords"), c("A", "cups")]).name).toBe(
      "No Win",
    );
  });

  it("recognizes the middle of the payout table", () => {
    expect(evaluateHand([c("3", "cups"), c("3", "coins"), c("3", "wands"), c("9", "swords"), c("9", "cups")]).name).toBe(
      "Full House",
    );
    expect(evaluateHand([c("2", "cups"), c("5", "cups"), c("7", "cups"), c("J", "cups"), c("K", "cups")]).name).toBe("Flush");
    expect(evaluateHand([c("A", "cups"), c("2", "coins"), c("3", "wands"), c("4", "swords"), c("5", "cups")]).name).toBe(
      "Straight",
    );
  });
});
