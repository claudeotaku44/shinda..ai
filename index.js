//@ts-nocheck
const ASSISTANT_NAME = "Shinda-ai";


// --- UPDATED MODEL CONFIGURATION (2026 Active Free Lineup) ---
const FREE_MODELS = [
  "openrouter/free",
  "meta-llama/llama-3.3-70b-instruct",
  "google/gemma-2-9b-it",
  "qwen/qwen-2.5-72b-instruct"
];


const DEBATE_MODEL_A = "meta-llama/llama-3.3-70b-instruct";
const DEBATE_MODEL_B = "google/gemma-2-9b-it";
const JUDGE_MODEL = "openrouter/free";


const REQUEST_TIMEOUT_MS = 20000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_ROUNDS = 2;
const MAX_BACKOFF_MS = 6000;
let TYPEWRITER_MS_PER_WORD = 40;
let currentSpeechRate = 1.0;
const CURSOR_CHAR = "▋";


const UI_STRINGS = {
  en: {
    listening: "👂 Listening...",
    idle: "🎤 Start Listening",
    ready: "Ready",
    processing: "Processing...",
    debating: "🤔 AIs debating..."
  },
  fr: {
    listening: "👂 Je vous écoute...",
    idle: "🎤 Commencer",
    ready: "Prêt",
    processing: "Traitement...",
    debating: "🤔 Les IA débattent..."
  }
};


// DOM Elements
const textDisplay = document.getElementById("textToConvert");
const micBtn = document.getElementById("micBtn");
const stopBtn = document.getElementById("stopBtn");
const errorPara = document.getElementById("chatError");
const settingsError = document.getElementById("settingsError");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");


// Speech APIs
const speechSynth = window.speechSynthesis || null;
let recognition = null;


// State
const conversationHistory = [];
let revealIntervalId = null;
let currentLang = "en";
let availableVoices = [];
let thinkingLoaderEl = null;
let isSpeaking = false;
let isFirstMessage = true;
let isRecognitionActive = false;


// Storage
const STORAGE_KEYS = {
  API_KEYS: "shindaai_api_keys",
  ACTIVE_KEY_INDEX: "shindaai_active_key_index",
  THEME_COLOR: "shindaai_theme_color"
};


let apiKeys = [];
let activeKeyIndex = 0;
let OPENROUTER_API_KEY = "";


// --- HELPER FUNCTIONS ---


function showError(msg, scope = "chat") {
  console.error(msg);
  const target = scope === "chat" ? errorPara : settingsError;
  if (target) target.textContent = msg;
  setStatus("error");
}


function setStatus(state, customText) {
  if (statusDot && statusText) {
    const strings = UI_STRINGS[currentLang];
    statusDot.className = "status-dot" + (state === "error" ? " error" : "");
    statusText.textContent = customText || strings[state] || strings.ready;
  }
}


