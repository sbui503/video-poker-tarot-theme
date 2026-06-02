import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  BadgeDollarSign,
  ChevronDown,
  ChevronUp,
  Hand,
  Play,
  RefreshCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  Card,
  PayoutResult,
  createDeck,
  dealFromDeck,
  evaluateHand,
  formatCard,
  payoutTable,
  replaceCards,
  shuffleDeck,
  tarotSuitMeta,
} from "./game";

type Phase = "ready" | "deal" | "draw" | "settled";

type HandSlot = {
  card: Card;
  fresh: boolean;
};

const STARTING_CREDITS = 500;
const MAX_BET = 5;
const emptyResult = { name: "No Win", multiplier: 0, solverName: "", solverDescription: "" } as const;

const openingHand = Array.from({ length: 5 }, (_, index) => index);

function useSound(enabled: boolean) {
  const audio = useRef<AudioContext | null>(null);

  return (kind: "deal" | "hold" | "win" | "lose") => {
    if (!enabled) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    audio.current ??= new AudioCtor();
    const ctx = audio.current;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const tones = {
      deal: [196, 294],
      hold: [262, 392],
      win: [330, 523],
      lose: [146, 110],
    }[kind];

    oscillator.type = kind === "win" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(tones[0], ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(tones[1], ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(kind === "win" ? 0.12 : 0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.24);
  };
}

function emptySlots() {
  return openingHand.map(() => null);
}

export default function App() {
  const [credits, setCredits] = useState(STARTING_CREDITS);
  const [bet, setBet] = useState(5);
  const [phase, setPhase] = useState<Phase>("ready");
  const [deck, setDeck] = useState<Card[]>(() => shuffleDeck(createDeck()));
  const [hand, setHand] = useState<Array<HandSlot | null>>(() => emptySlots());
  const [held, setHeld] = useState<boolean[]>(() => openingHand.map(() => false));
  const [result, setResult] = useState<PayoutResult>(emptyResult);
  const [message, setMessage] = useState("Ante in and reveal the spread.");
  const [lastWin, setLastWin] = useState(0);
  const [streak, setStreak] = useState(0);
  const [sound, setSound] = useState(true);
  const [flashWin, setFlashWin] = useState(false);
  const playSound = useSound(sound);

  const canDeal = phase === "ready" || phase === "settled";
  const canDraw = phase === "deal";
  const wager = Math.min(bet, credits);
  const activeCards = hand.filter((slot): slot is HandSlot => slot !== null).map((slot) => slot.card);
  const cardsLeft = deck.length;

  const tableRows = useMemo(
    () =>
      payoutTable.map((entry) => ({
        ...entry,
        value: entry.multiplier * bet,
      })),
    [bet],
  );

  useEffect(() => {
    if (!flashWin) return;
    const timer = window.setTimeout(() => setFlashWin(false), 1200);
    return () => window.clearTimeout(timer);
  }, [flashWin]);

  function deal(stakeRequest = bet) {
    const stake = Math.min(stakeRequest, credits);
    if (stake <= 0) {
      setCredits(STARTING_CREDITS);
      setMessage("The house restores your purse.");
      setLastWin(0);
      setStreak(0);
      setPhase("ready");
      return;
    }

    const shuffled = shuffleDeck(createDeck());
    const dealt = dealFromDeck(shuffled, 5);
    setCredits((current) => current - stake);
    setDeck(dealt.deck);
    setHand(dealt.cards.map((card) => ({ card, fresh: true })));
    setHeld(openingHand.map(() => false));
    setResult(emptyResult);
    setLastWin(0);
    setPhase("deal");
    setMessage("Choose your omens.");
    playSound("deal");
  }

  function draw() {
    if (!canDraw || activeCards.length !== 5) return;
    const replaced = replaceCards(activeCards, deck, held);
    const outcome = evaluateHand(replaced.hand);
    const win = outcome.multiplier * bet;
    setDeck(replaced.deck);
    setHand(replaced.hand.map((card, index) => ({ card, fresh: replaced.drawn.includes(index) })));
    setHeld(openingHand.map(() => false));
    setResult(outcome);
    setCredits((current) => current + win);
    setLastWin(win);
    setPhase("settled");

    if (win > 0) {
      setStreak((current) => current + 1);
      setFlashWin(true);
      setMessage(`${outcome.name}. The table answers.`);
      playSound("win");
    } else {
      setStreak(0);
      setMessage("No winning omen in this spread.");
      playSound("lose");
    }
  }

  function toggleHold(index: number) {
    if (phase !== "deal") return;
    setHeld((current) => current.map((value, itemIndex) => (itemIndex === index ? !value : value)));
    setHand((current) => current.map((slot) => (slot ? { ...slot, fresh: false } : slot)));
    playSound("hold");
  }

  function changeBet(delta: number) {
    if (!canDeal) return;
    setBet((current) => Math.min(MAX_BET, Math.max(1, current + delta)));
  }

  function maxBetDeal() {
    if (!canDeal) return;
    setBet(MAX_BET);
    deal(MAX_BET);
  }

  return (
    <main className="arcade-shell">
      <section className="game-surface" aria-label="Arcana Draw video poker table">
        <div className="hud-bar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              *
            </span>
            <div>
              <p>Arcana Draw</p>
              <h1>Tarot Video Poker</h1>
            </div>
          </div>

          <div className="score-strip" aria-label="Game score">
            <div>
              <span>Credits</span>
              <strong>{credits}</strong>
            </div>
            <div>
              <span>Bet</span>
              <strong>{bet}</strong>
            </div>
            <div>
              <span>Win</span>
              <strong className={lastWin > 0 ? "win-text" : ""}>{lastWin}</strong>
            </div>
          </div>

          <button className="icon-button" type="button" onClick={() => setSound((value) => !value)} aria-label={sound ? "Mute sound" : "Enable sound"}>
            {sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        </div>

        <div className="table-layout">
          <section className="felt-panel" aria-label="Current hand">
            <div className="dealer-rail">
              <div>
                <span className="kicker">Current omen</span>
                <p>{message}</p>
              </div>
              <div className="deck-meter" aria-label={`${cardsLeft} cards remain in deck`}>
                <span>{cardsLeft}</span>
                <small>deck</small>
              </div>
            </div>

            <div className={`card-row ${flashWin ? "is-winning" : ""}`}>
              {hand.map((slot, index) => (
                <TarotCard key={slot?.card.id ?? index} slot={slot} held={held[index]} index={index} onToggle={() => toggleHold(index)} disabled={phase !== "deal"} />
              ))}
            </div>

            <div className="control-dock">
              <div className="bet-control" aria-label="Bet controls">
                <button type="button" onClick={() => changeBet(-1)} disabled={!canDeal || bet <= 1} aria-label="Decrease bet">
                  <ChevronDown size={18} />
                </button>
                <span>{bet}</span>
                <button type="button" onClick={() => changeBet(1)} disabled={!canDeal || bet >= MAX_BET} aria-label="Increase bet">
                  <ChevronUp size={18} />
                </button>
              </div>

              <button className="primary-action" type="button" onClick={() => (canDraw ? draw() : deal())} disabled={canDeal && wager <= 0}>
                {canDraw ? <Sparkles size={20} /> : <Play size={20} />}
                <span>{canDraw ? "Draw" : "Deal"}</span>
              </button>

              <button className="secondary-action" type="button" onClick={maxBetDeal} disabled={!canDeal || credits <= 0}>
                <BadgeDollarSign size={19} />
                <span>Max Bet</span>
              </button>

              <button
                className="icon-button"
                type="button"
                onClick={() => {
                  setCredits(STARTING_CREDITS);
                  setBet(5);
                  setPhase("ready");
                  setDeck(shuffleDeck(createDeck()));
                  setHand(emptySlots());
                  setHeld(openingHand.map(() => false));
                  setResult(emptyResult);
                  setLastWin(0);
                  setStreak(0);
                  setMessage("Ante in and reveal the spread.");
                }}
                aria-label="Reset game"
              >
                <RefreshCcw size={20} />
              </button>
            </div>
          </section>

          <aside className="side-panel" aria-label="Payouts and table state">
            <section className="result-panel">
              <span className="kicker">Reading</span>
              <h2>{result.name}</h2>
              <p>{result.multiplier > 0 ? `${result.multiplier}x pays ${result.multiplier * bet}` : "The next spread waits."}</p>
              <div className="streak-bar">
                <span>Streak</span>
                <strong>{streak}</strong>
              </div>
            </section>

            <section className="paytable-panel">
              <div className="panel-heading">
                <Hand size={18} />
                <h2>Paytable</h2>
              </div>
              <div className="paytable-list">
                {tableRows.map((row) => (
                  <div key={row.name} className={row.name === result.name ? "active" : ""}>
                    <span>{row.name}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="suit-panel">
              {Object.entries(tarotSuitMeta).map(([suit, meta]) => (
                <div key={suit} style={{ "--suit-color": meta.accent } as CSSProperties}>
                  <span>{meta.symbol}</span>
                  <p>{meta.title}</p>
                </div>
              ))}
            </section>
          </aside>
        </div>
      </section>

      {flashWin && <WinBurst />}
    </main>
  );
}

type TarotCardProps = {
  slot: HandSlot | null;
  held: boolean;
  index: number;
  disabled: boolean;
  onToggle: () => void;
};

function TarotCard({ slot, held, index, disabled, onToggle }: TarotCardProps) {
  if (!slot) {
    return (
      <div className="tarot-card is-empty" style={{ "--delay": `${index * 70}ms` } as CSSProperties}>
        <div className="card-back">
          <span>*</span>
        </div>
      </div>
    );
  }

  const meta = tarotSuitMeta[slot.card.suit];
  const court = slot.card.rank === "J" ? "Page" : slot.card.rank === "Q" ? "Queen" : slot.card.rank === "K" ? "King" : slot.card.rank === "A" ? "Ace" : slot.card.rank;

  return (
    <button
      className={`tarot-card ${held ? "is-held" : ""} ${slot.fresh ? "is-fresh" : ""}`}
      style={{ "--suit-color": meta.accent, "--delay": `${index * 70}ms` } as CSSProperties}
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={held}
      aria-label={`${held ? "Held" : "Available"} ${formatCard(slot.card)}`}
    >
      <span className="corner top">
        <strong>{slot.card.rank}</strong>
        <small>{meta.symbol}</small>
      </span>
      <span className="arcana-art" aria-hidden="true">
        <span className="moon" />
        <span className="glyph">{meta.symbol}</span>
        <span className="ray one" />
        <span className="ray two" />
      </span>
      <span className="card-title">{court}</span>
      <span className="suit-name">{meta.title}</span>
      <span className="corner bottom">
        <strong>{slot.card.rank}</strong>
        <small>{meta.symbol}</small>
      </span>
      {held && <span className="hold-ribbon">Held</span>}
    </button>
  );
}

function WinBurst() {
  return (
    <div className="win-burst" aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => (
        <span key={index} style={{ "--i": index } as CSSProperties} />
      ))}
    </div>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
