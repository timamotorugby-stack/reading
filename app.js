const LEVELS = { 1: "易しい", 2: "ふつう", 3: "難しい" };
const LANGUAGES = { en: "英語", fr: "フランス語" };
const POS = {
  noun: "名詞",
  verb: "動詞",
  adjective: "形容詞",
  adverb: "副詞",
  other: "その他",
};
const STEP_RANK = { read: 0, questions: 1, words: 2, done: 3 };
const ARTICLE_ID = /^[a-z]{2}-\d{8}-[a-z0-9]+$/;
const STORAGE_KEY = "reading.study";
const SPEAK_LANG = { en: "en-US", fr: "fr-FR" };

const ui = {
  routeKey: "",
  activeKey: null,
  activeWordId: null,
  questionPhase: "ask",
  speakNote: "",
  storageError: false,
  language: "all",
  level: "all",
  reviewIndex: 0,
  reviewKeys: null,
  transferNote: "",
};

let state = loadState();
let catalogCache = null;
let renderSeq = 0;
let speakToken = 0;

function emptyState() {
  return { schemaVersion: 1, cards: [], last: null, readings: {}, hidden: [] };
}

function studyDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function studyCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function normalizeCard(card) {
  if (!card || typeof card.key !== "string" || !card.key) return null;
  return {
    key: card.key,
    stage: studyCount(card.stage),
    due: studyDate(card.due) || todayString(),
    language: card.language === "fr" ? "fr" : "en",
    headword: typeof card.headword === "string" ? card.headword : "",
    pos: typeof card.pos === "string" && card.pos ? card.pos : "other",
    gender: card.gender === "m" || card.gender === "f" ? card.gender : "",
    ja: typeof card.ja === "string" ? card.ja : "",
    example: typeof card.example === "string" ? card.example : "",
    articleId: typeof card.articleId === "string" ? card.articleId : "",
    topic: typeof card.topic === "string" ? card.topic : "",
  };
}

function normalizeLast(last) {
  if (!last || typeof last.id !== "string" || !last.id || !last.article || typeof last.article !== "object") return null;
  return {
    id: last.id,
    article: last.article,
    step: Object.prototype.hasOwnProperty.call(STEP_RANK, last.step) ? last.step : "read",
    questionIndex: studyCount(last.questionIndex),
    wordIndex: studyCount(last.wordIndex),
    wordQuestions: Array.isArray(last.wordQuestions) ? last.wordQuestions : [],
  };
}

function normalizeHidden(list) {
  const seen = new Set();
  const hidden = [];
  if (!Array.isArray(list)) return hidden;
  for (const id of list) {
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    hidden.push(id);
  }
  return hidden;
}

function normalizeState(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || data.schemaVersion !== 1) return null;
  const readings = data.readings && typeof data.readings === "object" && !Array.isArray(data.readings) ? data.readings : {};
  return {
    schemaVersion: 1,
    cards: Array.isArray(data.cards) ? data.cards.map(normalizeCard).filter(Boolean) : [],
    last: normalizeLast(data.last),
    readings,
    hidden: normalizeHidden(data.hidden),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw)) || emptyState();
  } catch {
    return emptyState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    ui.storageError = false;
  } catch {
    ui.storageError = true;
  }
}