function clearErrors() {
  if (errorPara) errorPara.textContent = "";
  if (settingsError) settingsError.textContent = "";
  setStatus("ready");
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function detectLanguage(text) {
  const frenchAccents = /[àâäéèêëîïôöùûüçœ]/i;
  const frenchWords = /\b(le|la|les|un|une|des|je|tu|il|elle|nous|vous|ils|elles|est|suis|es|sommes|êtes|sont|bonjour|salut|merci|s'il|pourquoi|comment|où|quand|avec|pour|dans|sur|mais|donc|très|voici|voilà|qu'est|quoi|combien)\b/i;
  return (frenchAccents.test(text) || frenchWords.test(text)) ? "fr" : "en";
}


function setLanguage(lang) {
  currentLang = lang === "fr" ? "fr" : "en";
  if (recognition) {
    recognition.lang = currentLang === "fr" ? "fr-FR" : "en-US";
  }
}


function resetMicButton() {
  if (!micBtn) return;
  micBtn.textContent = UI_STRINGS[currentLang].idle;
  micBtn.classList.remove('listening');
}


function stopEverything() {
  if (recognition && isRecognitionActive) {
    try { recognition.stop(); } catch {}
    isRecognitionActive = false;
  }
  if (speechSynth) speechSynth.cancel();
  hideThinking();
  clearInterval(revealIntervalId);
  revealIntervalId = null;
  isSpeaking = false;
  if (stopBtn) stopBtn.style.display = "none";
  resetMicButton();
}


function trimHistory() {
  while (conversationHistory.length > MAX_HISTORY_MESSAGES) conversationHistory.shift();
}


function setDisplay(text) {
  if (textDisplay) textDisplay.value = text;
}


function setDisplayWithFade(text) {
  if (!textDisplay) return;
  textDisplay.value = text;
  textDisplay.classList.remove("paragraph-enter");
  void textDisplay.offsetWidth;
  textDisplay.classList.add("paragraph-enter");
}


function refreshVoices() {
  availableVoices = speechSynth?.getVoices() || [];
}


function pickVoiceForLang(langTag) {
  if (!availableVoices.length) return null;
  return availableVoices.find(v => v.lang?.toLowerCase().startsWith(langTag.toLowerCase())) || availableVoices[0] || null;
}


function ensureThinkingLoader() {
  if (thinkingLoaderEl) return thinkingLoaderEl;
  const el = document.createElement("div");
  el.className = "thinking-loader";
  el.innerHTML = `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>`;
  el.style.display = "none";
  textDisplay?.insertAdjacentElement("afterend", el);
  thinkingLoaderEl = el;
  return el;
}


function showThinking(customText) {
  const el = ensureThinkingLoader();
  el.style.display = "flex";
  if (textDisplay) textDisplay.classList.add("is-thinking");
  setStatus(customText ? undefined : "processing", customText);
}


function hideThinking() {
  if (!thinkingLoaderEl) return;
  thinkingLoaderEl.style.display = "none";
  if (textDisplay) textDisplay.classList.remove("is-thinking");
}


// --- API KEY FUNCTIONS ---


function isOpenRouterKeyFormat(key) {
  return /^sk-or-[a-zA-Z0-9-_]+$/.test(key);
}


async function verifyOpenRouterKey(key) {
  if (!isOpenRouterKeyFormat(key)) {
    return { valid: false, reason: "Format invalide. Colle uniquement une clé OpenRouter (elle commence par sk-or-)." };
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      method: "GET",
      headers: { "Authorization": `Bearer ${key}` },
      signal: controller.signal
    });
    clearTimeout(timeoutId);


    if (response.status === 401) {
      return { valid: false, reason: "Clé refusée par OpenRouter (invalide ou expirée)." };
    }
    if (!response.ok) {
      return { valid: false, reason: `Impossible de vérifier la clé (erreur ${response.status}).` };
    }
    return { valid: true };
  } catch (e) {
    if (e.name === "AbortError") {
      return { valid: false, reason: "Vérification trop longue, réessaie." };
    }
    return { valid: false, reason: "Impossible de contacter OpenRouter pour vérifier la clé." };
  }
}


function renderKeysList() {
  const list = document.getElementById('keysList');
  if (!list) return;
  list.innerHTML = '';
  apiKeys.forEach((key, index) => {
    const item = document.createElement('div');
    item.className = `key-item ${index === activeKeyIndex ? 'active' : ''}`;
    item.innerHTML = `
      <div class="key-info">
        <span class="key-text">${key.substring(0, 10)}...</span>
      </div>
      <div class="key-actions">
        ${index !== activeKeyIndex ? `<button class="icon-btn" onclick="setActiveKey(${index})">✔️</button>` : ''}
        <button class="icon-btn delete" onclick="deleteKey(${index})">❌</button>
      </div>
    `;
    list.appendChild(item);
  });
}


window.setActiveKey = function(index) {
  if (!Number.isInteger(index) || !apiKeys[index]) return;
  activeKeyIndex = index;
  OPENROUTER_API_KEY = apiKeys[index];
  saveKeysToStorage();
  renderKeysList();
};


window.deleteKey = function(index) {
  if (!Number.isInteger(index) || !apiKeys[index]) return;
  apiKeys.splice(index, 1);
  if (index < activeKeyIndex) activeKeyIndex -= 1;
  if (activeKeyIndex >= apiKeys.length) activeKeyIndex = Math.max(0, apiKeys.length - 1);
  OPENROUTER_API_KEY = apiKeys[activeKeyIndex] || "";
  saveKeysToStorage();
  renderKeysList();
};


