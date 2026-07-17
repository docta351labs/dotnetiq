// Global App State
let currentState = {
  activeTab: 'dashboard',
  currentStudyTopicIndex: 0,
  masteredQuestions: {}, // Map of Q_index (e.g. "0-0", "0-1") -> boolean
  bestQuizScore: null,
  currentLevel: 'semisenior',
  activeMindmapId: null, // ID of active mindmap
  selectedNode: null,    // Selected node object
  mindmapNodes: {},      // Flat map of current mindmap nodes for click lookup
  
  // Quiz Active State
  quiz: {
    isActive: false,
    questions: [], // shuffled questions
    currentIndex: 0,
    score: 0,
    hasAnswered: false,
    selectedOptionIndex: null
  }
};

// Dynamic local arrays populated from JSON files or Supabase
let studyData = [];
let quizQuestions = [];

// Category metadata helper map for UI icons and colors
const categoryMetadata = {
  'System Architecture': { icon: 'layers', color: 'var(--violet)' },
  'High-Performance .NET': { icon: 'cpu', color: 'var(--indigo)' },
  'Async & Concurrency': { icon: 'activity', color: 'var(--teal)' },
  'Data Access': { icon: 'database', color: 'var(--pink)' },
  'Cloud & Distributed': { icon: 'cloud', color: 'var(--blue)' },
  'Security & Identity': { icon: 'shield', color: 'var(--red)' },
  'Testing & DevOps': { icon: 'git-branch', color: 'var(--green)' },
  'C# Evolution': { icon: 'code', color: 'var(--orange)' },
  'Leadership & Strategy': { icon: 'award', color: 'var(--purple)' },
  'Scenarios & Debugging': { icon: 'wrench', color: 'var(--cyan)' }
};

function getCategoryMeta(name) {
  // Check exact match first
  if (categoryMetadata[name]) return categoryMetadata[name];
  
  const cleanName = name ? name.toLowerCase().trim() : '';
  
  if (cleanName.includes('arch')) return { icon: 'layers', color: 'var(--violet)' };
  if (cleanName.includes('perf')) return { icon: 'cpu', color: 'var(--indigo)' };
  if (cleanName.includes('async') || cleanName.includes('concur')) return { icon: 'activity', color: 'var(--teal)' };
  if (cleanName.includes('data')) return { icon: 'database', color: 'var(--pink)' };
  if (cleanName.includes('cloud') || cleanName.includes('distr')) return { icon: 'cloud', color: 'var(--blue)' };
  if (cleanName.includes('sec')) return { icon: 'shield', color: 'var(--red)' };
  if (cleanName.includes('test') || cleanName.includes('dev')) return { icon: 'git-branch', color: 'var(--green)' };
  if (cleanName.includes('code') || cleanName.includes('evolution') || cleanName.includes('c#')) return { icon: 'code', color: 'var(--orange)' };
  if (cleanName.includes('lead') || cleanName.includes('strat')) return { icon: 'award', color: 'var(--purple)' };
  if (cleanName.includes('scen') || cleanName.includes('debug')) return { icon: 'wrench', color: 'var(--cyan)' };
  
  return { icon: 'book-open', color: 'var(--violet)' };
}

// Group flat study questions into categories
function groupQuestionsByCategory(rows) {
  const categoriesMap = {};
  
  rows.forEach(row => {
    if (!categoriesMap[row.category]) {
      const meta = getCategoryMeta(row.category);
      categoriesMap[row.category] = {
        category: row.category,
        icon: meta.icon,
        color: meta.color,
        questions: []
      };
    }
    categoriesMap[row.category].questions.push({
      q: row.question,
      a: row.answer
    });
  });
  
  return Object.values(categoriesMap);
}

// Fetch active level data (from Supabase or local JSON files based on USE_DATABASE config)
async function fetchLevelData(level) {
  // Check if we should consume from local files
  if (typeof USE_DATABASE === 'undefined' || !USE_DATABASE) {
    try {
      const res = await fetch(`questions_${level}.json`);
      if (!res.ok) throw new Error(`Failed to load local JSON questions for ${level}`);
      const data = await res.json();
      studyData = data.studyData;
      quizQuestions = data.quizQuestions;
    } catch (err) {
      console.error('Error loading questions:', err);
    }
    return; // Done loading from local files!
  }

  // Otherwise, load from database
  const loader = document.getElementById('loading-overlay');
  if (loader) loader.classList.remove('hidden');

  try {
    if (typeof supabaseClient === 'undefined' || !supabaseClient || typeof supabaseClient.from !== 'function') {
      throw new Error('Supabase client has not been configured in config.js.');
    }

    // Fetch study questions (order by id ascending to maintain original sorting)
    const { data: studyRows, error: studyError } = await supabaseClient
      .from('study_questions')
      .select('*')
      .eq('level', level)
      .order('id', { ascending: true });

    if (studyError) throw studyError;

    // Fetch quiz questions
    const { data: quizRows, error: quizError } = await supabaseClient
      .from('quiz_questions')
      .select('*')
      .eq('level', level)
      .order('id', { ascending: true });

    if (quizError) throw quizError;

    // Map fetched questions to application arrays
    studyData = groupQuestionsByCategory(studyRows || []);
    quizQuestions = (quizRows || []).map(q => ({
      q: q.question,
      options: q.options,
      correctIndex: q.correct_index,
      explanation: q.explanation
    }));

  } catch (err) {
    console.error('Error fetching data from Supabase:', err);
    showErrorOverlay(err.message);
  } finally {
    if (loader) loader.classList.add('hidden');
  }
}

// Show UI setup instructions overlay
function showSetupOverlay() {
  const setupOverlay = document.getElementById('setup-overlay');
  if (setupOverlay) {
    setupOverlay.classList.remove('hidden');
  }
}