function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function intervalDays(stage) {
  const steps = [1, 3, 7, 16, 35];
  if (stage <= 0) return 0;
  if (stage <= steps.length) return steps[stage - 1];
  let days = steps[steps.length - 1];
  for (let index = steps.length; index < stage; index += 1) days *= 2;
  return days;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`;
}

function scheduleCard(card, mode) {
  if (mode === "again") {
    card.stage = 0;
    card.due = todayString();
    return;
  }
  const step = mode === "easy" ? 2 : 1;
  card.stage = studyCount(card.stage) + step;
  card.due = addDays(todayString(), intervalDays(card.stage));
}

function dueLabel(due) {
  if (!due || due <= todayString()) return { text: "今日", due: true };
  const [, month, day] = due.split("-");
  return { text: `${Number(month)}月${Number(day)}日`, due: false };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  if (tag === "button") node.type = "button";
  return node;
}

function chevron(right) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", right ? "chev right" : "chev");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M14.5 6.5 9 12l5.5 5.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.75");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function backLink(hash) {
  const link = el("a", "back");
  link.href = hash;
  link.append(chevron(false), document.createTextNode("戻る"));
  return link;
}

function bar(title, backHash, step) {
  const header = el("header", "bar");
  header.append(backLink(backHash));
  header.append(el("h1", "", title));
  if (step) header.append(el("p", "step", step));
  return header;
}

function menuRow(label, hash) {
  const link = el("a", "menu-row");
  link.href = hash;
  link.append(el("span", "", label), chevron(true));
  return link;
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function parseRoute() {
  const parts = (location.hash.replace(/^#/, "") || "/").split("/").filter(Boolean);
  return { name: parts[0] || "home", a: parts[1] || "", b: parts[2] || "" };
}

function screenTitle(route) {
  const titles = {
    home: "ホーム",
    library: "ライブラリ",
    read: "読む",
    questions: "読解",
    words: "単語",
    cards: "単語帳",
    settings: "設定",
  };
  return titles[route.name] || "ホーム";
}

function articlePath(id) {
  return `content/articles/${encodeURIComponent(id)}.json`;
}

function textLang(language) {
  return language === "fr" ? "fr" : "en";
}

function metaLine(article) {
  return [LANGUAGES[article.language] || article.language, LEVELS[article.level] || String(article.level ?? ""), article.topic || ""]
    .filter(Boolean)
    .join(" · ");
}

function posLabel(pos) {
  return POS[pos] || "その他";
}

function wordList(article) {
  return Array.isArray(article.words) ? article.words : [];
}

function questionList(article) {
  return Array.isArray(article.questions) ? article.questions : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffle(items, seed) {
  const copy = items.slice();
  let random = seed >>> 0;
  const next = () => {
    random = (random + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(random ^ (random >>> 15), 1 | random);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    const hold = copy[index];
    copy[index] = copy[swap];
    copy[swap] = hold;
  }
  return copy;
}

function isGenderWord(article, word) {
  return article.language === "fr" && word.pos === "noun" && (word.gender === "m" || word.gender === "f");
}

function meaningChoices(article, word) {
  const pool = [];
  for (const other of wordList(article)) {
    if (!other.ja || other.ja === word.ja || pool.includes(other.ja)) continue;
    pool.push(other.ja);
  }
  const seed = hashSeed(`${article.id}:${word.id}:meaning`);
  return shuffle([word.ja, ...shuffle(pool, seed).slice(0, 3)], seed + 1);
}

function buildWordQuestions(article) {
  const words = wordList(article);
  const genderWord = words.find((word) => isGenderWord(article, word));
  const plan = [];
  const limit = genderWord ? 3 : 4;
  for (const word of words) {
    if (plan.length >= limit) break;
    plan.push({ kind: "meaning", wordId: word.id, choices: meaningChoices(article, word) });
    if (plan.length >= limit) break;
    plan.push({ kind: "spelling", wordId: word.id });
  }
  if (genderWord) plan.push({ kind: "gender", wordId: genderWord.id });
  return plan.slice(0, 4);
}

function questionsValid(article, list) {
  if (!Array.isArray(list) || !list.length) return false;
  const ids = new Set(wordList(article).map((word) => word.id));
  return list.every((item) => item && ids.has(item.wordId) && item.kind);
}

function remember(article) {
  const fresh = clone(article);
  if (!state.last || state.last.id !== article.id) {
    state.last = {
      id: article.id,
      article: fresh,
      step: "read",
      questionIndex: 0,
      wordIndex: 0,
      wordQuestions: buildWordQuestions(fresh),
    };
  } else {
    state.last.article = fresh;
    if (!questionsValid(fresh, state.last.wordQuestions)) {
      state.last.wordQuestions = buildWordQuestions(fresh);
    }
  }
  for (const word of wordList(fresh)) {
    const card = state.cards.find((item) => item.key === cardKey(fresh, word));
    if (!card) continue;
    card.example = word.example || "";
    card.articleId = fresh.id;
    card.topic = fresh.topic || "";
  }
  save();
  return state.last;
}

function reach(step) {
  if (!state.last) return;
  const current = STEP_RANK[state.last.step] ?? 0;
  if ((STEP_RANK[step] ?? 0) > current) {
    state.last.step = step;
    save();
  }
}

function ensureReadings(articleId) {
  if (!state.readings[articleId]) state.readings[articleId] = { questions: {}, words: {} };
  if (!state.readings[articleId].questions) state.readings[articleId].questions = {};
  if (!state.readings[articleId].words) state.readings[articleId].words = {};
  return state.readings[articleId];
}

function questionRecord(articleId, questionId) {
  const bucket = state.readings[articleId];
  if (!bucket || !bucket.questions) return null;
  return bucket.questions[questionId] || null;
}

function questionDone(article, question) {
  const saved = questionRecord(article.id, question.id);
  if (!saved) return false;
  if (question.kind === "free") return Boolean(saved.grade);
  return Boolean(saved.selected);
}

function wordRecord(articleId, item) {
  const bucket = state.readings[articleId];
  if (!bucket || !bucket.words) return null;
  return bucket.words[`${item.wordId}:${item.kind}`] || null;
}

function cardKey(article, word) {
  const locale = article.language === "fr" ? "fr" : "en";
  return `${article.language}:${String(word.headword || "").toLocaleLowerCase(locale)}`;
}

function applyGloss(card, article, word) {
  card.language = article.language === "fr" ? "fr" : "en";
  card.headword = word.headword || "";
  card.pos = word.pos || "other";
  card.gender = word.gender === "m" || word.gender === "f" ? word.gender : "";
  card.ja = word.ja || "";
  card.example = word.example || "";
  card.articleId = article.id;
  card.topic = article.topic || "";
}

function saveCard(article, word, mode) {
  const key = cardKey(article, word);
  let card = state.cards.find((item) => item.key === key);
  const created = !card;
  if (!card) {
    card = { key, stage: 0, due: todayString() };
    state.cards.push(card);
  }
  applyGloss(card, article, word);
  if (mode === "miss" || created) {
    card.stage = 0;
    card.due = todayString();
  }
  save();
}

function dueCards() {
  const today = todayString();
  return state.cards.filter((card) => card.due <= today);
}

function sortedCards() {
  return state.cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => String(a.card.due).localeCompare(String(b.card.due)) || a.index - b.index)
    .map((item) => item.card);
}

function cardMeta(card) {
  const parts = [posLabel(card.pos)];
  if (card.gender === "m") parts.push("男性");
  if (card.gender === "f") parts.push("女性");
  if (card.ja) parts.push(card.ja);
  return parts.join(" · ");
}

function normalizeSpelling(value, language) {
  const locale = language === "fr" ? "fr" : "en";
  return String(value).replace(/\s+/g, "").toLocaleLowerCase(locale);
}

function isWordChar(ch) {
  return Boolean(ch) && /[\p{L}\p{N}]/u.test(ch);
}

function startsWord(text, index) {
  return index === 0 || !isWordChar(text[index - 1]);
}

function endsWord(text, index) {
  return index >= text.length || !isWordChar(text[index]);
}

function evidenceSentences(article, sentenceId) {
  const sentences = Array.isArray(article.sentences) ? article.sentences : [];
  const index = sentences.findIndex((sentence) => sentence.id === sentenceId);
  if (index < 0) return [];
  return sentences.slice(Math.max(0, index - 2), Math.min(sentences.length, index + 2));
}

async function loadCatalog() {
  if (catalogCache) return { articles: catalogCache, error: false };
  try {
    const response = await fetch("content/index.json");
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    catalogCache = Array.isArray(data.articles) ? data.articles : [];
    return { articles: catalogCache, error: false };
  } catch {
    return { articles: [], error: true };
  }
}

async function loadArticle(id) {
  if (!ARTICLE_ID.test(id)) return null;
  try {
    const response = await fetch(articlePath(id));
    if (!response.ok) throw new Error(String(response.status));
    const article = await response.json();
    if (!article || article.id !== id) throw new Error("id");
    return article;
  } catch {
    if (state.last && state.last.id === id && state.last.article) return state.last.article;
    return null;
  }
}

function voiceLang(voice) {
  return String(voice.lang || "").replace(/_/g, "-").toLowerCase();
}

function voicesReady() {
  const synth = window.speechSynthesis;
  const existing = synth.getVoices();
  if (existing.length) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, 500);
  });
}

async function onSpeak(article) {
  const languageName = article.language === "fr" ? "フランス語" : "英語";
  const missing = `この端末に${languageName}の音声がありません`;
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance !== "function") {
    ui.speakNote = missing;
    render();
    return;
  }
  if (synth.speaking || synth.pending) {
    speakToken += 1;
    synth.cancel();
    return;
  }
  const lang = SPEAK_LANG[article.language] || "en-US";
  const token = ++speakToken;
  const voices = await voicesReady();
  if (token !== speakToken) return;
  const wanted = lang.toLowerCase();
  const matches = voices.filter((voice) => {
    const value = voiceLang(voice);
    return value === wanted || value.startsWith(`${wanted}-`);
  });
  if (voices.length && !matches.length) {
    ui.speakNote = missing;
    render();
    return;
  }
  ui.speakNote = "";
  const utter = new SpeechSynthesisUtterance(article.body || "");
  utter.lang = lang;
  if (matches.length) utter.voice = matches[0];
  utter.onerror = (event) => {
    if (event.error === "interrupted" || event.error === "canceled") return;
    ui.speakNote = missing;
    render();
  };
  synth.speak(utter);
}

function continueStatus(step) {
  if (step === "questions") return "読解の途中";
  if (step === "words") return "単語の途中";
  if (step === "done") return "読み終えた";
  return "読む途中";
}

function continueHash(last) {
  if (last.step === "questions") return `#/questions/${last.id}`;
  if (last.step === "words") return `#/words/${last.id}`;
  return `#/read/${last.id}`;
}