function initStorage() {
  try {
    const storedKeys = localStorage.getItem(STORAGE_KEYS.API_KEYS);
    apiKeys = storedKeys ? JSON.parse(storedKeys) : [];


    const storedIndex = localStorage.getItem(STORAGE_KEYS.ACTIVE_KEY_INDEX);
    activeKeyIndex = storedIndex ? parseInt(storedIndex, 10) : 0;
    if (activeKeyIndex >= apiKeys.length) activeKeyIndex = 0;


    const storedTheme = localStorage.getItem(STORAGE_KEYS.THEME_COLOR);
    if (storedTheme) {
      applyThemeColor(storedTheme, false);
      const themePicker = document.getElementById("themePicker");
      if (themePicker) themePicker.value = storedTheme;
    }


    if (apiKeys.length > 0) {
      OPENROUTER_API_KEY = apiKeys[activeKeyIndex];
    }
    
    console.log("🔑 API Key loaded:", OPENROUTER_API_KEY ? "Yes (starts with " + OPENROUTER_API_KEY.substring(0, 10) + "...)" : "No");
    console.log("📦 Available keys:", apiKeys.length);
    
  } catch (e) {
    console.error("Storage init failed:", e);
  }
}


function saveKeysToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.API_KEYS, JSON.stringify(apiKeys));
    localStorage.setItem(STORAGE_KEYS.ACTIVE_KEY_INDEX, activeKeyIndex.toString());
  } catch (e) {
    showError("Failed to save settings.", "settings");
  }
}


// --- THEME FUNCTIONS ---


const THEME_DIRECTIVE_RE = /\[\[\s*THEME\s*:\s*([^\]]+?)\s*\]\]/i;
const SPEED_DIRECTIVE_RE = /\[\[\s*SPEED\s*:\s*(slow|normal|fast)\s*\]\]/i;
const OPEN_SITE_DIRECTIVE_RE = /\[\[\s*OPEN\s*:\s*([^\]]+?)\s*\]\]/i;
const SEARCH_LINK_DIRECTIVE_RE = /\[\[\s*SEARCHLINK\s*:\s*([^\]]+?)\s*\]\]/i;


function isValidCssColor(value) {
  const probe = new Option().style;
  probe.color = "";
  probe.color = value;
  return probe.color !== "";
}


function applyThemeColor(rawColor, persist = true) {
  const color = rawColor.trim().toLowerCase();
  if (color === "default" || color === "reset") {
    document.documentElement.style.removeProperty("--accent-1");
    document.documentElement.style.removeProperty("--accent-2");
    document.documentElement.style.removeProperty("--accent-glow");
    if (persist) localStorage.removeItem(STORAGE_KEYS.THEME_COLOR);
    return true;
  }
  if (!isValidCssColor(color)) return false;
  const root = document.documentElement;
  const supportsColorMix = CSS?.supports?.("color", "color-mix(in srgb, red 50%, blue)");
  if (supportsColorMix) {
    root.style.setProperty("--accent-1", `color-mix(in srgb, ${color} 75%, black)`);
    root.style.setProperty("--accent-2", color);
    root.style.setProperty("--accent-glow", color);
  } else {
    root.style.setProperty("--accent-1", color);
    root.style.setProperty("--accent-2", color);
    root.style.setProperty("--accent-glow", color);
  }
  if (persist) {
    try { localStorage.setItem(STORAGE_KEYS.THEME_COLOR, color); } catch (e) {}
  }
  return true;
}


function extractAndApplyTheme(reply) {
  const match = reply.match(THEME_DIRECTIVE_RE);
  if (!match) return reply;
  applyThemeColor(match[1], true);
  return reply.replace(THEME_DIRECTIVE_RE, "").trim();
}


function extractAndApplySpeed(reply) {
  const match = reply.match(SPEED_DIRECTIVE_RE);
  if (!match) return reply;


  const speedParam = match[1].toLowerCase();
  if (speedParam === 'slow') {
    currentSpeechRate = 0.6;
    TYPEWRITER_MS_PER_WORD = 100;
  } else if (speedParam === 'fast') {
    currentSpeechRate = 1.4;
    TYPEWRITER_MS_PER_WORD = 20;
  } else {
    currentSpeechRate = 1.0;
    TYPEWRITER_MS_PER_WORD = 40;
  }


  return reply.replace(SPEED_DIRECTIVE_RE, "").trim();
}