// Show error overlay
function showErrorOverlay(message) {
  const setupOverlay = document.getElementById('setup-overlay');
  if (setupOverlay) {
    const title = setupOverlay.querySelector('h2');
    const desc = setupOverlay.querySelector('p');
    const list = setupOverlay.querySelector('ol');
    
    if (title) title.textContent = '❌ Supabase Connection Error';
    if (desc) desc.textContent = `There was a problem connecting to Supabase: ${message}. Check your credentials in config.js.`;
    if (list) list.classList.add('hidden');
    
    setupOverlay.classList.remove('hidden');
  }
}

// Load mindmap configuration files at startup
async function loadMindmapConfig() {
  try {
    // Load mindmap files config
    const mmFilesRes = await fetch('mindmaps_files.json');
    if (!mmFilesRes.ok) throw new Error('Failed to load mindmap files list');
    window.mindmapFiles = await mmFilesRes.json();
    
    // Load mindmap node details
    const mmDetailsRes = await fetch('mindmaps_details.json');
    if (!mmDetailsRes.ok) throw new Error('Failed to load mindmap node details');
    window.mindmapNodeDetails = await mmDetailsRes.json();
  } catch (err) {
    console.error('Error loading mindmap config:', err);
  }
}

// Initialize Application
window.addEventListener('DOMContentLoaded', async () => {
  // Check if we need database and if it's configured
  if (typeof USE_DATABASE !== 'undefined' && USE_DATABASE) {
    if (typeof supabaseClient === 'undefined' || !supabaseClient || typeof supabaseClient.from !== 'function') {
      showSetupOverlay();
      lucide.createIcons();
      return;
    }
  }

  loadProgress();
  
  // Fetch initial level data and mindmap config
  await Promise.all([
    fetchLevelData(currentState.currentLevel),
    loadMindmapConfig()
  ]);

  // Switch to active tab to trigger rendering
  switchTab(currentState.activeTab);
  
  // Initialize global stats
  updateGlobalStats();

  // Setup mobile navigation toggle
  const navToggle = document.querySelector('.mobile-nav-toggle');
  const sidebar = document.querySelector('.app-sidebar');
  if (navToggle && sidebar) {
    navToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = sidebar.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', isOpen);
      const icon = navToggle.querySelector('i');
      if (icon) {
        if (isOpen) {
          icon.setAttribute('data-lucide', 'x');
        } else {
          icon.setAttribute('data-lucide', 'menu');
        }
        if (window.lucide) window.lucide.createIcons();
      }
    });

    // Close sidebar if user clicks outside of it on mobile
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !navToggle.contains(e.target)) {
        sidebar.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        const icon = navToggle.querySelector('i');
        if (icon) {
          icon.setAttribute('data-lucide', 'menu');
          if (window.lucide) window.lucide.createIcons();
        }
      }
    });
  }
});

// Load state from LocalStorage (level-aware)
function loadProgress() {
  const lvl = currentState.currentLevel;
  const savedMastered = localStorage.getItem(`mastered_questions_${lvl}`);
  if (savedMastered) {
    currentState.masteredQuestions = JSON.parse(savedMastered);
  } else {
    currentState.masteredQuestions = {};
  }
  
  const savedScore = localStorage.getItem(`best_quiz_score_${lvl}`);
  if (savedScore) {
    currentState.bestQuizScore = parseInt(savedScore, 10);
  } else {
    currentState.bestQuizScore = null;
  }
}

// Save mastered questions to LocalStorage (level-aware)
function saveProgress() {
  const lvl = currentState.currentLevel;
  localStorage.setItem(`mastered_questions_${lvl}`, JSON.stringify(currentState.masteredQuestions));
  updateGlobalStats();
}

// Switch between tabs
function switchTab(tabId) {
  // Close sidebar on mobile when navigating
  const sidebar = document.querySelector('.app-sidebar');
  const navToggle = document.querySelector('.mobile-nav-toggle');
  if (sidebar && sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
    if (navToggle) {
      navToggle.setAttribute('aria-expanded', 'false');
      const icon = navToggle.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', 'menu');
        if (window.lucide) window.lucide.createIcons();
      }
    }
  }

  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = document.getElementById(`btn-${tabId}`);
  if (activeBtn) activeBtn.classList.add('active');
  
  // Update contents
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  
  const activeContent = document.getElementById(`tab-${tabId}`);
  if (activeContent) activeContent.classList.add('active');
  
  currentState.activeTab = tabId;
  
  // Update header text based on active tab
  const headerTitle = document.getElementById('header-title');
  const headerSubtitle = document.getElementById('header-subtitle');
  
  let levelText = 'Principal';
  if (currentState.currentLevel === 'senior') {
    levelText = 'Senior';
  } else if (currentState.currentLevel === 'semisenior') {
    levelText = 'Semi Senior';
  }
  
  if (tabId === 'dashboard') {
    headerTitle.textContent = 'Developer Dashboard';
    headerSubtitle.textContent = `Welcome back. Track your learning and challenge your ${levelText} engineering skills.`;
    renderDashboard(); // Refresh stats/progress on dashboard
  } else if (tabId === 'study') {
    headerTitle.textContent = 'Study Guide';
    headerSubtitle.textContent = `Browse through ${levelText}-level C# & .NET Core architectures and review detailed interview answers.`;
    renderStudySidebar();
    renderStudyTopic(currentState.currentStudyTopicIndex);
  } else if (tabId === 'quiz') {
    headerTitle.textContent = 'Assessment Simulator';
    headerSubtitle.textContent = `Test your ${levelText}-level technical judgment and diagnostic capabilities on 20 random scenarios.`;
    renderQuizIntro();
  } else if (tabId === 'mindmaps') {
    headerTitle.textContent = 'Mindmap Explorer';
    headerSubtitle.textContent = `Visualize core C# and system architecture concepts for ${levelText} level with interactive tree diagrams.`;
    renderMindmapsTab();
  }
  
  lucide.createIcons();
}

