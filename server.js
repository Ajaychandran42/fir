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
// 1. LOAD ALL DATASETS
// ==========================================================================
let tneaData = [];
let collegeDetails = [];
let trendData = null;
let collegeCodesMap = [];

try {
  tneaData = JSON.parse(fs.readFileSync(path.join(__dirname, 'tnea_data.json'), 'utf8'));
  collegeDetails = JSON.parse(fs.readFileSync(path.join(__dirname, 'colleges.json'), 'utf8'));
  console.log(`✅ Loaded ${tneaData.length} cutoffs & ${collegeDetails.length} colleges.`);
} catch (err) {
  console.error("❌ Error loading primary databases:", err);
}

try {
  trendData = JSON.parse(fs.readFileSync(path.join(__dirname, 'tnea_5yrs.json'), 'utf8'));
  console.log(`✅ Loaded 5-Year Trend Database`);
} catch (err) {
  console.log("ℹ️ tnea_5yrs.json not found yet.");
}

try {
  collegeCodesMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'college_codes.json'), 'utf8'));
  console.log(`✅ Loaded Fast-Mapping College Codes Database`);
} catch (err) {
  console.log("ℹ️ college_codes.json not found.");
}

// ==========================================================================
// 2. SYSTEM PROMPT
// ==========================================================================
const TNEA_SYSTEM_PROMPT = `
You are the official Tamil Nadu Engineering Admissions (TNEA) 2026 Counseling Assistant.

--- REASONING INSTRUCTIONS ---
1. You MUST place all internal thinking inside <think> and </think> tags.
2. Output ONLY the final aesthetic response after the closing </think> tag.

--- 0. STRICT DOMAIN RESTRICTIONS & FEW-SHOT EXAMPLES ---
You ONLY answer queries about TNEA, Tamil Nadu engineering colleges, cutoffs, courses, and admissions.
If a user asks anything else (celebrities, cricket, movies, code, weather, general trivia), you MUST REFUSE immediately.

[EXAMPLE 1]
User: who is dhoni?
Assistant: ⚠️ **Out of Scope:** I am specialized strictly in **TNEA 2026 Engineering Admissions**. I cannot answer general knowledge or sports questions. Please ask about college cutoffs, ranks, or counseling details!

--- 1. GREETING DIRECTIVE ---
- If greeted (e.g., "Hi", "Vanakkam"), respond warmly and ask for their Cutoff Score or Rank.

--- 2. TNEA 2026 GUIDELINES ---
- PCM Average Eligibility: OC: 45%, BC/BCM/MBC/SC/SCA/ST: 40%.
- Reservation: OC: 31%, BC: 26.5%, BCM: 3.5%, MBC: 20%, SC: 15%, SCA: 3%, ST: 1%.

--- 3. STRICT ANTI-HALLUCINATION & COLLEGE LOOKUP RULES ---
- NEVER guess, invent, or recall college codes, autonomous statuses, or districts from your memory.
- You MUST ONLY extract college details from the [COLLEGE DETAILS CONTEXT] block provided below.
- CRITICAL KILL-SWITCH: If the [COLLEGE DETAILS CONTEXT] block says "EMPTY", YOU MUST REFUSE TO ANSWER. Say exactly: "⚠️ The college name or code you provided is not found in my database. Please check the spelling or try searching by the exact 4-digit code."
- If the context is found: Provide ONLY a brief summary containing the College Code, Name, District, and Autonomous Status.

--- 4. TABLE FORMATTING ---
When predicting colleges, output a Markdown table:
| Code | College Name | Branch | Cutoff / Rank | Chance |

--- 5. COLLEGE COMPARISON RULE ---
- If the user explicitly asks to "compare" colleges (e.g., "compare 1315 and 2006" or "compare SSN and PSG"), YOU MUST generate a side-by-side Markdown table.
- Structure the table with these columns: | Feature | [College 1 Name] | [College 2 Name] |
- Compare baseline attributes like District, Autonomous Status, and College Type based strictly on the [COLLEGE DETAILS CONTEXT].
`;

// ==========================================================================
// 3. FAST MAPPING & RAG LOGIC
// ==========================================================================
const OFF_TOPIC_TRIGGERS = [
  /\b(dhoni|kohli|ipl|cricket|football|messi|ronaldo)\b/i,
  /\b(movie|actor|actress|cinema|song|lyrics|weather|recipe)\b/i,
  /\b(python|javascript|java|c\+\+|write code|debug)\b/i,
  /\b(president|prime minister|politics|capital of)\b/i
];

