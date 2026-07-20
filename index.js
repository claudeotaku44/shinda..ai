//@ts-nocheck
const ASSISTANT_NAME = "Shinda-ai";
    
    const FREE_MODELS = [
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemma-4-31b-it:free",
      "openai/gpt-oss-20b:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "qwen/qwen3-coder:free",
      "openai/gpt-oss-120b:free",
      "openrouter/free" 
    ];

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
        processing: "Processing..."
      },
      fr: { 
        listening: "👂 Je vous écoute...", 
        idle: "🎤 Commencer",
        ready: "Prêt",
        processing: "Traitement..."
      }
    };

    const textDisplay = document.getElementById("textToConvert");
    const micBtn = document.getElementById("micBtn");
    const stopBtn = document.getElementById("stopBtn");
    const errorPara = document.getElementById("chatError");
    const settingsError = document.getElementById("settingsError");
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");

    const speechSynth = window.speechSynthesis || null;
    let recognition = null;
    const conversationHistory = [];
    let revealIntervalId = null;
    let currentLang = "en";
    let availableVoices = [];
    let thinkingLoaderEl = null;
    let isSpeaking = false;

    const STORAGE_KEYS = {
      API_KEYS: "shindaai_api_keys",
      ACTIVE_KEY_INDEX: "shindaai_active_key_index",
      THEME_COLOR: "shindaai_theme_color"
    };

    let apiKeys = [];
    let activeKeyIndex = 0;

    // --- UI EVENT LISTENERS ---
    
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

    document.getElementById('addKeyBtn')?.addEventListener('click', () => {
      const input = document.getElementById('newApiKey');
      const val = input.value.trim();
      if (val && !apiKeys.includes(val)) {
        apiKeys.push(val);
        activeKeyIndex = apiKeys.length - 1;
        OPENROUTER_API_KEY = val;
        saveKeysToStorage();
        renderKeysList();
        input.value = '';
      }
    });

    document.getElementById('themePicker')?.addEventListener('input', (e) => {
      applyThemeColor(e.target.value, true);
    });

    document.getElementById('resetThemeBtn')?.addEventListener('click', () => {
      applyThemeColor('reset', true);
      document.getElementById('themePicker').value = '#f4244c';
    });

    function renderKeysList() {
      const list = document.getElementById('keysList');
      if (!list) return;
      list.innerHTML = '';
      apiKeys.forEach((key, index) => {
        const item = document.createElement('div');
        item.className = `key-item ${index === activeKeyIndex ? 'active' : ''}`;
        item.innerHTML = `
          <div class="key-info">
            <span class="key-text">${key.substring(0, 8)}...</span>
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
      activeKeyIndex = index;
      OPENROUTER_API_KEY = apiKeys[index];
      saveKeysToStorage();
      renderKeysList();
    };

    window.deleteKey = function(index) {
      apiKeys.splice(index, 1);
      if (activeKeyIndex >= apiKeys.length) activeKeyIndex = Math.max(0, apiKeys.length - 1);
      if (apiKeys.length > 0) OPENROUTER_API_KEY = apiKeys[activeKeyIndex];
      else OPENROUTER_API_KEY = "";
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

    function showError(msg, scope = "chat") {
      console.error(msg);
      const target = scope === "chat" ? errorPara : settingsError;
      if (target) target.textContent = msg;
      setStatus("error");
    }

    function clearErrors() {
      if (errorPara) errorPara.textContent = "";
      if (settingsError) settingsError.textContent = "";
      setStatus("ready");
    }

    function setStatus(state, customText) {
      if (statusDot && statusText) {
        const strings = UI_STRINGS[currentLang];
        statusDot.className = "status-dot" + (state === "error" ? " error" : "");
        statusText.textContent = customText || strings[state] || strings.ready;
      }
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

    function refreshVoices() {
      availableVoices = speechSynth?.getVoices() || [];
    }

    if (speechSynth) {
      refreshVoices();
      speechSynth.onvoiceschanged = refreshVoices;
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

    function showThinking() {
      const el = ensureThinkingLoader();
      el.style.display = "flex";
      if (textDisplay) textDisplay.classList.add("is-thinking");
      setStatus("processing");
    }

    function hideThinking() {
      if (!thinkingLoaderEl) return;
      thinkingLoaderEl.style.display = "none";
      if (textDisplay) textDisplay.classList.remove("is-thinking");
    }

    const THEME_DIRECTIVE_RE = /\[\[\s*THEME\s*:\s*([^\]]+?)\s*\]\]/i;
    const SPEED_DIRECTIVE_RE = /\[\[\s*SPEED\s*:\s*(slow|normal|fast)\s*\]\]/i;

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

    function splitIntoParagraphs(text) {
      let paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      if (paragraphs.length <= 1) {
        const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
        if (sentences.length > 3) {
          paragraphs = [];
          for (let i = 0; i < sentences.length; i += 2) {
            paragraphs.push(sentences.slice(i, i + 2).join("").trim());
          }
        } else {
          paragraphs = [text.trim()];
        }
      }
      return paragraphs;
    }

    try {
      const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
      if (SR) {
        recognition = new SR();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = currentLang === "fr" ? "fr-FR" : "en-US";

        recognition.onstart = () => {
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
          resetMicButton();
        };
      } else {
        showError("Speech Recognition not supported. Try Google Chrome.");
      }
    } catch (e) {
      showError(`Initialization error: ${e.message}`);
    }

    function resetMicButton() {
      if (!micBtn) return;
      micBtn.textContent = UI_STRINGS[currentLang].idle;
      micBtn.classList.remove('listening');
    }

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
        stopEverything();
        try { recognition.start(); } catch (e) { try { recognition.stop(); } catch {} }
      } catch (e) {
        showError(`Mic error: ${e.message}`);
      }
    });

    function stopEverything() {
      if (speechSynth) speechSynth.cancel();
      hideThinking();
      clearInterval(revealIntervalId);
      revealIntervalId = null;
      isSpeaking = false;
      if (stopBtn) stopBtn.style.display = "none";
      resetMicButton();
    }

    stopBtn?.addEventListener('click', () => {
      try { stopEverything(); } catch (e) { showError(`Stop error: ${e.message}`); }
    });

    async function callModel(model, messages, apiKey) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.href || "http://localhost",
            "X-Title": "Voice AI Assistant"
          },
          body: JSON.stringify({ model, messages }),
          signal: controller.signal
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          const err = new Error(`Model ${model} error: ${response.status}`);
          err.status = response.status;
          if (response.status === 429) {
            const headerRetry = Number(response.headers.get("Retry-After"));
            let bodyRetry;
            try { bodyRetry = JSON.parse(errorText)?.error?.metadata?.retry_after_seconds; } catch {}
            err.retryAfterSeconds = headerRetry || bodyRetry || 5;
          }
          throw err;
        }
        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content;
        if (!reply) throw new Error("No content in response.");
        return reply;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    async function fetchAIResponse(userText) {
      if (!OPENROUTER_API_KEY) {
        showError("Missing API key.");
        return;
      }
      const originalHistoryLength = conversationHistory.length;
      conversationHistory.push({ role: "user", content: userText });
      trimHistory();
      const languageName = currentLang === "fr" ? "French" : "English";
      
      const systemMessage = {
        role: "system",
        content: `You are ${ASSISTANT_NAME}, a helpful, obedient voice assistant. ALWAYS follow user instructions precisely. Answer every question directly. Keep responses conversational and short for speech (no markdown, no bullet points). Separate paragraphs with blank lines. Language: Reply entirely in ${languageName}. Theme changes: If user asks to change color, start with [[THEME: <color>]] then confirm. Speed changes: If user asks to speak slower or faster, start with [[SPEED: slow]], [[SPEED: fast]], or [[SPEED: normal]].`
      };
      
      const messages = [systemMessage, ...conversationHistory];
      setDisplay("");
      showThinking();
      let lastError = null;
      let successfulResponse = false;
      const keyCandidates = [apiKeys[activeKeyIndex], ...apiKeys.filter((_, idx) => idx !== activeKeyIndex)].filter(Boolean);
      if (keyCandidates.length === 0 && OPENROUTER_API_KEY) keyCandidates.push(OPENROUTER_API_KEY);
      
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (successfulResponse) break;
        let shortestRetryMs = null;
        for (const currentApiKey of keyCandidates) {
          if (successfulResponse) break;
          for (const model of FREE_MODELS) {
            try {
              const rawReply = await callModel(model, messages, currentApiKey);
              conversationHistory.push({ role: "assistant", content: rawReply });
              trimHistory();
              
              const cleanReply = extractAndApplySpeed(extractAndApplyTheme(rawReply));
              
              hideThinking();
              await speakAndReveal(cleanReply);
              successfulResponse = true;
              break;
            } catch (e) {
              lastError = e;
              if (e.status === 429) {
                const waitMs = Math.min(e.retryAfterSeconds * 1000, MAX_BACKOFF_MS);
                if (shortestRetryMs === null || waitMs < shortestRetryMs) shortestRetryMs = waitMs;
              }
            }
          }
        }
        if (!successfulResponse && shortestRetryMs) await sleep(shortestRetryMs);
        else if (!successfulResponse) break;
      }
      
      if (!successfulResponse) {
        conversationHistory.length = originalHistoryLength;
        hideThinking();
        showError(`Connection failed: ${lastError?.message || "Unknown error"}`);
      }
    }

    function trimHistory() {
      while (conversationHistory.length > MAX_HISTORY_MESSAGES) conversationHistory.shift();
    }

    async function speakAndReveal(fullText) {
      const paragraphs = splitIntoParagraphs(fullText);
      try {
        if (!speechSynth) {
          startTypewriterReveal(paragraphs);
          return;
        }
        if (speechSynth.speaking) speechSynth.cancel();
        
        const utterance = new SpeechSynthesisUtterance(fullText);
        const ttsLang = currentLang === "fr" ? "fr-FR" : "en-US";
        utterance.lang = ttsLang;
        utterance.rate = currentSpeechRate; 
        
        const matchingVoice = pickVoiceForLang(ttsLang);
        if (matchingVoice) utterance.voice = matchingVoice;
        isSpeaking = true;
        
        if (stopBtn) stopBtn.style.display = "block";
        
        utterance.onstart = () => {
          startTypewriterReveal(paragraphs);
        };
        
        utterance.onend = () => {
          isSpeaking = false;
          if (stopBtn) stopBtn.style.display = "none";
        };
        
        utterance.onerror = (e) => {
          isSpeaking = false;
          if (stopBtn) stopBtn.style.display = "none";
        };
        
        speechSynth.speak(utterance);
      } catch (e) {
        startTypewriterReveal(paragraphs);
      }
    }

    function startTypewriterReveal(paragraphs) {
      clearInterval(revealIntervalId);
      let paraIndex = 0;
      let wordIndex = 0;
      let currentWords = paragraphs[0]?.split(/\s+/).filter(Boolean) || [];
      let accumulatedText = "";

      setDisplayWithFade(CURSOR_CHAR);

      revealIntervalId = setInterval(() => {
        if (!paragraphs[paraIndex]) {
          clearInterval(revealIntervalId);
          setDisplay(accumulatedText); 
          return;
        }

        wordIndex++;
        const currentParaPartial = currentWords.slice(0, wordIndex).join(" ");
        const fullDisplay = accumulatedText + (accumulatedText ? "\n\n" : "") + currentParaPartial;
        
        const isFinal = paraIndex === paragraphs.length - 1 && wordIndex >= currentWords.length;
        setDisplay(isFinal ? fullDisplay : `${fullDisplay} ${CURSOR_CHAR}`);

        if (wordIndex >= currentWords.length) {
          accumulatedText += (accumulatedText ? "\n\n" : "") + currentWords.join(" ");
          paraIndex++;
          if (paragraphs[paraIndex]) {
            currentWords = paragraphs[paraIndex].split(/\s+/).filter(Boolean);
            wordIndex = 0;
          } else {
            clearInterval(revealIntervalId);
            setDisplay(accumulatedText);
          }
        }
      }, TYPEWRITER_MS_PER_WORD);
    }

    // Initialize application storage
    initStorage();
    renderKeysList();
