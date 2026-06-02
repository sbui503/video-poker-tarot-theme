declare module "pokersolver" {
  export class Hand {
    name: string;
    descr: string;
    rank: number;
    static solve(cards: string[]): Hand;
  }
}
