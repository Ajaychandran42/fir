document.addEventListener("DOMContentLoaded", () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const appRoot = document.getElementById("appRoot");
  const sidebar = document.getElementById("sidebar");
  const mobileOverlay = document.getElementById("mobileOverlay");
  
  const chatView = document.getElementById("chatView");
  const calculatorView = document.getElementById("calculatorView");
  const trendView = document.getElementById("trendView");
  
  const navChatBtn = document.getElementById("navChatBtn");
  const navCalcPageBtn = document.getElementById("navCalcPageBtn");
  const navTrendBtn = document.getElementById("navTrendBtn");

  const inputField = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const messagesContainer = document.getElementById("messagesContainer");
  const typingIndicator = document.getElementById("typingIndicator");

  const renderer = new marked.Renderer();
  renderer.link = function({ href, title, text }) {
    return `<a target="_blank" rel="noopener noreferrer" href="${href}" title="${title || ''}">${text}</a>`;
  };
  renderer.table = function(token) {
    const defaultTable = marked.Renderer.prototype.table.call(this, token);
    return `<div class="table-wrapper">${defaultTable}</div>`;
  };

  let history = JSON.parse(localStorage.getItem("tnea_chat_history")) || [];

  function renderHistory() {
    document.querySelectorAll('.msg-row').forEach(el => el.remove());
    if (history.length === 0) {
      appendMessageUI(`Vanakkam! 👋 I am your <strong>TNEA 2026 Counseling Assistant</strong>.<br><br>Share your <strong>Cutoff Marks</strong> (e.g., <em>188.5 BC CSE</em>) to predict safe, target, and ambitious college options.`, "bot");
    } else {
      history.forEach(msg => appendMessageUI(msg.content, msg.role === 'assistant' ? 'bot' : 'user'));
    }
  }

  const menuToggleBtn = document.getElementById("menuToggleBtn");
  const closeSidebarBtn = document.getElementById("closeSidebarBtn");

  function toggleSidebar() {
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle("mobile-open");
        mobileOverlay.classList.toggle("active");
    } else {
        sidebar.classList.toggle("collapsed");
    }
  }

  function closeSidebar() {
    if (window.innerWidth <= 768) {
        sidebar.classList.remove("mobile-open");
        mobileOverlay.classList.remove("active");
    } else {
        sidebar.classList.add("collapsed");
    }
  }

  if (menuToggleBtn) menuToggleBtn.addEventListener("click", toggleSidebar);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener("click", closeSidebar);
  if (mobileOverlay) mobileOverlay.addEventListener("click", closeSidebar);

  window.addEventListener('resize', () => {
      if (window.innerWidth > 768 && window.innerWidth <= 1024) sidebar.classList.add('collapsed');
  });

  window.switchView = function(target) {
    chatView.classList.remove("active");
    calculatorView.classList.remove("active");
    trendView.classList.remove("active");
    navChatBtn.classList.remove("active");
    navCalcPageBtn.classList.remove("active");
    navTrendBtn.classList.remove("active");

    if (target === "chat") { chatView.classList.add("active"); navChatBtn.classList.add("active"); } 
    else if (target === "calc") { calculatorView.classList.add("active"); navCalcPageBtn.classList.add("active"); } 
    else if (target === "trend") { trendView.classList.add("active"); navTrendBtn.classList.add("active"); }
    if (window.innerWidth <= 768) closeSidebar();
  };

  if (navCalcPageBtn) navCalcPageBtn.addEventListener("click", () => switchView("calc"));
  if (navTrendBtn) navTrendBtn.addEventListener("click", () => switchView("trend"));
  if (navChatBtn) navChatBtn.addEventListener("click", () => switchView("chat"));
  
  const headerCalcBtn = document.getElementById("headerCalcBtn");
  if (headerCalcBtn) headerCalcBtn.addEventListener("click", () => switchView("calc"));

  const headerMenuBtn = document.getElementById("headerMenuBtn");
  const headerDropdown = document.getElementById("headerDropdown");
  if (headerMenuBtn && headerDropdown) {
      headerMenuBtn.addEventListener("click", (e) => { e.stopPropagation(); headerDropdown.classList.toggle("active"); });
      document.addEventListener("click", (e) => { if (!headerDropdown.contains(e.target) && e.target !== headerMenuBtn) headerDropdown.classList.remove("active"); });
  }

  const shareBtn = document.getElementById("shareBtn");
  if (shareBtn) {
      shareBtn.addEventListener("click", async () => {
          headerDropdown.classList.remove("active");
          if (navigator.share) { try { await navigator.share({ title: 'TNEA GPT', url: window.location.href }); } catch (err) {} } 
          else { navigator.clipboard.writeText(window.location.href); alert("Link copied!"); }
      });
  }

  const downloadPdfBtn = document.getElementById("downloadPdfBtn");
  if (downloadPdfBtn) {
      downloadPdfBtn.addEventListener("click", () => {
          headerDropdown.classList.remove("active");
          const element = document.getElementById('messagesContainer');
          document.getElementById('typingIndicator').style.display = 'none';
          element.classList.add('pdf-export-mode');
          html2pdf().set({ margin: 10, filename: 'TNEA_Chat_History.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(element).save().then(() => { element.classList.remove('pdf-export-mode'); });
      });
  }

  const settingsPopover = document.getElementById("settingsPopover");
  const themeFlyout = document.getElementById("themeFlyout");
  const navSettingsBtn = document.getElementById("navSettingsBtn");
  const headerSettingsBtn = document.getElementById("headerSettingsBtn");
  const themeMenuTrigger = document.getElementById("themeMenuTrigger");

  function openSettingsMenu(event) {
    const btnRect = event.currentTarget.getBoundingClientRect();
    settingsPopover.classList.add('active');
    themeFlyout.classList.remove('active');
    if (window.innerWidth <= 768) { settingsPopover.style.top = (btnRect.bottom + 10) + 'px'; settingsPopover.style.right = '16px'; settingsPopover.style.left = 'auto'; settingsPopover.style.bottom = 'auto'; } 
    else { settingsPopover.style.bottom = (window.innerHeight - btnRect.top - 10) + 'px'; settingsPopover.style.left = (btnRect.right + 10) + 'px'; settingsPopover.style.top = 'auto'; settingsPopover.style.right = 'auto'; }
  }

  if (navSettingsBtn) navSettingsBtn.addEventListener("click", openSettingsMenu);
  if (headerSettingsBtn) headerSettingsBtn.addEventListener("click", openSettingsMenu);
  if (themeMenuTrigger) themeMenuTrigger.addEventListener("click", (e) => { e.stopPropagation(); themeFlyout.classList.toggle("active"); });
  document.addEventListener("click", (e) => { if (settingsPopover && settingsPopover.classList.contains("active")) { if (!settingsPopover.contains(e.target) && !(navSettingsBtn && navSettingsBtn.contains(e.target)) && !(headerSettingsBtn && headerSettingsBtn.contains(e.target))) { settingsPopover.classList.remove("active"); themeFlyout.classList.remove("active"); } } });

  const savedTheme = localStorage.getItem("tnea_theme_choice") || "system";
  applyTheme(savedTheme);

  function applyTheme(theme) {
    let isDark = theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : (theme === "dark");
    if (!isDark) { appRoot.classList.remove("theme-dark"); appRoot.classList.add("theme-light"); } 
    else { appRoot.classList.remove("theme-light"); appRoot.classList.add("theme-dark"); }
    localStorage.setItem("tnea_theme_choice", theme);
    document.querySelectorAll('.theme-select').forEach(btn => {
      const btnTheme = btn.getAttribute('data-theme');
      btn.innerHTML = btnTheme === theme ? `<i data-lucide="check" style="width:18px"></i> ${btnTheme.charAt(0).toUpperCase() + btnTheme.slice(1)}` : `<i style="width:18px; display:inline-block"></i> ${btnTheme.charAt(0).toUpperCase() + btnTheme.slice(1)}`;
    });
    lucide.createIcons();
  }

  document.querySelectorAll('.theme-select').forEach(btn => { btn.addEventListener('click', (e) => { applyTheme(e.currentTarget.getAttribute('data-theme')); themeFlyout.classList.remove("active"); }); });

  const calcMath = document.getElementById("calcMath"), calcPhy = document.getElementById("calcPhy"), calcChem = document.getElementById("calcChem"), fullCalcDisplay = document.getElementById("fullCalcDisplay"), calcProgressBar = document.getElementById("calcProgressBar");
  function runCalculator() {
    if(!calcMath || !calcPhy || !calcChem) return 0;
    const m = Math.min(Math.max(parseFloat(calcMath.value) || 0, 0), 100), p = Math.min(Math.max(parseFloat(calcPhy.value) || 0, 0), 100), c = Math.min(Math.max(parseFloat(calcChem.value) || 0, 0), 100);
    const totalCutoff = (m + (p / 2) + (c / 2)).toFixed(2);
    document.getElementById("mathContrib").textContent = m.toFixed(2); document.getElementById("phyContrib").textContent = (p / 2).toFixed(2); document.getElementById("chemContrib").textContent = (c / 2).toFixed(2);
    fullCalcDisplay.textContent = totalCutoff; calcProgressBar.style.width = `${(totalCutoff / 200) * 100}%`;
    return totalCutoff;
  }
  if(calcMath) calcMath.addEventListener("input", runCalculator); if(calcPhy) calcPhy.addEventListener("input", runCalculator); if(calcChem) calcChem.addEventListener("input", runCalculator);
  const useCutoffInChatBtn = document.getElementById("useCutoffInChatBtn");
  if (useCutoffInChatBtn) useCutoffInChatBtn.addEventListener("click", () => { const finalScore = runCalculator(); if (finalScore > 0) { switchView("chat"); inputField.value = `My cutoff is ${finalScore}. Recommend eligible colleges.`; handleSend(); } });

  const runTrendBtn = document.getElementById("runTrendBtn");
  if (runTrendBtn) {
      runTrendBtn.addEventListener("click", async () => {
          const code1 = document.getElementById("trendCode1").value.trim();
          const code2 = document.getElementById("trendCode2").value.trim();
          const branch = document.getElementById("trendBranch").value.trim().toUpperCase();
          const category = document.getElementById("trendCategory").value;
          
          if(!code1 || !branch) return alert("Please enter at least College Code 1 and a Branch Code (e.g., CS).");
          const codes = [code1]; if(code2) codes.push(code2);
          
          runTrendBtn.innerHTML = `<span>Loading...</span><i data-lucide="loader" class="spin"></i>`; lucide.createIcons();
          
          try {
              const res = await fetch("/api/trend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes, branch, category }) });
              const data = await res.json();
              if(data.error) alert(data.error);
              else {
                  let headerHTML = `<th>College Name</th>`;
                  data.years.forEach(y => headerHTML += `<th class="center-col">${y}</th>`);
                  document.getElementById("trendTableHeader").innerHTML = headerHTML;
                  let bodyHTML = "";
                  data.results.forEach(row => {
                      bodyHTML += `<tr><td><strong>[${row.code}]</strong> ${row.name}</td>`;
                      data.years.forEach(y => {
                          const score = row.trends[y];
                          bodyHTML += `<td class="center-col ${score === "N/A" ? "score-na" : "score-active"}">${score}</td>`;
                      });
                      bodyHTML += `</tr>`;
                  });
                  document.getElementById("trendTableBody").innerHTML = bodyHTML;
                  document.getElementById("trendResults").style.display = "block";
              }
          } catch(e) { alert("Network Error. Check if backend is running."); }
          runTrendBtn.innerHTML = `<span>Analyze Trends</span><i data-lucide="trending-up"></i>`; lucide.createIcons();
      });
  }

  const newChatBtn = document.getElementById("newChatBtn");
  if (newChatBtn) newChatBtn.addEventListener("click", () => { history = []; localStorage.removeItem("tnea_chat_history"); renderHistory(); switchView("chat"); settingsPopover.classList.remove('active'); });

  function scrollToBottom() { const wrapper = document.querySelector('.messages-wrapper'); if(wrapper) wrapper.scrollTop = wrapper.scrollHeight; }

  function appendMessageUI(text, sender) {
    const rowDiv = document.createElement("div"); rowDiv.className = `msg-row ${sender}`;
    const avatarDiv = document.createElement("div"); avatarDiv.className = `avatar ${sender}`;
    avatarDiv.innerHTML = sender === "bot" ? `<img src="logo_2.jpeg" alt="Bot">` : `<i data-lucide="user"></i>`;
    const bubbleContainer = document.createElement("div"); bubbleContainer.className = "bubble-container";
    const bubbleDiv = document.createElement("div"); bubbleDiv.className = "bubble";
    if (sender === "bot") bubbleDiv.innerHTML = marked.parse(text, { renderer }); else bubbleDiv.textContent = text;
    bubbleContainer.appendChild(bubbleDiv); rowDiv.appendChild(avatarDiv); rowDiv.appendChild(bubbleContainer);
    messagesContainer.insertBefore(rowDiv, typingIndicator); lucide.createIcons(); setTimeout(scrollToBottom, 50); 
  }

  if (inputField) {
      inputField.addEventListener("input", function() { this.style.height = "auto"; this.style.height = (this.scrollHeight <= 140 ? this.scrollHeight : 140) + "px"; });
      inputField.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } });
  }

  // --- 11. STREAMING CHAT LOGIC ---
  window.handleSend = async function() {
    const text = inputField.value.trim(); 
    if (!text) return;
    
    inputField.value = ""; 
    inputField.style.height = "auto";
    
    appendMessageUI(text, "user"); 
    history.push({ role: "user", content: text }); 
    localStorage.setItem("tnea_chat_history", JSON.stringify(history));
    
    typingIndicator.style.display = "flex"; 
    scrollToBottom(); 
    sendBtn.disabled = true;

    try {
      const res = await fetch("/api/chat", { 
          method: "POST", 
          headers: { "Content-Type": "application/json" }, 
          body: JSON.stringify({ message: text, history: history }) 
      });

      typingIndicator.style.display = "none";
      if (!res.ok) throw new Error("Network error");

      const rowDiv = document.createElement("div"); rowDiv.className = `msg-row bot`;
      const avatarDiv = document.createElement("div"); avatarDiv.className = `avatar bot`;
      avatarDiv.innerHTML = `<img src="logo_2.jpeg" alt="Bot">`;
      const bubbleContainer = document.createElement("div"); bubbleContainer.className = "bubble-container";
      const bubbleDiv = document.createElement("div"); bubbleDiv.className = "bubble";
      
      bubbleContainer.appendChild(bubbleDiv); rowDiv.appendChild(avatarDiv); rowDiv.appendChild(bubbleContainer);
      messagesContainer.insertBefore(rowDiv, typingIndicator);

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let botReply = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        botReply += decoder.decode(value, { stream: true });
        bubbleDiv.innerHTML = marked.parse(botReply, { renderer });
        lucide.createIcons();
        scrollToBottom();
      }

      sendBtn.disabled = false;
      history.push({ role: "assistant", content: botReply }); 
      localStorage.setItem("tnea_chat_history", JSON.stringify(history));

    } catch (err) {
      typingIndicator.style.display = "none"; 
      sendBtn.disabled = false; 
      appendMessageUI("Network error. Make sure the backend server is running.", "bot");
    }
  };
  
  renderHistory();
});