function homeScreen() {
  const screen = el("div", "screen screen-home");
  const pad = el("div", "pad");
  pad.append(el("h1", "", "ホーム"));

  const review = el("section");
  review.append(el("h2", "", "今日の復習"));
  const due = dueCards();
  if (!due.length) {
    review.append(el("p", "empty-line", "今日の語はありません"));
  } else {
    const count = el("p", "due");
    count.append(el("span", "due-num", String(due.length)), el("span", "due-unit", "語"));
    review.append(count);
    const solve = el("button", "primary", "解く");
    solve.addEventListener("click", () => go("#/cards/review"));
    review.append(solve);
  }
  pad.append(review);

  const next = el("section");
  next.append(el("h2", "", "続き"));
  const last = state.last;
  if (!last || !last.article) {
    next.append(el("p", "empty-line", "続きの文章はありません"));
  } else {
    const card = el("a", "card");
    card.href = continueHash(last);
    const heading = el("h3", "", last.article.title || last.id);
    heading.lang = textLang(last.article.language);
    card.append(
      el("p", "status", continueStatus(last.step)),
      el("p", "meta", metaLine(last.article)),
      heading,
      el("p", "go", last.step === "done" ? "開く" : "続きから読む"),
    );
    next.append(card);
  }
  pad.append(next);
  if (ui.storageError) pad.append(el("p", "note", "このブラウザには残せませんでした。"));

  const menu = el("nav", "menu");
  menu.setAttribute("aria-label", "移動");
  menu.append(menuRow("ライブラリ", "#/library"), menuRow("単語帳", "#/cards"));
  screen.append(pad, menu);
  return screen;
}

function chip(label, on, onClick) {
  const button = el("button", on ? "is-on" : "", label);
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.addEventListener("click", onClick);
  return button;
}

