import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  CircleDollarSign,
  Crown,
  Globe2,
  Heart,
  Menu,
  Minus,
  Play,
  Plus,
  RefreshCcw,
  Settings,
  Spade,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  AdminSettings,
  Card,
  PayoutResult,
  createDeck,
  dealFromDeck,
  defaultAdminSettings,
  evaluateHand,
  formatCard,
  payoutTable,
  progressiveContribution,
  replaceCards,
  shouldHitProgressive,
  shouldWinDouble,
  shuffleDeck,
} from "./game";

type Phase = "ready" | "deal" | "double" | "settled";
type SoundKind = "deal" | "hold" | "win" | "lose" | "double";
type BonusChoice = "red" | "black";

type HandSlot = {
  card: Card;
  fresh: boolean;
};

type DoubleOutcome = {
  choice: BonusChoice;
  revealed: BonusChoice;
  won: boolean;
  stake: number;
};

const STARTING_CREDITS = 500;
const MAX_BET = 5;
const emptyResult = { name: "No Win", multiplier: 0, solverName: "", solverDescription: "" } as const;
const openingHand = Array.from({ length: 5 }, (_, index) => index);
const coinColumns = [1, 2, 3, 4, 5];

const bonusChoiceMeta: Record<BonusChoice, { label: string; image: string }> = {
  red: { label: "Red", image: "/bonus-red-card.jpg" },
  black: { label: "Black", image: "/bonus-black-card.jpg" },
};

const standardSuitMeta: Record<Card["suit"], { label: string; symbol: string; color: BonusChoice }> = {
  cups: { label: "Hearts", symbol: "♥", color: "red" },
  coins: { label: "Diamonds", symbol: "♦", color: "red" },
  wands: { label: "Clubs", symbol: "♣", color: "black" },
  swords: { label: "Spades", symbol: "♠", color: "black" },
};

const settingLimits: Record<keyof AdminSettings, { min: number; max: number; step: number; suffix: string }> = {
  doubleWinRate: { min: 1, max: 99, step: 1, suffix: "%" },
  progressiveHitRate: { min: 0, max: 100, step: 1, suffix: "%" },
  progressiveSeed: { min: 100, max: 100000, step: 100, suffix: "" },
  progressiveContributionRate: { min: 0, max: 100, step: 1, suffix: "%" },
  maxDoubleRounds: { min: 1, max: 10, step: 1, suffix: "" },
};