// Update Global Dashboard Metrics
function updateGlobalStats() {
  // Mastered Count
  let totalQuestions = 0;
  studyData.forEach(domain => {
    totalQuestions += domain.questions.length;
  });
  if (totalQuestions === 0) totalQuestions = 250; // Fallback to 250 if data not loaded yet
  
  const masteredCount = Object.values(currentState.masteredQuestions).filter(Boolean).length;
  
  document.getElementById('stats-mastered-count').textContent = masteredCount;
  
  const totalCountEl = document.getElementById('stats-total-count');
  if (totalCountEl) {
    totalCountEl.textContent = totalQuestions;
  }
  
  // Mastery Percentage
  const percent = Math.round((masteredCount / totalQuestions) * 100);
  document.getElementById('stats-percentage').textContent = `${percent}%`;
  
  // Sidebar Progress
  document.getElementById('mini-progress-txt').textContent = `${percent}%`;
  document.getElementById('mini-progress-fill').style.width = `${percent}%`;
  
  // Quiz score
  const quizScoreEl = document.getElementById('stats-quiz-score');
  if (currentState.bestQuizScore !== null) {
    quizScoreEl.textContent = `${currentState.bestQuizScore * 10} / 100`;
  } else {
    quizScoreEl.textContent = '-';
  }
}

// Render Dashboard domain grid
function renderDashboard() {
  const container = document.getElementById('domains-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  studyData.forEach((domain, dIdx) => {
    // Calculate progress for this domain
    const totalInDomain = domain.questions.length;
    let masteredInDomain = 0;
    
    for (let qIdx = 0; qIdx < totalInDomain; qIdx++) {
      if (currentState.masteredQuestions[`${dIdx}-${qIdx}`]) {
        masteredInDomain++;
      }
    }
    
    const percent = Math.round((masteredInDomain / totalInDomain) * 100);
    
    // Create card element
    const card = document.createElement('div');
    card.className = 'domain-card glass';
    card.onclick = () => {
      currentState.currentStudyTopicIndex = dIdx;
      switchTab('study');
    };
    
    card.innerHTML = `
      <div class="domain-card-accent" style="background-color: ${domain.color};"></div>
      <div class="domain-header">
        <div class="domain-icon-wrap" style="background-color: rgba(255,255,255,0.03); color: ${domain.color};">
          <i data-lucide="${domain.icon}"></i>
        </div>
        <span class="domain-status-circle">${masteredInDomain}/${totalInDomain}</span>
      </div>
      <h4>${domain.category}</h4>
      <p>Master C# code syntax, thread behaviors, and design patterns.</p>
      <div class="domain-progress">
        <div class="domain-progress-text">
          <span>Mastery</span>
          <span>${percent}%</span>
        </div>
        <div class="domain-progress-bar">
          <div class="domain-progress-fill" style="width: ${percent}%; background-color: ${domain.color};"></div>
        </div>
      </div>
    `;
    
    container.appendChild(card);
  });
}

// Render Study Sidebar Buttons
function renderStudySidebar() {
  const list = document.getElementById('study-topics-list');
  if (!list) return;
  
  list.innerHTML = '';
  
  studyData.forEach((topic, idx) => {
    const total = topic.questions.length;
    let mastered = 0;
    for (let qIdx = 0; qIdx < total; qIdx++) {
      if (currentState.masteredQuestions[`${idx}-${qIdx}`]) mastered++;
    }
    
    const button = document.createElement('button');
    button.className = `topic-btn ${idx === currentState.currentStudyTopicIndex ? 'active' : ''}`;
    button.onclick = () => {
      // Set active button
      document.querySelectorAll('.topic-btn').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      currentState.currentStudyTopicIndex = idx;
      renderStudyTopic(idx);
    };
    
    button.innerHTML = `
      <span>${topic.category}</span>
      <span class="topic-progress-badge">${mastered}/${total}</span>
    `;
    
    list.appendChild(button);
  });
}

// Render Questions in the study guide panel
function renderStudyTopic(topicIdx) {
  const topic = studyData[topicIdx];
  if (!topic) return;
  
  // Set badge & title
  const badge = document.getElementById('study-topic-badge');
  badge.textContent = topic.category;
  badge.style.backgroundColor = topic.color;
  
  document.getElementById('study-topic-title').textContent = `${topic.category} Guide`;
  
  const list = document.getElementById('questions-list');
  list.innerHTML = '';
  
  topic.questions.forEach((item, qIdx) => {
    const isMastered = currentState.masteredQuestions[`${topicIdx}-${qIdx}`] || false;
    
    const card = document.createElement('div');
    card.className = `question-card glass ${isMastered ? 'mastered' : ''}`;
    card.id = `qcard-${topicIdx}-${qIdx}`;
    
    const btnLabel = isMastered ? 'Mark as Unmastered' : 'Mark as Mastered';
    
    card.innerHTML = `
      <button class="question-trigger" onclick="toggleQuestionCollapse('${topicIdx}-${qIdx}')">
        <div class="trigger-left">
          <span class="trigger-check" onclick="toggleQuestionMastery(event, ${topicIdx}, ${qIdx})">
            <i data-lucide="check"></i>
          </span>
          <span>${item.q}</span>
        </div>
        <span class="trigger-arrow"><i data-lucide="chevron-down"></i></span>
      </button>
      <div class="question-body">
        <div class="question-content">
          ${formatMarkdownToHtml(item.a)}
          <div class="question-footer">
            <button class="btn ${isMastered ? 'btn-secondary' : 'btn-primary'}" onclick="toggleQuestionMasteryDirect(${topicIdx}, ${qIdx})">
              <i data-lucide="${isMastered ? 'x-circle' : 'check-circle'}"></i>
              <span>${btnLabel}</span>
            </button>
          </div>
        </div>
      </div>
    `;
    
    list.appendChild(card);
  });
  
  lucide.createIcons();
}