function normalizeUrl(raw) {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) {
    if (/^[\w-]+(\.[\w-]+)+/.test(url) && !/\s/.test(url)) {
      url = "https://" + url;
    } else {
      url = "https://www.google.com/search?q=" + encodeURIComponent(url);
    }
  }
  return url;
}


function extractAndOpenSite(reply) {
  const match = reply.match(OPEN_SITE_DIRECTIVE_RE);
  if (!match) return reply;
  const url = normalizeUrl(match[1]);
  window.open(url, "_blank", "noopener,noreferrer");
  return reply.replace(OPEN_SITE_DIRECTIVE_RE, "").trim();
}


function extractSearchLink(reply) {
  const match = reply.match(SEARCH_LINK_DIRECTIVE_RE);
  if (!match) return { text: reply, link: null };
  const query = match[1].trim();
  const cleanText = reply.replace(SEARCH_LINK_DIRECTIVE_RE, "").trim();
  return {
    text: cleanText,
    link: {
      label: query,
      url: "https://www.google.com/search?q=" + encodeURIComponent(query)
    }
  };
}


function renderClickableLink(link) {
  if (!link) return;
  let linkContainer = document.getElementById("aiSearchLink");
  if (!linkContainer) {
    linkContainer = document.createElement("div");
    linkContainer.id = "aiSearchLink";
    linkContainer.style.marginTop = "0.6rem";
    linkContainer.style.textAlign = "center";
    textDisplay?.insertAdjacentElement("afterend", linkContainer);
  }
  linkContainer.innerHTML = `<a href="${link.url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-2); text-decoration: underline; font-size: 0.9rem;">🔗 ${link.label}</a>`;
}


function clearClickableLink() {
  const linkContainer = document.getElementById("aiSearchLink");
  if (linkContainer) linkContainer.innerHTML = "";
}


function splitIntoParagraphs(text) {
  // Split on one or more blank lines
  let paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  // Fallback: if only 1 big block, split on sentences
  if (paragraphs.length <= 1) {
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g);
    if (sentences && sentences.length > 2) {
      paragraphs = [];
      for (let i = 0; i < sentences.length; i += 2) {
        const para = sentences.slice(i, i + 2).join(" ").trim();
        if (para) paragraphs.push(para);
      }
    } else {
      paragraphs = [text.trim()];
    }
  }

  return paragraphs;
}


// --- API CALLING FUNCTIONS (ENHANCED) ---


