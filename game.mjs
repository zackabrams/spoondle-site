import { labelFor, answerDigest, tileOffset, openText } from './seal.mjs';
const cardFor = (puzzle, id) => puzzle.cards.find(c => c.id === id);
export function swapIndex(puzzle, id) {
  const card = cardFor(puzzle, id), length = card.word.length;
  return (card.mark - tileOffset(puzzle.key, id, length) + length) % length;
}
export const tileStatus = (puzzle, id, index) => index === swapIndex(puzzle, id) ? 'swap' : 'stay';
export function createState(puzzle) {
  const columnById = Object.fromEntries(puzzle.cards.map(c => [c.id, c.column]));
  return {
    solved: [], revealed: 0, misses: 0, hints: 0, guesses: [], feedback: {}, columnById,
    columns: [0, 1].map(column => puzzle.cards.filter(c => c.column === column).map(c => c.id))
  };
}
// Each solved entry is the pair of card ids in the order its answer reads; the last `revealed` of them
// were shown after giving up.
export function usedIds(puzzle, state) {
  return new Set(state.solved.flat());
}
export function availableColumn(puzzle, state, column) {
  const used = usedIds(puzzle, state);
  return state.columns[column].filter(id => !used.has(id));
}
export function swapWords(puzzle, ids, positions) {
  if (!Array.isArray(ids) || ids.length !== 2 || ids[0] === ids[1]) throw new Error('Choose two different words.');
  const cards = ids.map(id => cardFor(puzzle, id));
  if (cards.some(c => !c)) throw new Error('Unknown word card.');
  if (!Array.isArray(positions) || positions.length !== 2 || positions.some((p, i) => !Number.isInteger(p) || p < 0 || p >= cards[i].word.length)) throw new Error('Choose one letter in each word.');
  const words = cards.map(c => c.word.split(''));
  const [a, b] = positions;
  [words[0][a], words[1][b]] = [words[1][b], words[0][a]];
  return words.map(w => w.join(''));
}
// Tries both reading orders of the traded words against the answer fingerprints.
function matchAnswer(puzzle, ids, words) {
  for (const order of [[0, 1], [1, 0]]) {
    const ordered = order.map(i => ids[i]), label = labelFor(puzzle.category, order.map(i => words[i]));
    const answer = puzzle.answers.find(a => a.digest === answerDigest(puzzle.key, ordered, label));
    if (answer) return { ids: ordered, label, clue: openText(label, answer.clue) };
  }
  return null;
}
// The answer a trade makes, or null. Counts nothing, so the page can accept a right trade as soon as it's picked.
export const tradeAnswer = (puzzle, ids, positions) => matchAnswer(puzzle, ids, swapWords(puzzle, ids, positions));
// The answer a solved pair makes, or null when the two cards are not partners.
export function solvedAnswer(puzzle, ids) {
  return matchAnswer(puzzle, ids, swapWords(puzzle, ids, ids.map(id => swapIndex(puzzle, id))));
}
// Identifies a trade regardless of which word was picked first.
export const guessKey = (ids, positions) => ids.map((id, i) => id + ':' + positions[i]).sort().join('|');
export function checkSwap(puzzle, state, ids, positions) {
  const words = swapWords(puzzle, ids, positions);
  if (state.columnById[ids[0]] === state.columnById[ids[1]]) throw new Error('Choose one word from each column.');
  const used = usedIds(puzzle, state);
  if (ids.some(id => used.has(id))) throw new Error('That word has already been solved.');
  if (words.every((w, i) => w === cardFor(puzzle, ids[i]).word)) return { correct: false, unchanged: true, words };
  const answer = matchAnswer(puzzle, ids, words);
  if (answer) {
    state.solved.push(answer.ids);
    return { correct: true, index: state.solved.length - 1, words, label: answer.label, clue: answer.clue };
  }
  const key = guessKey(ids, positions);
  const repeated = state.guesses.includes(key);
  if (!repeated) { state.guesses.push(key); state.misses++; }
  // Feedback belongs to a particular ORIGINAL tile, not every copy of its letter.
  const feedback = ids.map((id, i) => {
    const status = tileStatus(puzzle, id, positions[i]);
    state.feedback[id] ??= {};
    state.feedback[id][positions[i]] = status;
    return { id, index: positions[i], status };
  });
  return { correct: false, repeated, words, feedback };
}
// A hint shows the letter to swap on one unsolved card whose swap tile isn't showing yet.
export function hintTargets(puzzle, state) {
  const used = usedIds(puzzle, state);
  return puzzle.cards.filter(c => !used.has(c.id)).map(c => ({ id: c.id, index: swapIndex(puzzle, c.id) })).filter(t => !state.feedback[t.id]?.[t.index]);
}
// The card in the other column that a card makes its answer with.
export function partnerOf(puzzle, id) {
  const column = cardFor(puzzle, id).column;
  return puzzle.cards.find(c => c.column !== column && solvedAnswer(puzzle, [id, c.id]))?.id ?? null;
}
// Hints spread out rather than handing over an answer: first a word in the column with fewer lit words,
// then any word, and a lit word's partner only once nothing else is left. (A Reveal's amber tile counts as lit.)
export function revealHint(puzzle, state, random = Math.random) {
  const candidates = hintTargets(puzzle, state);
  if (!candidates.length) return null;
  const used = usedIds(puzzle, state);
  const lit = puzzle.cards.filter(c => !used.has(c.id) && state.feedback[c.id]?.[swapIndex(puzzle, c.id)] === 'swap').map(c => c.id);
  const partners = new Set(lit.map(id => partnerOf(puzzle, id)));
  const [left, right] = [0, 1].map(column => lit.filter(id => state.columnById[id] === column).length);
  const fewer = left === right ? null : left < right ? 0 : 1;
  const apart = candidates.filter(t => !partners.has(t.id));
  const pool = [apart.filter(t => state.columnById[t.id] === fewer), apart, candidates].find(p => p.length);
  const chosen = { ...pool[Math.floor(random() * pool.length)], status: 'swap' };
  state.feedback[chosen.id] ??= {};
  state.feedback[chosen.id][chosen.index] = chosen.status;
  state.hints++;
  return chosen;
}
// Solves the rest of the board for a player who gives up, returning how many answers it revealed.
export function revealAnswers(puzzle, state) {
  const before = state.solved.length, [left, right] = [0, 1].map(column => availableColumn(puzzle, state, column));
  for (const a of left) {
    const partner = right.find(b => !usedIds(puzzle, state).has(b) && solvedAnswer(puzzle, [a, b]));
    if (partner) state.solved.push(solvedAnswer(puzzle, [a, partner]).ids);
  }
  state.revealed = state.solved.length - before;
  return state.revealed;
}