// Toggle collapse accordion for questions
function toggleQuestionCollapse(key) {
  const card = document.getElementById(`qcard-${key}`);
  if (!card) return;
  
  const isExpanded = card.classList.contains('expanded');
  
  // Collapse all other questions in this topic
  document.querySelectorAll('.question-card').forEach(c => {
    c.classList.remove('expanded');
    const body = c.querySelector('.question-body');
    if (body) body.style.maxHeight = null;
  });
  
  if (!isExpanded) {
    card.classList.add('expanded');
    const body = card.querySelector('.question-body');
    if (body) {
      body.style.maxHeight = body.scrollHeight + 'px';
      // Set max-height to none after transition completes so content is never cut off
      setTimeout(() => {
        if (card.classList.contains('expanded')) {
          body.style.maxHeight = 'none';
        }
      }, 400);
    }
  }
}

// Mark question mastered from checkbox click
function toggleQuestionMastery(event, topicIdx, qIdx) {
  event.stopPropagation(); // Stop accordion from toggling
  toggleQuestionMasteryDirect(topicIdx, qIdx);
}

// Internal function to toggle question mastered state
function toggleQuestionMasteryDirect(topicIdx, qIdx) {
  const key = `${topicIdx}-${qIdx}`;
  const currentlyMastered = currentState.masteredQuestions[key] || false;
  const newMastered = !currentlyMastered;
  
  currentState.masteredQuestions[key] = newMastered;
  saveProgress();
  
  // Update card UI in-place
  const card = document.getElementById(`qcard-${topicIdx}-${qIdx}`);
  if (card) {
    if (newMastered) {
      card.classList.add('mastered');
    } else {
      card.classList.remove('mastered');
    }
    
    const checkBadge = card.querySelector('.trigger-check');
    const footerBtn = card.querySelector('.question-footer button');
    
    if (footerBtn) {
      footerBtn.className = `btn ${newMastered ? 'btn-secondary' : 'btn-primary'}`;
      const btnLabel = newMastered ? 'Mark as Unmastered' : 'Mark as Mastered';
      footerBtn.innerHTML = `
        <i data-lucide="${newMastered ? 'x-circle' : 'check-circle'}"></i>
        <span>${btnLabel}</span>
      `;
    }
  }
  
  // Update sidebar badge in-place to avoid rebuilding the sidebar and losing scroll/focus
  const topicBtn = document.querySelectorAll('.topic-btn')[topicIdx];
  if (topicBtn) {
    const topic = studyData[topicIdx];
    const total = topic.questions.length;
    let mastered = 0;
    for (let i = 0; i < total; i++) {
      if (currentState.masteredQuestions[`${topicIdx}-${i}`]) mastered++;
    }
    const badge = topicBtn.querySelector('.topic-progress-badge');
    if (badge) {
      badge.textContent = `${mastered}/${total}`;
    }
  }
  
  lucide.createIcons();
}

// Mark all questions in current topic completed
function markAllCompleted() {
  const topicIdx = currentState.currentStudyTopicIndex;
  const topic = studyData[topicIdx];
  
  topic.questions.forEach((_, qIdx) => {
    currentState.masteredQuestions[`${topicIdx}-${qIdx}`] = true;
  });
  
  saveProgress();
  renderStudySidebar();
  renderStudyTopic(topicIdx);
}

// Basic markdown format parser for C# code blocks and lists
function formatMarkdownToHtml(text) {
  // Escape HTML tags to prevent cross-site scripting
  let safeText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  // Restore code tags inside markdown since we want to format them
  const lines = safeText.split('\n');
  let html = '';
  let inList = false;
  let inCode = false;
  let codeBlock = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Handle Code Blocks
    if (line.trim().startsWith('```')) {
      if (inCode) {
        // End code block
        html += `<pre><code>${codeBlock.join('\n')}</code></pre>`;
        codeBlock = [];
        inCode = false;
      } else {
        // Start code block
        inCode = true;
      }
      continue;
    }
    
    if (inCode) {
      codeBlock.push(line);
      continue;
    }
    
    // Handle Bullet Lists
    if (line.trim().startsWith('* ')) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      let content = line.trim().substring(2);
      html += `<li>${parseInlineMarkdown(content)}</li>`;
      continue;
    } else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
    }
    
    // Handle empty lines (paragraph breaks)
    if (line.trim() === '') {
      continue;
    }
    
    // Regular paragraph
    html += `<p>${parseInlineMarkdown(line)}</p>`;
  }
  
  if (inList) {
    html += '</ul>';
  }
  if (inCode && codeBlock.length > 0) {
    html += `<pre><code>${codeBlock.join('\n')}</code></pre>`;
  }
  
  return html;
}

function parseInlineMarkdown(text) {
  let formatted = text;
  // Format bold (**text**)
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Format inline code (`code`)
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  return formatted;
}

// --- PRACTICE QUIZ MODULE ---