async function callModel(model, messages, apiKey) {
  if (!apiKey) {
    throw new Error("No API key provided");
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  
  try {
    console.log(`📡 Calling model: ${model}`);
    
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.href || "http://localhost",
        "X-Title": "Voice AI Assistant"
      },
      body: JSON.stringify({ 
        model, 
        messages,
        stream: false
      }),
      signal: controller.signal
    });
    
    console.log(`📊 Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details");
      console.error(`❌ API Error ${response.status}:`, errorText);
      
      const err = new Error(`Model ${model} error: ${response.status} - ${errorText}`);
      err.status = response.status;
      
      if (response.status === 401) {
        err.message = "Invalid or expired API key. Check your OpenRouter key in Settings.";
      } else if (response.status === 404) {
        err.message = `Model '${model}' not found or unavailable. Try another model.`;
      } else if (response.status === 429) {
        const headerRetry = Number(response.headers.get("Retry-After"));
        let bodyRetry;
        try { bodyRetry = JSON.parse(errorText)?.error?.metadata?.retry_after_seconds; } catch {}
        err.retryAfterSeconds = headerRetry || bodyRetry || 5;
        err.message = "Rate limit exceeded. Waiting before retry...";
      }
      throw err;
    }
    
    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    
    if (!reply) {
      console.warn("⚠️ No content in response:", data);
      throw new Error("No content in response.");
    }
    
    console.log(`✅ Got response from ${model}`);
    return reply;
    
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`Request timeout for model ${model}`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}


async function callModelWithFallback(messages, keyCandidates) {
  let lastError = null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let shortestRetryMs = null;
    for (const currentApiKey of keyCandidates) {
      for (const model of FREE_MODELS) {
        try {
          const reply = await callModel(model, messages, currentApiKey);
          return reply;
        } catch (e) {
          lastError = e;
          if (e.status === 429) {
            const waitMs = Math.min(e.retryAfterSeconds * 1000, MAX_BACKOFF_MS);
            if (shortestRetryMs === null || waitMs < shortestRetryMs) shortestRetryMs = waitMs;
          }
        }
      }
    }
    if (shortestRetryMs) await sleep(shortestRetryMs);
    else break;
  }
  throw lastError || new Error("All models failed.");
}


function buildSystemMessage(languageName) {
  return {
    role: "system",
    content: `You are ${ASSISTANT_NAME}, a helpful, obedient voice assistant. ALWAYS follow user instructions precisely. Answer every question directly. Keep responses conversational and short for speech (no markdown, no bullet points). Separate paragraphs with blank lines. Language: Reply entirely in ${languageName}. Theme changes: If user asks to change color, start with [[THEME: <color>]] then confirm. Speed changes: If user asks to speak slower or faster, start with [[SPEED: slow]], [[SPEED: fast]], or [[SPEED: normal]]. Opening a website: If the user explicitly asks to open a website or app (e.g. "open youtube"), include [[OPEN: <domain or url>]] anywhere in your reply. Research requests: If the user asks you to research/look up/find information on a topic, include [[SEARCHLINK: <search query>]] anywhere in your reply, and tell them you've added a link they can click.`
  };
}


async function runDebateAndGetBestReply(userText, languageName, keyCandidates) {
  const systemMessage = buildSystemMessage(languageName);
  const messages = [systemMessage, { role: "user", content: userText }];


  showThinking(UI_STRINGS[currentLang].debating);


  const [replyA, replyB] = await Promise.allSettled([
    callModel(DEBATE_MODEL_A, messages, keyCandidates[0]),
    callModel(DEBATE_MODEL_B, messages, keyCandidates[0])
  ]);


  const candidateA = replyA.status === "fulfilled" ? replyA.value : null;
  const candidateB = replyB.status === "fulfilled" ? replyB.value : null;


  if (candidateA && !candidateB) return candidateA;
  if (candidateB && !candidateA) return candidateB;
  if (!candidateA && !candidateB) throw new Error("Both debating models failed.");


  const judgeMessages = [
    {
      role: "system",
      content: `You are a judge. Two AI assistants answered the same user question in ${languageName}. Pick the single better answer, or merge them into one improved answer if that's clearly better. Reply ONLY with the final chosen answer text, in ${languageName}, following the same style rules: conversational, no markdown, short for speech, paragraphs separated by blank lines. Do not mention that this was a comparison or that there were two answers.`
    },
    {
      role: "user",
      content: `User question: ${userText}\n\nAnswer A:\n${candidateA}\n\nAnswer B:\n${candidateB}`
    }
  ];


  try {
    const judged = await callModel(JUDGE_MODEL, judgeMessages, keyCandidates[0]);
    return judged;
  } catch (e) {
    console.error("Judge model failed, using candidate A:", e.message);
    return candidateA || candidateB;
  }
}