function libraryScreen(articles, error) {
  const screen = el("div", "screen screen-library");
  screen.append(bar("ライブラリ", "#/"));
  const filters = el("div", "filters");
  const language = el("fieldset");
  language.append(el("legend", "", "言語"));
  const languageChips = el("div", "chips");
  [["all", "すべて"], ["en", "英語"], ["fr", "フランス語"]].forEach(([value, label]) => {
    languageChips.append(chip(label, ui.language === value, () => {
      ui.language = value;
      render();
    }));
  });
  language.append(languageChips);
  const level = el("fieldset");
  level.append(el("legend", "", "難易度"));
  const levelChips = el("div", "chips");
  [["all", "すべて"], [1, "易しい"], [2, "ふつう"], [3, "難しい"]].forEach(([value, label]) => {
    levelChips.append(chip(label, ui.level === value, () => {
      ui.level = value;
      render();
    }));
  });
  level.append(levelChips);
  filters.append(language, level);
  screen.append(filters);

  if (error) {
    screen.append(el("p", "blank", "目録を読めませんでした。"));
    return screen;
  }
  const hidden = new Set(state.hidden || []);
  const shown = articles.filter((article) => {
    if (hidden.has(article.id)) return false;
    if (ui.language !== "all" && article.language !== ui.language) return false;
    if (ui.level !== "all" && article.level !== ui.level) return false;
    return true;
  });
  if (!shown.length) {
    screen.append(el("p", "blank", "文章はまだありません"));
    return screen;
  }
  screen.append(el("p", "count", `${shown.length}本`));
  const list = el("div", "list");
  for (const article of shown) {
    const item = el("article", "item");
    const title = el("h2", "", article.title || article.id);
    title.lang = textLang(article.language);
    item.append(title, el("p", "meta", metaLine(article)));
    const actions = el("div", "actions");
    if (ARTICLE_ID.test(article.id)) {
      const open = el("a", "open", "開く");
      open.href = `#/read/${article.id}`;
      actions.append(open);
    }
    const discard = el("button", "discard", "捨てる");
    discard.addEventListener("click", () => {
      if (!article.id || state.hidden.includes(article.id)) return;
      state.hidden.push(article.id);
      save();
      render();
    });
    actions.append(discard);
    item.append(actions);
    list.append(item);
  }
  screen.append(list);
  return screen;
}

function readScreen(article) {
  const screen = el("div", "screen screen-read");
  const top = el("header", "top");
  const row = el("div", "top-row");
  row.append(backLink("#/"));
  const speak = el("button", "speak", "読み上げ");
  speak.addEventListener("click", () => onSpeak(article));
  row.append(speak);
  const title = el("h1", "", article.title || article.id);
  title.lang = textLang(article.language);
  top.append(row, title, el("p", "meta", metaLine(article)));
  if (ui.speakNote) top.append(el("p", "speak-note", ui.speakNote));
  screen.append(top);

  const reading = el("div", "reading");
  const articleBox = el("div", "article");
  articleBox.append(renderBody(article));
  reading.append(articleBox);
  screen.append(reading);

  const active = ui.activeWordId ? wordList(article).find((word) => word.id === ui.activeWordId) : null;
  if (active && ui.activeKey) screen.append(wordSheet(article, active));
  else {
    const foot = el("div", "foot");
    const next = el("button", "primary", "読解へ進む");
    next.addEventListener("click", () => {
      reach("questions");
      go(`#/questions/${article.id}`);
    });
    foot.append(next);
    screen.append(foot);
  }
  return screen;
}

function renderBody(article) {
  const paragraph = el("p", "body");
  paragraph.lang = textLang(article.language);
  const forms = [];
  for (const word of wordList(article)) {
    const surfaces = Array.isArray(word.forms) && word.forms.length ? word.forms : [word.headword];
    for (const form of surfaces) {
      if (form) forms.push({ form: String(form), word });
    }
  }
  forms.sort((a, b) => b.form.length - a.form.length);
  const text = String(article.body || "");
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    paragraph.append(buffer);
    buffer = "";
  };
  let index = 0;
  while (index < text.length) {
    let match = null;
    if (startsWord(text, index)) {
      for (const item of forms) {
        const end = index + item.form.length;
        if (end > text.length) continue;
        const slice = text.slice(index, end);
        if (slice.toLowerCase() === item.form.toLowerCase() && endsWord(text, end)) {
          match = { slice, word: item.word, at: index };
          break;
        }
      }
    }
    if (!match) {
      buffer += text[index];
      index += 1;
      continue;
    }
    flush();
    const key = `${match.word.id}:${match.at}`;
    const button = el("button", ui.activeKey === key ? "word is-on" : "word", match.slice);
    if (ui.activeKey === key) button.setAttribute("aria-pressed", "true");
    const wordId = match.word.id;
    button.addEventListener("click", () => {
      ui.activeKey = key;
      ui.activeWordId = wordId;
      render();
    });
    paragraph.append(button);
    index += match.slice.length;
  }
  flush();
  return paragraph;
}

function wordSheet(article, word) {
  const sheet = el("div", "sheet");
  const head = el("div", "sheet-head");
  const title = el("p", "headword", word.headword || "");
  title.lang = textLang(article.language);
  const close = el("button", "close", "閉じる");
  close.addEventListener("click", () => {
    ui.activeKey = null;
    ui.activeWordId = null;
    render();
  });
  head.append(title, close);
  sheet.append(head, el("p", "pos", posLabel(word.pos)), el("p", "ja", word.ja || ""));
  if (word.example) {
    sheet.append(el("p", "example-label", "例"));
    const example = el("p", "example", word.example);
    example.lang = textLang(article.language);
    sheet.append(example);
  }
  const exists = state.cards.some((card) => card.key === cardKey(article, word));
  const add = el("button", "primary", exists ? "単語帳に入っています" : "単語帳に入れる");
  if (exists) add.setAttribute("aria-disabled", "true");
  add.addEventListener("click", () => {
    if (state.cards.some((card) => card.key === cardKey(article, word))) return;
    saveCard(article, word, "add");
    render();
  });
  sheet.append(add);
  return sheet;
}

