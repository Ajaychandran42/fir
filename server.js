require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Groq } = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==========================================================================
// 1. LOAD ALL DATASETS (INCLUDING NEW RULES & TFCs)
// ==========================================================================
let tneaData = [];
let collegeDetails = [];
let trendData = null;
let collegeCodesMap = [];
let tneaRules = [];
let tneaTFC = [];

try {
  tneaData = JSON.parse(fs.readFileSync(path.join(__dirname, 'tnea_data.json'), 'utf8'));
  collegeDetails = JSON.parse(fs.readFileSync(path.join(__dirname, 'colleges.json'), 'utf8'));
  console.log(`✅ Loaded Cutoffs & Colleges databases.`);
} catch (err) { console.error("❌ Error loading primary databases"); }

try { trendData = JSON.parse(fs.readFileSync(path.join(__dirname, 'tnea_5yrs.json'), 'utf8')); } catch (err) {}
try { collegeCodesMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'college_codes.json'), 'utf8')); } catch (err) {}

// Load New PDF Extracted Knowledge Bases
try {
  tneaRules = JSON.parse(fs.readFileSync(path.join(__dirname, 'tnea_rules.json'), 'utf8'));
  tneaTFC = JSON.parse(fs.readFileSync(path.join(__dirname, 'tnea_tfc.json'), 'utf8'));
  console.log(`✅ Loaded TNEA Rules & TFC Centers Knowledge Base.`);
} catch (err) { console.error("ℹ️ Rules or TFC JSON files missing. Skipping document RAG."); }

// ==========================================================================
// 2. SYSTEM PROMPT
// ==========================================================================
const TNEA_SYSTEM_PROMPT = `
You are the official Tamil Nadu Engineering Admissions (TNEA) 2026 Counseling Assistant.

--- REASONING INSTRUCTIONS ---
1. You MUST place all internal thinking inside <think> and </think> tags.
2. Output ONLY the final aesthetic response after the closing </think> tag.

--- 0. STRICT DOMAIN RESTRICTIONS ---
You ONLY answer queries about TNEA, Tamil Nadu engineering colleges, cutoffs, rules, and admissions.
If a user asks anything else, you MUST REFUSE immediately.

--- 1. RULEBOOK & TFC ANSWERING DIRECTIVE ---
- If the user asks about TNEA rules (e.g., sports quota, fees, nativity, eligibility), you MUST use the [OFFICIAL RULEBOOK CONTEXT] provided below to answer.
- If the user asks for a Facilitation Center (TFC), use the [TFC CENTERS CONTEXT] provided below. Provide the Center Name and Phone Number.
- If the required information is NOT in the context, do not guess. Simply state that you do not have the specific official rule for that query.

--- 2. STRICT ANTI-HALLUCINATION (COLLEGES) ---
- NEVER guess college codes, autonomous statuses, or districts.
- You MUST ONLY extract college details from the [COLLEGE DETAILS CONTEXT].

--- 3. TABLE FORMATTING ---
When predicting colleges, output a Markdown table: | Code | College Name | Branch | Cutoff / Rank | Chance |
`;

// ==========================================================================
// 3. FAST MAPPING & MULTI-RAG LOGIC
// ==========================================================================
const OFF_TOPIC_TRIGGERS = [
  /\b(dhoni|kohli|ipl|cricket|football|messi|ronaldo)\b/i,
  /\b(movie|actor|actress|cinema|song|lyrics|weather|recipe)\b/i,
  /\b(python|javascript|java|c\+\+|write code|debug)\b/i,
  /\b(president|prime minister|politics|capital of)\b/i
];

function isOffTopic(text) { return OFF_TOPIC_TRIGGERS.some(regex => regex.test(text)); }

const branchKeywords = {
  "cs": ["computer science", "cse", "cs"], "it": ["information technology", "it"],
  "ad": ["artificial intelligence", "ai", "data science"], "ec": ["electronics and communication", "ece"],
  "ee": ["electrical", "eee"], "me": ["mechanical", "mech"], "ce": ["civil"]
};

function extractPreferences(text) {
  const lower = text.toLowerCase();
  let branches = Object.keys(branchKeywords).filter(key => branchKeywords[key].some(kw => lower.includes(kw)));
  return { branches };
}