async function fetchAIResponse(userText) {
  if (!OPENROUTER_API_KEY) {
    showError("Missing API key. Add your OpenRouter key in Settings.");
    return;
  }
  const originalHistoryLength = conversationHistory.length;
  conversationHistory.push({ role: "user", content: userText });
  trimHistory();
  const languageName = currentLang === "fr" ? "French" : "English";


  setDisplay("");
  clearClickableLink();
  const keyCandidates = [apiKeys[activeKeyIndex], ...apiKeys.filter((_, idx) => idx !== activeKeyIndex)].filter(Boolean);
  if (keyCandidates.length === 0 && OPENROUTER_API_KEY) keyCandidates.push(OPENROUTER_API_KEY);


  const useDebate = isFirstMessage;
  isFirstMessage = false;


  showThinking(useDebate ? UI_STRINGS[currentLang].debating : undefined);


  try {
    let rawReply;
    if (useDebate) {
      rawReply = await runDebateAndGetBestReply(userText, languageName, keyCandidates);
    } else {
      const systemMessage = buildSystemMessage(languageName);
      const messages = [systemMessage, ...conversationHistory];
      rawReply = await callModelWithFallback(messages, keyCandidates);
    }


    conversationHistory.push({ role: "assistant", content: rawReply });
    trimHistory();


    let cleanReply = extractAndApplySpeed(extractAndApplyTheme(rawReply));
    cleanReply = extractAndOpenSite(cleanReply);
    const { text: finalText, link } = extractSearchLink(cleanReply);


    hideThinking();
    renderClickableLink(link);
    await speakAndReveal(finalText);
  } catch (e) {
    conversationHistory.length = originalHistoryLength;
    hideThinking();
    console.error("Fetch AI response error:", e);
    showError(`Connection failed: ${e?.message || "Unknown error"}`);
  }
}


// --- NEW: Paragraph-by-paragraph, word-by-word reveal ---


async function speakAndReveal(fullText) {
  const paragraphs = splitIntoParagraphs(fullText);

  if (!paragraphs.length) {
    setDisplay("");
    return;
  }

  // If TTS not available, just typewriter everything
  if (!speechSynth) {
    await runTypewriterParagraphs(paragraphs);
    return;
  }

  // Cancel any ongoing speech
  if (speechSynth.speaking) speechSynth.cancel();

  const ttsLang = currentLang === "fr" ? "fr-FR" : "en-US";
  const utterance = new SpeechSynthesisUtterance(fullText);
  utterance.lang = ttsLang;
  utterance.rate = currentSpeechRate;

  const matchingVoice = pickVoiceForLang(ttsLang);
  if (matchingVoice) utterance.voice = matchingVoice;

  isSpeaking = true;
  if (stopBtn) stopBtn.style.display = "block";

  // We'll manage showing paragraphs ourselves; TTS just reads full text
  utterance.onstart = async () => {
    await runTypewriterParagraphs(paragraphs);
  };

  utterance.onend = () => {
    isSpeaking = false;
    if (stopBtn) stopBtn.style.display = "none";
  };

  utterance.onerror = () => {
    isSpeaking = false;
    if (stopBtn) stopBtn.style.display = "none";
  };

  speechSynth.speak(utterance);
}


async function runTypewriterParagraphs(paragraphs) {
  clearInterval(revealIntervalId);
  revealIntervalId = null;

  for (let i = 0; i < paragraphs.length; i++) {
    // Clear previous paragraph before starting the new one
    setDisplay("");

    // Animate this paragraph word-by-word
    await typewriterParagraph(paragraphs[i]);

    // Optional small pause between paragraphs
    await sleep(250);
  }
}


function typewriterParagraph(paragraphText) {
  return new Promise((resolve) => {
    clearInterval(revealIntervalId);

    const words = paragraphText.split(/\s+/).filter(Boolean);
    if (!words.length) {
      resolve();
      return;
    }

    let wordIndex = 0;
    let displayed = "";

    // Start with cursor
    setDisplay(CURSOR_CHAR);

    revealIntervalId = setInterval(() => {
      if (wordIndex >= words.length) {
        clearInterval(revealIntervalId);
        revealIntervalId = null;
        // Final clean paragraph (no cursor)
        setDisplay(displayed);
        resolve();
        return;
      }

      const word = words[wordIndex];
      displayed = (displayed ? displayed + " " : "") + word;
      wordIndex++;

      // Show current paragraph with cursor
      setDisplay(displayed + " " + CURSOR_CHAR);
    }, TYPEWRITER_MS_PER_WORD);
  });
}


// --- INITIALIZATION ---