function choiceButton(label, tone, verdict) {
  const button = el("button", tone ? `choice ${tone}` : "choice");
  if (!verdict) {
    button.textContent = label;
    return button;
  }
  button.append(el("span", "", label), el("span", "verdict", verdict));
  return button;
}

function resultCard(status, prompt, judge, onClick) {
  const button = el("button", "result");
  button.append(el("p", "status", status), el("p", "prompt", prompt), el("p", "judge", judge));
  button.addEventListener("click", onClick);
  return button;
}

function questionsScreen(article, last) {
  reach("questions");
  const questions = questionList(article);
  const screen = el("div", "screen screen-questions");
  if (!questions.length) {
    screen.append(bar("読解", `#/read/${article.id}`));
    const pad = el("div", "pad");
    pad.append(el("p", "empty-line", "読解の問題はありません"));
    const next = el("button", "primary", "単語へ進む");
    next.addEventListener("click", () => {
      reach("words");
      go(`#/words/${article.id}`);
    });
    pad.append(next);
    screen.append(pad);
    return screen;
  }

  if (ui.questionPhase === "ask") {
    const index = firstUndone(questions, (question) => questionDone(article, question), last.questionIndex || 0);
    if (index !== last.questionIndex) {
      last.questionIndex = index;
      save();
    }
    if (questionDone(article, questions[index])) ui.questionPhase = "marked";
  }
  const index = Math.min(last.questionIndex || 0, questions.length - 1);
  const question = questions[index];
  screen.append(bar("読解", `#/read/${article.id}`, `${index + 1} / ${questions.length}`));
  const pad = el("div", "pad");
  pad.append(el("p", "meta", metaLine(article)));

  if (question.kind === "free") pad.append(freeQuestion(article, last, question));
  else pad.append(choiceQuestion(article, last, question));
  screen.append(pad);
  return screen;
}

function firstUndone(items, done, current) {
  const index = Math.min(Math.max(current || 0, 0), Math.max(items.length - 1, 0));
  if (!items.length) return 0;
  if (!done(items[index])) return index;
  const undone = items.findIndex((item) => !done(item));
  return undone >= 0 ? undone : index;
}

function choiceQuestion(article, last, question) {
  const wrap = el("div");
  const saved = questionRecord(article.id, question.id);
  const answered = Boolean(saved && saved.selected);
  if (ui.questionPhase === "passage" && answered) {
    wrap.append(passageView(article, last, question, saved));
    return wrap;
  }
  wrap.append(el("p", "prompt", question.prompt || ""));
  const choices = el("div", "choices");
  const options = Array.isArray(question.choices) ? question.choices : [];
  for (const option of options) {
    let tone = "";
    let verdict = "";
    if (answered && option === question.answer) {
      tone = "is-good";
      verdict = "正解";
    } else if (answered && option === saved.selected) {
      tone = "is-bad";
      verdict = "まちがい";
    }
    const button = choiceButton(option, tone, verdict);
    button.addEventListener("click", () => {
      if (answered) {
        const sentences = evidenceSentences(article, question.evidenceSentenceId);
        if (sentences.length) {
          ui.questionPhase = "passage";
          render();
        } else {
          advanceQuestion(article, last);
        }
        return;
      }
      const bucket = ensureReadings(article.id);
      bucket.questions[question.id] = {
        kind: "choice",
        selected: option,
        correct: option === question.answer,
      };
      save();
      ui.questionPhase = "marked";
      render();
    });
    choices.append(button);
  }
  wrap.append(choices);
  if (!answered) return wrap;

  const sentences = evidenceSentences(article, question.evidenceSentenceId);
  if (sentences.length) {
    const evidence = el("button", "evidence");
    const sentence = sentences.find((item) => item.id === question.evidenceSentenceId) || sentences[0];
    const line = el("p", "sentence", sentence.text || "");
    line.lang = textLang(article.language);
    evidence.append(el("p", "status", "根拠"), line);
    evidence.addEventListener("click", () => {
      ui.questionPhase = "passage";
      render();
    });
    wrap.append(evidence);
  } else {
    wrap.append(resultCard(
      saved.correct ? "正解" : "まちがい",
      question.prompt || "",
      judgeLine(saved, question),
      () => advanceQuestion(article, last),
    ));
  }
  return wrap;
}

function judgeLine(saved, question) {
  if (saved.correct) return `正解は ${question.answer}`;
  return `${saved.selected}はまちがい。正解は ${question.answer}`;
}

function passageView(article, last, question, saved) {
  const wrap = el("div");
  const title = el("h2", "title", article.title || article.id);
  title.lang = textLang(article.language);
  const body = el("p", "body");
  body.lang = textLang(article.language);
  const sentences = evidenceSentences(article, question.evidenceSentenceId);
  sentences.forEach((sentence, index) => {
    if (index) body.append(" ");
    if (sentence.id === question.evidenceSentenceId) {
      const mark = el("mark", "", sentence.text || "");
      body.append(mark);
    } else {
      body.append(sentence.text || "");
    }
  });
  wrap.append(title, body, resultCard(
    saved.correct ? "正解" : "まちがい",
    question.prompt || "",
    judgeLine(saved, question),
    () => advanceQuestion(article, last),
  ));
  return wrap;
}

