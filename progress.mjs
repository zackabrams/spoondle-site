import { createState, solvedAnswer, tileStatus, revealAnswers } from './game.mjs';
export const STORAGE_KEY = 'spoondle-progress-v1';
export function puzzleKey(puzzle) {
  const text = JSON.stringify([puzzle.cards.map(c => [c.id,c.word]).sort(),puzzle.answers.map(a => a.digest)]);
  let hash = 2166136261;
  for (const c of text) { hash ^= c.charCodeAt(0); hash = Math.imul(hash,16777619); }
  return 'sp-' + (hash >>> 0).toString(36);
}
// A record's clock runs from startedAt, minus awayMs spent off screen; pausedAt is set while it's paused.
export function freshRecord(puzzle) { return { state:createState(puzzle), startedAt:null, finishedAt:null, pausedAt:null, awayMs:0 }; }
export function restoreRecord(puzzle, saved) {
  const fresh = freshRecord(puzzle);
  if (!saved || !Number.isFinite(saved.startedAt) || saved.startedAt <= 0) return fresh;
  try {
    const s = saved.state, base = fresh.state, ids = puzzle.cards.map(c=>c.id);
    if (!Array.isArray(s.solved) || s.solved.length>puzzle.answers.length || new Set(s.solved.flat()).size!==s.solved.length*2) return fresh;
    const solved = s.solved.map(pair => Array.isArray(pair) && solvedAnswer(puzzle,pair)?.ids);
    if (solved.some(ids=>!ids)) return fresh;
    if (![s.misses,s.hints].every(n=>Number.isInteger(n)&&n>=0) || !Array.isArray(s.guesses) || s.guesses.some(x=>typeof x!=='string')) return fresh;
    if (s.columns.length!==2 || s.columns.flat().length!==ids.length || new Set(s.columns.flat()).size!==ids.length || s.columns.some((col,i)=>col.some(id=>base.columnById[id]!==i))) return fresh;
    if (s.solved.length===puzzle.answers.length && (!Number.isFinite(saved.finishedAt)||saved.finishedAt<saved.startedAt)) return fresh;
    const feedback = {};
    for (const [id, values] of Object.entries(s.feedback || {})) {
      const card=puzzle.cards.find(c=>c.id===id); if(!card) return fresh;
      feedback[id]={};
      for(const index of Object.keys(values)) {
        if(!/^\d+$/.test(index)||Number(index)>=card.word.length)return fresh;
        feedback[id][index]=tileStatus(puzzle,id,Number(index));
      }
    }
    const revealed = s.revealed ?? 0;
    if (!Number.isInteger(revealed) || revealed<0 || revealed>solved.length) return fresh;
    const awayMs = saved.awayMs ?? 0, pausedAt = saved.pausedAt ?? null, finished = s.solved.length===puzzle.answers.length;
    if (!Number.isFinite(awayMs) || awayMs<0 || (pausedAt!==null && !(Number.isFinite(pausedAt) && pausedAt>=saved.startedAt))) return fresh;
    return { state:{...base,solved,revealed,misses:s.misses,hints:s.hints,guesses:[...s.guesses],columns:s.columns.map(c=>[...c]),feedback}, startedAt:saved.startedAt, finishedAt:finished?saved.finishedAt:null, pausedAt:finished?null:pausedAt, awayMs };
  } catch { return fresh; }
}
export function readProgress(storage) {
  const raw=storage.getItem(STORAGE_KEY);
  if(!raw)return {records:{},completionDays:[],current:null};
  try { const data=JSON.parse(raw); return {records:data.records && typeof data.records==='object'?data.records:{},completionDays:Array.isArray(data.completionDays)?data.completionDays.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)):[],current:typeof data.current==='string'?data.current:null}; }
  catch { return {records:{},completionDays:[],current:null}; }
}
export function elapsedMs(record, now=Date.now()) { return record.startedAt===null?0:Math.max(0,(record.finishedAt??record.pausedAt??now)-record.startedAt-(record.awayMs??0)); }
// The clock only runs while its puzzle is on screen: pause when the player leaves it, resume on return.
export function pauseRecord(record, now=Date.now()) {
  if(record.startedAt===null||record.finishedAt!==null||record.pausedAt!=null)return false;
  record.pausedAt=Math.max(record.startedAt,now);return true;
}
export function resumeRecord(record, now=Date.now()) {
  if(record.pausedAt==null||record.finishedAt!==null)return false;
  record.awayMs=(record.awayMs??0)+Math.max(0,now-record.pausedAt);record.pausedAt=null;return true;
}
export function formatTime(ms) {
  const sec=Math.floor(ms/1000), h=Math.floor(sec/3600), m=Math.floor(sec/60)%60,s=sec%60;
  return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}
export function localDay(now=Date.now()) { const d=new Date(now);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function finishRecord(puzzle, record, days, now=Date.now()) {
  if(record.startedAt===null||record.finishedAt!==null||record.state.solved.length!==puzzle.answers.length)return false;
  resumeRecord(record,now);record.finishedAt=Math.max(record.startedAt,now);const day=localDay(now);if(!days.includes(day))days.push(day);return true;
}
// Giving up reveals the rest of the board and stops the clock, but doesn't count toward the streak.
export function giveUpRecord(puzzle, record, now=Date.now()) {
  if(record.startedAt===null||record.finishedAt!==null||record.state.solved.length===puzzle.answers.length)return false;
  resumeRecord(record,now);revealAnswers(puzzle,record.state);
  if(record.state.solved.length!==puzzle.answers.length)return false;
  record.finishedAt=Math.max(record.startedAt,now);return true;
}
export function streak(days, now=Date.now()) {
  const known=new Set(days), date=new Date(now);let count=0;
  if(!known.has(localDay(date.getTime())))date.setDate(date.getDate()-1);
  while(known.has(localDay(date.getTime()))) {count++;date.setDate(date.getDate()-1);}
  return count;
}
export function shareText(puzzle, record, url, { relaxed = false } = {}) {
  if(record.finishedAt===null)throw new Error('Finish the puzzle before sharing your result.');
  const s=record.state;
  // Thin spaces around the dots (and none between a dot and the bulb, whose glyph carries its own space) keep the second line short enough for one line in Messages.
  const dot='\u2009·\u2009', head=s.revealed?`Gave up${relaxed?'':` after ${formatTime(elapsedMs(record))}`}${dot}${s.solved.length-s.revealed} of ${puzzle.answers.length} found`:relaxed?'Relax mode ☕\uFE0F':`Solved in ${formatTime(elapsedMs(record))}`;
  return `Spoondle #${puzzle.id}\n${head}${dot}👁️ ${s.misses} peek${s.misses===1?'':'s'}\u2009·💡 ${s.hints} hint${s.hints===1?'':'s'}\n${s.revealed||relaxed?'Can you solve it?':'Can you beat my time?'}\n${url}`;
}
