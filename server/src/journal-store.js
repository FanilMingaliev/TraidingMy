/**
 * Хранилище журнала сигналов.
 *
 * Если заданы SUPABASE_URL и SUPABASE_SERVICE_KEY — журнал живёт в облаке
 * (таблицы signals/outcomes проекта Supabase), иначе откатывается на локальные
 * файлы JSONL. Публичный интерфейс одинаков для обоих вариантов.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, '../../data/journal');
const SIGNALS_FILE = path.join(DATA_DIR, 'signals.jsonl');
const OUTCOMES_FILE = path.join(DATA_DIR, 'outcomes.jsonl');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

/** Ключи объекта сигнала (camelCase) ↔ колонки таблицы (snake_case). */
const SIGNAL_COLUMNS = {
  id: 'id',
  time: 'time',
  symbol: 'symbol',
  direction: 'direction',
  action: 'action',
  score: 'score',
  techScore: 'tech_score',
  confidence: 'confidence',
  source: 'source',
  riskScore: 'risk_score',
  entry: 'entry',
  stopLoss: 'stop_loss',
  targets: 'targets',
  factors: 'factors',
  regime: 'regime',
  newsSentiment: 'news_sentiment',
  newsCount: 'news_count',
  aiAction: 'ai_action',
  aiConviction: 'ai_conviction',
  marketSentiment: 'market_sentiment',
  fearGreed: 'fear_greed'
};

const OUTCOME_COLUMNS = {
  id: 'id',
  symbol: 'symbol',
  direction: 'direction',
  confidence: 'confidence',
  source: 'source',
  aiAction: 'ai_action',
  status: 'status',
  exitReason: 'exit_reason',
  hits: 'hits',
  barsHeld: 'bars_held',
  resultR: 'result_r',
  resolvedAt: 'resolved_at'
};

function toRow(obj, mapping) {
  const row = {};
  for (const [key, column] of Object.entries(mapping)) {
    if (obj[key] !== undefined) row[column] = obj[key];
  }
  return row;
}

function fromRow(row, mapping) {
  const obj = {};
  for (const [key, column] of Object.entries(mapping)) {
    if (row[column] !== undefined && row[column] !== null) obj[key] = row[column];
  }
  return obj;
}

/* ------------------------------- Supabase ------------------------------- */

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });
}

const supabaseStore = {
  kind: 'supabase',
  async appendSignal(signal) {
    const { error } = await supabase.from('signals').insert(toRow(signal, SIGNAL_COLUMNS));
    if (error) throw new Error('supabase signals insert: ' + error.message);
  },
  async appendOutcome(outcome) {
    const { error } = await supabase
      .from('outcomes')
      .upsert(toRow(outcome, OUTCOME_COLUMNS), { onConflict: 'id' });
    if (error) throw new Error('supabase outcomes upsert: ' + error.message);
  },
  async getSignals() {
    const { data, error } = await supabase.from('signals').select('*');
    if (error) throw new Error('supabase signals select: ' + error.message);
    return (data || []).map((row) => ({
      ...fromRow(row, SIGNAL_COLUMNS),
      time: row.time ? new Date(row.time).toISOString() : null
    }));
  },
  async getOutcomes() {
    const { data, error } = await supabase.from('outcomes').select('*');
    if (error) throw new Error('supabase outcomes select: ' + error.message);
    return (data || []).map((row) => ({
      ...fromRow(row, OUTCOME_COLUMNS),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null
    }));
  }
};

/* --------------------------------- Файлы -------------------------------- */

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendJsonl(file, entry) {
  ensureDir();
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

const fileStore = {
  kind: 'files',
  async appendSignal(signal) {
    appendJsonl(SIGNALS_FILE, signal);
  },
  async appendOutcome(outcome) {
    appendJsonl(OUTCOMES_FILE, outcome);
  },
  async getSignals() {
    return readJsonl(SIGNALS_FILE);
  },
  async getOutcomes() {
    return readJsonl(OUTCOMES_FILE);
  }
};

export const store = supabase ? supabaseStore : fileStore;
export const journalBackend = store.kind;