function freeQuestion(article, last, question) {
  const wrap = el("div");
  wrap.append(el("p", "prompt", question.prompt || ""));
  const saved = questionRecord(article.id, question.id) || {};
  const area = el("textarea", "write");
  area.value = saved.text || "";
  area.addEventListener("input", () => {
    const bucket = ensureReadings(article.id);
    const prev = bucket.questions[question.id] || {};
    bucket.questions[question.id] = { ...prev, kind: "free", text: area.value };
    save();
  });
  wrap.append(area);
  const trio = el("div", "trio");
  trio.setAttribute("role", "group");
  trio.setAttribute("aria-label", "自己採点");
  [["known", "わかった"], ["unsure", "あやふや"], ["unknown", "わからない"]].forEach(([grade, label]) => {
    const on = saved.grade === grade;
    const button = el("button", on ? "is-on" : "", label);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.addEventListener("click", () => {
      if (saved.grade === grade) {
        advanceQuestion(article, last);
        return;
      }
      const bucket = ensureReadings(article.id);
      const prev = bucket.questions[question.id] || {};
      bucket.questions[question.id] = { ...prev, kind: "free", text: area.value, grade };
      save();
      ui.questionPhase = "ask";
      render();
    });
    trio.append(button);
  });
  wrap.append(trio);
  return wrap;
}

function advanceQuestion(article, last) {
  const questions = questionList(article);
  const next = (last.questionIndex || 0) + 1;
  if (next >= questions.length) {
    reach("words");
    go(`#/words/${article.id}`);
    return;
  }
  last.questionIndex = next;
  ui.questionPhase = "ask";
  save();
  render();
}

function wordsScreen(article, last) {
  reach("words");
  const questions = Array.isArray(last.wordQuestions) ? last.wordQuestions : [];
  const screen = el("div", "screen screen-words");
  if (!questions.length) {
    screen.append(bar("単語", `#/questions/${article.id}`));
    const pad = el("div", "pad");
    pad.append(el("p", "empty-line", "単語の問題はありません"));
    const done = el("button", "primary", "ホームへ");
    done.addEventListener("click", () => {
      reach("done");
      go("#/");
    });
    pad.append(done);
    screen.append(pad);
    return screen;
  }
  if (ui.questionPhase === "ask") {
    const index = firstUndone(questions, (item) => Boolean(wordRecord(article.id, item)), last.wordIndex || 0);
    if (index !== last.wordIndex) {
      last.wordIndex = index;
      save();
    }
    if (wordRecord(article.id, questions[index])) ui.questionPhase = "graded";
  }
  const index = Math.min(last.wordIndex || 0, questions.length - 1);
  const item = questions[index];
  const word = wordList(article).find((entry) => entry.id === item.wordId);
  screen.append(bar("単語", `#/questions/${article.id}`, `${index + 1} / ${questions.length}`));
  const pad = el("div", "pad");
  pad.append(el("p", "meta", metaLine(article)));
  if (!word) {
    pad.append(el("p", "empty-line", "この問題の語が見つかりません"));
  } else if (item.kind === "spelling") {
    pad.append(spellingQuestion(article, last, item, word));
  } else if (item.kind === "gender") {
    pad.append(genderQuestion(article, last, item, word));
  } else {
    pad.append(meaningQuestion(article, last, item, word));
  }
  screen.append(pad);
  return screen;
}

function unsureControl(article, item, word, saved) {
  const pressed = Boolean(saved && saved.unsure);
  const button = el("button", "unsure", "あやふや");
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
  button.addEventListener("click", () => {
    if (pressed) {
      advanceWord(article);
      return;
    }
    const bucket = ensureReadings(article.id);
    bucket.words[`${item.wordId}:${item.kind}`] = { kind: item.kind, unsure: true, correct: false };
    saveCard(article, word, "miss");
    ui.questionPhase = "graded";
    render();
  });
  const wrap = el("div");
  wrap.append(button);
  if (pressed) wrap.append(el("p", "after", "今日の復習に入ります"));
  return wrap;
}

function meaningQuestion(article, last, item, word) {
  const wrap = el("div");
  const head = el("p", "headword", word.headword || "");
  head.lang = textLang(article.language);
  wrap.append(head, el("p", "pos", posLabel(word.pos)), el("p", "prompt", "この語の意味はどれですか。"));
  const saved = wordRecord(article.id, item);
  const choices = el("div", "choices");
  const options = Array.isArray(item.choices) && item.choices.length ? item.choices : meaningChoices(article, word);
  for (const option of options) {
    let tone = "";
    let verdict = "";
    if (saved && !saved.unsure && option === word.ja) {
      tone = "is-good";
      verdict = "正解";
    } else if (saved && !saved.unsure && option === saved.selected && option !== word.ja) {
      tone = "is-bad";
      verdict = "まちがい";
    }
    const button = choiceButton(option, tone, verdict);
    button.addEventListener("click", () => {
      if (saved) {
        advanceWord(article);
        return;
      }
      const correct = option === word.ja;
      const bucket = ensureReadings(article.id);
      bucket.words[`${item.wordId}:meaning`] = { kind: "meaning", selected: option, correct, unsure: false };
      if (!correct) saveCard(article, word, "miss");
      else save();
      ui.questionPhase = "graded";
      render();
    });
    choices.append(button);
  }
  wrap.append(choices);
  if (!saved || saved.unsure) wrap.append(unsureControl(article, item, word, saved));
  return wrap;
}

