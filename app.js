const LEVELS = {
  1: "易しい",
  2: "ふつう",
  3: "難しい",
};

const LANGUAGES = {
  en: "英語",
  fr: "フランス語",
};

const ARTICLE_ID = /^[a-z]{2}-\d{8}-[a-z0-9]+$/;

function articlePath(id) {
  return `content/articles/${encodeURIComponent(id)}.json`;
}

function renderCatalog(articles) {
  const list = document.querySelector("#catalog");
  list.replaceChildren();
  for (const article of articles) {
    const item = document.createElement("li");
    const title = document.createElement(ARTICLE_ID.test(article.id) ? "a" : "span");
    if (title instanceof HTMLAnchorElement) {
      title.href = articlePath(article.id);
    }
    title.textContent = article.title || article.id;

    const meta = document.createElement("p");
    meta.className = "meta";
    const bits = [
      LANGUAGES[article.language] || article.language,
      LEVELS[article.level] || String(article.level),
    ];
    if (article.topic) bits.push(article.topic);
    meta.textContent = bits.filter(Boolean).join(" · ");

    item.append(title, meta);
    list.append(item);
  }
}

async function loadCatalog() {
  const status = document.querySelector("#status");
  try {
    const response = await fetch("content/index.json");
    if (!response.ok) throw new Error(String(response.status));
    const catalog = await response.json();
    const articles = Array.isArray(catalog.articles) ? catalog.articles : [];
    if (articles.length === 0) {
      status.textContent = "目録は空です。";
      return;
    }
    status.textContent = "";
    renderCatalog(articles);
  } catch {
    status.textContent = "目録を読めませんでした。";
  }
}

loadCatalog();