// Shuffle array algorithm
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Render Quiz Intro texts according to target level
function renderQuizIntro() {
  const titleEl = document.getElementById('quiz-intro-title');
  const descEl = document.getElementById('quiz-intro-desc');
  if (!titleEl || !descEl) return;
  
  if (currentState.currentLevel === 'principal') {
    titleEl.textContent = 'Scenario-Based Principal Assessment';
    descEl.textContent = 'This practice quiz evaluates your architectural judgment, performance diagnostics, and trade-off analysis. It consists of 20 advanced scenario-based questions designed for Principal-level validation.';
  } else if (currentState.currentLevel === 'senior') {
    titleEl.textContent = 'Scenario-Based Senior Assessment';
    descEl.textContent = 'This practice quiz evaluates your advanced implementation skills, API design, and performance debugging. It consists of 20 scenario-based questions designed for Senior-level validation.';
  } else {
    titleEl.textContent = 'Scenario-Based Semi-Senior Assessment';
    descEl.textContent = 'This practice quiz evaluates your core .NET fundamentals, OOP principles, and basic coding problem-solving. It consists of 20 scenario-based questions designed for Semi-Senior level validation.';
  }
}

// Start Quiz Session
function startQuiz() {
  // Hide Intro, Show Active Quiz
  document.getElementById('quiz-intro').classList.add('hidden');
  document.getElementById('quiz-results').classList.add('hidden');
  document.getElementById('quiz-active').classList.remove('hidden');
  
  currentState.quiz.isActive = true;
  
  // Select 20 random questions from quizQuestions pool
  currentState.quiz.questions = shuffleArray(quizQuestions).slice(0, 20);
  currentState.quiz.currentIndex = 0;
  currentState.quiz.score = 0;
  
  loadQuizQuestion(0);
}

// Load Question in active Quiz
function loadQuizQuestion(index) {
  const qState = currentState.quiz;
  const qData = qState.questions[index];
  
  qState.hasAnswered = false;
  qState.selectedOptionIndex = null;
  
  // Update header text/progress
  const totalQ = qState.questions.length;
  document.getElementById('quiz-current-num').textContent = index + 1;
  const totalNumEl = document.getElementById('quiz-total-num');
  if (totalNumEl) {
    totalNumEl.textContent = totalQ;
  }
  const progressPercent = ((index + 1) / totalQ) * 100;
  document.getElementById('quiz-progress-bar').style.width = `${progressPercent}%`;
  
  // Set question text
  document.getElementById('quiz-question-text').textContent = qData.q;
  
  // Render options
  const optionsContainer = document.getElementById('quiz-options-list');
  optionsContainer.innerHTML = '';
  
  qData.options.forEach((optText, optIdx) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.onclick = () => selectQuizOption(optIdx);
    
    btn.innerHTML = `
      <span>${optText}</span>
      <span class="option-btn-icon"><i data-lucide="circle"></i></span>
    `;
    optionsContainer.appendChild(btn);
  });
  
  // Hide explanation and action button
  document.getElementById('quiz-explanation-panel').classList.add('hidden');
  document.getElementById('quiz-actions-container').classList.add('hidden');
  
  lucide.createIcons();
}

// Select option in quiz
function selectQuizOption(optionIdx) {
  const qState = currentState.quiz;
  if (qState.hasAnswered) return;
  
  qState.hasAnswered = true;
  qState.selectedOptionIndex = optionIdx;
  
  const qData = qState.questions[qState.currentIndex];
  const isCorrect = (optionIdx === qData.correctIndex);
  
  if (isCorrect) {
    qState.score++;
  }
  
  // Update options UI
  const optionButtons = document.querySelectorAll('.option-btn');
  optionButtons.forEach((btn, idx) => {
    btn.classList.add('disabled');
    
    if (idx === qData.correctIndex) {
      btn.classList.remove('disabled');
      btn.classList.add('correct');
      btn.querySelector('.option-btn-icon').innerHTML = '<i data-lucide="check-circle2"></i>';
    } else if (idx === optionIdx) {
      btn.classList.remove('disabled');
      btn.classList.add('incorrect');
      btn.querySelector('.option-btn-icon').innerHTML = '<i data-lucide="x-circle"></i>';
    }
  });
  
  // Show Explanation Panel
  const expPanel = document.getElementById('quiz-explanation-panel');
  const expStatus = document.getElementById('explanation-status-badge');
  const expContent = document.getElementById('quiz-explanation-content');
  
  expStatus.textContent = isCorrect ? 'Correct Analysis' : 'Incorrect Choice';
  expStatus.className = `exp-badge ${isCorrect ? 'correct' : 'incorrect'}`;
  
  expContent.innerHTML = `
    <p><strong>Rationale:</strong> ${qData.explanation}</p>
  `;
  
  expPanel.classList.remove('hidden');
  
  // Show next actions button
  document.getElementById('quiz-actions-container').classList.remove('hidden');
  
  lucide.createIcons();
}

// Proceed to next question
function nextQuestion() {
  const qState = currentState.quiz;
  const totalQ = qState.questions.length;
  
  if (qState.currentIndex < totalQ - 1) {
    qState.currentIndex++;
    loadQuizQuestion(qState.currentIndex);
  } else {
    showQuizResults();
  }
}