function spellingQuestion(article, last, item, word) {
  const wrap = el("div");
  wrap.append(el("p", "cue", word.ja || ""), el("p", "pos", posLabel(word.pos)), el("p", "field-label", "つづり"));
  const saved = wordRecord(article.id, item);
  const graded = Boolean(saved && !saved.unsure);
  const form = el("form");
  const entry = el("div", "entry");
  if (graded) entry.classList.add(saved.correct ? "is-good" : "is-bad");
  const input = el("input");
  input.type = "text";
  input.lang = textLang(article.language);
  input.setAttribute("aria-label", "つづり");
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.value = saved && saved.typed ? saved.typed : "";
  if (graded) input.readOnly = true;
  entry.append(input);
  if (graded) entry.append(el("span", "verdict", saved.correct ? "正解" : "まちがい"));
  form.append(entry);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (saved) {
      advanceWord(article);
      return;
    }
    const typed = input.value;
    if (!normalizeSpelling(typed, article.language)) return;
    const correct = normalizeSpelling(typed, article.language) === normalizeSpelling(word.headword || "", article.language);
    const bucket = ensureReadings(article.id);
    bucket.words[`${item.wordId}:spelling`] = { kind: "spelling", typed, correct, unsure: false };
    if (!correct) saveCard(article, word, "miss");
    else save();
    ui.questionPhase = "graded";
    render();
  });
  wrap.append(form);
  if (graded && !saved.correct) {
    const line = el("p", "after");
    line.append("正しくは ");
    const answer = el("span", "", word.headword || "");
    answer.lang = textLang(article.language);
    line.append(answer);
    wrap.append(line);
  }
  if (!saved || saved.unsure) wrap.append(unsureControl(article, item, word, saved));
  return wrap;
}

function genderQuestion(article, last, item, word) {
  const wrap = el("div");
  const head = el("p", "headword", word.headword || "");
  head.lang = "fr";
  wrap.append(
    head,
    el("p", "pos", `${posLabel(word.pos)} · ${word.ja || ""}`),
    el("p", "prompt", "この名詞の性はどちらですか。"),
  );
  const saved = wordRecord(article.id, item);
  const choices = el("div", "choices");
  [["m", "男性名詞"], ["f", "女性名詞"]].forEach(([value, label]) => {
    let tone = "";
    let verdict = "";
    if (saved && !saved.unsure && value === word.gender) {
      tone = "is-good";
      verdict = "正解";
    } else if (saved && !saved.unsure && value === saved.selected && value !== word.gender) {
      tone = "is-bad";
      verdict = "まちがい";
    }
    const button = choiceButton(label, tone, verdict);
    button.addEventListener("click", () => {
      if (saved) {
        advanceWord(article);
        return;
      }
      const correct = value === word.gender;
      const bucket = ensureReadings(article.id);
      bucket.words[`${item.wordId}:gender`] = { kind: "gender", selected: value, correct, unsure: false };
      if (!correct) saveCard(article, word, "miss");
      else save();
      ui.questionPhase = "graded";
      render();
    });
    choices.append(button);
  });
  wrap.append(choices);
  if (!saved || saved.unsure) wrap.append(unsureControl(article, item, word, saved));
  return wrap;
}

function advanceWord(article) {
  const last = state.last;
  if (!last) {
    go("#/");
    return;
  }
  const questions = last.wordQuestions || [];
  const next = (last.wordIndex || 0) + 1;
  if (next >= questions.length) {
    reach("done");
    go("#/");
    return;
  }
  last.wordIndex = next;
  ui.questionPhase = "ask";
  save();
  render();
}

function cardsScreen(tab) {
  const screen = el("div", "screen screen-cards");
  screen.append(bar("単語帳", "#/"));
  const filters = el("div", "filters");
  const chips = el("div", "chips");
  chips.append(
    chip("今日", tab === "today", () => go("#/cards")),
    chip("すべて", tab === "all", () => go("#/cards/all")),
  );
  filters.append(chips);
  screen.append(filters);
  const list = tab === "all" ? sortedCards() : dueCards();
  if (!list.length) {
    screen.append(el("p", "blank", tab === "today" ? "今日の語はありません" : "語はまだありません"));
    return screen;
  }
  screen.append(el("p", "count", `${list.length}語`));
  const rows = el("div", "rows");
  for (const card of list) {
    const row = el("article");
    const title = el("h2", "", card.headword || "");
    title.lang = textLang(card.language);
    const when = dueLabel(card.due);
    row.append(title, el("p", when.due ? "when is-due" : "when", when.text), el("p", "meta", cardMeta(card)));
    rows.append(row);
  }
  screen.append(rows);
  if (tab === "today") {
    const solve = el("div", "solve");
    const button = el("button", "primary", "解く");
    button.addEventListener("click", () => go("#/cards/review"));
    solve.append(button);
    screen.append(solve);
  }
  return screen;
}

function reviewQueue() {
  if (!ui.reviewKeys) ui.reviewKeys = dueCards().map((card) => card.key);
  return ui.reviewKeys.map((key) => state.cards.find((card) => card.key === key)).filter(Boolean);
}