function isOffTopic(text) {
  return OFF_TOPIC_TRIGGERS.some(regex => regex.test(text));
}

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
        if (dbName.includes(searchPhrase) || searchPhrase.includes(dbName)) {
          matchedCodes.add(item.college_code);
        }
      }
    }
  }

  matchedCodes.forEach(code => {
    const exact = collegeDetails.find(col => parseInt(col.college_code, 10) === code);
    if (exact && matches.length < 3) matches.push(exact);
  });

  return { data: matches.length > 0 ? matches : null };
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

    const greetingRegex = /^(hi+|hello+|hey+|vanakkam|namaste|good\s*(morning|evening|afternoon)|hola)\b/i;
    if (greetingRegex.test(rawMessage.trim())) {
      res.write("Vanakkam! 👋 I am your **TNEA 2026 Counseling Assistant**.\n\nShare your **Cutoff Marks** (e.g., *188.5 BC CSE*) or **General Rank** to explore eligible engineering colleges across Tamil Nadu, or ask me about specific college codes!");
      return res.end();
    }

    if (isOffTopic(rawMessage)) {
      res.write("⚠️ **Out of Scope:** I am a specialized **TNEA 2026 Admissions Assistant**. I only handle Tamil Nadu engineering cutoffs, college details, and counseling procedures. How can I assist you today?");
      return res.end();
    }

    const message = rawMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const history = req.body.history || [];
    
    if (/^\s*\d+(\.\d+)?\s*$/.test(rawMessage)) {
      res.write(`You entered **${rawMessage.trim()}**.\n\nCould you please clarify if this is your **Cutoff Score**, a **Counselling Rank**, or a **4-digit College Code**?`);
      return res.end();
    }

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

    if (detectedScore !== null && (detectedScore < 77.5 || detectedScore > 200)) {
        res.write("⚠️ **Invalid Cutoff.** Must be between **77.5 and 200**."); return res.end();
    }
    if (detectedRank !== null && (detectedRank <= 0 || detectedRank > 250000)) {
        res.write("⚠️ **Invalid Rank.** Must be a positive number."); return res.end();
    }

    const prefs = extractPreferences(fullContext);
    let predictionContext = "";
    const disclaimerText = "\n\n--- \n*Disclaimer: Predictions are estimates based on previous year counseling allotments.*";

    const collegeLookup = findCollegeDetails(message);
    if (collegeLookup.data) predictionContext += `\n\n[COLLEGE DETAILS CONTEXT]:\n` + JSON.stringify(collegeLookup.data, null, 2);
    else predictionContext += `\n\n[COLLEGE DETAILS CONTEXT]: EMPTY.`; 

    const wantsPrediction = message.toLowerCase().match(/(recommend|suggest|predict|what college|which college|get into|list)/) || ((detectedRank !== null || detectedScore !== null) && (detectedCategory !== null || prefs.branches.length > 0));

    if (wantsPrediction && (detectedRank || detectedScore)) {
      if (!detectedCategory || prefs.branches.length === 0) {
        predictionContext += `\n\n[SYSTEM NOTIFICATION]: The user provided a cutoff/rank but is missing: Category AND Branch. Ask the user politely for them. DO NOT output a table yet.`;
      } else {
        const matches = detectedRank ? getPredictions(detectedRank, 'rank', detectedCategory, prefs) : getPredictions(detectedScore, 'cutoff', detectedCategory, prefs);
        predictionContext += matches.length > 0 
          ? `\n\n[DATABASE MATCHES]:\n` + JSON.stringify(matches, null, 2) + `\n\nFormat these into the recommended college table. AFTER the table, print verbatim: ${disclaimerText}`
          : `\n\n[NO EXACT MATCHES FOUND IN DATABASE]`;
      }
    } else if (wantsPrediction && !detectedRank && !detectedScore) {
      predictionContext += `\n\n[SYSTEM NOTIFICATION]: User wants predictions but gave no score/rank. Ask them for it.`;
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

// ==========================================================================
// 5. TREND ROUTE (5-YEAR ANALYSIS)
// ==========================================================================
app.post('/api/trend', (req, res) => {
  try {
    if (!trendData) return res.status(500).json({ error: "Trend database not loaded." });
    
    const { codes, branch, category } = req.body; 
    const years = trendData.meta.years.sort((a,b) => a-b); 
    const catLower = category.toLowerCase();
    
    let results = []; 
    
    codes.forEach(code => {
      let collegeName = "Unknown College";
      let trends = {};
      
      const mappedCollege = collegeCodesMap.find(c => parseInt(c.college_code, 10) === parseInt(code, 10));
      if (mappedCollege) collegeName = mappedCollege.college_name;

      years.forEach(year => {
        const yearData = trendData.datasets.cutoff[year];
        if (yearData && yearData.data) {
          const match = yearData.data.find(r => parseInt(r.college_code) === parseInt(code) && r.branch_code === branch);
          if (match) {
            collegeName = match.college_name.split(',')[0]; 
            trends[year] = match[catLower] || "N/A";
          } else { trends[year] = "N/A"; }
        }
      });
      results.push({ code, name: collegeName, trends });
    });
    
    res.json({ years, results });
  } catch (error) {
    res.status(500).json({ error: "Trend analysis failed." });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🛡️ TNEA Bot online at http://localhost:${PORT}`));