function findCollegeDetails(query) {
  const q = query.toLowerCase();
  let matchedCodes = new Set();
  let matches = [];

  const rawCodes = q.match(/\b\d{1,4}\b/g);
  if (rawCodes) rawCodes.forEach(c => matchedCodes.add(parseInt(c, 10)));

  if (collegeCodesMap.length > 0) {
    const searchPhrase = q.replace(/\b(college|of|engineering|technology|institute|code|what|is|the|for|details|about|tell|me|show)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (searchPhrase.length > 2) {
      for (const item of collegeCodesMap) {
        const dbName = item.college_name.toLowerCase();
        if (dbName.includes(searchPhrase) || searchPhrase.includes(dbName)) matchedCodes.add(item.college_code);
      }
    }
  }

  matchedCodes.forEach(code => {
    const exact = collegeDetails.find(col => parseInt(col.college_code, 10) === code);
    if (exact && matches.length < 3) matches.push(exact);
  });
  return { data: matches.length > 0 ? matches : null };
}

// 🆕 PDF RULES SEARCH ENGINE
function findRules(query) {
  const q = query.toLowerCase();
  let matchedRules = [];
  for (const rule of tneaRules) {
    if (rule.keywords.some(kw => q.includes(kw))) matchedRules.push(rule.content);
  }
  return matchedRules;
}

// 🆕 TFC CENTER SEARCH ENGINE
function findTFC(query) {
  const q = query.toLowerCase();
  let matchedTFC = [];
  if (q.includes("tfc") || q.includes("facilitation") || q.includes("center") || q.includes("centre") || q.includes("contact")) {
    for (const tfc of tneaTFC) {
      if (q.includes(tfc.district)) matchedTFC.push(tfc);
    }
  }
  return matchedTFC;
}

function getPredictions(metric, type, category, prefs) {
  const validCategory = category.toUpperCase();
  let matched = [];
  
  for (const item of tneaData) {
    const value = type === 'cutoff' ? (item.cutoffs && item.cutoffs[validCategory]) : (item.ranks && item.ranks[validCategory]);
    if (!value) continue;

    const branchName = item.branch_name ? item.branch_name.toLowerCase() : (item.branch || "").toLowerCase();
    if (prefs.branches.length > 0 && !prefs.branches.some(b => branchKeywords[b].some(kw => branchName.includes(kw)) || branchName.includes(`(${b.toUpperCase()})`))) continue;

    const condition = type === 'cutoff' ? (value >= (metric - 5.0) && value <= (metric + 5.0)) : (value >= (metric - 5000) && value <= (metric + 5000));
    
    if (condition) {
      let chance = "Safe";
      if (type === 'cutoff') chance = metric < value ? "Ambitious" : (metric <= value + 1.5 ? "Target" : "Safe");
      else chance = metric > value ? "Ambitious" : (metric >= value - 1500 ? "Target" : "Safe");
      
      matched.push({ code: item.college_code, college: item.college_name || item.college, branch: item.branch_name || item.branch, score: value, chance });
    }
  }
  return matched.sort((a, b) => Math.abs(metric - a.score) - Math.abs(metric - b.score)).slice(0, 10);
}

// ==========================================================================
// 4. CHAT ROUTE WITH REAL-TIME STREAMING
// ==========================================================================
app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const rawMessage = req.body.message || "";
    if (!rawMessage.trim()) return res.end("Please enter your query.");
    
    if (rawMessage.length > 300) {
      res.write("⚠️ **Input too long.** Please keep your query under 300 characters.");
      return res.end();
    }

    const greetingRegex = /^(hi+|hello+|hey+|vanakkam|namaste|good\s*(morning|evening|afternoon)|hola)\b/i;
    if (greetingRegex.test(rawMessage.trim())) {
      res.write("Vanakkam! 👋 I am your **TNEA 2026 Counseling Assistant**.\n\nShare your **Cutoff Marks** to explore eligible colleges, or ask me about **TNEA Rules**, **Sports Quota**, or **Facilitation Centers (TFC)**!");
      return res.end();
    }

    if (isOffTopic(rawMessage)) {
      res.write("⚠️ **Out of Scope:** I am a specialized **TNEA 2026 Admissions Assistant**. I only handle Tamil Nadu engineering cutoffs, college details, and counseling rules. How can I assist you today?");
      return res.end();
    }

    const message = rawMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const history = req.body.history || [];
    
    const fullContext = history.filter(h => h.role === 'user').map(h => h.content).join(" ") + " " + message;
    let detectedRank = null, detectedScore = null;
    const detectedCategory = (fullContext.match(/\b(OC|BC|BCM|MBC|SC|SCA|ST)\b/i) || [])[0]?.toUpperCase() || null;

    const rankMatch = fullContext.match(/(?:rank\s*is\s*|rank\s*|ranked\s*)(\d+)|(\d+)\s*(?:th\s*)?rank/i);
    if (rankMatch) detectedRank = parseInt(rankMatch[1] || rankMatch[2]);
    else {
      const rawNumbers = fullContext.match(/\b\d{1,6}(?:\.\d+)?\b/g);
      if (rawNumbers) {
        for (let numStr of rawNumbers.reverse()) {
          const num = parseFloat(numStr);
          if (numStr.includes('.') || numStr.length === 3) { detectedScore = num; break; } 
          else if (num > 200) { detectedRank = num; break; } 
          else if (num >= 77.5 && num <= 200) { detectedScore = num; break; }
        }
      }
    }

    const prefs = extractPreferences(fullContext);
    let predictionContext = "";
    
    // 🆕 INJECT KNOWLEDGE BASE (RULES & TFCs)
    const rules = findRules(message);
    if (rules.length > 0) predictionContext += `\n\n[OFFICIAL RULEBOOK CONTEXT]:\n${rules.join("\n\n")}`;

    const tfcs = findTFC(message);
    if (tfcs.length > 0) predictionContext += `\n\n[TFC CENTERS CONTEXT]:\n${JSON.stringify(tfcs, null, 2)}`;

    // INJECT COLLEGE DETAILS
    const collegeLookup = findCollegeDetails(message);
    if (collegeLookup.data) predictionContext += `\n\n[COLLEGE DETAILS CONTEXT]:\n` + JSON.stringify(collegeLookup.data, null, 2);
    else predictionContext += `\n\n[COLLEGE DETAILS CONTEXT]: EMPTY.`; 

    // PREDICTIONS LOGIC
    const wantsPrediction = message.toLowerCase().match(/(recommend|suggest|predict|what college|which college|get into|list)/) || ((detectedRank !== null || detectedScore !== null) && (detectedCategory !== null || prefs.branches.length > 0));

    if (wantsPrediction && (detectedRank || detectedScore)) {
      if (!detectedCategory || prefs.branches.length === 0) {
        predictionContext += `\n\n[SYSTEM NOTIFICATION]: The user provided a cutoff/rank but is missing: Category AND Branch. Ask the user politely for them. DO NOT output a table yet.`;
      } else {
        const matches = detectedRank ? getPredictions(detectedRank, 'rank', detectedCategory, prefs) : getPredictions(detectedScore, 'cutoff', detectedCategory, prefs);
        predictionContext += matches.length > 0 
          ? `\n\n[DATABASE MATCHES]:\n` + JSON.stringify(matches, null, 2) + `\n\nFormat these into the recommended college table.`
          : `\n\n[NO EXACT MATCHES FOUND IN DATABASE]`;
      }
    }

    if (!process.env.GROQ_API_KEY) { res.write("⚠️ API Key missing in `.env` file."); return res.end(); }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const apiPayload = { 
        model: "openai/gpt-oss-20b", 
        messages: [{ role: "system", content: TNEA_SYSTEM_PROMPT + predictionContext }, ...history, { role: "user", content: message }], 
        temperature: 0.2,
        stream: true
    };

    let completion;
    try { completion = await groq.chat.completions.create(apiPayload); } 
    catch (primaryErr) {
      apiPayload.model = "qwen/qwen3.6-27b";
      completion = await groq.chat.completions.create(apiPayload);
    }

    let isThinking = false;
    let streamBuffer = "";

    for await (const chunk of completion) {
        const content = chunk.choices[0]?.delta?.content || "";
        streamBuffer += content;

        if (!isThinking) {
            let thinkIndex = streamBuffer.indexOf('<think>');
            if (thinkIndex !== -1) {
                const safeContent = streamBuffer.slice(0, thinkIndex);
                if (safeContent) res.write(safeContent);
                isThinking = true;
                streamBuffer = streamBuffer.slice(thinkIndex + 7);
            } else if (streamBuffer.length > 7) {
                const safeContent = streamBuffer.slice(0, -7);
                res.write(safeContent);
                streamBuffer = streamBuffer.slice(-7);
            }
        } else {
            let endThinkIndex = streamBuffer.indexOf('</think>');
            if (endThinkIndex !== -1) {
                isThinking = false;
                streamBuffer = streamBuffer.slice(endThinkIndex + 8);
            } else if (streamBuffer.length > 8) {
                streamBuffer = streamBuffer.slice(-8); 
            }
        }
    }
    
    if (!isThinking && streamBuffer) res.write(streamBuffer.replace(/<[^>]*$/g, ''));
    res.end();

  } catch (error) {
    res.write("⚠️ **Server Busy.** Please wait a moment and try again.");
    res.end();
  }
});

app.post('/api/trend', (req, res) => { /* Trend code remains unchanged */ });
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🛡️ TNEA Bot online at http://localhost:${PORT}`));