// Show Results screen
function showQuizResults() {
  currentState.quiz.isActive = false;
  document.getElementById('quiz-active').classList.add('hidden');
  const resultsContainer = document.getElementById('quiz-results');
  resultsContainer.classList.remove('hidden');
  
  const score = currentState.quiz.score;
  const totalQ = currentState.quiz.questions.length;
  const scorePercent = Math.round((score / totalQ) * 100);
  
  // Update score labels
  document.getElementById('results-score-percent').textContent = `${scorePercent}%`;
  document.getElementById('results-score-num').textContent = score;
  const resultsTotalEl = document.getElementById('results-total-num');
  if (resultsTotalEl) {
    resultsTotalEl.textContent = totalQ;
  }
  
  // Save best score to LocalStorage
  if (currentState.bestQuizScore === null || score > currentState.bestQuizScore) {
    currentState.bestQuizScore = score;
    localStorage.setItem(`best_quiz_score_${currentState.currentLevel}`, score);
    updateGlobalStats();
  }
  
  // Determine Rating based on current level and score
  const rankBadge = document.getElementById('results-rank-badge');
  const rankDesc = document.getElementById('results-rank-desc');
  
  const rankings = {
    principal: {
      10: { badge: '.NET Principal Architect', desc: 'Perfect score. You demonstrate mastery of distributed systems, memory optimization, and architectural trade-offs at the Principal level.' },
      8:  { badge: 'Staff Engineer', desc: 'Excellent performance. Your understanding of system design and performance patterns is near Principal-level.' },
      5:  { badge: 'Senior Developer', desc: 'Solid foundation. Review advanced concurrency, CQRS patterns, and memory management to reach Principal level.' },
      0:  { badge: 'Mid-Level Developer', desc: 'Focus on deepening your understanding of system architecture, distributed patterns, and performance optimization.' }
    },
    senior: {
      10: { badge: 'Senior .NET Expert', desc: 'Outstanding! You have a thorough grasp of async patterns, EF Core optimization, and security best practices.' },
      8:  { badge: 'Senior Developer', desc: 'Strong performance. Polish your knowledge of testing strategies and middleware pipelines.' },
      5:  { badge: 'Semi-Senior Developer', desc: 'Good progress. Strengthen your skills in dependency injection, LINQ optimization, and API security.' },
      0:  { badge: 'Junior Developer', desc: 'Keep studying! Focus on core .NET fundamentals, OOP principles, and basic design patterns.' }
    },
    semisenior: {
      10: { badge: 'Semi-Senior Star', desc: 'Excellent! You have a strong grasp of C# fundamentals, OOP, and basic .NET patterns.' },
      8:  { badge: 'Aspiring Semi-Senior', desc: 'Very good. Review LINQ edge cases and dependency injection lifetimes to solidify your skills.' },
      5:  { badge: 'Junior Developer', desc: 'Decent start. Focus on understanding value vs reference types, exception handling, and REST conventions.' },
      0:  { badge: 'Entry Level', desc: 'Keep learning! Start with C# basics, OOP pillars, and simple CRUD operations.' }
    }
  };
  
  const levelRankings = rankings[currentState.currentLevel] || rankings.principal;
  let rank;
  
  // Scale score to 0-10 range for ranking lookup
  const scaledScore = Math.round((score / totalQ) * 10);
  
  if (scaledScore === 10) rank = levelRankings[10];
  else if (scaledScore >= 8) rank = levelRankings[8];
  else if (scaledScore >= 5) rank = levelRankings[5];
  else rank = levelRankings[0];
  
  let badgeColor = 'var(--red)';
  if (scaledScore === 10) badgeColor = 'var(--teal)';
  else if (scaledScore >= 8) badgeColor = 'var(--violet)';
  else if (scaledScore >= 5) badgeColor = 'var(--yellow)';
  
  rankBadge.textContent = rank.badge;
  rankDesc.textContent = rank.desc;
  rankBadge.style.color = badgeColor;
  
  lucide.createIcons();
}

// Restart Quiz
function restartQuiz() {
  startQuiz();
}

// Change difficulty level dynamically and fetch new level data
async function changeLevel(level) {
  currentState.currentLevel = level;
  
  // Reload level-aware progress
  loadProgress();
  
  // Fetch active level data
  await fetchLevelData(level);
  
  // Update global metrics for the new level
  updateGlobalStats();
  
  // Reset study topic, quiz, and mindmap active states
  currentState.currentStudyTopicIndex = 0;
  currentState.activeMindmapId = null;
  currentState.selectedNode = null;
  currentState.mindmapNodes = {};
  
  if (currentState.quiz.isActive) {
    resetQuizToIntro();
  }
  
  // Force re-render of current view
  switchTab(currentState.activeTab);
}

// Reset quiz back to intro state
function resetQuizToIntro() {
  currentState.quiz.isActive = false;
  document.getElementById('quiz-active').classList.add('hidden');
  document.getElementById('quiz-results').classList.add('hidden');
  document.getElementById('quiz-intro').classList.remove('hidden');
}

// ==========================================
// MINDMAPS FEATURE IMPLEMENTATION
// ==========================================

// Global node counter for assigning unique DOM IDs
let nodeCounter = 0;

// Fetch mindmaps array for current difficulty level
function getMindmapsForCurrentLevel() {
  if (typeof mindmapFiles === 'undefined') return [];
  if (currentState.currentLevel === 'principal') {
    return mindmapFiles.principal;
  } else if (currentState.currentLevel === 'senior') {
    return mindmapFiles.senior;
  } else {
    return mindmapFiles.semisenior;
  }
}

