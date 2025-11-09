// server.js
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ===================== Utility Helpers ===================== */
const STOPWORDS = new Set([
  'the','is','are','am','a','an','and','or','but','as','of','to','in','on','for','with','by','at','from','that','this','it','be','was','were','has','have','had','not','no','yes','if','then','so','than','too','very','can','could','should','would','will','shall','do','did','does','into','about','over','under','out','up','down'
]);

function splitSentences(text) {
  return text
    .replace(/\s+/g,' ')
    .split(/(?<=[\.\!\?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}"“”‘’«»<>]/g,' ')
    .replace(/[^a-z0-9'\- ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function jaccard(aSet, bSet) {
  const a = new Set(aSet), b = new Set(bSet);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter/union;
}

/* ===================== Humanizer / Rewriter ===================== */
// Simple synonym map (safe-ish words). Does not touch numbers/citations/case titles.
const SYNONYMS = {
  'important': ['crucial','essential','vital','key'],
  'big': ['major','significant','large'],
  'small': ['minor','modest','compact'],
  'make': ['create','build','craft','produce'],
  'get': ['receive','obtain','secure','gain'],
  'use': ['utilize','apply','employ'],
  'help': ['assist','support','aid'],
  'show': ['demonstrate','reveal','display'],
  'improve': ['enhance','boost','refine'],
  'increase': ['raise','elevate','amplify'],
  'reduce': ['lower','decrease','cut'],
  'because': ['since','as'],
  'however': ['but','yet','still'],
  'also': ['additionally','moreover','furthermore'],
  'therefore': ['thus','hence','so'],
  'many': ['numerous','several'],
  'few': ['some','limited'],
  'people': ['individuals','users','customers'],
  'problem': ['issue','challenge','concern'],
  'solution': ['approach','remedy','fix'],
  'feature': ['capability','function','option'],
  'good': ['solid','strong','reliable','great'],
  'bad': ['weak','poor','unreliable'],
  'easy': ['simple','straightforward'],
  'hard': ['difficult','challenging','tough'],
  'fast': ['quick','rapid','speedy'],
  'slow': ['gradual','sluggish'],
  'work': ['operate','function'],
  'buy': ['purchase','acquire'],
  'sell': ['offer','provide']
};

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function rewriteSentence(sent, tone='natural') {
  // Do not touch short sentences heavily
  const tokens = sent.split(/\s+/);
  if (tokens.length < 6) return sent;

  // Clause shuffle (light)
  let out = sent;
  if (/,/.test(sent) && Math.random() < 0.25) {
    const parts = sent.split(',');
    if (parts.length === 2) {
      out = `${parts[1].trim()}, ${parts[0].trim()}`;
    }
  }

  // Word-level replacements (probabilistic)
  const words = out.split(/(\s+)/); // keep spaces
  for (let i=0; i<words.length; i++) {
    const w = words[i];
    const core = w.toLowerCase().replace(/[^a-z'\-]/g,'');
    if (!core || STOPWORDS.has(core)) continue;
    if (/\d/.test(core)) continue; // keep numbers intact
    if (SYNONYMS[core] && Math.random() < 0.35) {
      const repl = pick(SYNONYMS[core]);
      words[i] = w[0] === w[0].toUpperCase() ? (repl.charAt(0).toUpperCase()+repl.slice(1)) : repl;
    }
  }
  let rewritten = words.join('');

  // Tone tweaks (very light)
  if (tone === 'formal') {
    rewritten = rewritten.replace(/\b(can't|won't|don't|isn't|aren't|I'm|you're|we're|they're|it's)\b/gi, (m) => {
      const map = {
        "can't":"cannot","won't":"will not","don't":"do not","isn't":"is not","aren't":"are not",
        "I'm":"I am","you're":"you are","we're":"we are","they're":"they are","it's":"it is"
      };
      return map[m] || m;
    });
  } else if (tone === 'casual') {
    if (Math.random() < 0.3) rewritten = `Honestly, ${rewritten.charAt(0).toLowerCase()+rewritten.slice(1)}`;
  }

  return rewritten;
}

function humanizeText(text, tone='natural', keepLength='medium'){
  const sents = splitSentences(text);
  let res = sents.map(s => rewriteSentence(s, tone));

  // length control (very approximate)
  if (keepLength === 'shorter') {
    res = res.map(s => s.replace(/\s+\w{1,3}\s+/g,' ').trim());
  } else if (keepLength === 'longer') {
    res = res.map(s => s.length > 12 ? s + (Math.random()<0.4 ? ' In practice, this tends to work well.' : '') : s);
  }
  return res.join(' ');
}

/* ===================== AI Detector (Heuristic) ===================== */
function aiDetectScore(text){
  const sents = splitSentences(text);
  const words = tokenize(text);
  const total = words.length || 1;

  // sentence lengths & burstiness
  const lens = sents.map(s => tokenize(s).length).filter(n => n>0);
  const avg = lens.reduce((a,b)=>a+b,0) / (lens.length || 1);
  const variance = lens.reduce((a,b)=>a + Math.pow(b-avg,2),0) / (lens.length || 1);
  const std = Math.sqrt(variance);

  // features
  const ttr = unique(words).length / total;                      // type-token ratio
  const contractions = (text.match(/\b(\w+'(s|re|ve|ll|d|t))\b/gi)||[]).length / (sents.length || 1);
  const punctTypes = (text.match(/[,:;\-\—\(\)]/g)||[]).reduce((set,c)=>set.add(c), new Set()).size;

  // Normalize heuristics to 0..1 where higher = more AI-like
  const lenFactor = Math.min(1, Math.max(0, (avg-18)/22));       // long avg sentences → more AI
  const burstinessFactor = 1 - Math.min(1, std/12);              // low std (uniform) → more AI
  const ttrFactor = 1 - Math.min(1, ttr/0.7);                    // low diversity → more AI
  const contractionFactor = 1 - Math.min(1, contractions/3);     // fewer contractions → more AI
  const punctVarFactor = 1 - Math.min(1, punctTypes/5);          // low variety → more AI

  const score = (
    0.30*lenFactor +
    0.25*burstinessFactor +
    0.20*ttrFactor +
    0.10*contractionFactor +
    0.15*punctVarFactor
  );

  let label = 'Mixed';
  if (score >= 0.65) label = 'Likely AI';
  else if (score <= 0.45) label = 'Likely Human';

  return { score: +score.toFixed(3), label, details: { avgSentenceLen: +avg.toFixed(1), stdSentenceLen: +std.toFixed(1), ttr:+ttr.toFixed(3), contractionsPerSent:+contractions.toFixed(2), punctVar: punctTypes } };
}

/* ===================== Plagiarism Checker (Local Heuristic) ===================== */
// Small sample corpus (demo). You can add your own text blocks here.
const CORPUS = [
  "Artificial intelligence is reshaping industries with automation and smarter decision‑making.",
  "Effective writing balances clarity, rhythm, and specificity to keep readers engaged.",
  "Search engines prioritize useful, original content with strong user signals and authority.",
  "Students can build credit by paying on time and keeping utilization low over months.",
  "Good design reduces friction, directs attention, and makes choices feel obvious."
];

function shingleTokens(tokens, size=6){
  const out = [];
  for (let i=0; i<=tokens.length - size; i++){
    out.push(tokens.slice(i, i+size).join(' '));
  }
  return out;
}

function checkPlagiarism(text){
  const sents = splitSentences(text);
  const tokens = tokenize(text);
  const shingles = new Set(shingleTokens(tokens, 6)); // 6-gram shingles
  if (shingles.size === 0) return { percentOverlap: 0, matches: [] };

  const matches = [];

  // Compare against local corpus
  for (const block of CORPUS) {
    const btok = tokenize(block);
    const bsh = new Set(shingleTokens(btok, 6));
    const inter = [...shingles].filter(s => bsh.has(s));
    if (inter.length > 0) {
      const sim = jaccard(shingles, bsh);
      matches.push({ source: 'Local Corpus', sample: block.slice(0,120)+'...', similarity: +(sim*100).toFixed(1) });
    }
  }

  // Self‑repetition detection (same or near-identical sentences)
  for (let i=0;i<sents.length;i++){
    for (let j=i+1;j<sents.length;j++){
      const a = tokenize(sents[i]), b = tokenize(sents[j]);
      if (a.length>6 && b.length>6){
        const sim = jaccard(a,b);
        if (sim > 0.7) {
          matches.push({ source:'Self repetition', sample:`“${sents[j].slice(0,120)}...”`, similarity:+(sim*100).toFixed(1) });
        }
      }
    }
  }

  // Overlap estimate (very rough): if there are any matches, reflect 5–25% overlap
  const percentOverlap = Math.min(100, matches.reduce((acc,m)=> acc + Math.min(25, m.similarity/4), 0));
  const uniqueness = +(Math.max(0, 100 - percentOverlap)).toFixed(1);
  return { percentOverlap: +(percentOverlap).toFixed(1), uniqueness, matches };
}

/* ===================== API Endpoints ===================== */
// Rewriter
app.post('/api/rewrite', (req,res)=>{
  const { text, tone='natural', keepLength='medium' } = req.body || {};
  if (!text || text.trim().length < 20) return res.status(400).json({ error:'Please provide at least 20 characters.' });
  const out = humanizeText(text, tone, keepLength);
  return res.json({ rewritten: out });
});

// AI Detector
app.post('/api/aidetect', (req,res)=>{
  const { text } = req.body || {};
  if (!text || text.trim().length < 20) return res.status(400).json({ error:'Please provide at least 20 characters.' });
  const result = aiDetectScore(text);
  return res.json(result);
});

// Plagiarism
app.post('/api/plagiarism', (req,res)=>{
  const { text } = req.body || {};
  if (!text || text.trim().length < 50) return res.status(400).json({ error:'Please provide at least 50 characters.' });
  const result = checkPlagiarism(text);
  return res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Server running: http://localhost:${PORT}`));