function useSound(enabled: boolean) {
  const audio = useRef<AudioContext | null>(null);

  return (kind: SoundKind) => {
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
      double: [294, 660],
    }[kind];

    oscillator.type = kind === "win" || kind === "double" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(tones[0], ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(tones[1], ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(kind === "win" || kind === "double" ? 0.12 : 0.05, ctx.currentTime + 0.02);
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

function clamp(value: number, key: keyof AdminSettings) {
  const limit = settingLimits[key];
  return Math.min(limit.max, Math.max(limit.min, value));
}

function money(value: number) {
  return value.toFixed(2);
}

function oppositeChoice(choice: BonusChoice): BonusChoice {
  return choice === "red" ? "black" : "red";
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
  const [pendingWin, setPendingWin] = useState(0);
  const [doubleRounds, setDoubleRounds] = useState(0);
  const [doubleOutcome, setDoubleOutcome] = useState<DoubleOutcome | null>(null);
  const [progressive, setProgressive] = useState(defaultAdminSettings.progressiveSeed);
  const [progressiveHit, setProgressiveHit] = useState(false);
  const [streak, setStreak] = useState(0);
  const [sound, setSound] = useState(true);
  const [flashWin, setFlashWin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [settings, setSettings] = useState<AdminSettings>(defaultAdminSettings);
  const playSound = useSound(sound);

  const canDeal = phase === "ready" || phase === "settled";
  const canDraw = phase === "deal";
  const canDouble = phase === "double" && pendingWin > 0 && doubleRounds < settings.maxDoubleRounds;
  const wager = Math.min(bet, credits);
  const activeCards = hand.filter((slot): slot is HandSlot => slot !== null).map((slot) => slot.card);
  const cardsLeft = deck.length;
  const nextContribution = progressiveContribution(Math.max(1, wager || bet), settings);
  const visibleDouble = phase === "double" || doubleOutcome !== null;
  const displayWin = pendingWin || lastWin;

  const tableRows = useMemo(
    () =>
      payoutTable.map((entry) => ({
        ...entry,
        values: coinColumns.map((coins) => entry.multiplier * coins),
      })),
    [],
  );

  useEffect(() => {
    if (!flashWin) return;
    const timer = window.setTimeout(() => setFlashWin(false), 1200);
    return () => window.clearTimeout(timer);
  }, [flashWin]);

  function clearRoundState() {
    setHeld(openingHand.map(() => false));
    setPendingWin(0);
    setDoubleRounds(0);
    setDoubleOutcome(null);
    setProgressiveHit(false);
  }

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
    setProgressive((current) => current + progressiveContribution(stake, settings));
    setDeck(dealt.deck);
    setHand(dealt.cards.map((card) => ({ card, fresh: true })));
    setResult(emptyResult);
    setLastWin(0);
    clearRoundState();
    setPhase("deal");
    setMessage("Choose your holds.");
    playSound("deal");
  }

  function draw() {
    if (!canDraw || activeCards.length !== 5) return;
    const replaced = replaceCards(activeCards, deck, held);
    const outcome = evaluateHand(replaced.hand);
    const baseWin = outcome.multiplier * bet;
    const hitProgressive = baseWin > 0 && shouldHitProgressive(outcome, settings);
    const jackpotAward = hitProgressive ? progressive : 0;
    const win = baseWin + jackpotAward;

    setDeck(replaced.deck);
    setHand(replaced.hand.map((card, index) => ({ card, fresh: replaced.drawn.includes(index) })));
    setHeld(openingHand.map(() => false));
    setResult(outcome);
    setLastWin(win);
    setProgressiveHit(hitProgressive);
    if (hitProgressive) {
      setProgressive(settings.progressiveSeed);
    }

    if (win > 0) {
      setStreak((current) => current + 1);
      setPendingWin(win);
      setDoubleRounds(0);
      setDoubleOutcome(null);
      setFlashWin(true);
      setPhase("double");
      setMessage(hitProgressive ? `${outcome.name} opened the progressive: ${jackpotAward}.` : `${outcome.name}.`);
      playSound("win");
    } else {
      setPendingWin(0);
      setDoubleOutcome(null);
      setStreak(0);
      setPhase("settled");
      setMessage("No winning hand.");
      playSound("lose");
    }
  }

  function collectWin() {
    if (pendingWin <= 0) {
      setPhase("settled");
      setDoubleOutcome(null);
      return;
    }

    setCredits((current) => current + pendingWin);
    setLastWin(pendingWin);
    setMessage(`Collected ${pendingWin} credits.`);
    setPendingWin(0);
    setDoubleRounds(0);
    setDoubleOutcome(null);
    setPhase("settled");
    playSound("hold");
  }

  function doubleUp(choice: BonusChoice) {
    if (!canDouble) return;
    const stake = pendingWin;
    const won = shouldWinDouble(settings);
    const revealed = won ? choice : oppositeChoice(choice);
    setDoubleOutcome({ choice, revealed, won, stake });

    if (won) {
      const doubled = stake * 2;
      const nextRound = doubleRounds + 1;
      setPendingWin(doubled);
      setLastWin(doubled);
      setDoubleRounds(nextRound);
      setFlashWin(true);
      setMessage(nextRound >= settings.maxDoubleRounds ? `Double win: ${doubled}. Max double reached.` : `Double win: ${doubled}.`);
      playSound("double");
    } else {
      setPendingWin(0);
      setLastWin(0);
      setStreak(0);
      setPhase("settled");
      setMessage("Double lost.");
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

  function resetGame() {
    setCredits(STARTING_CREDITS);
    setBet(5);
    setPhase("ready");
    setDeck(shuffleDeck(createDeck()));
    setHand(emptySlots());
    setResult(emptyResult);
    setLastWin(0);
    setProgressive(settings.progressiveSeed);
    setStreak(0);
    clearRoundState();
    setMessage("Ante in and reveal the spread.");
  }

  function updateSetting(key: keyof AdminSettings, value: number) {
    const nextValue = clamp(value, key);
    setSettings((current) => ({ ...current, [key]: nextValue }));
    if (key === "progressiveSeed" && progressive < nextValue) {
      setProgressive(nextValue);
    }
  }

  return (
    <main className={`arcade-shell ${visibleDouble ? "is-double-mode" : ""}`}>
      <section className="game-phone" aria-label="HNIRT tarot video poker">
        <div className="top-bar">
          <button className="round-icon" type="button" onClick={() => setAdminOpen((value) => !value)} aria-label={adminOpen ? "Close admin panel" : "Open admin panel"}>
            <Menu size={23} />
          </button>
          <div className="vip-pill">
            <Crown size={22} aria-hidden="true" />
            <strong>VIP 3</strong>
          </div>
          <div className="wallet-pill">
            <CircleDollarSign size={23} aria-hidden="true" />
            <strong>{money(credits)}</strong>
            <button type="button" onClick={resetGame} aria-label="Reset game credits">
              <Plus size={22} />
            </button>
          </div>
          <div className="language-pill">
            <Globe2 size={19} aria-hidden="true" />
            <span>English</span>
          </div>
        </div>

        <header className="brand-stage">
          <Spade className="brand-spade" size={50} fill="currentColor" aria-hidden="true" />
          <h1>HNIRT</h1>
          <p>Entertainment</p>
          <span>Play Together • Win Together</span>
        </header>

        {adminOpen && (
          <AdminPanel
            settings={settings}
            sound={sound}
            onChange={updateSetting}
            onResetJackpot={() => setProgressive(settings.progressiveSeed)}
            onResetGame={resetGame}
            onToggleSound={() => setSound((value) => !value)}
          />
        )}

        {visibleDouble ? (
          <DoubleUpPanel
            pendingWin={pendingWin}
            doubleRounds={doubleRounds}
            settings={settings}
            outcome={doubleOutcome}
            canDouble={canDouble}
            credits={credits}
            bet={bet}
            lastWin={lastWin}
            onPick={doubleUp}
            onCollect={collectWin}
            onDeal={() => deal()}
          />
        ) : (
          <>
            <section className="paytable-stage" aria-label="Payouts">
              <div className="paytable-host" aria-hidden="true" />
              <div className="paytable-frame">
                <div className="paytable-grid" style={{ "--active-bet": bet } as CSSProperties}>
                  <span className="pay-head pay-name">Payouts</span>
                  {coinColumns.map((coin) => (
                    <span key={coin} className={`pay-head pay-coin ${coin === bet ? "is-active" : ""}`}>
                      {coin} Coin
                    </span>
                  ))}
                  {tableRows.map((row) => (
                    <div key={row.name} className={`pay-row ${row.name === result.name ? "is-result" : ""}`}>
                      <span>{row.name}</span>
                      {row.values.map((value, index) => (
                        <strong key={coinColumns[index]} className={coinColumns[index] === bet ? "is-active" : ""}>
                          {value}
                        </strong>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className={`progressive-ribbon ${progressiveHit ? "is-hit" : ""}`}>
              <span>Jacks or Better Progressive</span>
              <strong>{money(progressive)}</strong>
              <small>+{nextContribution} next ante</small>
            </div>

            <section className="hand-table" aria-label="Current hand">
              <div className="hold-row">
                {openingHand.map((index) => (
                  <button key={index} type="button" onClick={() => toggleHold(index)} disabled={phase !== "deal"} className={held[index] ? "is-held" : ""}>
                    Hold
                  </button>
                ))}
              </div>

              <div className={`card-row ${flashWin ? "is-winning" : ""}`}>
                {hand.map((slot, index) => (
                  <PlayingCard key={slot?.card.id ?? index} slot={slot} held={held[index]} index={index} onToggle={() => toggleHold(index)} disabled={phase !== "deal"} />
                ))}
              </div>
            </section>

            <section className="score-panel" aria-label="Game score">
              <div>
                <span>Credits</span>
                <strong>{money(credits)}</strong>
              </div>
              <div>
                <span>Bet</span>
                <div className="bet-stepper">
                  <button type="button" onClick={() => changeBet(-1)} disabled={!canDeal || bet <= 1} aria-label="Decrease bet">
                    <Minus size={18} />
                  </button>
                  <strong>{bet}</strong>
                  <button type="button" onClick={() => changeBet(1)} disabled={!canDeal || bet >= MAX_BET} aria-label="Increase bet">
                    <Plus size={18} />
                  </button>
                </div>
              </div>
              <div>
                <span>Win</span>
                <strong className={displayWin > 0 ? "win-text" : ""}>{money(displayWin)}</strong>
              </div>
            </section>

            <section className="action-row" aria-label="Game actions">
              <button type="button" className="flat-action" onClick={() => setBet(1)} disabled={!canDeal}>
                Bet 1
              </button>
              <button type="button" className="flat-action" onClick={maxBetDeal} disabled={!canDeal || credits <= 0}>
                Bet Max
              </button>
              <button className="deal-action" type="button" onClick={() => (canDraw ? draw() : deal())} disabled={canDeal && wager <= 0}>
                <Play size={22} fill="currentColor" aria-hidden="true" />
                <span>{canDraw ? "Draw" : "Deal"}</span>
              </button>
            </section>

            <footer className="table-footer">
              <span>{message}</span>
              <strong>{result.name}</strong>
              <small>{streak} streak / {cardsLeft} cards</small>
            </footer>
          </>
        )}
      </section>

      {flashWin && <WinBurst />}
    </main>
  );
}

type DoubleUpPanelProps = {
  pendingWin: number;
  doubleRounds: number;
  settings: AdminSettings;
  outcome: DoubleOutcome | null;
  canDouble: boolean;
  credits: number;
  bet: number;
  lastWin: number;
  onPick: (choice: BonusChoice) => void;
  onCollect: () => void;
  onDeal: () => void;
};

function DoubleUpPanel({ pendingWin, doubleRounds, settings, outcome, canDouble, credits, bet, lastWin, onPick, onCollect, onDeal }: DoubleUpPanelProps) {
  const currentValue = pendingWin || outcome?.stake || lastWin;
  const revealedMeta = outcome ? bonusChoiceMeta[outcome.revealed] : null;
  const status = outcome ? (outcome.won ? `Winner: ${bonusChoiceMeta[outcome.choice].label}` : `Dealer drew ${bonusChoiceMeta[outcome.revealed].label}`) : `Round ${doubleRounds + 1} of ${settings.maxDoubleRounds}`;

  return (
    <section className={`double-stage ${outcome?.won ? "is-win" : outcome ? "is-loss" : ""}`} aria-label="Double up bonus game">
      <div className="double-host" aria-hidden="true" />

      <div className="double-cabinet">
        <h2>Double Up?</h2>
        <div className="current-win">
          <span>Current Win</span>
          <strong>{money(currentValue)}</strong>
          <small>{status}</small>
        </div>

        <div className="bonus-card-slot" aria-live="polite">
          {revealedMeta ? (
            <img src={revealedMeta.image} alt={`${revealedMeta.label} bonus card`} />
          ) : (
            <div className="bonus-card-back" aria-label="Hidden bonus card">
              <Spade size={62} fill="currentColor" aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="double-picks">
          <button className="red-pick" type="button" onClick={() => onPick("red")} disabled={!canDouble} aria-label="Pick red">
            <Heart size={31} aria-hidden="true" />
            <span>Red</span>
          </button>
          <button className="black-pick" type="button" onClick={() => onPick("black")} disabled={!canDouble} aria-label="Pick black">
            <Spade size={31} aria-hidden="true" />
            <span>Black</span>
          </button>
        </div>

        <button className="collect-action" type="button" onClick={pendingWin > 0 ? onCollect : onDeal}>
          {pendingWin > 0 ? "Collect" : "Deal Again"}
        </button>

        <div className="double-score" aria-label="Double game score">
          <div>
            <span>Credits</span>
            <strong>{money(credits)}</strong>
          </div>
          <div>
            <span>Bet</span>
            <strong>{bet}</strong>
          </div>
          <div>
            <span>Win</span>
            <strong>{money(pendingWin || lastWin)}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

type AdminPanelProps = {
  settings: AdminSettings;
  sound: boolean;
  onChange: (key: keyof AdminSettings, value: number) => void;
  onResetJackpot: () => void;
  onResetGame: () => void;
  onToggleSound: () => void;
};

function AdminPanel({ settings, sound, onChange, onResetJackpot, onResetGame, onToggleSound }: AdminPanelProps) {
  return (
    <section className="admin-panel" aria-label="Admin odds panel">
      <div className="panel-heading">
        <Settings size={18} />
        <h2>Admin</h2>
      </div>
      <AdminControl label="Double odds" settingKey="doubleWinRate" value={settings.doubleWinRate} onChange={onChange} />
      <AdminControl label="Progressive odds" settingKey="progressiveHitRate" value={settings.progressiveHitRate} onChange={onChange} />
      <AdminControl label="Jackpot seed" settingKey="progressiveSeed" value={settings.progressiveSeed} onChange={onChange} />
      <AdminControl label="Ante to jackpot" settingKey="progressiveContributionRate" value={settings.progressiveContributionRate} onChange={onChange} />
      <AdminControl label="Max doubles" settingKey="maxDoubleRounds" value={settings.maxDoubleRounds} onChange={onChange} />
      <div className="admin-actions">
        <button type="button" onClick={onToggleSound}>
          {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          <span>{sound ? "Sound On" : "Sound Off"}</span>
        </button>
        <button type="button" onClick={onResetJackpot}>
          <RefreshCcw size={17} />
          <span>Jackpot</span>
        </button>
        <button type="button" onClick={onResetGame}>
          <Plus size={17} />
          <span>Reset</span>
        </button>
      </div>
    </section>
  );
}

type AdminControlProps = {
  label: string;
  settingKey: keyof AdminSettings;
  value: number;
  onChange: (key: keyof AdminSettings, value: number) => void;
};

function AdminControl({ label, settingKey, value, onChange }: AdminControlProps) {
  const limit = settingLimits[settingKey];

  return (
    <label className="admin-control">
      <span>{label}</span>
      <div>
        <input
          type="range"
          aria-label={`${label} slider`}
          min={limit.min}
          max={limit.max}
          step={limit.step}
          value={value}
          onChange={(event) => onChange(settingKey, Number(event.currentTarget.value))}
        />
        <input
          type="number"
          aria-label={`${label} value`}
          min={limit.min}
          max={limit.max}
          step={limit.step}
          value={value}
          onChange={(event) => onChange(settingKey, Number(event.currentTarget.value))}
        />
        <small>{limit.suffix}</small>
      </div>
    </label>
  );
}

type PlayingCardProps = {
  slot: HandSlot | null;
  held: boolean;
  index: number;
  disabled: boolean;
  onToggle: () => void;
};

function PlayingCard({ slot, held, index, disabled, onToggle }: PlayingCardProps) {
  if (!slot) {
    return (
      <div className="playing-card is-empty" style={{ "--delay": `${index * 70}ms` } as CSSProperties}>
        <div className="card-back">
          <Spade size={34} fill="currentColor" aria-hidden="true" />
        </div>
      </div>
    );
  }

  const meta = standardSuitMeta[slot.card.suit];

  return (
    <button
      className={`playing-card ${meta.color === "red" ? "is-red" : "is-black"} ${held ? "is-held" : ""} ${slot.fresh ? "is-fresh" : ""}`}
      style={{ "--delay": `${index * 70}ms` } as CSSProperties}
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={held}
      aria-label={`${held ? "Held" : "Available"} ${formatCard(slot.card)}`}
    >
      <span className="card-corner top">
        <strong>{slot.card.rank}</strong>
        <small>{meta.symbol}</small>
      </span>
      <span className="pip-art" aria-hidden="true">
        {meta.symbol}
      </span>
      <span className="suit-label">{meta.label}</span>
      <span className="card-corner bottom">
        <strong>{slot.card.rank}</strong>
        <small>{meta.symbol}</small>
      </span>
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