// Initialize speech recognition
try {
  const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
  if (SR) {
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = currentLang === "fr" ? "fr-FR" : "en-US";


    recognition.onstart = () => {
      isRecognitionActive = true;
      clearErrors();
      if (micBtn) {
        micBtn.textContent = UI_STRINGS[currentLang].listening;
        micBtn.classList.add('listening');
      }
    };


    recognition.onerror = (event) => {
      const errorCode = event?.error || "unknown";
      let errorMsg = "Speech recognition issue. ";
      if (errorCode === "no-speech") errorMsg += "No speech detected. Try again.";
      else if (errorCode === "audio-capture") errorMsg += "Microphone access issue.";
      else if (errorCode === "not-allowed") errorMsg += "Microphone permission denied.";
      else errorMsg += `Error: ${errorCode}`;
      showError(errorMsg);
      resetMicButton();
    };


    recognition.onresult = async (event) => {
      try {
        const userTranscript = event?.results?.[0]?.[0]?.transcript;
        if (!userTranscript || userTranscript.trim() === "") {
          showError("Could not capture speech. Please try again.");
          resetMicButton();
          return;
        }
        setLanguage(detectLanguage(userTranscript));
        resetMicButton();
        await fetchAIResponse(userTranscript);
      } catch (e) {
        showError(`Error: ${e.message}`);
        resetMicButton();
      }
    };


    recognition.onend = () => {
      isRecognitionActive = false;
      resetMicButton();
    };
  } else {
    showError("Speech Recognition not supported. Try Google Chrome.");
  }
} catch (e) {
  showError(`Initialization error: ${e.message}`);
}


// Initialize voices
if (speechSynth) {
  refreshVoices();
  speechSynth.onvoiceschanged = refreshVoices;
}


// Initialize storage and UI
initStorage();
renderKeysList();


// Event listeners for tabs
document.getElementById('tabChatBtn')?.addEventListener('click', (e) => {
  e.target.classList.add('active');
  document.getElementById('tabSettingsBtn').classList.remove('active');
  document.getElementById('chatScreen').classList.add('active');
  document.getElementById('settingsScreen').classList.remove('active');
});


document.getElementById('tabSettingsBtn')?.addEventListener('click', (e) => {
  e.target.classList.add('active');
  document.getElementById('tabChatBtn').classList.remove('active');
  document.getElementById('settingsScreen').classList.add('active');
  document.getElementById('chatScreen').classList.remove('active');
  renderKeysList();
});


// Add API key button
document.getElementById('addKeyBtn')?.addEventListener('click', async () => {
  const input = document.getElementById('newApiKey');
  const val = input.value.trim();
  if (!val) return;
  if (apiKeys.includes(val)) {
    showError("Cette clé existe déjà.", "settings");
    return;
  }


  const addBtn = document.getElementById('addKeyBtn');
  const originalText = addBtn.textContent;
  addBtn.textContent = "Vérification...";
  addBtn.disabled = true;


  const verifyResult = await verifyOpenRouterKey(val);


  addBtn.textContent = originalText;
  addBtn.disabled = false;


  if (!verifyResult.valid) {
    showError(verifyResult.reason, "settings");
    return;
  }


  apiKeys.push(val);
  activeKeyIndex = apiKeys.length - 1;
  OPENROUTER_API_KEY = val;
  saveKeysToStorage();
  renderKeysList();
  input.value = '';
  settingsError.textContent = "";
});


// Theme picker
document.getElementById('themePicker')?.addEventListener('input', (e) => {
  applyThemeColor(e.target.value, true);
});


document.getElementById('resetThemeBtn')?.addEventListener('click', () => {
  applyThemeColor('reset', true);
  const themePicker = document.getElementById('themePicker');
  if (themePicker) themePicker.value = '#f4244c';
});


// Microphone button
micBtn?.addEventListener('click', async () => {
  try {
    if (!OPENROUTER_API_KEY) {
      showError("Add your OpenRouter API key in Settings.");
      return;
    }
    if (!recognition) {
      showError("Speech recognition not supported.");
      return;
    }
    if (!navigator.onLine) {
      showError("You appear to be offline.");
      return;
    }
    if (isRecognitionActive) {
      stopEverything();
      return;
    }
    clearErrors();
    try {
      recognition.start();
    } catch (e) {
      isRecognitionActive = false;
      showError(`Mic error: ${e.message}`);
      resetMicButton();
    }
  } catch (e) {
    showError(`Mic error: ${e.message}`);
  }
});


// Stop button
stopBtn?.addEventListener('click', () => {
  try { stopEverything(); } catch (e) { showError(`Stop error: ${e.message}`); }
});