function reviewScreen() {
  const due = reviewQueue();
  if (!due.length || ui.reviewIndex >= due.length) return cardsScreen("today");
  const card = due[ui.reviewIndex];
  const screen = el("div", "screen screen-review");
  screen.append(bar("単語帳", "#/", `${ui.reviewIndex + 1} / ${due.length}`));
  const pad = el("div", "pad");
  pad.append(el("p", "cue", card.ja || ""));
  const head = el("p", "headword", card.headword || "");
  head.lang = textLang(card.language);
  const bits = [posLabel(card.pos), LANGUAGES[card.language] || card.language, card.topic].filter(Boolean);
  pad.append(head, el("p", "pos", bits.join(" · ")));
  if (card.example) {
    pad.append(el("p", "example-label", "例"));
    const example = el("p", "example", card.example);
    example.lang = textLang(card.language);
    pad.append(example);
  }
  const trio = el("div", "trio");
  trio.setAttribute("role", "group");
  trio.setAttribute("aria-label", "復習");
  [["again", "もう一度"], ["known", "わかった"], ["easy", "簡単"]].forEach(([mode, label]) => {
    const button = el("button", "", label);
    button.addEventListener("click", () => gradeReview(card, mode));
    trio.append(button);
  });
  pad.append(trio);
  screen.append(pad);
  return screen;
}

function gradeReview(card, mode) {
  if (mode === "known" || mode === "easy") {
    if (state.cards.includes(card)) scheduleCard(card, mode);
  } else if (mode === "again") {
    if (!state.cards.includes(card)) state.cards.push(card);
    scheduleCard(card, mode);
  }
  save();
  ui.reviewIndex += 1;
  if (ui.reviewIndex >= reviewQueue().length) {
    go("#/cards");
    return;
  }
  render();
}

function studyFile() {
  return normalizeState(state) || emptyState();
}

function exportStudy() {
  const blob = new Blob([`${JSON.stringify(studyFile(), null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a");
  link.href = url;
  link.download = "reading-study.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importStudy(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data = null;
    try {
      data = JSON.parse(String(reader.result || ""));
    } catch {
      data = null;
    }
    const next = data ? normalizeState(data) : null;
    if (!next) {
      ui.transferNote = "このファイルは読み込めません。";
      render();
      return;
    }
    state = next;
    save();
    ui.transferNote = ui.storageError ? "" : "読み込みました。";
    render();
  };
  reader.readAsText(file);
}

function settingsScreen() {
  const screen = el("div", "screen screen-settings");
  screen.append(bar("設定", "#/"));
  const pad = el("div", "pad");
  const exportSection = el("section");
  const exportButton = el("button", "primary", "書き出す");
  exportButton.addEventListener("click", exportStudy);
  exportSection.append(
    el("h2", "", "書き出し"),
    el("p", "quiet", "このブラウザの単語帳、読解の結果、最後の文章をファイルにします。"),
    exportButton,
  );
  const importSection = el("section");
  const importButton = el("button", "secondary", "ファイルを選ぶ");
  const input = el("input", "file-input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.tabIndex = -1;
  input.setAttribute("aria-label", "学習記録のファイル");
  importButton.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) importStudy(file);
  });
  importSection.append(
    el("h2", "", "読み込み"),
    el("p", "quiet", "学習記録をファイルの中身に置き換えます。"),
    importButton,
    input,
  );
  pad.append(exportSection, importSection);
  if (ui.storageError) pad.append(el("p", "note", "このブラウザには残せませんでした。"));
  else if (ui.transferNote) pad.append(el("p", "note", ui.transferNote));
  screen.append(pad);
  return screen;
}

function messageScreen(title, message) {
  const screen = el("div", "screen");
  screen.append(bar(title, "#/"));
  const pad = el("div", "pad");
  pad.append(el("p", "empty-line", message));
  screen.append(pad);
  return screen;
}

async function render() {
  const seq = ++renderSeq;
  const route = parseRoute();
  const key = `${route.name}/${route.a}/${route.b}`;
  if (key !== ui.routeKey) {
    ui.routeKey = key;
    ui.activeKey = null;
    ui.activeWordId = null;
    ui.questionPhase = "ask";
    ui.speakNote = "";
    ui.reviewIndex = 0;
    ui.reviewKeys = null;
    ui.transferNote = "";
    if (window.speechSynthesis) {
      speakToken += 1;
      window.speechSynthesis.cancel();
    }
  }
  document.title = screenTitle(route);
  const app = document.querySelector("#app");
  if (!app) return;

  if (route.name === "home" || route.name === "") {
    app.replaceChildren(homeScreen());
    return;
  }
  if (route.name === "library") {
    const loaded = await loadCatalog();
    if (seq !== renderSeq) return;
    app.replaceChildren(libraryScreen(loaded.articles, loaded.error));
    return;
  }
  if (route.name === "read" || route.name === "questions" || route.name === "words") {
    const article = await loadArticle(route.a);
    if (seq !== renderSeq) return;
    if (!article) {
      app.replaceChildren(messageScreen(screenTitle(route), "文章を読めませんでした。"));
      return;
    }
    const last = remember(article);
    if (route.name === "read") app.replaceChildren(readScreen(article));
    if (route.name === "questions") app.replaceChildren(questionsScreen(article, last));
    if (route.name === "words") app.replaceChildren(wordsScreen(article, last));
    return;
  }
  if (route.name === "cards") {
    if (route.a === "review") app.replaceChildren(reviewScreen());
    else app.replaceChildren(cardsScreen(route.a === "all" ? "all" : "today"));
    return;
  }
  if (route.name === "settings") {
    app.replaceChildren(settingsScreen());
    return;
  }
  app.replaceChildren(homeScreen());
}

window.addEventListener("hashchange", () => render());
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  state = loadState();
  render();
});
render();