// Initialize and render the mindmaps interface
function renderMindmapsTab() {
  const mindmaps = getMindmapsForCurrentLevel();
  const sidebarList = document.getElementById('mindmaps-list');
  if (!sidebarList) return;
  
  sidebarList.innerHTML = '';
  
  if (mindmaps.length === 0) {
    sidebarList.innerHTML = `<p class="text-muted">No mind maps available.</p>`;
    return;
  }
  
  // Default to first mindmap if none active or active ID doesn't exist in current level
  if (!currentState.activeMindmapId || !mindmaps.some(m => m.id === currentState.activeMindmapId)) {
    currentState.activeMindmapId = mindmaps[0].id;
    currentState.selectedNode = null;
  }
  
  mindmaps.forEach(mm => {
    const btn = document.createElement('button');
    btn.className = `mindmap-btn ${mm.id === currentState.activeMindmapId ? 'active' : ''}`;
    btn.onclick = () => {
      document.querySelectorAll('.mindmap-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentState.activeMindmapId = mm.id;
      currentState.selectedNode = null;
      closeNodeDetails();
      renderActiveMindmap();
    };
    
    btn.innerHTML = `
      <span class="title">${mm.title}</span>
    `;
    
    sidebarList.appendChild(btn);
  });
  
  renderActiveMindmap();
}

// Traverse the node tree recursively to assign unique IDs and parent references
function assignNodeIds(node, parentId = null) {
  node.id = `node-${nodeCounter++}`;
  node.parentId = parentId;
  if (node.children) {
    node.children.forEach(child => assignNodeIds(child, node.id));
  }
}

// Render the active mindmap tree by fetching and compiling the corresponding Markdown file
async function renderActiveMindmap() {
  const mindmaps = getMindmapsForCurrentLevel();
  const activeMmMetadata = mindmaps.find(m => m.id === currentState.activeMindmapId);
  if (!activeMmMetadata || !activeMmMetadata.file) return;
  
  const container = document.getElementById('mindmap-nodes-container');
  if (!container) return;
  
  container.innerHTML = `<div style="padding: 40px; color: var(--text-secondary); text-align: center;">Loading mind map...</div>`;
  
  try {
    // Fetch the markdown file contents
    const response = await fetch(activeMmMetadata.file);
    if (!response.ok) {
      throw new Error(`Failed to load mindmap file: ${response.statusText}`);
    }
    const mdText = await response.text();
    
    // Parse the markdown using the parser in mindmaps_data.js
    const compiledMm = parseMarkdownMindmap(mdText);
    if (!compiledMm || !compiledMm.root) {
      throw new Error('Failed to parse mindmap structure.');
    }
    
    // Inject Title and Description dynamically in viewport header
    const viewport = document.querySelector('.mindmap-viewport');
    if (viewport) {
      let header = viewport.querySelector('.mindmap-viewport-header');
      if (!header) {
        header = document.createElement('div');
        header.className = 'mindmap-viewport-header';
        header.style.padding = '24px 40px 12px 40px';
        header.style.borderBottom = '1px solid var(--border-color)';
        header.style.flexShrink = '0';
        header.style.background = 'rgba(17, 14, 33, 0.2)';
        viewport.insertBefore(header, viewport.firstChild);
      }
      header.innerHTML = `
        <h3 style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">${compiledMm.title}</h3>
        <p style="font-size: 0.85rem; color: var(--text-secondary);">${compiledMm.description}</p>
      `;
    }
    
    container.innerHTML = '';
    
    // Generate unique IDs and build flat lookup map
    nodeCounter = 0;
    assignNodeIds(compiledMm.root);
    
    const flatNodes = {};
    function flattenNodes(node) {
      flatNodes[node.id] = node;
      if (node.children) {
        node.children.forEach(flattenNodes);
      }
    }
    flattenNodes(compiledMm.root);
    currentState.mindmapNodes = flatNodes;
    
    // Render tree HTML recursively
    container.innerHTML = buildTreeHtml(compiledMm.root, 'root');
    
    // Restore node selection highlight if node still exists
    if (currentState.selectedNode && currentState.mindmapNodes[currentState.selectedNode.id]) {
      highlightNode(currentState.selectedNode.id);
    } else {
      closeNodeDetails();
    }
    
    // Reset scroll position so tree starts at the left on each render
    const canvasContainer = document.getElementById('mindmap-canvas-container');
    if (canvasContainer) {
      canvasContainer.scrollLeft = 0;
      canvasContainer.scrollTop = 0;
    }
    
    // Initialize Lucide icons
    lucide.createIcons();
    
    // Bind canvas size observer to redraw SVG connections
    setupCanvasObserver();
    
    // Trigger initial drawing of connections after layout renders
    setTimeout(() => {
      drawMindmapConnectors();
    }, 150);
    
  } catch (err) {
    console.error('Error loading mindmap:', err);
    container.innerHTML = `<div style="padding: 40px; color: var(--red); text-align: center;">Error loading mind map: ${err.message}</div>`;
  }
}

// Helper to extract clean node description for tree cards based on level/type
function getNodeCardDescription(node, type) {
  if (!node.description) return '';
  
  if (type !== 'root' && type !== 'branch') {
    // Lowest level nodes (leaves): show all text
    return node.description;
  }
  
  // Root and primary level nodes: slice up to the first mention of "interview tip" or "best practice"
  let desc = node.description;
  const lowerDesc = desc.toLowerCase();
  
  const tipTerms = ['interview tip', 'best practice', 'tip:', 'practice:'];
  let cutIdx = -1;
  
  for (const term of tipTerms) {
    const idx = lowerDesc.indexOf(term);
    if (idx !== -1) {
      if (cutIdx === -1 || idx < cutIdx) {
        cutIdx = idx;
      }
    }
  }
  
  if (cutIdx !== -1) {
    desc = desc.substring(0, cutIdx).trim();
    // Trim trailing punctuation marks
    while (desc.endsWith('.') || desc.endsWith(',') || desc.endsWith('-') || desc.endsWith(':')) {
      desc = desc.substring(0, desc.length - 1).trim();
    }
  } else {
    // If no tip/best practice term is found, cut at the first period/sentence to keep root/primary cards clean
    const firstPeriod = desc.indexOf('.');
    if (firstPeriod !== -1) {
      desc = desc.substring(0, firstPeriod).trim();
    }
  }
  
  return desc;
}

// Recursively builds the nested flex tree HTML structure
function buildTreeHtml(node, type) {
  if (type === 'root') {
    return `
      <div class="tree-level">
        <div class="tree-node node-root" data-node-id="${node.id}" onclick="onNodeClick('${node.id}')">
          <h5>${node.name}</h5>
          <p>${getNodeCardDescription(node, 'root')}</p>
        </div>
        ${node.children && node.children.length > 0 ? `
          <div class="tree-branches">
            ${node.children.map(child => buildTreeHtml(child, 'branch')).join('')}
          </div>
        ` : ''}
      </div>
    `;
  } else if (type === 'branch') {
    return `
      <div class="tree-branch-item">
        <div class="tree-node node-branch" data-node-id="${node.id}" onclick="onNodeClick('${node.id}')">
          <h5>${node.name}</h5>
          <p>${getNodeCardDescription(node, 'branch')}</p>
        </div>
        ${node.children && node.children.length > 0 ? `
          <div class="tree-leaves">
            ${node.children.map(child => buildTreeHtml(child, 'leaf')).join('')}
          </div>
        ` : ''}
      </div>
    `;
  } else {
    // Leaf node
    return `
      <div class="tree-node node-leaf" data-node-id="${node.id}" onclick="onNodeClick('${node.id}')">
        <h5>${node.name}</h5>
        <p>${getNodeCardDescription(node, 'leaf')}</p>
      </div>
    `;
  }
}

// Node click handler
function onNodeClick(nodeId) {
  const node = currentState.mindmapNodes ? currentState.mindmapNodes[nodeId] : null;
  if (!node) return;
  
  currentState.selectedNode = node;
  highlightNode(nodeId);
  
  const panel = document.getElementById('node-details-panel');
  const nameEl = document.getElementById('details-node-name');
  const contentEl = document.getElementById('details-node-content');
  
  if (panel && nameEl && contentEl) {
    nameEl.textContent = node.name;
    
    let html = `<p class="details-desc">${node.description || 'No explanation available.'}</p>`;
    
    if (node.tip) {
      html += `
        <div class="details-section">
          <span class="details-section-title">Interview Tip / Best Practice</span>
          <div class="details-tip-box">
            <i data-lucide="lightbulb" style="width: 16px; height: 16px; display: inline-block; vertical-align: middle; margin-right: 6px; color: var(--teal);"></i>
            <span>${node.tip}</span>
          </div>
        </div>
      `;
    }
    
    if (node.code) {
      // Escape HTML entities to prevent rendering tags
      const escapedCode = node.code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      html += `
        <div class="details-section">
          <span class="details-section-title">Example Code / Implementation</span>
          <pre class="details-code-box"><code>${escapedCode}</code></pre>
        </div>
      `;
    }
    
    contentEl.innerHTML = html;
    panel.classList.remove('hidden');
    
    lucide.createIcons();
  }
}

// Highlights selected node card in UI
function highlightNode(nodeId) {
  document.querySelectorAll('.tree-node').forEach(card => {
    card.classList.remove('active-node');
  });
  const nodeCard = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (nodeCard) nodeCard.classList.add('active-node');
}

// Closes detail panel and removes selection highlight
function closeNodeDetails() {
  currentState.selectedNode = null;
  document.querySelectorAll('.tree-node').forEach(card => {
    card.classList.remove('active-node');
  });
  
  const panel = document.getElementById('node-details-panel');
  if (panel) {
    panel.classList.add('hidden');
  }
}

// Draws smooth Bezier connector paths in the SVG canvas overlay
function drawMindmapConnectors() {
  const canvas = document.getElementById('mindmap-canvas');
  const svg = document.getElementById('mindmap-svg');
  if (!canvas || !svg) return;
  
  svg.innerHTML = '';
  
  const canvasRect = canvas.getBoundingClientRect();
  const nodes = currentState.mindmapNodes || {};
  
  // Resize SVG dimensions to fill the scrollable canvas area
  svg.setAttribute('width', canvas.scrollWidth);
  svg.setAttribute('height', canvas.scrollHeight);
  
  Object.values(nodes).forEach(node => {
    if (!node.parentId) return; // Root has no parent
    
    const parentCard = canvas.querySelector(`[data-node-id="${node.parentId}"]`);
    const childCard = canvas.querySelector(`[data-node-id="${node.id}"]`);
    
    if (parentCard && childCard) {
      const pRect = parentCard.getBoundingClientRect();
      const cRect = childCard.getBoundingClientRect();
      
      // Coordinates relative to canvas element
      const x1 = pRect.right - canvasRect.left;
      const y1 = pRect.top + pRect.height / 2 - canvasRect.top;
      const x2 = cRect.left - canvasRect.left;
      const y2 = cRect.top + cRect.height / 2 - canvasRect.top;
      
      // Control points for cubic bezier curve (smooth horizontal transition)
      const cp1x = x1 + (x2 - x1) * 0.45;
      const cp1y = y1;
      const cp2x = x1 + (x2 - x1) * 0.55;
      const cp2y = y2;
      
      let strokeColor = 'rgba(139, 92, 246, 0.45)'; // Violet default (Root -> Branch)
      if (childCard.classList.contains('node-leaf')) {
        strokeColor = 'rgba(20, 184, 166, 0.35)'; // Teal (Branch -> Leaf)
      }
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`);
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);
    }
  });
}

// Observe canvas changes to update lines dynamically
let canvasObserver = null;
function setupCanvasObserver() {
  const canvas = document.getElementById('mindmap-canvas');
  if (!canvas) return;
  
  if (canvasObserver) {
    canvasObserver.disconnect();
  }
  
  canvasObserver = new ResizeObserver(() => {
    if (currentState.activeTab === 'mindmaps') {
      drawMindmapConnectors();
    }
  });
  
  canvasObserver.observe(canvas);
}

// Redraw connections on window resize
window.addEventListener('resize', () => {
  if (currentState.activeTab === 'mindmaps') {
    drawMindmapConnectors();
  }
});
