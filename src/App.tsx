import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  BadgeDollarSign,
  ChevronDown,
  ChevronUp,
  Hand,
  Play,
  RefreshCcw,
  Settings,
  Sparkles,
  Trophy,
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
  oracleFocuses,
  payoutTable,
  progressiveContribution,
  replaceCards,
  shouldHitProgressive,
  shouldWinDouble,
  shuffleDeck,
  tarotSuitMeta,
} from "./game";

type Phase = "ready" | "deal" | "double" | "settled";
type SoundKind = "deal" | "hold" | "win" | "lose" | "double";

type HandSlot = {
  card: Card;
  fresh: boolean;
};

type DoubleOutcome = {
  focusId: string;
  won: boolean;
  stake: number;
};

const STARTING_CREDITS = 500;
const MAX_BET = 5;
const emptyResult = { name: "No Win", multiplier: 0, solverName: "", solverDescription: "" } as const;
const openingHand = Array.from({ length: 5 }, (_, index) => index);

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
    setMessage("Choose your omens.");
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
      setMessage(hitProgressive ? `${outcome.name} opened the progressive: ${jackpotAward}.` : `${outcome.name}. Collect or ask the oracle to double.`);
      playSound("win");
    } else {
      setPendingWin(0);
      setDoubleOutcome(null);
      setStreak(0);
      setPhase("settled");
      setMessage("No winning omen in this spread.");
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

  function doubleUp(focusId: string) {
    if (!canDouble) return;
    const stake = pendingWin;
    const won = shouldWinDouble(settings);
    setDoubleOutcome({ focusId, won, stake });

    if (won) {
      const doubled = stake * 2;
      const nextRound = doubleRounds + 1;
      setPendingWin(doubled);
      setLastWin(doubled);
      setDoubleRounds(nextRound);
      setFlashWin(true);
      setMessage(nextRound >= settings.maxDoubleRounds ? `The oracle doubled you to ${doubled}. Max double reached.` : `The oracle doubled you to ${doubled}.`);
      playSound("double");
    } else {
      setPendingWin(0);
      setLastWin(0);
      setStreak(0);
      setPhase("settled");
      setMessage("The oracle kept the stake.");
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
    <main className="arcade-shell">
      <section className="game-surface" aria-label="Arcana Draw video poker table">
        <div className="hud-bar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              A
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
              <span>{pendingWin > 0 ? "Pending" : "Win"}</span>
              <strong className={lastWin > 0 ? "win-text" : ""}>{pendingWin || lastWin}</strong>
            </div>
            <div className="progressive-chip">
              <span>Progressive</span>
              <strong>{progressive}</strong>
            </div>
          </div>

          <div className="hud-actions">
            <button className="icon-button" type="button" onClick={() => setAdminOpen((value) => !value)} aria-label={adminOpen ? "Close admin panel" : "Open admin panel"}>
              <Settings size={20} />
            </button>
            <button className="icon-button" type="button" onClick={() => setSound((value) => !value)} aria-label={sound ? "Mute sound" : "Enable sound"}>
              {sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
          </div>
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

            {(phase === "double" || doubleOutcome) && (
              <DoubleUpPanel pendingWin={pendingWin} doubleRounds={doubleRounds} settings={settings} outcome={doubleOutcome} canDouble={canDouble} onPick={doubleUp} onCollect={collectWin} />
            )}

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

              <button className="primary-action" type="button" onClick={() => (phase === "double" ? collectWin() : canDraw ? draw() : deal())} disabled={phase === "double" ? pendingWin <= 0 : canDeal && wager <= 0}>
                {phase === "double" ? <Trophy size={20} /> : canDraw ? <Sparkles size={20} /> : <Play size={20} />}
                <span>{phase === "double" ? "Collect" : canDraw ? "Draw" : "Deal"}</span>
              </button>

              <button className="secondary-action" type="button" onClick={maxBetDeal} disabled={!canDeal || credits <= 0}>
                <BadgeDollarSign size={19} />
                <span>Max Bet</span>
              </button>

              <button className="icon-button" type="button" onClick={resetGame} aria-label="Reset game">
                <RefreshCcw size={20} />
              </button>
            </div>
          </section>

          <aside className="side-panel" aria-label="Payouts and table state">
            <section className="result-panel">
              <span className="kicker">Reading</span>
              <h2>{result.name}</h2>
              <p>{pendingWin > 0 ? `Pending win: ${pendingWin}` : result.multiplier > 0 ? `${result.multiplier}x pays ${result.multiplier * bet}` : "The next spread waits."}</p>
              <div className="streak-bar">
                <span>Streak</span>
                <strong>{streak}</strong>
              </div>
            </section>

            <section className={`progressive-panel ${progressiveHit ? "is-hit" : ""}`}>
              <span className="kicker">Jacks or Better</span>
              <h2>{progressive}</h2>
              <div className="progressive-grid">
                <span>Hit</span>
                <strong>{settings.progressiveHitRate}%</strong>
                <span>Next ante</span>
                <strong>{nextContribution}</strong>
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
                    <strong>{row.name === "Jacks or Better" ? `${row.value}+` : row.value}</strong>
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

            {adminOpen && <AdminPanel settings={settings} onChange={updateSetting} onResetJackpot={() => setProgressive(settings.progressiveSeed)} />}
          </aside>
        </div>
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
  onPick: (focusId: string) => void;
  onCollect: () => void;
};

function DoubleUpPanel({ pendingWin, doubleRounds, settings, outcome, canDouble, onPick, onCollect }: DoubleUpPanelProps) {
  const selectedFocus = outcome ? oracleFocuses.find((focus) => focus.id === outcome.focusId) : undefined;

  return (
    <section className={`double-panel ${outcome?.won ? "is-blessed" : outcome ? "is-lost" : ""}`} aria-label="Double up mini game">
      <div className="double-center">
        <span className="kicker">Double Up</span>
        <h2>{pendingWin > 0 ? pendingWin : outcome?.stake ?? 0}</h2>
        <p>{outcome ? `${selectedFocus?.title ?? "Oracle"} ${outcome.won ? "doubled the win" : "closed the path"}.` : `Round ${doubleRounds + 1} of ${settings.maxDoubleRounds}`}</p>
      </div>

      <div className="focus-wheel">
        {oracleFocuses.map((focus) => (
          <button
            key={focus.id}
            className={outcome?.focusId === focus.id ? "selected" : ""}
            style={{ "--focus-color": focus.accent } as CSSProperties}
            type="button"
            onClick={() => onPick(focus.id)}
            disabled={!canDouble}
            aria-label={`Double up with ${focus.title}`}
          >
            <span>{focus.symbol}</span>
            <strong>{focus.title}</strong>
          </button>
        ))}
      </div>

      <div className="double-actions">
        <button className="secondary-action" type="button" onClick={onCollect} disabled={pendingWin <= 0}>
          <BadgeDollarSign size={18} />
          <span>Collect</span>
        </button>
        <small>{settings.doubleWinRate}% double odds</small>
      </div>
    </section>
  );
}

type AdminPanelProps = {
  settings: AdminSettings;
  onChange: (key: keyof AdminSettings, value: number) => void;
  onResetJackpot: () => void;
};

function AdminPanel({ settings, onChange, onResetJackpot }: AdminPanelProps) {
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
      <button className="secondary-action admin-reset" type="button" onClick={onResetJackpot}>
        <RefreshCcw size={17} />
        <span>Reset Jackpot</span>
      </button>
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
          <span>A</span>
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
