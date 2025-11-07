// ===============================================
// PHASE 4: LIVE FEEDBACK PANEL FUNCTIONS
// Insert these functions into the roleplay section after displayScenario()
// ===============================================

// Initialize live feedback panel with scenario key points
function initializeLiveFeedback(scenario) {
  const keyPointsList = document.getElementById('live-key-points');
  if (!keyPointsList) return;

  const keyPoints = scenario.expectedKeyPoints || [];
  keyPointsList.innerHTML = keyPoints.map((point) => `
    <li class="point-item missing" data-point="${point}">
      <span class="point-icon">○</span>
      <span>${point}</span>
    </li>
  `).join('');

  // Reset all indicators
  updateLiveScore(0);
  updateToneIndicator('neutral');
  updateConfidenceLevel(0);
  updateWordCount(0);
}

// Handle live feedback as user types
function handleLiveFeedbackUpdate(event) {
  const textarea = event.target;
  const userResponse = textarea.value.trim();

  if (!userResponse) {
    // Reset to initial state if empty
    const scenario = sessionState.currentScenario;
    if (scenario) initializeLiveFeedback(scenario);
    return;
  }

  // Calculate real-time metrics
  const scenario = sessionState.currentScenario;
  if (!scenario) return;

  // Score the response in real-time
  const scoreResult = window.scoreResponse(
    userResponse,
    scenario.expectedKeyPoints || [],
    scenario.rubric?.keywords || [],
    scenario.rubric?.passThreshold || 70
  );

  // Update live feedback components
  updateLiveScore(scoreResult.score);
  updateKeyPointsLive(scoreResult.matchedPoints, scenario.expectedKeyPoints || []);
  updateToneIndicator(analyzeTone(userResponse));
  updateConfidenceLevel(analyzeConfidence(userResponse));
  updateWordCount(userResponse.split(/\s+/).length);
}

// Update live score circle
function updateLiveScore(score) {
  const scoreCircle = document.getElementById('live-score-circle');
  if (!scoreCircle) return;

  scoreCircle.textContent = Math.round(score).toString();

  // Update color based on score
  scoreCircle.classList.remove('score-low', 'score-medium', 'score-high');
  if (score < 70) {
    scoreCircle.classList.add('score-low');
  } else if (score < 85) {
    scoreCircle.classList.add('score-medium');
  } else {
    scoreCircle.classList.add('score-high');
  }
}

// Update key points with checkmarks
function updateKeyPointsLive(matchedPoints, allPoints) {
  const keyPointsList = document.getElementById('live-key-points');
  if (!keyPointsList) return;

  const pointItems = keyPointsList.querySelectorAll('.point-item');
  pointItems.forEach((item) => {
    const point = item.dataset.point || '';
    const isMatched = matchedPoints.some(mp =>
      point.toLowerCase().includes(mp.toLowerCase()) ||
      mp.toLowerCase().includes(point.toLowerCase())
    );

    if (isMatched) {
      item.classList.remove('missing');
      item.classList.add('matched');
      const icon = item.querySelector('.point-icon');
      if (icon) icon.textContent = '✓';
    } else {
      item.classList.remove('matched');
      item.classList.add('missing');
      const icon = item.querySelector('.point-icon');
      if (icon) icon.textContent = '○';
    }
  });
}

// Analyze tone of response
function analyzeTone(text) {
  const lowerText = text.toLowerCase();

  const positiveWords = ['great', 'excellent', 'wonderful', 'happy', 'glad', 'appreciate', 'thank', 'perfect', 'absolutely', 'understand', 'help'];
  const negativeWords = ['no', 'not', 'never', "can't", "won't", "don't", 'bad', 'unfortunately', 'problem', 'issue'];

  let positiveCount = 0;
  let negativeCount = 0;

  positiveWords.forEach(word => {
    if (lowerText.includes(word)) positiveCount++;
  });

  negativeWords.forEach(word => {
    if (lowerText.includes(word)) negativeCount++;
  });

  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

// Update tone indicator bar
function updateToneIndicator(tone) {
  const toneBar = document.getElementById('tone-bar');
  if (!toneBar) return;

  toneBar.classList.remove('positive', 'neutral', 'negative');
  toneBar.classList.add(tone);

  const toneLabels = {
    positive: 'Positive & Professional',
    neutral: 'Neutral',
    negative: 'Needs Improvement'
  };

  toneBar.textContent = toneLabels[tone];
}

// Analyze confidence level based on language patterns
function analyzeConfidence(text) {
  let confidence = 50; // Base confidence

  const lowerText = text.toLowerCase();

  // Confident language increases score
  const confidentPhrases = ['i can', 'i will', 'absolutely', 'definitely', 'certainly', 'guarantee', 'ensure'];
  confidentPhrases.forEach(phrase => {
    if (lowerText.includes(phrase)) confidence += 5;
  });

  // Weak language decreases score
  const weakPhrases = ['maybe', 'might', 'perhaps', 'i think', 'possibly', 'i guess', 'kind of', 'sort of'];
  weakPhrases.forEach(phrase => {
    if (lowerText.includes(phrase)) confidence -= 5;
  });

  // Good length indicates confidence
  const wordCount = text.split(/\s+/).length;
  if (wordCount >= 50 && wordCount <= 150) {
    confidence += 10;
  } else if (wordCount < 30) {
    confidence -= 10;
  } else if (wordCount > 200) {
    confidence -= 5;
  }

  return Math.max(0, Math.min(100, confidence));
}

// Update confidence meter
function updateConfidenceLevel(confidence) {
  const confidenceBar = document.getElementById('confidence-bar');
  if (!confidenceBar) return;

  confidenceBar.style.width = `${confidence}%`;
  confidenceBar.setAttribute('data-confidence', confidence.toString());
}

// Update word count
function updateWordCount(count) {
  const wordCountEl = document.getElementById('live-word-count');
  if (!wordCountEl) return;

  wordCountEl.textContent = count.toString();
}

// Toggle feedback panel collapsed/expanded
function setupFeedbackPanelToggle() {
  const toggleBtn = document.getElementById('toggle-feedback-panel');
  const feedbackPanel = document.getElementById('live-feedback-panel');
  const panelPreferenceKey = 'live-feedback-panel-collapsed';

  if (!toggleBtn || !feedbackPanel) return;

  // Load saved preference
  const savedState = localStorage.getItem(panelPreferenceKey);
  if (savedState === 'true') {
    feedbackPanel.classList.add('collapsed');
    toggleBtn.textContent = '+';
  }

  toggleBtn.addEventListener('click', () => {
    const isCollapsed = feedbackPanel.classList.toggle('collapsed');
    toggleBtn.textContent = isCollapsed ? '+' : '−';
    localStorage.setItem(panelPreferenceKey, isCollapsed.toString());
  });
}

// ADD THIS TO displayScenario() function at the end:
// ===================================================
/*
// Initialize live feedback panel with scenario key points
initializeLiveFeedback(scenario);

// Set up real-time feedback listener
if (responseTextarea) {
  responseTextarea.removeEventListener('input', handleLiveFeedbackUpdate);
  responseTextarea.addEventListener('input', handleLiveFeedbackUpdate);
}
*/

// ADD THIS TO the roleplay initialization section (after setupRoleSelection() and setupPersonalitySelection()):
// ===================================================
/*
setupFeedbackPanelToggle();
*/
