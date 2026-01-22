/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type, Chat } from '@google/genai';
import confetti from 'canvas-confetti';

// Resolve API key from injected env. Falls back gracefully if missing.
const rawApiKey = (process.env.API_KEY as string | undefined) || (process.env.GEMINI_API_KEY as string | undefined);
let ai: GoogleGenAI | null = null;
if (rawApiKey && rawApiKey.trim()) {
  ai = new GoogleGenAI({ apiKey: rawApiKey });
}

// Local storage keys and gating
const STORAGE_KEYS = {
  commitmentSigned: 'roof-er.commitmentSigned',
  managerMode: 'roof-er.managerMode',
  unlockedModules: 'roof-er.unlockedModules',
  currentModule: 'roof-er.currentModule',
  // Final Exam keys
  finalExamHistory: 'roof-er.finalExamHistory',
  certifiedStatus: 'roof-er.certifiedStatus',
  certificationDate: 'roof-er.certificationDate',
  examUserName: 'roof-er.examUserName',
  lastExamWrongAnswers: 'roof-er.lastExamWrongAnswers',
  // Session/Auth keys
  sessionToken: 'roof-er.sessionToken',
  userId: 'roof-er.userId',
  userName: 'roof-er.userName',
  userIsManager: 'roof-er.userIsManager',
  // Theme preference key
  themePreference: 'roof-er.themePreference'
};

// ============================================================================
// THEME MANAGEMENT - Night Mode Support
// ============================================================================

type ThemePreference = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEYS.themePreference);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function getEffectiveTheme(): 'light' | 'dark' {
  const preference = getThemePreference();
  return preference === 'system' ? getSystemTheme() : preference;
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeToggleUI(theme);
}

function setThemePreference(preference: ThemePreference): void {
  localStorage.setItem(STORAGE_KEYS.themePreference, preference);
  applyTheme(getEffectiveTheme());
}

function toggleTheme(): void {
  const currentEffective = getEffectiveTheme();
  const newTheme = currentEffective === 'light' ? 'dark' : 'light';
  setThemePreference(newTheme);
}

function updateThemeToggleUI(theme: 'light' | 'dark'): void {
  const toggles = document.querySelectorAll('.theme-toggle-btn');
  toggles.forEach(toggle => {
    const icon = toggle.querySelector('.theme-icon');
    const label = toggle.querySelector('.theme-label');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (label) label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  });
}

function initThemeSystem(): void {
  // Apply initial theme
  applyTheme(getEffectiveTheme());

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (getThemePreference() === 'system') {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

// Expose toggle function globally for onclick handlers
(window as any).toggleTheme = toggleTheme;

// Inject theme toggle into the content area (top-right of content cards)
function injectThemeToggle(): void {
  // Find the first content-card
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  const contentCard = mainContent.querySelector('.content-card');
  if (!contentCard) return;

  // Check if toggle already exists (prevent duplicates)
  if (document.getElementById('theme-toggle-container')) return;

  const currentTheme = getEffectiveTheme();
  const toggleContainer = document.createElement('div');
  toggleContainer.id = 'theme-toggle-container';
  toggleContainer.style.cssText = 'position: absolute; top: 15px; right: 15px; z-index: 100;';
  toggleContainer.innerHTML = `
    <button class="theme-toggle-btn" onclick="toggleTheme()" title="Toggle theme">
      <span class="theme-icon">${currentTheme === 'dark' ? '☀️' : '🌙'}</span>
      <span class="theme-label">${currentTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
    </button>
  `;

  // Make the content-card position relative for absolute positioning
  (contentCard as HTMLElement).style.position = 'relative';
  contentCard.prepend(toggleContainer);
}

// ============================================================================
// API & SESSION MANAGEMENT
// ============================================================================

const API_BASE = '/api';

interface User {
  id: string;
  name: string;
  isManager: boolean;
}

let currentUser: User | null = null;

// API call helper with auth token
async function apiCall<T>(endpoint: string, options?: RequestInit & { silent?: boolean }): Promise<T | null> {
  const silent = (options as any)?.silent;
  try {
    const token = localStorage.getItem(STORAGE_KEYS.sessionToken);
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options?.headers
      }
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));

      // Handle database unavailable - silently fail for tracking calls
      if (res.status === 503 || errorData.offline) {
        return null; // Database not available, use localStorage fallback
      }

      // Handle invalid token - clear session so user can re-login
      if (res.status === 401 && errorData.error === 'Invalid token') {
        // Don't clear session automatically - let user continue with localStorage
        if (!silent) console.warn('Session invalid - using offline mode');
        return null;
      }

      if (!silent) console.error('API error:', errorData);
      return null;
    }

    return res.json();
  } catch (error) {
    // Network errors are expected when offline - don't spam console
    if (!silent) console.warn('API unavailable, using offline mode');
    return null;
  }
}

// Check if user is logged in
function isLoggedIn(): boolean {
  return !!localStorage.getItem(STORAGE_KEYS.sessionToken);
}

// Get current user from storage
function getCurrentUser(): User | null {
  const userId = localStorage.getItem(STORAGE_KEYS.userId);
  const userName = localStorage.getItem(STORAGE_KEYS.userName);
  const isManager = localStorage.getItem(STORAGE_KEYS.userIsManager) === 'true';

  if (!userId || !userName) return null;
  return { id: userId, name: userName, isManager };
}

// Save user session to storage
function saveSession(userId: string, name: string, isManager: boolean, token: string): void {
  localStorage.setItem(STORAGE_KEYS.sessionToken, token);
  localStorage.setItem(STORAGE_KEYS.userId, userId);
  localStorage.setItem(STORAGE_KEYS.userName, name);
  localStorage.setItem(STORAGE_KEYS.userIsManager, isManager.toString());
  currentUser = { id: userId, name, isManager };

  // If manager, also set the old manager mode for compatibility
  if (isManager) {
    localStorage.setItem(STORAGE_KEYS.managerMode, 'true');
  }
}

// Clear session
function clearSession(): void {
  localStorage.removeItem(STORAGE_KEYS.sessionToken);
  localStorage.removeItem(STORAGE_KEYS.userId);
  localStorage.removeItem(STORAGE_KEYS.userName);
  localStorage.removeItem(STORAGE_KEYS.userIsManager);
  currentUser = null;
}

// Validate session with server
async function validateSession(): Promise<boolean> {
  const token = localStorage.getItem(STORAGE_KEYS.sessionToken);
  if (!token) return false;

  // If offline session, just check local storage
  if (token.startsWith('offline-')) {
    currentUser = getCurrentUser();
    return !!currentUser;
  }

  const result = await apiCall<{ valid: boolean; userId?: string; name?: string; isManager?: boolean }>('/auth/validate', {
    method: 'POST',
    body: JSON.stringify({ token })
  });

  if (result?.valid) {
    currentUser = { id: result.userId!, name: result.name!, isManager: result.isManager! };
    return true;
  }

  // Server unavailable - trust local storage
  if (result === null) {
    currentUser = getCurrentUser();
    return !!currentUser;
  }

  // Invalid session - clear it
  clearSession();
  return false;
}

// Login function
async function login(name: string, managerCode?: string): Promise<{ success: boolean; error?: string }> {
  const result = await apiCall<{ userId: string; name: string; isManager: boolean; token: string } | { error: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ name, managerCode: managerCode || undefined })
  });

  if (!result) {
    // Offline mode fallback - create a local session
    console.log('Server unavailable, using offline mode');
    const isManager = managerCode === MANAGER_CODE;
    const localId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    saveSession(localId, name, isManager, `offline-${localId}`);
    return { success: true };
  }

  if ('error' in result) {
    return { success: false, error: result.error };
  }

  saveSession(result.userId, result.name, result.isManager, result.token);
  return { success: true };
}

// Logout function
async function logout(): Promise<void> {
  await apiCall('/auth/logout', { method: 'POST' });
  clearSession();
  showLoginScreen();
}

// ============================================================================
// FINAL EXAM TYPE DEFINITIONS
// ============================================================================

interface MCQQuestion {
  id: string;
  module: number;
  question: string;
  options: string[];
  correctAnswer: number; // Index of correct option (0-3)
  explanation: string;
}

interface FIBQuestion {
  id: string;
  module: number;
  question: string; // Use _____ for blank
  acceptableAnswers: string[]; // Multiple valid answers
  explanation: string;
}

interface SAQuestion {
  id: string;
  module: number;
  prompt: string;
  keywords: string[]; // Keywords for scoring
  minKeywords: number; // Min keywords needed for full credit
  sampleAnswer: string;
}

interface ExamAttempt {
  attemptNumber: number;
  date: string;
  mcqScore: number;
  fibScore: number;
  saScore: number;
  totalScore: number;
  passed: boolean;
}

interface ExamState {
  attempts: ExamAttempt[];
  isCertified: boolean;
  certificationDate: string | null;
  userName: string;
}

interface WrongAnswer {
  type: 'mcq' | 'fib' | 'sa';
  questionNumber: number;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  explanation: string;
}

interface ExamDetailedResults {
  mcqCorrect: number;
  fibCorrect: number;
  saPoints: number;
  totalScore: number;
  passed: boolean;
  wrongAnswers: WrongAnswer[];
}

// ============================================================================
// FINAL EXAM QUESTION BANK (50 Questions)
// ============================================================================

const FINAL_EXAM_MCQ: MCQQuestion[] = [
  // Module 1: Company Basics (2 MCQ)
  { id: 'mcq-1', module: 1, question: 'Who is the CEO and founder of Roof E.R.?', options: ['Reese Samala', 'Ford Barsi', 'Oliver Brown', 'John Smith'], correctAnswer: 2, explanation: 'Oliver Brown founded Roof E.R. in 2019.' },
  { id: 'mcq-2', module: 1, question: 'What year was Roof E.R. founded?', options: ['2015', '2017', '2019', '2021'], correctAnswer: 2, explanation: 'Roof E.R. was founded in 2019.' },

  // Module 2: Commitment & Core Values (3 MCQ)
  { id: 'mcq-3', module: 2, question: 'What is Roof E.R.\'s primary mission?', options: ['Maximize profits', 'Hold fiduciary responsibility to customers', 'Sell the most roofs', 'Beat competitors'], correctAnswer: 1, explanation: 'Our mission is to hold fiduciary responsibility to customers - their interests come first.' },
  { id: 'mcq-4', module: 2, question: 'What are Roof E.R.\'s three core values?', options: ['Speed, Price, Volume', 'Integrity, Quality, Simplicity', 'Sales, Marketing, Service', 'Growth, Profit, Expansion'], correctAnswer: 1, explanation: 'Our core values are Integrity (do what\'s right), Quality (never settle for good enough), and Simplicity (make the process stress-free).' },
  { id: 'mcq-5', module: 2, question: 'According to Roof E.R.\'s values, what does "Integrity" mean?', options: ['Following company policies', 'Always do what\'s right for the homeowner, even when no one is watching', 'Maximizing sales numbers', 'Being faster than competitors'], correctAnswer: 1, explanation: 'Integrity means always doing what\'s right for the homeowner, even when no one is watching.' },

  // Module 4: Shingle Types & Materials (3 MCQ)
  { id: 'mcq-6', module: 4, question: 'Which statement best describes the GAF Timberline HDZ shingle we upgrade customers to?', options: ['A basic 3-tab shingle with a 60 mph wind rating', 'An architectural shingle with a reinforced nailing zone and strong wind rating', 'A metal panel system used on low-slope roofs', 'A clay tile designed for custom homes'], correctAnswer: 1, explanation: 'Timberline HDZ is an architectural shingle with a reinforced nailing zone and strong wind performance.' },
  { id: 'mcq-7', module: 4, question: 'Which shingle type is most commonly used in residential roofing?', options: ['Metal shingles', 'Asphalt', 'Clay tiles', 'Slate'], correctAnswer: 1, explanation: 'Asphalt shingles are the most common residential roofing material.' },
  { id: 'mcq-8', module: 4, question: 'What is a defining feature of architectural shingles compared to 3-tab?', options: ['Single-layer, flat profile', 'Multiple laminated layers that create a dimensional look', 'Only used on flat roofs', 'Made from clay tiles'], correctAnswer: 1, explanation: 'Architectural shingles use multiple laminated layers to create a dimensional appearance.' },

  // Module 5: Initial Pitch (3 MCQ)
  { id: 'mcq-9', module: 5, question: 'What GAF certification does Roof ER have?', options: ['GAF Certified Contractor', 'GAF Master Elite', 'GAF Preferred Partner', 'GAF Basic Installer'], correctAnswer: 1, explanation: 'Roof ER holds the GAF Master Elite certification, the highest level of GAF contractor certification.' },
  { id: 'mcq-10', module: 5, question: 'What does hail damage look like on asphalt shingles?', options: ['Straight line cracks', 'Round circular divots', 'Only color fading', 'Curled edges only'], correctAnswer: 1, explanation: 'Hail damage appears as round circular divots on asphalt shingles.' },
  { id: 'mcq-11', module: 5, question: 'If a homeowner says "Will my rates go up?", what is the best response?', options: ['Yes, they probably will', 'I understand your concern - rates cannot go up and an individual homeowner cannot be penalized for an act of God claim', 'You should not file then', 'I am not sure about insurance rates'], correctAnswer: 1, explanation: 'Following the objection framework, empathize and explain that rates cannot go up for act of God claims - individual homeowners are not penalized.' },

  // Module 6: Handling Initial Objections (3 MCQ)
  { id: 'mcq-12', module: 6, question: 'When a homeowner says "We already have a roofer," what is the best response?', options: ['That is fine, we will leave', 'Totally. I just need 15 minutes to check for storm damage and show you what I find. It is free and quick.', 'Our prices are lower than theirs', 'You should fire your current roofer'], correctAnswer: 1, explanation: 'Acknowledge their relationship and move straight to a quick, free inspection.' },
  { id: 'mcq-13', module: 6, question: 'What is non-negotiable number three?', options: ['Who you are', 'Who we are', 'Make it relatable', 'Go for the close'], correctAnswer: 2, explanation: 'Non-negotiable #3 is Make it relatable - connect with the homeowner through recent storms and helping neighbors.' },
  { id: 'mcq-14', module: 6, question: 'What\'s the best response to "I don\'t have time right now"?', options: ['Leave your card and hope they call', 'Insist on doing it now', 'I completely understand - if you only have five minutes, that\'s all it\'s going to take me', 'Say you\'ll come back another day'], correctAnswer: 2, explanation: 'Acknowledge their concern while reassuring them it only takes a few minutes - this keeps the opportunity alive without being pushy.' },

  // Module 8: Inspection Process (3 MCQ)
  { id: 'mcq-15', module: 8, question: 'Which of the following is NOT important to inspect during your initial inspection for storm damage?', options: ['Shingles and gutters', 'Damage to wood fences and concrete structures', 'Flashing and downspouts', 'Vents and valleys'], correctAnswer: 1, explanation: 'Wood fences and concrete are not part of the roof inspection - focus on shingles, gutters, flashing, downspouts, vents, and valleys.' },
  { id: 'mcq-16', module: 8, question: 'What is the first step to overcoming an objection?', options: ['Argue with the homeowner', 'React positively', 'Walk away', 'Offer a discount'], correctAnswer: 1, explanation: 'The first step to overcoming an objection is to react positively - stay calm and empathize.' },
  { id: 'mcq-17', module: 8, question: 'What is an appropriate response to the objection "I\'ll think about it"?', options: ['Leave your card and hope they call', 'Ask what specifically they need to think about to address their concern', 'Apply heavy pressure to sign now', 'Tell them they are making a mistake'], correctAnswer: 1, explanation: 'Ask what specifically they need to think about - this helps uncover and address their real concern.' },

  // Module 9: Post-Inspection Pitch (3 MCQ)
  { id: 'mcq-18', module: 9, question: 'What is the best response to "I don\'t have time right now" during post-inspection?', options: ['Leave and never return', 'I completely understand - you can go back and finish what you\'re doing, I\'ll go ahead and run up and do that inspection', 'Tell them you\'ll only take 2 minutes', 'Ask them to call you later'], correctAnswer: 1, explanation: 'Let them know they can continue their activities while you do the inspection - this respects their time while keeping the opportunity.' },
  { id: 'mcq-19', module: 9, question: 'Which of the following is an example of wind damage on a roof?', options: ['Round circular divots', 'Missing tabs', 'Granule loss in a circle', 'Soft spots'], correctAnswer: 1, explanation: 'Missing tabs are a sign of wind damage on a roof.' },
  { id: 'mcq-20', module: 9, question: 'What is the name of the form the customer signs that protects them by saying we only do work if we get them fully approved through their insurance?', options: ['Work Order Agreement', 'Contingency Agreement', 'Insurance Form', 'Payment Contract'], correctAnswer: 1, explanation: 'The Contingency Agreement protects the customer - we only do the work if they get fully approved by insurance.' },

  // Module 10: Post-Inspection Objections (3 MCQ)
  { id: 'mcq-21', module: 10, question: 'When a homeowner says "My rates will go up," what\'s the best response?', options: ['That\'s probably true', 'Rates increase due to regional claims, not individual claims, and not filing means $20K+ later', 'Don\'t file then', 'I don\'t know about insurance'], correctAnswer: 1, explanation: 'Explain rates increase regionally regardless, and not filing now means huge out-of-pocket costs later.' },
  { id: 'mcq-22', module: 10, question: 'How do you handle "I need to talk to my spouse"?', options: ['Call them yourself', 'Leave and hope they call back', 'Ask when the spouse will be available and schedule a time to meet together', 'Tell them to convince their spouse'], correctAnswer: 2, explanation: 'Schedule a time to meet when both decision-makers are present.' },
  { id: 'mcq-23', module: 10, question: 'What\'s the response to "I don\'t trust insurance claims"?', options: ['You shouldn\'t trust them', 'This is what you PAY insurance for - it\'s your right to file', 'Don\'t file then', 'Insurance is always trustworthy'], correctAnswer: 1, explanation: 'Remind them this is exactly what they pay premiums for - it\'s their right to use it.' },

  // Module 7: Damage Identification (3 MCQ)
  { id: 'mcq-24', module: 7, question: 'What does hail damage look like on asphalt shingles?', options: ['Straight cracks', 'Round bruises with granule loss and soft spots', 'Only missing shingles', 'Color changes only'], correctAnswer: 1, explanation: 'Hail causes round bruises with granule loss and creates soft spots when pressed.' },
  { id: 'mcq-25', module: 7, question: 'What is considered wind damage on a roof?', options: ['Round spots', 'Lifted, creased, or missing shingles', 'Granule loss only', 'Color fading'], correctAnswer: 1, explanation: 'Wind damage shows as lifted edges, creased shingles, or completely missing shingles.' },
  { id: 'mcq-26', module: 7, question: 'What is the first step in the Empathy Framework when handling objections?', options: ['Educate them on the process', 'Offer a solution right away', 'Acknowledge their concern', 'Ask for the sale'], correctAnswer: 2, explanation: 'The first step in the Empathy Framework is to acknowledge their concern - show you understand before educating.' },

  // Module 11: Filing the Claim & Contingency + Claim Authorization Script
  { id: 'mcq-27', module: 11, question: 'When is the BEST time to file a claim?', options: ['Within a week', 'Same day - immediately', 'After getting other estimates', 'After the adjuster visits'], correctAnswer: 1, explanation: 'File the claim the same day, immediately after finding damage - timing is critical for insurance claims.' },
  { id: 'mcq-28', module: 11, question: 'What is a supplement in the insurance claim process?', options: ['A vitamin', 'Additional documentation for work not covered in initial estimate', 'The homeowner\'s payment', 'A second insurance policy'], correctAnswer: 1, explanation: 'A supplement requests additional funds for work discovered after the initial estimate.' },
  { id: 'mcq-29', module: 11, question: 'Who typically meets with the insurance adjuster at the property?', options: ['Only the homeowner', 'The Roof E.R. representative', 'The neighbor', 'No one - it\'s done remotely'], correctAnswer: 1, explanation: 'A Roof E.R. representative meets the adjuster to ensure all damage is properly documented.' },

  { id: 'mcq-30', module: 11, question: 'What is the "Assumptive Close"?', options: ['Assuming they won\'t buy', 'Acting as if they\'ve already agreed and moving to next steps', 'Assuming the insurance will deny', 'Guessing their concerns'], correctAnswer: 1, explanation: 'Assumptive close: proceed as if they\'ve said yes - "I\'ll get that contract texted to you now."' },
  { id: 'mcq-31', module: 11, question: 'The homeowner says "I want to get other quotes." Best response?', options: ['Fine, get 10 quotes', 'Explain you\'re a claims specialist, not just a roofer, and what sets you apart', 'Lower your price immediately', 'Criticize other companies'], correctAnswer: 1, explanation: 'Differentiate by explaining you\'re a claims specialist who handles insurance, not just a roofer.' },
  { id: 'mcq-32', module: 11, question: 'What should you do immediately after getting a signature?', options: ['Leave quickly', 'Set clear next-step expectations and timeline', 'Ask for referrals only', 'Nothing - job is done'], correctAnswer: 1, explanation: 'Set clear expectations: what happens next, when they\'ll hear from you, timeline for process.' },

  // Module 12: Sales Cycle & Job Flow (3 MCQ)
  { id: 'mcq-33', module: 12, question: 'What are the 5 phases of the Roof E.R. sales cycle?', options: ['Call, Sell, Install, Bill, Collect', 'Generating New Business, Adjuster Meeting, Project Meeting, Installation, Final Payment', 'Knock, Pitch, Sign, Build, Done', 'Advertise, Estimate, Contract, Build, Invoice'], correctAnswer: 1, explanation: 'The 5 phases are: Generating New Business → Adjuster Meeting → Project Meeting → Installation → Final Payment.' },
  { id: 'mcq-34', module: 12, question: 'How long does the total Roof E.R. sales cycle typically take from start to finish?', options: ['1-2 weeks', '3-4 weeks', '9-16 weeks', '6-12 months'], correctAnswer: 2, explanation: 'The complete sales cycle from initial knock to final payment typically takes 9-16 weeks.' },
  { id: 'mcq-35', module: 12, question: 'What are the main stages of the Roof E.R. sales cycle?', options: ['Call, Sell, Install', 'Knock, Inspect, File claim, Meet adjuster, Install, Collect', 'Email, Quote, Invoice', 'Advertise, Estimate, Build'], correctAnswer: 1, explanation: 'Full cycle: Door knock → Inspection → File claim → Adjuster meeting → Installation → Collection.' }
];

const FINAL_EXAM_FIB: FIBQuestion[] = [
  // Hail damage presentation
  { id: 'fib-1', module: 7, question: 'When presenting a hail damage photo to your customer, you should say: "This is exactly what I was looking for. As you can see, it is _____."', acceptableAnswers: ['round', 'Round', 'ROUND'], explanation: 'Hail damage appears as round circular divots on asphalt shingles.' },

  // Non-negotiable #2
  { id: 'fib-2', module: 5, question: 'Non-negotiable number two states who we are and what we _____.', acceptableAnswers: ['do', 'Do', 'DO'], explanation: 'Non-negotiable #2 covers who we are (Roof ER) and what we do (handle insurance claims and roofing).' },

  // Non-negotiable #5 - going for the close
  { id: 'fib-3', module: 5, question: 'Non-negotiable number five is going for the close. That means you want to secure the _____.', acceptableAnswers: ['inspection', 'Inspection', 'INSPECTION'], explanation: 'Going for the close means securing the inspection appointment.' },

  // Talk to spouse objection
  { id: 'fib-4', module: 6, question: 'If the objection you get at the door is that they need to talk to their spouse, you should let them know that you understand and ask them "_____ are they available?"', acceptableAnswers: ['when', 'When', 'WHEN'], explanation: 'Ask when the spouse will be available so you can schedule a follow-up.' },

  // Company leadership - GM
  { id: 'fib-5', module: 1, question: 'The general manager of Roof ER is _____ _____.', acceptableAnswers: ['Ford Barsi', 'ford barsi', 'FORD BARSI', 'Ford barsi'], explanation: 'Ford Barsi is the General Manager of Roof ER.' },

  // Company leadership - Founder
  { id: 'fib-6', module: 1, question: 'Roof ER was founded by _____ _____.', acceptableAnswers: ['Oliver Brown', 'oliver brown', 'OLIVER BROWN', 'Oliver brown'], explanation: 'Oliver Brown is the founder of Roof ER.' },

  // Company leadership - Director of Sales
  { id: 'fib-7', module: 1, question: 'The director of sales of Roof ER is _____ _____.', acceptableAnswers: ['Reese Samala', 'reese samala', 'REESE SAMALA', 'Reese samala'], explanation: 'Reese Samala is the Director of Sales at Roof ER.' },

  // Wind damage
  { id: 'fib-8', module: 7, question: 'Examples of _____ damage are missing tabs and creased shingles.', acceptableAnswers: ['wind', 'Wind', 'WIND'], explanation: 'Wind damage is characterized by missing tabs and creased shingles.' },

  // Depreciation holdback
  { id: 'fib-9', module: 11, question: 'The remaining insurance funds that the insurance company holds until we complete the work are called _____.', acceptableAnswers: ['depreciation', 'Depreciation', 'DEPRECIATION', 'depreciation holdback', 'Depreciation Holdback'], explanation: 'The depreciation holdback is released by the insurance company after the work is completed.' },

  // Assumptive close
  { id: 'fib-10', module: 11, question: 'The _____ close means acting as if they\'ve already agreed and moving forward.', acceptableAnswers: ['assumptive', 'Assumptive', 'ASSUMPTIVE'], explanation: 'The assumptive close proceeds as if they\'ve already said yes.' }
];

const FINAL_EXAM_SA: SAQuestion[] = [
  // Non-negotiable #1 - Who you are
  { id: 'sa-1', module: 5, prompt: 'Please write the section of your pitch that covers Non-Negotiable #1: Who you are.', keywords: ['name', 'my name is', 'hi', 'hello', 'introduce'], minKeywords: 2, sampleAnswer: 'Hi, my name is [Name].' },

  // Non-negotiable #2 - Who we are and what we do
  { id: 'sa-2', module: 5, prompt: 'Please write the section of your pitch that covers Non-Negotiable #2: Who we are and what we do.', keywords: ['Roof ER', 'roofing', 'company', 'insurance', 'claims', 'storm', 'restoration', 'DC area', 'local'], minKeywords: 3, sampleAnswer: 'I\'m with Roof ER. We\'re a local roofing company that specializes in insurance claims and storm restoration in the DC area.' },

  // Non-negotiable #3 - Make it relatable
  { id: 'sa-3', module: 5, prompt: 'Please write the section of your pitch that covers Non-Negotiable #3: Make it relatable.', keywords: ['storm', 'storms', 'neighbors', 'neighborhood', 'area', 'recently', 'helping', 'claims'], minKeywords: 3, sampleAnswer: 'We\'ve had some big storms recently and we\'ve been helping a lot of your neighbors file claims. We\'ve been working all through the neighborhood.' },

  // Non-negotiable #4 - What you're there to do
  { id: 'sa-4', module: 5, prompt: 'Please write the section of your pitch that covers Non-Negotiable #4: What you\'re there to do.', keywords: ['free', 'inspection', '15 minutes', 'damage', 'roof', 'look', 'check'], minKeywords: 3, sampleAnswer: 'I\'m going to offer you a completely free inspection. It only takes about 15 minutes and I\'ll check your roof for any storm damage.' },

  // Non-negotiable #5 - Go for the close (over close)
  { id: 'sa-5', module: 5, prompt: 'Please write the section of your pitch that covers Non-Negotiable #5: Go for the close (over close).', keywords: ['find', 'damage', 'walk', 'through', 'process', 'don\'t', 'good shape', 'let you know'], minKeywords: 2, sampleAnswer: 'If I find damage, I\'ll walk you through the rest of the process. If I don\'t find damage, I\'ll let you know you\'re in good shape.' },

  // After homeowner agrees to inspection
  { id: 'sa-6', module: 8, prompt: 'After the homeowner agrees to do the inspection right then, what will you tell them?', keywords: ['card', 'business card', 'roof', 'go up', 'look', 'back', 'minute', 'minutes', 'wait', 'inside'], minKeywords: 3, sampleAnswer: 'Great! Let me give you my card. I\'m going to go up on your roof and take a look. It should only take about 15 minutes. You can wait inside and I\'ll come back down to show you what I find.' },

  // After handing card, before inspection
  { id: 'sa-7', module: 8, prompt: 'After you\'ve handed your homeowner your business card, what do you let them know before you conduct the inspection?', keywords: ['look us up', 'online', 'knock', 'finish', 'back', 'done', 'let you know'], minKeywords: 2, sampleAnswer: 'Take a moment to look us up online. I\'ll give you a knock when I finish up.' },

  // Order of inspection
  { id: 'sa-8', module: 8, prompt: 'Please write the order of the inspection (what do you inspect and in what order?).', keywords: ['safety', '360', 'collateral', 'roof', 'shingles', 'overview', 'granules', 'gutters', 'downspouts'], minKeywords: 3, sampleAnswer: 'Safety first, 360 walk for ground collateral, roof collateral damage, shingle inspection, damage overview shots, and granules in gutters/downspouts.' },

  // Collateral damage explanation
  { id: 'sa-9', module: 9, prompt: 'After you finish the inspection, please write what you would explain to your homeowner about collateral damage.', keywords: ['collateral', 'damage', 'evidence', 'prove', 'hail', 'property', 'find', 'hit'], minKeywords: 3, sampleAnswer: 'This is the damage we need to find to prove that hail hit your property. Collateral damage serves as evidence that a storm event occurred and affected your home.' },

  // Most important step - post-inspection script
  { id: 'sa-10', module: 9, prompt: 'What is the purpose of the post-inspection script and what do you tell them is the most important part of this process moving forward?', keywords: ['adjuster', 'inspection', 'present', 'there', 'insurance', 'fair shake', 'fair', 'I am there', 'we are there'], minKeywords: 3, sampleAnswer: 'The most important part of this process is that I am there when the insurance company sends their adjuster out to do their inspection so that you can get a fair shake.' }
];

// Manager access code (managers enter this to unlock all)
const MANAGER_CODE = 'roofer2024';

// Module order for progressive unlocking
const MODULE_ORDER = [
  'welcome',
  'commitment',
  'general-knowledge',
  'shingle-types-materials',
  'initial-pitch',
  'handling-initial-pitch-objections',
  'damage-identification',
  'inspection-process',
  'post-inspection-pitch',
  'post-inspection-objections',
  'filing-claim-closing',
  'sales-cycle-job-flow',
  'role-play',
  'final-exam'
];

// ============================================================================
// MODULE ENGAGEMENT TRACKING SYSTEM
// ============================================================================

// Requirements per module for completion button to appear
interface ModuleRequirements {
  needsVideo?: boolean;
  needsQuiz?: boolean;
  needsTime?: number; // seconds
  needsScroll: boolean;
}

const MODULE_REQUIREMENTS: Record<string, ModuleRequirements> = {
  'welcome': { needsVideo: true, needsScroll: true },
  'commitment': { needsScroll: true }, // Special: handled by existing gate logic
  'general-knowledge': { needsTime: 60, needsScroll: true },
  'shingle-types-materials': { needsTime: 60, needsScroll: true },
  'initial-pitch': { needsTime: 60, needsScroll: true },
  'handling-initial-pitch-objections': { needsTime: 60, needsScroll: true },
  'inspection-process': { needsQuiz: true, needsScroll: true },
  'post-inspection-pitch': { needsTime: 60, needsScroll: true },
  'post-inspection-objections': { needsTime: 60, needsScroll: true },
  'damage-identification': { needsQuiz: true, needsScroll: true },
  'filing-claim-closing': { needsQuiz: true, needsScroll: true },
  'sales-cycle-job-flow': { needsTime: 60, needsScroll: true },
  'role-play': { needsScroll: true }, // Special: unlock when role-play starts
  'final-exam': { needsQuiz: true, needsScroll: true },
};

// Engagement state per module
interface ModuleEngagement {
  scrolledToBottom: boolean;
  timeSpent: number;
  videoWatched: boolean;
  quizPassed: boolean;
}

const moduleEngagement: Record<string, ModuleEngagement> = {};
let currentModuleForEngagement: string | null = null;
let engagementTimeInterval: number | null = null;
let moduleStartTime: number | null = null;
let scrollListener: (() => void) | null = null;

// Lazy initialization helper for moduleEngagement - ensures module exists before access
function ensureModuleEngagement(moduleName: string): ModuleEngagement {
  if (!moduleEngagement[moduleName]) {
    moduleEngagement[moduleName] = {
      scrolledToBottom: false,
      timeSpent: 0,
      videoWatched: false,
      quizPassed: false,
    };
  }
  return moduleEngagement[moduleName];
}

// ============================================================================
// MODULE CLEANUP REGISTRY - Prevents memory leaks from event listeners
// ============================================================================
type CleanupFunction = () => void;
const moduleCleanupFunctions: CleanupFunction[] = [];

function registerModuleCleanup(cleanup: CleanupFunction): void {
  moduleCleanupFunctions.push(cleanup);
}

function cleanupCurrentModule(): void {
  moduleCleanupFunctions.forEach(fn => {
    try { fn(); } catch (e) { console.warn('Module cleanup error:', e); }
  });
  moduleCleanupFunctions.length = 0; // Clear the array
}

// Initialize engagement state for a module
function initModuleEngagement(moduleName: string) {
  // Stop previous tracking
  stopEngagementTracking();

  currentModuleForEngagement = moduleName;

  // Initialize or restore engagement state
  if (!moduleEngagement[moduleName]) {
    moduleEngagement[moduleName] = {
      scrolledToBottom: false,
      timeSpent: 0,
      videoWatched: false,
      quizPassed: false,
    };
  }

  // Check if video was already watched (from localStorage)
  const requirements = MODULE_REQUIREMENTS[moduleName];
  if (requirements?.needsVideo) {
    const watchedKey = `video-watched-welcome-video`;
    if (localStorage.getItem(watchedKey) === 'true') {
      moduleEngagement[moduleName].videoWatched = true;
    }
  }

  // Start tracking
  startScrollTracking(moduleName);
  startEngagementTimeTracking(moduleName);

  // Initial check
  checkModuleCompletion(moduleName);
}

// Start scroll tracking
function startScrollTracking(moduleName: string) {
  const mainContentEl = document.getElementById('main-content');
  if (!mainContentEl) return;

  scrollListener = () => {
    const scrollTop = mainContentEl.scrollTop;
    const scrollHeight = mainContentEl.scrollHeight;
    const clientHeight = mainContentEl.clientHeight;

    // Within 100px of bottom = scrolled to bottom
    if (scrollTop + clientHeight >= scrollHeight - 100) {
      if (moduleEngagement[moduleName] && !moduleEngagement[moduleName].scrolledToBottom) {
        moduleEngagement[moduleName].scrolledToBottom = true;
        updateRequirementIndicator(moduleName, 'scroll', true);
        checkModuleCompletion(moduleName);
      }
    }
  };

  mainContentEl.addEventListener('scroll', scrollListener);
}

// Start time tracking
function startEngagementTimeTracking(moduleName: string) {
  moduleStartTime = Date.now();

  engagementTimeInterval = window.setInterval(() => {
    if (moduleStartTime && moduleEngagement[moduleName]) {
      const elapsed = Math.floor((Date.now() - moduleStartTime) / 1000);
      moduleEngagement[moduleName].timeSpent = elapsed;

      // Update time indicator
      const requirements = MODULE_REQUIREMENTS[moduleName];
      if (requirements?.needsTime) {
        const remaining = Math.max(0, requirements.needsTime - elapsed);
        const timeEl = document.getElementById('req-time');
        if (timeEl) {
          if (remaining > 0) {
            timeEl.innerHTML = `<span class="req-icon">&#9711;</span> Read for ${remaining}s more`;
            timeEl.className = 'requirement-item pending';
          } else {
            timeEl.innerHTML = `<span class="req-icon">&#10003;</span> Time requirement met`;
            timeEl.className = 'requirement-item complete';
          }
        }
      }

      checkModuleCompletion(moduleName);
    }
  }, 1000);
}

// Stop all engagement tracking
function stopEngagementTracking() {
  if (engagementTimeInterval) {
    clearInterval(engagementTimeInterval);
    engagementTimeInterval = null;
  }
  moduleStartTime = null;

  if (scrollListener) {
    const mainContentEl = document.getElementById('main-content');
    if (mainContentEl) {
      mainContentEl.removeEventListener('scroll', scrollListener);
    }
    scrollListener = null;
  }
}

// Update a requirement indicator
function updateRequirementIndicator(moduleName: string, type: 'scroll' | 'video' | 'quiz' | 'time', complete: boolean) {
  const elementId = `req-${type}`;
  const el = document.getElementById(elementId);
  if (el) {
    el.className = `requirement-item ${complete ? 'complete' : 'pending'}`;
    const icon = complete ? '&#10003;' : '&#9711;';
    const text = el.getAttribute('data-text') || el.textContent || '';
    el.innerHTML = `<span class="req-icon">${icon}</span> ${text.replace(/^[^\s]+\s*/, '')}`;
  }
}

// Mark video as watched in engagement state (uses lazy init to prevent silent failures)
function markVideoWatched(moduleName: string) {
  const engagement = ensureModuleEngagement(moduleName);
  engagement.videoWatched = true;
  updateRequirementIndicator(moduleName, 'video', true);
  checkModuleCompletion(moduleName);
}

// Mark quiz as passed in engagement state (uses lazy init to prevent silent failures)
function markQuizPassed(moduleName: string) {
  const engagement = ensureModuleEngagement(moduleName);
  engagement.quizPassed = true;
  updateRequirementIndicator(moduleName, 'quiz', true);
  checkModuleCompletion(moduleName);
}

// Check if all requirements are met and show/hide completion button
function checkModuleCompletion(moduleName: string) {
  const requirements = MODULE_REQUIREMENTS[moduleName];
  const engagement = moduleEngagement[moduleName];

  if (!requirements || !engagement) return;

  let canComplete = true;

  // Check scroll
  if (requirements.needsScroll && !engagement.scrolledToBottom) {
    canComplete = false;
  }

  // Check time
  if (requirements.needsTime && engagement.timeSpent < requirements.needsTime) {
    canComplete = false;
  }

  // Check video
  if (requirements.needsVideo && !engagement.videoWatched) {
    canComplete = false;
  }

  // Check quiz
  if (requirements.needsQuiz && !engagement.quizPassed) {
    canComplete = false;
  }

  // Show/hide completion button
  const section = document.getElementById('module-complete-section');
  if (section) {
    if (canComplete) {
      section.style.display = 'block';
      section.classList.add('revealed');
    } else {
      section.style.display = 'none';
      section.classList.remove('revealed');
    }
  }
}

// Expose engagement functions globally for use in onclick handlers
(window as any).markVideoWatched = markVideoWatched;
(window as any).markQuizPassed = markQuizPassed;

// Check if manager mode is active (either via old toggle or new login system)
function isManagerMode(): boolean {
  // Check new login system first
  if (localStorage.getItem(STORAGE_KEYS.userIsManager) === 'true') return true;
  // Fallback to old toggle method
  return localStorage.getItem(STORAGE_KEYS.managerMode) === 'true';
}

// Get unlocked modules for regular users
function getUnlockedModules(): string[] {
  if (isManagerMode()) return MODULE_ORDER; // All unlocked for managers
  const stored = localStorage.getItem(STORAGE_KEYS.unlockedModules);
  return stored ? JSON.parse(stored) : ['welcome', 'commitment'];
}

// Unlock the next module
function unlockNextModule(currentModule: string) {
  if (isManagerMode()) return; // Managers don't need this
  const unlocked = getUnlockedModules();
  const currentIndex = MODULE_ORDER.indexOf(currentModule);
  if (currentIndex >= 0 && currentIndex < MODULE_ORDER.length - 1) {
    const nextModule = MODULE_ORDER[currentIndex + 1];
    if (!unlocked.includes(nextModule)) {
      unlocked.push(nextModule);
      localStorage.setItem(STORAGE_KEYS.unlockedModules, JSON.stringify(unlocked));
      updateSidebarLocks();
    }
  }
}

// Update sidebar to show locked/unlocked states
function updateSidebarLocks() {
  const unlocked = getUnlockedModules();
  const items = sidebar?.querySelectorAll('li[data-module]');
  const currentModuleName = localStorage.getItem(STORAGE_KEYS.currentModule) || '';

  items?.forEach((item, index) => {
    const moduleName = (item as HTMLElement).dataset.module || '';

    // Remove all state classes first
    item.classList.remove('locked', 'unlocked', 'completed', 'current');

    // My Page and admin-dashboard are never locked
    if (moduleName === 'my-page' || moduleName === 'admin-dashboard') {
      item.classList.add('unlocked');
      // Add dashboard-link-glass for My Page
      if (moduleName === 'my-page') {
        item.classList.add('dashboard-link-glass');
      }
    } else if (unlocked.includes(moduleName)) {
      item.classList.add('unlocked');

      // Check if this is the current module
      if (moduleName === currentModuleName) {
        item.classList.add('current');
      }

      // Check if modules after this one are unlocked (simple heuristic for completion)
      const moduleIndex = MODULE_ORDER.indexOf(moduleName);
      if (moduleIndex >= 0) {
        const nextModule = MODULE_ORDER[moduleIndex + 1];
        if (nextModule && unlocked.includes(nextModule)) {
          item.classList.add('completed');
        }
      }
    } else {
      item.classList.add('locked');
    }
  });
}

// Toggle manager mode
function toggleManagerMode(code: string): boolean {
  if (code === MANAGER_CODE) {
    localStorage.setItem(STORAGE_KEYS.managerMode, 'true');
    updateSidebarLocks();
    return true;
  }
  return false;
}

// Exit manager mode
function exitManagerMode() {
  localStorage.removeItem(STORAGE_KEYS.managerMode);
  updateSidebarLocks();
}

const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('main-content');
let chat: Chat | null = null; // To hold the chat instance

// ============================================================================
// AGNES-21 LIVE VOICE ROLEPLAY SYSTEM
// ============================================================================

// Agnes-21 Audio Utilities
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioDataPCM(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createPcmBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
  }
  return {
    data: arrayBufferToBase64(int16.buffer),
    mimeType: 'audio/pcm;rate=16000',
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Agnes-21 Live State Management
interface AgnesLiveState {
  isConnected: boolean;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isSpeaking: boolean;
  aiSpeaking: boolean;
  inputMode: 'voice' | 'text';
  currentScore: number | null;
  transcript: Array<{ role: 'user' | 'agnes'; text: string; timestamp: Date }>;
  difficulty: string;
  sessionXP: number;
  currentStreak: number;
  mistakeCount: number;
  selectedRole: string | null;
  sessionStartTime: number;
  sessionActive: boolean;
}

const agnesLiveState: AgnesLiveState = {
  isConnected: false,
  isMuted: false,
  isVideoEnabled: true,
  isSpeaking: false,
  aiSpeaking: false,
  inputMode: 'voice',
  currentScore: null,
  transcript: [],
  difficulty: 'BEGINNER',
  sessionXP: 0,
  currentStreak: 0,
  mistakeCount: 0,
  selectedRole: null,
  sessionStartTime: Date.now(),
  sessionActive: false
};

// Agnes-21 Live Module-level variables
let agnesInputAudioContext: AudioContext | null = null;
let agnesOutputAudioContext: AudioContext | null = null;
let agnesMediaStream: MediaStream | null = null;
let agnesSessionPromise: Promise<any> | null = null;
let agnesAudioSources: Set<AudioBufferSourceNode> = new Set();
let agnesNextStartTime = 0;
let agnesMediaRecorder: MediaRecorder | null = null;
let agnesRecordedChunks: Blob[] = [];
let agnesFrameIntervalId: number | null = null;
let agnesAnalyserNode: AnalyserNode | null = null;
let agnesMicAnalyserNode: AnalyserNode | null = null;
let agnesAiClient: any = null;

// Agnes-21 Difficulty Configuration
const AGNES_DIFFICULTY_LEVELS: Record<string, { multiplier: number; unlockLevel: number; mistakes: number; description: string }> = {
  BEGINNER: { multiplier: 1.0, unlockLevel: 1, mistakes: Infinity, description: 'The Eager Learner - Never slams door' },
  ROOKIE: { multiplier: 1.2, unlockLevel: 3, mistakes: 5, description: 'The Friendly Neighbor - Very patient' },
  PRO: { multiplier: 1.5, unlockLevel: 7, mistakes: 3, description: 'The Busy Parent - Realistic pressure' },
  ELITE: { multiplier: 2.0, unlockLevel: 12, mistakes: 2, description: 'The Skeptic - Low tolerance' },
  NIGHTMARE: { multiplier: 3.0, unlockLevel: 20, mistakes: 1, description: 'The Lawyer - Instant slam' }
};

// Agnes-21 Personas for each difficulty
const AGNES_PERSONAS: Record<string, { name: string; icon: string; description: string }[]> = {
  BEGINNER: [{
    name: 'The Eager Learner',
    icon: '🌱',
    description: `You are a homeowner who WANTS roofing help and guides the rep to success.
You've been looking for a roofer and are excited someone knocked on your door. You actively help them practice.
- Enthusiastically engage: "Oh great! I've been meaning to get my roof looked at!"
- Ask guiding questions: "So you do inspections? That's perfect!"
- Celebrate their successes: "That makes total sense!"
- NEVER slam the door - infinite patience`
  }],
  ROOKIE: [{
    name: 'The Friendly Neighbor',
    icon: '🏡',
    description: `You are a retired homeowner who enjoys chatting and wants them to succeed.
- Be warm and welcoming: "Oh hello! How are you today?"
- Ask gentle questions to help them
- Agree to inspection easily if they ask properly
- Door slam after 5 major mistakes`
  }],
  PRO: [{
    name: 'The Busy Parent',
    icon: '👨‍👩‍👧',
    description: `You are making dinner with loud kids in background. Limited time.
- Show time pressure: "I've only got a few minutes"
- Interrupt if they ramble
- Get impatient if too salesy
- Door slam after 3 mistakes`
  }],
  ELITE: [{
    name: 'The Skeptic',
    icon: '😠',
    description: `You were scammed before. You lost money to a fake roofer. HOSTILE and suspicious.
- Hostile from first word: "What do you want?"
- Interrupt constantly
- Assume they're scammers
- Door slam after 2 mistakes`
  }],
  NIGHTMARE: [{
    name: 'The Lawyer',
    icon: '⚖️',
    description: `You are an actual attorney who knows consumer protection laws.
- Cite specific laws
- Record the conversation
- Analyze every word for legal liability
- Door slam after 1 mistake (any false claim = instant)`
  }]
};

// Agnes-21 XP and Gamification Functions
function getXPForLevel(level: number): number {
  if (level <= 1) return 0;
  return 50 * Math.pow(level, 2);
}

function getLevelForXP(totalXP: number): number {
  if (totalXP <= 0) return 1;
  let level = 1;
  while (getXPForLevel(level + 1) <= totalXP) level++;
  return level;
}

function getAgnesUserProgress(): { totalXP: number; currentLevel: number; xpToNext: number } {
  const stored = localStorage.getItem('agnes_xp_progress');
  if (!stored) return { totalXP: 0, currentLevel: 1, xpToNext: getXPForLevel(2) };
  const { totalXP } = JSON.parse(stored);
  const currentLevel = getLevelForXP(totalXP);
  return { totalXP, currentLevel, xpToNext: getXPForLevel(currentLevel + 1) - totalXP };
}

function calculateAgnesSessionXP(score: number, difficulty: string, streakDays: number): number {
  const baseXP = 50;
  const scoreBonus = Math.max(0, Math.min(30, score - 70));
  const perfectBonus = score >= 100 ? 50 : 0;
  const streakBonus = streakDays * 10;
  const multiplier = AGNES_DIFFICULTY_LEVELS[difficulty]?.multiplier || 1.0;
  return Math.round((baseXP + scoreBonus + perfectBonus + streakBonus) * multiplier);
}

function awardAgnesXP(xp: number): { leveledUp: boolean; newLevel: number; previousLevel: number; newUnlocks: string[] } {
  const progress = getAgnesUserProgress();
  const previousLevel = progress.currentLevel;
  const newTotalXP = progress.totalXP + xp;
  const newLevel = getLevelForXP(newTotalXP);
  localStorage.setItem('agnes_xp_progress', JSON.stringify({ totalXP: newTotalXP }));
  const newUnlocks: string[] = [];
  Object.entries(AGNES_DIFFICULTY_LEVELS).forEach(([diff, config]) => {
    if (config.unlockLevel > previousLevel && config.unlockLevel <= newLevel) {
      newUnlocks.push(`${diff} Difficulty Unlocked!`);
    }
  });
  return { leveledUp: newLevel > previousLevel, newLevel, previousLevel, newUnlocks };
}

function isDifficultyUnlocked(difficulty: string): boolean {
  if (isManagerMode()) return true;
  const progress = getAgnesUserProgress();
  const config = AGNES_DIFFICULTY_LEVELS[difficulty];
  return config ? progress.currentLevel >= config.unlockLevel : false;
}

// Agnes-21 Streak Functions
function getAgnesStreak(): { current: number; longest: number; lastDate: string } {
  const stored = localStorage.getItem('agnes_streak');
  if (!stored) return { current: 0, longest: 0, lastDate: '' };
  return JSON.parse(stored);
}

function updateAgnesStreak(): { streakIncreased: boolean; newStreak: number; newMilestone: number | null } {
  const today = new Date().toISOString().split('T')[0];
  const streak = getAgnesStreak();
  if (streak.lastDate === today) {
    return { streakIncreased: false, newStreak: streak.current, newMilestone: null };
  }
  let newCurrent = streak.current;
  if (streak.lastDate) {
    const lastDate = new Date(streak.lastDate);
    const todayDate = new Date(today);
    const diff = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    newCurrent = diff === 1 ? streak.current + 1 : 1;
  } else {
    newCurrent = 1;
  }
  const newLongest = Math.max(newCurrent, streak.longest);
  localStorage.setItem('agnes_streak', JSON.stringify({ current: newCurrent, longest: newLongest, lastDate: today }));
  let newMilestone: number | null = null;
  if (newCurrent === 7 || newCurrent === 30 || newCurrent === 100) newMilestone = newCurrent;
  return { streakIncreased: true, newStreak: newCurrent, newMilestone };
}

// ============================================================================
// CELEBRATIONS & CONFETTI
// ============================================================================

function triggerConfetti(type: 'module' | 'levelup' | 'streak' | 'exam' | 'perfect' = 'module') {
  const defaults = { origin: { y: 0.7 } };

  switch (type) {
    case 'levelup':
      // Big celebration for level up
      confetti({ ...defaults, particleCount: 150, spread: 100, colors: ['#FFD700', '#FFA500', '#FF6347'] });
      setTimeout(() => confetti({ ...defaults, particleCount: 100, spread: 120 }), 200);
      break;
    case 'streak':
      // Fire-themed for streaks
      confetti({ ...defaults, particleCount: 80, spread: 70, colors: ['#FF4500', '#FF6347', '#FFA500', '#FFD700'] });
      break;
    case 'exam':
      // Green/success colors for passing exam
      confetti({ ...defaults, particleCount: 120, spread: 90, colors: ['#4CAF50', '#8BC34A', '#CDDC39', '#FFD700'] });
      break;
    case 'perfect':
      // Gold star shower for perfect score
      const duration = 3000;
      const end = Date.now() + duration;
      (function frame() {
        confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#FFD700', '#FFC700', '#FFE700'] });
        confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#FFD700', '#FFC700', '#FFE700'] });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
      break;
    default:
      // Standard module completion
      confetti({ ...defaults, particleCount: 80, spread: 70 });
  }
}

// Badge notification toast
function showBadgeToast(badge: { id: string; name: string; icon: string; description: string }) {
  const toast = document.createElement('div');
  toast.className = 'badge-toast';
  toast.innerHTML = `
    <div class="badge-toast-icon">${badge.icon}</div>
    <div class="badge-toast-content">
      <div class="badge-toast-title">Badge Earned!</div>
      <div class="badge-toast-name">${badge.name}</div>
      <div class="badge-toast-desc">${badge.description}</div>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Check and award badges after actions
async function checkAndAwardBadges() {
  const result = await apiCall<{ newBadges: Array<{ id: string; name: string; icon: string; description: string }>; totalBadges: number }>('/progress/badges/check', {
    method: 'POST',
    silent: true
  } as any);

  if (result?.newBadges && result.newBadges.length > 0) {
    result.newBadges.forEach((badge, idx) => {
      setTimeout(() => {
        showBadgeToast(badge);
        triggerConfetti('levelup');
      }, idx * 1500);
    });
  }
  return result;
}

// ============================================================================
// GAMIFICATION UI COMPONENTS
// ============================================================================

// Render badges section for welcome/dashboard
async function renderBadgesSection(container: HTMLElement) {
  const badges = await apiCall<{ earned: Array<{ id: string; name: string; icon: string; earnedAt: string }>; available: Array<{ id: string; name: string; icon: string; description: string; earned: boolean }> }>('/progress/badges', { silent: true } as any);

  if (!badges) return;

  const section = document.createElement('div');
  section.className = 'gamification-section badges-section';
  section.innerHTML = `
    <h3>🏆 Achievements <span class="badge-count">${badges.earned.length}/${badges.available.length}</span></h3>
    <div class="badges-grid">
      ${badges.available.map(b => `
        <div class="badge-item ${b.earned ? 'earned' : 'locked'}" title="${b.description}">
          <span class="badge-icon">${b.icon}</span>
          <span class="badge-name">${b.name}</span>
        </div>
      `).join('')}
    </div>
  `;
  container.appendChild(section);
}

// Render leaderboard section
async function renderLeaderboardSection(container: HTMLElement) {
  const section = document.createElement('div');
  section.className = 'gamification-section leaderboard-section';
  section.innerHTML = `
    <h3>📊 Leaderboard</h3>
    <div class="leaderboard-tabs">
      <button class="lb-tab active" data-type="weekly">This Week</button>
      <button class="lb-tab" data-type="alltime">All Time</button>
      <button class="lb-tab" data-type="streaks">Streaks</button>
    </div>
    <div class="leaderboard-content">
      <div class="loading">Loading...</div>
    </div>
  `;
  container.appendChild(section);

  const loadLeaderboard = async (type: string) => {
    const content = section.querySelector('.leaderboard-content') as HTMLElement;
    content.innerHTML = '<div class="loading">Loading...</div>';

    const data = await apiCall<{ leaderboard: Array<{ rank: number; name: string; xp: number; streak: number; isCurrentUser: boolean }>; userRank: number | null }>(`/progress/leaderboard?type=${type}`, { silent: true } as any);

    if (!data || data.leaderboard.length === 0) {
      content.innerHTML = '<div class="empty-state">No data yet. Start training!</div>';
      return;
    }

    content.innerHTML = `
      <div class="leaderboard-list">
        ${data.leaderboard.slice(0, 10).map(entry => `
          <div class="lb-entry ${entry.isCurrentUser ? 'current-user' : ''}">
            <span class="lb-rank">${entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : '#' + entry.rank}</span>
            <span class="lb-name">${entry.name}${entry.isCurrentUser ? ' (You)' : ''}</span>
            <span class="lb-stat">${type === 'streaks' ? entry.streak + '🔥' : entry.xp + ' XP'}</span>
          </div>
        `).join('')}
      </div>
      ${data.userRank && data.userRank > 10 ? `<div class="your-rank">Your rank: #${data.userRank}</div>` : ''}
    `;
  };

  // Tab click handlers
  section.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      section.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
      (e.target as HTMLElement).classList.add('active');
      loadLeaderboard((e.target as HTMLElement).dataset.type || 'weekly');
    });
  });

  // Load initial data
  loadLeaderboard('weekly');
}

// Render daily review section
async function renderDailyReviewSection(container: HTMLElement) {
  const review = await apiCall<{ cards: Array<{ id: string; questionText: string; correctAnswer: string }>; dueCount: number; totalCount: number }>('/progress/review', { silent: true } as any);

  if (!review || review.totalCount === 0) return; // Don't show if no review cards

  const section = document.createElement('div');
  section.className = 'gamification-section review-section';
  section.innerHTML = `
    <h3>📚 Daily Review ${review.dueCount > 0 ? `<span class="review-badge">${review.dueCount} due</span>` : '<span class="review-complete">✓ All caught up!</span>'}</h3>
    ${review.dueCount > 0 ? `
      <p>You have ${review.dueCount} question${review.dueCount > 1 ? 's' : ''} to review for better retention.</p>
      <button class="start-review-btn" onclick="window.startDailyReview()">Start Review</button>
    ` : `
      <p>Great job! You've completed all your reviews for today.</p>
    `}
  `;
  container.appendChild(section);
}

// Daily review modal
(window as any).startDailyReview = async function() {
  const review = await apiCall<{ cards: Array<{ id: string; questionText: string; correctAnswer: string; questionType: string }>; dueCount: number }>('/progress/review', { silent: true } as any);

  if (!review || review.cards.length === 0) {
    alert('No cards to review!');
    return;
  }

  let currentIndex = 0;
  const cards = review.cards;

  const overlay = document.createElement('div');
  overlay.className = 'review-modal-overlay';
  overlay.innerHTML = `
    <div class="review-modal">
      <div class="review-header">
        <span>Review Card ${currentIndex + 1}/${cards.length}</span>
        <button class="close-review" onclick="this.closest('.review-modal-overlay').remove()">×</button>
      </div>
      <div class="review-card-content">
        <div class="review-question">${cards[currentIndex].questionText}</div>
        <div class="review-answer" style="display:none;">${cards[currentIndex].correctAnswer}</div>
        <button class="show-answer-btn">Show Answer</button>
      </div>
      <div class="review-rating" style="display:none;">
        <p>How well did you know this?</p>
        <div class="rating-buttons">
          <button class="rate-btn" data-quality="1">Forgot</button>
          <button class="rate-btn" data-quality="3">Hard</button>
          <button class="rate-btn" data-quality="4">Good</button>
          <button class="rate-btn" data-quality="5">Easy</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const showNextCard = () => {
    currentIndex++;
    if (currentIndex >= cards.length) {
      overlay.innerHTML = `
        <div class="review-modal">
          <div class="review-complete-screen">
            <div style="font-size: 48px; margin-bottom: 20px;">🎉</div>
            <h3>Review Complete!</h3>
            <p>You've reviewed all ${cards.length} cards.</p>
            <button onclick="this.closest('.review-modal-overlay').remove()">Close</button>
          </div>
        </div>
      `;
      triggerConfetti('module');
      return;
    }
    const content = overlay.querySelector('.review-card-content') as HTMLElement;
    const rating = overlay.querySelector('.review-rating') as HTMLElement;
    const header = overlay.querySelector('.review-header span') as HTMLElement;
    header.textContent = `Review Card ${currentIndex + 1}/${cards.length}`;
    content.innerHTML = `
      <div class="review-question">${cards[currentIndex].questionText}</div>
      <div class="review-answer" style="display:none;">${cards[currentIndex].correctAnswer}</div>
      <button class="show-answer-btn">Show Answer</button>
    `;
    rating.style.display = 'none';
    content.querySelector('.show-answer-btn')?.addEventListener('click', () => {
      (content.querySelector('.review-answer') as HTMLElement).style.display = 'block';
      (content.querySelector('.show-answer-btn') as HTMLElement).style.display = 'none';
      rating.style.display = 'block';
    });
  };

  overlay.querySelector('.show-answer-btn')?.addEventListener('click', () => {
    (overlay.querySelector('.review-answer') as HTMLElement).style.display = 'block';
    (overlay.querySelector('.show-answer-btn') as HTMLElement).style.display = 'none';
    (overlay.querySelector('.review-rating') as HTMLElement).style.display = 'block';
  });

  overlay.querySelectorAll('.rate-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const quality = parseInt((e.target as HTMLElement).dataset.quality || '3');
      await apiCall('/progress/review/answer', {
        method: 'POST',
        body: JSON.stringify({ cardId: cards[currentIndex].id, quality }),
        silent: true
      } as any);
      showNextCard();
    });
  });
};

// Initialize gamification sections on welcome module
async function initGamificationUI() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  // Find or create a gamification container
  let gamificationContainer = document.getElementById('gamification-container');
  if (!gamificationContainer) {
    gamificationContainer = document.createElement('div');
    gamificationContainer.id = 'gamification-container';
    gamificationContainer.className = 'gamification-container';
    // Insert after the welcome content
    const welcomeContent = mainContent.querySelector('.content-card');
    if (welcomeContent) {
      welcomeContent.after(gamificationContainer);
    } else {
      mainContent.appendChild(gamificationContainer);
    }
  }
  gamificationContainer.innerHTML = '';

  // Render sections in parallel
  await Promise.all([
    renderDailyReviewSection(gamificationContainer),
    renderBadgesSection(gamificationContainer),
    renderLeaderboardSection(gamificationContainer)
  ]);
}

// Get next training module for continue button
function getNextTrainingModule(): { module: string; displayName: string } {
  const unlockedModules = getUnlockedModules();
  const completedModules = JSON.parse(localStorage.getItem('roof-er.completedModules') || '[]');

  const moduleNames: Record<string, string> = {
    'welcome': 'Welcome & Company Intro',
    'commitment': 'Your Commitment',
    'general-knowledge': 'General Roofing Knowledge',
    'shingle-types-materials': 'Shingle Types & Materials',
    'initial-pitch': 'The Initial Pitch',
    'handling-initial-pitch-objections': 'Initial Pitch Objections',
    'inspection-process': 'The Inspection Process',
    'post-inspection-pitch': 'Post-Inspection Pitch',
    'post-inspection-objections': 'Post-Inspection Objections',
    'damage-identification': 'Damage Identification',
    'filing-claim-closing': 'Filing the Claim & Contingency + Claim Authorization Script',
    'sales-cycle-job-flow': 'The Sales Cycle & Job Flow',
    'role-play': 'AI Role-Play',
    'final-exam': 'Final Exam'
  };

  for (const moduleName of MODULE_ORDER) {
    if (unlockedModules.includes(moduleName) && !completedModules.includes(moduleName)) {
      return { module: moduleName, displayName: moduleNames[moduleName] || moduleName };
    }
  }

  // All complete - return to welcome
  return { module: 'welcome', displayName: 'Welcome & Company Intro' };
}

// Calculate level from XP
function calculateLevel(xp: number): { level: number; currentXp: number; nextLevelXp: number } {
  const XP_PER_LEVEL = 500;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const currentXp = xp % XP_PER_LEVEL;
  const nextLevelXp = XP_PER_LEVEL;
  return { level, currentXp, nextLevelXp };
}

// Format time for display
function formatTrainingTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Initialize My Page dashboard
async function initMyPage() {
  const user = getCurrentUser();
  const userName = user?.name || 'Trainee';

  // Update greeting
  const greetingEl = document.getElementById('profile-greeting');
  if (greetingEl) greetingEl.textContent = `Welcome back, ${userName}!`;

  // Fetch stats from API instead of localStorage
  let completedModulesCount = 0;
  let totalXp = 0;
  let streak = 0;
  let trainingMinutes = 0;
  let avgScore = 0;
  let hasExamScores = false;

  try {
    const progressData = await apiCall<{
      modules: Array<{ name: string; status: string; timeSpentSeconds: number }>;
      examAttempts: Array<{ totalScore: number }>;
      gamification: { totalXP: number; currentStreak: number } | null;
    }>('/progress', { silent: true });

    if (progressData) {
      // Count completed modules
      completedModulesCount = progressData.modules.filter(m => m.status === 'completed').length;

      // Calculate total training time from modules
      const totalSeconds = progressData.modules.reduce((sum, m) => sum + (m.timeSpentSeconds || 0), 0);
      trainingMinutes = Math.round(totalSeconds / 60);

      // Get XP and streak from gamification
      if (progressData.gamification) {
        totalXp = progressData.gamification.totalXP || 0;
        streak = progressData.gamification.currentStreak || 0;
      }

      // Calculate average exam score
      if (progressData.examAttempts && progressData.examAttempts.length > 0) {
        const totalScore = progressData.examAttempts.reduce((sum, e) => sum + (e.totalScore || 0), 0);
        avgScore = Math.round(totalScore / progressData.examAttempts.length);
        hasExamScores = true;
      }
    }
  } catch (error) {
    console.log('Could not fetch progress data, using defaults');
  }

  // Fallback to localStorage if API returned no data
  if (completedModulesCount === 0) {
    const localCompleted = JSON.parse(localStorage.getItem('roof-er.completedModules') || '[]');
    completedModulesCount = localCompleted.length;

    // Also try to get XP and streak from localStorage
    const localXp = parseInt(localStorage.getItem('roof-er.totalXp') || '0', 10);
    const localStreak = parseInt(localStorage.getItem('roof-er.streak') || '0', 10);
    if (localXp > totalXp) totalXp = localXp;
    if (localStreak > streak) streak = localStreak;
  }

  // Calculate level
  const levelInfo = calculateLevel(totalXp);

  // Update profile section
  const levelTextEl = document.getElementById('profile-level-text');
  if (levelTextEl) levelTextEl.textContent = `Level ${levelInfo.level}`;

  const xpTextEl = document.getElementById('profile-xp-text');
  if (xpTextEl) xpTextEl.textContent = `${totalXp} XP`;

  const xpBarEl = document.getElementById('xp-progress-bar');
  if (xpBarEl) xpBarEl.style.width = `${(levelInfo.currentXp / levelInfo.nextLevelXp) * 100}%`;

  const xpToNextEl = document.getElementById('xp-to-next');
  if (xpToNextEl) xpToNextEl.textContent = `${levelInfo.nextLevelXp - levelInfo.currentXp} XP to Level ${levelInfo.level + 1}`;

  // Update stats
  const modulesEl = document.getElementById('stat-modules');
  if (modulesEl) modulesEl.textContent = `${completedModulesCount}/${MODULE_ORDER.length}`;

  const streakEl = document.getElementById('stat-streak');
  if (streakEl) streakEl.textContent = streak.toString();

  const timeEl = document.getElementById('stat-time');
  if (timeEl) timeEl.textContent = formatTrainingTime(trainingMinutes);

  const avgScoreEl = document.getElementById('stat-avg-score');
  if (avgScoreEl) avgScoreEl.textContent = hasExamScores ? `${avgScore}%` : '--%';

  const totalXpEl = document.getElementById('stat-total-xp');
  if (totalXpEl) totalXpEl.textContent = totalXp.toLocaleString();

  // Determine next milestone
  const milestoneEl = document.getElementById('stat-milestone');
  if (milestoneEl) {
    if (completedModulesCount < MODULE_ORDER.length) {
      const remaining = MODULE_ORDER.length - completedModulesCount;
      milestoneEl.textContent = `${remaining} modules`;
    } else {
      milestoneEl.textContent = 'Complete!';
    }
  }

  // Setup continue training button
  const nextModule = getNextTrainingModule();
  const continueBtnText = document.getElementById('continue-btn-text');
  if (continueBtnText) {
    if (completedModulesCount === 0) {
      continueBtnText.textContent = 'Start Training';
    } else if (completedModulesCount >= MODULE_ORDER.length) {
      continueBtnText.textContent = 'Review Training';
    } else {
      continueBtnText.textContent = `Continue - ${nextModule.displayName}`;
    }
  }

  const continueBtn = document.getElementById('continue-training-btn');
  if (continueBtn) {
    continueBtn.onclick = () => {
      // Navigate to the next module
      const sidebar = document.getElementById('sidebar');
      const targetItem = sidebar?.querySelector(`[data-module="${nextModule.module}"]`) as HTMLElement;
      if (targetItem) {
        targetItem.click();
      }
    };
  }

  const startOverBtn = document.getElementById('start-over-btn');
  if (startOverBtn) {
    startOverBtn.onclick = () => {
      const sidebar = document.getElementById('sidebar');
      const targetItem = sidebar?.querySelector('[data-module="welcome"]') as HTMLElement;
      if (targetItem) {
        targetItem.click();
      }
    };
  }

  // Render gamification sections
  const gamificationContainer = document.getElementById('dashboard-gamification');
  if (gamificationContainer) {
    gamificationContainer.innerHTML = '';
    await Promise.all([
      renderBadgesSection(gamificationContainer),
      renderLeaderboardSection(gamificationContainer)
    ]);
  }

  // Render daily review
  const reviewContainer = document.getElementById('dashboard-review');
  if (reviewContainer) {
    reviewContainer.innerHTML = '';
    await renderDailyReviewSection(reviewContainer);
  }
}

// Agnes-21 IndexedDB Video Storage
const AGNES_VIDEO_DB_VERSION = 1;
const AGNES_VIDEO_STORE = 'recordings';
const MAX_AGNES_VIDEOS = 20;

interface AgnesVideoRecording {
  sessionId: string;
  recordedAt: Date;
  duration: number;
  size: number;
  mimeType: string;
  videoBlob: Blob;
  thumbnail?: string;
  metadata?: { difficulty?: string; finalScore?: number };
}

function openAgnesVideoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('agnes_videos', AGNES_VIDEO_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(AGNES_VIDEO_STORE)) {
        const store = db.createObjectStore(AGNES_VIDEO_STORE, { keyPath: 'sessionId' });
        store.createIndex('recordedAt', 'recordedAt', { unique: false });
      }
    };
  });
}

async function countAgnesVideos(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([AGNES_VIDEO_STORE], 'readonly');
    const store = tx.objectStore(AGNES_VIDEO_STORE);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function cleanupOldestAgnesVideo(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([AGNES_VIDEO_STORE], 'readwrite');
    const store = tx.objectStore(AGNES_VIDEO_STORE);
    const index = store.index('recordedAt');
    const request = index.openCursor();
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        resolve();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveAgnesVideo(recording: AgnesVideoRecording): Promise<boolean> {
  try {
    const db = await openAgnesVideoDb();
    const count = await countAgnesVideos(db);
    if (count >= MAX_AGNES_VIDEOS) await cleanupOldestAgnesVideo(db);
    const tx = db.transaction([AGNES_VIDEO_STORE], 'readwrite');
    const store = tx.objectStore(AGNES_VIDEO_STORE);
    await new Promise<void>((resolve, reject) => {
      const request = store.put(recording);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
    console.log(`Video saved: ${recording.sessionId}`);
    return true;
  } catch (e) {
    console.error('Failed to save video:', e);
    return false;
  }
}

function getSupportedVideoMimeType(): string {
  const types = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm', 'video/mp4'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'video/webm';
}

// Agnes-21 System Instruction Builder
function buildAgnesSystemInstruction(difficulty: string, script: string): string {
  const personas = AGNES_PERSONAS[difficulty] || AGNES_PERSONAS.BEGINNER;
  const persona = personas[Math.floor(Math.random() * personas.length)];
  const doorSlamInfo = AGNES_DIFFICULTY_LEVELS[difficulty];

  return `You are Agnes 21, roleplaying as a homeowner for a sales training simulation.

## PRONUNCIATION NOTE:
Our company name "Roof-ER" should be pronounced as three separate sounds: "Roof" then "E" then "R" (like the letters E-R). Never say it as one word "Roofer".

## YOUR CHARACTER: ${persona.name} ${persona.icon}
${persona.description}

## TRAINING SCRIPT THE USER IS PRACTICING:
"""
${script}
"""

## DOOR SLAM MECHANIC:
Threshold: ${doorSlamInfo.description}
- If the rep makes major mistakes (being pushy, ignoring concerns, lying), track them
- Warn before slamming: "I'm starting to get frustrated..."
- At threshold: Slam door and say "This conversation is over"

## YOUR BEHAVIOR:
1. Stay in character 100% until they say "score me" or you slam the door
2. React naturally to what they say
3. Use progressive objections - start mild, escalate based on their responses
4. Interrupt according to your persona

## IMPORTANT - DO NOT REPEAT WHAT THE USER SAID:
Never summarize, repeat, or acknowledge what the sales rep just said before responding. Just respond naturally in character. The user's audio is already captured separately in the transcript - you don't need to echo it back.

WRONG: "You said your name is John and you're from Roof-ER... well I'm not interested."
CORRECT: "I'm not interested, we just had someone come by last week."

## THE 5 NON-NEGOTIABLES (For Scoring):
1. Who you are (name introduction) - 10 pts
2. Who we are (Roof E.R. + what we do) - 10 pts
3. Make it relatable (storm mention OR local context) - 10 pts
4. Purpose (free inspection offer) - 10 pts
5. Go for the close (get agreement) - 10 pts

## WHEN TO BREAK CHARACTER:
When user says "score me", "how did I do?", or "end simulation", provide:

CRITICAL SCORING RULE: The AGNES SCORE must EXACTLY equal the sum of all breakdown categories. Calculate each category first, add them up, then use that EXACT total for the AGNES SCORE line. Double-check your math - the numbers must add up precisely!

**AGNES SCORE: [TOTAL]/100** (where TOTAL = Non-negotiables pts + Delivery pts + Objection pts)

**BREAKDOWN:**
- Non-negotiables: [X/5] covered = [A] pts (each item worth 10 pts, max 50)
- Delivery & Confidence: [B]/30 pts
- Objection Handling: [C]/20 pts
- TOTAL: [A] + [B] + [C] = [TOTAL] (this MUST match the score above)

**3 STRENGTHS:**
1. [Specific example]
2. [Specific technique]
3. [Strong moment]

**3 AREAS FOR IMPROVEMENT:**
1. [Specific mistake + how to fix]
2. [Missed opportunity]
3. [Technique to practice]

Now begin. The sales rep just rang your doorbell.`;
}

// Training Scripts for Agnes-21
const AGNES_TRAINING_SCRIPTS: Record<string, string> = {
  'door-knock': `DOOR KNOCK PITCH:
Hi, my name is [NAME] with Roof E.R. We're a local roofing company that helps homeowners get their roofs replaced using their insurance.

We're out here today because there was a storm that came through about [X] weeks ago and we've been helping a lot of your neighbors file claims and get their roofs replaced.

I was wondering if you'd let me take a quick look at your roof - it's completely free and takes about 15 minutes. If there's no damage, I'll let you know and be on my way. But if there is damage, I can help you file a claim with your insurance company.

Would that be okay with you?`,

  'homeowner': `HOMEOWNER PRACTICE:
Practice responding to common homeowner objections and questions about:
- Insurance coverage concerns
- Timing and scheduling
- Trust and company reputation
- Cost and out-of-pocket expenses
- Process questions`,

  'rep': `SALES REP PRACTICE:
Practice your pitch delivery including:
- Introduction and company presentation
- Value proposition
- Handling objections smoothly
- Building rapport
- Closing techniques`,

  'adjuster': `ADJUSTER PRACTICE:
Practice working with insurance adjusters:
- Technical damage documentation
- Negotiation techniques
- Supplement requests
- Professional communication`
};

// Training script mapping for contextual AI hints
const trainingScriptMap: Record<string, { scripts: string[]; keyPhrases: string[]; framework?: string }> = {
  inspection: {
    scripts: [
      "Safety First: Check ladder stability, wear harness if needed",
      "360 Walk: Walk entire perimeter, document whole structure",
      "Shingle Inspection: Look for missing granules, cracks, lifting, bruising",
      "Flashing Check: Inspect all flashing around chimneys, vents, valleys",
      "Photo Documentation: Take 20-40 photos covering all findings",
      "Test Square: Chalk 10x10 area to count and document hits"
    ],
    keyPhrases: [
      "I'm checking for storm damage indicators...",
      "This circular mark is a hail hit...",
      "The granule loss here shows impact...",
      "Let me show you the evidence..."
    ]
  },
  initialPitch: {
    scripts: [
      "5 Non-Negotiables: Who you are, Who we are, Make it relatable, What you're doing, Go for the close",
      "Hi! I'm [Name] with Roof E.R. We're working in your neighborhood helping homeowners file insurance claims for storm damage.",
      "We've had a lot of storms here in [Region] over the past few months that have done a lot of damage!",
      "We're working with a lot of your neighbors in the area.",
      "While I'm here, I'm conducting a completely free inspection..."
    ],
    keyPhrases: [
      "I'm working in your neighborhood today...",
      "Your neighbors at [address] just got approved...",
      "This will only take 2 minutes from the ground...",
      "Worst case, I give you peace of mind...",
      "Would today or tomorrow work better for you?"
    ]
  },
  postInspection: {
    scripts: [
      "Set Expectations: 'I found some damage up there. Let me show you the photos...'",
      "Walk Through Photos: Show overview, then close-ups with context",
      "Explain Consequences: UV damage, leaks within 2-3 years, interior damage costs",
      "Present Solution: Insurance covers this, deductible only, we handle everything",
      "Build the Story: Collateral → Overview → Close-ups → Pattern"
    ],
    keyPhrases: [
      "Here's your south-facing slope...",
      "See these dark spots? That's granule loss...",
      "The good news is your insurance will cover this...",
      "Your only cost is the deductible..."
    ]
  },
  objections: {
    scripts: [
      "5 Steps: Pause & Listen, Acknowledge, Clarify, Respond with Value, Move Forward",
      "Always acknowledge their concern before responding",
      "Frame insurance as value and peace-of-mind, not cost",
      "Offer two specific times when scheduling"
    ],
    keyPhrases: [
      "I completely understand...",
      "That's a great question...",
      "Here's what most people don't know...",
      "Would 4pm today or 10am tomorrow work?"
    ],
    framework: "5-Step Objection Process"
  }
};

// Store all training content in an object
const trainingContent = {
  'my-page': `
    <div class="my-page-container">
      <!-- Profile Header -->
      <div class="profile-header">
        <div class="profile-avatar">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
        </div>
        <div class="profile-info">
          <h1 id="profile-greeting">Welcome back!</h1>
          <div class="profile-level">
            <span id="profile-level-text">Level 1</span>
            <span class="xp-separator">•</span>
            <span id="profile-xp-text">0 XP</span>
          </div>
          <div class="xp-progress-container">
            <div class="xp-progress-bar" id="xp-progress-bar" style="width: 0%"></div>
          </div>
          <p class="xp-to-next" id="xp-to-next">0 XP to next level</p>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon modules-icon">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/></svg>
          </div>
          <div class="stat-value" id="stat-modules">0/${MODULE_ORDER.length}</div>
          <div class="stat-label">Modules Completed</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon streak-icon">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>
          </div>
          <div class="stat-value" id="stat-streak">0</div>
          <div class="stat-label">Day Streak</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon time-icon">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
          </div>
          <div class="stat-value" id="stat-time">0m</div>
          <div class="stat-label">Time Trained</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon score-icon">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>
          </div>
          <div class="stat-value" id="stat-avg-score">--%</div>
          <div class="stat-label">Avg Quiz Score</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon xp-icon">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          </div>
          <div class="stat-value" id="stat-total-xp">0</div>
          <div class="stat-label">Total XP</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon milestone-icon">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>
          </div>
          <div class="stat-value" id="stat-milestone">--</div>
          <div class="stat-label">Next Milestone</div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="action-buttons">
        <button class="continue-training-btn" id="continue-training-btn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span id="continue-btn-text">Start Training</span>
        </button>
        <button class="start-over-btn" id="start-over-btn">Start from Beginning</button>
      </div>

      <!-- Gamification Section -->
      <div class="dashboard-gamification" id="dashboard-gamification">
        <!-- Leaderboard and Badges will be rendered here -->
      </div>

      <!-- Daily Review -->
      <div class="dashboard-review" id="dashboard-review">
        <!-- Daily review section will be rendered here -->
      </div>
    </div>
  `,
  welcome: `
    <div class="content-card">
      <h1>Welcome to Roof-ER!</h1>

      ${renderVideoPlayer('https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/welcome-intro.mp4', 'welcome-video', '📹 Welcome Introduction')}
      <p>My name is Oliver Brown. I founded this company in 2019, not because I have a passion for roofing, but because I saw an opportunity to change the reputation of roofing companies and contractors as a whole. This is an industry that is known for lack of communication, poor workmanship, and straight up deceit. With a little bit of modern thinking, integrity and hard work we've been able to build a strong brand and reputation in a relatively short amount of time.</p>
      <p>We have ambitions of becoming a national brand. To accomplish this we need to continue to add and develop hungry, competitive team members who are dedicated to the big picture but disciplined to execute on a day to day basis.</p>

      <h2>Steering Our Roofing Revolution</h2>
      <p class="section-intro">Meet the leaders who built Roof-ER on integrity, expertise, and a relentless commitment to excellence.</p>

      <div class="leadership-grid">
        <!-- Oliver Brown -->
        <div class="leader-card">
          <div class="leader-photo-container">
            <img src="/assets/team/oliver-theroofdocs.jpg" alt="Oliver Brown" class="leader-photo" />
          </div>
          <h3>Oliver Brown</h3>
          <p class="leader-title">CEO & Founder</p>
          <p class="leader-highlight">Built Roof-ER from the ground up with hands-on experience and an MBA from Mount St. Mary's University. Founded in 2019 to revolutionize the roofing industry with integrity and modern thinking.</p>
          <button class="bio-toggle-btn" data-bio="oliver-bio">My Bio</button>
          <div id="oliver-bio" class="leader-bio-full" style="display: none;">
            <p>Oliver Brown's journey in the roofing industry began quite literally on the ground, spending a summer loading shingles onto rooftops under the hot sun. That hands-on experience ignited a passion for the trade and laid the foundation for what would become Roof-ER: a company built on grit, growth, and doing things the right way.</p>
            <p>A two-time graduate of Mount St. Mary's University, Oliver earned his B.S. in Business Marketing in 2013 and an MBA in 2015. His education, combined with real-world roofing experience, gave him a unique perspective on how to build a company that blends professionalism with performance.</p>
            <p>In 2019, Oliver founded Roof-ER not out of a passion for roofs, but out of a desire to change the reputation of the roofing industry - an industry often plagued by poor communication, shoddy workmanship, and dishonest practices. Through integrity, modern systems, and relentless hard work, Roof-ER has rapidly built a strong brand and reputation.</p>
            <p>Oliver's vision is clear: to build Roof-ER into a national brand by developing hungry, competitive team members who are dedicated to the big picture but disciplined enough to execute daily. He leads by example, embodying the values of integrity, quality, and simplicity that define Roof-ER.</p>
          </div>
          <div class="video-placeholder">
            <p>🎥 Introduction video coming soon</p>
          </div>
        </div>

        <!-- Reese Samala -->
        <div class="leader-card">
          <div class="leader-photo-container">
            <img src="/assets/team/reese-theroofdocs.jpg" alt="Reese Samala" class="leader-photo" />
          </div>
          <h3>Reese Samala</h3>
          <p class="leader-title">Director of Sales</p>
          <p class="leader-highlight">U.S. Army Infantry veteran and OEF combat vet bringing military discipline and leadership to building Roof-ER's sales excellence. First-generation immigrant from the Philippines with a service-first mindset.</p>
          <button class="bio-toggle-btn" data-bio="reese-bio">My Bio</button>
          <div id="reese-bio" class="leader-bio-full" style="display: none;">
            <p>Reese Samala brings a unique blend of leadership, discipline, and global perspective to his role as Director of Sales at Roof-ER. A first-generation immigrant from the Philippines and a proud U.S. Army Infantryman and Operation Enduring Freedom (OEF) veteran, Reese is driven by a strong sense of service and mission, values that align perfectly with Roof-ER's commitment to excellence in exterior remodeling.</p>
            <p>Reese's military background instilled in him the importance of teamwork, accountability, and executing under pressure - skills that translate directly to leading high-performing sales teams. His experience in combat zones taught him to stay calm in challenging situations, think strategically, and always put the mission first.</p>
            <p>At Roof-ER, Reese applies these principles to building a sales culture rooted in integrity and results. He believes that sales is about service, not just closing deals. His approach focuses on truly understanding homeowner needs, providing honest assessments, and delivering solutions that restore peace of mind.</p>
            <p>As a first-generation American, Reese embodies the entrepreneurial spirit and work ethic that drives Roof-ER forward. He leads his team with the same dedication and honor that defined his military service, ensuring that every customer interaction reflects Roof-ER's core values.</p>
          </div>
          <div class="video-placeholder">
            <p>🎥 Introduction video coming soon</p>
          </div>
        </div>

        <!-- Ford Barsi -->
        <div class="leader-card">
          <div class="leader-photo-container">
            <img src="/assets/team/ford-theroofdocs.jpg" alt="Ford Barsi" class="leader-photo" />
          </div>
          <h3>Ford Barsi</h3>
          <p class="leader-title">General Manager</p>
          <p class="leader-highlight">Former NYC chef turned operations leader, bringing hospitality excellence and customer-first mindset from high-end restaurants to roofing. Originally from Tampa, Florida.</p>
          <button class="bio-toggle-btn" data-bio="ford-bio">My Bio</button>
          <div id="ford-bio" class="leader-bio-full" style="display: none;">
            <p>As General Manager of Roof-ER, Ford Barsi brings a rare blend of hospitality excellence, operational leadership, and a customer-first mindset that elevates every aspect of the business. Originally from Tampa, Florida, Ford began his career in the fast-paced world of high-end restaurants, starting as a chef in New York City.</p>
            <p>His background in hospitality instilled in him a deep appreciation for attention to detail, the value of hard work, and the power of memorable service. In fine dining, every detail matters, and Ford brings that same level of precision to managing Roof-ER's operations.</p>
            <p>Ford's transition from the kitchen to roofing management might seem unusual, but the skills are directly transferable: leading teams under pressure, maintaining high standards, ensuring customer satisfaction, and creating systems that deliver consistent excellence. Just as a great restaurant experience depends on flawless execution across multiple touchpoints, so does a successful roofing project.</p>
            <p>At Roof-ER, Ford oversees daily operations, ensuring that every project runs smoothly from initial inspection to final installation. He maintains the same standards he learned in world-class kitchens: no shortcuts, no excuses, and an unwavering commitment to quality. His leadership ensures that Roof-ER delivers not just a new roof, but an exceptional customer experience.</p>
          </div>
          <div class="video-placeholder">
            <p>🎥 Introduction video coming soon</p>
          </div>
        </div>
      </div>

      <h2 id="mission-values-section">Our Mission & Values</h2>
      <div class="values-section">
        <h3>Mission</h3>
        <p>At Roof-ER, our mission is to hold a fiduciary responsibility to our customers - plain and simple. To restore peace of mind for homeowners through expert storm damage restoration and quality roofing services.</p>

        <h3>Core Values</h3>
        <ul>
          <li><strong>Integrity:</strong> Always do what's right for the homeowner, even when no one is watching</li>
          <li><strong>Quality:</strong> Never settle for "good enough" - deliver premium workmanship and clear communication</li>
          <li><strong>Simplicity:</strong> Make the process straightforward and stress-free for every customer</li>
        </ul>
      </div>

      <div class="module-completion-section" id="module-complete-section" style="display: none;">
        <button class="complete-module-btn" onclick="completeModule('welcome')">
          Complete Module & Continue
        </button>
      </div>
    </div>
  `,
  commitment: `
    <div class="content-card commitment-module">
      <h1>Your Commitment</h1>
      ${renderVideoPlayer('https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/module2-commitment.mp4', 'commitment-video', '📹 Your Commitment to Excellence')}

      <!-- Video requirement notice -->
      <div class="commitment-video-notice" id="commitment-video-notice">
        <div class="notice-icon">📹</div>
        <div class="notice-text">
          <strong>Step 1:</strong> Please watch the commitment video above before proceeding.
          <div class="video-progress-text" id="commitment-video-progress">Video progress: 0%</div>
        </div>
      </div>

      <h2>The Roof-ER Promise</h2>
      <div class="promise-section">
        <div class="promise-icon">🤝</div>
        <p><strong>We promise to:</strong></p>
        <ul>
          <li><span class="promise-check">✓</span> Treat every homeowner's property as if it were our own</li>
          <li><span class="promise-check">✓</span> Provide honest assessments, even if it means no sale</li>
          <li><span class="promise-check">✓</span> Fight for maximum coverage on every claim</li>
          <li><span class="promise-check">✓</span> Complete every project with excellence and professionalism</li>
          <li><span class="promise-check">✓</span> Stand behind our work for the lifetime of the roof</li>
          <li><span class="promise-check">✓</span> Communicate clearly and promptly throughout the process</li>
        </ul>
      </div>

      <h2>Your Commitment as a Roof-ER Representative</h2>
      <p>As a member of the Roof-ER team, your commitment to our values and processes is paramount to our collective success.</p>

      <div class="commitment-progress-bar">
        <div class="progress-fill" id="initials-progress-fill" style="width: 0%"></div>
        <span class="progress-text" id="initials-progress-text">0 of 8 commitments initialed</span>
      </div>

      <div class="commitment-initials-section" id="commitment-initials-section">
        <div class="commitment-item" data-index="1">
          <div class="commitment-number">1</div>
          <input type="text" class="initial-box" id="initial-1" maxlength="3" placeholder="Init." aria-label="Initial for first commitment" />
          <span class="commitment-text">I will conduct myself in alignment with the Mission and Core Values.</span>
          <div class="commitment-check" id="check-1">✓</div>
        </div>
        <div class="commitment-item" data-index="2">
          <div class="commitment-number">2</div>
          <input type="text" class="initial-box" id="initial-2" maxlength="3" placeholder="Init." aria-label="Initial for second commitment" />
          <span class="commitment-text">I will dedicate myself to Roof-ER's successful sales process.</span>
          <div class="commitment-check" id="check-2">✓</div>
        </div>
        <div class="commitment-item" data-index="3">
          <div class="commitment-number">3</div>
          <input type="text" class="initial-box" id="initial-3" maxlength="3" placeholder="Init." aria-label="Initial for third commitment" />
          <span class="commitment-text">I will always show an exceptional level of integrity.</span>
          <div class="commitment-check" id="check-3">✓</div>
        </div>
        <div class="commitment-item" data-index="4">
          <div class="commitment-number">4</div>
          <input type="text" class="initial-box" id="initial-4" maxlength="3" placeholder="Init." aria-label="Initial for fourth commitment" />
          <span class="commitment-text">I will listen to and grow from receiving constructive feedback.</span>
          <div class="commitment-check" id="check-4">✓</div>
        </div>
        <div class="commitment-item" data-index="5">
          <div class="commitment-number">5</div>
          <input type="text" class="initial-box" id="initial-5" maxlength="3" placeholder="Init." aria-label="Initial for fifth commitment" />
          <span class="commitment-text">I will not be involved in gossip or "office drama."</span>
          <div class="commitment-check" id="check-5">✓</div>
        </div>
        <div class="commitment-item" data-index="6">
          <div class="commitment-number">6</div>
          <input type="text" class="initial-box" id="initial-6" maxlength="3" placeholder="Init." aria-label="Initial for sixth commitment" />
          <span class="commitment-text">I will show an intense level of discipline in the work that I conduct.</span>
          <div class="commitment-check" id="check-6">✓</div>
        </div>
        <div class="commitment-item" data-index="7">
          <div class="commitment-number">7</div>
          <input type="text" class="initial-box" id="initial-7" maxlength="3" placeholder="Init." aria-label="Initial for seventh commitment" />
          <span class="commitment-text">I will have pride in my work.</span>
          <div class="commitment-check" id="check-7">✓</div>
        </div>
        <div class="commitment-item commitment-item-final" data-index="8">
          <div class="commitment-number">8</div>
          <input type="text" class="initial-box" id="initial-8" maxlength="3" placeholder="Init." aria-label="Initial for eighth commitment" />
          <span class="commitment-text"><strong>I will do what it takes to commit to this. I will achieve tremendous levels of success.</strong></span>
          <div class="commitment-check" id="check-8">✓</div>
        </div>
      </div>

      <!-- Digital Signature Section - Hidden until requirements met -->
      <div class="commitment-signature-section" id="commitment-signature-section" style="display: none;">
        <h3>Digital Signature</h3>
        <p>By signing below, you acknowledge and commit to upholding the Roof-ER standards and ethics outlined above.</p>

        <div class="signature-form">
          <label class="signature-label">
            <span>Full Legal Name:</span>
            <input type="text" id="commitment-sig-name" placeholder="Enter your full name" />
          </label>

          <label class="signature-checkbox">
            <input type="checkbox" id="commitment-sig-agree" />
            <span>I solemnly agree to uphold all Roof-ER standards, values, and ethics as outlined above.</span>
          </label>

          <div class="signature-error" id="commitment-sig-error"></div>

          <button class="signature-submit-btn" id="commitment-sig-submit">
            Sign & Complete Module
          </button>
        </div>
      </div>

      <!-- Requirements notice -->
      <div class="commitment-requirements-notice" id="commitment-requirements-notice">
        <h4>To complete this module:</h4>
        <ul>
          <li id="req-commitment-video" class="requirement-item pending">
            <span class="req-icon">○</span> Watch the commitment video (90%+)
          </li>
          <li id="req-commitment-initials" class="requirement-item pending">
            <span class="req-icon">○</span> Initial all 8 commitment statements
          </li>
          <li id="req-commitment-signature" class="requirement-item pending">
            <span class="req-icon">○</span> Provide your digital signature
          </li>
        </ul>
      </div>

      <p class="reference-link">Reference: <a href="#" class="nav-module-link" data-module="welcome" data-scroll-to="mission-values-section">Mission, Values, & Commitment (Module 1)</a></p>
    </div>
  `,
  'initial-pitch': `
    <div class="content-card module-5-redesign">
      <h1>The Initial Pitch</h1>

      <!-- Video Player -->
      <div class="video-player-container" style="margin: 20px 0; background: #f5f5f5; border-radius: 8px; padding: 20px;">
        <h3 style="margin-top: 0;">Mastering the Roof-ER Pitch</h3>
        <div style="position: relative;">
          <video
            id="initial-pitch-video"
            controls
            style="width: 100%; max-width: 800px; border-radius: 4px;"
          >
            <source src="https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/module5-mastering-pitch.mp4" type="video/mp4">
            Your browser does not support the video tag.
          </video>
        </div>
        <div class="video-progress-container" style="margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 14px; color: #666;">Video Progress</span>
            <span id="initial-pitch-video-progress-text" style="font-size: 14px; font-weight: 600; color: #666;">0%</span>
          </div>
          <div class="video-progress-track" style="width: 100%; max-width: 800px; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden;">
            <div id="initial-pitch-video-progress-bar" class="video-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%); border-radius: 4px; transition: width 0.3s ease;"></div>
          </div>
        </div>
      </div>

      <!-- Progress Tracker -->
      <div class="pitch-progress-tracker" id="pitch-progress">
        <h3>Your Practice Progress</h3>
        <div class="progress-items">
          <div class="progress-item" data-script="intro">
            <span class="progress-icon">⭕</span>
            <span>Introduction</span>
          </div>
          <div class="progress-item" data-script="proposal">
            <span class="progress-icon">⭕</span>
            <span>Inspection Proposal</span>
          </div>
          <div class="progress-item" data-script="permission">
            <span class="progress-icon">⭕</span>
            <span>Securing Permission</span>
          </div>
          <div class="progress-item" data-script="handoff">
            <span class="progress-icon">⭕</span>
            <span>Handoff</span>
          </div>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" id="pitch-progress-bar" style="width: 0%"></div>
        </div>
        <p class="progress-label"><span id="practice-count">0</span>/4 sections practiced</p>
      </div>

      <!-- Knocking Etiquette Video -->
      <div class="video-section" style="margin: 30px 0;">
        <h3 style="color: #1e293b; margin-bottom: 15px;">🚪 Knocking Etiquette with Reese and Agnes</h3>
        <p style="color: #64748b; margin-bottom: 15px;">Learn the proper techniques for approaching a homeowner's door professionally.</p>
        <div style="background: #1e293b; border-radius: 12px; padding: 20px; max-width: 800px;">
          <video controls style="width: 100%; border-radius: 8px;">
            <source src="https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/knocking-etiquette.mp4" type="video/mp4">
            Your browser does not support the video tag.
          </video>
        </div>
      </div>

      <!-- 5 Non-Negotiables Cards -->
      <h2>The 5 Non-Negotiables</h2>
      <p class="section-intro">Every successful pitch includes these 5 essential elements. Master them!</p>

      <div class="non-negotiables-grid">
        <div class="nn-card" data-nn="1">
          <div class="nn-icon">👤</div>
          <div class="nn-number">1</div>
          <h4>Who You Are</h4>
          <p class="nn-quote">"Hi, how are you? My name is _____"</p>
        </div>
        <div class="nn-card" data-nn="2">
          <div class="nn-icon">🏠</div>
          <div class="nn-number">2</div>
          <h4>Who We Are</h4>
          <p class="nn-quote">"...with Roof-ER, we're a local roofing company that specializes in helping homeowners get their roof replaced, paid for by their insurance!"</p>
        </div>
        <div class="nn-card" data-nn="3">
          <div class="nn-icon">🤝</div>
          <div class="nn-number">3</div>
          <h4>Make It Relatable</h4>
          <p class="nn-quote">"We've had a lot of storms here in [Region]... We're already working with your neighbors."</p>
        </div>
        <div class="nn-card" data-nn="4">
          <div class="nn-icon">🔍</div>
          <div class="nn-number">4</div>
          <h4>What You're Doing</h4>
          <p class="nn-quote">"I am conducting a completely free inspection to see if you have similar, qualifiable damage."</p>
        </div>
        <div class="nn-card" data-nn="5">
          <div class="nn-icon">✅</div>
          <div class="nn-number">5</div>
          <h4>Go For The Close</h4>
          <p class="nn-quote">"Alright! It will take me about 10-15 minutes. I'm gonna take a look around the perimeter of your home, then grab the ladder, and take a look at your roof."</p>
        </div>
      </div>

      <!-- Generic Script Section -->
      <h2>The Generic Initial Pitch</h2>
      <p class="section-intro">This is your go-to script. Practice it until it feels natural!</p>

      <div class="script-section">
        <div class="script-card" data-text-source="true" data-script-id="intro">
          <div class="script-header">
            <span class="script-label">Part 1: Introduction</span>
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <button class="practice-btn" onclick="markPracticed('intro')">✓ Mark Practiced</button>
          </div>
          <div class="script-content">
            <p>"Hi, how are you? My Name is <span class="fill-blank">__________</span> with Roof-ER we're a local roofing company that specializes in helping homeowners get their roof replaced, paid for by their insurance!</p>
            <p>We've had a lot of storms here in <span class="fill-blank">[Region]</span> over the past few months that have done a lot of damage!</p>
            <p>We're already working with your neighbors. We've been able to help them get fully approved through their insurance company to have their roof replaced."</p>
          </div>
        </div>

        <div class="script-card" data-text-source="true" data-script-id="proposal">
          <div class="script-header">
            <span class="script-label">Part 2: Inspection Proposal</span>
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <button class="practice-btn" onclick="markPracticed('proposal')">✓ Mark Practiced</button>
          </div>
          <div class="script-content">
            <p>"While I'm here, in the neighborhood, I am conducting a completely free inspection to see if you have similar, qualifiable damage.</p>
            <p>If you do, I'll take a bunch of photos and walk you through the rest of the process.</p>
            <p>If you don't, I wouldn't want to waste your time, I wouldn't want to waste mine!</p>
            <p>I will at least leave giving you peace of mind that you're in good shape."</p>
            <p class="script-note">⏸️ <strong>Pause here – Wait for them to respond/agree.</strong></p>
          </div>
        </div>

        <div class="script-card" data-text-source="true" data-script-id="permission">
          <div class="script-header">
            <span class="script-label">Part 3: Securing Permission</span>
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <button class="practice-btn" onclick="markPracticed('permission')">✓ Mark Practiced</button>
          </div>
          <div class="script-content">
            <p>"Alright! It will take me about 10-15 minutes. I'm gonna take a look around the perimeter of your home, then grab the ladder, and take a look at your roof.</p>
            <p>What was your name again? <span class="fill-blank">[Their name]</span> great to meet you, again I am <span class="fill-blank">[Your name]</span>.</p>
            <p>Oh and by the way do you know who your insurance company is?"</p>
            <p class="script-note">⏸️ <strong>Wait for their answer</strong></p>
            <p>"Great! We work with those guys all the time."</p>
          </div>
        </div>

        <div class="script-card" data-text-source="true" data-script-id="handoff">
          <div class="script-header">
            <span class="script-label">Part 4: Handoff</span>
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <button class="practice-btn" onclick="markPracticed('handoff')">✓ Mark Practiced</button>
          </div>
          <div class="script-content">
            <p>"Here's my card/flier, look us up while I'm conducting the inspection!</p>
            <p>I will give you a knock when I finish up and show you what I've found."</p>
          </div>
        </div>
      </div>

      <!-- Specific/Storm Script -->
      <h2>If Referencing Specific Storm or Neighbor</h2>
      <p class="section-intro">Use this when there was a recent notable storm in the area.</p>

      <div class="script-section">
        <div class="script-card storm-script" data-text-source="true">
          <div class="script-header">
            <span class="script-label">Storm Reference Opening</span>
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
          </div>
          <div class="script-content">
            <p style="font-weight: 700; font-size: 1.1em; background: linear-gradient(120deg, #fef3c7 0%, #fde68a 100%); padding: 12px 16px; border-radius: 8px; border-left: 4px solid #f59e0b;">"Were you home for the storm we had in <span class="fill-blank">[date/description]</span>?"</p>

            <div class="response-branch">
              <div class="branch if-yes">
                <span class="branch-label">If YES:</span>
                <p>"It was pretty crazy right?!"</p>
              </div>
              <div class="branch if-no">
                <span class="branch-label">If NO:</span>
                <p>"Oh no worries at all, we get that all the time."</p>
                <p><em>OR</em></p>
                <p>"That's good! It was a pretty bad one."</p>
              </div>
            </div>

            <p class="transition-text">➡️ <strong>Then continue:</strong></p>
            <p>"We're working with a lot of your neighbors in the area. We've been able to help them get fully approved through their insurance company to have their roof replaced."</p>
            <p class="script-note">📌 <strong>Then proceed to Inspection Proposal (Part 2)</strong></p>
          </div>
        </div>
      </div>

      <!-- Example Pitch Video -->
      <h2>🎬 Watch: Example Pitch in Action</h2>
      <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); border-radius: 16px; padding: 25px; margin-bottom: 30px;">
        <p style="color: #94a3b8; font-size: 15px; margin: 0 0 20px 0; text-align: center;">
          Watch Reese deliver the initial pitch. Pay attention to tone, pacing, and how she handles the conversation.
        </p>
        <video
          controls
          style="width: 100%; border-radius: 12px; max-height: 500px; background: #000;"
          poster=""
        >
          <source src="https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/reeses-pitch-cassidy.mp4" type="video/mp4">
          Your browser does not support the video tag.
        </video>
        <div style="margin-top: 15px; padding: 15px; background: rgba(34, 197, 94, 0.1); border-radius: 10px; border-left: 4px solid #22c55e;">
          <p style="color: #86efac; font-size: 14px; margin: 0;"><strong>💡 Key Takeaways:</strong> Notice how she introduces herself, explains who Roof-ER is, makes it relatable, and goes for the close naturally.</p>
        </div>
      </div>

      <!-- Interactive Practice Mode -->
      <h2>Practice Mode</h2>
      <div class="practice-mode-container">
        <div class="practice-intro">
          <p>Ready to practice? Click below to enter Practice Mode where you can rehearse your pitch out loud!</p>
          <button class="practice-mode-btn" onclick="togglePracticeMode()">🎤 Start Practice Mode</button>
        </div>
        <div class="practice-active" id="practice-mode" style="display: none;">
          <div class="practice-prompt">
            <h4>Practice Prompt:</h4>
            <p id="practice-prompt-text">Introduce yourself and explain who Roof-ER is...</p>
          </div>
          <div class="practice-controls">
            <button onclick="showNextPrompt()">Next Prompt →</button>
            <button onclick="togglePracticeMode()">Exit Practice</button>
          </div>
          <div class="practice-tips">
            <h4>Tips:</h4>
            <ul>
              <li>Practice out loud - hearing yourself is key</li>
              <li>Time yourself - aim for 30-45 seconds per part</li>
              <li>Record yourself on your phone to review</li>
              <li>Practice until it sounds natural, not rehearsed</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Building Rapport Tips -->
      <h2>Building Rapport Tips</h2>
      <div class="tips-grid">
        <div class="tip-card">
          <span class="tip-icon">🪞</span>
          <h4>Mirror Their Energy</h4>
          <p>Match their enthusiasm or calmness</p>
        </div>
        <div class="tip-card">
          <span class="tip-icon">🌧️</span>
          <h4>Ask About Storms</h4>
          <p>Get them talking about past weather events</p>
        </div>
        <div class="tip-card">
          <span class="tip-icon">🏡</span>
          <h4>Compliment Authentically</h4>
          <p>Nice yard, landscaping, or home - be genuine</p>
        </div>
        <div class="tip-card">
          <span class="tip-icon">📛</span>
          <h4>Use Their Name</h4>
          <p>2-3 times in conversation creates connection</p>
        </div>
        <div class="tip-card">
          <span class="tip-icon">📖</span>
          <h4>Share Brief Stories</h4>
          <p>"I helped your neighbor two streets over last week..."</p>
        </div>
        <div class="tip-card">
          <span class="tip-icon">👔</span>
          <h4>Be Professional</h4>
          <p>Trusted advisor, not a pushy salesperson</p>
        </div>
      </div>

      <!-- Key Phrases -->
      <h2>Key Phrases That Work</h2>
      <div class="key-phrases">
        <div class="phrase-chip">"I'm working in your neighborhood today..."</div>
        <div class="phrase-chip">"Your neighbors at [address] just got approved..."</div>
        <div class="phrase-chip">"This will only take 2 minutes from the ground..."</div>
        <div class="phrase-chip">"Worst case, I give you peace of mind..."</div>
        <div class="phrase-chip">"I noticed [specific visible damage]..."</div>
      </div>

      <div class="module-completion-section" id="module-complete-section" style="display: none;">
        <button class="complete-module-btn" onclick="completeModule('initial-pitch')">
          Complete Module & Continue →
        </button>
      </div>
    </div>
  `,
   'inspection-process': `
    <div class="content-card inspection-module-redesign">
      <!-- Module Header with Gradient -->
      <div class="module-header-gradient" style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%); color: white; padding: 30px; margin: -20px -20px 30px -20px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; color: white;">🔍 The Inspection Process</h1>
        <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 1.1rem;">Master the 6-step process that separates professionals from amateurs</p>
      </div>

      <!-- Video Section -->
      ${renderVideoPlayer('https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/module7-inspection-process.mp4', 'inspection-process-video', '📹 Complete Inspection Process Walkthrough')}

      <!-- Introduction Card -->
      <div class="intro-highlight-card" style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-left: 5px solid #3b82f6; padding: 24px; border-radius: 0 16px 16px 0; margin: 30px 0;">
        <h2 style="margin: 0 0 12px 0; color: #1e40af;">🎯 Why a Systematic Process Matters</h2>
        <p style="margin: 0; color: #334155; line-height: 1.7;">A thorough, consistent inspection process ensures you never miss damage, builds trust with homeowners, and creates bulletproof documentation for insurance claims. Follow these 6 steps every time - no shortcuts.</p>
      </div>

      <!-- SECTION 1: Interactive 6-Step Cards -->
      <h2 style="margin-bottom: 20px;">📋 The 6-Step Inspection Process</h2>
      <p style="color: #4a5568; margin-bottom: 24px;">Click any step to learn more. Each step builds on the previous one for a complete inspection.</p>

      <div class="inspection-steps-grid" id="inspection-steps-grid">
        <!-- Step 1 -->
        <div class="inspection-step-card" data-step="1" onclick="toggleStepCard(this)">
          <div class="step-card-header">
            <span class="step-badge" style="background: #ef4444;">1</span>
            <span class="step-icon">🦺</span>
            <h3>Safety First</h3>
            <span class="expand-icon">+</span>
          </div>
          <div class="step-card-content">
            <p>Check ladder stability, wear harness if needed, assess roof walkability. Never compromise safety for speed.</p>
            <div class="step-checklist">
              <label><input type="checkbox" /> Ladder secured at 4:1 angle</label>
              <label><input type="checkbox" /> Harness worn if roof pitch > 6/12</label>
              <label><input type="checkbox" /> Roof walkability assessed</label>
            </div>
          </div>
        </div>

        <!-- Step 2 -->
        <div class="inspection-step-card" data-step="2" onclick="toggleStepCard(this)">
          <div class="step-card-header">
            <span class="step-badge" style="background: #f97316;">2</span>
            <span class="step-icon">🔄</span>
            <h3>360° Ground Walk</h3>
            <span class="expand-icon">+</span>
          </div>
          <div class="step-card-content">
            <p>Walk the full perimeter and capture collateral damage on the ground: siding, screens, gutters, downspouts, window trim, AC, fences.</p>
            <div class="step-pro-tip">
              <strong>Pro Tip:</strong> Shoot damage on every elevation (front, right, rear, left) before you climb.
            </div>
          </div>
        </div>

        <!-- Step 3 -->
        <div class="inspection-step-card" data-step="3" onclick="toggleStepCard(this)">
          <div class="step-card-header">
            <span class="step-badge" style="background: #eab308;">3</span>
            <span class="step-icon">🏠</span>
            <h3>Roof Collateral Damage</h3>
            <span class="expand-icon">+</span>
          </div>
          <div class="step-card-content">
            <p>Once on the roof, check metals and components for hits: vents, flashing, drip edge, ridge caps, and soft metals.</p>
            <div class="step-checklist">
              <label><input type="checkbox" /> Vents and flashing checked</label>
              <label><input type="checkbox" /> Soft metals show dents/pitting</label>
              <label><input type="checkbox" /> Drip edge and ridge caps reviewed</label>
            </div>
          </div>
        </div>

        <!-- Step 4 -->
        <div class="inspection-step-card" data-step="4" onclick="toggleStepCard(this)">
          <div class="step-card-header">
            <span class="step-badge" style="background: #84cc16;">4</span>
            <span class="step-icon">🔍</span>
            <h3>Shingle Inspection</h3>
            <span class="expand-icon">+</span>
          </div>
          <div class="step-card-content">
            <p>Look for bruising, missing granules, lifted tabs, creases, or missing shingles. Mark hail strikes with chalk or a test square.</p>
            <div class="step-checklist">
              <label><input type="checkbox" /> Check for granule loss</label>
              <label><input type="checkbox" /> Look for creases/lifted tabs</label>
              <label><input type="checkbox" /> Mark hail strikes with chalk</label>
            </div>
          </div>
        </div>

        <!-- Step 5 -->
        <div class="inspection-step-card" data-step="5" onclick="toggleStepCard(this)">
          <div class="step-card-header">
            <span class="step-badge" style="background: #22c55e;">5</span>
            <span class="step-icon">📸</span>
            <h3>Damage Overview</h3>
            <span class="expand-icon">+</span>
          </div>
          <div class="step-card-content">
            <p>After close-ups, take wide shots of each slope showing all checked damage for full context.</p>
            <div class="step-pro-tip">
              <strong>Pro Tip:</strong> Pair every close-up with an overview shot that shows location on the roof.
            </div>
          </div>
        </div>

        <!-- Step 6 -->
        <div class="inspection-step-card" data-step="6" onclick="toggleStepCard(this)">
          <div class="step-card-header">
            <span class="step-badge" style="background: #14b8a6;">6</span>
            <span class="step-icon">🪣</span>
            <h3>Granules in Gutters & Downspouts</h3>
            <span class="expand-icon">+</span>
          </div>
          <div class="step-card-content">
            <p>Check gutters and downspouts for granules. This is strong evidence of recent shingle damage.</p>
            <div class="step-pro-tip">
              <strong>Pro Tip:</strong> Get a tight close-up so granules are clearly visible on camera.
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 2: Photo Documentation Strategy Cards -->
      <h2 style="margin: 40px 0 20px 0;">📷 Photo Documentation Strategy</h2>
      <p style="color: #4a5568; margin-bottom: 24px;">A thorough inspection tells a story. Follow this order to capture all necessary evidence. This process should take 15-20 minutes.</p>

      <div class="photo-strategy-grid with-images">
        <div class="photo-strategy-card has-image" onclick="openPhotoModal('/assets/photo-strategy/step1-overview.jpg', 'Step 1: Ground Collateral Start', 'Begin your 360 walk. Capture the front of the home plus any visible collateral damage (siding, screens, downspouts, gutters).')">
          <div class="photo-card-number">1</div>
          <img src="/assets/photo-strategy/step1-overview.jpg" alt="Overview shot example" class="strategy-photo" />
          <h4>Ground Collateral Start</h4>
          <p>Front-of-home + visible collateral damage.</p>
        </div>
        <div class="photo-strategy-card has-image" onclick="openPhotoModal('/assets/photo-strategy/step2-front-elevation.jpg', 'Step 2: Front Elevation Damage', 'Document front-side collateral damage: downspout dents, gutter hits, siding or screen damage.')">
          <div class="photo-card-number">2</div>
          <img src="/assets/photo-strategy/step2-front-elevation.jpg" alt="Front elevation example" class="strategy-photo" />
          <h4>Front Elevation Damage</h4>
          <p>Front-side collateral damage details.</p>
        </div>
        <div class="photo-strategy-card has-image" onclick="openPhotoModal('/assets/photo-strategy/step3-right-elevation.jpg', 'Step 3: Right Elevation Damage', 'Capture right-side collateral damage (screens, gutters, siding, window trim).')">
          <div class="photo-card-number">3</div>
          <img src="/assets/photo-strategy/step3-right-elevation.jpg" alt="Right elevation example" class="strategy-photo" />
          <h4>Right Elevation Damage</h4>
          <p>Right-side collateral damage.</p>
        </div>
        <div class="photo-strategy-card has-image" onclick="openPhotoModal('/assets/photo-strategy/step4-rear-elevation.jpg', 'Step 4: Rear Elevation Damage', 'The rear often has the most collateral hits - document gutters, siding, and screens.')">
          <div class="photo-card-number">4</div>
          <img src="/assets/photo-strategy/step4-rear-elevation.jpg" alt="Rear elevation example" class="strategy-photo" />
          <h4>Rear Elevation Damage</h4>
          <p>Rear-side collateral damage.</p>
        </div>
        <div class="photo-strategy-card has-image" onclick="openPhotoModal('/assets/photo-strategy/step5-left-elevation.jpg', 'Step 5: Left Elevation Damage', 'Finish the 360 walk with left-side collateral damage.')">
          <div class="photo-card-number">5</div>
          <img src="/assets/photo-strategy/step5-left-elevation.jpg" alt="Left elevation example" class="strategy-photo" />
          <h4>Left Elevation Damage</h4>
          <p>Left-side collateral damage.</p>
        </div>
        <div class="photo-strategy-card has-image" onclick="openPhotoModal('/assets/photo-strategy/step6-roof-overview.jpg', 'Step 6: Roof Collateral Damage', 'On-roof collateral: vents, flashing, drip edge, ridge caps, soft metals.')">
          <div class="photo-card-number">6</div>
          <img src="/assets/photo-strategy/step6-roof-overview.jpg" alt="Roof overview example" class="strategy-photo" />
          <h4>Roof Collateral Damage</h4>
          <p>Metals, vents, flashing hits.</p>
        </div>
        <div class="photo-strategy-card has-image" onclick="openPhotoModal('/assets/photo-strategy/step7-mark-damage.jpg', 'Step 7: Shingle Damage Close-Up', 'Close-up shingles showing hail hits or wind creases. Mark damage if needed.')">
          <div class="photo-card-number">7</div>
          <img src="/assets/photo-strategy/step7-mark-damage.jpg" alt="Mark damage example" class="strategy-photo" />
          <h4>Shingle Damage Close-Up</h4>
          <p>Close-up shingle hits or creases.</p>
        </div>
        <div class="photo-strategy-card has-image" onclick="openPhotoModal('/assets/photo-strategy/step8-damage-overview.jpg', 'Step 8: Damage Overview', 'Wide shots showing all checked damage areas on each slope.')">
          <div class="photo-card-number">8</div>
          <img src="/assets/photo-strategy/step8-damage-overview.jpg" alt="Damage overview example" class="strategy-photo" />
          <h4>Damage Overview</h4>
          <p>Wide shots of checked damage.</p>
        </div>
        <div class="photo-strategy-card has-image" onclick="openPhotoModal('/assets/photo-strategy/step9-gutters.jpg', 'Step 9: Granules in Gutters & Downspouts', 'Granules in gutters/downspouts are key evidence - get a tight close-up.')">
          <div class="photo-card-number">9</div>
          <img src="/assets/photo-strategy/step9-gutters.jpg" alt="Gutters example" class="strategy-photo" />
          <h4>Granules in Gutters & Downspouts</h4>
          <p>Granule evidence in gutters/downspouts.</p>
        </div>
      </div>

      <!-- Key Photo Tips -->
      <div class="photo-tips-box" style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 24px; margin: 30px 0;">
        <h3 style="margin: 0 0 16px 0; color: #92400e;">📸 Key Photo Tips</h3>
        <ul style="margin: 0; padding-left: 24px; color: #78350f;">
          <li><strong>Make it look good on camera:</strong> If it doesn't read clearly, retake it.</li>
          <li><strong>Use your phone camera only:</strong> No extra apps or filters.</li>
          <li><strong>Quality over quantity:</strong> 1-2 great damage photos beat 100 mixed shots.</li>
          <li><strong>Group your photos:</strong> Ground collateral → roof collateral → close-up shingles → overall shingles → granules.</li>
          <li><strong>Delete bad shots:</strong> Keep the report clean and confident.</li>
        </ul>
        <p style="margin: 16px 0 0 0; font-weight: 600; color: #92400e;">💡 Key takeaway: Getting enough clear photos to convince the homeowner is the most important part. Without their belief, you can't file a claim.</p>
      </div>

      <!-- SECTION 3: Inspection Ordering Game -->
      <h2 style="margin: 40px 0 20px 0;">🎮 Test Your Knowledge: Step Ordering Game</h2>
      <p class="game-instructions">Drag and drop the inspection steps into the correct order from start to finish. Get them all right to unlock module completion!</p>

      <div id="inspection-order-game" class="game-board">
        <div class="game-column">
          <h4>🔀 Steps (Drag from here)</h4>
          <div id="inspection-items-pool">
            <div class="inspection-drag-item" draggable="true" data-order="2">🔄 360° Ground Walk</div>
            <div class="inspection-drag-item" draggable="true" data-order="5">📸 Damage Overview</div>
            <div class="inspection-drag-item" draggable="true" data-order="1">🦺 Safety First</div>
            <div class="inspection-drag-item" draggable="true" data-order="4">🔍 Shingle Inspection</div>
            <div class="inspection-drag-item" draggable="true" data-order="6">🪣 Granules in Gutters</div>
            <div class="inspection-drag-item" draggable="true" data-order="3">🏠 Roof Collateral Check</div>
          </div>
        </div>
        <div class="game-column">
          <h4>✅ Correct Order (Drop here)</h4>
          <div id="inspection-sorted-list"></div>
        </div>
      </div>
      <div id="inspection-order-feedback" style="display: none;"></div>
      <button id="reset-inspection-game" class="reset-game-btn" onclick="resetInspectionGame()" style="display: none; margin-top: 16px;">🔄 Reset & Try Again</button>

      <!-- Completion Section -->
      <div class="module-completion-section" id="module-complete-section" style="display: none;">
        <div class="completion-celebration" style="text-align: center; padding: 30px; background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); border-radius: 16px; margin-top: 30px;">
          <span style="font-size: 3rem;">🎉</span>
          <h3 style="color: #166534; margin: 16px 0;">Excellent Work!</h3>
          <p style="color: #15803d;">You've mastered the 6-step inspection process. Now you're ready to conduct professional roof inspections!</p>
        </div>
        <button class="complete-module-btn" onclick="completeModule('inspection-process')">
          Complete Module & Continue →
        </button>
      </div>
    </div>
  `,
  'post-inspection-pitch': `
    <div class="content-card post-inspection-redesign">
        <div class="module-header-gradient" style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%); color: white; padding: 30px; margin: -20px -20px 30px -20px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; color: white;">🎯 Post-Inspection Pitch</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 1.1rem;">Master the art of presenting damage and closing the deal</p>
        </div>

        ${renderVideoPlayer('https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/module9-post-inspection.mp4', 'post-inspection-video', '📹 Mastering the Post-Inspection Pitch')}

        <!-- Full Script Section with Enhanced TTS -->
        <div class="full-script-section" style="margin: 30px 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0;">📜 The Complete Post-Inspection Script</h2>
            <button class="speak-btn-enhanced" onclick="speakFullScript()" style="display: flex; align-items: center; gap: 10px; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; border: none; padding: 12px 24px; border-radius: 30px; cursor: pointer; font-weight: bold; font-size: 1rem; box-shadow: 0 4px 15px rgba(34, 197, 94, 0.4); transition: all 0.3s;">
              <span style="font-size: 1.5rem;">🔊</span>
              <span>Listen to Full Script</span>
            </button>
          </div>

          <!-- INTEGRITY Phase -->
          <div class="script-phase" style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-left: 5px solid #3b82f6; border-radius: 0 16px 16px 0; padding: 24px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <span style="background: #3b82f6; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold;">PHASE 1</span>
              <h3 style="margin: 0; color: #1e40af;">🤝 INTEGRITY - Opening</h3>
            </div>
            <div class="script-content" style="background: white; padding: 20px; border-radius: 12px; position: relative;">
              <button class="speak-section-btn" onclick="speakSection(this)" style="position: absolute; top: 10px; right: 10px; background: #3b82f6; color: white; border: none; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">🔊 Play</button>
              <p style="color: #334155; line-height: 1.8; margin: 0;" data-script-text="true">
                <em>[Knock on the door]</em><br><br>
                <strong>"Hey _______, so I have a bunch of photos to show you. First I walked around the perimeter..."</strong><br><br>
                <em>[Show pictures of damage to screens, gutters, downspouts, soft metals]</em><br><br>
                "While this damage functionally isn't a big deal, it really helps build a story. <strong>Think of us like lawyers</strong> and this collateral damage is the evidence that builds the case which helps us get the roof (and siding) approved."
              </p>
            </div>
          </div>

          <!-- QUALITY Phase -->
          <div class="script-phase" style="background: linear-gradient(135deg, #fef9c3 0%, #fef08a 100%); border-left: 5px solid #eab308; border-radius: 0 16px 16px 0; padding: 24px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <span style="background: #eab308; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold;">PHASE 2</span>
              <h3 style="margin: 0; color: #a16207;">⭐ QUALITY - Damage Explanation</h3>
            </div>
            <div class="script-content" style="background: white; padding: 20px; border-radius: 12px; position: relative;">
              <button class="speak-section-btn" onclick="speakSection(this)" style="position: absolute; top: 10px; right: 10px; background: #eab308; color: white; border: none; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">🔊 Play</button>
              <p style="color: #334155; line-height: 1.8; margin: 0;" data-script-text="true">
                "Here are the photos of the damage to your shingles. <strong>Anything I have circled means it's hail damage</strong> [IF wind damage: and anything I have slashed means it's wind damage]."<br><br>
                <em>[Remain on a photo of hail damage]</em><br><br>
                "This is exactly what we look for when we're looking for hail damage. If you notice, the divot is <strong>circular in nature</strong>. Even if this damage doesn't look like a big deal, what happens over time, these hail divots fill with water, freeze... when water freezes it <strong>expands and breaks apart the shingle</strong> which will eventually lead to leaks. That is why your insurance company is responsible and your policy covers this type of damage."<br><br>
                <em>[Slowly swipe through all the pictures of hail]</em>
              </p>
            </div>
          </div>

          <!-- SIMPLICITY Phase -->
          <div class="script-phase" style="background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); border-left: 5px solid #22c55e; border-radius: 0 16px 16px 0; padding: 24px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <span style="background: #22c55e; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold;">PHASE 3</span>
              <h3 style="margin: 0; color: #15803d;">✨ SIMPLICITY - Summary & Close</h3>
            </div>
            <div class="script-content" style="background: white; padding: 20px; border-radius: 12px; position: relative;">
              <button class="speak-section-btn" onclick="speakSection(this)" style="position: absolute; top: 10px; right: 10px; background: #22c55e; color: white; border: none; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">🔊 Play</button>
              <p style="color: #334155; line-height: 1.8; margin: 0;" data-script-text="true">
                "As you can see there is quite a bit of damage."<br><br>
                <em>[If wind damage: "Now here are the wind damaged shingles. You have both shingles that are creased from the wind lifting them up and shingles that have completely been blown off."]</em><br><br>
                <em>[Show granules in gutters/downspouts]</em><br><br>
                "As you can see here, <strong>granules have filled up your gutters</strong>. These granules are supposed to be what's protecting your home. When wind and hail hits your roof, it knocks out these granules which reduces the lifespan of your roof."<br><br>
                "This is very similar to damage to ________'s home and/or the rest of the approvals we've gotten in the area."<br><br>
                "With that being said, insurance companies are always looking for ways to mitigate their losses. It's unfortunate but that's how they make money. <strong>The most important part of this process is that when your insurance company comes out to run their inspection, we are here as storm experts</strong> to make sure you as a homeowner get a fair shake. If they are missing anything we make sure they see all the damage that I just showed you."<br><br>
                "What I'm going to do now is run to my car, grab my iPad and we can get this process started..."
              </p>
            </div>
          </div>

          <!-- Info Gathering Phase -->
          <div class="script-phase" style="background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%); border-left: 5px solid #ec4899; border-radius: 0 16px 16px 0; padding: 24px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <span style="background: #ec4899; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold;">PHASE 4</span>
              <h3 style="margin: 0; color: #be185d;">📋 INTEGRITY - Information Gathering</h3>
            </div>
            <div class="script-content" style="background: white; padding: 20px; border-radius: 12px; position: relative;">
              <button class="speak-section-btn" onclick="speakSection(this)" style="position: absolute; top: 10px; right: 10px; background: #ec4899; color: white; border: none; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">🔊 Play</button>
              <p style="color: #334155; line-height: 1.8; margin: 0;" data-script-text="true">
                <em>[Approach house]</em> "Is there a place we could sit down for 5-10 Minutes?"<br><br>
                <em>[Build rapport as you get settled]</em><br><br>
                "Okay, so first I am going to grab some of your basic information for our system."<br><br>
                <strong>Gather:</strong> Full name, Address, Phone Number, E-mail, Insurance Company<br><br>
                "Do you happen to know your deductible? If not, no big deal at all!"<br><br>
                <em>[After collecting info: Set up claim filing with homeowner's phone]</em><br>
                <strong>→ Move on to Contingency & Claim Authorization</strong>
              </p>
            </div>
          </div>
        </div>

        <!-- Key Points Cards -->
        <h2>💡 Critical Points to Remember</h2>
        <div class="key-points-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin: 20px 0;">
          <div class="key-point-card" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #22c55e; border-radius: 12px; padding: 20px;">
            <div style="font-size: 2rem; margin-bottom: 10px;">⚖️</div>
            <h4 style="margin: 0 0 8px 0; color: #15803d;">Matching Law</h4>
            <p style="margin: 0; color: #334155; font-size: 0.9rem;">Insurance must replace entire roof if >25% damaged (varies by state)</p>
          </div>
          <div class="key-point-card" style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border: 2px solid #ef4444; border-radius: 12px; padding: 20px;">
            <div style="font-size: 2rem; margin-bottom: 10px;">⏰</div>
            <h4 style="margin: 0 0 8px 0; color: #b91c1c;">Urgency</h4>
            <p style="margin: 0; color: #334155; font-size: 0.9rem;">Statute of limitations is 1-2 years in most states</p>
          </div>
          <div class="key-point-card" style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 20px;">
            <div style="font-size: 2rem; margin-bottom: 10px;">💰</div>
            <h4 style="margin: 0 0 8px 0; color: #1d4ed8;">No Cost</h4>
            <p style="margin: 0; color: #334155; font-size: 0.9rem;">Free inspection, only pay deductible if approved</p>
          </div>
          <div class="key-point-card" style="background: linear-gradient(135deg, #fefce8 0%, #fef3c7 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 20px;">
            <div style="font-size: 2rem; margin-bottom: 10px;">🏠</div>
            <h4 style="margin: 0 0 8px 0; color: #b45309;">Home Value</h4>
            <p style="margin: 0; color: #334155; font-size: 0.9rem;">New roof adds $15-20k to property value</p>
          </div>
        </div>

        <!-- Agnes Live Role-Play Practice -->
        <div class="agnes-practice-section" style="background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border: 3px solid #8b5cf6; border-radius: 20px; padding: 30px; margin: 30px 0;">
          <div style="text-align: center; margin-bottom: 20px;">
            <span style="font-size: 3rem;">🎭</span>
            <h2 style="margin: 10px 0 0 0; color: #6d28d9;">Live Role-Play with Agnes</h2>
            <p style="color: #7c3aed; margin: 8px 0 0 0;">Practice your post-inspection pitch with our AI homeowner</p>
          </div>

          <div id="agnes-pitch-practice" style="display: none;">
            <!-- Phase Progress -->
            <div class="pitch-progress" style="display: flex; justify-content: center; gap: 10px; margin-bottom: 20px;">
              <span class="pitch-step active" data-step="1" style="width: 30px; height: 30px; border-radius: 50%; background: #8b5cf6; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold;">1</span>
              <span class="pitch-step" data-step="2" style="width: 30px; height: 30px; border-radius: 50%; background: #e5e7eb; color: #6b7280; display: flex; align-items: center; justify-content: center; font-weight: bold;">2</span>
              <span class="pitch-step" data-step="3" style="width: 30px; height: 30px; border-radius: 50%; background: #e5e7eb; color: #6b7280; display: flex; align-items: center; justify-content: center; font-weight: bold;">3</span>
              <span class="pitch-step" data-step="4" style="width: 30px; height: 30px; border-radius: 50%; background: #e5e7eb; color: #6b7280; display: flex; align-items: center; justify-content: center; font-weight: bold;">4</span>
            </div>

            <!-- Current Phase Banner -->
            <div id="current-phase-banner" style="background: #8b5cf6; color: white; padding: 10px 20px; border-radius: 10px; text-align: center; margin-bottom: 16px;">
              <strong>Phase 1: INTEGRITY - Opening</strong>
            </div>

            <!-- Chat Interface -->
            <div class="pitch-chat" style="background: white; border-radius: 16px; padding: 20px; min-height: 350px; display: flex; flex-direction: column;">
              <div id="pitch-chat-messages" style="flex: 1; max-height: 250px; overflow-y: auto; margin-bottom: 16px;">
                <!-- Messages will be added dynamically -->
              </div>

              <!-- Voice Input Area -->
              <div id="pitch-input-area" style="border-top: 1px solid #e5e7eb; padding-top: 16px;">
                <p id="pitch-prompt-text" style="color: #7c3aed; font-weight: 500; margin-bottom: 16px; text-align: center;">🎯 Deliver your opening - show the collateral damage photos and explain their importance</p>

                <!-- Voice Recording UI -->
                <div style="display: flex; flex-direction: column; align-items: center; gap: 16px;">
                  <div id="voice-status" style="color: #6b7280; font-size: 0.95rem; min-height: 24px;">Press the microphone to speak</div>

                  <button id="voice-record-btn" onclick="toggleVoiceRecording()" style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); border: none; cursor: pointer; box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4); transition: all 0.3s; display: flex; align-items: center; justify-content: center;">
                    <span style="font-size: 2.5rem;">🎤</span>
                  </button>

                  <p id="voice-transcript" style="color: #374151; font-style: italic; text-align: center; min-height: 50px; padding: 10px; background: #f9fafb; border-radius: 10px; width: 100%; display: none;"></p>
                </div>

                <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: center;">
                  <button onclick="skipPitchPhase()" style="background: #e5e7eb; color: #374151; border: none; padding: 10px 24px; border-radius: 20px; cursor: pointer; font-size: 0.9rem;">Skip Phase →</button>
                </div>
              </div>

              <!-- Loading indicator -->
              <div id="agnes-loading" style="display: none; text-align: center; padding: 20px;">
                <div style="display: inline-block; animation: spin 1s linear infinite; font-size: 2rem;">🔄</div>
                <p style="color: #7c3aed; margin-top: 10px;">Agnes is responding...</p>
              </div>
            </div>
          </div>

          <div id="agnes-pitch-start" style="text-align: center;">
            <p style="color: #6b7280; margin-bottom: 16px;">Practice delivering your post-inspection pitch to Agnes, a friendly homeowner. She'll respond naturally and help you improve!</p>
            <button onclick="startLivePitchPractice()" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white; border: none; padding: 16px 40px; border-radius: 30px; cursor: pointer; font-weight: bold; font-size: 1.1rem; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4);">
              🚀 Start Live Role-Play
            </button>
          </div>

          <div id="agnes-pitch-complete" style="display: none; text-align: center;">
            <div style="font-size: 4rem;">🎉</div>
            <h3 style="color: #15803d; margin: 10px 0;">Excellent Work!</h3>
            <p style="color: #334155;">You've completed all 4 phases of the post-inspection pitch!</p>
            <p style="color: #6b7280; font-size: 0.9rem; margin-top: 10px;">Agnes was impressed with your presentation skills.</p>
            <button onclick="resetLivePitchPractice()" style="background: #e5e7eb; color: #374151; border: none; padding: 10px 24px; border-radius: 20px; cursor: pointer; margin-top: 10px;">Practice Again</button>
          </div>
        </div>

        <div class="module-completion-section" id="module-complete-section" style="display: none;">
          <button class="complete-module-btn" onclick="completeModule('post-inspection-pitch')">
            Complete Module & Continue
          </button>
        </div>
    </div>
  `,
  'objection-handling': `
    <div class="content-card objection-module-redesign">
        <h1>Handling Initial Pitch Objections</h1>
        <p class="module-intro">Master the art of turning "No" into "Let's do it." Every objection is an opportunity to build trust and demonstrate value.</p>

        <!-- Steps to Overcoming Objections -->
        <h2>Steps to Overcoming Objections</h2>
        <div class="objection-steps-container">
          <div class="objection-step" data-step="1">
            <div class="step-number">1</div>
            <div class="step-content">
              <h3>Pause & Listen</h3>
              <p>Take a breath. Let them finish completely. Don't interrupt or jump to defend - silence shows respect and gives you time to think.</p>
              <div class="step-example">
                <span class="example-label">Example:</span> Nod, maintain eye contact, let them get it all out.
              </div>
            </div>
          </div>

          <div class="objection-step" data-step="2">
            <div class="step-number">2</div>
            <div class="step-content">
              <h3>Acknowledge & Validate</h3>
              <p>Show you heard them. Use phrases that validate without agreeing with the objection itself.</p>
              <div class="step-example">
                <span class="example-label">Say:</span> "I completely understand..." or "That's a fair concern..." or "I hear you..."
              </div>
            </div>
          </div>

          <div class="objection-step" data-step="3">
            <div class="step-number">3</div>
            <div class="step-content">
              <h3>Clarify the Real Concern</h3>
              <p>Often the stated objection isn't the real issue. Ask questions to uncover what's really holding them back.</p>
              <div class="step-example">
                <span class="example-label">Ask:</span> "What specifically concerns you about that?" or "Is it the time, the cost, or something else?"
              </div>
            </div>
          </div>

          <div class="objection-step" data-step="4">
            <div class="step-number">4</div>
            <div class="step-content">
              <h3>Respond with Value</h3>
              <p>Address their specific concern with facts, social proof, or benefits. Tailor your response - don't just recite a script.</p>
              <div class="step-example">
                <span class="example-label">Use:</span> Neighbor stories, statistics, risk-reversal ("If there's no damage, I'll be out of your hair in 5 minutes")
              </div>
            </div>
          </div>

          <div class="objection-step" data-step="5">
            <div class="step-number">5</div>
            <div class="step-content">
              <h3>Move Forward Confidently</h3>
              <p>Don't wait for permission. Transition to the next step with an assumptive close.</p>
              <div class="step-example">
                <span class="example-label">Say:</span> "So let me take a quick look and we'll go from there. I'll start on this side..."
              </div>
            </div>
          </div>
        </div>

        <!-- Interactive Objection Cards -->
        <h2>Common Objections & How to Handle Them</h2>
        <p class="section-intro">Click any card to reveal the best response and why it works.</p>

        <div class="interactive-objections-grid">
          <div class="objection-flip-card" onclick="this.classList.toggle('flipped')">
            <div class="flip-card-inner">
              <div class="flip-card-front">
                <div class="objection-icon">⏰</div>
                <h3>"I'm busy right now"</h3>
                <p class="tap-hint">Tap to see response</p>
              </div>
              <div class="flip-card-back">
                <div class="response-content">
                  <p class="response-text">"I understand! This will only take 2 minutes from the ground. I can come back at [specific time] if that works better?"</p>
                  <div class="why-works">
                    <strong>Why it works:</strong> Acknowledges constraint, offers flexibility, gives specific alternatives.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="objection-flip-card" onclick="this.classList.toggle('flipped')">
            <div class="flip-card-inner">
              <div class="flip-card-front">
                <div class="objection-icon">🔧</div>
                <h3>"We already have a roofer"</h3>
                <p class="tap-hint">Tap to see response</p>
              </div>
              <div class="flip-card-back">
                <div class="response-content">
                  <p class="response-text">"Totally. I'm not here to replace them — I just need 15 minutes to check for storm damage and show you what I find. It's free and quick."</p>
                  <div class="why-works">
                    <strong>Why it works:</strong> Respects their relationship and moves straight to a quick inspection.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="objection-flip-card" onclick="this.classList.toggle('flipped')">
            <div class="flip-card-inner">
              <div class="flip-card-front">
                <div class="objection-icon">🏠</div>
                <h3>"I don't think I have damage"</h3>
                <p class="tap-hint">Tap to see response</p>
              </div>
              <div class="flip-card-back">
                <div class="response-content">
                  <p class="response-text">"You might be right! But I've been on 10 roofs in this neighborhood today, and 8 had damage the owner didn't know about. Let me check - worst case, I give you peace of mind."</p>
                  <div class="why-works">
                    <strong>Why it works:</strong> Social proof + peace of mind angle. Low risk proposition.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="objection-flip-card" onclick="this.classList.toggle('flipped')">
            <div class="flip-card-inner">
              <div class="flip-card-front">
                <div class="objection-icon">🚫</div>
                <h3>"Not interested"</h3>
                <p class="tap-hint">Tap to see response</p>
              </div>
              <div class="flip-card-back">
                <div class="response-content">
                  <p class="response-text">"I get it, a lot of your neighbors said the same thing at first. Then I showed them photos of hail damage they couldn't see from the ground. If there's nothing, you lose 2 minutes. If there is damage, you save thousands."</p>
                  <div class="why-works">
                    <strong>Why it works:</strong> Social proof, risk-reversal, high gain vs low investment.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="objection-flip-card" onclick="this.classList.toggle('flipped')">
            <div class="flip-card-inner">
              <div class="flip-card-front">
                <div class="objection-icon">💑</div>
                <h3>"I need to talk to my spouse"</h3>
                <p class="tap-hint">Tap to see response</p>
              </div>
              <div class="flip-card-back">
                <div class="response-content">
                  <p class="response-text">"That's great, the inspection is free and I can leave info for both of you. Or I can wait a few minutes if they'll be home soon. This way you have the facts when you talk."</p>
                  <div class="why-works">
                    <strong>Why it works:</strong> Respects their process, positions inspection as info-gathering.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="objection-flip-card" onclick="this.classList.toggle('flipped')">
            <div class="flip-card-inner">
              <div class="flip-card-front">
                <div class="objection-icon">🤔</div>
                <h3>"Let me think about it"</h3>
                <p class="tap-hint">Tap to see response</p>
              </div>
              <div class="flip-card-back">
                <div class="response-content">
                  <p class="response-text">"Of course! What specifically would you like to think over? I want to make sure I've answered all your questions before I go."</p>
                  <div class="why-works">
                    <strong>Why it works:</strong> Uncovers the real objection hidden behind "think about it."
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Objection Response Challenge Game -->
        <h2>🎮 Objection Response Challenge</h2>
        <p class="game-intro">Test your skills! Pick the best response for each scenario. Score 100% to master objection handling.</p>

        <div class="objection-challenge-game" id="objection-challenge-container">
          <div class="challenge-progress">
            <div class="progress-bar-container">
              <div class="challenge-progress-bar" id="challenge-progress-bar" style="width: 0%"></div>
            </div>
            <span class="progress-text" id="challenge-progress-text">Question 1 of 5</span>
          </div>

          <div class="challenge-score-display">
            <span class="score-label">Score:</span>
            <span class="score-value" id="challenge-score">0</span>
            <span class="score-max">/ 500</span>
          </div>

          <div class="challenge-card" id="challenge-card">
            <div class="scenario-header">
              <span class="scenario-icon">🏠</span>
              <span class="scenario-label">Homeowner says:</span>
            </div>
            <p class="scenario-text" id="scenario-text">"I'm really busy right now, maybe another time."</p>

            <div class="response-options" id="response-options">
              <button class="response-option" data-correct="false" onclick="selectChallengeResponse(this)">
                "Okay, I'll come back later then."
              </button>
              <button class="response-option" data-correct="true" onclick="selectChallengeResponse(this)">
                "I totally understand! This will only take 2 minutes from the ground. Would 4pm today or 10am tomorrow work better for a full look?"
              </button>
              <button class="response-option" data-correct="false" onclick="selectChallengeResponse(this)">
                "But this is really important, you could have serious damage."
              </button>
            </div>

            <div class="challenge-feedback" id="challenge-feedback" style="display: none;">
              <div class="feedback-icon"></div>
              <p class="feedback-text"></p>
              <button class="next-question-btn" id="next-question-btn" onclick="nextChallengeQuestion()">Next Question →</button>
            </div>
          </div>

          <div class="challenge-complete" id="challenge-complete" style="display: none;">
            <div class="complete-icon">🏆</div>
            <h3>Challenge Complete!</h3>
            <p class="final-score">Your Score: <span id="final-score">0</span> / 500</p>
            <p class="score-message" id="score-message"></p>
            <button class="restart-challenge-btn" onclick="restartObjectionChallenge()">Try Again</button>
          </div>
        </div>

        <div class="module-completion-section" id="module-complete-section" style="display: none;">
          <button class="complete-module-btn" onclick="completeModule('handling-initial-pitch-objections')">
            Complete Module & Continue
          </button>
        </div>
    </div>
  `,
  'shingle-types': `
    <div class="content-card">
      <h1>Module 4: Shingle Types & Materials</h1>
      <p class="module-intro">Understanding the difference between shingle types is fundamental for accurately assessing roof conditions and communicating effectively with both homeowners and insurance adjusters. This module will train you to identify shingle types on sight and understand their performance characteristics.</p>

      <h2>Visual Comparison: 3-Tab vs. Architectural Shingles</h2>
      <div class="shingle-comparison-enhanced">
        <div class="shingle-card shingle-3tab">
          <div class="shingle-header">
            <h3>3-Tab Shingles</h3>
          </div>

          <div class="shingle-photo-container">
            <img src="/assets/shingles/3-tab-shingles.webp"
                 alt="3-Tab Shingles - flat, uniform appearance with distinct rectangular tabs"
                 class="shingle-photo"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="photo-placeholder" style="display: none;">
              <p>📋 3-Tab Shingle Reference</p>
              <small>Flat, uniform pattern with 3 distinct rectangular tabs</small>
              <div style="margin-top: 12px; padding: 12px; background: rgba(255,255,255,0.9); border-radius: 4px;">
                <strong>Key Visual Markers:</strong>
                <ul style="text-align: left; margin: 8px 0 0 0; padding-left: 20px; font-size: 0.85rem;">
                  <li>Single flat layer - no dimensional depth</li>
                  <li>Three evenly-spaced rectangular cutouts per shingle</li>
                  <li>Consistent thickness across entire surface</li>
                  <li>Repeating brick-like pattern every few rows</li>
                </ul>
              </div>
            </div>
            <div class="photo-caption">Notice the flat, uniform pattern with visible cutouts</div>
          </div>

          <div class="shingle-specs">
            <div class="spec-group">
              <h4>Key Identification Features</h4>
              <ul class="identification-list">
                <li><span class="check-icon">✓</span> <strong>Flat appearance</strong> - Single layer design with no dimensional depth</li>
                <li><span class="check-icon">✓</span> <strong>Three distinct tabs</strong> - Rectangular cutouts create brick-like pattern</li>
                <li><span class="check-icon">✓</span> <strong>Uniform thickness</strong> - Same thickness across entire shingle (~0.19")</li>
                <li><span class="check-icon">✓</span> <strong>Repeating pattern</strong> - Obvious pattern repetition every few courses</li>
              </ul>
            </div>

            <div class="spec-group">
              <h4>Technical Specifications</h4>
              <div class="specs-grid">
                <div class="spec-item">
                  <span class="spec-label">Dimensions</span>
                  <span class="spec-value">36" × 12" × 0.19"</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Weight</span>
                  <span class="spec-value">200-250 lbs/square</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Lifespan</span>
                  <span class="spec-value">15-25 years</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Wind Rating</span>
                  <span class="spec-value">60-70 mph</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Best For</span>
                  <span class="spec-value">Rentals, Budget Projects</span>
                </div>
              </div>
            </div>

            <div class="spec-group">
              <h4>Common Misconceptions</h4>
              <ul class="misconceptions-list">
                <li><span class="x-icon">✗</span> "3-tab means 3 layers" - Actually single layer with 3 visible tabs</li>
                <li><span class="x-icon">✗</span> "Same quality as architectural" - Lower wind resistance and shorter lifespan</li>
                <li><span class="x-icon">✗</span> "Easy to match for repairs" - Most 3-tab lines are discontinued</li>
              </ul>
            </div>
          </div>
        </div>

        <div class="shingle-card shingle-architectural">
          <div class="shingle-header">
            <h3>Architectural Shingles</h3>
          </div>

          <div class="shingle-photo-container">
            <img src="/assets/shingles/architectural-shingles.jpg"
                 alt="Architectural Shingles - GAF Timberline HDZ showing dimensional, layered appearance"
                 class="shingle-photo"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="photo-placeholder" style="display: none;">
              <p>🏗️ Architectural Shingle Reference</p>
              <small>Dimensional, multi-layer construction with varied depth</small>
              <div style="margin-top: 12px; padding: 12px; background: rgba(255,255,255,0.9); border-radius: 4px;">
                <strong>Key Visual Markers:</strong>
                <ul style="text-align: left; margin: 8px 0 0 0; padding-left: 20px; font-size: 0.85rem;">
                  <li>Multiple laminated layers creating depth</li>
                  <li>Varied tab shapes with random pattern</li>
                  <li>Visible shadow lines and texture</li>
                  <li>No obvious pattern repetition</li>
                </ul>
              </div>
            </div>
            <div class="photo-caption">GAF Timberline HDZ - Notice the dimensional, textured look with varied depth</div>
          </div>

          <div class="shingle-specs">
            <div class="spec-group">
              <h4>Key Identification Features</h4>
              <ul class="identification-list">
                <li><span class="check-icon">✓</span> <strong>Dimensional appearance</strong> - Multi-layer laminated construction</li>
                <li><span class="check-icon">✓</span> <strong>Varied tab shapes</strong> - Random pattern mimics natural materials</li>
                <li><span class="check-icon">✓</span> <strong>Textured surface</strong> - Visible depth and shadow lines</li>
                <li><span class="check-icon">✓</span> <strong>No repeating pattern</strong> - Designed to look like natural slate or wood</li>
              </ul>
            </div>

            <div class="spec-group">
              <h4>Technical Specifications</h4>
              <div class="specs-grid">
                <div class="spec-item">
                  <span class="spec-label">Construction</span>
                  <span class="spec-value">Multiple layers laminated</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Weight</span>
                  <span class="spec-value">300-400 lbs/square</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Lifespan</span>
                  <span class="spec-value">25-30+ years</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Wind Rating</span>
                  <span class="spec-value">110-130 mph</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Best For</span>
                  <span class="spec-value">Primary Homes, Curb Appeal</span>
                </div>
              </div>
            </div>

            <div class="spec-group">
              <h4>Why Homeowners Choose Architectural</h4>
              <ul class="identification-list">
                <li><span class="star-icon">★</span> Enhanced curb appeal improves home appearance</li>
                <li><span class="star-icon">★</span> Superior wind resistance (130 mph vs 70 mph)</li>
                <li><span class="star-icon">★</span> Thicker laminated build for stronger impact resistance</li>
                <li><span class="star-icon">★</span> More durable construction with multiple layers</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <h2>Interactive Training: Spot the Difference</h2>
      <div class="training-quiz-section">
        <p class="quiz-instructions">Test your identification skills. Can you spot the key differences between these shingle types?</p>

        <div class="visual-markers-grid">
          <div class="marker-card">
            <div class="marker-icon">👁️</div>
            <h4>Look from the side</h4>
            <p>3-tab shingles appear completely flat with uniform thickness. Architectural shingles have visible depth variation and shadow lines from multiple layers.</p>
          </div>

          <div class="marker-card">
            <div class="marker-icon">🔍</div>
            <h4>Check the pattern</h4>
            <p>3-tab has obvious repeating rectangular cutouts creating a grid. Architectural has random, varied tab shapes with no visible pattern repetition.</p>
          </div>

          <div class="marker-card">
            <div class="marker-icon">📏</div>
            <h4>Feel the weight</h4>
            <p>Architectural shingles are notably heavier (50% more weight per square) due to laminated layers. You can feel this when lifting a bundle.</p>
          </div>

          <div class="marker-card">
            <div class="marker-icon">🎨</div>
            <h4>Observe texture</h4>
            <p>3-tab has consistent granule pattern. Architectural uses varied granule colors and sizes to create dimensional appearance mimicking natural materials.</p>
          </div>
        </div>
      </div>

      <h2>Material Composition: What Shingles Are Made Of</h2>
      <div class="composition-section">
        <div class="composition-diagram">
          <div class="layer-item">
            <div class="layer-number">1</div>
            <div class="layer-content">
              <h4>Ceramic Granules (Top Surface)</h4>
              <p>Colored ceramic-coated granules provide UV protection, fire resistance, and aesthetic appeal. Granule loss indicates damage or age-related deterioration.</p>
            </div>
          </div>

          <div class="layer-item">
            <div class="layer-number">2</div>
            <div class="layer-content">
              <h4>Asphalt Coating</h4>
              <p>Weatherproofing asphalt layer bonds granules and provides waterproofing. Oxidized or modified asphalt improves flexibility and longevity.</p>
            </div>
          </div>

          <div class="layer-item">
            <div class="layer-number">3</div>
            <div class="layer-content">
              <h4>Fiberglass Mat Base</h4>
              <p>Fiberglass reinforcement provides structural integrity and fire resistance. Replaced older organic felt mats in modern shingles (post-1980s).</p>
            </div>
          </div>

          <div class="layer-item">
            <div class="layer-number">4</div>
            <div class="layer-content">
              <h4>Self-Sealing Adhesive Strip</h4>
              <p>Heat-activated adhesive bonds shingles after installation. Critical for wind resistance - activates with sun exposure within days of installation.</p>
            </div>
          </div>
        </div>
      </div>

      <h2>Major Manufacturers & Market Position</h2>
      <div class="manufacturers-grid">
        <div class="manufacturer-card manufacturer-gaf">
          <div class="manufacturer-logo-placeholder">GAF</div>
          <h4>GAF - Market Leader</h4>
          <div class="market-share">~30% Market Share</div>
          <p><strong>Signature Line:</strong> Timberline HDZ with LayerLock Technology</p>
          <ul>
            <li>North America's #1 roofing manufacturer</li>
            <li>StrikeZone nailing area (99% improvement in nail pull-through)</li>
            <li>LayerLock tech for stronger fastening performance</li>
            <li>Most common brand in insurance claims</li>
          </ul>
          <div class="manufacturer-note">Most inspectors encounter GAF on 30-40% of roofs</div>
        </div>

        <div class="manufacturer-card manufacturer-oc">
          <div class="manufacturer-logo-placeholder">OC</div>
          <h4>Owens Corning</h4>
          <div class="market-share">~20% Market Share</div>
          <p><strong>Signature Line:</strong> Duration Series with SureNail Technology</p>
          <ul>
            <li>Known for pink fiberglass insulation (brand recognition)</li>
            <li>SureNail Technology - woven fabric nailing strip</li>
            <li>TruDefinition color granules for enhanced aesthetics</li>
            <li>Strong contractor network and training programs</li>
          </ul>
          <div class="manufacturer-note">Popular in new construction and high-end residential</div>
        </div>

        <div class="manufacturer-card manufacturer-ct">
          <div class="manufacturer-logo-placeholder">CT</div>
          <h4>CertainTeed</h4>
          <div class="market-share">~15% Market Share</div>
          <p><strong>Signature Line:</strong> Landmark Series</p>
          <ul>
            <li>Part of Saint-Gobain (European conglomerate)</li>
            <li>StreakFighter algae-resistant technology</li>
            <li>Wide color selection (50+ options)</li>
            <li>Premium positioning and pricing</li>
          </ul>
          <div class="manufacturer-note">Common in Northeastern and Mid-Atlantic regions</div>
        </div>

        <div class="manufacturer-card manufacturer-iko">
          <div class="manufacturer-logo-placeholder">IKO</div>
          <h4>IKO</h4>
          <div class="market-share">~10% Market Share</div>
          <p><strong>Signature Line:</strong> Cambridge & Dynasty</p>
          <ul>
            <li>Canadian-based manufacturer</li>
            <li>Budget-friendly pricing strategy</li>
            <li>Good value for rental properties</li>
            <li>Lower wind ratings and thinner profile than premium brands</li>
          </ul>
          <div class="manufacturer-note">Commonly seen on cost-conscious projects and rentals</div>
        </div>
      </div>

      <h2>Why This Knowledge Matters</h2>
      <div class="application-section">
        <div class="application-card">
          <h4>For Homeowner Communication</h4>
          <p>Understanding shingle construction helps you explain the key differences to homeowners:</p>
          <ul>
            <li><strong>Wind Resistance:</strong> "130 mph rating means your roof survives storms that would destroy 3-tab shingles"</li>
            <li><strong>Layered Build:</strong> "Multiple layers add depth and durability you can see"</li>
            <li><strong>Durability:</strong> "Architectural shingles have multiple layers that provide longer-lasting protection"</li>
          </ul>
        </div>

        <div class="application-card">
          <h4>For Insurance Claims Processing</h4>
          <p>Accurate identification affects claim outcomes:</p>
          <ul>
            <li><strong>Matching Laws:</strong> Most 3-tab lines are discontinued, often triggering full replacement rather than repair</li>
            <li><strong>Documentation:</strong> Record brand, model, color name for accurate adjuster estimates</li>
            <li><strong>Age Assessment:</strong> 3-tab deteriorates faster - same age doesn't mean same condition</li>
            <li><strong>Code Requirements:</strong> Many jurisdictions now require minimum architectural grade for replacements</li>
          </ul>
        </div>

        <div class="application-card">
          <h4>On-Site Inspection Tips</h4>
          <p>Quick identification techniques for the field:</p>
          <ul>
            <li><strong>View from ground:</strong> 3-tab looks flat like brick pattern; architectural has visible texture and depth</li>
            <li><strong>Check attic:</strong> Bundle wrappers often left behind show brand and model</li>
            <li><strong>Age estimation:</strong> 3-tab common pre-2005; architectural dominant post-2005</li>
            <li><strong>Neighborhood patterns:</strong> Developments built in same year typically use same shingle type</li>
          </ul>
        </div>
      </div>

      <div class="key-takeaways">
        <h3>Key Takeaways - Memorize These</h3>
        <div class="takeaway-grid">
          <div class="takeaway-item">
            <span class="takeaway-icon">🎯</span>
            <p><strong>3-Tab = Flat, Grid Pattern, Budget</strong></p>
          </div>
          <div class="takeaway-item">
            <span class="takeaway-icon">🎯</span>
            <p><strong>Architectural = Dimensional, Random, Premium</strong></p>
          </div>
          <div class="takeaway-item">
            <span class="takeaway-icon">🎯</span>
            <p><strong>Weight Difference = 50% heavier (architectural)</strong></p>
          </div>
          <div class="takeaway-item">
            <span class="takeaway-icon">🎯</span>
            <p><strong>Wind Rating = 130 mph vs 70 mph</strong></p>
          </div>
          <div class="takeaway-item">
            <span class="takeaway-icon">🎯</span>
            <p><strong>Lifespan = 25-30 yrs vs 15-25 yrs</strong></p>
          </div>
          <div class="takeaway-item">
            <span class="takeaway-icon">🎯</span>
            <p><strong>GAF = Market leader (30% share)</strong></p>
          </div>
        </div>
      </div>

      <div class="practice-prompt">
        <h3>Practice Exercise</h3>
        <p>Before moving to the next module, practice identifying shingle types:</p>
        <ol>
          <li>Drive through a neighborhood and identify 10 roofs as 3-tab or architectural</li>
          <li>Take photos and verify your identification with your trainer</li>
          <li>Note any patterns (age of homes, price points, neighborhood types)</li>
        </ol>
        <p class="practice-note"><strong>Pro Tip:</strong> After identifying 100 roofs, you'll develop instant recognition ability that impresses homeowners and builds credibility.</p>
      </div>

      <!-- Interactive Shingle Challenge Game -->
      <div class="mini-game-section" id="shingle-game">
        <div class="game-header">
          <h3>🎮 Shingle Type Challenge</h3>
          <p>Test your knowledge! Identify whether each description matches 3-Tab or Architectural shingles.</p>
        </div>

        <div class="game-score-bar">
          <span class="score-label">Score:</span>
          <span class="score-value" id="game-score">0</span>
          <span class="score-separator">/</span>
          <span class="score-total" id="game-total">5</span>
          <div class="progress-bar">
            <div class="progress-fill" id="game-progress" style="width: 0%"></div>
          </div>
        </div>

        <div class="game-question-area" id="game-question-area">
          <div class="question-card" id="question-card">
            <div class="question-number">QUESTION <span id="q-num">1</span> OF 5</div>
            <div class="question-text" id="question-text" style="color: #ffffff; font-size: 1.3rem; font-weight: 600; margin: 20px 0; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">Loading question...</div>
            <div class="answer-buttons" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
              <div class="answer-img-btn" data-answer="3tab" onclick="checkShingleAnswer('3tab')" style="cursor: pointer; background: #f8fafc; border-radius: 12px; padding: 15px; border: 3px solid #94a3b8; transition: all 0.3s; text-align: center;">
                <img src="/assets/shingles/3-tab-shingles.webp" alt="3-Tab Shingles" style="width: 100%; height: 120px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;">
                <p style="margin: 0; font-weight: 700; color: #334155; font-size: 1.1rem;">3-Tab</p>
              </div>
              <div class="answer-img-btn" data-answer="arch" onclick="checkShingleAnswer('arch')" style="cursor: pointer; background: #f0fdf4; border-radius: 12px; padding: 15px; border: 3px solid #86efac; transition: all 0.3s; text-align: center;">
                <img src="/assets/shingles/architectural-shingles.jpg" alt="Architectural Shingles" style="width: 100%; height: 120px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;">
                <p style="margin: 0; font-weight: 700; color: #166534; font-size: 1.1rem;">Architectural</p>
              </div>
            </div>
            <div class="feedback-area" id="feedback-area" style="display: none;">
              <div class="feedback-icon" id="feedback-icon"></div>
              <div class="feedback-text" id="feedback-text"></div>
            </div>
          </div>
        </div>

        <div class="game-complete" id="game-complete" style="display: none;">
          <div class="complete-icon">🏆</div>
          <h4>Challenge Complete!</h4>
          <p class="final-score">You scored <span id="final-score">0</span> out of 5</p>
          <p class="score-message" id="score-message"></p>
          <div class="game-complete-actions">
            <button class="replay-btn" onclick="restartShingleGame()">🔄 Play Again</button>
            <button class="complete-module-btn" id="shingle-continue-btn" style="display: none;" onclick="completeModule('shingle-types-materials')">
              Continue to Next Module →
            </button>
          </div>
          <p class="passing-note" id="passing-note" style="display: none; margin-top: 10px; font-size: 0.9em; color: #666;">
            Score 3 or higher to continue
          </p>
        </div>
      </div>
    </div>
  `,
  'roofing-damage-id': `
   <div class="content-card">
        <h1>Roofing & Damage Identification</h1>

        <h2>Understanding Storm Damage Types</h2>

        <div class="damage-types">
          <div class="damage-type">
            <h3>🌨️ Hail Damage</h3>

            <!-- Hail Damage Image Gallery -->
            <div class="damage-gallery">
              <div class="damage-image-item">
                <img src="/assets/damage/hail/hail-damage-1.jpg" alt="Hail damage on shingles showing circular impact patterns">
                <p class="image-caption">Circular hail impacts - marked test square</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/hail/hail-damage-2.jpg" alt="Hail damage showing granule loss">
                <p class="image-caption">Granule loss from hail - exposed asphalt mat</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/hail/hail-damage-3.jpg" alt="Close-up of hail damage divots">
                <p class="image-caption">Close-up of hail divot and bruising</p>
              </div>
            </div>

            <h4>What to Look For:</h4>
            <ul>
              <li>Circular bruising/divots on shingles</li>
              <li>Loss of granules exposing asphalt mat</li>
              <li>Shiny spots where granules are gone</li>
              <li>Damage to vents, flashing, gutters (matching damage)</li>
              <li>Dented AC units, downspouts</li>
            </ul>
            <h4>How to Document:</h4>
            <ul>
              <li>Test square: Use penny for size reference</li>
              <li>Take 5-7 photos per damaged area</li>
              <li>Show both close-up and context shots</li>
              <li>Photograph matching damage on ground items</li>
            </ul>
          </div>

          <div class="damage-type">
            <h3>💨 Wind Damage</h3>

            <!-- Image Gallery with Local Images -->
            <div class="damage-gallery">
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind-damage-1.jpg" alt="Wind damage on shingles">
                <p class="image-caption">Wind damage on shingles</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind-damage-2.webp" alt="Lifted or creased shingles">
                <p class="image-caption">Lifted or creased shingles</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind-damage-3.webp" alt="Missing or torn shingles">
                <p class="image-caption">Missing or torn shingles</p>
              </div>
            </div>

            <h4>What to Look For:</h4>
            <ul>
              <li>Missing shingles (blown off)</li>
              <li>Lifted/creased shingles</li>
              <li>Torn shingles (especially at edges)</li>
              <li>Exposed underlayment</li>
              <li>Damaged or missing ridge caps</li>
            </ul>
            <h4>How to Document:</h4>
            <ul>
              <li>Wide shots showing missing sections</li>
              <li>Close-ups of lifted tabs</li>
              <li>Document direction (shows wind pattern)</li>
              <li>Check all edges and corners first</li>
            </ul>
          </div>

          <!-- Collateral Damage Card -->
          <div class="damage-type">
            <h3>🎯 Collateral Damage</h3>

            <div class="damage-gallery">
              <div class="damage-image-item">
                <img src="/assets/damage/collateral/collateral-damage-1.avif" alt="Collateral damage on siding">
                <p class="image-caption">Aluminum siding impact marks</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/collateral/collateral-damage-2.jpg" alt="Collateral damage on soffit or fascia">
                <p class="image-caption">Soffit or fascia impact marks</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/collateral/collateral-damage-3.png" alt="Collateral damage on gutter">
                <p class="image-caption">Gutter dent impact</p>
              </div>
            </div>

            <div class="key-point-callout" style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-left: 4px solid #ef4444; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-top: 16px;">
              <p style="margin: 0; color: #991b1b;"><strong>💡 Key Point:</strong> Collateral damage strengthens your claim! Insurance can't argue "normal wear" when multiple surfaces show obvious impact damage from the same storm.</p>
            </div>
          </div>
        </div>

        <h3>Shingle Types</h3>
        <p>Identifying the type of shingle is crucial for assessing damage and communicating with adjusters.</p>
        <div class="shingle-comparison" style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 20px 0;">
            <div class="shingle-type" style="background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); border-radius: 16px; padding: 20px; border: 2px solid #94a3b8;">
                <h4 style="color: #334155; margin: 0 0 16px 0; text-align: center;">📐 3-Tab Shingles</h4>
                <img src="/assets/shingles/3-tab-shingles.webp"
                     alt="3-Tab Shingles - flat, uniform appearance"
                     style="width: 100%; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 16px;">
                <div style="background: #fef3c7; padding: 12px; border-radius: 8px; border-left: 4px solid #f59e0b;">
                  <p style="margin: 0; font-size: 0.9rem; color: #92400e;"><strong>Key Features:</strong> Flat, single-layer, distinct rectangular cutouts, "brick" pattern, lighter weight</p>
                </div>
                <p style="margin: 12px 0 0 0; color: #475569; font-size: 0.9rem;">Common pre-2005. Most lines now <strong>discontinued</strong> - often triggers full replacement!</p>
            </div>
            <div class="shingle-type" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; padding: 20px; border: 2px solid #86efac;">
                <h4 style="color: #166534; margin: 0 0 16px 0; text-align: center;">🏔️ Architectural Shingles</h4>
                <img src="/assets/shingles/architectural-shingles.jpg"
                     alt="Architectural Shingles - dimensional, layered appearance"
                     style="width: 100%; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 16px;">
                <div style="background: #d1fae5; padding: 12px; border-radius: 8px; border-left: 4px solid #22c55e;">
                  <p style="margin: 0; font-size: 0.9rem; color: #065f46;"><strong>Key Features:</strong> Multi-layer laminated, dimensional texture, random pattern, 50% heavier</p>
                </div>
                <p style="margin: 12px 0 0 0; color: #166534; font-size: 0.9rem;">Industry standard post-2005. <strong>130 mph wind rating</strong> with a thicker laminated profile.</p>
            </div>
        </div>
        <hr>
        <h2>⚠️ Storm Damage vs. Non-Storm Damage</h2>
        <p>It's vital to differentiate between actual storm damage and other roof issues.</p>

        <!-- Storm vs Non-Storm Comparison -->
        <div class="damage-comparison-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 20px;">

          <!-- Qualifying Damage -->
          <div class="qualifying-damage-card" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 3px solid #22c55e; border-radius: 16px; padding: 24px; position: relative;">
            <div style="position: absolute; top: -14px; left: 20px; background: #22c55e; color: white; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 0.9rem;">
              ✅ QUALIFYING
            </div>
            <h3 style="color: #15803d; margin-top: 10px;">Storm Damage</h3>
            <p style="color: #166534; font-style: italic; margin-bottom: 16px;">Covered by insurance - file a claim!</p>

            <div class="qualifying-items" style="display: flex; flex-direction: column; gap: 12px;">
              <div style="display: flex; align-items: flex-start; gap: 12px; background: white; padding: 12px; border-radius: 8px;">
                <span style="font-size: 1.5rem;">🌨️</span>
                <div>
                  <strong style="color: #15803d;">Hail Damage</strong>
                  <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: #374151;">Circular "bruises" or divots, soft/spongy feel, concentrated granule loss</p>
                </div>
              </div>
              <div style="display: flex; align-items: flex-start; gap: 12px; background: white; padding: 12px; border-radius: 8px;">
                <span style="font-size: 1.5rem;">💨</span>
                <div>
                  <strong style="color: #15803d;">Wind Damage</strong>
                  <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: #374151;">Lifted, creased, or missing shingles from strong winds</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Non-Qualifying Damage -->
          <div class="non-qualifying-damage-card" style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border: 3px solid #ef4444; border-radius: 16px; padding: 24px; position: relative;">
            <div style="position: absolute; top: -14px; left: 20px; background: #ef4444; color: white; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 0.9rem;">
              ❌ NON-QUALIFYING
            </div>
            <h3 style="color: #b91c1c; margin-top: 10px;">Wear & Tear</h3>
            <p style="color: #991b1b; font-style: italic; margin-bottom: 16px;">Not covered - normal aging issues</p>

            <div class="non-qualifying-items" style="display: flex; flex-direction: column; gap: 12px;">
              <div style="display: flex; align-items: flex-start; gap: 12px; background: white; padding: 12px; border-radius: 8px;">
                <span style="font-size: 1.5rem;">🫧</span>
                <div>
                  <strong style="color: #b91c1c;">Blistering</strong>
                  <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: #374151;">Bubbles on surface - manufacturing defect, not storm damage</p>
                </div>
              </div>
              <div style="display: flex; align-items: flex-start; gap: 12px; background: white; padding: 12px; border-radius: 8px;">
                <span style="font-size: 1.5rem;">💔</span>
                <div>
                  <strong style="color: #b91c1c;">Cracking</strong>
                  <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: #374151;">Straight-line splits from age, UV exposure, thermal cycling</p>
                </div>
              </div>
              <div style="display: flex; align-items: flex-start; gap: 12px; background: white; padding: 12px; border-radius: 8px;">
                <span style="font-size: 1.5rem;">⏳</span>
                <div>
                  <strong style="color: #b91c1c;">General Granule Loss</strong>
                  <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: #374151;">Even, widespread loss due to age - not concentrated like hail</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="pro-tip-box" style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 20px; margin-top: 24px; display: flex; align-items: flex-start; gap: 16px;">
          <span style="font-size: 2rem;">💡</span>
          <div>
            <strong style="color: #1d4ed8; font-size: 1.1rem;">Pro Tip: How to Tell the Difference</strong>
            <p style="margin: 8px 0 0 0; color: #1e40af;">Hail damage creates <em>random, circular patterns</em> across the roof. Age-related wear appears <em>uniformly</em> across all shingles. When in doubt, check for matching damage on metal components - insurance can't argue that gutters and vents aged the same day!</p>
          </div>
        </div>

        <!-- Interactive Matching Game - LAST before completion -->
        <h2>🎮 Damage Identification Challenge</h2>
        <p>Test your knowledge with these two interactive challenges!</p>

        <div id="damage-matching-game" style="background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); border-radius: 20px; padding: 24px; margin: 20px 0; border: 3px solid #a855f7;">

          <!-- Challenge 1: Match Damage Type -->
          <div id="match-damage-challenge" class="game-challenge">
            <h3 style="color: #7c3aed; margin: 0 0 16px 0;">🎯 Challenge 1: Match the Damage Type</h3>
            <p style="color: #6b7280; margin-bottom: 20px;">Click on a description, then click the matching damage type!</p>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
              <!-- Descriptions Column -->
              <div>
                <h4 style="color: #374151; margin-bottom: 12px;">Descriptions:</h4>
                <div id="damage-descriptions" style="display: flex; flex-direction: column; gap: 10px;">
                  <div class="match-item description" data-match="hail" onclick="selectMatchItem(this)" style="background: white; padding: 14px; border-radius: 10px; cursor: pointer; border: 2px solid #e5e7eb; transition: all 0.2s;">
                    🌨️ Circular "bruises" with concentrated granule loss, soft/spongy feel
                  </div>
                  <div class="match-item description" data-match="wind" onclick="selectMatchItem(this)" style="background: white; padding: 14px; border-radius: 10px; cursor: pointer; border: 2px solid #e5e7eb; transition: all 0.2s;">
                    💨 Lifted, creased, or completely missing shingles
                  </div>
                  <div class="match-item description" data-match="blistering" onclick="selectMatchItem(this)" style="background: white; padding: 14px; border-radius: 10px; cursor: pointer; border: 2px solid #e5e7eb; transition: all 0.2s;">
                    🫧 Bubbles on surface from manufacturing defect or trapped moisture
                  </div>
                  <div class="match-item description" data-match="cracking" onclick="selectMatchItem(this)" style="background: white; padding: 14px; border-radius: 10px; cursor: pointer; border: 2px solid #e5e7eb; transition: all 0.2s;">
                    💔 Straight-line splits from age, UV exposure, thermal cycling
                  </div>
                </div>
              </div>

              <!-- Damage Types Column -->
              <div>
                <h4 style="color: #374151; margin-bottom: 12px;">Damage Types:</h4>
                <div id="damage-types" style="display: flex; flex-direction: column; gap: 10px;">
                  <div class="match-item type" data-match="wind" onclick="matchDamageType(this)" style="background: #22c55e; color: white; padding: 14px; border-radius: 10px; cursor: pointer; font-weight: bold; text-align: center; transition: all 0.2s;">
                    ✅ WIND DAMAGE (Qualifying)
                  </div>
                  <div class="match-item type" data-match="cracking" onclick="matchDamageType(this)" style="background: #ef4444; color: white; padding: 14px; border-radius: 10px; cursor: pointer; font-weight: bold; text-align: center; transition: all 0.2s;">
                    ❌ CRACKING (Non-Qualifying)
                  </div>
                  <div class="match-item type" data-match="hail" onclick="matchDamageType(this)" style="background: #22c55e; color: white; padding: 14px; border-radius: 10px; cursor: pointer; font-weight: bold; text-align: center; transition: all 0.2s;">
                    ✅ HAIL DAMAGE (Qualifying)
                  </div>
                  <div class="match-item type" data-match="blistering" onclick="matchDamageType(this)" style="background: #ef4444; color: white; padding: 14px; border-radius: 10px; cursor: pointer; font-weight: bold; text-align: center; transition: all 0.2s;">
                    ❌ BLISTERING (Non-Qualifying)
                  </div>
                </div>
              </div>
            </div>

            <div id="match-progress" style="margin-top: 16px; text-align: center;">
              <p style="color: #7c3aed; font-weight: bold;">Matched: <span id="match-count">0</span> / 4</p>
            </div>
            <div id="match-feedback" style="display: none; margin-top: 12px; padding: 12px; border-radius: 8px; text-align: center;"></div>
          </div>

          <hr style="margin: 30px 0; border: none; border-top: 2px dashed #d8b4fe;">

          <!-- Challenge 2: Documentation Sequence -->
          <div id="doc-sequence-challenge" class="game-challenge">
            <h3 style="color: #7c3aed; margin: 0 0 16px 0;">📋 Challenge 2: Documentation Sequence</h3>
            <p style="color: #6b7280; margin-bottom: 12px;">Select the following in the proper order:</p>
            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px;">
              <p style="color: #92400e; margin: 0; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3rem;">👆</span>
                <span>HOW TO PLAY: Tap a step once to select it (it will glow purple). Then tap it again to assign the next number. Start with step #1!</span>
              </p>
            </div>

            <div id="doc-sequence-items" style="display: flex; flex-direction: column; gap: 8px;">
              <div class="seq-item" data-order="3" onclick="selectSeqItem(this)" style="background: white; padding: 14px 20px; border-radius: 10px; cursor: pointer; border: 2px solid #e5e7eb; display: flex; align-items: center; gap: 12px; transition: all 0.2s;">
                <span class="seq-number" style="background: #e5e7eb; color: #6b7280; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">?</span>
                <span>Up close hail damage photo</span>
              </div>
              <div class="seq-item" data-order="5" onclick="selectSeqItem(this)" style="background: white; padding: 14px 20px; border-radius: 10px; cursor: pointer; border: 2px solid #e5e7eb; display: flex; align-items: center; gap: 12px; transition: all 0.2s;">
                <span class="seq-number" style="background: #e5e7eb; color: #6b7280; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">?</span>
                <span>Granules in the gutters and downspouts</span>
              </div>
              <div class="seq-item" data-order="1" onclick="selectSeqItem(this)" style="background: white; padding: 14px 20px; border-radius: 10px; cursor: pointer; border: 2px solid #e5e7eb; display: flex; align-items: center; gap: 12px; transition: all 0.2s;">
                <span class="seq-number" style="background: #e5e7eb; color: #6b7280; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">?</span>
                <span>Photos of collateral damage to the elevations</span>
              </div>
              <div class="seq-item" data-order="4" onclick="selectSeqItem(this)" style="background: white; padding: 14px 20px; border-radius: 10px; cursor: pointer; border: 2px solid #e5e7eb; display: flex; align-items: center; gap: 12px; transition: all 0.2s;">
                <span class="seq-number" style="background: #e5e7eb; color: #6b7280; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">?</span>
                <span>Overview of damage markings on roof</span>
              </div>
              <div class="seq-item" data-order="2" onclick="selectSeqItem(this)" style="background: white; padding: 14px 20px; border-radius: 10px; cursor: pointer; border: 2px solid #e5e7eb; display: flex; align-items: center; gap: 12px; transition: all 0.2s;">
                <span class="seq-number" style="background: #e5e7eb; color: #6b7280; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">?</span>
                <span>Photos of collateral damage on the roof</span>
              </div>
            </div>

            <div style="margin-top: 16px; display: flex; gap: 12px; justify-content: center;">
              <button onclick="checkDocSequence()" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; border: none; padding: 12px 28px; border-radius: 25px; cursor: pointer; font-weight: bold; font-size: 1rem;">Check Order ✓</button>
              <button onclick="resetDocSequence()" style="background: #e5e7eb; color: #374151; border: none; padding: 12px 28px; border-radius: 25px; cursor: pointer; font-weight: bold;">Reset</button>
            </div>

            <div id="seq-feedback" style="display: none; margin-top: 16px; padding: 16px; border-radius: 12px; text-align: center;"></div>
          </div>

          <!-- Game Complete -->
          <div id="game-complete-section" style="display: none; text-align: center; padding: 30px; background: linear-gradient(135deg, #d1fae5, #a7f3d0); border-radius: 16px; margin-top: 20px;">
            <div style="font-size: 4rem;">🎉</div>
            <h3 style="color: #059669; margin: 10px 0;">Excellent Work!</h3>
            <p style="color: #047857;">You've mastered damage identification and documentation sequence!</p>
          </div>
        </div>

        <div class="module-completion-section" id="module-complete-section" style="display: none;">
          <button class="complete-module-btn" onclick="completeModule('damage-identification')">
            Complete Module & Continue
          </button>
        </div>
    </div>
  `,
  'sales-cycle': `
    <div class="content-card" style="background: linear-gradient(180deg, #fafafa 0%, #ffffff 100%); padding: 0; overflow: hidden;">
        <!-- Hero Header -->
        <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #c084fc 100%); padding: 40px 30px; text-align: center; color: white;">
          <div style="font-size: 48px; margin-bottom: 15px;">🔄</div>
          <h1 style="margin: 0 0 10px 0; font-size: 28px; font-weight: 700;">The Sales Cycle & Job Flow</h1>
          <p style="margin: 0; opacity: 0.9; font-size: 16px;">From first knock to final payment - master the complete process</p>
        </div>

        <div style="padding: 30px;">
          <!-- Quick Stats -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px;">
            <div style="background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%); padding: 20px; border-radius: 12px; text-align: center;">
              <div style="font-size: 28px; font-weight: 700; color: #7c3aed;">5</div>
              <div style="font-size: 13px; color: #6b21a8;">Key Phases</div>
            </div>
            <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 20px; border-radius: 12px; text-align: center;">
              <div style="font-size: 28px; font-weight: 700; color: #16a34a;">9-16</div>
              <div style="font-size: 13px; color: #166534;">Weeks Avg</div>
            </div>
            <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); padding: 20px; border-radius: 12px; text-align: center;">
              <div style="font-size: 28px; font-weight: 700; color: #2563eb;">12%+</div>
              <div style="font-size: 13px; color: #1e40af;">Top Commission</div>
            </div>
          </div>

          <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
            <span style="background: #f3e8ff; padding: 8px 12px; border-radius: 8px;">📋</span>
            The 5 Phases of the Sales Cycle
          </h2>

          <div style="display: grid; gap: 15px; margin-bottom: 35px;">
            <!-- Phase 1 -->
            <div style="background: white; border: 2px solid #e9d5ff; border-radius: 16px; padding: 20px; border-left: 4px solid #7c3aed;">
              <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700;">1</div>
                <div>
                  <h3 style="color: #7c3aed; font-size: 18px; margin: 0;">Generating New Business</h3>
                  <span style="color: #6b7280; font-size: 13px;">Days 1-3</span>
                </div>
              </div>
              <ul style="color: #374151; margin: 0; padding-left: 60px; font-size: 14px; line-height: 1.8;">
                <li>Knock 70+ doors minimum per day</li>
                <li>Pin houses & take quick notes</li>
                <li>Deliver initial pitch & get inspection permission</li>
                <li>Conduct thorough 15-20 minute inspection</li>
                <li>Document 20-40 photos of damage</li>
                <li>File insurance claim with homeowner</li>
                <li style="color: #16a34a; font-weight: 600;">Goal: Signed contract</li>
              </ul>
            </div>

            <!-- Divider: Your Responsibility -->
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; padding: 16px 20px; margin: 10px 0; text-align: center; border-left: 4px solid #f59e0b;">
              <p style="margin: 0; color: #92400e; font-size: 14px; font-weight: 600;">⬆️ Everything above is YOUR doing and control</p>
            </div>

            <!-- Phase 2 -->
            <div style="background: white; border: 2px solid #e9d5ff; border-radius: 16px; padding: 20px; border-left: 4px solid #7c3aed;">
              <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700;">2</div>
                <div>
                  <h3 style="color: #7c3aed; font-size: 18px; margin: 0;">Adjuster Meeting</h3>
                  <span style="color: #6b7280; font-size: 13px;">2-7 days after claim filed</span>
                </div>
              </div>
              <ul style="color: #374151; margin: 0; padding-left: 60px; font-size: 14px; line-height: 1.8;">
                <li>Insurance assigns adjuster (typically 2-7 days)</li>
                <li>Meet adjuster on site - <strong>CRITICAL: Be present!</strong></li>
                <li>Walk through all damage documented</li>
                <li>Create formal photo report</li>
                <li>Decision usually within 1-10 business days</li>
                <li style="color: #16a34a; font-weight: 600;">Goal: Full approval</li>
              </ul>
            </div>

            <!-- Divider: Team Handoff -->
            <div style="background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-radius: 12px; padding: 16px 20px; margin: 10px 0; text-align: center; border-left: 4px solid #3b82f6;">
              <p style="margin: 0; color: #1e40af; font-size: 14px; font-weight: 600;">⬇️ The office handles everything below</p>
              <p style="margin: 5px 0 0 0; color: #3b82f6; font-size: 13px;">We'll discuss this process more in depth later</p>
            </div>

            <!-- Phase 3 -->
            <div style="background: white; border: 2px solid #e9d5ff; border-radius: 16px; padding: 20px; border-left: 4px solid #7c3aed;">
              <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700;">3</div>
                <div>
                  <h3 style="color: #7c3aed; font-size: 18px; margin: 0;">Project Meeting</h3>
                  <span style="color: #6b7280; font-size: 13px;">Within 1 week of estimate</span>
                </div>
              </div>
              <ul style="color: #374151; margin: 0; padding-left: 60px; font-size: 14px; line-height: 1.8;">
                <li>Send estimate to office for Project Review</li>
                <li>Project Coordinator schedules meeting with homeowner</li>
                <li>Homeowner signs Project Documents</li>
                <li>Collect Downpayment (ACV payment from insurance)</li>
                <li style="color: #16a34a; font-weight: 600;">💰 You receive portion of your commission at Downpayment</li>
              </ul>
            </div>

            <!-- Phase 4 -->
            <div style="background: white; border: 2px solid #e9d5ff; border-radius: 16px; padding: 20px; border-left: 4px solid #7c3aed;">
              <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700;">4</div>
                <div>
                  <h3 style="color: #7c3aed; font-size: 18px; margin: 0;">Installation</h3>
                  <span style="color: #6b7280; font-size: 13px;">4-6 weeks from Downpayment</span>
                </div>
              </div>
              <ul style="color: #374151; margin: 0; padding-left: 60px; font-size: 14px; line-height: 1.8;">
                <li>Crew arrives 7-8am</li>
                <li>Full tear-off and installation (1-2 days)</li>
                <li>Quality Check and Wrap Up with homeowner</li>
                <li>Sign Certificate of Completion</li>
                <li style="color: #16a34a; font-weight: 600;">Goal: Happy customer & quality install</li>
              </ul>
            </div>

            <!-- Phase 5 -->
            <div style="background: white; border: 2px solid #e9d5ff; border-radius: 16px; padding: 20px; border-left: 4px solid #7c3aed;">
              <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700;">5</div>
                <div>
                  <h3 style="color: #7c3aed; font-size: 18px; margin: 0;">Final Payment</h3>
                  <span style="color: #6b7280; font-size: 13px;">After Certificate of Completion</span>
                </div>
              </div>
              <ul style="color: #374151; margin: 0; padding-left: 60px; font-size: 14px; line-height: 1.8;">
                <li>Submit Certificate of Completion to insurance</li>
                <li>Insurance releases Depreciation funds</li>
                <li>Homeowner pays Final Payment (Depreciation + Deductible)</li>
                <li>Request Google review & referrals</li>
                <li style="color: #16a34a; font-weight: 600;">💰 You receive remaining commission (12%+)</li>
              </ul>
            </div>
          </div>

          <!-- Timeline Summary -->
          <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 16px; padding: 25px; margin-bottom: 30px; text-align: center;">
            <h3 style="color: #1e40af; margin: 0 0 10px 0; font-size: 20px;">⏱️ Total Sales Cycle: 9-16 Weeks</h3>
            <p style="color: #3b82f6; margin: 0; font-size: 15px;">From initial knock to final payment - stay in regular contact throughout!</p>
          </div>

          <h2 style="color: #1f2937; font-size: 22px; margin: 35px 0 20px 0; display: flex; align-items: center; gap: 10px;">
            <span style="background: #f3e8ff; padding: 8px 12px; border-radius: 8px;">🎮</span>
            Sales Cycle Sorter Game
          </h2>

          <div style="background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%); border-radius: 16px; padding: 25px; margin-bottom: 30px;">
            <p style="color: #6b21a8; font-size: 15px; margin: 0 0 20px 0; text-align: center;">
              <strong>Test your knowledge!</strong> Drag and drop the 5 sales cycle phases into the correct order.
            </p>
            <div id="sales-cycle-game" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div style="background: white; border-radius: 12px; padding: 20px;">
                    <h4 style="color: #7c3aed; margin: 0 0 15px 0; font-size: 16px; text-align: center;">📦 Phases (Drag from here)</h4>
                    <div id="items-pool" style="min-height: 200px; background: #faf5ff; border-radius: 8px; padding: 10px; border: 2px dashed #c4b5fd;">
                        <div class="draggable-item" draggable="true" data-order="2" style="background: white; padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; cursor: grab; border: 2px solid #e9d5ff; font-size: 14px; font-weight: 500; color: #1f2937; transition: all 0.2s;">Adjuster Meeting</div>
                        <div class="draggable-item" draggable="true" data-order="1" style="background: white; padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; cursor: grab; border: 2px solid #e9d5ff; font-size: 14px; font-weight: 500; color: #1f2937; transition: all 0.2s;">Generating New Business</div>
                        <div class="draggable-item" draggable="true" data-order="5" style="background: white; padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; cursor: grab; border: 2px solid #e9d5ff; font-size: 14px; font-weight: 500; color: #1f2937; transition: all 0.2s;">Final Payment</div>
                        <div class="draggable-item" draggable="true" data-order="4" style="background: white; padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; cursor: grab; border: 2px solid #e9d5ff; font-size: 14px; font-weight: 500; color: #1f2937; transition: all 0.2s;">Installation</div>
                        <div class="draggable-item" draggable="true" data-order="3" style="background: white; padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; cursor: grab; border: 2px solid #e9d5ff; font-size: 14px; font-weight: 500; color: #1f2937; transition: all 0.2s;">Project Meeting</div>
                    </div>
                </div>
                <div style="background: white; border-radius: 12px; padding: 20px;">
                    <h4 style="color: #16a34a; margin: 0 0 15px 0; font-size: 16px; text-align: center;">✅ Correct Order (Drop here)</h4>
                    <div id="sorted-list" class="drop-zone-sort" style="min-height: 200px; background: #f0fdf4; border-radius: 8px; padding: 10px; border: 2px dashed #86efac;"></div>
                </div>
            </div>
            <div id="sales-cycle-feedback" class="feedback-message" style="display: none; margin-top: 15px; padding: 15px; border-radius: 10px; text-align: center; font-weight: 500;"></div>
          </div>

          <div class="module-completion-section" id="module-complete-section" style="display: none; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 30px; border-radius: 16px; text-align: center; margin-top: 30px;">
            <p style="color: #166534; font-size: 16px; margin: 0 0 20px 0; font-weight: 500;">🎉 Ready to continue?</p>
            <button class="complete-module-btn" onclick="completeModule('sales-cycle-job-flow')" style="padding: 16px 40px; font-size: 16px; font-weight: 600; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: white; border: none; border-radius: 12px; cursor: pointer; transition: all 0.3s;">
              Complete Module & Continue →
            </button>
          </div>
        </div>
    </div>
  `,
  'claim-closing': `
  <div class="content-card" style="background: linear-gradient(180deg, #fafafa 0%, #ffffff 100%); padding: 0; overflow: hidden;">
    <!-- Hero Header -->
    <div style="background: linear-gradient(135deg, #0891b2 0%, #06b6d4 50%, #22d3ee 100%); padding: 40px 30px; text-align: center; color: white;">
      <div style="font-size: 48px; margin-bottom: 15px;">📋</div>
      <h1 style="margin: 0 0 10px 0; font-size: 28px; font-weight: 700;">Filing the Claim & Contingency + Claim Authorization Script</h1>
      <p style="margin: 0; opacity: 0.9; font-size: 16px;">Digital-first claim filing, contingency, and claim authorization</p>
    </div>

    <div style="padding: 30px;">
      <!-- Lesson Plan: Filing the Claim (Digital First) -->
      <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px;">
        <span style="background: #ecfeff; padding: 8px 12px; border-radius: 8px;">🧭</span>
        Lesson Plan: Filing the Claim (Digital First)
      </h2>

      <div style="background: linear-gradient(135deg, #ecfeff 0%, #cffafe 100%); border-radius: 16px; padding: 18px; margin-bottom: 18px;">
        <strong style="color: #0f172a;">Priority:</strong>
        <span style="color: #0f172a;"> We want the homeowner to file the claim digitally (app or website). Phone calls are last resort only.</span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 22px;">
        <div style="background: white; border: 2px solid #e2e8f0; border-radius: 16px; padding: 18px;">
          <div style="font-size: 20px; font-weight: 700; color: #0e7490; margin-bottom: 6px;">1) Insurance App</div>
          <div style="color: #475569; font-size: 14px; line-height: 1.6;">Have the homeowner file through their insurance app on their phone. You guide the steps.</div>
        </div>
        <div style="background: white; border: 2px solid #e2e8f0; border-radius: 16px; padding: 18px;">
          <div style="font-size: 20px; font-weight: 700; color: #0e7490; margin-bottom: 6px;">2) Website Login</div>
          <div style="color: #475569; font-size: 14px; line-height: 1.6;">If no app, use the homeowner's website login on their computer to file online.</div>
        </div>
        <div style="background: white; border: 2px solid #e2e8f0; border-radius: 16px; padding: 18px;">
          <div style="font-size: 20px; font-weight: 700; color: #0e7490; margin-bottom: 6px;">3) Guest Claim</div>
          <div style="color: #475569; font-size: 14px; line-height: 1.6;">Check the website for a guest filing option. Use it if available.</div>
        </div>
      </div>

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 16px; padding: 16px; margin-bottom: 16px;">
        <strong style="color: #166534;">Once the claim is filed (any method):</strong>
        <ul style="color: #14532d; font-size: 14px; line-height: 1.7; margin: 8px 0 0 0; padding-left: 18px;">
          <li>Have them read the claim number out loud and write it down.</li>
          <li>Ask if an adjuster is assigned; get name, phone, and email (or when assignment will happen).</li>
        </ul>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; margin-bottom: 12px;">
        <strong style="color: #0f172a;">Next steps:</strong>
        <span style="color: #475569;"> Enter the claim details in the Sales App, move into the contingency + claim authorization agreements, and post in GroupMe when signed.</span>
      </div>

      <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 10px; padding: 12px 16px; margin-bottom: 18px;">
        <p style="color: #92400e; font-size: 13px; margin: 0; font-weight: 500;">⚠️ <strong>Note:</strong> If the above claim methods do not work/not available, then proceed to phone call.</p>
      </div>

      <details style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 14px; padding: 12px; margin-bottom: 14px;">
        <summary style="font-weight: 700; color: #9a3412; font-size: 13px; cursor: pointer;">Phone Call (Only if app/website/guest filing fails)</summary>
        <div style="margin-top: 10px;">
          <ul style="color: #7c2d12; font-size: 12.5px; line-height: 1.6; margin: 0; padding-left: 18px;">
            <li>Use the Claim Filing Information Sheet for answers.</li>
            <li>Before ending: claim number out loud + adjuster info.</li>
            <li>If scheduling now (Allstate), offer 3 time windows you can attend.</li>
          </ul>
        </div>
      </details>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 18px;">
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 12px;">
          <img src="/assets/training/module11/claim-filing-info-sheet.png" alt="Claim Filing Information Sheet slide" style="width: 100%; max-height: 180px; object-fit: contain; border-radius: 12px; display: block;">
          <div style="text-align: center; color: #6b7280; font-size: 12px; margin-top: 8px;">Claim Filing Information Sheet (phone call only)</div>
        </div>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 12px;">
          <img src="/assets/training/module11/example-customer-info-sheet.png" alt="Example customer info sheet slide" style="width: 100%; max-height: 180px; object-fit: contain; border-radius: 12px; display: block;">
          <div style="text-align: center; color: #6b7280; font-size: 12px; margin-top: 8px;">Example Customer Info Sheet</div>
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; margin-bottom: 20px;">
        <strong style="color: #0f172a;">Field Translator:</strong>
        <span style="color: #475569;"> Use it when language support is needed at the door.</span>
      </div>

      <!-- Sales App -->
      <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
        <span style="background: #e0f2fe; padding: 8px 12px; border-radius: 8px;">📱</span>
        Sales App (iPad Only)
      </h2>

      <div style="background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); border-radius: 16px; padding: 20px; margin-bottom: 15px;">
        <p style="color: #0f172a; font-size: 14px; margin: 0;">Use the Sales App on your iPad to capture claim details and submit forms.</p>
      </div>
      <div style="background: #dbeafe; border: 1px solid #93c5fd; border-radius: 10px; padding: 12px 16px; margin-bottom: 12px;">
        <p style="color: #1e40af; font-size: 13px; margin: 0; font-weight: 500;">📱 <strong>Note:</strong> You will be issued company iPads for field use.</p>
      </div>
      <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 10px; padding: 12px 16px; margin-bottom: 35px;">
        <p style="color: #92400e; font-size: 13px; margin: 0; font-weight: 500;">📝 <strong>Note:</strong> We will go over this in more detail in person.</p>
      </div>
      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 12px; margin-bottom: 35px;">
        <img src="/assets/training/module11/sales-app-ipad.png" alt="Sales App on iPad slide" style="width: 100%; border-radius: 12px; display: block;">
      </div>

      <!-- Contingency & Claim Authorization Script -->
      <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
        <span style="background: #f0fdf4; padding: 8px 12px; border-radius: 8px;">✅</span>
        Contingency + Claim Authorization Script
      </h2>

      <div style="display: grid; gap: 15px; margin-bottom: 35px;">
        <div style="background: white; border: 2px solid #dcfce7; border-radius: 16px; padding: 20px;">
          <h3 style="color: #166534; font-size: 16px; margin: 0 0 12px 0;">1) After filing the claim</h3>
          <p style="color: #374151; font-size: 14px; line-height: 1.7; margin: 0;">"Okay, perfect! Like they said, an adjuster will be reaching out to you in the next 24 to 48 hours to schedule the inspection. The absolute most important part of this process is that I am at this inspection. Insurance companies do not want to pay out. They are trying to mitigate their losses after storms. I am there as your representation to make sure you get a fair shake."</p>
          <p style="color: #166534; font-size: 13px; margin: 10px 0 0 0; font-style: italic;">Turn the iPad so you and the homeowner can see.</p>
        </div>

        <div style="background: white; border: 2px solid #dbeafe; border-radius: 16px; padding: 20px;">
          <h3 style="color: #1e40af; font-size: 16px; margin: 0 0 12px 0;">2) Contingency Agreement</h3>
          <p style="color: #374151; font-size: 14px; line-height: 1.7; margin: 0 0 10px 0;">"This basic agreement backs you as the homeowner by guaranteeing you that your only cost will be your deductible if we get you fully approved. If it is a partial approval or denial, first we will fight and jump through the necessary hoops to turn that into a full approval; but if we are not able to get you fully approved, this contract is null and void and you do not owe us a penny."</p>
          <p style="color: #374151; font-size: 14px; line-height: 1.7; margin: 0;">"What is in it for us is we just want to get to do the work. This agreement commits you to using us if we hold up our end of the bargain and achieve a full approval."</p>
          <div style="color: #1e40af; font-size: 13px; margin-top: 10px;">
            <strong>You sign</strong> • <strong>They sign</strong>
          </div>
        </div>

        <div style="background: white; border: 2px solid #e9d5ff; border-radius: 16px; padding: 20px;">
          <h3 style="color: #7c3aed; font-size: 16px; margin: 0 0 12px 0;">3) Claim Authorization Form</h3>
          <p style="color: #374151; font-size: 14px; line-height: 1.7; margin: 0 0 10px 0;">"This next form is our Claim Authorization form. Very simple, it allows us to communicate with your insurance company. I will be here for the inspection and we will also communicate with them through email and phone calls so you do not have to be a middle-man. Of course, I will always keep you looped in with our communication by CCing you in all emails and updating you on any conversations we have."</p>
          <div style="color: #7c3aed; font-size: 13px;">
            <strong>They sign</strong> • Press Submit, enter password "roofer" if it asks.
          </div>
        </div>

        <div style="background: white; border: 2px solid #fee2e2; border-radius: 16px; padding: 20px;">
          <h3 style="color: #b91c1c; font-size: 16px; margin: 0 0 12px 0;">4) Final handoff</h3>
          <p style="color: #374151; font-size: 14px; line-height: 1.7; margin: 0;">"Alright, we are all set! Again, the most important part of this process is that I am here when the insurance company comes out. Ideally you can have them call me to schedule that directly. If they call me, great! But, regardless, please get the adjuster information (name, email, phone number) and send that over to me so that I can communicate with them before the inspection. If they insist on scheduling with you, go ahead and pencil in a time and avoid these times and days [provide your schedule]."</p>
          <p style="color: #b91c1c; font-size: 13px; margin: 10px 0 0 0;">Answer any questions the homeowner may have.</p>
          <p style="color: #374151; font-size: 14px; margin: 8px 0 0 0;">"Thank you, sir/ma'am. Looking forward to seeing you on the day of inspection. You have my contact information on my card if you need anything else."</p>
        </div>
      </div>

      <!-- Closing Script Video -->
      <div style="margin: 30px 0;">
        <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
          <span style="background: #f3e8ff; padding: 8px 12px; border-radius: 8px;">🎬</span>
          Closing Script Training
        </h2>
        ${renderVideoPlayer('https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/closing-script.mp4', 'closing-script-video', '📹 New Hire Training: Closing Script')}
      </div>

      <!-- Key Documents Section -->
      <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
        <span style="background: #f3e8ff; padding: 8px 12px; border-radius: 8px;">📎</span>
        View Key Documents
      </h2>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 35px;">
        <!-- Insurance Claim Agreement (Contingency) PDF - NOW FIRST -->
        <div style="background: white; border: 2px solid #e9d5ff; border-radius: 16px; padding: 25px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 15px;">📋</div>
          <h3 style="color: #7c3aed; font-size: 18px; margin: 0 0 10px 0;">Insurance Claim Agreement</h3>
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 15px 0; line-height: 1.5;">The contingency agreement - only cost to homeowner is their deductible if fully approved.</p>
          <div style="background: #f3e8ff; padding: 12px; border-radius: 8px; margin-bottom: 15px;">
            <p style="color: #6b21a8; font-size: 13px; margin: 0;"><strong>Key term:</strong> Null and void if not fully approved</p>
          </div>
          <a href="/resources/DMV Blank Contingency.pdf" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; padding: 12px 24px; border-radius: 25px; text-decoration: none; font-weight: 600; transition: all 0.3s;">
            📥 View PDF
          </a>
        </div>

        <!-- Claim Authorization PDF - NOW SECOND -->
        <div style="background: white; border: 2px solid #e9d5ff; border-radius: 16px; padding: 25px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 15px;">📄</div>
          <h3 style="color: #7c3aed; font-size: 18px; margin: 0 0 10px 0;">Claim Authorization Form</h3>
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 15px 0; line-height: 1.5;">Authorizes ROOF-ER to communicate with the homeowner's insurance company on their behalf.</p>
          <div style="background: #f3e8ff; padding: 12px; border-radius: 8px; margin-bottom: 15px;">
            <p style="color: #6b21a8; font-size: 13px; margin: 0;"><strong>When to use:</strong> After filing the claim</p>
          </div>
          <a href="/resources/Claim Authorization Form.pdf" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; padding: 12px 24px; border-radius: 25px; text-decoration: none; font-weight: 600; transition: all 0.3s;">
            📥 View PDF
          </a>
        </div>
      </div>

      <!-- End Activity -->
      <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
        <span style="background: #f0fdf4; padding: 8px 12px; border-radius: 8px;">🎯</span>
        End Activity: Contingency + Claim Authorization Script Quiz
      </h2>

      <div id="filing-claim-quiz" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; padding: 25px; margin-bottom: 30px;">
        <p style="color: #166534; font-size: 14px; margin: 0 0 16px 0; font-weight: 500;">Test your knowledge of the Contingency + Claim Authorization Script. Check each item you can confidently explain to a homeowner:</p>
        <div style="display: grid; gap: 12px; color: #15803d; font-size: 14px;">
          <label style="display: flex; align-items: flex-start; gap: 10px;"><input type="checkbox" class="filing-quiz-checkbox" style="margin-top: 3px;"> <span>I can explain what a contingency agreement is and why it protects the homeowner</span></label>
          <label style="display: flex; align-items: flex-start; gap: 10px;"><input type="checkbox" class="filing-quiz-checkbox" style="margin-top: 3px;"> <span>I understand "null and void if not fully approved" and can communicate this clearly</span></label>
          <label style="display: flex; align-items: flex-start; gap: 10px;"><input type="checkbox" class="filing-quiz-checkbox" style="margin-top: 3px;"> <span>I can explain what the Claim Authorization form allows ROOF-ER to do</span></label>
          <label style="display: flex; align-items: flex-start; gap: 10px;"><input type="checkbox" class="filing-quiz-checkbox" style="margin-top: 3px;"> <span>I know the correct order: file claim first, then contingency, then authorization</span></label>
          <label style="display: flex; align-items: flex-start; gap: 10px;"><input type="checkbox" class="filing-quiz-checkbox" style="margin-top: 3px;"> <span>I can recite key parts of the script from memory</span></label>
          <label style="display: flex; align-items: flex-start; gap: 10px;"><input type="checkbox" class="filing-quiz-checkbox" style="margin-top: 3px;"> <span>I understand the homeowner's only cost is their deductible if fully approved</span></label>
        </div>
        <div id="filing-quiz-feedback" style="display: none; margin-top: 15px; padding: 12px; background: #22c55e; color: white; border-radius: 8px; text-align: center; font-weight: 600;">All items confirmed! You're ready to proceed.</div>
      </div>

      <div class="module-completion-section" id="module-complete-section" style="display: none; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 30px; border-radius: 16px; text-align: center; margin-top: 30px;">
        <p style="color: #166534; font-size: 16px; margin: 0 0 20px 0; font-weight: 500;">🎉 Ready to continue?</p>
        <button class="complete-module-btn" onclick="completeModule('filing-claim-closing')" style="padding: 16px 40px; font-size: 16px; font-weight: 600; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: white; border: none; border-radius: 12px; cursor: pointer; transition: all 0.3s;">
          Complete Module & Continue →
        </button>
      </div>
    </div>
  </div>
  `,
  'role-play': `
    <div class="content-card agnes-roleplay-container" style="background: linear-gradient(180deg, #fafafa 0%, #ffffff 100%); padding: 0; overflow: hidden;">
        <!-- Hero Header -->
        <div style="background: radial-gradient(circle at top left, #0ea5e9 0%, #1e3a8a 45%, #0f172a 100%); padding: 42px 30px; text-align: center; color: white;">
            <div style="font-size: 48px; margin-bottom: 15px;">🔍</div>
            <h1 style="margin: 0 0 10px 0; font-size: 28px; font-weight: 700;">Live Role-Play: Inspection Process</h1>
            <p style="margin: 0; opacity: 0.9; font-size: 16px;">Voice-only training with live feedback (Module 8)</p>
        </div>

        <div style="padding: 30px;">
            <!-- Error Display -->
            <div id="agnes-error" class="agnes-error" style="display: none;"></div>

            <!-- XP Progress Bar -->
            <div id="agnes-xp-bar" class="agnes-xp-bar" style="margin-bottom: 30px;"></div>

            <!-- Live Role-Play (Module 8 only) -->
            <div id="agnes-mode-selector" style="display: block;">
                <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 55%, #0284c7 100%); border-radius: 24px; padding: 28px; color: white; margin-bottom: 24px;">
                    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 18px; flex-wrap: wrap;">
                        <div style="font-size: 44px;">🔍</div>
                        <div>
                            <div style="font-size: 20px; font-weight: 700;">Live Role-Play: Inspection Process</div>
                            <div style="font-size: 14px; opacity: 0.9;">Module 8 only • Voice role-play with live feedback</div>
                        </div>
                        <div style="margin-left: auto; background: rgba(255,255,255,0.18); padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;">LIVE</div>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px;">
                        <div style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); border-radius: 14px; padding: 14px;">
                            <div style="font-weight: 700; margin-bottom: 6px;">You'll practice</div>
                            <ul style="margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6;">
                                <li>Explain the inspection flow</li>
                                <li>Ask permission to use the ladder</li>
                                <li>Handle hesitation</li>
                                <li>Clean post‑inspection handoff</li>
                            </ul>
                        </div>
                        <div style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); border-radius: 14px; padding: 14px;">
                            <div style="font-weight: 700; margin-bottom: 6px;">How it works</div>
                            <ol style="margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6;">
                                <li>Start live role‑play</li>
                                <li>Talk it through with Agnes</li>
                                <li>End & score your session</li>
                            </ol>
                        </div>
                    </div>

                    <div style="margin-top: 18px; text-align: center;">
                        <button id="agnes-roleplay-btn" style="padding: 16px 42px; font-size: 16px; font-weight: 700; background: #22c55e; color: #0f172a; border: none; border-radius: 999px; cursor: pointer; transition: all 0.2s;">Start Live Role-Play</button>
                    </div>
                </div>
            </div>

        <!-- Voice UI Screen -->
        <div id="agnes-voice-ui" style="display: none;">
            <div class="agnes-voice-header">
                <div class="agnes-status-bar">
                    <div class="connection-status">
                        <span id="agnes-connection-dot" class="connection-dot"></span>
                        <span id="agnes-status-text" class="agnes-status connecting">Connecting...</span>
                    </div>
                    <div id="agnes-recording-indicator" class="recording-indicator" style="display: none;">
                        <span class="rec-dot"></span> REC
                    </div>
                </div>

                <!-- In-Session Difficulty Selector -->
                <div id="agnes-difficulty-buttons" style="display: flex; gap: 8px; justify-content: center; padding: 12px 0; background: #f8fafc; border-radius: 10px; margin: 10px 0;">
                    <span style="font-size: 13px; color: #64748b; align-self: center; margin-right: 8px;">Difficulty:</span>
                    <button class="difficulty-btn active" data-difficulty="easy" style="padding: 8px 20px; border: 2px solid #10b981; background: #10b981; color: white; border-radius: 20px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;">
                        😊 Easy
                    </button>
                    <button class="difficulty-btn" data-difficulty="medium" style="padding: 8px 20px; border: 2px solid #f59e0b; background: white; color: #f59e0b; border-radius: 20px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;">
                        🤔 Medium
                    </button>
                    <button class="difficulty-btn" data-difficulty="hard" style="padding: 8px 20px; border: 2px solid #ef4444; background: white; color: #ef4444; border-radius: 20px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;">
                        😤 Hard
                    </button>
                </div>

                <div class="agnes-controls">
                    <button id="agnes-mute-btn" class="control-btn">🎤 Mute</button>
                    <button id="agnes-video-btn" class="control-btn">📹 Hide Video</button>
                    <button id="agnes-end-session-btn" class="control-btn end-btn">🛑 End & Score</button>
                </div>
            </div>

            <div class="agnes-voice-main">
                <div class="agnes-video-section">
                    <video id="agnes-video-preview" autoplay muted playsinline class="video-preview"></video>
                    <div class="agnes-avatar-container">
                        <div class="agnes-avatar">👩‍💼</div>
                        <div class="agnes-name">Agnes</div>
                        <div id="agnes-speaking-indicator" class="speaking-indicator">Speaking...</div>
                    </div>
                </div>

                <div class="agnes-transcript-section">
                    <h3>Conversation Transcript</h3>
                    <div id="agnes-transcript" class="agnes-transcript">
                        <div class="transcript-placeholder">
                            <p>🎤 Start speaking to begin the roleplay...</p>
                            <p class="hint">Try: "Here’s how the inspection works..."</p>
                        </div>
                    </div>
                    <div id="agnes-score-display" class="agnes-score-display" style="display: none;"></div>
                </div>

                <!-- Voice Mode Live Feedback Panel -->
                <div id="voice-live-feedback" class="voice-live-feedback" style="display: none;">
                    <div class="voice-feedback-header">
                        <span class="feedback-icon">📊</span>
                        <span>Live Performance</span>
                        <div id="voice-live-score" class="voice-live-score">--</div>
                    </div>
                    <div class="voice-feedback-body">
                        <div class="feedback-section">
                            <div class="feedback-label">Key Points Covered:</div>
                            <div id="voice-key-points" class="key-points-checklist">
                                <div class="kp-item pending"><span class="kp-check">○</span> Introduction</div>
                                <div class="kp-item pending"><span class="kp-check">○</span> Urgency</div>
                                <div class="kp-item pending"><span class="kp-check">○</span> Evidence</div>
                                <div class="kp-item pending"><span class="kp-check">○</span> Insurance benefits</div>
                                <div class="kp-item pending"><span class="kp-check">○</span> Next steps</div>
                            </div>
                        </div>
                        <div class="feedback-section">
                            <div class="feedback-label">Tone Analysis:</div>
                            <div id="voice-tone-feedback" class="tone-feedback">Start speaking to see tone feedback...</div>
                        </div>
                        <div id="voice-live-tip" class="voice-live-tip" style="display: none;">
                            <span class="tip-icon">💡</span>
                            <span class="tip-text"></span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="agnes-tips">
                <h4>💡 Tips:</h4>
                <ul>
                    <li>Explain the inspection process in simple steps</li>
                    <li>Ask permission before using the ladder or taking photos</li>
                    <li>Set a clear next step before ending the session</li>
                </ul>
            </div>
        </div>

        <!-- Door Slam Modal -->
        <div id="agnes-door-slam-modal" class="agnes-modal" style="display: none;">
            <div class="modal-content door-slam">
                <div class="modal-icon">🚪💥</div>
                <h2>Door Slammed!</h2>
                <p>The homeowner shut the door in your face. Session ended with a FAIL.</p>
                <p class="modal-tip">Tip: Be less pushy, listen to concerns, and don't lie!</p>
                <button id="agnes-door-slam-close" class="btn-primary">Try Again</button>
            </div>
        </div>

        <!-- Success Modal -->
        <div id="agnes-success-modal" class="agnes-modal" style="display: none;">
            <div class="modal-content success">
                <!-- Dynamically populated -->
            </div>
        </div>
    </div>
  
  `,
  quiz: `
    <div class="content-card" id="quiz-container">
      <h1>Final Quiz</h1>
      <p>Test your knowledge of the Roof-ER sales process. A new quiz will be generated each time you visit this section.</p>
      <button id="generateQuizButton">Start Quiz</button>
      <div id="quiz-area"></div>
    </div>
  `,
};

// Extend content with new tabs and remaps
// 3. General Roofing Knowledge & Terminology (REDESIGNED with interactive elements)
trainingContent['general-knowledge'] = `
  <div class="content-card module-3-redesign">
    <h1>General Roofing Knowledge & Terminology</h1>
    ${renderVideoPlayer('https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/module3-roofing101.mp4', 'roofing101-video', '📹 Roofing 101: Essential Knowledge')}

    <h2>Essential Roofing Terminology</h2>
    <p class="section-intro">Click on any card to flip and learn the definition!</p>

    <div class="terminology-flip-grid">
      <div class="flip-card" onclick="this.classList.toggle('flipped')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="flip-icon">🏔️</div>
            <h3>Ridge</h3>
            <span class="flip-hint">Click to learn more</span>
          </div>
          <div class="flip-card-back">
            <h4>Ridge</h4>
            <p>The horizontal line at the peak where two roof planes meet. Critical for ventilation and caps. The ridge is the highest point on the roof.</p>
          </div>
        </div>
      </div>

      <div class="flip-card" onclick="this.classList.toggle('flipped')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="flip-icon">🛡️</div>
            <h3>Underlayment</h3>
            <span class="flip-hint">Click to learn more</span>
          </div>
          <div class="flip-card-back">
            <h4>Underlayment</h4>
            <p>Water-resistant barrier beneath shingles. Protects against ice dams and leaks. Typically felt paper or synthetic material.</p>
          </div>
        </div>
      </div>

      <div class="flip-card" onclick="this.classList.toggle('flipped')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="flip-icon">⚡</div>
            <h3>Flashing</h3>
            <span class="flip-hint">Click to learn more</span>
          </div>
          <div class="flip-card-back">
            <h4>Flashing</h4>
            <p>Metal strips around chimneys, vents, valleys to prevent water intrusion. Common damage point - directs water away from vulnerable areas.</p>
          </div>
        </div>
      </div>

      <div class="flip-card" onclick="this.classList.toggle('flipped')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="flip-icon">💨</div>
            <h3>Vents</h3>
            <span class="flip-hint">Click to learn more</span>
          </div>
          <div class="flip-card-back">
            <h4>Vents</h4>
            <p>Roof penetrations for exhaust and intake/exhaust ventilation. Proper ventilation extends roof life and prevents moisture buildup.</p>
          </div>
        </div>
      </div>

      <div class="flip-card" onclick="this.classList.toggle('flipped')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="flip-icon">🌊</div>
            <h3>Valley</h3>
            <span class="flip-hint">Click to learn more</span>
          </div>
          <div class="flip-card-back">
            <h4>Valley</h4>
            <p>Where two roof planes meet at an angle. High water flow area - check for debris and damage. Susceptible to leaks.</p>
          </div>
        </div>
      </div>

      <div class="flip-card" onclick="this.classList.toggle('flipped')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="flip-icon">💧</div>
            <h3>Drip Edge</h3>
            <span class="flip-hint">Click to learn more</span>
          </div>
          <div class="flip-card-back">
            <h4>Drip Edge</h4>
            <p>Metal edge along eaves and rakes. Directs water away from fascia and protects underlayment. Code-required in most areas.</p>
          </div>
        </div>
      </div>

      <div class="flip-card" onclick="this.classList.toggle('flipped')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="flip-icon">❄️</div>
            <h3>Ice & Water Shield</h3>
            <span class="flip-hint">Click to learn more</span>
          </div>
          <div class="flip-card-back">
            <h4>Ice & Water Shield</h4>
            <p>Self-adhering waterproof membrane in vulnerable areas like eaves and valleys. Superior protection against ice dams and wind-driven rain.</p>
          </div>
        </div>
      </div>

      <div class="flip-card" onclick="this.classList.toggle('flipped')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="flip-icon">📐</div>
            <h3>Fascia</h3>
            <span class="flip-hint">Click to learn more</span>
          </div>
          <div class="flip-card-back">
            <h4>Fascia</h4>
            <p>Vertical board running along the roof edge. Provides mounting surface for gutters and protects roof deck from weather.</p>
          </div>
        </div>
      </div>
    </div>

    <h2>Parts of a Roof</h2>
    <p class="section-intro">Study these labeled diagrams to learn the key parts of a roof.</p>

    <div class="roof-diagram-interactive">
      <div class="diagram-container roof-diagram-grid">
        <img src="/assets/training/hip-roof.png" alt="Hip Roof Diagram" class="roof-diagram-img">
        <img src="/assets/training/gable-roof.png" alt="Gable Roof Diagram" class="roof-diagram-img">
      </div>

      <div class="roof-parts-legend">
        <h4>Key Components to Know:</h4>
        <p style="color: #6b7280; font-size: 0.9rem; margin-bottom: 16px;">Click on any component to see a photo example</p>
        <div class="legend-grid">
          <div class="legend-item clickable-component" onclick="toggleComponentImage(this, 'ridge')">
            <span class="legend-marker">1</span>
            <div>
              <strong>Ridge/Peak</strong>
              <p>Highest point where slopes meet</p>
            </div>
            <span class="expand-icon">+</span>
          </div>
          <div class="component-image-container" id="ridge-image" style="display: none;">
            <img src="/assets/roof-components/ridge.jpg?v=20260121" alt="Ridge/Peak of a roof" style="width: 100%; border-radius: 8px;">
            <p class="image-caption">The ridge is the horizontal line at the top where two roof slopes meet</p>
          </div>

          <div class="legend-item clickable-component" onclick="toggleComponentImage(this, 'valley')">
            <span class="legend-marker">2</span>
            <div>
              <strong>Valley</strong>
              <p>Where two slopes meet forming a channel</p>
            </div>
            <span class="expand-icon">+</span>
          </div>
          <div class="component-image-container" id="valley-image" style="display: none;">
            <img src="/assets/roof-components/valley.jpg?v=20260121" alt="Roof valley" style="width: 100%; border-radius: 8px;">
            <p class="image-caption">Valleys channel water where two roof planes meet - critical area for leaks</p>
          </div>

          <div class="legend-item clickable-component" onclick="toggleComponentImage(this, 'fascia')">
            <span class="legend-marker">3</span>
            <div>
              <strong>Fascia</strong>
              <p>Board at roof edge, holds gutters</p>
            </div>
            <span class="expand-icon">+</span>
          </div>
          <div class="component-image-container" id="fascia-image" style="display: none;">
            <img src="/assets/roof-components/fascia.jpg?v=20260121" alt="Fascia board" style="width: 100%; border-radius: 8px;">
            <p class="image-caption">The fascia is the vertical board running along the roof edge - gutters attach here</p>
          </div>

          <div class="legend-item clickable-component" onclick="toggleComponentImage(this, 'dripedge')">
            <span class="legend-marker">4</span>
            <div>
              <strong>Drip Edge</strong>
              <p>Metal strip directing water away</p>
            </div>
            <span class="expand-icon">+</span>
          </div>
          <div class="component-image-container" id="dripedge-image" style="display: none;">
            <img src="/assets/roof-components/dripedge.jpg?v=20260121" alt="Drip edge" style="width: 100%; border-radius: 8px;">
            <p class="image-caption">Metal flashing installed at roof edges to direct water into gutters</p>
          </div>

          <div class="legend-item clickable-component" onclick="toggleComponentImage(this, 'gutter')">
            <span class="legend-marker">5</span>
            <div>
              <strong>Gutter</strong>
              <p>Channels water off the roof</p>
            </div>
            <span class="expand-icon">+</span>
          </div>
          <div class="component-image-container" id="gutter-image" style="display: none;">
            <img src="/assets/roof-components/gutter.jpg?v=20260121" alt="Gutter system" style="width: 100%; border-radius: 8px;">
            <p class="image-caption">Gutters collect and channel rainwater away from the foundation</p>
          </div>

          <div class="legend-item clickable-component" onclick="toggleComponentImage(this, 'flashing')">
            <span class="legend-marker">6</span>
            <div>
              <strong>Flashing</strong>
              <p>Waterproofs joints and edges</p>
            </div>
            <span class="expand-icon">+</span>
          </div>
          <div class="component-image-container" id="flashing-image" style="display: none;">
            <img src="/assets/roof-components/flashing.jpg?v=20260121" alt="Roof flashing" style="width: 100%; border-radius: 8px;">
            <p class="image-caption">Metal pieces that seal joints around chimneys, vents, and roof transitions</p>
          </div>

          <div class="legend-item clickable-component" onclick="toggleComponentImage(this, 'soffit')">
            <span class="legend-marker">7</span>
            <div>
              <strong>Soffit</strong>
              <p>Underside of roof overhang</p>
            </div>
            <span class="expand-icon">+</span>
          </div>
          <div class="component-image-container" id="soffit-image" style="display: none;">
            <img src="/assets/roof-components/soffit.jpg?v=20260121" alt="Soffit" style="width: 100%; border-radius: 8px;">
            <p class="image-caption">The soffit covers the underside of roof overhangs and provides ventilation</p>
          </div>

          <div class="legend-item clickable-component" onclick="toggleComponentImage(this, 'eave')">
            <span class="legend-marker">8</span>
            <div>
              <strong>Eave</strong>
              <p>Lower edge of the roof</p>
            </div>
            <span class="expand-icon">+</span>
          </div>
          <div class="component-image-container" id="eave-image" style="display: none;">
            <img src="/assets/roof-components/eave.jpg?v=20260121" alt="Roof eave" style="width: 100%; border-radius: 8px;">
            <p class="image-caption">The eave is the lower edge of the roof that overhangs the wall</p>
          </div>
        </div>
      </div>
    </div>

    <hr>

    <div id="quiz2" class="quiz-section">
      <h3>Knowledge Check: Roofing Terminology</h3>
      <p>Test your understanding of roof components and terminology.</p>
      <button id="startQuickQuiz2" class="quiz-start-btn">Start Quiz</button>
      <div id="quiz2-area"></div>
    </div>

    <div class="module-completion-section" id="module-complete-section" style="display: none;">
      <button class="complete-module-btn" onclick="completeModule('general-knowledge')">
        Complete Module & Continue
      </button>
    </div>
  </div>
`;

// 4. Shingle Types & Materials (remap existing)
trainingContent['shingle-types-materials'] = trainingContent['shingle-types'] || `
  <div class="content-card"><h1>Shingle Types & Materials</h1><p>Content coming soon.</p></div>
`;

// 6. Handling Initial Pitch Objections (remap existing objection-handling)
trainingContent['handling-initial-pitch-objections'] = trainingContent['objection-handling'] || `
  <div class="content-card"><h1>Handling Initial Pitch Objections</h1><p>Content coming soon.</p></div>
`;

// 10. Post-Inspection Objections (new)
trainingContent['post-inspection-objections'] = `
  <div class="content-card">
    <h1>Post‑Inspection Objections</h1>

    <h2>7 Common Post-Inspection Objections</h2>
    <div class="objections-grid">
      <div class="objection-card">
        <h3>1. "I don't want to file a claim"</h3>
        <p><strong>Response:</strong> "I understand the concern about rates. But here's the reality: 1) This is what you pay insurance FOR. 2) Rates go up regardless - inflation, area risk. 3) Not filing means $20k out-of-pocket in 2 years when it leaks. Which would you rather pay?"</p>
        <p><strong>Why it works:</strong> Addresses fear directly with facts and reframes the alternative.</p>
        <button class="practice-agnes-btn" data-scenario="m9-claim-fear">🎭 Practice with Agnes</button>

        <!-- Inline Practice Container -->
        <div class="inline-practice-container" style="display: none;" data-scenario="m9-claim-fear">
          <div class="mini-conversation-thread"></div>
          <div class="mini-input-area">
            <textarea class="mini-response-input" rows="3" placeholder="Type your response here..."></textarea>
            <div class="mini-actions">
              <button class="submit-mini-response">Submit Response</button>
              <button class="close-practice">Close Practice</button>
            </div>
          </div>
          <div class="mini-feedback" style="display: none;">
            <h4>📊 Key Points Checklist:</h4>
            <ul class="key-points-checklist"></ul>
            <div class="mini-actions">
              <button class="try-again-btn">Try Again</button>
              <button class="close-practice">Close</button>
            </div>
          </div>
        </div>
      </div>

      <div class="objection-card">
        <h3>2. "My roof is fine"</h3>
        <p><strong>Response:</strong> "It looks fine from the ground! That's what I thought too. But look at these photos - [show granule loss, exposed mat, bruising]. This is like a cavity in a tooth - small now, major problem soon. We fix it now while insurance pays."</p>
        <p><strong>Why it works:</strong> Visual evidence + medical analogy makes it tangible.</p>
        <button class="practice-agnes-btn" data-scenario="m9-adjuster-pushback">🎭 Practice with Agnes</button>

        <!-- Inline Practice Container -->
        <div class="inline-practice-container" style="display: none;" data-scenario="m9-adjuster-pushback">
          <div class="mini-conversation-thread"></div>
          <div class="mini-input-area">
            <textarea class="mini-response-input" rows="3" placeholder="Type your response here..."></textarea>
            <div class="mini-actions">
              <button class="submit-mini-response">Submit Response</button>
              <button class="close-practice">Close Practice</button>
            </div>
          </div>
          <div class="mini-feedback" style="display: none;">
            <h4>📊 Key Points Checklist:</h4>
            <ul class="key-points-checklist"></ul>
            <div class="mini-actions">
              <button class="try-again-btn">Try Again</button>
              <button class="close-practice">Close</button>
            </div>
          </div>
        </div>
      </div>

      <div class="objection-card">
        <h3>3. "I need to talk to my spouse"</h3>
        <p><strong>Response:</strong> "Absolutely! When can you both be available? I'm happy to come back tonight at 7pm to walk through the photos together. Or we can do a 3-way call right now - takes 5 minutes."</p>
        <p><strong>Why it works:</strong> Removes the delay while respecting the need for joint decision.</p>
        <button class="practice-agnes-btn" data-scenario="m9-spouse-decision">🎭 Practice with Agnes</button>

        <!-- Inline Practice Container -->
        <div class="inline-practice-container" style="display: none;" data-scenario="m9-spouse-decision">
          <div class="mini-conversation-thread"></div>
          <div class="mini-input-area">
            <textarea class="mini-response-input" rows="3" placeholder="Type your response here..."></textarea>
            <div class="mini-actions">
              <button class="submit-mini-response">Submit Response</button>
              <button class="close-practice">Close Practice</button>
            </div>
          </div>
          <div class="mini-feedback" style="display: none;">
            <h4>📊 Key Points Checklist:</h4>
            <ul class="key-points-checklist"></ul>
            <div class="mini-actions">
              <button class="try-again-btn">Try Again</button>
              <button class="close-practice">Close</button>
            </div>
          </div>
        </div>
      </div>

      <div class="objection-card">
        <h3>4. "I'll just handle this myself"</h3>
        <p><strong>Response:</strong> "You absolutely can! But here's what most homeowners don't know: Insurance companies hire adjusters whose job is to minimize payouts. We're your advocate - we know what to look for, what codes require, and how to negotiate. Most DIY claims get 30-40% less coverage."</p>
        <p><strong>Why it works:</strong> Educates on the hidden challenge and value of professional representation.</p>
        <button class="practice-agnes-btn" data-scenario="m9-scope-walkthrough">🎭 Practice with Agnes</button>

        <!-- Inline Practice Container -->
        <div class="inline-practice-container" style="display: none;" data-scenario="m9-scope-walkthrough">
          <div class="mini-conversation-thread"></div>
          <div class="mini-input-area">
            <textarea class="mini-response-input" rows="3" placeholder="Type your response here..."></textarea>
            <div class="mini-actions">
              <button class="submit-mini-response">Submit Response</button>
              <button class="close-practice">Close Practice</button>
            </div>
          </div>
          <div class="mini-feedback" style="display: none;">
            <h4>📊 Key Points Checklist:</h4>
            <ul class="key-points-checklist"></ul>
            <div class="mini-actions">
              <button class="try-again-btn">Try Again</button>
              <button class="close-practice">Close</button>
            </div>
          </div>
        </div>
      </div>

      <div class="objection-card">
        <h3>5. "I've never filed a claim before"</h3>
        <p><strong>Response:</strong> "Perfect - I'll walk you through every step. It's actually very simple: 1) We call together (3 minutes), 2) Adjuster comes out (I'll be here), 3) Approved, 4) We schedule install. I've done this 500+ times - you're in good hands."</p>
        <p><strong>Why it works:</strong> Simplifies the unknown and builds confidence.</p>
        <button class="practice-agnes-btn" data-scenario="m9-first-time-claim">🎭 Practice with Agnes</button>

        <!-- Inline Practice Container -->
        <div class="inline-practice-container" style="display: none;" data-scenario="m9-first-time-claim">
          <div class="mini-conversation-thread"></div>
          <div class="mini-input-area">
            <textarea class="mini-response-input" rows="3" placeholder="Type your response here..."></textarea>
            <div class="mini-actions">
              <button class="submit-mini-response">Submit Response</button>
              <button class="close-practice">Close Practice</button>
            </div>
          </div>
          <div class="mini-feedback" style="display: none;">
            <h4>📊 Key Points Checklist:</h4>
            <ul class="key-points-checklist"></ul>
            <div class="mini-actions">
              <button class="try-again-btn">Try Again</button>
              <button class="close-practice">Close</button>
            </div>
          </div>
        </div>
      </div>

      <div class="objection-card">
        <h3>6. "What if my claim gets denied?"</h3>
        <p><strong>Response:</strong> "Great question. That's why we have a contingency agreement - if we don't get you fully approved, you owe us NOTHING. The contract is null and void. Zero risk to you."</p>
        <p><strong>Why it works:</strong> Removes financial risk completely.</p>
        <button class="practice-agnes-btn" data-scenario="m9-denial-fear">🎭 Practice with Agnes</button>

        <!-- Inline Practice Container -->
        <div class="inline-practice-container" style="display: none;" data-scenario="m9-denial-fear">
          <div class="mini-conversation-thread"></div>
          <div class="mini-input-area">
            <textarea class="mini-response-input" rows="3" placeholder="Type your response here..."></textarea>
            <div class="mini-actions">
              <button class="submit-mini-response">Submit Response</button>
              <button class="close-practice">Close Practice</button>
            </div>
          </div>
          <div class="mini-feedback" style="display: none;">
            <h4>📊 Key Points Checklist:</h4>
            <ul class="key-points-checklist"></ul>
            <div class="mini-actions">
              <button class="try-again-btn">Try Again</button>
              <button class="close-practice">Close</button>
            </div>
          </div>
        </div>
      </div>

      <div class="objection-card">
        <h3>7. "I'm going to wait and see if it gets worse"</h3>
        <p><strong>Response:</strong> "I totally understand. The downside to waiting is the process slows down - adjuster calendars fill up and the clearest documentation is right after the storm. Filing today just starts the claim; you still control the decision after the adjuster report."</p>
        <p><strong>Why it works:</strong> Urgency without pressure and lowers commitment risk.</p>
        <button class="practice-agnes-btn" data-scenario="m9-wait-and-see">🎭 Practice with Agnes</button>

        <!-- Inline Practice Container -->
        <div class="inline-practice-container" style="display: none;" data-scenario="m9-wait-and-see">
          <div class="mini-conversation-thread"></div>
          <div class="mini-input-area">
            <textarea class="mini-response-input" rows="3" placeholder="Type your response here..."></textarea>
            <div class="mini-actions">
              <button class="submit-mini-response">Submit Response</button>
              <button class="close-practice">Close Practice</button>
            </div>
          </div>
          <div class="mini-feedback" style="display: none;">
            <h4>📊 Key Points Checklist:</h4>
            <ul class="key-points-checklist"></ul>
            <div class="mini-actions">
              <button class="try-again-btn">Try Again</button>
              <button class="close-practice">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Enhanced Urgency Section -->
    <div style="margin-top: 40px;">
      <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
        <span style="background: #fef3c7; padding: 8px 12px; border-radius: 8px;">⚡</span>
        Creating Urgency (Without Being Pushy)
      </h2>

      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 35px;">
        <!-- Weather Reality Card -->
        <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 16px; padding: 20px; border-left: 4px solid #3b82f6;">
          <div style="font-size: 32px; margin-bottom: 10px;">🌧️</div>
          <h4 style="color: #1e40af; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">Weather Reality</h4>
          <p style="color: #374151; font-size: 14px; margin: 0; font-style: italic;">"We're 3 weeks out on scheduling. If we file today, we can get you on the schedule before winter."</p>
        </div>

        <!-- Adjuster Calendar Card -->
        <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; padding: 20px; border-left: 4px solid #16a34a;">
          <div style="font-size: 32px; margin-bottom: 10px;">📅</div>
          <h4 style="color: #166534; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">Adjuster Calendar</h4>
          <p style="color: #374151; font-size: 14px; margin: 0; font-style: italic;">"If we file today, we can get the adjuster scheduled sooner and avoid the backlog."</p>
        </div>

        <!-- Documentation Clarity Card -->
        <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 16px; padding: 20px; border-left: 4px solid #f59e0b;">
          <div style="font-size: 32px; margin-bottom: 10px;">📸</div>
          <h4 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">Documentation Clarity</h4>
          <p style="color: #374151; font-size: 14px; margin: 0; font-style: italic;">"The closer we are to the storm, the easier it is to document everything clearly for the adjuster."</p>
        </div>

        <!-- Project Timeline Card -->
        <div style="background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%); border-radius: 16px; padding: 20px; border-left: 4px solid #db2777;">
          <div style="font-size: 32px; margin-bottom: 10px;">🛠️</div>
          <h4 style="color: #9d174d; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">Project Timeline</h4>
          <p style="color: #374151; font-size: 14px; margin: 0; font-style: italic;">"Once approved, ordering materials and scheduling crews takes time. Starting now keeps the project moving."</p>
        </div>
      </div>
    </div>

    <!-- Enhanced Empathy Framework -->
    <div style="margin-top: 40px;">
      <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
        <span style="background: #f0fdf4; padding: 8px 12px; border-radius: 8px;">🤝</span>
        The Empathy Framework
      </h2>
      <p style="color: #6b7280; margin-bottom: 20px;">For every objection, use this 4-step framework:</p>

      <!-- Visual Flow -->
      <div style="display: flex; align-items: stretch; gap: 0; margin-bottom: 35px; flex-wrap: wrap;">
        <!-- Step 1 -->
        <div style="flex: 1; min-width: 150px; background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); padding: 20px; border-radius: 16px 0 0 16px; text-align: center; position: relative;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; margin: 0 auto 12px auto;">1</div>
          <h4 style="color: #1e40af; margin: 0 0 8px 0; font-size: 15px; font-weight: 600;">Acknowledge</h4>
          <p style="color: #374151; font-size: 13px; margin: 0; font-style: italic;">"I completely understand..."</p>
          <div style="position: absolute; right: -15px; top: 50%; transform: translateY(-50%); font-size: 24px; color: #3b82f6; z-index: 10;">→</div>
        </div>

        <!-- Step 2 -->
        <div style="flex: 1; min-width: 150px; background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); padding: 20px; text-align: center; position: relative;">
          <div style="background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; margin: 0 auto 12px auto;">2</div>
          <h4 style="color: #166534; margin: 0 0 8px 0; font-size: 15px; font-weight: 600;">Educate</h4>
          <p style="color: #374151; font-size: 13px; margin: 0; font-style: italic;">"Here's what most people don't know..."</p>
          <div style="position: absolute; right: -15px; top: 50%; transform: translateY(-50%); font-size: 24px; color: #16a34a; z-index: 10;">→</div>
        </div>

        <!-- Step 3 -->
        <div style="flex: 1; min-width: 150px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 20px; text-align: center; position: relative;">
          <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; margin: 0 auto 12px auto;">3</div>
          <h4 style="color: #92400e; margin: 0 0 8px 0; font-size: 15px; font-weight: 600;">Evidence</h4>
          <p style="color: #374151; font-size: 13px; margin: 0; font-style: italic;">"Let me show you the photos/data..."</p>
          <div style="position: absolute; right: -15px; top: 50%; transform: translateY(-50%); font-size: 24px; color: #f59e0b; z-index: 10;">→</div>
        </div>

        <!-- Step 4 -->
        <div style="flex: 1; min-width: 150px; background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%); padding: 20px; border-radius: 0 16px 16px 0; text-align: center;">
          <div style="background: linear-gradient(135deg, #db2777 0%, #be185d 100%); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; margin: 0 auto 12px auto;">4</div>
          <h4 style="color: #9d174d; margin: 0 0 8px 0; font-size: 15px; font-weight: 600;">Ask</h4>
          <p style="color: #374151; font-size: 13px; margin: 0; font-style: italic;">"Does that make sense? Should we move forward?"</p>
        </div>
      </div>
    </div>

    <!-- Module 10 Mini Quiz -->
    <div style="margin-top: 40px;" id="m10-quiz-section">
      <h2 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
        <span style="background: #fef2f2; padding: 8px 12px; border-radius: 8px;">📝</span>
        Knowledge Check
      </h2>

      <div id="m10-quiz-container" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 16px; padding: 30px; border: 2px solid #e2e8f0;">
        <!-- Quiz will be populated by JS -->
        <div id="m10-quiz-question" style="margin-bottom: 25px;">
          <div style="font-size: 14px; color: #6b7280; margin-bottom: 8px;">Question <span id="m10-q-num">1</span> of 5</div>
          <div id="m10-q-text" style="font-size: 18px; color: #1f2937; font-weight: 600;">Loading...</div>
        </div>
        <div id="m10-quiz-answers" style="display: grid; gap: 12px;">
          <!-- Answers populated by JS -->
        </div>
        <div id="m10-quiz-feedback" style="display: none; margin-top: 20px; padding: 15px; border-radius: 10px;"></div>
      </div>

      <div id="m10-quiz-results" style="display: none; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 16px; padding: 40px; text-align: center; margin-top: 20px;">
        <div id="m10-results-icon" style="font-size: 64px; margin-bottom: 15px;">🎉</div>
        <h3 id="m10-results-title" style="color: #166534; font-size: 24px; margin: 0 0 10px 0;">Great job!</h3>
        <p id="m10-results-text" style="color: #374151; font-size: 18px; margin: 0 0 20px 0;">You got <strong><span id="m10-score">0</span>/5</strong> correct</p>
        <button id="m10-retry-quiz" style="background: linear-gradient(135deg, #0891b2 0%, #06b6d4 100%); color: white; border: none; padding: 12px 24px; border-radius: 25px; font-weight: 600; font-size: 14px; cursor: pointer;">
          🔄 Retake Quiz
        </button>
      </div>
    </div>

    <div class="module-completion-section" id="module-complete-section" style="display: none;">
      <button class="complete-module-btn" onclick="completeModule('post-inspection-objections')">
        Complete Module & Continue
      </button>
    </div>
  </div>
`;

// 8. Damage Identification (remap existing)
trainingContent['damage-identification'] = trainingContent['roofing-damage-id'] || `
  <div class="content-card"><h1>Damage Identification</h1><p>Content coming soon.</p></div>
`;

// 11. Filing the Claim & Contingency + Claim Authorization Script (remap existing)
trainingContent['filing-claim-closing'] = trainingContent['claim-closing'] || `
  <div class="content-card"><h1>Filing the Claim & Contingency + Claim Authorization Script</h1><p>Content coming soon.</p></div>
`;

// 12. Sales Cycle & Job Flow (remap existing)
trainingContent['sales-cycle-job-flow'] = trainingContent['sales-cycle'] || `
  <div class="content-card"><h1>Sales Cycle & Job Flow</h1><p>Content coming soon.</p></div>
`;

// 14. Final Exam (new)
trainingContent['final-exam'] = `
  <div class="content-card" id="final-exam">
    <h1>🎯 Final Certification Exam</h1>
    <p class="module-intro">Complete this exam to become a Certified Roof E.R. Sales Representative. You have 3 attempts to score 80% or higher.</p>
    <div id="exam-area">
      <!-- Dynamically populated by initFinalExam() -->
    </div>
  </div>
`;

// 17. Admin Dashboard (Manager Only)
trainingContent['admin-dashboard'] = `
  <div class="content-card" id="admin-dashboard">
    <h1>📊 Admin Dashboard</h1>
    <p class="module-intro">Track team progress, view analytics, and manage users.</p>

    <div class="admin-tabs">
      <button class="admin-tab active" data-tab="users">👥 Users</button>
      <button class="admin-tab" data-tab="analytics">📈 Analytics</button>
      <button class="admin-tab" data-tab="time-tracker">⏱️ Time Tracker</button>
      <button class="admin-tab" data-tab="progress-grid">📊 Progress Grid</button>
    </div>

    <div class="admin-content">
      <!-- Users Tab -->
      <div id="admin-users-tab" class="admin-tab-content active">
        <div class="admin-toolbar">
          <input type="text" id="user-search" placeholder="Search users..." class="admin-search">
          <button id="refresh-users-btn" class="btn-secondary">🔄 Refresh</button>
        </div>
        <div id="users-table-container">
          <p class="loading-text">Loading users...</p>
        </div>
      </div>

      <!-- Analytics Tab -->
      <div id="admin-analytics-tab" class="admin-tab-content" style="display:none;">
        <div id="analytics-container">
          <p class="loading-text">Loading analytics...</p>
        </div>
      </div>

      <!-- Time Tracker Tab -->
      <div id="admin-time-tracker-tab" class="admin-tab-content" style="display:none;">
        <div class="time-tracker-header">
          <h3>Module Time Tracker</h3>
          <p>See how long each module takes reps to complete</p>
        </div>
        <div id="time-tracker-container">
          <p class="loading-text">Loading time analytics...</p>
        </div>
      </div>

      <!-- Progress Grid Tab -->
      <div id="admin-progress-grid-tab" class="admin-tab-content" style="display:none;">
        <div class="progress-grid-header">
          <h3>User Progress Grid</h3>
          <div class="progress-grid-toolbar">
            <input type="text" id="progress-grid-search" placeholder="Search by name..." class="admin-search">
            <button id="refresh-progress-grid-btn" class="btn-secondary">🔄 Refresh</button>
          </div>
        </div>
        <div class="progress-grid-legend">
          <span class="legend-item"><span class="status-icon completed">✅</span> Complete</span>
          <span class="legend-item"><span class="status-icon in-progress">🟡</span> In Progress</span>
          <span class="legend-item"><span class="status-icon stale">🔴</span> Stale (>48hrs)</span>
          <span class="legend-item"><span class="status-icon not-started">⬜</span> Not Started</span>
        </div>
        <div id="progress-grid-container">
          <p class="loading-text">Loading progress grid...</p>
        </div>
      </div>
    </div>

    <!-- User Detail Modal -->
    <div id="user-detail-modal" class="admin-modal" style="display:none;">
      <div class="admin-modal-content">
        <div class="admin-modal-header">
          <h2 id="user-detail-title">User Details</h2>
          <button class="modal-close" id="close-user-modal">×</button>
        </div>
        <div id="user-detail-body">
          <!-- Dynamically populated -->
        </div>
      </div>
    </div>
  </div>
`;

// Enhance Welcome with Quick Quiz #1
trainingContent['welcome'] += `
  <hr>
  <div class="org-chart">
    <h4>Company Structure</h4>
    <p>Roof-ER is organized with clear leadership and defined roles to serve homeowners with excellence.</p>
  </div>
  <div id="quiz1">
    <h3>Quick Quiz #1 (Company Overview)</h3>
    <button id="startQuickQuiz1">Start Quiz</button>
    <div id="quiz1-area"></div>
  </div>
`;

// Enhance Role-Play with persona + scenario selectors
trainingContent['role-play'] = (trainingContent['role-play'] || '').replace(
  '<div id="chat-container">',
  `<div class="rp-controls">
      <label>AI Name: <input id="rp-name" type="text" value="Agnes" /></label>
      <label>AI Role:
        <select id="rp-role">
          <option value="homeowner">Homeowner</option>
          <option value="rep">Sales Rep</option>
        </select>
      </label>
      <label>Persona:
        <select id="rp-persona">
          <option value="skeptical">Skeptical</option>
          <option value="busy">Busy</option>
          <option value="cost">Cost‑Concerned</option>
          <option value="neutral">Neutral</option>
        </select>
      </label>
      <label>Scenario:
        <select id="rp-scenario">
          <option value="noDamage">Doesn’t think there’s damage</option>
          <option value="badTiming">Bad time at the door</option>
          <option value="insuranceDIY">Wants to call insurance themselves</option>
          <option value="hoaRules">HOA restrictions</option>
          <option value="budget">Worried about cost/deductible</option>
          <option value="schedule">Scheduling/availability conflict</option>
          <option value="claimClosed">Claim already closed / prior denial</option>
          <option value="materials">Discontinued materials concern</option>
          <option value="safety">Ladder/safety hesitation</option>
        </select>
      </label>
      <div class="rp-actions">
        <button id="rp-reset">New Scenario</button>
        <button id="rp-hint">Hint</button>
        <button id="rp-export">Export Transcript</button>
      </div>
    </div>
    <div id="chat-container">`
);

// --- Video Player Function ---
function renderVideoPlayer(videoSrc: string, videoId: string, title: string) {
  const watchedKey = `video-watched-${videoId}`;
  const progressKey = `video-progress-${videoId}`;
  const isWatched = localStorage.getItem(watchedKey) === 'true';
  const savedProgress = parseFloat(localStorage.getItem(progressKey) || '0');

  return `
    <div class="video-player-container" style="margin: 20px 0; background: #f5f5f5; border-radius: 8px; padding: 20px;">
      <h3 style="margin-top: 0;">${title}</h3>
      <div style="position: relative;">
        <video
          id="${videoId}"
          controls
          style="width: 100%; max-width: 800px; border-radius: 4px;"
          ${savedProgress > 0 ? `data-start="${savedProgress}"` : ''}
        >
          <source src="${videoSrc}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
        ${isWatched ? '<div class="completion-badge" style="position: absolute; top: 10px; right: 10px; background: #4caf50; color: white; padding: 5px 10px; border-radius: 4px; font-size: 12px;">✓ Completed</div>' : ''}
      </div>
      <div class="video-progress-container" style="margin-top: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 14px; color: #666;">Video Progress</span>
          <span id="${videoId}-progress-text" style="font-size: 14px; font-weight: 600; color: ${isWatched ? '#4caf50' : '#666'};">${isWatched ? '100%' : '0%'}</span>
        </div>
        <div class="video-progress-track" style="width: 100%; max-width: 800px; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden;">
          <div id="${videoId}-progress-bar" class="video-progress-fill" style="width: ${isWatched ? '100' : '0'}%; height: 100%; background: linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%); border-radius: 4px; transition: width 0.3s ease;"></div>
        </div>
      </div>
    </div>
  `;
}

// Initialize video players after content is rendered
function initVideoPlayers() {
  const videos = document.querySelectorAll('video[id$="-video"]');
  videos.forEach(video => {
    const videoEl = video as HTMLVideoElement;
    const videoId = videoEl.id;
    const watchedKey = `video-watched-${videoId}`;
    const progressKey = `video-progress-${videoId}`;

    const progressBar = document.getElementById(`${videoId}-progress-bar`);
    const progressText = document.getElementById(`${videoId}-progress-text`);

    // Restore saved time
    const startTime = videoEl.getAttribute('data-start');
    if (startTime) videoEl.currentTime = parseFloat(startTime);

    // Remove any existing listeners by cloning (prevent duplicates)
    const newVideo = videoEl.cloneNode(true) as HTMLVideoElement;
    videoEl.parentNode?.replaceChild(newVideo, videoEl);

    // Re-get elements after clone
    const newProgressBar = document.getElementById(`${videoId}-progress-bar`);
    const newProgressText = document.getElementById(`${videoId}-progress-text`);

    // AbortController for cleanup - prevents memory leaks on module switch
    const abortController = new AbortController();
    const { signal } = abortController;
    registerModuleCleanup(() => abortController.abort());

    newVideo.addEventListener('timeupdate', function() {
      if (!newVideo.duration) return;
      const progress = (newVideo.currentTime / newVideo.duration) * 100;
      const progressPct = Math.round(progress);

      // Update progress bar and text
      if (newProgressBar) (newProgressBar as HTMLElement).style.width = progressPct + '%';
      if (newProgressText) newProgressText.textContent = progressPct + '%';

      localStorage.setItem(progressKey, newVideo.currentTime.toString());

      if (progress >= 90 && localStorage.getItem(watchedKey) !== 'true') {
        localStorage.setItem(watchedKey, 'true');

        // Update progress bar to 100% and change color
        if (newProgressBar) {
          (newProgressBar as HTMLElement).style.width = '100%';
          (newProgressBar as HTMLElement).style.background = 'linear-gradient(90deg, #4caf50 0%, #2e7d32 100%)';
        }
        if (newProgressText) {
          newProgressText.textContent = '100%';
          (newProgressText as HTMLElement).style.color = '#4caf50';
        }

        // Show video complete tip
        if (typeof showTip === 'function') {
          showTip({ icon: '✅', title: 'Video Complete!', message: 'Great job! Continue reading the content below.' });
        }
        // Add completion badge dynamically
        const badge = document.createElement('div');
        badge.className = 'completion-badge';
        badge.style.cssText = 'position: absolute; top: 10px; right: 10px; background: #4caf50; color: white; padding: 5px 10px; border-radius: 4px; font-size: 12px;';
        badge.textContent = '✓ Completed';
        newVideo.parentElement?.appendChild(badge);

        // Mark video watched in engagement state for current module
        if (currentModuleForEngagement) {
          markVideoWatched(currentModuleForEngagement);
        }
      }
    }, { signal });

    // Handle video loaded - restore saved progress display
    newVideo.addEventListener('loadedmetadata', function() {
      const savedTime = parseFloat(localStorage.getItem(progressKey) || '0');
      if (savedTime > 0 && newVideo.duration) {
        const savedPct = Math.round((savedTime / newVideo.duration) * 100);
        if (newProgressBar) (newProgressBar as HTMLElement).style.width = savedPct + '%';
        if (newProgressText) newProgressText.textContent = savedPct + '%';
      }
    }, { signal });
  });
}

// --- Speech Synthesis ---
const synth = window.speechSynthesis;
let currentUtterance: SpeechSynthesisUtterance | null = null;

function updateSpeakButtonState(btn: HTMLElement, speaking: boolean) {
    btn.textContent = speaking ? '⏸️' : '🔊';
    btn.classList.toggle('speaking', speaking);
}

function handleSpeak(event: MouseEvent) {
    const target = (event.target as HTMLElement).closest('.speak-btn') as HTMLElement;
    if (!target) return;

    const scriptContainer = target.closest('[data-text-source="true"]');
    if (!scriptContainer) return;

    // Get text excluding button content
    const clonedContainer = scriptContainer.cloneNode(true) as HTMLElement;
    clonedContainer.querySelectorAll('.speak-btn, .practice-btn').forEach(btn => btn.remove());
    const textToSpeak = clonedContainer.innerText.trim();

    if (synth.speaking && currentUtterance) {
        synth.cancel();
        // If the same button is clicked again, just stop the speech.
        if (currentUtterance.text === textToSpeak) {
            currentUtterance = null;
            updateSpeakButtonState(target, false);
            return;
        }
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);

    // Select male voice
    const voices = synth.getVoices();
    const maleVoice = voices.find(v =>
        v.name.includes('Daniel') ||
        v.name.includes('Alex') ||
        v.name.includes('Google US English') ||
        v.name.includes('Male')
    ) || voices[0];
    if (maleVoice) utterance.voice = maleVoice;
    utterance.rate = 0.95;  // Slightly slower for clarity
    utterance.pitch = 0.9;  // Slightly lower pitch

    currentUtterance = utterance;
    updateSpeakButtonState(target, true);

    utterance.onend = () => updateSpeakButtonState(target, false);
    utterance.onerror = (e) => {
        console.error("SpeechSynthesis Error", e);
        updateSpeakButtonState(target, false);
    };

    synth.speak(utterance);
}

// --- Module 5 Practice Mode ---
const practicePrompts = [
    "Introduce yourself by name and mention Roof-ER",
    "Explain that you specialize in helping homeowners with insurance claims",
    "Reference recent storms in the area",
    "Mention that you're helping neighbors get approved",
    "Explain what the free inspection includes",
    "Handle the 'If you have damage' scenario",
    "Handle the 'If you don't have damage' scenario",
    "Ask for their name and insurance company",
    "Hand off your card and explain next steps"
];

let currentPromptIndex = 0;
const practicedScripts = new Set<string>();

function togglePracticeMode() {
    const practiceDiv = document.getElementById('practice-mode');
    const introDiv = practiceDiv?.previousElementSibling as HTMLElement;
    if (practiceDiv && introDiv) {
        const isActive = practiceDiv.style.display !== 'none';
        practiceDiv.style.display = isActive ? 'none' : 'block';
        introDiv.style.display = isActive ? 'block' : 'none';
        if (!isActive) {
            currentPromptIndex = 0;
            updatePrompt();
        }
    }
}

function showNextPrompt() {
    currentPromptIndex = (currentPromptIndex + 1) % practicePrompts.length;
    updatePrompt();
}

function updatePrompt() {
    const promptEl = document.getElementById('practice-prompt-text');
    if (promptEl) {
        promptEl.textContent = practicePrompts[currentPromptIndex];
    }
}

function markPracticed(scriptId: string) {
    practicedScripts.add(scriptId);
    updatePracticeProgress();

    // Update button
    const btn = document.querySelector(`[data-script-id="${scriptId}"] .practice-btn`);
    if (btn) {
        btn.textContent = '✓ Practiced!';
        btn.classList.add('practiced');
    }

    // Update progress item
    const progressItem = document.querySelector(`.progress-item[data-script="${scriptId}"]`);
    if (progressItem) {
        progressItem.classList.add('completed');
        const icon = progressItem.querySelector('.progress-icon');
        if (icon) icon.textContent = '✅';
    }
}

function updatePracticeProgress() {
    const count = practicedScripts.size;
    const progressBar = document.getElementById('pitch-progress-bar');
    const countEl = document.getElementById('practice-count');

    if (progressBar) {
        progressBar.style.width = `${(count / 4) * 100}%`;
    }
    if (countEl) {
        countEl.textContent = String(count);
    }

    // Show completion if all practiced
    if (count === 4) {
        const completeSection = document.getElementById('module-complete-section');
        if (completeSection) {
            completeSection.style.display = 'block';
        }
    }
}

// Attach practice mode functions to window for onclick handlers
(window as any).togglePracticeMode = togglePracticeMode;
(window as any).showNextPrompt = showNextPrompt;
(window as any).markPracticed = markPracticed;

// --- Module 9: Post-Inspection Pitch Practice ---
const pitchPracticeSteps = [
  {
    phase: "INTEGRITY",
    userPrompt: "Show the homeowner collateral damage photos and explain their importance...",
    agnesResponse: "Okay, show me what you found on my roof...",
    tip: "Build credibility by showing collateral damage first - it establishes trust!"
  },
  {
    phase: "QUALITY",
    userPrompt: "Point out the hail damage and explain why it matters...",
    agnesResponse: "I see those circles you're pointing at... what exactly does that mean for my roof?",
    tip: "Explain the freeze-thaw cycle - it helps homeowners understand WHY this damage is serious."
  },
  {
    phase: "SIMPLICITY",
    userPrompt: "Summarize the damage and mention similar approvals in the area...",
    agnesResponse: "Wow, I had no idea there was this much damage. So what happens now?",
    tip: "Social proof is powerful - mentioning neighbor approvals builds confidence."
  },
  {
    phase: "INFO GATHERING",
    userPrompt: "Transition to gathering their information for the claim...",
    agnesResponse: "That sounds reasonable. What information do you need from me?",
    tip: "Keep the momentum! Smoothly transition from showing damage to starting the claim."
  }
];

let currentPitchStep = 0;

// TTS - Using Gemini high-quality voices (Kore/Aoede) with browser fallback
let currentAudio: HTMLAudioElement | null = null;
let isPlayingTTS = false;
let ttsCancelled = false;

// Stop all TTS immediately
function stopAllTTS() {
  ttsCancelled = true;
  synth.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio.onerror = null;
    try { URL.revokeObjectURL(currentAudio.src); } catch (e) {}
    currentAudio = null;
  }
  isPlayingTTS = false;

  // Reset all TTS buttons to their default state
  const fullScriptBtn = document.getElementById('play-full-script-btn');
  if (fullScriptBtn) {
    fullScriptBtn.innerHTML = '<span style="font-size: 1.5rem;">🔊</span><span>Listen to Full Script</span>';
    (fullScriptBtn as HTMLElement).style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
  }

  // Reset section play buttons
  document.querySelectorAll('.script-phase button').forEach(btn => {
    const el = btn as HTMLElement;
    if (el.innerHTML.includes('Stop')) {
      el.innerHTML = '🔊 Play';
      el.style.background = el.getAttribute('data-original-bg') || '#8b5cf6';
    }
  });
}

// Cancel any playing TTS on page load
synth.cancel();
stopAllTTS();

// Stop TTS when page is refreshed or closed
window.addEventListener('beforeunload', () => {
  stopAllTTS();
});

// Also stop when visibility changes (tab switch)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAllTTS();
  }
});

// Browser TTS fallback (used when OpenAI TTS is not available)
function speakWithBrowser(text: string, preferFemale: boolean = false): Promise<void> {
  return new Promise((resolve) => {
    if (ttsCancelled) {
      resolve();
      return;
    }

    synth.cancel(); // Clear any queue

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();

    const voice = preferFemale
      ? voices.find(v => v.name.includes('Samantha') || v.name.includes('Karen')) || voices[0]
      : voices.find(v => v.name.includes('Daniel') || v.name.includes('Alex')) || voices[0];

    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.pitch = preferFemale ? 1.1 : 0.95;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    synth.speak(utterance);
  });
}

// High-quality TTS using Gemini voices via server API (Kore = male, Aoede = female)
async function speakWithGemini(text: string, preferFemale: boolean = false): Promise<void> {
  if (ttsCancelled) return;

  try {
    // Use Kore (deep male) or Aoede (female) voice - same as Module 15's realistic voice
    const voice = preferFemale ? 'Aoede' : 'Kore';

    const response = await fetch('/api/ai/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice })
    });

    // Check if response is actually audio (not JSON error)
    const contentType = response.headers.get('content-type');
    if (!response.ok || contentType?.includes('application/json')) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.details || errorData.error || `TTS API error: ${response.status}`);
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    return new Promise((resolve, reject) => {
      if (ttsCancelled) {
        URL.revokeObjectURL(audioUrl);
        resolve();
        return;
      }

      currentAudio = new Audio(audioUrl);
      currentAudio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        resolve();
      };
      currentAudio.onerror = (e) => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        console.error('Audio playback error:', e);
        reject(new Error('Audio playback failed'));
      };
      currentAudio.play().catch(reject);
    });
  } catch (error) {
    console.error('Gemini TTS failed:', error);
    // Show user feedback instead of silent failure
    const btn = document.querySelector('.speak-btn-enhanced') as HTMLElement;
    if (btn) {
      const originalContent = btn.innerHTML;
      btn.innerHTML = '<span style="font-size: 1.5rem;">⚠️</span><span>Voice Unavailable - Trying Backup...</span>';
      btn.style.background = '#ef4444';
      setTimeout(() => {
        btn.innerHTML = originalContent;
        btn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
      }, 3000);
    }
    // Fall back to browser TTS as last resort
    await speakWithBrowser(text, preferFemale);
  }
}

// Main TTS function - uses Gemini high-quality voices (Kore/Aoede) with browser fallback
async function speakText(text: string, preferFemale: boolean = false): Promise<void> {
  if (ttsCancelled) return;
  await speakWithGemini(text, preferFemale);
}

async function speakFullScript() {
  const scriptContainer = document.querySelector('.full-script-section');
  if (!scriptContainer) {
    console.log('Script container not found');
    return;
  }

  const btn = document.querySelector('.speak-btn-enhanced') as HTMLElement;

  // Stop if already playing
  if (isPlayingTTS || synth.speaking) {
    stopAllTTS();
    if (btn) {
      btn.innerHTML = '<span style="font-size: 1.5rem;">🔊</span><span>Listen to Full Script</span>';
      btn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    }
    return;
  }

  // Reset cancel flag and start playing
  ttsCancelled = false;
  isPlayingTTS = true;

  // Get all text from script phases
  const phases = scriptContainer.querySelectorAll('.script-phase');
  let fullText = '';
  phases.forEach(phase => {
    const scriptContent = phase.querySelector('.script-content p');
    if (scriptContent) {
      let text = scriptContent.innerText
        .replace(/\[.*?\]/g, '') // Remove stage directions
        .replace(/→.*$/gm, '') // Remove arrow points
        .replace(/Gather:.*$/gm, '') // Remove gather list
        .trim();
      fullText += text + ' ';
    }
  });

  if (btn) {
    btn.innerHTML = '<span style="font-size: 1.5rem;">⏸️</span><span>Stop Playback</span>';
    btn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
  }

  try {
    await speakText(fullText, false); // Use male voice for script
  } finally {
    isPlayingTTS = false;
    if (btn && !ttsCancelled) {
      btn.innerHTML = '<span style="font-size: 1.5rem;">🔊</span><span>Listen to Full Script</span>';
      btn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    }
  }
}

async function speakSection(btn: HTMLElement) {
  const phase = btn.closest('.script-phase');
  if (!phase) return;

  const scriptContent = phase.querySelector('.script-content p');
  if (!scriptContent) return;

  // Get text and clean it up
  let textToSpeak = scriptContent.innerText
    .replace(/\[.*?\]/g, '') // Remove stage directions
    .replace(/→.*$/gm, '') // Remove arrow points
    .replace(/Gather:.*$/gm, '') // Remove gather list
    .trim();

  // Toggle off if already playing
  if (isPlayingTTS || synth.speaking || currentAudio) {
    stopAllTTS();
    btn.innerHTML = '🔊 Play';
    btn.style.background = btn.getAttribute('data-original-bg') || '#8b5cf6';
    return;
  }

  // Reset cancel flag and start playing
  ttsCancelled = false;
  isPlayingTTS = true;

  const originalBg = btn.style.background;
  btn.setAttribute('data-original-bg', originalBg);
  btn.innerHTML = '⏸️ Stop';
  btn.style.background = '#ef4444';

  try {
    await speakText(textToSpeak, false); // Use Kore (male) voice
  } finally {
    isPlayingTTS = false;
    if (!ttsCancelled) {
      btn.innerHTML = '🔊 Play';
      btn.style.background = originalBg;
    }
  }
}

function startPitchPractice() {
  currentPitchStep = 0;

  // Hide start button, show practice area
  const startEl = document.getElementById('agnes-pitch-start');
  const practiceEl = document.getElementById('agnes-pitch-practice');
  const completeEl = document.getElementById('agnes-pitch-complete');

  if (startEl) startEl.style.display = 'none';
  if (practiceEl) practiceEl.style.display = 'block';
  if (completeEl) completeEl.style.display = 'none';

  updatePitchPracticeStep();
}

function updatePitchPracticeStep() {
  const step = pitchPracticeSteps[currentPitchStep];
  if (!step) return;

  // Update progress dots
  const stepDots = document.querySelectorAll('.pitch-step');
  stepDots.forEach((dot, index) => {
    const el = dot as HTMLElement;
    if (index < currentPitchStep) {
      el.style.background = '#22c55e';
      el.style.color = 'white';
    } else if (index === currentPitchStep) {
      el.style.background = '#8b5cf6';
      el.style.color = 'white';
    } else {
      el.style.background = '#e5e7eb';
      el.style.color = '#6b7280';
    }
  });

  // Update chat messages
  const chatMessages = document.getElementById('pitch-chat-messages');
  if (chatMessages) {
    const phaseLabel = step.phase;
    chatMessages.innerHTML = `
      <div style="background: #f5f3ff; border-radius: 12px; padding: 16px; margin-bottom: 12px; border-left: 4px solid #8b5cf6;">
        <span style="background: #8b5cf6; color: white; padding: 4px 12px; border-radius: 12px; font-size: 0.8rem; font-weight: bold;">${phaseLabel}</span>
        <p style="margin: 12px 0 0 0; color: #374151; font-style: italic;">${step.userPrompt}</p>
      </div>
      <div style="background: #fef3c7; border-radius: 12px; padding: 16px; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 10px;">
        <span style="font-size: 1.5rem;">🧓</span>
        <div>
          <span style="font-weight: bold; color: #92400e;">Agnes:</span>
          <p style="margin: 8px 0 0 0; color: #78350f;">"${step.agnesResponse}"</p>
        </div>
      </div>
      <div style="background: #d1fae5; border-radius: 10px; padding: 12px; color: #065f46; font-size: 0.9rem;">
        💡 <strong>Tip:</strong> ${step.tip}
      </div>
    `;
  }

  // Update prompt
  const promptEl = document.getElementById('pitch-user-prompt');
  if (promptEl) {
    const isLast = currentPitchStep === pitchPracticeSteps.length - 1;
    promptEl.innerHTML = `
      <p style="color: #6b7280; font-style: italic; margin-bottom: 12px;">Your turn: ${step.userPrompt}</p>
      <button onclick="advancePitchPractice()" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white; border: none; padding: 12px 30px; border-radius: 25px; cursor: pointer; font-weight: bold; font-size: 1rem;">
        ${isLast ? "Complete Practice 🎉" : "I've Delivered This Part ✓"}
      </button>
    `;
  }
}

function advancePitchPractice() {
  currentPitchStep++;

  if (currentPitchStep >= pitchPracticeSteps.length) {
    // Complete! Show completion screen
    const practiceEl = document.getElementById('agnes-pitch-practice');
    const completeEl = document.getElementById('agnes-pitch-complete');

    if (practiceEl) practiceEl.style.display = 'none';
    if (completeEl) completeEl.style.display = 'block';

    // Also show the module completion button
    const moduleComplete = document.getElementById('module-complete-section');
    if (moduleComplete) moduleComplete.style.display = 'block';
    return;
  }

  updatePitchPracticeStep();
}

function resetPitchPractice() {
  currentPitchStep = 0;

  const startEl = document.getElementById('agnes-pitch-start');
  const practiceEl = document.getElementById('agnes-pitch-practice');
  const completeEl = document.getElementById('agnes-pitch-complete');

  if (startEl) startEl.style.display = 'block';
  if (practiceEl) practiceEl.style.display = 'none';
  if (completeEl) completeEl.style.display = 'none';
}

// --- Module 9: Live AI Role-Play with Agnes ---
const pitchPhases = [
  {
    phase: 1,
    name: "INTEGRITY - Opening",
    prompt: "🎯 Deliver your opening - show the collateral damage photos and explain their importance:",
    agnesOpening: "Hi! Come on in. So, you went up on my roof?",
    keyPoints: ["collateral damage", "evidence", "build the case", "lawyers"]
  },
  {
    phase: 2,
    name: "QUALITY - Damage Explanation",
    prompt: "🎯 Explain the hail damage and why it matters to the homeowner:",
    agnesOpening: "Okay, show me what you found...",
    keyPoints: ["circular", "divot", "freeze", "expand", "leaks", "insurance"]
  },
  {
    phase: 3,
    name: "SIMPLICITY - Summary",
    prompt: "🎯 Summarize the damage and mention similar approvals in the area:",
    agnesOpening: "I see those circles you're pointing at. What does that mean for my roof?",
    keyPoints: ["granules", "gutters", "neighbors", "similar", "approvals", "area"]
  },
  {
    phase: 4,
    name: "INTEGRITY - Information Gathering",
    prompt: "🎯 Transition to gathering their information for the claim:",
    agnesOpening: "Wow, I had no idea there was this much damage. So what happens now?",
    keyPoints: ["information", "system", "insurance", "deductible", "claim"]
  }
];

let currentPitchPhase = 0;
let pitchConversationHistory: {sender: string, message: string}[] = [];

// Voice-Based Role-Play with Agnes
let isRecording = false;
let speechRecognition: any = null;
let agnesAudioQueue: string[] = [];
let isAgnesSpeaking = false;

// Initialize Speech Recognition
function initSpeechRecognition() {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported');
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  return recognition;
}

// Speak Agnes's lines using Gemini TTS
async function speakAsAgnes(text: string): Promise<void> {
  isAgnesSpeaking = true;
  try {
    await speakText(text, true); // Use female voice for Agnes
  } finally {
    isAgnesSpeaking = false;
  }
}

function toggleVoiceRecording() {
  if (isRecording) {
    stopVoiceRecording();
  } else {
    startVoiceRecording();
  }
}

function startVoiceRecording() {
  if (isAgnesSpeaking) {
    updateVoiceStatus('Wait for Agnes to finish speaking...');
    return;
  }

  speechRecognition = initSpeechRecognition();
  if (!speechRecognition) {
    updateVoiceStatus('Voice not supported in this browser. Try Chrome.');
    return;
  }

  isRecording = true;
  const btn = document.getElementById('voice-record-btn') as HTMLElement;
  const transcript = document.getElementById('voice-transcript') as HTMLElement;

  if (btn) {
    btn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
    btn.style.animation = 'pulse 1s infinite';
    btn.innerHTML = '<span style="font-size: 2.5rem;">🔴</span>';
  }

  updateVoiceStatus('🎙️ Listening... Speak now!');
  if (transcript) {
    transcript.style.display = 'block';
    transcript.textContent = '';
  }

  let finalTranscript = '';

  speechRecognition.onresult = (event: any) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript + ' ';
      } else {
        interimTranscript += result[0].transcript;
      }
    }
    if (transcript) {
      transcript.textContent = finalTranscript + interimTranscript;
    }
  };

  speechRecognition.onend = async () => {
    isRecording = false;
    resetRecordButton();

    if (finalTranscript.trim()) {
      updateVoiceStatus('Processing your pitch...');
      await processVoiceInput(finalTranscript.trim());
    } else {
      updateVoiceStatus('No speech detected. Try again!');
    }
  };

  speechRecognition.onerror = (event: any) => {
    console.error('Speech recognition error:', event.error);
    isRecording = false;
    resetRecordButton();

    if (event.error === 'no-speech') {
      updateVoiceStatus('No speech detected. Tap the mic and speak!');
    } else if (event.error === 'not-allowed') {
      updateVoiceStatus('Microphone access denied. Please allow microphone access.');
    } else {
      updateVoiceStatus('Error: ' + event.error + '. Try again!');
    }
  };

  speechRecognition.start();
}

function stopVoiceRecording() {
  if (speechRecognition) {
    speechRecognition.stop();
  }
  isRecording = false;
  resetRecordButton();
}

function resetRecordButton() {
  const btn = document.getElementById('voice-record-btn') as HTMLElement;
  if (btn) {
    btn.style.background = 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)';
    btn.style.animation = 'none';
    btn.innerHTML = '<span style="font-size: 2.5rem;">🎤</span>';
  }
}

function updateVoiceStatus(message: string) {
  const status = document.getElementById('voice-status');
  if (status) status.textContent = message;
}

async function processVoiceInput(userMessage: string) {
  // Add user message to chat
  addPitchMessage('user', userMessage);

  // Show loading
  const loadingEl = document.getElementById('agnes-loading');
  const inputArea = document.getElementById('pitch-input-area');
  if (loadingEl) loadingEl.style.display = 'block';
  if (inputArea) inputArea.style.display = 'none';

  try {
    // Generate Agnes response
    const agnesResponse = await generateAgnesPitchResponse(userMessage);

    // Add Agnes message to chat
    addPitchMessage('agnes', agnesResponse);

    // Hide loading, show input
    if (loadingEl) loadingEl.style.display = 'none';
    if (inputArea) inputArea.style.display = 'block';

    // Speak Agnes's response
    updateVoiceStatus('🧓 Agnes is speaking...');
    await speakAsAgnes(agnesResponse);

    // Move to next phase
    currentPitchPhase++;
    if (currentPitchPhase >= pitchPhases.length) {
      completeLivePitchPractice();
    } else {
      updatePitchPhaseUI();
      const nextPhase = pitchPhases[currentPitchPhase];

      // Show and speak next opening
      setTimeout(async () => {
        addPitchMessage('agnes', nextPhase.agnesOpening);
        updateVoiceStatus('🧓 Agnes is speaking...');
        await speakAsAgnes(nextPhase.agnesOpening);
        updateVoiceStatus('Your turn! Tap the mic to respond.');
      }, 800);
    }
  } catch (error) {
    console.error('Error processing voice input:', error);
    addPitchMessage('agnes', "That sounds good! Tell me more about what you found.");

    if (loadingEl) loadingEl.style.display = 'none';
    if (inputArea) inputArea.style.display = 'block';
  }
}

function startLivePitchPractice() {
  currentPitchPhase = 0;
  pitchConversationHistory = [];

  const startEl = document.getElementById('agnes-pitch-start');
  const practiceEl = document.getElementById('agnes-pitch-practice');
  const completeEl = document.getElementById('agnes-pitch-complete');

  if (startEl) startEl.style.display = 'none';
  if (practiceEl) practiceEl.style.display = 'block';
  if (completeEl) completeEl.style.display = 'none';

  updatePitchPhaseUI();

  // Add and speak Agnes opening message
  const phase = pitchPhases[currentPitchPhase];
  addPitchMessage('agnes', phase.agnesOpening);

  updateVoiceStatus('🧓 Agnes is speaking...');
  speakAsAgnes(phase.agnesOpening)
    .then(() => updateVoiceStatus('Your turn! Tap the mic to respond.'))
    .catch(() => updateVoiceStatus('Your turn! Tap the mic to respond.')); // Fallback on TTS failure
}

function updatePitchPhaseUI() {
  const phase = pitchPhases[currentPitchPhase];
  if (!phase) return;

  // Update phase banner
  const banner = document.getElementById('current-phase-banner');
  if (banner) {
    banner.innerHTML = `<strong>Phase ${phase.phase}: ${phase.name}</strong>`;
  }

  // Update prompt
  const promptEl = document.getElementById('pitch-prompt-text');
  if (promptEl) {
    promptEl.textContent = phase.prompt;
  }

  // Update progress dots
  const stepDots = document.querySelectorAll('.pitch-step');
  stepDots.forEach((dot, index) => {
    const el = dot as HTMLElement;
    if (index < currentPitchPhase) {
      el.style.background = '#22c55e';
      el.style.color = 'white';
    } else if (index === currentPitchPhase) {
      el.style.background = '#8b5cf6';
      el.style.color = 'white';
    } else {
      el.style.background = '#e5e7eb';
      el.style.color = '#6b7280';
    }
  });

  // Reset voice UI
  const transcript = document.getElementById('voice-transcript') as HTMLElement;
  if (transcript) {
    transcript.textContent = '';
    transcript.style.display = 'none';
  }
}

function addPitchMessage(sender: 'user' | 'agnes', message: string) {
  const container = document.getElementById('pitch-chat-messages');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.style.cssText = sender === 'user'
    ? 'background: #eff6ff; border-radius: 12px; padding: 12px 16px; margin-bottom: 10px; margin-left: 40px; border-left: 4px solid #3b82f6;'
    : 'background: #fef3c7; border-radius: 12px; padding: 12px 16px; margin-bottom: 10px; margin-right: 40px; border-left: 4px solid #f59e0b; display: flex; align-items: flex-start; gap: 10px;';

  if (sender === 'agnes') {
    msgDiv.innerHTML = `<span style="font-size: 1.5rem;">🧓</span><div><strong style="color: #92400e;">Agnes:</strong><p style="margin: 6px 0 0 0; color: #78350f;">${message}</p></div>`;
  } else {
    msgDiv.innerHTML = `<strong style="color: #1e40af;">You:</strong><p style="margin: 6px 0 0 0; color: #334155;">${message}</p>`;
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;

  pitchConversationHistory.push({ sender, message });
}

async function generateAgnesPitchResponse(userMessage: string): Promise<string> {
  const phase = pitchPhases[currentPitchPhase];

  if (typeof ai !== 'undefined' && ai) {
    try {
      const prompt = `You are Agnes, a friendly homeowner receiving a post-inspection sales pitch from a roofing company representative. The rep is at Phase ${phase.phase}: ${phase.name}.

The sales rep just said: "${userMessage}"

Respond naturally as Agnes would - be agreeable and interested, but ask clarifying questions. Keep response to 1-2 sentences. Be encouraging but realistic.

Conversation so far:
${pitchConversationHistory.map(m => `${m.sender === 'user' ? 'Sales Rep' : 'Agnes'}: ${m.message}`).join('\n')}

Agnes's natural response:`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: prompt,
        config: { temperature: 0.8, maxOutputTokens: 100 }
      });

      return response.text?.trim() || getFallbackResponse(phase.phase);
    } catch (e) {
      console.warn('AI error, using fallback:', e);
    }
  }

  return getFallbackResponse(phase.phase);
}

function getFallbackResponse(phaseNum: number): string {
  const fallbacks: Record<number, string[]> = {
    1: ["I see, so that damage on my gutters is from the same storm?", "That makes sense about building a case. What else did you find?", "Interesting approach. Show me what's on the roof itself."],
    2: ["Oh wow, I had no idea those little marks could cause so much damage.", "So the insurance will cover fixing this?", "That's concerning about the leaks. What should I do?"],
    3: ["A lot of my neighbors got approved? That's good to know.", "So this is pretty common in the area then?", "I'm glad you're here to help with the insurance company."],
    4: ["Sure, what information do you need?", "I think my deductible is around $1000. Is that normal?", "Okay, let's get this process started."]
  };

  const responses = fallbacks[phaseNum] || fallbacks[1];
  return responses[Math.floor(Math.random() * responses.length)];
}

function skipPitchPhase() {
  currentPitchPhase++;
  if (currentPitchPhase >= pitchPhases.length) {
    completeLivePitchPractice();
  } else {
    updatePitchPhaseUI();
    const nextPhase = pitchPhases[currentPitchPhase];
    addPitchMessage('agnes', nextPhase.agnesOpening);
    updateVoiceStatus('🧓 Agnes is speaking...');
    speakAsAgnes(nextPhase.agnesOpening)
      .then(() => updateVoiceStatus('Your turn! Tap the mic to respond.'))
      .catch(() => updateVoiceStatus('Your turn! Tap the mic to respond.')); // Fallback on TTS failure
  }
}

function completeLivePitchPractice() {
  const practiceEl = document.getElementById('agnes-pitch-practice');
  const completeEl = document.getElementById('agnes-pitch-complete');
  const moduleComplete = document.getElementById('module-complete-section');

  if (practiceEl) practiceEl.style.display = 'none';
  if (completeEl) completeEl.style.display = 'block';
  if (moduleComplete) moduleComplete.style.display = 'block';

  // Stop any ongoing speech
  if (speechRecognition) speechRecognition.stop();
  synth.cancel();
}

function resetLivePitchPractice() {
  currentPitchPhase = 0;
  pitchConversationHistory = [];

  const startEl = document.getElementById('agnes-pitch-start');
  const practiceEl = document.getElementById('agnes-pitch-practice');
  const completeEl = document.getElementById('agnes-pitch-complete');
  const chatMessages = document.getElementById('pitch-chat-messages');

  if (startEl) startEl.style.display = 'block';
  if (practiceEl) practiceEl.style.display = 'none';
  if (completeEl) completeEl.style.display = 'none';
  if (chatMessages) chatMessages.innerHTML = '';

  // Stop any ongoing speech
  if (speechRecognition) speechRecognition.stop();
  synth.cancel();
}

// Attach Module 9 practice functions to window
(window as any).speakFullScript = speakFullScript;
(window as any).speakSection = speakSection;
(window as any).startPitchPractice = startPitchPractice;
(window as any).advancePitchPractice = advancePitchPractice;
(window as any).resetPitchPractice = resetPitchPractice;
(window as any).startLivePitchPractice = startLivePitchPractice;
(window as any).skipPitchPhase = skipPitchPhase;
(window as any).resetLivePitchPractice = resetLivePitchPractice;
(window as any).toggleVoiceRecording = toggleVoiceRecording;

// --- Module 7: Damage Matching Game ---
let selectedMatchItem: HTMLElement | null = null;
let matchedCount = 0;
let selectedSeqItem: HTMLElement | null = null;
let assignedNumbers: number[] = [];
let nextAssignNumber = 1;
let challenge1Complete = false;
let challenge2Complete = false;

function selectMatchItem(element: HTMLElement) {
  // Clear previous selection
  document.querySelectorAll('.match-item.description').forEach(item => {
    (item as HTMLElement).style.border = '2px solid #e5e7eb';
    (item as HTMLElement).style.boxShadow = 'none';
  });

  // Select this item
  element.style.border = '3px solid #8b5cf6';
  element.style.boxShadow = '0 0 15px rgba(139, 92, 246, 0.4)';
  selectedMatchItem = element;
}

function matchDamageType(element: HTMLElement) {
  if (!selectedMatchItem) {
    showMatchFeedback('First click a description on the left!', false);
    return;
  }

  const selectedMatch = selectedMatchItem.getAttribute('data-match');
  const targetMatch = element.getAttribute('data-match');

  if (selectedMatch === targetMatch) {
    // Correct match!
    matchedCount++;
    selectedMatchItem.style.background = '#d1fae5';
    selectedMatchItem.style.border = '2px solid #22c55e';
    selectedMatchItem.style.opacity = '0.7';
    selectedMatchItem.style.pointerEvents = 'none';

    element.style.opacity = '0.7';
    element.style.pointerEvents = 'none';
    element.style.transform = 'scale(0.95)';

    // Update count
    const countEl = document.getElementById('match-count');
    if (countEl) countEl.textContent = String(matchedCount);

    showMatchFeedback('Correct! Great job!', true);

    if (matchedCount === 4) {
      challenge1Complete = true;
      checkGameComplete();
    }
  } else {
    // Wrong match
    showMatchFeedback('Not quite - try again!', false);
    element.style.animation = 'shake 0.4s ease';
    setTimeout(() => element.style.animation = '', 400);
  }

  selectedMatchItem = null;
}

function showMatchFeedback(message: string, success: boolean) {
  const feedback = document.getElementById('match-feedback');
  if (feedback) {
    feedback.textContent = message;
    feedback.style.display = 'block';
    feedback.style.background = success ? '#d1fae5' : '#fee2e2';
    feedback.style.color = success ? '#065f46' : '#991b1b';
    setTimeout(() => feedback.style.display = 'none', 2000);
  }
}

function selectSeqItem(element: HTMLElement) {
  if (element.classList.contains('placed')) return;

  // Clear previous selection
  document.querySelectorAll('.seq-item').forEach(item => {
    if (!item.classList.contains('placed')) {
      (item as HTMLElement).style.border = '2px solid #e5e7eb';
    }
  });

  // Select or assign number
  if (selectedSeqItem === element) {
    // Clicking same item - assign next number
    const numEl = element.querySelector('.seq-number') as HTMLElement;
    if (numEl && nextAssignNumber <= 7) {
      numEl.textContent = String(nextAssignNumber);
      numEl.style.background = '#8b5cf6';
      numEl.style.color = 'white';
      element.classList.add('placed');
      element.style.border = '2px solid #8b5cf6';
      assignedNumbers.push(parseInt(element.getAttribute('data-order') || '0'));
      nextAssignNumber++;
      selectedSeqItem = null;
    }
  } else {
    // New selection
    element.style.border = '3px solid #8b5cf6';
    selectedSeqItem = element;
  }
}

function checkDocSequence() {
  const items = document.querySelectorAll('.seq-item');
  const currentOrder: number[] = [];
  let allAssigned = true;

  items.forEach(item => {
    const numEl = item.querySelector('.seq-number') as HTMLElement;
    if (numEl && numEl.textContent !== '?') {
      currentOrder.push(parseInt(numEl.textContent));
    } else {
      allAssigned = false;
    }
  });

  if (!allAssigned || currentOrder.length < 7) {
    showSeqFeedback('Assign all 7 steps first! Click each item to number it.', false);
    return;
  }

  // Check if order matches position
  let correct = true;
  items.forEach((item, index) => {
    const expectedOrder = parseInt(item.getAttribute('data-order') || '0');
    const numEl = item.querySelector('.seq-number') as HTMLElement;
    const assignedOrder = parseInt(numEl?.textContent || '0');

    if (assignedOrder !== expectedOrder) {
      correct = false;
    }
  });

  // Actually check if the DOM order has items in 1-7 sequence top to bottom
  const orderedItems = Array.from(items);
  let isCorrectSequence = true;
  orderedItems.forEach((item, index) => {
    const numEl = item.querySelector('.seq-number') as HTMLElement;
    const num = parseInt(numEl?.textContent || '0');
    const correctOrder = parseInt(item.getAttribute('data-order') || '0');
    if (num !== correctOrder) {
      isCorrectSequence = false;
    }
  });

  if (isCorrectSequence) {
    showSeqFeedback('Perfect! You nailed the documentation sequence!', true);
    challenge2Complete = true;

    // Color all items green
    items.forEach(item => {
      (item as HTMLElement).style.background = '#d1fae5';
      (item as HTMLElement).style.border = '2px solid #22c55e';
    });

    checkGameComplete();
  } else {
    showSeqFeedback('Not quite right. Review the sequence and try again!', false);
  }
}

function resetDocSequence() {
  nextAssignNumber = 1;
  assignedNumbers = [];
  selectedSeqItem = null;

  document.querySelectorAll('.seq-item').forEach(item => {
    item.classList.remove('placed');
    (item as HTMLElement).style.border = '2px solid #e5e7eb';
    (item as HTMLElement).style.background = 'white';
    const numEl = item.querySelector('.seq-number') as HTMLElement;
    if (numEl) {
      numEl.textContent = '?';
      numEl.style.background = '#e5e7eb';
      numEl.style.color = '#6b7280';
    }
  });

  const feedback = document.getElementById('seq-feedback');
  if (feedback) feedback.style.display = 'none';
}

// Toggle component image visibility
function toggleComponentImage(element: HTMLElement, componentId: string) {
  const imageContainer = document.getElementById(componentId + '-image');
  const expandIcon = element.querySelector('.expand-icon');

  if (imageContainer) {
    const isVisible = imageContainer.style.display !== 'none';

    // Close all other open images first
    document.querySelectorAll('.component-image-container').forEach(container => {
      (container as HTMLElement).style.display = 'none';
    });
    document.querySelectorAll('.expand-icon').forEach(icon => {
      icon.textContent = '+';
    });
    document.querySelectorAll('.clickable-component').forEach(comp => {
      (comp as HTMLElement).classList.remove('expanded');
    });

    // Toggle current one
    if (!isVisible) {
      imageContainer.style.display = 'block';
      if (expandIcon) expandIcon.textContent = '−';
      element.classList.add('expanded');
    }
  }
}

// Make toggleComponentImage available globally
(window as any).toggleComponentImage = toggleComponentImage;

function showSeqFeedback(message: string, success: boolean) {
  const feedback = document.getElementById('seq-feedback');
  if (feedback) {
    feedback.textContent = message;
    feedback.style.display = 'block';
    feedback.style.background = success ? '#d1fae5' : '#fee2e2';
    feedback.style.color = success ? '#065f46' : '#991b1b';
  }
}

function checkGameComplete() {
  if (challenge1Complete && challenge2Complete) {
    const completeSection = document.getElementById('game-complete-section');
    const moduleComplete = document.getElementById('module-complete-section');
    if (completeSection) completeSection.style.display = 'block';
    if (moduleComplete) moduleComplete.style.display = 'block';

    // Mark quiz as passed
    markQuizPassed('damage-identification');
  }
}

function initDamageMatchingGame() {
  console.log('🎮 Initializing Damage Matching Game...');

  // Reset game state
  matchedCount = 0;
  selectedMatchItem = null;
  challenge1Complete = false;
  challenge2Complete = false;
  nextAssignNumber = 1;
  assignedNumbers = [];
  selectedSeqItem = null;

  // Update match count display
  const countEl = document.getElementById('match-count');
  if (countEl) countEl.textContent = '0';

  console.log('✅ Damage Matching Game initialized');
}

// Attach game functions to window
(window as any).selectMatchItem = selectMatchItem;
(window as any).matchDamageType = matchDamageType;
(window as any).selectSeqItem = selectSeqItem;
(window as any).checkDocSequence = checkDocSequence;
(window as any).resetDocSequence = resetDocSequence;

// --- Game Logic ---
let salesCycleAttempts = 0;

function initSalesCycleSorter() {
    const pool = document.getElementById('items-pool');
    const dropZone = document.getElementById('sorted-list');
    const feedbackEl = document.getElementById('sales-cycle-feedback');
    if (!pool || !dropZone || !feedbackEl) return;

    // AbortController for cleanup - prevents memory leaks
    const abortController = new AbortController();
    const { signal } = abortController;
    registerModuleCleanup(() => abortController.abort());

    let draggedItem: HTMLElement | null = null;
    let dragSource: 'pool' | 'dropzone' | null = null;
    const correctOrder = ['1', '2', '3', '4', '5'];
    const phaseNames = ['Generating New Business', 'Adjuster Meeting', 'Project Meeting', 'Installation', 'Final Payment'];
    salesCycleAttempts = 0;

    // Touch support variables
    let touchStartX = 0;
    let touchStartY = 0;
    let touchClone: HTMLElement | null = null;

    // Handle drag from pool
    pool.addEventListener('dragstart', (e) => {
        draggedItem = e.target as HTMLElement;
        dragSource = 'pool';
        setTimeout(() => {
            if (draggedItem) draggedItem.style.opacity = '0.5';
        }, 0);
    }, { signal });

    pool.addEventListener('dragend', () => {
        setTimeout(() => {
            if (draggedItem) {
                draggedItem.style.opacity = '1';
                draggedItem = null;
                dragSource = null;
            }
        }, 0);
    }, { signal });

    // Handle drag from drop zone (to move back to pool)
    dropZone.addEventListener('dragstart', (e) => {
        draggedItem = e.target as HTMLElement;
        dragSource = 'dropzone';
        setTimeout(() => {
            if (draggedItem) draggedItem.style.opacity = '0.5';
        }, 0);
    }, { signal });

    dropZone.addEventListener('dragend', () => {
        setTimeout(() => {
            if (draggedItem) {
                draggedItem.style.opacity = '1';
                draggedItem = null;
                dragSource = null;
            }
        }, 0);
    }, { signal });

    // Drop zone accepts items
    dropZone.addEventListener('dragover', e => e.preventDefault(), { signal });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        if (draggedItem && dragSource === 'pool') {
            dropZone.appendChild(draggedItem);
            checkOrder();
        }
    }, { signal });

    // Pool accepts items back from drop zone
    pool.addEventListener('dragover', e => e.preventDefault(), { signal });

    pool.addEventListener('drop', (e) => {
        e.preventDefault();
        if (draggedItem && dragSource === 'dropzone') {
            pool.appendChild(draggedItem);
            feedbackEl.style.display = 'none'; // Hide feedback when moving items back
        }
    }, { signal });

    // TOUCH SUPPORT - Pool items
    pool.addEventListener('touchstart', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('draggable-item')) {
            e.preventDefault();
            draggedItem = target;
            dragSource = 'pool';
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;

            // Create visual clone for dragging
            touchClone = draggedItem.cloneNode(true) as HTMLElement;
            touchClone.style.position = 'fixed';
            touchClone.style.pointerEvents = 'none';
            touchClone.style.opacity = '0.8';
            touchClone.style.zIndex = '9999';
            touchClone.style.width = draggedItem.offsetWidth + 'px';
            touchClone.style.left = touch.clientX - draggedItem.offsetWidth / 2 + 'px';
            touchClone.style.top = touch.clientY - draggedItem.offsetHeight / 2 + 'px';
            document.body.appendChild(touchClone);

            draggedItem.style.opacity = '0.5';
        }
    }, { signal });

    pool.addEventListener('touchmove', (e) => {
        if (draggedItem && touchClone) {
            e.preventDefault();
            const touch = e.touches[0];
            touchClone.style.left = touch.clientX - touchClone.offsetWidth / 2 + 'px';
            touchClone.style.top = touch.clientY - touchClone.offsetHeight / 2 + 'px';
        }
    }, { signal });

    pool.addEventListener('touchend', (e) => {
        if (draggedItem && touchClone) {
            e.preventDefault();
            const touch = e.changedTouches[0];
            const dropTarget = document.elementFromPoint(touch.clientX, touch.clientY);

            // Clean up clone
            document.body.removeChild(touchClone);
            touchClone = null;
            draggedItem.style.opacity = '1';

            // Check if dropped on dropzone
            if (dropTarget && (dropTarget === dropZone || dropZone.contains(dropTarget)) && dragSource === 'pool') {
                dropZone.appendChild(draggedItem);
                checkOrder();
            }

            draggedItem = null;
            dragSource = null;
        }
    }, { signal });

    // TOUCH SUPPORT - Dropzone items (to move back)
    dropZone.addEventListener('touchstart', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('draggable-item')) {
            e.preventDefault();
            draggedItem = target;
            dragSource = 'dropzone';
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;

            // Create visual clone for dragging
            touchClone = draggedItem.cloneNode(true) as HTMLElement;
            touchClone.style.position = 'fixed';
            touchClone.style.pointerEvents = 'none';
            touchClone.style.opacity = '0.8';
            touchClone.style.zIndex = '9999';
            touchClone.style.width = draggedItem.offsetWidth + 'px';
            touchClone.style.left = touch.clientX - draggedItem.offsetWidth / 2 + 'px';
            touchClone.style.top = touch.clientY - draggedItem.offsetHeight / 2 + 'px';
            document.body.appendChild(touchClone);

            draggedItem.style.opacity = '0.5';
        }
    }, { signal });

    dropZone.addEventListener('touchmove', (e) => {
        if (draggedItem && touchClone) {
            e.preventDefault();
            const touch = e.touches[0];
            touchClone.style.left = touch.clientX - touchClone.offsetWidth / 2 + 'px';
            touchClone.style.top = touch.clientY - touchClone.offsetHeight / 2 + 'px';
        }
    }, { signal });

    dropZone.addEventListener('touchend', (e) => {
        if (draggedItem && touchClone) {
            e.preventDefault();
            const touch = e.changedTouches[0];
            const dropTarget = document.elementFromPoint(touch.clientX, touch.clientY);

            // Clean up clone
            document.body.removeChild(touchClone);
            touchClone = null;
            draggedItem.style.opacity = '1';

            // Check if dropped on pool
            if (dropTarget && (dropTarget === pool || pool.contains(dropTarget)) && dragSource === 'dropzone') {
                pool.appendChild(draggedItem);
                feedbackEl.style.display = 'none';
            }

            draggedItem = null;
            dragSource = null;
        }
    }, { signal });

    function checkOrder() {
        const items = dropZone.querySelectorAll('.draggable-item');
        if (items.length !== correctOrder.length) return;

        const currentOrder = Array.from(items).map(item => (item as HTMLElement).dataset.order);

        if (JSON.stringify(currentOrder) === JSON.stringify(correctOrder)) {
            feedbackEl.innerHTML = `
                <div style="color: #166534;">✅ Correct! That is the right order.</div>
            `;
            feedbackEl.className = 'feedback-message correct';
            // Show completion section
            const completeSection = document.getElementById('module-complete-section');
            if (completeSection) completeSection.style.display = 'block';
        } else {
            salesCycleAttempts++;
            let hint = '';
            if (salesCycleAttempts === 1) {
                hint = `<div style="margin-top: 10px; font-size: 13px; color: #6b7280;">💡 <strong>Hint:</strong> Think about what happens FIRST when you meet a homeowner...</div>`;
            } else if (salesCycleAttempts === 2) {
                hint = `<div style="margin-top: 10px; font-size: 13px; color: #6b7280;">💡 <strong>Hint:</strong> The first phase is "<strong>${phaseNames[0]}</strong>" - that's when you're door knocking or getting referrals!</div>`;
            } else {
                hint = `<div style="margin-top: 10px; font-size: 13px; color: #6b7280;">💡 <strong>Hint:</strong> The correct order is: <strong>1.</strong> ${phaseNames[0]} → <strong>2.</strong> ${phaseNames[1]} → <strong>3.</strong> ${phaseNames[2]} → ...</div>`;
            }
            feedbackEl.innerHTML = `
                <div style="color: #991b1b;">❌ Not quite right. Try again!</div>
                ${hint}
                <button onclick="resetSalesCycleGame()" style="margin-top: 12px; background: linear-gradient(135deg, #0891b2 0%, #06b6d4 100%); color: white; border: none; padding: 10px 20px; border-radius: 20px; font-weight: 600; font-size: 14px; cursor: pointer;">
                    🔄 Reset & Try Again
                </button>
            `;
            feedbackEl.className = 'feedback-message incorrect';
        }
        feedbackEl.style.display = 'block';
    }
}

// Reset Sales Cycle Game
function resetSalesCycleGame() {
    const pool = document.getElementById('items-pool');
    const dropZone = document.getElementById('sorted-list');
    const feedbackEl = document.getElementById('sales-cycle-feedback');

    if (!pool || !dropZone) return;

    // Move all items back to pool
    const items = dropZone.querySelectorAll('.draggable-item');
    items.forEach(item => {
        pool.appendChild(item);
        (item as HTMLElement).style.opacity = '1';
    });

    // Hide feedback
    if (feedbackEl) feedbackEl.style.display = 'none';
}

(window as any).resetSalesCycleGame = resetSalesCycleGame;

// --- Module 8: Inspection Step Card Toggle ---
function toggleStepCard(cardElement: HTMLElement) {
  const wasExpanded = cardElement.classList.contains('expanded');

  // Close all other cards
  document.querySelectorAll('.inspection-step-card.expanded').forEach(card => {
    card.classList.remove('expanded');
  });

  // Toggle clicked card
  if (!wasExpanded) {
    cardElement.classList.add('expanded');
  }
}

// Expose globally
(window as any).toggleStepCard = toggleStepCard;

// --- Module 11: Filing Claim Quiz (Checkbox Self-Assessment) ---
function initFilingClaimQuiz() {
  const quizContainer = document.getElementById('filing-claim-quiz');
  const feedbackEl = document.getElementById('filing-quiz-feedback');
  if (!quizContainer) return;

  const checkboxes = quizContainer.querySelectorAll('.filing-quiz-checkbox');
  const totalRequired = checkboxes.length;

  function checkCompletion() {
    const checkedCount = quizContainer!.querySelectorAll('.filing-quiz-checkbox:checked').length;

    if (checkedCount === totalRequired) {
      // All checkboxes checked - mark quiz as passed
      if (feedbackEl) {
        feedbackEl.style.display = 'block';
      }
      markQuizPassed('filing-claim-closing');
      checkModuleCompletion();
    } else {
      if (feedbackEl) {
        feedbackEl.style.display = 'none';
      }
    }
  }

  // Add change listeners to all checkboxes
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', checkCompletion);
  });

  // Check initial state (in case page was reloaded with checked boxes)
  checkCompletion();
}

// --- Module 8: Inspection Process Ordering Game ---
function initInspectionOrderGame() {
  const pool = document.getElementById('inspection-items-pool');
  const dropZone = document.getElementById('inspection-sorted-list');
  const feedbackEl = document.getElementById('inspection-order-feedback');
  const resetBtn = document.getElementById('reset-inspection-game');

  if (!pool || !dropZone || !feedbackEl) return;

  // AbortController for cleanup - prevents memory leaks
  const abortController = new AbortController();
  const { signal } = abortController;
  registerModuleCleanup(() => abortController.abort());

  let draggedItem: HTMLElement | null = null;
  const correctOrder = ['1', '2', '3', '4', '5', '6'];

  // Touch support variables
  let touchClone: HTMLElement | null = null;

  // Shuffle items on init for randomness
  shufflePoolItems();

  function shufflePoolItems() {
    const items = Array.from(pool!.querySelectorAll('.inspection-drag-item'));
    items.sort(() => Math.random() - 0.5);
    items.forEach(item => pool!.appendChild(item));
  }

  pool.addEventListener('dragstart', (e) => {
    draggedItem = e.target as HTMLElement;
    setTimeout(() => {
      if (draggedItem) draggedItem.style.opacity = '0.5';
    }, 0);
  }, { signal });

  pool.addEventListener('dragend', () => {
    setTimeout(() => {
      if (draggedItem) {
        draggedItem.style.opacity = '1';
        draggedItem = null;
      }
    }, 0);
  }, { signal });

  // Also allow dragging from sorted list back to pool
  dropZone.addEventListener('dragstart', (e) => {
    draggedItem = e.target as HTMLElement;
    setTimeout(() => {
      if (draggedItem) draggedItem.style.opacity = '0.5';
    }, 0);
  }, { signal });

  dropZone.addEventListener('dragend', () => {
    setTimeout(() => {
      if (draggedItem) {
        draggedItem.style.opacity = '1';
        draggedItem = null;
      }
    }, 0);
  }, { signal });

  // Drop zone handlers
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  }, { signal });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  }, { signal });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (draggedItem) {
      dropZone.appendChild(draggedItem);
      checkOrder();
    }
  }, { signal });

  // Allow dropping back to pool
  pool.addEventListener('dragover', (e) => {
    e.preventDefault();
    pool.classList.add('drag-over');
  }, { signal });

  pool.addEventListener('dragleave', () => {
    pool.classList.remove('drag-over');
  }, { signal });

  pool.addEventListener('drop', (e) => {
    e.preventDefault();
    pool.classList.remove('drag-over');
    if (draggedItem && !pool.contains(draggedItem)) {
      pool.appendChild(draggedItem);
      feedbackEl.style.display = 'none';
    }
  }, { signal });

  // TOUCH SUPPORT - Pool items
  pool.addEventListener('touchstart', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('inspection-drag-item')) {
      e.preventDefault();
      draggedItem = target;
      const touch = e.touches[0];

      // Create visual clone for dragging
      touchClone = draggedItem.cloneNode(true) as HTMLElement;
      touchClone.style.position = 'fixed';
      touchClone.style.pointerEvents = 'none';
      touchClone.style.opacity = '0.8';
      touchClone.style.zIndex = '9999';
      touchClone.style.width = draggedItem.offsetWidth + 'px';
      touchClone.style.left = touch.clientX - draggedItem.offsetWidth / 2 + 'px';
      touchClone.style.top = touch.clientY - draggedItem.offsetHeight / 2 + 'px';
      document.body.appendChild(touchClone);

      draggedItem.style.opacity = '0.5';
    }
  }, { signal });

  pool.addEventListener('touchmove', (e) => {
    if (draggedItem && touchClone) {
      e.preventDefault();
      const touch = e.touches[0];
      touchClone.style.left = touch.clientX - touchClone.offsetWidth / 2 + 'px';
      touchClone.style.top = touch.clientY - touchClone.offsetHeight / 2 + 'px';
    }
  }, { signal });

  pool.addEventListener('touchend', (e) => {
    if (draggedItem && touchClone) {
      e.preventDefault();
      const touch = e.changedTouches[0];
      const dropTarget = document.elementFromPoint(touch.clientX, touch.clientY);

      // Clean up clone
      document.body.removeChild(touchClone);
      touchClone = null;
      draggedItem.style.opacity = '1';

      // Check if dropped on dropzone
      if (dropTarget && (dropTarget === dropZone || dropZone.contains(dropTarget))) {
        dropZone.appendChild(draggedItem);
        checkOrder();
      }

      draggedItem = null;
    }
  }, { signal });

  // TOUCH SUPPORT - Dropzone items (to move back to pool)
  dropZone.addEventListener('touchstart', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('inspection-drag-item')) {
      e.preventDefault();
      draggedItem = target;
      const touch = e.touches[0];

      // Create visual clone for dragging
      touchClone = draggedItem.cloneNode(true) as HTMLElement;
      touchClone.style.position = 'fixed';
      touchClone.style.pointerEvents = 'none';
      touchClone.style.opacity = '0.8';
      touchClone.style.zIndex = '9999';
      touchClone.style.width = draggedItem.offsetWidth + 'px';
      touchClone.style.left = touch.clientX - draggedItem.offsetWidth / 2 + 'px';
      touchClone.style.top = touch.clientY - draggedItem.offsetHeight / 2 + 'px';
      document.body.appendChild(touchClone);

      draggedItem.style.opacity = '0.5';
    }
  }, { signal });

  dropZone.addEventListener('touchmove', (e) => {
    if (draggedItem && touchClone) {
      e.preventDefault();
      const touch = e.touches[0];
      touchClone.style.left = touch.clientX - touchClone.offsetWidth / 2 + 'px';
      touchClone.style.top = touch.clientY - touchClone.offsetHeight / 2 + 'px';
    }
  }, { signal });

  dropZone.addEventListener('touchend', (e) => {
    if (draggedItem && touchClone) {
      e.preventDefault();
      const touch = e.changedTouches[0];
      const dropTarget = document.elementFromPoint(touch.clientX, touch.clientY);

      // Clean up clone
      document.body.removeChild(touchClone);
      touchClone = null;
      draggedItem.style.opacity = '1';

      // Check if dropped on pool
      if (dropTarget && (dropTarget === pool || pool.contains(dropTarget))) {
        pool.appendChild(draggedItem);
        feedbackEl.style.display = 'none';
      }

      draggedItem = null;
    }
  }, { signal });

  function checkOrder() {
    const items = dropZone!.querySelectorAll('.inspection-drag-item');
    if (items.length !== correctOrder.length) {
      feedbackEl!.textContent = `${items.length}/6 steps placed. Keep going!`;
      feedbackEl!.className = '';
      feedbackEl!.style.display = 'block';
      feedbackEl!.style.background = '#fef3c7';
      feedbackEl!.style.color = '#92400e';
      feedbackEl!.style.padding = '16px 20px';
      feedbackEl!.style.borderRadius = '12px';
      feedbackEl!.style.fontWeight = '500';
      feedbackEl!.style.textAlign = 'center';
      feedbackEl!.style.marginTop = '16px';
      return;
    }

    const currentOrder = Array.from(items).map(item => (item as HTMLElement).dataset.order);

    if (JSON.stringify(currentOrder) === JSON.stringify(correctOrder)) {
      // Success!
      feedbackEl!.innerHTML = '🎉 <strong>Perfect!</strong> You\'ve mastered the inspection process order!';
      feedbackEl!.className = 'correct';
      feedbackEl!.style.display = 'block';
      feedbackEl!.style.background = 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)';
      feedbackEl!.style.border = '2px solid #22c55e';
      feedbackEl!.style.color = '#166534';

      // Mark all items as correct
      items.forEach(item => {
        (item as HTMLElement).classList.remove('incorrect');
        (item as HTMLElement).style.background = 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)';
      });

      // Trigger confetti
      triggerConfetti('module');

      // Mark quiz as passed
      markQuizPassed('inspection-process');

      // Hide reset button on success
      if (resetBtn) resetBtn.style.display = 'none';

    } else {
      // Show which are wrong
      items.forEach((item, index) => {
        const itemEl = item as HTMLElement;
        if (itemEl.dataset.order === correctOrder[index]) {
          itemEl.classList.remove('incorrect');
          itemEl.style.background = 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)';
        } else {
          itemEl.classList.add('incorrect');
          itemEl.style.background = 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)';
        }
      });

      feedbackEl!.textContent = 'Not quite right. Items highlighted in red are in the wrong position. Try again!';
      feedbackEl!.className = 'incorrect';
      feedbackEl!.style.display = 'block';
      feedbackEl!.style.background = 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)';
      feedbackEl!.style.border = '2px solid #ef4444';
      feedbackEl!.style.color = '#991b1b';

      // Show reset button
      if (resetBtn) resetBtn.style.display = 'inline-block';
    }
  }
}

// Reset game function
function resetInspectionGame() {
  const pool = document.getElementById('inspection-items-pool');
  const dropZone = document.getElementById('inspection-sorted-list');
  const feedbackEl = document.getElementById('inspection-order-feedback');
  const resetBtn = document.getElementById('reset-inspection-game');

  if (!pool || !dropZone) return;

  // Move all items back to pool
  const items = dropZone.querySelectorAll('.inspection-drag-item');
  items.forEach(item => {
    (item as HTMLElement).classList.remove('incorrect');
    (item as HTMLElement).style.background = '';
    pool.appendChild(item);
  });

  // Shuffle
  const poolItems = Array.from(pool.querySelectorAll('.inspection-drag-item'));
  poolItems.sort(() => Math.random() - 0.5);
  poolItems.forEach(item => pool.appendChild(item));

  // Hide feedback and reset button
  if (feedbackEl) feedbackEl.style.display = 'none';
  if (resetBtn) resetBtn.style.display = 'none';
}

// Expose globally
(window as any).resetInspectionGame = resetInspectionGame;

// Objection Challenge Game Data & State
const objectionChallengeQuestions = [
  {
    scenario: "I'm really busy right now, maybe another time.",
    options: [
      { text: "Okay, I'll come back later then.", correct: false, feedback: "This lets them off the hook too easily. Always offer specific alternatives!" },
      { text: "I totally understand! This will only take 2 minutes from the ground. Would 4pm today or 10am tomorrow work better for a full look?", correct: true, feedback: "Perfect! You acknowledged their concern and offered specific alternatives." },
      { text: "But this is really important, you could have serious damage.", correct: false, feedback: "This sounds pushy and doesn't respect their time. Lead with empathy first." }
    ]
  },
  {
    scenario: "We already have a roofer we use.",
    options: [
      { text: "Our company is better than whoever you're using.", correct: false, feedback: "Never attack their existing relationships. It makes you look unprofessional." },
      { text: "Totally. I'm not here to replace them — I just need 15 minutes to check for storm damage and show you what I find. It's free and quick.", correct: true, feedback: "Perfect. You respect their relationship and move straight to a quick inspection." },
      { text: "Well, let me know if you change your mind.", correct: false, feedback: "Too passive. You're giving up without offering any value." }
    ]
  },
  {
    scenario: "I don't think we have any damage.",
    options: [
      { text: "Trust me, you definitely have damage. I can see it from here.", correct: false, feedback: "Making claims without proof comes off as dishonest. Show, don't tell." },
      { text: "You might be right! But I've been on 10 roofs in this neighborhood today, and 8 had damage the owner didn't know about. Worst case, I give you peace of mind.", correct: true, feedback: "Great use of social proof and the peace of mind angle!" },
      { text: "How would you know? You're not a professional.", correct: false, feedback: "Confrontational and rude. This will shut down the conversation immediately." }
    ]
  },
  {
    scenario: "Not interested.",
    options: [
      { text: "Okay, have a nice day.", correct: false, feedback: "You gave up at the first objection. 'Not interested' often just means 'convince me.'" },
      { text: "I get it, a lot of your neighbors said the same thing at first. Then I showed them photos of damage they couldn't see from the ground. If there's nothing, you lose 2 minutes. If there is, you save thousands.", correct: true, feedback: "Perfect! Social proof + risk reversal + clear value proposition." },
      { text: "You should be interested, your roof looks terrible.", correct: false, feedback: "Insulting their home is never the right approach." }
    ]
  },
  {
    scenario: "I need to talk to my spouse first.",
    options: [
      { text: "Can't you make this decision yourself?", correct: false, feedback: "This is disrespectful to their relationship and decision-making process." },
      { text: "That's great! The inspection is free and I can leave info for both of you. Or I can wait if they'll be home soon. This way you have the facts when you talk.", correct: true, feedback: "Perfect! You respected their process while keeping momentum." },
      { text: "Fine, call me when you've decided.", correct: false, feedback: "Too passive. You're putting all the follow-up on them." }
    ]
  }
];

let challengeState = {
  currentQuestion: 0,
  score: 0,
  answered: false
};

function initObjectionMatcher() {
  // Initialize the new Objection Challenge game
  initObjectionChallenge();
}

function initObjectionChallenge() {
  challengeState = { currentQuestion: 0, score: 0, answered: false };
  renderChallengeQuestion();
}

function renderChallengeQuestion() {
  const question = objectionChallengeQuestions[challengeState.currentQuestion];
  if (!question) return;

  const scenarioText = document.getElementById('scenario-text');
  const optionsContainer = document.getElementById('response-options');
  const progressBar = document.getElementById('challenge-progress-bar');
  const progressText = document.getElementById('challenge-progress-text');
  const feedbackEl = document.getElementById('challenge-feedback');
  const challengeCard = document.getElementById('challenge-card');
  const challengeComplete = document.getElementById('challenge-complete');

  if (!scenarioText || !optionsContainer || !progressBar || !progressText) return;

  // Reset state
  challengeState.answered = false;
  if (feedbackEl) feedbackEl.style.display = 'none';
  if (challengeCard) challengeCard.style.display = 'block';
  if (challengeComplete) challengeComplete.style.display = 'none';

  // Update progress
  const progress = (challengeState.currentQuestion / objectionChallengeQuestions.length) * 100;
  progressBar.style.width = `${progress}%`;
  progressText.textContent = `Question ${challengeState.currentQuestion + 1} of ${objectionChallengeQuestions.length}`;

  // Render scenario
  scenarioText.textContent = `"${question.scenario}"`;

  // Shuffle and render options
  const shuffledOptions = [...question.options].sort(() => Math.random() - 0.5);
  optionsContainer.innerHTML = shuffledOptions.map((opt, idx) => `
    <button class="response-option" data-correct="${opt.correct}" data-feedback="${opt.feedback}" onclick="selectChallengeResponse(this)">
      ${opt.text}
    </button>
  `).join('');
}

(window as any).selectChallengeResponse = function(button: HTMLElement) {
  if (challengeState.answered) return;
  challengeState.answered = true;

  const isCorrect = button.dataset.correct === 'true';
  const feedback = button.dataset.feedback || '';
  const feedbackEl = document.getElementById('challenge-feedback');
  const scoreEl = document.getElementById('challenge-score');

  // Highlight selection
  const allOptions = document.querySelectorAll('.response-option');
  allOptions.forEach(opt => {
    opt.classList.add('disabled');
    if ((opt as HTMLElement).dataset.correct === 'true') {
      opt.classList.add('correct-answer');
    }
  });
  button.classList.add(isCorrect ? 'selected-correct' : 'selected-wrong');

  // Update score
  if (isCorrect) {
    challengeState.score += 100;
    if (scoreEl) scoreEl.textContent = challengeState.score.toString();
  }

  // Show feedback
  if (feedbackEl) {
    const feedbackIcon = feedbackEl.querySelector('.feedback-icon');
    const feedbackText = feedbackEl.querySelector('.feedback-text');
    if (feedbackIcon) feedbackIcon.textContent = isCorrect ? '✅' : '❌';
    if (feedbackText) feedbackText.textContent = feedback;
    feedbackEl.style.display = 'block';
    feedbackEl.className = `challenge-feedback ${isCorrect ? 'correct' : 'incorrect'}`;
  }
};

(window as any).nextChallengeQuestion = function() {
  challengeState.currentQuestion++;

  if (challengeState.currentQuestion >= objectionChallengeQuestions.length) {
    showChallengeComplete();
  } else {
    renderChallengeQuestion();
  }
};

function showChallengeComplete() {
  const challengeCard = document.getElementById('challenge-card');
  const challengeComplete = document.getElementById('challenge-complete');
  const finalScoreEl = document.getElementById('final-score');
  const scoreMessageEl = document.getElementById('score-message');
  const progressBar = document.getElementById('challenge-progress-bar');

  if (challengeCard) challengeCard.style.display = 'none';
  if (challengeComplete) challengeComplete.style.display = 'block';
  if (progressBar) progressBar.style.width = '100%';
  if (finalScoreEl) finalScoreEl.textContent = challengeState.score.toString();

  let message = '';
  const percentage = (challengeState.score / 500) * 100;
  if (percentage === 100) {
    message = "🌟 Perfect score! You're an objection handling master!";
  } else if (percentage >= 80) {
    message = "Great job! You've got solid objection handling skills.";
  } else if (percentage >= 60) {
    message = "Good effort! Review the responses and try again to improve.";
  } else {
    message = "Keep practicing! Review the flip cards above and try again.";
  }
  if (scoreMessageEl) scoreMessageEl.textContent = message;
}

(window as any).restartObjectionChallenge = function() {
  initObjectionChallenge();
};


// --- Module 10: Practice with Agnes Buttons ---
function initModule9RoleplayButtons() {
  console.log('🎭 Initializing Module 10 inline practice system...');

  const practiceButtons = document.querySelectorAll('.practice-agnes-btn');

  practiceButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const scenarioId = this.getAttribute('data-scenario');
      const practiceContainer = document.querySelector(`.inline-practice-container[data-scenario="${scenarioId}"]`);

      if (practiceContainer) {
        // Toggle visibility
        const isHidden = practiceContainer.style.display === 'none';

        if (isHidden) {
          // Start the practice session
          practiceContainer.style.display = 'block';
          startInlinePractice(scenarioId, practiceContainer);
        } else {
          // Close the practice session
          practiceContainer.style.display = 'none';
          resetInlinePractice(practiceContainer);
        }
      }
    });
  });

  // Add event listeners for close buttons
  const closeButtons = document.querySelectorAll('.close-practice');
  closeButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const container = this.closest('.inline-practice-container');
      if (container) {
        container.style.display = 'none';
        resetInlinePractice(container);
      }
    });
  });

  // Add event listeners for submit buttons
  const submitButtons = document.querySelectorAll('.submit-mini-response');
  submitButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const container = this.closest('.inline-practice-container');
      if (container) {
        handleInlineResponse(container);
      }
    });
  });

  // Add event listeners for try again buttons
  const tryAgainButtons = document.querySelectorAll('.try-again-btn');
  tryAgainButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const container = this.closest('.inline-practice-container');
      if (container) {
        const scenarioId = container.getAttribute('data-scenario');
        resetInlinePractice(container);
        startInlinePractice(scenarioId, container);
      }
    });
  });

  console.log(`✅ Initialized ${practiceButtons.length} inline practice sessions`);

  // Also initialize the Module 10 quiz
  initModule10Quiz();
}

// --- Module 10 Mini Quiz ---
function initModule10Quiz() {
  const quizContainer = document.getElementById('m10-quiz-container');
  const resultsDiv = document.getElementById('m10-quiz-results');
  const retryBtn = document.getElementById('m10-retry-quiz');

  if (!quizContainer) return;

  const questions = [
    {
      question: "Which urgency approach is most effective?",
      answers: [
        { text: "\"Sign today or the price goes up\"", correct: false },
        { text: "\"Our schedule fills up fast after storms—locking in now ensures priority\"", correct: true },
        { text: "\"Other companies will take your business\"", correct: false },
        { text: "\"This is a limited time offer\"", correct: false }
      ]
    },
    {
      question: "What is the first step in the Empathy Framework?",
      answers: [
        { text: "Educate them on the process", correct: false },
        { text: "Offer a solution right away", correct: false },
        { text: "Acknowledge their concern", correct: true },
        { text: "Ask for the sale", correct: false }
      ]
    },
    {
      question: "When creating urgency, you should focus on:",
      answers: [
        { text: "Pressuring the customer to decide", correct: false },
        { text: "Real consequences of waiting (weather, schedule, costs)", correct: true },
        { text: "Discounts that expire soon", correct: false },
        { text: "Comparing to competitors", correct: false }
      ]
    },
    {
      question: "In the Empathy Framework, \"Educate\" means:",
      answers: [
        { text: "Telling them they're wrong", correct: false },
        { text: "Sharing what most people don't know about the process", correct: true },
        { text: "Reading from a script", correct: false },
        { text: "Showing them competitor pricing", correct: false }
      ]
    },
    {
      question: "The best way to create urgency is to:",
      answers: [
        { text: "Pressure them to sign immediately", correct: false },
        { text: "Focus on real-world consequences while giving them space", correct: true },
        { text: "Mention competitor pricing", correct: false },
        { text: "Offer a one-day discount", correct: false }
      ]
    }
  ];

  let currentQ = 0;
  let correct = 0;

  function showQuestion() {
    const q = questions[currentQ];
    const qNumEl = document.getElementById('m10-q-num');
    const qTextEl = document.getElementById('m10-q-text');
    const answersEl = document.getElementById('m10-quiz-answers');
    const feedbackEl = document.getElementById('m10-quiz-feedback');

    if (!qNumEl || !qTextEl || !answersEl) return;

    qNumEl.textContent = String(currentQ + 1);
    qTextEl.textContent = q.question;
    if (feedbackEl) feedbackEl.style.display = 'none';

    // Shuffle answers
    const shuffled = [...q.answers].sort(() => Math.random() - 0.5);

    answersEl.innerHTML = shuffled.map((ans, idx) => `
      <button class="m10-answer-btn" data-correct="${ans.correct}" style="
        background: white;
        border: 2px solid #e5e7eb;
        border-radius: 12px;
        padding: 14px 18px;
        text-align: left;
        font-size: 14px;
        color: #374151;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 10px;
      ">
        <span style="background: #f3f4f6; padding: 4px 10px; border-radius: 6px; font-weight: 600; color: #6b7280;">${String.fromCharCode(65 + idx)}</span>
        <span>${ans.text}</span>
      </button>
    `).join('');

    // Add click handlers
    answersEl.querySelectorAll('.m10-answer-btn').forEach(btn => {
      btn.addEventListener('click', handleM10Answer);
    });
  }

  function handleM10Answer(e: Event) {
    const btn = e.currentTarget as HTMLElement;
    const isCorrect = btn.dataset.correct === 'true';
    const feedbackEl = document.getElementById('m10-quiz-feedback');
    const answersEl = document.getElementById('m10-quiz-answers');

    // Disable all buttons
    answersEl?.querySelectorAll('.m10-answer-btn').forEach(b => {
      (b as HTMLElement).style.pointerEvents = 'none';
    });

    // Highlight correct answer
    answersEl?.querySelectorAll('.m10-answer-btn').forEach(b => {
      const el = b as HTMLElement;
      if (el.dataset.correct === 'true') {
        el.style.background = 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)';
        el.style.borderColor = '#16a34a';
      }
    });

    if (isCorrect) {
      correct++;
      btn.style.background = 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)';
      btn.style.borderColor = '#16a34a';
      if (feedbackEl) {
        feedbackEl.innerHTML = '<div style="color: #166534; font-weight: 600;">✅ Correct!</div>';
        feedbackEl.style.background = 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)';
        feedbackEl.style.display = 'block';
      }
    } else {
      btn.style.background = 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)';
      btn.style.borderColor = '#dc2626';
      if (feedbackEl) {
        feedbackEl.innerHTML = '<div style="color: #991b1b; font-weight: 600;">❌ Not quite. The correct answer is highlighted.</div>';
        feedbackEl.style.background = 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)';
        feedbackEl.style.display = 'block';
      }
    }

    // Advance after delay
    setTimeout(() => {
      currentQ++;
      if (currentQ < questions.length) {
        showQuestion();
      } else {
        showM10Results();
      }
    }, 1200);
  }

  function showM10Results() {
    if (quizContainer) quizContainer.style.display = 'none';
    if (resultsDiv) {
      resultsDiv.style.display = 'block';
      const scoreEl = document.getElementById('m10-score');
      const iconEl = document.getElementById('m10-results-icon');
      const titleEl = document.getElementById('m10-results-title');

      if (scoreEl) scoreEl.textContent = String(correct);

      const percentage = (correct / 5) * 100;
      if (percentage >= 80) {
        if (iconEl) iconEl.textContent = '🎉';
        if (titleEl) {
          titleEl.textContent = 'Great job!';
          titleEl.style.color = '#166534';
        }
        resultsDiv.style.background = 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)';
        // Show module completion
        const completeSection = document.getElementById('module-complete-section');
        if (completeSection) completeSection.style.display = 'block';
      } else if (percentage >= 60) {
        if (iconEl) iconEl.textContent = '👍';
        if (titleEl) {
          titleEl.textContent = 'Good effort!';
          titleEl.style.color = '#ca8a04';
        }
        resultsDiv.style.background = 'linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)';
        // Still show completion for 60%+
        const completeSection = document.getElementById('module-complete-section');
        if (completeSection) completeSection.style.display = 'block';
      } else {
        if (iconEl) iconEl.textContent = '📚';
        if (titleEl) {
          titleEl.textContent = 'Keep studying!';
          titleEl.style.color = '#dc2626';
        }
        resultsDiv.style.background = 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)';
      }
    }
  }

  function resetM10Quiz() {
    currentQ = 0;
    correct = 0;
    if (quizContainer) quizContainer.style.display = 'block';
    if (resultsDiv) resultsDiv.style.display = 'none';
    showQuestion();
  }

  // Event listeners
  if (retryBtn) {
    retryBtn.addEventListener('click', resetM10Quiz);
  }

  // Start the quiz
  showQuestion();
}

// Helper: Start inline practice session
function startInlinePractice(scenarioId, container) {
  const allScenarios = getAllAgnesScenarios();
  const scenario = allScenarios.find(s => s.id === scenarioId);

  if (!scenario) {
    console.error('Scenario not found:', scenarioId);
    return;
  }

  // Initialize state
  container.dataset.currentTurn = '0';
  container.dataset.maxTurns = '3';

  // Display Agnes's first prompt
  const thread = container.querySelector('.mini-conversation-thread');
  thread.innerHTML = `
    <div class="conversation-message agnes-message">
      <strong>Agnes:</strong> ${scenario.prompt}
    </div>
  `;

  // Show input area, hide feedback
  container.querySelector('.mini-input-area').style.display = 'block';
  container.querySelector('.mini-feedback').style.display = 'none';
  container.querySelector('.mini-response-input').value = '';
}

// Helper: Handle user response submission
function handleInlineResponse(container) {
  const textarea = container.querySelector('.mini-response-input');
  const userResponse = textarea.value.trim();

  if (!userResponse) {
    alert('Please enter a response before submitting.');
    return;
  }

  const currentTurn = parseInt(container.dataset.currentTurn || '0');
  const maxTurns = parseInt(container.dataset.maxTurns || '3');
  const scenarioId = container.getAttribute('data-scenario');

  // Add user's response to thread
  const thread = container.querySelector('.mini-conversation-thread');
  const userMessageDiv = document.createElement('div');
  userMessageDiv.className = 'conversation-message user-message';
  userMessageDiv.innerHTML = `<strong>You:</strong> ${userResponse}`;
  thread.appendChild(userMessageDiv);

  // Clear textarea
  textarea.value = '';

  // Scroll to bottom
  thread.scrollTop = thread.scrollHeight;

  // Increment turn
  const newTurn = currentTurn + 1;
  container.dataset.currentTurn = newTurn.toString();

  // Check if conversation is complete
  if (newTurn >= maxTurns) {
    // Show feedback after final turn
    setTimeout(() => showInlineFeedback(container, scenarioId), 500);
  } else {
    // Generate Agnes's follow-up
    setTimeout(() => {
      const followUp = generateAgnesInlineFollowup(scenarioId, newTurn);
      const agnesMessageDiv = document.createElement('div');
      agnesMessageDiv.className = 'conversation-message agnes-message';
      agnesMessageDiv.innerHTML = `<strong>Agnes:</strong> ${followUp}`;
      thread.appendChild(agnesMessageDiv);

      // Scroll to bottom
      thread.scrollTop = thread.scrollHeight;
    }, 800);
  }
}

// Helper: Generate Agnes's follow-up responses (pre-built)
function generateAgnesInlineFollowup(scenarioId, turnNumber) {
  const followUps = {
    'm9-capstone-1': [
      'That sounds reasonable, but I just got off the phone with three other contractors. What makes you different?',
      'Okay, I understand the timeline part. But what about the price? Can you match if someone comes in lower?'
    ],
    'm9-deductible-objection-close': [
      'A new roof for $1,500 sounds great, but what if my rates go up more than that over time?',
      'I hear you, but my neighbor said their insurance went up $800/year after filing a claim. Is that normal?'
    ],
    'm9-claim-fear': [
      'But won\'t filing a claim make my insurance company drop me or raise my rates significantly?',
      'You say rates go up anyway, but how much more will they go up if I actually file this claim?'
    ],
    'm9-adjuster-pushback': [
      'I see the photos, but the damage doesn\'t look that bad to me. Are you sure insurance will even approve this?',
      'Okay, but what if the insurance adjuster disagrees with your assessment? Then what?'
    ],
    'm9-spouse-decision': [
      'My spouse works late most nights. Can we schedule something for next weekend instead?',
      'We both like to think things over for a few days. Can I call you back next week?'
    ],
    'm9-scope-walkthrough': [
      'That makes sense, but I\'m pretty handy. Can\'t I just take photos and submit them myself?',
      'What about the cost of hiring you? Won\'t that eat into my claim payout?'
    ],
    'm9-first-time-claim': [
      'That sounds simple enough, but what happens if the adjuster comes out and finds nothing wrong?',
      'I\'m worried about the process taking forever. How long does it typically take from start to finish?'
    ],
    'm9-denial-fear': [
      'Zero risk sounds good, but won\'t I have wasted time if the claim gets denied?',
      'What percentage of your claims actually get approved? Is there a reason to think mine might not?'
    ],
    'm9-wait-and-see': [
      'I understand the statute of limitations, but how can I be sure this damage is from a recent storm?',
      'What if I wait just a few more months to see if any leaks develop? Would that really hurt my case?'
    ]
  };

  const scenarioFollowUps = followUps[scenarioId] || [
    'I appreciate that information. Can you tell me more about how this process works?',
    'That makes sense. What would be the next steps if I decide to move forward?'
  ];

  return scenarioFollowUps[turnNumber - 1] || scenarioFollowUps[scenarioFollowUps.length - 1];
}

// Helper: Show feedback after conversation
function showInlineFeedback(container, scenarioId) {
  const allScenarios = getAllAgnesScenarios();
  const scenario = allScenarios.find(s => s.id === scenarioId);

  if (!scenario) return;

  // Hide input area
  container.querySelector('.mini-input-area').style.display = 'none';

  // Get all user responses
  const userMessages = container.querySelectorAll('.user-message');
  const allResponses = Array.from(userMessages).map(msg => msg.textContent.replace('You:', '').trim()).join(' ');

  // Score the responses
  const score = scoreResponse(allResponses, scenario.keyPoints);

  // Display key points checklist
  const feedbackDiv = container.querySelector('.mini-feedback');
  const checklist = feedbackDiv.querySelector('.key-points-checklist');

  checklist.innerHTML = scenario.keyPoints.map(point => {
    const matched = score.matchedPoints.includes(point);
    return `
      <li class="${matched ? 'matched' : 'missed'}">
        ${matched ? '✓' : '✗'} ${point}
      </li>
    `;
  }).join('');

  // Show feedback section
  feedbackDiv.style.display = 'block';
}

// Helper: Reset inline practice
function resetInlinePractice(container) {
  container.dataset.currentTurn = '0';
  const thread = container.querySelector('.mini-conversation-thread');
  thread.innerHTML = '';
  container.querySelector('.mini-response-input').value = '';
  container.querySelector('.mini-input-area').style.display = 'block';
  container.querySelector('.mini-feedback').style.display = 'none';
}

// --- Module 4: Shingle Type Challenge Game ---
const shingleQuestions = [
  { q: "This shingle type has a flat, uniform appearance with visible cutouts creating a tab pattern.", a: "3tab", explain: "3-Tab shingles have distinct cutouts that create 3 separate tabs per strip." },
  { q: "These shingles have a dimensional, layered look that mimics natural wood shakes or slate.", a: "arch", explain: "Architectural shingles use multiple layers to create that textured, dimensional appearance." },
  { q: "Wind rating: 60-70 mph. Lifespan: 15-25 years. Single-layer construction.", a: "3tab", explain: "3-Tab shingles have lower wind ratings and shorter lifespans due to single-layer design." },
  { q: "Wind rating: 110-130 mph. Lifespan: 25-30 years. Multi-layer laminated construction.", a: "arch", explain: "Architectural shingles have superior wind resistance and longevity from their laminated layers." },
  { q: "Commonly found on homes built before 2000. Often the builder-grade option for budget construction.", a: "3tab", explain: "3-Tab was the standard before architectural shingles became more affordable and popular." },
  { q: "Features a thicker profile with shadow lines that add depth and curb appeal.", a: "arch", explain: "The dimensional design of architectural shingles creates natural shadow lines." },
  { q: "GAF's HDZ and Timberline series are examples of this premium shingle type.", a: "arch", explain: "GAF Timberline HDZ is their flagship architectural shingle line." },
  { q: "Weighs approximately 200-250 lbs per square. Thinner, lighter construction.", a: "3tab", explain: "3-Tab shingles are lighter due to their single-layer construction." },
  { q: "This type has a layered, dimensional look and stronger wind performance.", a: "arch", explain: "Architectural shingles use multiple laminated layers and higher wind ratings." },
  { q: "Most common upgrade recommended by Roof-ER when replacing storm-damaged roofs.", a: "arch", explain: "We recommend architectural upgrades for their superior protection and appearance!" }
];

let shingleGameState = {
  currentQuestion: 0,
  score: 0,
  gameQuestions: [] as typeof shingleQuestions,
  answered: false
};

function initShingleGame() {
  console.log('🎮 Initializing Shingle Type Challenge...');

  // Shuffle and pick 5 questions
  shingleGameState.gameQuestions = [...shingleQuestions].sort(() => Math.random() - 0.5).slice(0, 5);
  shingleGameState.currentQuestion = 0;
  shingleGameState.score = 0;
  shingleGameState.answered = false;

  const scoreEl = document.getElementById('game-score');
  const progressEl = document.getElementById('game-progress');
  const completeEl = document.getElementById('game-complete');
  const questionAreaEl = document.getElementById('game-question-area');

  if (scoreEl) scoreEl.textContent = '0';
  if (progressEl) progressEl.style.width = '0%';
  if (completeEl) completeEl.style.display = 'none';
  if (questionAreaEl) questionAreaEl.style.display = 'block';

  showShingleQuestion();
}

function showShingleQuestion() {
  const { currentQuestion, gameQuestions } = shingleGameState;

  if (currentQuestion >= gameQuestions.length) {
    endShingleGame();
    return;
  }

  shingleGameState.answered = false;
  const q = gameQuestions[currentQuestion];

  const qNumEl = document.getElementById('q-num');
  const questionTextEl = document.getElementById('question-text');
  const feedbackAreaEl = document.getElementById('feedback-area');

  if (qNumEl) qNumEl.textContent = String(currentQuestion + 1);
  if (questionTextEl) questionTextEl.textContent = q.q;
  if (feedbackAreaEl) feedbackAreaEl.style.display = 'none';

  // Reset button states
  document.querySelectorAll('.answer-btn, .answer-img-btn').forEach(btn => {
    btn.classList.remove('correct', 'incorrect', 'disabled');
    (btn as HTMLElement).style.pointerEvents = 'auto';
  });
}

(window as any).checkShingleAnswer = function(answer: string) {
  if (shingleGameState.answered) return;
  shingleGameState.answered = true;

  const q = shingleGameState.gameQuestions[shingleGameState.currentQuestion];
  const isCorrect = answer === q.a;
  const feedbackArea = document.getElementById('feedback-area');
  const feedbackIcon = document.getElementById('feedback-icon');
  const feedbackText = document.getElementById('feedback-text');

  // Disable buttons and show states
  document.querySelectorAll('.answer-btn, .answer-img-btn').forEach(btn => {
    (btn as HTMLElement).style.pointerEvents = 'none';
    btn.classList.add('disabled');
    if ((btn as HTMLElement).dataset.answer === q.a) {
      btn.classList.add('correct');
    } else if ((btn as HTMLElement).dataset.answer === answer && !isCorrect) {
      btn.classList.add('incorrect');
    }
  });

  if (isCorrect) {
    shingleGameState.score++;
    const scoreEl = document.getElementById('game-score');
    if (scoreEl) scoreEl.textContent = String(shingleGameState.score);
    if (feedbackIcon) feedbackIcon.textContent = '✅';
    if (feedbackText) feedbackText.innerHTML = '<strong>Correct!</strong> ' + q.explain;
    if (feedbackArea) feedbackArea.className = 'feedback-area correct';
  } else {
    if (feedbackIcon) feedbackIcon.textContent = '❌';
    if (feedbackText) feedbackText.innerHTML = '<strong>Not quite!</strong> ' + q.explain;
    if (feedbackArea) feedbackArea.className = 'feedback-area incorrect';
  }

  if (feedbackArea) feedbackArea.style.display = 'flex';
  const progressEl = document.getElementById('game-progress');
  if (progressEl) progressEl.style.width = ((shingleGameState.currentQuestion + 1) / 5 * 100) + '%';

  // Auto-advance after 2.5 seconds
  setTimeout(() => {
    shingleGameState.currentQuestion++;
    showShingleQuestion();
  }, 2500);
};

function endShingleGame() {
  const questionAreaEl = document.getElementById('game-question-area');
  const completeEl = document.getElementById('game-complete');
  const finalScoreEl = document.getElementById('final-score');
  const msgEl = document.getElementById('score-message');
  const continueBtn = document.getElementById('shingle-continue-btn');
  const passingNote = document.getElementById('passing-note');

  if (questionAreaEl) questionAreaEl.style.display = 'none';
  if (completeEl) completeEl.style.display = 'block';
  if (finalScoreEl) finalScoreEl.textContent = String(shingleGameState.score);

  // Determine if passed (3+ out of 5)
  const passed = shingleGameState.score >= 3;

  if (msgEl) {
    if (shingleGameState.score === 5) {
      msgEl.textContent = "🌟 Perfect! You're a shingle expert ready for the field!";
    } else if (shingleGameState.score >= 4) {
      msgEl.textContent = "Great job! You've got a solid grasp of shingle types.";
    } else if (shingleGameState.score >= 3) {
      msgEl.textContent = "Good work! You passed and can continue to the next module.";
    } else {
      msgEl.textContent = "Keep studying! Score at least 3/5 to continue.";
    }
  }

  // Show/hide continue button based on passing
  if (continueBtn) {
    continueBtn.style.display = passed ? 'inline-block' : 'none';
  }
  if (passingNote) {
    passingNote.style.display = passed ? 'none' : 'block';
  }
}

(window as any).restartShingleGame = function() {
  initShingleGame();
};

// --- Module 7: Damage Identification Hotspot Quiz ---
function initDamageHotspotQuiz() {
  console.log('🎯 Initializing Damage Hotspot Quiz...');

  // Wait for images to be in DOM (module content may still be rendering)
  setTimeout(() => {
    // Quiz state management
    const quizState = {
      currentQuestion: 1,
      totalQuestions: 3,
      foundHotspots: new Set(),
      totalScore: 0,
      totalPossible: 9,
      showGuides: {
        q1: false,
        q2: false,
        q3: false
      },
      questionStats: {
        q1: { correct: 0, incorrect: 0 },
        q2: { correct: 0, incorrect: 0 },
        q3: { correct: 0, incorrect: 0 }
      }
    };

    // Initialize all quiz images
    const quizImages = document.querySelectorAll('.clickable-quiz-image');
    console.log(`🔍 Found ${quizImages.length} clickable quiz images`);

    if (quizImages.length === 0) {
      console.error('❌ No quiz images found! Module content may not be visible yet.');
      return;
    }

    quizImages.forEach((img, index) => {
      console.log(`✅ Image ${index + 1}: ${img.src}`);
      img.addEventListener('click', (e) => handleHotspotClick(e, img));
      img.style.cursor = 'crosshair';

    // Touch-specific handling
    img.addEventListener('touchstart', (e) => {
      e.preventDefault(); // Prevent zoom/scroll

      // Show flash feedback on touch
      const flash = document.createElement('div');
      flash.className = 'touch-flash';
      const rect = img.getBoundingClientRect();
      flash.style.left = `${((e.touches[0].clientX - rect.left) / rect.width) * 100}%`;
      flash.style.top = `${((e.touches[0].clientY - rect.top) / rect.height) * 100}%`;
      img.closest('.quiz-image-container').querySelector('.hotspot-markers').appendChild(flash);

      setTimeout(() => flash.remove(), 300);
    });

    img.addEventListener('touchend', (e) => {
      // Convert touch to click event
      if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        const clickEvent = new MouseEvent('click', {
          clientX: touch.clientX,
          clientY: touch.clientY,
          bubbles: true
        });
        handleHotspotClick(clickEvent, img);
        }
      });
    });

    // Initialize hint buttons
    const hintButtons = document.querySelectorAll('.btn-hint');
    hintButtons.forEach(btn => {
      btn.addEventListener('click', function() {
        const question = this.closest('.hotspot-quiz-question');
        const hint = question.querySelector('.quiz-hint');
        if (hint) {
          hint.style.display = hint.style.display === 'none' ? 'block' : 'none';
        }
      });
    });

    // Initialize toggle guides buttons
    const toggleGuideButtons = document.querySelectorAll('.btn-toggle-guides');
    toggleGuideButtons.forEach(btn => {
      btn.addEventListener('click', function() {
        const questionNum = this.getAttribute('data-question');
        const question = this.closest('.hotspot-quiz-question');
        const guidesContainer = question.querySelector('.hotspot-guides');
        const qKey = `q${questionNum}`;

        // Toggle state
        quizState.showGuides[qKey] = !quizState.showGuides[qKey];

        // Update button text
        this.textContent = quizState.showGuides[qKey]
          ? 'Hide Hotspot Zones'
          : 'Show Hotspot Zones';

        // Render or clear guides
        if (quizState.showGuides[qKey]) {
          renderHotspotGuides(question, guidesContainer);
        } else {
          guidesContainer.innerHTML = '';
        }
      });
    });

    // Initialize reset buttons
    const resetButtons = document.querySelectorAll('.btn-reset');
    resetButtons.forEach(btn => {
      btn.addEventListener('click', function() {
        const question = this.closest('.hotspot-quiz-question');
        resetQuestion(question, quizState);
      });
    });

    // Initialize next buttons
    const nextButtons = document.querySelectorAll('.btn-next');
    nextButtons.forEach(btn => {
      btn.addEventListener('click', function() {
        const currentQ = parseInt(quizState.currentQuestion);
        if (currentQ < quizState.totalQuestions) {
          showNextQuestion(currentQ, quizState);
        }
      });
    });

    // Initialize complete button
    const completeButton = document.querySelector('.btn-complete');
    if (completeButton) {
      completeButton.addEventListener('click', () => completeQuiz(quizState));
    }

    // Initialize restart button
    const restartButton = document.querySelector('.btn-restart-quiz');
    if (restartButton) {
      restartButton.addEventListener('click', () => restartQuiz(quizState));
    }

    console.log(`✅ Damage Hotspot Quiz initialized with ${quizImages.length} interactive images`);
  }, 100); // 100ms delay to ensure DOM is ready
}

// Handle click on quiz image
function handleHotspotClick(event, imageElement) {
  const rect = imageElement.getBoundingClientRect();
  const clickX = ((event.clientX - rect.left) / rect.width) * 100;
  const clickY = ((event.clientY - rect.top) / rect.height) * 100;

  const hotspotsData = imageElement.getAttribute('data-hotspots');
  const totalSpots = parseInt(imageElement.getAttribute('data-total-spots'));
  const question = imageElement.closest('.hotspot-quiz-question');
  const questionNum = question.getAttribute('data-question');
  const qKey = `q${questionNum}`;
  const markersContainer = question.querySelector('.hotspot-markers');

  if (!hotspotsData) return;

  // Parse hotspots: "x,y,radius;x,y,radius;..."
  const hotspots = hotspotsData.split(';').map(spot => {
    const [x, y, radius] = spot.split(',').map(Number);
    return { x, y, radius };
  });

  let hitDetected = false;
  let isDuplicate = false;

  // Detect if touch device and add tolerance bonus
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const touchBonus = isTouchDevice ? 3 : 0; // 3% extra radius on touch devices

  // Check each hotspot for collision
  for (let i = 0; i < hotspots.length; i++) {
    const spot = hotspots[i];
    const distance = Math.sqrt(
      Math.pow(clickX - spot.x, 2) + Math.pow(clickY - spot.y, 2)
    );

    if (distance <= (spot.radius + touchBonus)) {
      hitDetected = true;
      const spotId = `q${questionNum}-spot${i}`;

      // Check if already found
      const existingMarker = markersContainer.querySelector(`[data-hotspot-id="${spotId}"]`);
      if (existingMarker) {
        isDuplicate = true;
        // Show duplicate marker (orange recycle symbol)
        const duplicateMarker = document.createElement('div');
        duplicateMarker.className = 'hotspot-marker duplicate';
        duplicateMarker.innerHTML = '<span style="font-size: 24px; color: #ff9800;">⟳</span>';
        duplicateMarker.style.left = `${clickX}%`;
        duplicateMarker.style.top = `${clickY}%`;
        duplicateMarker.style.transform = 'translate(-50%, -50%)';
        markersContainer.appendChild(duplicateMarker);

        setTimeout(() => duplicateMarker.remove(), 1000);
      } else {
        // NEW HIT - Track as correct
        if (quizState.questionStats) {
          quizState.questionStats[qKey].correct++;
        }

        // Show correct marker (green checkmark)
        const correctMarker = document.createElement('div');
        correctMarker.className = 'hotspot-marker correct';
        correctMarker.setAttribute('data-hotspot-id', spotId);
        correctMarker.innerHTML = '<span style="font-size: 28px; color: #4caf50;">✓</span>';
        correctMarker.style.left = `${spot.x}%`;
        correctMarker.style.top = `${spot.y}%`;
        correctMarker.style.transform = 'translate(-50%, -50%)';
        markersContainer.appendChild(correctMarker);

        // Update found count
        const foundCountEl = question.querySelector('.found-count');
        const currentCount = parseInt(foundCountEl.textContent);
        foundCountEl.textContent = currentCount + 1;

        // Check if all spots found
        if (currentCount + 1 === totalSpots) {
          question.querySelector('.btn-next, .btn-complete').style.display = 'inline-block';
          setTimeout(() => {
            alert(`🎉 Excellent! You found all ${totalSpots} damage spots!`);
          }, 300);
        }
      }
      break;
    }
  }

  // INCORRECT CLICK - Track and show miss marker
  if (!hitDetected) {
    if (quizState.questionStats) {
      quizState.questionStats[qKey].incorrect++;
    }

    // Show incorrect marker (red X)
    const incorrectMarker = document.createElement('div');
    incorrectMarker.className = 'hotspot-marker incorrect';
    incorrectMarker.innerHTML = '<span style="font-size: 24px; color: #f44336;">✗</span>';
    incorrectMarker.style.left = `${clickX}%`;
    incorrectMarker.style.top = `${clickY}%`;
    incorrectMarker.style.transform = 'translate(-50%, -50%)';
    markersContainer.appendChild(incorrectMarker);

    setTimeout(() => incorrectMarker.remove(), 1500);
  }

  // Update accuracy display
  if (quizState.questionStats) {
    updateAccuracyDisplay(question, qKey);
  }
}

// Calculate distance between two points
function calculateDistance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

// Render semi-transparent guide circles
function renderHotspotGuides(questionElement, guidesContainer) {
  const imageElement = questionElement.querySelector('.clickable-quiz-image');
  const hotspotsData = imageElement.getAttribute('data-hotspots');

  if (!hotspotsData) return;

  // Clear existing guides
  guidesContainer.innerHTML = '';

  // Parse and render each hotspot zone
  const hotspots = hotspotsData.split(';').map(spot => {
    const [x, y, radius] = spot.split(',').map(Number);
    return { x, y, radius };
  });

  hotspots.forEach((spot, index) => {
    const guideCircle = document.createElement('div');
    guideCircle.className = 'guide-circle';
    guideCircle.style.left = `${spot.x}%`;
    guideCircle.style.top = `${spot.y}%`;
    guideCircle.style.width = `${spot.radius * 2}%`;
    guideCircle.style.height = `${spot.radius * 2}%`;
    guideCircle.style.animationDelay = `${index * 0.2}s`;
    guidesContainer.appendChild(guideCircle);
  });
}

// Update accuracy display for current question
function updateAccuracyDisplay(questionElement, qKey) {
  const stats = quizState.questionStats[qKey];
  const totalClicks = stats.correct + stats.incorrect;
  const accuracy = totalClicks > 0
    ? Math.round((stats.correct / totalClicks) * 100)
    : 100;

  // Find or create accuracy display element
  let accuracyEl = questionElement.querySelector('.quiz-accuracy');
  if (!accuracyEl) {
    accuracyEl = document.createElement('p');
    accuracyEl.className = 'quiz-accuracy';
    const feedbackDiv = questionElement.querySelector('.quiz-feedback');
    const scoreEl = feedbackDiv.querySelector('.quiz-score');
    scoreEl.after(accuracyEl);
  }

  // Update display
  if (totalClicks > 0) {
    accuracyEl.innerHTML = `Accuracy: <strong>${accuracy}%</strong> (${stats.correct} correct, ${stats.incorrect} incorrect)`;
    accuracyEl.style.color = accuracy >= 70 ? '#4caf50' : accuracy >= 50 ? '#ff9800' : '#f44336';
  } else {
    accuracyEl.textContent = '';
  }
}

// Show next question
function showNextQuestion(currentQuestionNum, quizState) {
  const currentQuestion = document.querySelector(`.hotspot-quiz-question[data-question="${currentQuestionNum}"]`);
  const nextQuestion = document.querySelector(`.hotspot-quiz-question[data-question="${currentQuestionNum + 1}"]`);

  if (currentQuestion) currentQuestion.style.display = 'none';
  if (nextQuestion) nextQuestion.style.display = 'block';

  quizState.currentQuestion = currentQuestionNum + 1;

  // Scroll to top of quiz
  nextQuestion?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Reset question
function resetQuestion(questionElement, quizState) {
  const questionNum = questionElement.getAttribute('data-question');
  const qKey = `q${questionNum}`;
  const markersContainer = questionElement.querySelector('.hotspot-markers');
  const guidesContainer = questionElement.querySelector('.hotspot-guides');
  const foundCountElement = questionElement.querySelector('.found-count');
  const hintElement = questionElement.querySelector('.quiz-hint');
  const nextButton = questionElement.querySelector('.btn-next, .btn-complete');
  const toggleBtn = questionElement.querySelector('.btn-toggle-guides');

  // Reset stats
  if (quizState.questionStats) {
    quizState.questionStats[qKey] = { correct: 0, incorrect: 0 };
  }

  // Clear all markers
  if (markersContainer) markersContainer.innerHTML = '';

  // Clear guides
  if (guidesContainer) guidesContainer.innerHTML = '';

  // Reset guide state and toggle button
  if (quizState.showGuides) {
    quizState.showGuides[qKey] = false;
  }
  if (toggleBtn) {
    toggleBtn.textContent = 'Show Hotspot Zones';
  }

  // Reset found count
  if (foundCountElement) foundCountElement.textContent = '0';

  // Clear accuracy display
  const accuracyEl = questionElement.querySelector('.quiz-accuracy');
  if (accuracyEl) accuracyEl.textContent = '';

  // Hide hint
  if (hintElement) hintElement.style.display = 'none';

  // Hide next button
  if (nextButton) nextButton.style.display = 'none';
}

// Complete quiz
function completeQuiz(quizState) {
  // Hide all questions
  document.querySelectorAll('.hotspot-quiz-question').forEach(q => {
    q.style.display = 'none';
  });

  // Calculate total stats
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let totalFound = 0;

  document.querySelectorAll('.found-count').forEach(el => {
    totalFound += parseInt(el.textContent);
  });

  if (quizState.questionStats) {
    Object.values(quizState.questionStats).forEach(stats => {
      totalCorrect += stats.correct;
      totalIncorrect += stats.incorrect;
    });
  }

  const totalClicks = totalCorrect + totalIncorrect;
  const overallAccuracy = totalClicks > 0
    ? Math.round((totalCorrect / totalClicks) * 100)
    : 100;
  const completionRate = Math.round((totalFound / quizState.totalPossible) * 100);

  // Update final score display (with null checks)
  const finalScoreDisplay = document.getElementById('final-score');
  const totalPossibleDisplay = document.getElementById('total-possible');
  if (finalScoreDisplay) finalScoreDisplay.textContent = String(totalFound);
  if (totalPossibleDisplay) totalPossibleDisplay.textContent = String(quizState.totalPossible);

  // Add accuracy information (with null checks)
  const finalScoreEl = document.querySelector('.final-score');
  let accuracyInfo = document.getElementById('accuracy-info');
  if (!accuracyInfo) {
    accuracyInfo = document.createElement('p');
    accuracyInfo.id = 'accuracy-info';
    accuracyInfo.className = 'accuracy-info';
    if (finalScoreEl) finalScoreEl.after(accuracyInfo);
  }

  if (accuracyInfo) {
    accuracyInfo.innerHTML = `
      <strong>Overall Accuracy:</strong> ${overallAccuracy}%<br>
      <small>(${totalCorrect} correct clicks, ${totalIncorrect} incorrect clicks)</small>
    `;
  }

  // Show completion message with performance feedback (with null checks)
  const banner = document.querySelector('.success-banner');
  let feedbackMsg: Element | null = null;
  if (banner) {
    feedbackMsg = banner.querySelector('.performance-feedback');
    if (!feedbackMsg) {
      feedbackMsg = document.createElement('p');
      feedbackMsg.className = 'performance-feedback';
      banner.appendChild(feedbackMsg);
    }
  }

  // Performance feedback based on completion AND accuracy (with null check)
  if (feedbackMsg) {
    if (completionRate === 100 && overallAccuracy >= 80) {
      feedbackMsg.innerHTML = '🏆 <strong>Perfect performance!</strong> You have excellent damage identification skills with great accuracy.';
    } else if (completionRate >= 80 && overallAccuracy >= 70) {
      feedbackMsg.innerHTML = '🌟 <strong>Great job!</strong> You identified most damage with good accuracy. Review any missed spots.';
    } else if (completionRate >= 60 && overallAccuracy >= 60) {
      feedbackMsg.innerHTML = '👍 <strong>Good effort!</strong> Review the images again to improve precision and coverage.';
    } else {
      feedbackMsg.innerHTML = '📚 <strong>Keep practicing!</strong> Review the damage types and practice identifying key patterns.';
    }
  }

  const quizCompleteMsg = document.getElementById('quiz-complete-message');
  if (quizCompleteMsg) {
    quizCompleteMsg.style.display = 'block';
    quizCompleteMsg.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Mark quiz as passed in engagement state
  markQuizPassed('damage-identification');

  // Mark the damage identification module as complete
  completeModule('damage-identification');
}

// Restart quiz
function restartQuiz(quizState) {
  // Reset state
  quizState.currentQuestion = 1;
  quizState.foundHotspots.clear();
  quizState.totalScore = 0;
  quizState.showGuides = { q1: false, q2: false, q3: false };
  quizState.questionStats = {
    q1: { correct: 0, incorrect: 0 },
    q2: { correct: 0, incorrect: 0 },
    q3: { correct: 0, incorrect: 0 }
  };

  // Hide completion message
  const completeMessage = document.getElementById('quiz-complete-message');
  if (completeMessage) {
    completeMessage.style.display = 'none';
    // Remove performance feedback
    const perfFeedback = completeMessage.querySelector('.performance-feedback');
    if (perfFeedback) perfFeedback.remove();
  }

  // Reset and show first question
  const questions = document.querySelectorAll('.hotspot-quiz-question');
  questions.forEach((q, index) => {
    resetQuestion(q, quizState);
    q.style.display = index === 0 ? 'block' : 'none';
  });

  // Scroll to quiz start
  const quizContainer = document.getElementById('hotspot-quiz-container');
  if (quizContainer) {
    quizContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ============================================================================
// AGNES-21 LIVE SESSION MANAGEMENT
// ============================================================================

// Update Agnes Live UI based on state
function updateAgnesLiveUI() {
  const connectionDot = document.getElementById('agnes-connection-dot');
  if (connectionDot) {
    connectionDot.style.backgroundColor = agnesLiveState.isConnected ? '#4ade80' : '#ef4444';
    connectionDot.classList.toggle('connected', agnesLiveState.isConnected);
  }

  const muteBtn = document.getElementById('agnes-mute-btn');
  if (muteBtn) {
    muteBtn.innerHTML = agnesLiveState.isMuted ? '🔇 Unmute' : '🎤 Mute';
    muteBtn.classList.toggle('muted', agnesLiveState.isMuted);
  }

  const videoBtn = document.getElementById('agnes-video-btn');
  if (videoBtn) {
    videoBtn.innerHTML = agnesLiveState.isVideoEnabled ? '📹 Hide Video' : '📹 Show Video';
  }

  const statusText = document.getElementById('agnes-status-text');
  if (statusText) {
    if (agnesLiveState.aiSpeaking) {
      statusText.textContent = 'Agnes is speaking...';
      statusText.className = 'agnes-status speaking';
    } else if (agnesLiveState.isSpeaking) {
      statusText.textContent = 'Listening to you...';
      statusText.className = 'agnes-status listening';
    } else if (agnesLiveState.isConnected) {
      statusText.textContent = 'Ready - Start speaking!';
      statusText.className = 'agnes-status ready';
    } else {
      statusText.textContent = 'Connecting...';
      statusText.className = 'agnes-status connecting';
    }
  }

  const recordingIndicator = document.getElementById('agnes-recording-indicator');
  if (recordingIndicator) {
    recordingIndicator.style.display = agnesMediaRecorder?.state === 'recording' ? 'flex' : 'none';
  }

  // Toggle speaking animation on the avatar orb
  const agnesAvatar = document.querySelector('.agnes-avatar');
  if (agnesAvatar) {
    agnesAvatar.classList.toggle('speaking', agnesLiveState.aiSpeaking);
  }

  // Show/hide speaking indicator text
  const speakingIndicator = document.getElementById('agnes-speaking-indicator');
  if (speakingIndicator) {
    speakingIndicator.classList.toggle('visible', agnesLiveState.aiSpeaking);
  }
}

// Analyze voice transcript for live feedback
function analyzeVoiceTranscript() {
  const feedbackPanel = document.getElementById('voice-live-feedback');
  if (!feedbackPanel) return;

  // Get user messages only
  const userMessages = agnesLiveState.transcript
    .filter(msg => msg.role === 'user')
    .map(msg => msg.text)
    .join(' ');

  if (!userMessages || userMessages.length < 10) {
    feedbackPanel.style.display = 'none';
    return;
  }

  // Show the panel
  feedbackPanel.style.display = 'block';

  // Key points to check for
  const keyPoints = [
    { name: 'Introduction', patterns: ['my name is', 'i\'m', 'hi', 'hello', 'good morning', 'good afternoon'] },
    { name: 'Urgency', patterns: ['today', 'now', 'immediately', 'soon', 'right away', 'before', 'storm', 'deadline'] },
    { name: 'Evidence', patterns: ['damage', 'photo', 'picture', 'found', 'discovered', 'see', 'look', 'hail', 'wind'] },
    { name: 'Insurance benefits', patterns: ['insurance', 'claim', 'covered', 'deductible', 'policy', 'no cost', 'free'] },
    { name: 'Next steps', patterns: ['file', 'claim', 'schedule', 'call', 'adjuster', 'sign', 'agreement', 'contract'] }
  ];

  const lowerText = userMessages.toLowerCase();
  let coveredCount = 0;

  // Update key points checklist
  const checklistContainer = document.getElementById('voice-key-points');
  if (checklistContainer) {
    checklistContainer.innerHTML = keyPoints.map(kp => {
      const covered = kp.patterns.some(p => lowerText.includes(p));
      if (covered) coveredCount++;
      return `
        <div class="kp-item ${covered ? 'covered' : 'pending'}">
          <span class="kp-check">${covered ? '✓' : '○'}</span> ${kp.name}
        </div>
      `;
    }).join('');
  }

  // Calculate and display score
  const scoreEl = document.getElementById('voice-live-score');
  if (scoreEl) {
    const score = Math.round((coveredCount / keyPoints.length) * 100);
    scoreEl.textContent = `${score}%`;
    scoreEl.style.color = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  }

  // Tone analysis
  const toneEl = document.getElementById('voice-tone-feedback');
  if (toneEl) {
    const wordCount = userMessages.split(/\s+/).length;
    const hasQuestions = (userMessages.match(/\?/g) || []).length;
    const hasExclamations = (userMessages.match(/!/g) || []).length;

    let toneAnalysis = '';
    if (wordCount < 20) {
      toneAnalysis = 'Keep going! Add more detail to your pitch.';
    } else if (hasQuestions > 2) {
      toneAnalysis = '👍 Good use of questions to engage the homeowner.';
    } else if (hasExclamations > 1) {
      toneAnalysis = '⚡ Enthusiastic tone detected - keep the energy!';
    } else {
      toneAnalysis = '📢 Try varying your tone and asking questions.';
    }
    toneEl.textContent = toneAnalysis;
  }

  // Show tips based on what's missing
  const tipEl = document.getElementById('voice-live-tip');
  if (tipEl) {
    const missingPoints = keyPoints.filter(kp => !kp.patterns.some(p => lowerText.includes(p)));
    if (missingPoints.length > 0 && missingPoints.length < 5) {
      tipEl.style.display = 'block';
      const tipText = tipEl.querySelector('.tip-text');
      if (tipText) {
        tipText.textContent = `Try mentioning: ${missingPoints.slice(0, 2).map(p => p.name).join(', ')}`;
      }
    } else {
      tipEl.style.display = 'none';
    }
  }
}

// Update transcript display
function updateAgnesTranscriptDisplay() {
  const container = document.getElementById('agnes-transcript');
  if (!container) return;

  // Process transcript to extract rep summaries from Agnes messages
  let processedMessages: { role: string; text: string; isRepSummary?: boolean }[] = [];

  agnesLiveState.transcript.forEach(msg => {
    if (msg.role === 'agnes') {
      // Check for [Rep: ...] summary at the start
      const repMatch = msg.text.match(/^\[Rep:\s*([^\]]+)\]/i);
      if (repMatch) {
        // Add the rep summary as a "You" message
        processedMessages.push({
          role: 'user',
          text: repMatch[1].trim(),
          isRepSummary: true
        });
        // Add Agnes's response (without the [Rep: ...] part)
        const agnesText = msg.text.replace(/^\[Rep:[^\]]+\]\s*/i, '').trim();
        if (agnesText) {
          processedMessages.push({
            role: 'agnes',
            text: agnesText
          });
        }
      } else {
        processedMessages.push(msg);
      }
    } else {
      processedMessages.push(msg);
    }
  });

  container.innerHTML = processedMessages.map(msg => `
    <div class="transcript-message ${msg.role === 'agnes' ? 'agnes-msg' : 'user-msg'}${msg.isRepSummary ? ' rep-summary' : ''}">
      <span class="msg-role">${msg.role === 'agnes' ? 'Agnes' : 'You'}:</span>
      <span class="msg-text">${msg.text}</span>
    </div>
  `).join('');

  container.scrollTop = container.scrollHeight;

  // Update live feedback whenever transcript changes
  analyzeVoiceTranscript();
}

// Play audio chunk from Gemini
async function playAgnesAudioChunk(base64Audio: string) {
  if (!agnesLiveState.sessionActive || !agnesOutputAudioContext) return;
  if (agnesOutputAudioContext.state === 'closed') return;

  try {
    const audioBuffer = await decodeAudioDataPCM(base64ToUint8Array(base64Audio), agnesOutputAudioContext);
    const source = agnesOutputAudioContext.createBufferSource();
    source.buffer = audioBuffer;

    if (agnesAnalyserNode) {
      source.connect(agnesAnalyserNode);
    } else {
      source.connect(agnesOutputAudioContext.destination);
    }

    const currentTime = agnesOutputAudioContext.currentTime;
    if (agnesNextStartTime < currentTime) {
      agnesNextStartTime = currentTime;
    }

    source.start(agnesNextStartTime);
    agnesNextStartTime += audioBuffer.duration;

    agnesLiveState.aiSpeaking = true;
    updateAgnesLiveUI();

    source.onended = () => {
      agnesAudioSources.delete(source);
      if (agnesAudioSources.size === 0) {
        agnesLiveState.aiSpeaking = false;
        updateAgnesLiveUI();
      }
    };
    agnesAudioSources.add(source);
  } catch (error) {
    console.error('Error playing audio chunk:', error);
  }
}

// Start audio input to Gemini
function startAgnesAudioInput() {
  if (!agnesInputAudioContext || !agnesMediaStream) return;

  const source = agnesInputAudioContext.createMediaStreamSource(agnesMediaStream);
  const processor = agnesInputAudioContext.createScriptProcessor(4096, 1, 1);

  agnesMicAnalyserNode = agnesInputAudioContext.createAnalyser();
  agnesMicAnalyserNode.fftSize = 256;
  source.connect(agnesMicAnalyserNode);

  processor.onaudioprocess = (e) => {
    if (agnesLiveState.isMuted || !agnesLiveState.sessionActive) return;

    const inputData = e.inputBuffer.getChannelData(0);
    const pcmBlob = createPcmBlob(inputData);

    if (agnesSessionPromise) {
      agnesSessionPromise.then(session => {
        // Double-check session is still active before sending
        if (!agnesLiveState.sessionActive) return;
        try {
          session.sendRealtimeInput({ media: pcmBlob });
        } catch (e) {
          // Ignore WebSocket errors during session close
        }
      });
    }
  };

  source.connect(processor);
  processor.connect(agnesInputAudioContext.destination);

  startAgnesVoiceActivityDetection();
}

// Voice activity detection
function startAgnesVoiceActivityDetection() {
  const checkVoiceActivity = () => {
    if (!agnesMicAnalyserNode || !agnesLiveState.sessionActive) return;

    const dataArray = new Uint8Array(agnesMicAnalyserNode.frequencyBinCount);
    agnesMicAnalyserNode.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const VOICE_THRESHOLD = 15;

    const wasSpeaking = agnesLiveState.isSpeaking;
    agnesLiveState.isSpeaking = average > VOICE_THRESHOLD && !agnesLiveState.isMuted;

    if (wasSpeaking !== agnesLiveState.isSpeaking) {
      updateAgnesLiveUI();
    }

    if (agnesLiveState.sessionActive) {
      requestAnimationFrame(checkVoiceActivity);
    }
  };

  checkVoiceActivity();
}

// Start video input to Gemini
function startAgnesVideoInput() {
  const FPS = 1;
  const videoEl = document.getElementById('agnes-video-preview') as HTMLVideoElement;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx || !videoEl) return;

  agnesFrameIntervalId = window.setInterval(async () => {
    if (!agnesLiveState.isVideoEnabled || !agnesSessionPromise || !agnesLiveState.sessionActive) return;

    canvas.width = videoEl.videoWidth / 4;
    canvas.height = videoEl.videoHeight / 4;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async (blob) => {
      if (blob && agnesSessionPromise && agnesLiveState.sessionActive) {
        const base64Data = await blobToBase64(blob);
        agnesSessionPromise.then(session => {
          // Double-check session is still active before sending
          if (!agnesLiveState.sessionActive) return;
          try {
            session.sendRealtimeInput({
              media: {
                mimeType: 'image/jpeg',
                data: base64Data
              }
            });
          } catch (e) {
            // Ignore WebSocket errors during session close
          }
        });
      }
    }, 'image/jpeg', 0.5);
  }, 1000 / FPS);
}

// Start video recording
function startAgnesRecording() {
  if (!agnesMediaStream) return;

  const mimeType = getSupportedVideoMimeType();

  try {
    agnesMediaRecorder = new MediaRecorder(agnesMediaStream, {
      mimeType,
      videoBitsPerSecond: 2500000
    });
  } catch (e) {
    console.warn('MediaRecorder not supported with mimeType:', mimeType);
    return;
  }

  agnesRecordedChunks = [];

  agnesMediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      agnesRecordedChunks.push(e.data);
    }
  };

  agnesMediaRecorder.onstart = () => {
    updateAgnesLiveUI();
  };

  agnesMediaRecorder.onstop = () => {
    updateAgnesLiveUI();
  };

  agnesMediaRecorder.start(1000);
}

// Stop video recording
async function stopAgnesRecording(): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!agnesMediaRecorder || agnesMediaRecorder.state === 'inactive') {
      resolve(null);
      return;
    }

    agnesMediaRecorder.onstop = () => {
      if (agnesRecordedChunks.length > 0) {
        const blob = new Blob(agnesRecordedChunks, { type: getSupportedVideoMimeType() });
        resolve(blob);
      } else {
        resolve(null);
      }
      updateAgnesLiveUI();
    };

    agnesMediaRecorder.stop();
  });
}

// Initialize Agnes Live Session
async function initAgnesLiveSession() {
  try {
    // Build system instruction first
    const script = AGNES_TRAINING_SCRIPTS[agnesLiveState.selectedRole || 'door-knock'] || AGNES_TRAINING_SCRIPTS['door-knock'];
    const systemInstruction = buildAgnesSystemInstruction(agnesLiveState.difficulty, script);

    // Fetch ephemeral token from server (required for browser-based Live API)
    console.log('Fetching ephemeral token from server...');
    let tokenData: { token: string; expireTime: string } | null = null;
    try {
      const tokenResponse = await fetch('/api/ai/gemini-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction })
      });
      if (tokenResponse.ok) {
        tokenData = await tokenResponse.json();
        console.log('Ephemeral token received, expires:', tokenData.expireTime);
      } else {
        const errorData = await tokenResponse.json();
        console.warn('Token endpoint failed:', errorData);
      }
    } catch (tokenErr) {
      console.warn('Could not fetch ephemeral token, falling back to API key:', tokenErr);
    }

    // Use ephemeral token if available, otherwise fall back to API key
    const apiKey = tokenData?.token || rawApiKey;
    if (!apiKey) {
      showAgnesError('AI connection not available. Please check server configuration.');
      return;
    }

    // Create client with the token/key
    // Ephemeral tokens require v1alpha API version
    const clientConfig: any = { apiKey };
    if (tokenData?.token) {
      clientConfig.httpOptions = { apiVersion: 'v1alpha' };
    }
    agnesAiClient = new GoogleGenAI(clientConfig);
    agnesLiveState.sessionActive = true;
    agnesLiveState.sessionStartTime = Date.now();
    agnesLiveState.transcript = [];
    agnesLiveState.currentScore = null;
    agnesLiveState.mistakeCount = 0;

    // Track roleplay session in API - await to ensure sessionId is set before session ends
    await startRoleplaySessionAPI(
      agnesLiveState.selectedRole || 'default',
      agnesLiveState.difficulty,
      agnesLiveState.inputMode
    );

    // Request media permissions
    agnesMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: agnesLiveState.isVideoEnabled ? { width: 640, height: 480 } : false
    });

    // Setup video preview
    const videoEl = document.getElementById('agnes-video-preview') as HTMLVideoElement;
    if (videoEl && agnesLiveState.isVideoEnabled) {
      videoEl.srcObject = agnesMediaStream;
      videoEl.play().catch(() => {});
    }

    // Setup audio contexts
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    agnesInputAudioContext = new AudioContextClass({ sampleRate: 16000 });
    agnesOutputAudioContext = new AudioContextClass({ sampleRate: 24000 });

    // Setup analyser for AI voice
    agnesAnalyserNode = agnesOutputAudioContext.createAnalyser();
    agnesAnalyserNode.fftSize = 256;
    agnesAnalyserNode.connect(agnesOutputAudioContext.destination);

    // Connect to Gemini Live (config is baked into the token if using ephemeral token)
    const connectConfig = tokenData ? {
      // When using ephemeral token, config is already in the token
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      callbacks: {
        onopen: () => {
          console.log('Agnes Live Session Connected');
          agnesLiveState.isConnected = true;
          updateAgnesLiveUI();
          startAgnesAudioInput();
          if (agnesLiveState.isVideoEnabled) {
            startAgnesVideoInput();
          }
          startAgnesRecording();
        },
        onmessage: async (message: any) => {
          await handleAgnesMessage(message);
        },
        onclose: () => {
          console.log('Agnes Live Session Closed');
          agnesLiveState.isConnected = false;
          updateAgnesLiveUI();
        },
        onerror: (err: any) => {
          console.error('Agnes Live Error:', err);
          showAgnesError('Connection error. Please restart the session.');
        }
      }
    } : {
      // Fallback with full config when using API key directly
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      callbacks: {
        onopen: () => {
          console.log('Agnes Live Session Connected');
          agnesLiveState.isConnected = true;
          updateAgnesLiveUI();
          startAgnesAudioInput();
          if (agnesLiveState.isVideoEnabled) {
            startAgnesVideoInput();
          }
          startAgnesRecording();
        },
        onmessage: async (message: any) => {
          await handleAgnesMessage(message);
        },
        onclose: () => {
          console.log('Agnes Live Session Closed');
          agnesLiveState.isConnected = false;
          updateAgnesLiveUI();
        },
        onerror: (err: any) => {
          console.error('Agnes Live Error:', err);
          showAgnesError('Connection error. Please restart the session.');
        }
      },
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
        },
        systemInstruction: systemInstruction,
      }
    };

    agnesSessionPromise = agnesAiClient.live.connect(connectConfig);

  } catch (err: any) {
    handleAgnesInitError(err);
  }
}

// Handle messages from Gemini
async function handleAgnesMessage(message: any) {
  const serverContent = message.serverContent;

  // Handle Interruption
  if (serverContent?.interrupted) {
    agnesAudioSources.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    agnesAudioSources.clear();
    agnesLiveState.aiSpeaking = false;
    agnesNextStartTime = 0;
    updateAgnesLiveUI();
    return;
  }

  // Handle Text Output
  const textContent = serverContent?.modelTurn?.parts?.[0]?.text;
  if (textContent) {
    // Parse score if present - check multiple formats the AI might return
    const scorePatterns = [
      /AGNES SCORE:?\s*(\d+)/i,                    // "AGNES SCORE: 85" or "AGNES SCORE 85"
      /(?:final\s+)?score:?\s*(\d+)\s*(?:\/\s*100)?/i,  // "Score: 85" or "Final Score: 85/100"
      /(\d+)\s*(?:\/\s*100|\s*out\s+of\s+100|\s*points)/i,  // "85/100" or "85 out of 100" or "85 points"
      /you(?:'ve)?\s+(?:scored|earned|got)\s+(\d+)/i  // "You scored 85" or "You've earned 85"
    ];

    let scoreMatch: RegExpMatchArray | null = null;
    for (const pattern of scorePatterns) {
      scoreMatch = textContent.match(pattern);
      if (scoreMatch) break;
    }

    if (scoreMatch) {
      const parsedScore = parseInt(scoreMatch[1]);
      // Validate score is in reasonable range (0-100)
      if (parsedScore >= 0 && parsedScore <= 100) {
        agnesLiveState.currentScore = parsedScore;
        // Show score UI
        const scoreDisplay = document.getElementById('agnes-score-display');
        if (scoreDisplay) {
          scoreDisplay.innerHTML = `<div class="final-score">${agnesLiveState.currentScore}/100</div>`;
          scoreDisplay.style.display = 'block';
        }
      }
    }

    // Check for door slam
    if (textContent.toLowerCase().includes('door slam') || textContent.includes('🚪💥')) {
      handleAgnesDoorSlam();
    }

    // Add to transcript
    agnesLiveState.transcript.push({
      role: 'agnes',
      text: textContent,
      timestamp: new Date()
    });
    updateAgnesTranscriptDisplay();
  }

  // Handle Audio Output
  const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
  if (base64Audio && agnesLiveState.sessionActive) {
    await playAgnesAudioChunk(base64Audio);
  }
}

// Handle door slam
function handleAgnesDoorSlam() {
  agnesLiveState.currentScore = 0;
  showAgnesDoorSlamModal();
}

// Show door slam modal
function showAgnesDoorSlamModal() {
  const modal = document.getElementById('agnes-door-slam-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

// Handle initialization errors
function handleAgnesInitError(err: any) {
  console.error('Agnes Init Error:', err);

  let errorMsg = 'Failed to initialize Agnes session.';
  if (err.name === 'NotAllowedError') {
    errorMsg = '🎤 Microphone/Camera access denied. Please enable permissions.';
  } else if (err.name === 'NotFoundError') {
    errorMsg = '🎤 No microphone or camera detected.';
  } else if (err.name === 'NotReadableError') {
    errorMsg = '🎥 Camera/mic is being used by another app.';
  } else if (err.message?.includes('API')) {
    errorMsg = '🌐 AI connection failed. Check your API key.';
  }

  showAgnesError(errorMsg);
}

// Show error message
function showAgnesError(message: string) {
  const errorDiv = document.getElementById('agnes-error');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
}

// End Agnes session
async function endAgnesSession(saveSession: boolean = true) {
  agnesLiveState.sessionActive = false;

  // Stop all audio sources
  agnesAudioSources.forEach(source => {
    try { source.stop(); } catch (e) {}
  });
  agnesAudioSources.clear();

  // Stop video recording and save
  const videoBlob = await stopAgnesRecording();

  if (saveSession && agnesLiveState.currentScore !== null) {
    const duration = Math.floor((Date.now() - agnesLiveState.sessionStartTime) / 1000);
    const sessionId = `agnes_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Save video to IndexedDB
    if (videoBlob) {
      await saveAgnesVideo({
        sessionId,
        recordedAt: new Date(agnesLiveState.sessionStartTime),
        duration,
        size: videoBlob.size,
        mimeType: videoBlob.type,
        videoBlob,
        metadata: {
          difficulty: agnesLiveState.difficulty,
          finalScore: agnesLiveState.currentScore
        }
      });
    }

    // Update streak
    const streakResult = updateAgnesStreak();

    // Calculate and award XP
    const xpEarned = calculateAgnesSessionXP(
      agnesLiveState.currentScore || 0,
      agnesLiveState.difficulty,
      streakResult.newStreak
    );
    const xpResult = awardAgnesXP(xpEarned);

    // Track session end in API (with error handling)
    try {
      await endRoleplaySessionAPI(
        currentRoleplaySessionId,
        agnesLiveState.currentScore || 0,
        xpEarned,
        false // Not a door slam if we're saving session
      );
    } catch (err) {
      console.error('Failed to save session to API:', err);
      // Continue anyway - local XP was already awarded
    }

    // Show success modal
    showAgnesSessionComplete(xpEarned, xpResult, streakResult);
  } else if (!saveSession) {
    // Track door slam or aborted session in API (with error handling)
    try {
      await endRoleplaySessionAPI(
        currentRoleplaySessionId,
        agnesLiveState.currentScore || 0,
        0,
        true // Door slammed or aborted
      );
    } catch (err) {
      console.error('Failed to save aborted session to API:', err);
    }
  }

  // Cleanup resources
  cleanupAgnesLive();
}

// Show session complete modal
function showAgnesSessionComplete(xpEarned: number, xpResult: any, streakResult: any) {
  const modal = document.getElementById('agnes-success-modal');
  if (!modal) return;

  // Mark role-play module as complete when a session is finished
  completeModule('role-play');

  const content = modal.querySelector('.modal-content');
  if (content) {
    content.innerHTML = `
      <h2>🎉 Session Complete!</h2>
      <div class="session-stats">
        <div class="stat"><span class="label">Score:</span> <span class="value">${agnesLiveState.currentScore}/100</span></div>
        <div class="stat"><span class="label">XP Earned:</span> <span class="value">+${xpEarned} XP</span></div>
        <div class="stat"><span class="label">Streak:</span> <span class="value">${streakResult.newStreak} days 🔥</span></div>
        ${xpResult.leveledUp ? `<div class="level-up">🎊 Level Up! Now Level ${xpResult.newLevel}!</div>` : ''}
        ${xpResult.newUnlocks.length > 0 ? `<div class="unlocks">${xpResult.newUnlocks.join('<br>')}</div>` : ''}
      </div>
      <button onclick="document.getElementById('agnes-success-modal').style.display='none'; showAgnesScreen('agnes-mode-selector');" class="btn-primary">Continue</button>
    `;
  }
  modal.style.display = 'flex';
}

// Cleanup Agnes Live resources
function cleanupAgnesLive() {
  if (agnesInputAudioContext && agnesInputAudioContext.state !== 'closed') {
    agnesInputAudioContext.close();
  }
  if (agnesOutputAudioContext && agnesOutputAudioContext.state !== 'closed') {
    agnesOutputAudioContext.close();
  }

  if (agnesMediaStream) {
    agnesMediaStream.getTracks().forEach(track => track.stop());
  }

  if (agnesFrameIntervalId) {
    clearInterval(agnesFrameIntervalId);
  }

  agnesInputAudioContext = null;
  agnesOutputAudioContext = null;
  agnesMediaStream = null;
  agnesSessionPromise = null;
  agnesAnalyserNode = null;
  agnesMicAnalyserNode = null;

  agnesLiveState.isConnected = false;
  agnesLiveState.aiSpeaking = false;
  agnesLiveState.isSpeaking = false;

  updateAgnesLiveUI();
}

// Show Agnes screen
function showAgnesScreen(screenId: string) {
  const screens = [
    'agnes-mode-selector',
    'agnes-training-type-selector',
    'agnes-input-mode-selector',
    'agnes-module-selector',
    'agnes-difficulty-selector',
    'agnes-voice-ui',
    'agnes-text-ui'
  ];

  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = id === screenId ? 'block' : 'none';
    }
  });
}
// Expose globally for HTML onclick handlers
(window as any).showAgnesScreen = showAgnesScreen;

// Render difficulty cards
function renderAgnesDifficultyCards() {
  const container = document.getElementById('agnes-difficulty-grid');
  if (!container) return;

  const progress = getAgnesUserProgress();

  const difficulties = [
    { id: 'BEGINNER', name: 'Beginner', icon: '🌱', color: '#22d3ee', desc: 'The Eager Learner' },
    { id: 'ROOKIE', name: 'Rookie', icon: '🏡', color: '#4ade80', desc: 'The Friendly Neighbor' },
    { id: 'PRO', name: 'Pro', icon: '👨‍👩‍👧', color: '#facc15', desc: 'The Busy Parent' },
    { id: 'ELITE', name: 'Elite', icon: '😠', color: '#ef4444', desc: 'The Skeptic' },
    { id: 'NIGHTMARE', name: 'Nightmare', icon: '⚖️', color: '#f97316', desc: 'The Lawyer' }
  ];

  container.innerHTML = difficulties.map(d => {
    const unlocked = isDifficultyUnlocked(d.id);
    const config = AGNES_DIFFICULTY_LEVELS[d.id];

    return `
      <button class="difficulty-card ${unlocked ? '' : 'locked'}"
              data-difficulty="${d.id}"
              ${unlocked ? '' : 'disabled'}
              style="border-color: ${unlocked ? d.color : '#666'}">
        <div class="difficulty-icon" style="color: ${d.color}">${d.icon}</div>
        <div class="difficulty-name">${d.name}</div>
        <div class="difficulty-desc">${d.desc}</div>
        <div class="difficulty-multiplier">${config.multiplier}x XP</div>
        ${!unlocked ? `<div class="unlock-req">🔒 Level ${config.unlockLevel}</div>` : ''}
      </button>
    `;
  }).join('');

  // Add click handlers
  container.querySelectorAll('.difficulty-card:not(.locked)').forEach(card => {
    card.addEventListener('click', () => {
      agnesLiveState.difficulty = (card as HTMLElement).dataset.difficulty || 'BEGINNER';

      // Pick a random scenario from the selected module
      if (agnesSessionConfig.selectedScenarios.length > 0) {
        const randomIndex = Math.floor(Math.random() * agnesSessionConfig.selectedScenarios.length);
        agnesSessionConfig.currentScenarioIndex = randomIndex;
      }

      console.log(`🎯 Starting ${agnesSessionConfig.trainingType} mode (${agnesSessionConfig.inputMode}) with difficulty ${agnesLiveState.difficulty}`);

      // Start the appropriate mode
      if (agnesSessionConfig.inputMode === 'voice') {
        showAgnesScreen('agnes-voice-ui');
        initAgnesLiveSession();
      } else {
        // Text mode - load scenarios and show text UI
        showAgnesScreen('agnes-text-ui');
        initRolePlayWithScenarios(agnesSessionConfig.selectedScenarios, agnesSessionConfig.trainingType);
      }
    });
  });

  // Render XP bar
  renderAgnesXPBar();
}

// Render XP progress bar
function renderAgnesXPBar() {
  const container = document.getElementById('agnes-xp-bar');
  if (!container) return;

  const progress = getAgnesUserProgress();
  const currentLevelXP = getXPForLevel(progress.currentLevel);
  const nextLevelXP = getXPForLevel(progress.currentLevel + 1);
  const xpInLevel = progress.totalXP - currentLevelXP;
  const xpNeeded = nextLevelXP - currentLevelXP;
  const percentage = Math.round((xpInLevel / xpNeeded) * 100);

  container.innerHTML = `
    <div class="xp-bar-container">
      <div class="xp-bar-fill" style="width: ${percentage}%"></div>
    </div>
    <div class="xp-label">
      <span>Level ${progress.currentLevel}</span>
      <span>${xpInLevel} / ${xpNeeded} XP</span>
    </div>
  `;
}

// Module to categories mapping (Module 8 only)
const moduleToCategories: Record<string, string[]> = {
  '8': ['inspection']
};

// Session state for the new simplified flow
let agnesSessionConfig = {
  trainingType: 'roleplay' as 'roleplay' | 'walkthrough',
  inputMode: 'voice' as 'voice' | 'text',
  selectedModule: '8' as string,
  selectedScenarios: [] as any[],
  currentScenarioIndex: 0
};

// Get scenarios for a module
function getScenariosForModule(moduleId: string): any[] {
  const categories = moduleToCategories[moduleId] || [];
  let scenarios: any[] = [];

  categories.forEach(cat => {
    const catScenarios = (window as any).getScenariosByCategory?.(cat) || [];
    scenarios = scenarios.concat(catScenarios);
  });

  return scenarios;
}

// Get random scenario from module
function getRandomScenarioFromModule(moduleId: string): any {
  const scenarios = getScenariosForModule(moduleId);
  if (scenarios.length === 0) return null;
  return scenarios[Math.floor(Math.random() * scenarios.length)];
}

// Initialize Agnes-21 Live Role-Play (NEW ENTRY POINT)
function initAgnesLiveRolePlay() {
  console.log('🎙️ Initializing Agnes-21 Live Role-Play System...');

  // Live role-play button (Module 8 only, voice only)
  const roleplayBtn = document.getElementById('agnes-roleplay-btn');
  roleplayBtn?.addEventListener('click', () => {
    agnesSessionConfig.trainingType = 'roleplay';
    agnesSessionConfig.inputMode = 'voice';
    agnesSessionConfig.selectedModule = '8';
    agnesSessionConfig.selectedScenarios = getScenariosForModule('8');

    // Default to beginner difficulty and start live session
    agnesLiveState.difficulty = 'BEGINNER';
    agnesLiveState.inputMode = 'voice';

    if (agnesSessionConfig.selectedScenarios.length > 0) {
      const randomIndex = Math.floor(Math.random() * agnesSessionConfig.selectedScenarios.length);
      agnesSessionConfig.currentScenarioIndex = randomIndex;
    }

    showAgnesScreen('agnes-voice-ui');
    initAgnesLiveSession();
  });

  // Setup control buttons in voice UI
  const muteBtn = document.getElementById('agnes-mute-btn');
  muteBtn?.addEventListener('click', () => {
    agnesLiveState.isMuted = !agnesLiveState.isMuted;
    updateAgnesLiveUI();
  });

  const videoBtn = document.getElementById('agnes-video-btn');
  videoBtn?.addEventListener('click', () => {
    agnesLiveState.isVideoEnabled = !agnesLiveState.isVideoEnabled;
    const videoEl = document.getElementById('agnes-video-preview') as HTMLVideoElement;
    if (videoEl) {
      videoEl.style.display = agnesLiveState.isVideoEnabled ? 'block' : 'none';
    }
    updateAgnesLiveUI();
  });

  const endBtn = document.getElementById('agnes-end-session-btn');
  endBtn?.addEventListener('click', () => {
    if (confirm('End this session and see your results?')) {
      // Send "score me" to get final score
      if (agnesSessionPromise) {
        agnesSessionPromise.then(session => {
          session.sendRealtimeInput({
            media: {
              mimeType: 'text/plain',
              data: btoa('Score me now and end the simulation.')
            }
          });

          // Smart wait: poll for score to be received, with max timeout
          const MAX_WAIT_MS = 15000; // 15 seconds max
          const POLL_INTERVAL_MS = 500; // Check every 500ms
          const startWait = Date.now();

          const waitForScore = () => {
            const elapsed = Date.now() - startWait;

            // If we received a score, end the session
            if (agnesLiveState.currentScore !== null) {
              console.log('✅ Score received, ending session');
              endAgnesSession(true);
              return;
            }

            // If max timeout reached, end anyway (AI might not have responded)
            if (elapsed >= MAX_WAIT_MS) {
              console.warn('⚠️ Max wait time reached without score, ending session');
              endAgnesSession(true);
              return;
            }

            // Keep polling
            setTimeout(waitForScore, POLL_INTERVAL_MS);
          };

          // Start polling after initial delay for AI to process
          setTimeout(waitForScore, 1000);
        });
      } else {
        endAgnesSession(false);
      }
    }
  });

  // Setup door slam modal close
  const doorSlamClose = document.getElementById('agnes-door-slam-close');
  doorSlamClose?.addEventListener('click', () => {
    document.getElementById('agnes-door-slam-modal')!.style.display = 'none';
    showAgnesScreen('agnes-mode-selector');
  });

  // No text-mode entry points for live-only mode.

  // NEW: In-session difficulty buttons handler
  function setupDifficultyButtons() {
    const difficultyBtns = document.querySelectorAll('.difficulty-btn');
    difficultyBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const difficulty = (btn as HTMLElement).dataset.difficulty;
        if (!difficulty) return;

        // Update visual state for all difficulty button groups
        document.querySelectorAll('.difficulty-btn').forEach(b => {
          const d = (b as HTMLElement).dataset.difficulty;
          if (d === difficulty) {
            // Make active
            if (d === 'easy') {
              (b as HTMLElement).style.background = '#10b981';
              (b as HTMLElement).style.color = 'white';
            } else if (d === 'medium') {
              (b as HTMLElement).style.background = '#f59e0b';
              (b as HTMLElement).style.color = 'white';
            } else if (d === 'hard') {
              (b as HTMLElement).style.background = '#ef4444';
              (b as HTMLElement).style.color = 'white';
            }
            b.classList.add('active');
          } else {
            // Make inactive
            const dOther = (b as HTMLElement).dataset.difficulty;
            if (dOther === 'easy') {
              (b as HTMLElement).style.background = 'white';
              (b as HTMLElement).style.color = '#10b981';
            } else if (dOther === 'medium') {
              (b as HTMLElement).style.background = 'white';
              (b as HTMLElement).style.color = '#f59e0b';
            } else if (dOther === 'hard') {
              (b as HTMLElement).style.background = 'white';
              (b as HTMLElement).style.color = '#ef4444';
            }
            b.classList.remove('active');
          }
        });

        // Map simple difficulty to internal difficulty levels
        const difficultyMap: Record<string, string> = {
          'easy': 'BEGINNER',
          'medium': 'PRO',
          'hard': 'ELITE'
        };
        agnesLiveState.difficulty = difficultyMap[difficulty] || 'BEGINNER';
        console.log(`🎚️ Difficulty changed to: ${difficulty} (${agnesLiveState.difficulty})`);
      });
    });
  }
  setupDifficultyButtons();

  // Show mode selector
  showAgnesScreen('agnes-mode-selector');
  console.log('✅ Agnes-21 Live Role-Play System initialized');
}

// --- New Simplified Text Mode Entry Point ---
function initRolePlayWithScenarios(scenarios: any[], trainingType: 'roleplay' | 'walkthrough') {
  console.log(`🎭 Starting ${trainingType} with ${scenarios.length} scenarios...`);

  if (!scenarios || scenarios.length === 0) {
    alert('No scenarios available for this module. Please try another.');
    showAgnesScreen('agnes-module-selector');
    return;
  }

  // Pick a random scenario
  const randomIndex = Math.floor(Math.random() * scenarios.length);
  const scenario = scenarios[randomIndex];

  // Store in window for access by existing functions
  (window as any)._agnesActiveScenarios = scenarios;
  (window as any)._agnesCurrentIndex = randomIndex;
  (window as any)._agnesTrainingType = trainingType;

  // Initialize the text roleplay system with these scenarios
  initRolePlay();

  // After init, directly load the scenario
  setTimeout(() => {
    // Find the internal state and set scenarios
    const textUI = document.getElementById('agnes-text-ui');
    if (textUI) {
      // Skip to personality selector with scenarios preloaded
      const personalitySelector = document.getElementById('personality-selector');
      const categorySelector = document.getElementById('category-selector');

      if (categorySelector) categorySelector.style.display = 'none';
      if (personalitySelector) personalitySelector.style.display = 'block';
    }
  }, 100);
}

// --- Agnes 21 Role-Play System (TEXT MODE - Original) ---
function initRolePlay() {
  console.log('🎭 Initializing Agnes Text Role-Play System...');

  // Verify that agnes-scenarios.js loaded successfully
  if (typeof getAllAgnesScenarios !== 'function') {
    console.error('❌ Agnes scenarios not loaded. Check that agnes-scenarios.js is included before index.tsx');
    alert('Error: Agnes scenario data not loaded. Please check browser console.');
    return;
  }

  if (typeof scoreResponse !== 'function') {
    console.error('❌ scoreResponse function not found. Check agnes-scenarios.js');
    alert('Error: Scoring function not available. Please check browser console.');
    return;
  }

  // Session state management
  const sessionState: {
    selectedRole: string | null;
    selectedCategory: string | null;
    selectedPersonality: string | null;
    difficulty: string;
    scenarios: any[];
    currentScenarioIndex: number;
    currentScenario: any;
    responses: any[];
    scores: any[];
    hintsUsed: number;
    startTime: number;
    recognition: any;
    scenarioStartTime: number | null;
    conversationHistory: Array<{ sender: 'user' | 'agnes', message: string, timestamp: number }>;
    currentTurn: number;
    maxTurns: number;
  } = {
    selectedRole: null,
    selectedCategory: null,
    selectedPersonality: null,
    difficulty: 'beginner',
    // Check for preloaded scenarios from simplified flow
    scenarios: (window as any)._agnesActiveScenarios || [],
    currentScenarioIndex: (window as any)._agnesCurrentIndex || 0,
    currentScenario: null,
    responses: [],
    scores: [],
    hintsUsed: 0,
    startTime: Date.now(),
    recognition: null,
    scenarioStartTime: null,
    conversationHistory: [],
    currentTurn: 1,
    maxTurns: 5
  };

  // Clear the window variables after use
  const hasPreloadedScenarios = (window as any)._agnesActiveScenarios?.length > 0;
  delete (window as any)._agnesActiveScenarios;
  delete (window as any)._agnesCurrentIndex;

  // Screen management functions
  function showScreen(screenId: string) {
    const screens = ['category-selector', 'scenario-list', 'roleplay-setup', 'personality-selector', 'scenario-display', 'feedback-area', 'session-summary'];
    screens.forEach(id => {
      const screen = document.getElementById(id);
      if (screen) {
        screen.style.display = (id === screenId) ? 'block' : 'none';
      }
    });
  }

  // Make showScreen accessible globally for onclick handlers
  (window as any).showAgnesTextScreen = showScreen;

  function showRoleSelection() {
    console.log('📋 Showing role selection');
    showScreen('roleplay-setup');
    sessionState.selectedRole = null;
    sessionState.scenarios = [];
    sessionState.currentScenarioIndex = 0;
    sessionState.responses = [];
    sessionState.scores = [];
    sessionState.hintsUsed = 0;
    sessionState.startTime = Date.now();
  }

  function loadScenario(index: number) {
    if (index < 0 || index >= sessionState.scenarios.length) return;
    sessionState.currentScenarioIndex = index;
    sessionState.currentScenario = sessionState.scenarios[index];
    sessionState.scenarioStartTime = Date.now();
    displayScenario(sessionState.currentScenario);
  }

  function displayScenario(scenario: any) {
    const titleEl = document.getElementById('scenario-title');
    const contextEl = document.getElementById('scenario-context');
    const promptEl = document.getElementById('agnes-prompt');
    const progressEl = document.getElementById('scenario-progress');
    const responseTextarea = document.getElementById('user-response') as HTMLTextAreaElement;
    const submitBtn = document.getElementById('submit-response') as HTMLButtonElement;

    if (titleEl) titleEl.textContent = scenario.id || `Scenario ${sessionState.currentScenarioIndex + 1}`;
    if (contextEl) contextEl.textContent = `Role: ${scenario.role} | Difficulty: beginner`;
    if (promptEl) promptEl.textContent = scenario.prompt || '';
    if (progressEl) progressEl.textContent = `Scenario ${sessionState.currentScenarioIndex + 1} of ${sessionState.scenarios.length}`;
    if (responseTextarea) {
      responseTextarea.value = '';
      responseTextarea.disabled = false;
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Response';
    }

    // Reset conversation state for new scenario
    sessionState.conversationHistory = [];
    sessionState.currentTurn = 1;

    // Add Agnes's initial prompt to conversation history
    if (scenario.prompt) {
      sessionState.conversationHistory.push({
        sender: 'agnes',
        message: scenario.prompt,
        timestamp: Date.now()
      });
    }

    // Initialize conversation thread UI
    updateConversationThread();
    updateTurnCounter();
  }

  function updateConversationThread() {
    const threadContainer = document.getElementById('conversation-thread');
    if (!threadContainer) return;

    threadContainer.innerHTML = sessionState.conversationHistory.map(msg => {
      const isAgnes = msg.sender === 'agnes';
      return `
        <div class="conversation-message ${isAgnes ? 'agnes-message' : 'user-message'}">
          <div class="message-sender">${isAgnes ? 'Agnes' : 'You'}</div>
          <div class="message-content">${msg.message}</div>
        </div>
      `;
    }).join('');

    // Auto-scroll to bottom
    threadContainer.scrollTop = threadContainer.scrollHeight;
  }

  function updateTurnCounter() {
    const turnEl = document.getElementById('turn-counter');
    if (turnEl) {
      turnEl.textContent = `Turn ${sessionState.currentTurn} of ${sessionState.maxTurns}`;
    }
  }

  // Response submission and scoring
  async function handleResponseSubmit() {
    try {
      const responseTextarea = document.getElementById('user-response') as HTMLTextAreaElement;
      const submitButton = document.getElementById('submit-response') as HTMLButtonElement;

      if (!responseTextarea || !submitButton) return;

      const userResponse = responseTextarea.value.trim();
      if (!userResponse) {
        alert('Please enter a response before submitting.');
        return;
      }

      responseTextarea.disabled = true;
      submitButton.disabled = true;
      submitButton.textContent = 'Processing...';

      const scenario = sessionState.currentScenario;

      // Add user's message to conversation history
      sessionState.conversationHistory.push({
        sender: 'user',
        message: userResponse,
        timestamp: Date.now()
      });

      // Update conversation thread UI
      updateConversationThread();

      // Clear textarea for next response
      responseTextarea.value = '';

      // Check if we've reached max turns
      if (sessionState.currentTurn >= sessionState.maxTurns) {
        // Final scoring and feedback - use AI scoring if available
        let scoreResult;
        let aiFeedback = null;

        // Try AI scoring first
        if ((window as any).scoreResponseWithAI) {
          try {
            scoreResult = await (window as any).scoreResponseWithAI(
              userResponse,
              scenario,
              scenario.rubric?.passThreshold || 70
            );
            // AI feedback is included in scoreResult
            if (scoreResult.aiScored) {
              aiFeedback = {
                strengths: scoreResult.strengths || [],
                improvements: scoreResult.improvements || [],
                feedback: scoreResult.feedback
              };
            }
          } catch (e) {
            console.warn('AI scoring failed, using keyword fallback:', e);
          }
        }

        // Fallback to keyword scoring if AI scoring failed or unavailable
        if (!scoreResult) {
          scoreResult = (window as any).scoreResponse(
            userResponse,
            scenario.expectedKeyPoints || [],
            scenario.rubric?.keywords || [],
            scenario.rubric?.passThreshold || 70
          );

          // Generate AI feedback separately if AI scoring failed but Gemini is available
          if (ai && !aiFeedback) {
            try {
              aiFeedback = await generateAIFeedback(userResponse, scenario, scoreResult);
            } catch (e) {
              console.warn('AI feedback unavailable:', e);
            }
          }
        }

        sessionState.responses.push({
          scenarioIndex: sessionState.currentScenarioIndex,
          userResponse,
          timestamp: new Date().toISOString(),
          conversationHistory: [...sessionState.conversationHistory]
        });

        sessionState.scores.push({
          ...scoreResult,
          scenarioIndex: sessionState.currentScenarioIndex,
          aiFeedback
        });

        displayFeedback(scoreResult, aiFeedback);

        responseTextarea.disabled = false;
        submitButton.textContent = 'Submit Response';
      } else {
        // Continue conversation - generate Agnes's follow-up
        const agnesFollowup = await generateAgnesFollowup(userResponse, scenario);

        // Add Agnes's response to conversation history
        sessionState.conversationHistory.push({
          sender: 'agnes',
          message: agnesFollowup,
          timestamp: Date.now()
        });

        // Increment turn counter
        sessionState.currentTurn++;

        // Update UI
        updateConversationThread();
        updateTurnCounter();

        // Re-enable textarea and button for next turn
        responseTextarea.disabled = false;
        submitButton.disabled = false;
        submitButton.textContent = sessionState.currentTurn >= sessionState.maxTurns ? 'Finish Conversation' : 'Continue Conversation';
      }
    } catch (error) {
      console.error('Error submitting response:', error);
      alert('Error processing response. Please try again.');
      const responseTextarea = document.getElementById('user-response') as HTMLTextAreaElement;
      const submitButton = document.getElementById('submit-response') as HTMLButtonElement;
      if (responseTextarea) responseTextarea.disabled = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Submit Response';
      }
    }
  }

  async function generateAIFeedback(userResponse: string, scenario: any, scoreResult: any) {
    if (!ai) return null;

    const prompt = `You are Agnes, an expert insurance training coach. Analyze this role-play response and provide constructive feedback.

Scenario: ${scenario.id}
User Response: "${userResponse}"

Performance:
- Score: ${scoreResult.score}/100
- Matched: ${scoreResult.matchedPoints.join(', ') || 'None'}
- Missed: ${scoreResult.missedPoints.join(', ') || 'None'}

Provide feedback in JSON format:
{
  "strengths": ["Strength 1", "Strength 2"],
  "improvements": ["Improvement 1", "Improvement 2"]
}

Be specific, actionable, and encouraging.`;

    try {
      const chat = await ai.chats.create({
        model: 'gemini-2.0-flash-exp',
        config: { temperature: 0.7, maxOutputTokens: 500 }
      });

      const response = await chat.sendMessage(prompt);
      let jsonText = response.text.trim();
      if (jsonText.includes('```json')) {
        jsonText = jsonText.match(/```json\n([\s\S]*?)\n```/)?.[1] || jsonText;
      }
      return JSON.parse(jsonText);
    } catch (e) {
      return {
        strengths: [`You scored ${scoreResult.score}/100`, `Matched ${scoreResult.matchedPoints.length} key points`],
        improvements: [`Try to include: ${scoreResult.missedPoints.slice(0, 2).join(', ')}`, 'Practice using clear, professional language']
      };
    }
  }

  // Generate Agnes follow-up response for multi-turn conversations
  async function generateAgnesFollowup(userResponse: string, scenario: any): Promise<string> {
    if (!ai) {
      // Fallback responses if AI is not available
      const fallbacks = [
        "Interesting approach. Can you tell me more about why that would work?",
        "I hear what you're saying, but I'm still concerned. What else can you offer?",
        "That's helpful, but I need to understand the timeline better. When would this happen?",
        "Okay, but what about the cost? I'm worried about my deductible.",
        "I appreciate that, but I'd like to think about it. Can you leave me some information?"
      ];
      return fallbacks[sessionState.currentTurn - 1] || fallbacks[fallbacks.length - 1];
    }

    try {
      // Build conversation context
      const conversationContext = sessionState.conversationHistory
        .map(msg => `${msg.sender === 'user' ? 'Sales Rep' : 'Agnes'}: ${msg.message}`)
        .join('\n');

      // Personality-specific instructions
      const personalityInstructions = {
        supportive: "Respond warmly and positively, showing genuine interest. Ask follow-up questions that help the rep demonstrate their skills.",
        realistic: "Respond with typical homeowner concerns. Be reasonable but skeptical. Require solid information before agreeing.",
        skeptical: "Challenge their response with tough objections. Be critical but fair. Make them work for the close.",
        rushed: "Act busy and impatient. Give short responses. Push back on time commitments. Be somewhat dismissive.",
        'final-boss': "Combine multiple objections. Switch between concerns rapidly. Test their ability to handle complex, multilayered objections."
      };

      const personality = sessionState.selectedPersonality || 'realistic';
      const personalityPrompt = personalityInstructions[personality as keyof typeof personalityInstructions] || personalityInstructions.realistic;

      const prompt = `You are Agnes, a homeowner in a sales roleplay scenario. The sales rep is practicing their pitch with you.

PRONUNCIATION NOTE: The company name "Roof-ER" should be pronounced as three separate sounds: "Roof" then "E" then "R" (like the letters E-R). Never say it as one word "Roofer".

Scenario: ${scenario.id}
Personality: ${personality}
Current Turn: ${sessionState.currentTurn} of ${sessionState.maxTurns}

Personality Instructions: ${personalityPrompt}

Conversation so far:
${conversationContext}

Latest Sales Rep Response: "${userResponse}"

Generate Agnes's natural follow-up response (1-3 sentences). Your response should:
1. React naturally to what the sales rep just said
2. ${sessionState.currentTurn < sessionState.maxTurns - 1 ? 'Raise a new concern or ask a follow-up question' : 'Move toward either acceptance or final objection'}
3. Stay in character with the ${personality} personality
4. Keep it conversational and realistic
5. DO NOT provide feedback - just respond as Agnes would

Response (plain text only, no JSON):`;

      const chat = await ai.chats.create({
        model: 'gemini-2.0-flash-exp',
        config: { temperature: 0.8, maxOutputTokens: 200 }
      });

      const response = await chat.sendMessage(prompt);
      return response.text.trim();
    } catch (e) {
      console.warn('Error generating Agnes followup:', e);
      return "I see. Let me think about that for a moment. Is there anything else you can tell me?";
    }
  }

  function displayFeedback(scoreResult: any, aiFeedback: any) {
    const scoreCircle = document.getElementById('score-circle');
    const scoreText = document.getElementById('score-text');
    const matchedList = document.getElementById('matched-points-list');
    const missedList = document.getElementById('missed-points-list');
    const strengthsList = document.getElementById('strengths-list');
    const improvementsList = document.getElementById('improvements-list');

    if (scoreCircle) {
      scoreCircle.textContent = String(scoreResult.score);
      scoreCircle.style.borderColor = scoreResult.score >= 85 ? '#4caf50' : scoreResult.score >= 70 ? '#ff9800' : '#f44336';
      scoreCircle.style.color = scoreResult.score >= 85 ? '#4caf50' : scoreResult.score >= 70 ? '#ff9800' : '#f44336';
    }

    if (scoreText) {
      scoreText.textContent = scoreResult.score >= 70 ? `Great! You passed with ${scoreResult.score}/100` : `Score: ${scoreResult.score}/100 (Need 70 to pass)`;
    }

    if (matchedList) {
      matchedList.innerHTML = scoreResult.matchedPoints.length > 0
        ? scoreResult.matchedPoints.map((p: string) => `<li style="margin-bottom: 8px;"><span style="color: #4caf50; margin-right: 8px;">✓</span>${p}</li>`).join('')
        : '<li>No key points matched</li>';
    }

    if (missedList) {
      missedList.innerHTML = scoreResult.missedPoints.length > 0
        ? scoreResult.missedPoints.map((p: string) => `<li style="margin-bottom: 8px;"><span style="color: #ff9800; margin-right: 8px;">✗</span>${p}</li>`).join('')
        : '<li>All key points covered!</li>';
    }

    if (aiFeedback && strengthsList && improvementsList) {
      strengthsList.innerHTML = aiFeedback.strengths.map((s: string) => `<li style="margin-bottom: 8px;">${s}</li>`).join('');
      improvementsList.innerHTML = aiFeedback.improvements.map((i: string) => `<li style="margin-bottom: 8px;">${i}</li>`).join('');
    }

    showScreen('feedback-area');
  }

  function nextScenario() {
    const nextIndex = sessionState.currentScenarioIndex + 1;
    if (nextIndex >= sessionState.scenarios.length) {
      showSessionSummary();
    } else {
      loadScenario(nextIndex);
      showScreen('scenario-display');
    }
  }

  function retryScenario() {
    if (sessionState.responses.length > 0) sessionState.responses.pop();
    if (sessionState.scores.length > 0) sessionState.scores.pop();
    displayScenario(sessionState.currentScenario);
    showScreen('scenario-display');
  }

  function showSessionSummary() {
    showScreen('session-summary');
    const summaryContainer = document.getElementById('session-summary');
    if (!summaryContainer) return;

    const scores = sessionState.scores.map(s => s.score);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const highScore = scores.length > 0 ? Math.max(...scores) : 0;
    const passedCount = scores.filter(s => s >= 70).length;

    summaryContainer.innerHTML = `
      <h2 style="text-align: center; color: #8b4fbe; margin-bottom: 30px;">🎉 Session Complete!</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">
        <div style="background: #f8f4fc; padding: 20px; border-radius: 8px; text-align: center;">
          <div style="font-size: 36px; font-weight: bold; color: #8b4fbe;">${sessionState.scores.length}</div>
          <div style="color: #666;">Scenarios Completed</div>
        </div>
        <div style="background: #f8f4fc; padding: 20px; border-radius: 8px; text-align: center;">
          <div style="font-size: 36px; font-weight: bold; color: #8b4fbe;">${avgScore}</div>
          <div style="color: #666;">Average Score</div>
        </div>
        <div style="background: #f8f4fc; padding: 20px; border-radius: 8px; text-align: center;">
          <div style="font-size: 36px; font-weight: bold; color: #8b4fbe;">${highScore}</div>
          <div style="color: #666;">Highest Score</div>
        </div>
        <div style="background: #f8f4fc; padding: 20px; border-radius: 8px; text-align: center;">
          <div style="font-size: 36px; font-weight: bold; color: #8b4fbe;">${passedCount}/${sessionState.scores.length}</div>
          <div style="color: #666;">Passed</div>
        </div>
      </div>
      <div style="text-align: center;">
        <button id="start-new-session-btn" style="padding: 15px 40px; background: #8b4fbe; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: 500; cursor: pointer;">Start New Session</button>
      </div>
    `;

    const newSessionBtn = document.getElementById('start-new-session-btn');
    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', showRoleSelection);
    }
  }

  // Generate contextual AI hint based on conversation
  async function generateContextualHint(): Promise<{
    suggestedResponse: string;
    keyPointsToInclude: string[];
    toneGuidance: string;
    scriptReference: string;
  } | null> {
    const scenario = sessionState.currentScenario;
    if (!scenario) return null;

    // Determine category for training content
    const category = (scenario as any).category || 'objections';
    const trainingContent = trainingScriptMap[category] || trainingScriptMap.objections;

    // Build conversation context
    const conversationContext = sessionState.conversationHistory
      .map(msg => `${msg.sender === 'user' ? 'Rep' : 'Homeowner'}: ${msg.message}`)
      .join('\n');

    // If AI available, generate contextual hint
    if (ai) {
      try {
        const prompt = `You are a roofing sales training coach. Analyze this roleplay conversation and suggest what the sales rep should say next.

Scenario: ${scenario.prompt}
Category: ${category}

Conversation so far:
${conversationContext || '(No conversation yet - this is the opening)'}

Training content to reference:
${JSON.stringify(trainingContent, null, 2)}

Expected key points for this scenario:
${scenario.expectedKeyPoints.join(', ')}

Provide a JSON response with these exact fields:
{
  "suggestedResponse": "A 2-3 sentence suggested response the rep should say",
  "keyPointsToInclude": ["point1", "point2"],
  "toneGuidance": "Brief tone advice (e.g., 'Empathetic and confident')",
  "scriptReference": "One relevant training script excerpt"
}`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.0-flash-exp',
          contents: prompt,
          config: { temperature: 0.7, maxOutputTokens: 500 }
        });

        let jsonText = response.text?.trim() || '';
        // Extract JSON from markdown code block if present
        if (jsonText.includes('```json')) {
          jsonText = jsonText.match(/```json\n([\s\S]*?)\n```/)?.[1] || jsonText;
        } else if (jsonText.includes('```')) {
          jsonText = jsonText.match(/```\n?([\s\S]*?)\n?```/)?.[1] || jsonText;
        }
        return JSON.parse(jsonText);
      } catch (e) {
        console.warn('AI hint generation failed, using fallback', e);
      }
    }

    // Fallback hint (no AI or AI failed)
    const allUserText = sessionState.conversationHistory
      .filter(m => m.sender === 'user')
      .map(m => m.message.toLowerCase())
      .join(' ');

    const missedPoints = scenario.expectedKeyPoints.filter(point => {
      const words = point.toLowerCase().split(' ');
      return !words.some(word => word.length > 3 && allUserText.includes(word));
    });

    return {
      suggestedResponse: scenario.followUps?.[0] || 'Try addressing their main concern with empathy, then offer a clear next step.',
      keyPointsToInclude: missedPoints.slice(0, 3),
      toneGuidance: 'Be empathetic and professional',
      scriptReference: trainingContent.keyPhrases?.[0] || 'Use the 5-step objection process'
    };
  }

  // Show contextual hint panel
  async function showHint() {
    const scenario = sessionState.currentScenario;
    if (!scenario) {
      alert('No scenario loaded.');
      return;
    }

    const hintPanel = document.getElementById('contextual-hint-panel');
    const loadingEl = document.getElementById('hint-display');

    // Show loading state
    if (loadingEl) {
      loadingEl.innerHTML = '<strong>💡 Generating AI hint...</strong>';
      loadingEl.style.display = 'block';
    }

    try {
      const hint = await generateContextualHint();

      // Hide loading
      if (loadingEl) loadingEl.style.display = 'none';

      if (!hint) {
        // Basic fallback
        if (loadingEl) {
          loadingEl.innerHTML = `<strong>💡 Tip:</strong> ${scenario.followUps?.[0] || 'Address their concern, then offer two time options.'}`;
          loadingEl.style.display = 'block';
          setTimeout(() => { loadingEl.style.display = 'none'; }, 10000);
        }
        return;
      }

      // Populate hint panel if it exists
      if (hintPanel) {
        const suggestionEl = document.getElementById('hint-suggestion-text');
        const keyPointsEl = document.getElementById('hint-key-points');
        const toneEl = document.getElementById('hint-tone-text');
        const scriptEl = document.getElementById('hint-script-reference');

        if (suggestionEl) suggestionEl.textContent = hint.suggestedResponse;
        if (keyPointsEl) keyPointsEl.innerHTML = hint.keyPointsToInclude.map(p => `<li>${p}</li>`).join('');
        if (toneEl) toneEl.textContent = hint.toneGuidance;
        if (scriptEl) scriptEl.textContent = hint.scriptReference;

        hintPanel.style.display = 'block';
      } else {
        // Fallback to simple hint display
        if (loadingEl) {
          loadingEl.innerHTML = `<strong>💡 Try saying:</strong> "${hint.suggestedResponse}"<br><br><strong>Key points:</strong> ${hint.keyPointsToInclude.join(', ')}<br><br><em>Tip: ${hint.toneGuidance}</em>`;
          loadingEl.style.display = 'block';
          setTimeout(() => { loadingEl.style.display = 'none'; }, 15000);
        }
      }

      sessionState.hintsUsed++;
    } catch (error) {
      console.error('Hint generation failed:', error);
      // Fall back to basic hint
      const basicHint = scenario.followUps?.[0] || 'Try addressing their main concern directly.';
      if (loadingEl) {
        loadingEl.innerHTML = `<strong>💡 Hint:</strong> ${basicHint}`;
        loadingEl.style.display = 'block';
        setTimeout(() => { loadingEl.style.display = 'none'; }, 10000);
      }
    }
  }

  // Show scenarios for a selected category
  function showScenarioList(categoryId: string) {
    sessionState.selectedCategory = categoryId;

    // Get category info
    const categoryInfo = (window as any).getCategoryInfo?.(categoryId) || { title: categoryId, icon: '' };
    const titleEl = document.getElementById('category-title-display');
    if (titleEl) {
      titleEl.textContent = `${categoryInfo.icon} ${categoryInfo.title}`;
    }

    // Get scenarios for this category
    const scenarios = (window as any).getScenariosByCategory?.(categoryId) || [];
    const container = document.getElementById('scenario-cards');
    if (!container) return;

    if (scenarios.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #666;">No scenarios found for this category.</p>';
      showScreen('scenario-list');
      return;
    }

    // Render scenario cards
    container.innerHTML = scenarios.map((scenario: any, index: number) => {
      const roleColors: Record<string, string> = {
        'homeowner': '#8b4fbe',
        'rep': '#2563eb',
        'adjuster': '#059669'
      };
      const roleColor = roleColors[scenario.role] || '#666';

      return `
        <div class="scenario-card" data-scenario-index="${index}" style="
          padding: 20px;
          border: 2px solid #e5e7eb;
          border-radius: 12px;
          background: white;
          cursor: pointer;
          transition: all 0.3s;
          position: relative;
        ">
          <div class="scenario-role-badge" style="
            position: absolute;
            top: 10px;
            right: 10px;
            background: ${roleColor};
            color: white;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: capitalize;
          ">${scenario.role}</div>
          <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #1f2937; padding-right: 80px;">${scenario.id || `Scenario ${index + 1}`}</h3>
          <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.5;">${scenario.prompt.substring(0, 100)}${scenario.prompt.length > 100 ? '...' : ''}</p>
        </div>
      `;
    }).join('');

    // Add click handlers to scenario cards
    container.querySelectorAll('.scenario-card').forEach((card) => {
      card.addEventListener('click', () => {
        const index = parseInt((card as HTMLElement).dataset.scenarioIndex || '0');
        sessionState.scenarios = scenarios;
        sessionState.currentScenarioIndex = index;

        // Show personality selector
        showScreen('personality-selector');
      });

      // Hover effects
      card.addEventListener('mouseenter', () => {
        (card as HTMLElement).style.borderColor = '#8b4fbe';
        (card as HTMLElement).style.transform = 'translateY(-2px)';
        (card as HTMLElement).style.boxShadow = '0 4px 12px rgba(139, 79, 190, 0.15)';
      });
      card.addEventListener('mouseleave', () => {
        (card as HTMLElement).style.borderColor = '#e5e7eb';
        (card as HTMLElement).style.transform = 'translateY(0)';
        (card as HTMLElement).style.boxShadow = 'none';
      });
    });

    showScreen('scenario-list');
  }

  // Setup category selection
  function setupCategorySelection() {
    // Category card clicks
    const categoryCards = document.querySelectorAll('.category-card');
    categoryCards.forEach(card => {
      card.addEventListener('click', () => {
        const categoryId = (card as HTMLElement).dataset.category;
        if (categoryId) {
          showScenarioList(categoryId);
        }
      });
    });

    // Random scenario button
    const randomBtn = document.getElementById('random-scenario-btn');
    if (randomBtn) {
      randomBtn.addEventListener('click', () => {
        const allowedCategories = moduleToCategories['5'] || [];
        const allowedScenarios = allowedCategories.flatMap(cat => (window as any).getScenariosByCategory?.(cat) || []);
        if (allowedScenarios.length > 0) {
          const randomIndex = Math.floor(Math.random() * allowedScenarios.length);
          const randomScenario = allowedScenarios[randomIndex];
          sessionState.scenarios = [randomScenario];
          sessionState.currentScenarioIndex = 0;
          sessionState.selectedCategory = randomScenario.category || 'random';
          showScreen('personality-selector');
        }
      });
    }

    // Legacy role browser button
    const legacyBtn = document.getElementById('legacy-role-btn');
    if (legacyBtn) {
      legacyBtn.addEventListener('click', () => {
        showScreen('roleplay-setup');
      });
    }

    // Back to categories button
    const backToCategoriesBtn = document.getElementById('back-to-categories');
    if (backToCategoriesBtn) {
      backToCategoriesBtn.addEventListener('click', () => {
        showScreen('category-selector');
        sessionState.selectedCategory = null;
      });
    }

    // Role filter in scenario list
    const roleFilter = document.getElementById('role-filter') as HTMLSelectElement;
    if (roleFilter) {
      roleFilter.addEventListener('change', () => {
        const selectedRole = roleFilter.value;
        const cards = document.querySelectorAll('.scenario-card');
        cards.forEach(card => {
          const badge = card.querySelector('.scenario-role-badge');
          if (badge) {
            const cardRole = badge.textContent?.toLowerCase();
            if (selectedRole === 'all' || cardRole === selectedRole) {
              (card as HTMLElement).style.display = 'block';
            } else {
              (card as HTMLElement).style.display = 'none';
            }
          }
        });
      });
    }
  }

  // Setup event listeners
  function setupRoleSelection() {
    const roleButtons = document.querySelectorAll('.role-btn');
    roleButtons.forEach(button => {
      button.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const role = target.closest('[data-role]')?.getAttribute('data-role');
        if (!role) return;

        sessionState.selectedRole = role;
        sessionState.startTime = Date.now();

        // Show personality selector instead of immediately loading scenarios
        showScreen('personality-selector');
      });
    });
  }

  // Setup personality selection
  function setupPersonalitySelection() {
    const personalityCards = document.querySelectorAll('.personality-card');
    personalityCards.forEach(card => {
      card.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const personality = target.closest('[data-personality]')?.getAttribute('data-personality');
        const difficulty = target.closest('[data-difficulty]')?.getAttribute('data-difficulty');

        if (!personality || !difficulty) return;

        sessionState.selectedPersonality = personality;
        sessionState.difficulty = difficulty;

        console.log(`✨ Selected personality: ${personality} (difficulty: ${difficulty})`);

        try {
          // Use already-loaded scenarios if available (from category/module selection)
          // Otherwise fetch by role (legacy path)
          let scenarios = sessionState.scenarios;
          if (!scenarios || scenarios.length === 0) {
            scenarios = (window as any).getAgnesScenariosByRole(sessionState.selectedRole);
          }
          if (!scenarios || scenarios.length === 0) {
            throw new Error(`No scenarios found. Please select a module first.`);
          }
          sessionState.scenarios = scenarios;
          sessionState.currentScenarioIndex = 0;

          setTimeout(() => {
            loadScenario(0);
            showScreen('scenario-display');

            // Update Agnes name display based on personality
            const agnesNameEl = document.getElementById('agnes-name');
            if (agnesNameEl) {
              const personalityNames = {
                'supportive': 'Agnes the Supportive Coach',
                'realistic': 'Agnes the Real Homeowner',
                'skeptical': 'Agnes the Skeptical Buyer',
                'rushed': 'Agnes the Rushed Decision-Maker',
                'final-boss': 'Agnes the Final Boss'
              };
              agnesNameEl.textContent = personalityNames[personality] || 'Agnes';
            }
          }, 300);
        } catch (error) {
          console.error('Error loading scenarios:', error);
          alert(`Error: ${(error as Error).message}`);
        }
      });
    });

    // Setup back button
    const backButton = document.getElementById('back-to-roles');
    if (backButton) {
      backButton.addEventListener('click', () => {
        showScreen('roleplay-setup');
        sessionState.selectedRole = null;
        sessionState.selectedPersonality = null;
      });
    }
  }

  // Initialize
  try {
    setupCategorySelection();
    setupRoleSelection();
    setupPersonalitySelection();

    const submitButton = document.getElementById('submit-response');
    if (submitButton) {
      submitButton.addEventListener('click', handleResponseSubmit);
    }

    const nextButton = document.getElementById('next-scenario-btn');
    if (nextButton) {
      nextButton.addEventListener('click', nextScenario);
    }

    const retryButton = document.getElementById('retry-scenario-btn');
    if (retryButton) {
      retryButton.addEventListener('click', retryScenario);
    }

    const hintButton = document.getElementById('hint-btn');
    if (hintButton) {
      hintButton.addEventListener('click', showHint);
    }

    // Start with category selector (new default)
    showScreen('category-selector');
    console.log('✅ Agnes Role-Play System initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing Agnes system:', error);
    throw error;
  }
}


// --- Quiz Generation and Handling ---
interface QuizQuestion {
  question: string;
  options: string[];
  answer: string;
}

async function generateQuiz() {
  const quizArea = document.getElementById('quiz-area');
  if (!quizArea) return;

  quizArea.innerHTML = '<div id="loader">Generating your quiz...</div>';

  try {
    if (!ai) {
      quizArea.innerHTML = '<p style="color: red;">Quiz is unavailable: missing API key. Set GEMINI_API_KEY in .env.local and reload.</p>';
      return;
    }
     const trainingSummary = Object.values(trainingContent).join(' '); // Use all content

    const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on this summary of the Roof-ER sales training, generate a 5-question multiple-choice quiz. Ensure the "answer" field exactly matches one of the strings in the "options" array. ${trainingSummary}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    answer: { type: Type.STRING }
                  },
                  required: ["question", "options", "answer"]
                }
            }
        }
    });

    const quizData: QuizQuestion[] = JSON.parse(result.text.trim());
    renderQuiz(quizData);
  } catch (error) {
    console.error("Quiz generation failed:", error);
    quizArea.innerHTML = '<p style="color: red;">Sorry, there was an error generating the quiz. Please try again.</p>';
  }
}

function renderQuiz(quizData: QuizQuestion[]) {
  const quizArea = document.getElementById('quiz-area');
  if (!quizArea) return;

  quizArea.innerHTML = quizData.map((q, index) => `
    <div class="quiz-item" data-question-index="${index}">
      <p class="quiz-question">${index + 1}. ${q.question}</p>
      <ul class="quiz-options">
        ${q.options.map(option => `<li data-option="${option.replace(/"/g, '&quot;')}">${option}</li>`).join('')}
      </ul>
      <div id="quiz-feedback-${index}" class="quiz-feedback"></div>
    </div>
  `).join('') + '<button id="submitQuizButton">Submit Answers</button>';

  const options = quizArea.querySelectorAll('.quiz-options li');
  options.forEach(option => {
    option.addEventListener('click', () => {
        const parentOptions = option.parentElement as HTMLElement;
        parentOptions.querySelectorAll('li').forEach(li => li.classList.remove('selected'));
        option.classList.add('selected');
    });
  });

  const submitButton = document.getElementById('submitQuizButton');
  submitButton?.addEventListener('click', () => {
    quizData.forEach((q, index) => {
        const selectedOption = document.querySelector(`.quiz-item[data-question-index="${index}"] .quiz-options li.selected`) as HTMLElement;
        const feedbackEl = document.getElementById(`quiz-feedback-${index}`);
        if(selectedOption && feedbackEl) {
            const userAnswer = selectedOption.dataset.option;
            if(userAnswer === q.answer) {
                feedbackEl.textContent = 'Correct!';
                feedbackEl.className = 'quiz-feedback correct';
            } else {
                feedbackEl.textContent = `Incorrect. The correct answer is: ${q.answer}`;
                feedbackEl.className = 'quiz-feedback incorrect';
            }
        }
    });
    (submitButton as HTMLButtonElement).disabled = true;
  });
}

// --- Module Navigation ---

// Cache for CMS content to avoid repeated fetches
const cmsContentCache: Record<string, string> = {};

async function fetchCMSContent(moduleName: string): Promise<string | null> {
  // Skip CMS fetch for non-training pages (use hardcoded content only)
  if (moduleName === 'my-page' || moduleName === 'admin-dashboard') {
    return null;
  }

  // Check cache first
  if (cmsContentCache[moduleName]) {
    return cmsContentCache[moduleName];
  }

  try {
    const response = await fetch(`/api/content/modules/${moduleName}`);
    if (response.ok) {
      const data = await response.json();
      if (data.htmlContent) {
        cmsContentCache[moduleName] = data.htmlContent;
        return data.htmlContent;
      }
    }
  } catch (error) {
    console.log('CMS fetch failed, using fallback content');
  }
  return null;
}

async function renderModule(moduleName: string) {
  if (!mainContent) return;

  // Don't render modules when in admin mode - admin has its own UI
  if (isSuperAdmin()) return;

  // Clean up previous module's event listeners and resources (prevents memory leaks)
  cleanupCurrentModule();

  // Clean up tip observers from previous module
  cleanupTipObservers();

  // Show loading state
  mainContent.innerHTML = '<div class="module-loading"><div class="loading-spinner"></div><p>Loading content...</p></div>';

  // Try to fetch from CMS first, fall back to hardcoded content
  let content = await fetchCMSContent(moduleName);
  if (!content) {
    content = trainingContent[moduleName] || '<div>Content not found.</div>';
  }
  mainContent.innerHTML = content;

  // Inject theme toggle into the content area
  injectThemeToggle();

  // Cancel any ongoing TTS when changing modules
  stopAllTTS();
  currentUtterance = null;

  // Track module start and activity
  trackModuleStart(moduleName);
  startActivityTracking(moduleName);

  // Setup contextual tip system for this module
  setupScrollObserver(moduleName);

  // Initialize video players (since inline scripts don't execute with innerHTML)
  initVideoPlayers();

  // Initialize engagement tracking for module completion gating
  if (MODULE_REQUIREMENTS[moduleName]) {
    initModuleEngagement(moduleName);
  }

  // Initialize interactive elements for specific modules
  switch (moduleName) {
      case 'my-page':
          initMyPage();
          break;
      case 'quiz':
          document.getElementById('generateQuizButton')?.addEventListener('click', generateQuiz);
          break;
      case 'sales-cycle':
          initSalesCycleSorter();
          break;
      case 'objection-handling':
          initObjectionMatcher();
          break;
      case 'role-play':
          initAgnesLiveRolePlay();
          break;
      case 'welcome':
          initQuickQuiz1();
          initWelcomeModals();
          initLeadershipBios();
          break;
      case 'post-inspection-objections':
          initModule9RoleplayButtons();
          break;
      case 'damage-identification':
      case 'roofing-damage-id':
          initDamageMatchingGame();
          break;
      // New module initializers
      case 'general-knowledge':
          initQuickQuiz2();
          break;
      case 'final-exam':
          initFinalExam();
          break;
      case 'handling-initial-pitch-objections':
          initObjectionMatcher();
          break;
      case 'sales-cycle-job-flow':
          initSalesCycleSorter();
          break;
      case 'inspection-process':
          initInspectionOrderGame();
          break;
      case 'filing-claim-closing':
          initFilingClaimQuiz();
          break;
      case 'commitment':
          initCommitmentGate();
          break;
      case 'admin-dashboard':
          initAdminDashboard();
          break;
      case 'shingle-types-materials':
          initShingleGame();
          break;
  }
}

function handleNavigation(event: Event) {
  const target = event.target as HTMLElement;
  if (target.tagName === 'LI' && target.dataset.module) {
    const moduleName = target.dataset.module;

    // My Page is always accessible - it's a dashboard, not a training module
    if (moduleName === 'my-page') {
      // Always allow access to My Page
    } else if (moduleName === 'admin-dashboard') {
      // Admin dashboard is always accessible for managers
      if (!isManagerMode()) {
        alert('Admin dashboard is only accessible to managers.');
        return;
      }
    } else {
      // Check if module is locked (unless in manager mode)
      const unlockedModules = getUnlockedModules();
      if (!unlockedModules.includes(moduleName)) {
        alert('Complete previous modules to unlock this section.');
        return;
      }
    }

    sidebar?.querySelectorAll('li').forEach(li => li.classList.remove('active'));
    target.classList.add('active');
    renderModule(moduleName);
    localStorage.setItem(STORAGE_KEYS.currentModule, moduleName);
  }
}

// Initialize manager mode UI
function initManagerModeUI() {
  const sidebarHeader = document.querySelector('.sidebar-header');
  if (!sidebarHeader) return;

  // Remove existing elements if present
  document.getElementById('manager-mode-indicator')?.remove();
  document.querySelector('.admin-sidebar-item')?.remove();

  const user = getCurrentUser();
  const isManager = user?.isManager || isManagerMode();

  // Add manager mode toggle button (subtle) - only if not using new login system
  if (!user) {
    const modeIndicator = document.createElement('div');
    modeIndicator.id = 'manager-mode-indicator';
    modeIndicator.className = isManagerMode() ? 'manager-active' : '';
    modeIndicator.innerHTML = isManagerMode()
      ? '<span class="manager-badge">MANAGER MODE</span><button id="exit-manager-btn">Exit</button>'
      : '<button id="manager-login-btn">Manager Login</button>';
    sidebarHeader.appendChild(modeIndicator);

    // Add click handlers
    setTimeout(() => {
      document.getElementById('manager-login-btn')?.addEventListener('click', showManagerLogin);
      document.getElementById('exit-manager-btn')?.addEventListener('click', () => {
        exitManagerMode();
        initManagerModeUI();
        location.reload();
      });
    }, 0);
  }

  // Add admin dashboard link for managers
  if (isManager) {
    const sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav) {
      const adminItem = document.createElement('li');
      adminItem.className = 'admin-sidebar-item unlocked';
      adminItem.dataset.module = 'admin-dashboard';
      adminItem.innerHTML = '📊 Admin Dashboard';
      sidebarNav.appendChild(adminItem);
    }
  }
}

// Show manager login prompt
function showManagerLogin() {
  const code = prompt('Enter manager access code:');
  if (code && toggleManagerMode(code)) {
    alert('Manager mode activated! All modules unlocked.');
    location.reload();
  } else if (code) {
    alert('Invalid access code.');
  }
}

// ============================================================================
// CONTEXTUAL TIP POPUP SYSTEM
// ============================================================================

// Track shown tips to avoid repeats
const shownTips = new Set<string>(JSON.parse(sessionStorage.getItem('roof-er.shownTips') || '[]'));

// Active tip timeouts for cleanup
let activeTipTimeout: number | null = null;
let lingerTimeout: number | null = null;

// Tip data for modules
interface TipData {
  id?: string;
  icon: string;
  title: string;
  message: string;
}

interface ModuleTip extends TipData {
  id: string;
  trigger: 'scroll' | 'linger';
  targetSelector?: string;
  delay?: number;
}

const moduleTips: Record<string, ModuleTip[]> = {
  'welcome': [
    { id: 'tip-video', trigger: 'scroll', targetSelector: '.video-player-container', icon: '🎬', title: 'Watch the Video', message: 'This video contains important context. Watch it fully to progress!' },
    { id: 'tip-leaders', trigger: 'scroll', targetSelector: '.leader-grid', icon: '👥', title: 'Meet the Team', message: 'Click "My Bio" on each leader to learn more about them.' },
    { id: 'tip-values', trigger: 'scroll', targetSelector: '.core-values', icon: '💎', title: 'Core Values', message: 'Remember: Integrity, Quality, Simplicity - you\'ll be tested!' },
    { id: 'tip-quiz', trigger: 'scroll', targetSelector: '.quiz-section', icon: '📝', title: 'Quick Quiz', message: 'Test your knowledge before completing the module.' },
    { id: 'tip-linger', trigger: 'linger', delay: 45000, icon: '⏱️', title: 'Take Your Time', message: 'This module takes about 15-20 minutes. No rush!' },
  ],
  'commitment': [
    { id: 'tip-commitment-video', trigger: 'scroll', targetSelector: '.video-player-container', icon: '🎬', title: 'Important Video', message: 'Watch this commitment video to understand expectations.' },
    { id: 'tip-commitment-linger', trigger: 'linger', delay: 60000, icon: '💡', title: 'Still Here?', message: 'Take your time understanding the commitment expectations.' },
  ],
  'general-knowledge': [
    { id: 'tip-gk-video', trigger: 'scroll', targetSelector: '.video-player-container', icon: '🎬', title: 'Educational Video', message: 'Learn the fundamentals of roofing in this video.' },
    { id: 'tip-gk-linger', trigger: 'linger', delay: 60000, icon: '📚', title: 'Lots to Learn!', message: 'This module has important technical info. Take notes!' },
  ],
};

// Show a tip popup
function showTip(tip: TipData): void {
  // Check if already shown (by id or by title if no id)
  const tipId = tip.id || `tip-${tip.title.toLowerCase().replace(/\s+/g, '-')}`;
  if (shownTips.has(tipId)) return;

  // Mark as shown
  shownTips.add(tipId);
  sessionStorage.setItem('roof-er.shownTips', JSON.stringify([...shownTips]));

  // Remove any existing tip
  const existingTip = document.querySelector('.tip-popup');
  if (existingTip) existingTip.remove();

  // Clear existing timeout
  if (activeTipTimeout) {
    clearTimeout(activeTipTimeout);
    activeTipTimeout = null;
  }

  // Create tip element
  const tipEl = document.createElement('div');
  tipEl.className = 'tip-popup';
  tipEl.innerHTML = `
    <span class="tip-icon">${tip.icon}</span>
    <div class="tip-content">
      <div class="tip-title">${tip.title}</div>
      <div class="tip-message">${tip.message}</div>
    </div>
    <button class="tip-close" aria-label="Close tip">&times;</button>
  `;

  document.body.appendChild(tipEl);

  // Animate in
  requestAnimationFrame(() => {
    tipEl.classList.add('show');
  });

  // Close button handler
  const closeBtn = tipEl.querySelector('.tip-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      tipEl.classList.remove('show');
      setTimeout(() => tipEl.remove(), 400);
    });
  }

  // Auto-hide after 5 seconds
  activeTipTimeout = window.setTimeout(() => {
    if (tipEl.parentElement) {
      tipEl.classList.remove('show');
      setTimeout(() => tipEl.remove(), 400);
    }
  }, 5000);
}

// Scroll observer for contextual tips
let scrollObserver: IntersectionObserver | null = null;

function setupScrollObserver(moduleName: string): void {
  // Clean up previous observer
  if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }

  // Clear linger timeout
  if (lingerTimeout) {
    clearTimeout(lingerTimeout);
    lingerTimeout = null;
  }

  const tips = moduleTips[moduleName];
  if (!tips) return;

  // Setup scroll-based tips
  const scrollTips = tips.filter(t => t.trigger === 'scroll' && t.targetSelector);

  if (scrollTips.length > 0) {
    scrollObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Find matching tip
          const matchingTip = scrollTips.find(t =>
            entry.target.matches(t.targetSelector!)
          );
          if (matchingTip && !shownTips.has(matchingTip.id)) {
            // Small delay so it feels natural
            setTimeout(() => showTip(matchingTip), 500);
          }
        }
      });
    }, { threshold: 0.3, rootMargin: '0px' });

    // Observe target elements after a short delay (let DOM render)
    setTimeout(() => {
      scrollTips.forEach(tip => {
        const el = document.querySelector(tip.targetSelector!);
        if (el) scrollObserver?.observe(el);
      });
    }, 500);
  }

  // Setup linger-based tips
  const lingerTips = tips.filter(t => t.trigger === 'linger' && t.delay);
  lingerTips.forEach(tip => {
    if (!shownTips.has(tip.id)) {
      lingerTimeout = window.setTimeout(() => {
        showTip(tip);
      }, tip.delay);
    }
  });
}

// Clean up observers when leaving module
function cleanupTipObservers(): void {
  if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }
  if (lingerTimeout) {
    clearTimeout(lingerTimeout);
    lingerTimeout = null;
  }
  if (activeTipTimeout) {
    clearTimeout(activeTipTimeout);
    activeTipTimeout = null;
  }
}

// Mark module as complete and unlock next
function completeModule(moduleName: string) {
  unlockNextModule(moduleName);

  // Mark as completed in localStorage
  const completedModules = JSON.parse(localStorage.getItem('roof-er.completedModules') || '[]');
  if (!completedModules.includes(moduleName)) {
    completedModules.push(moduleName);
    localStorage.setItem('roof-er.completedModules', JSON.stringify(completedModules));

    // Award XP for module completion (only if not already completed)
    const currentXp = parseInt(localStorage.getItem('roof-er.totalXp') || '0', 10);
    const newXp = currentXp + 100; // 100 XP per module
    localStorage.setItem('roof-er.totalXp', newXp.toString());

    // Update streak (only once per day)
    const lastActivity = localStorage.getItem('roof-er.lastActivityDate');
    const today = new Date().toDateString();
    if (lastActivity !== today) {
      const currentStreak = parseInt(localStorage.getItem('roof-er.streak') || '0', 10);
      localStorage.setItem('roof-er.streak', (currentStreak + 1).toString());
      localStorage.setItem('roof-er.lastActivityDate', today);
    }
  }

  // Track module completion via API (silent - don't spam console, handle offline gracefully)
  void apiCall('/progress/module', {
    method: 'POST',
    body: JSON.stringify({ moduleName, action: 'complete' }),
    silent: true
  } as any).catch(() => { /* Silent fail for offline mode */ });

  // Trigger confetti celebration
  triggerConfetti('module');

  // Check for new badges
  checkAndAwardBadges();

  const currentIndex = MODULE_ORDER.indexOf(moduleName);
  if (currentIndex < MODULE_ORDER.length - 1) {
    const nextModule = MODULE_ORDER[currentIndex + 1];
    const nextModuleName = getModuleDisplayName(nextModule);

    // Show success modal with countdown and auto-navigate
    showModuleCompleteModal(moduleName, nextModule, nextModuleName);
  } else {
    // Last module - show training complete message
    showTrainingCompleteModal();
  }
}

// Module display names
function getModuleDisplayName(moduleId: string): string {
  const names: Record<string, string> = {
    'welcome': 'Welcome & Company Intro',
    'commitment': 'Your Commitment',
    'general-knowledge': 'General Roofing Knowledge',
    'shingle-types-materials': 'Shingle Types & Materials',
    'initial-pitch': 'Initial Pitch',
    'handling-initial-pitch-objections': 'Handling Initial Pitch Objections',
    'inspection-process': 'Inspection Process',
    'post-inspection-pitch': 'Post-Inspection Pitch',
    'post-inspection-objections': 'Post-Inspection Objections',
    'damage-identification': 'Damage Identification',
    'filing-claim-closing': 'Filing the Claim & Contingency + Claim Authorization Script',
    'sales-cycle-job-flow': 'Sales Cycle & Job Flow',
    'role-play': 'Role Play Practice',
    'final-exam': 'Final Exam'
  };
  return names[moduleId] || moduleId;
}

// Show module complete modal with countdown
function showModuleCompleteModal(currentModule: string, nextModule: string, nextModuleName: string) {
  const modal = document.createElement('div');
  modal.className = 'module-complete-modal';
  modal.innerHTML = `
    <div class="module-complete-content">
      <div class="success-icon">🎉</div>
      <h2>Module Complete!</h2>
      <p>Great work finishing <strong>${getModuleDisplayName(currentModule)}</strong></p>
      <p class="next-module-text">Continuing to <strong>${nextModuleName}</strong> in <span id="countdown">3</span>...</p>
      <button class="skip-btn" id="go-now-btn">Go Now</button>
    </div>
  `;
  document.body.appendChild(modal);

  // Add click handler for Go Now button
  const goNowBtn = document.getElementById('go-now-btn');
  let intervalCleared = false;

  // Countdown and auto-navigate
  let count = 3;
  const interval = setInterval(() => {
    count--;
    const countdownEl = document.getElementById('countdown');
    if (countdownEl) countdownEl.textContent = count.toString();
    if (count <= 0) {
      clearInterval(interval);
      intervalCleared = true;
      modal.remove();
      navigateToModule(nextModule);
    }
  }, 1000);

  if (goNowBtn) {
    goNowBtn.onclick = () => {
      if (!intervalCleared) {
        clearInterval(interval);
        intervalCleared = true;
      }
      modal.remove();
      navigateToModule(nextModule);
    };
  }
}

// Show training complete modal
function showTrainingCompleteModal() {
  const modal = document.createElement('div');
  modal.className = 'module-complete-modal';
  modal.innerHTML = `
    <div class="module-complete-content">
      <div class="success-icon">🏆</div>
      <h2>Training Complete!</h2>
      <p>Congratulations! You've completed all training modules.</p>
      <p class="next-module-text">You're now ready to hit the field!</p>
      <button class="skip-btn" id="close-modal-btn">Close</button>
    </div>
  `;
  document.body.appendChild(modal);

  const closeBtn = document.getElementById('close-modal-btn');
  if (closeBtn) {
    closeBtn.onclick = () => modal.remove();
  }
}

// Navigate to a specific module
function navigateToModule(moduleName: string) {
  const sidebar = document.getElementById('sidebar');
  const targetItem = sidebar?.querySelector(`[data-module="${moduleName}"]`) as HTMLElement;
  if (targetItem) {
    sidebar?.querySelectorAll('li').forEach(li => li.classList.remove('active'));
    targetItem.classList.add('active');
    renderModule(moduleName);
    localStorage.setItem(STORAGE_KEYS.currentModule, moduleName);
    // Scroll to top of content
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.scrollTop = 0;
  }
}

// Make functions accessible from onclick handlers in HTML templates
(window as any).navigateToModule = navigateToModule;
(window as any).completeModule = completeModule;

// ============================================================================
// PHOTO MODAL - Simple lightbox for strategy photos
// ============================================================================

function ensurePhotoModal() {
  if (document.getElementById('photo-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'photo-modal';
  modal.className = 'photo-modal-overlay';
  modal.innerHTML = `
    <div class="photo-modal">
      <div class="photo-modal-header">
        <h3 id="photo-modal-title">Photo</h3>
        <button class="photo-modal-close" onclick="closePhotoModal()">×</button>
      </div>
      <div class="photo-modal-body">
        <img id="photo-modal-image" src="" alt="Strategy photo" />
      </div>
      <div class="photo-modal-footer">
        <p id="photo-modal-desc"></p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePhotoModal();
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    const modalEl = document.getElementById('photo-modal');
    if (!modalEl?.classList.contains('show')) return;
    if (e.key === 'Escape') closePhotoModal();
  });
}

function openPhotoModal(imageSrc: string, title: string, description: string) {
  ensurePhotoModal();

  const modal = document.getElementById('photo-modal');
  const titleEl = document.getElementById('photo-modal-title');
  const imageEl = document.getElementById('photo-modal-image') as HTMLImageElement;
  const descEl = document.getElementById('photo-modal-desc');

  if (!modal || !titleEl || !imageEl || !descEl) return;

  modal.classList.add('show');
  titleEl.textContent = title;
  imageEl.src = imageSrc;
  descEl.textContent = description;
  document.body.style.overflow = 'hidden';
}

function closePhotoModal() {
  const modal = document.getElementById('photo-modal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
}

// Make photo modal functions globally accessible
(window as any).openPhotoModal = openPhotoModal;
(window as any).closePhotoModal = closePhotoModal;

// ============================================================================
// END PHOTO MODAL
// ============================================================================

// Track module start (handle offline gracefully)
function trackModuleStart(moduleName: string) {
  void apiCall('/progress/module', {
    method: 'POST',
    body: JSON.stringify({ moduleName, action: 'start' }),
    silent: true
  } as any).catch(() => { /* Silent fail for offline mode */ });
}

// Activity heartbeat for time tracking
let activityHeartbeatInterval: number | null = null;
let currentModuleForTracking: string | null = null;

function startActivityTracking(moduleName: string) {
  currentModuleForTracking = moduleName;

  // Clear existing interval
  if (activityHeartbeatInterval) {
    clearInterval(activityHeartbeatInterval);
  }

  // Send heartbeat every 30 seconds (silent - don't spam console, handle offline gracefully)
  activityHeartbeatInterval = window.setInterval(() => {
    if (currentModuleForTracking) {
      void apiCall('/progress/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ moduleName: currentModuleForTracking, timeSpent: 30 }),
        silent: true
      } as any).catch(() => { /* Silent fail for offline mode */ });
    }
  }, 30000);
}

function stopActivityTracking() {
  if (activityHeartbeatInterval) {
    clearInterval(activityHeartbeatInterval);
    activityHeartbeatInterval = null;
  }
  currentModuleForTracking = null;
}

// ============================================================================
// LOGIN SCREEN UI
// ============================================================================

function showLoginScreen(): void {
  // Hide main app
  const appContainer = document.querySelector('.app-container') as HTMLElement;
  if (appContainer) appContainer.style.display = 'none';

  // Remove existing login screen if present
  const existingLogin = document.getElementById('login-screen');
  if (existingLogin) existingLogin.remove();

  // Create login screen
  const loginScreen = document.createElement('div');
  loginScreen.id = 'login-screen';
  loginScreen.className = 'login-screen';
  loginScreen.innerHTML = `
    <div class="login-container">
      <div class="login-header">
        <div class="login-logo">
          <img src="/assets/logo-shield.png" alt="Roof-ER Logo" style="width: 180px; height: auto;">
        </div>
        <h1 style="margin-top: 10px;">TRAINING</h1>
        <p>Welcome to the sales training platform</p>
      </div>

      <form id="login-form" class="login-form">
        <div class="form-group">
          <label for="login-name">Your Name</label>
          <input
            type="text"
            id="login-name"
            placeholder="Enter your full name"
            required
            minlength="2"
            autocomplete="name"
          />
        </div>

        <div class="form-group manager-code-group">
          <label for="login-manager-code">
            Manager Code <span class="optional">(optional)</span>
          </label>
          <input
            type="password"
            id="login-manager-code"
            placeholder="Enter manager code if applicable"
            autocomplete="off"
          />
          <small class="hint">Managers: Enter your access code to unlock admin features</small>
        </div>

        <button type="submit" class="login-btn" id="login-submit-btn">
          <span class="btn-text">Start Training</span>
          <span class="btn-loading" style="display:none;">Signing in...</span>
        </button>

        <div id="login-error" class="login-error" style="display:none;"></div>
      </form>

      <!-- Hidden Super Admin Login Section -->
      <div id="admin-login-section" class="admin-login-section" style="display:none;">
        <div class="admin-login-divider">
          <span>Super Admin Access</span>
        </div>
        <form id="admin-login-form" class="admin-login-form">
          <div class="form-group">
            <label for="admin-username">Admin Username</label>
            <input
              type="text"
              id="admin-username"
              placeholder="Enter admin username"
              required
              autocomplete="username"
            />
          </div>
          <div class="form-group">
            <label for="admin-password">Admin Password</label>
            <input
              type="password"
              id="admin-password"
              placeholder="Enter admin password"
              required
              autocomplete="current-password"
            />
          </div>
          <button type="submit" class="login-btn admin-login-btn" id="admin-submit-btn">
            <span class="btn-text">Admin Login</span>
            <span class="btn-loading" style="display:none;">Authenticating...</span>
          </button>
          <div id="admin-login-error" class="login-error" style="display:none;"></div>
        </form>
      </div>

      <div class="login-footer">
        <p>First time here? Just enter your name to get started!</p>
      </div>
    </div>
  `;

  document.body.appendChild(loginScreen);

  // Add form submit handler
  const form = document.getElementById('login-form') as HTMLFormElement;
  form?.addEventListener('submit', handleLoginSubmit);

  // Add admin form submit handler
  const adminForm = document.getElementById('admin-login-form') as HTMLFormElement;
  adminForm?.addEventListener('submit', handleAdminLoginSubmit);

  // Add trigger word detection on name input
  const nameInput = document.getElementById('login-name') as HTMLInputElement;
  nameInput?.addEventListener('input', (e) => {
    const value = (e.target as HTMLInputElement).value.toLowerCase();
    const adminSection = document.getElementById('admin-login-section');
    if (adminSection) {
      // Show admin login if "mon" is typed anywhere in the name
      if (value.includes('mon')) {
        adminSection.style.display = 'block';
        adminSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        adminSection.style.display = 'none';
      }
    }
  });

  // Focus name input
  setTimeout(() => {
    (document.getElementById('login-name') as HTMLInputElement)?.focus();
  }, 100);
}

async function handleLoginSubmit(e: Event): Promise<void> {
  e.preventDefault();

  const nameInput = document.getElementById('login-name') as HTMLInputElement;
  const managerCodeInput = document.getElementById('login-manager-code') as HTMLInputElement;
  const submitBtn = document.getElementById('login-submit-btn') as HTMLButtonElement;
  const errorDiv = document.getElementById('login-error') as HTMLElement;
  const btnText = submitBtn.querySelector('.btn-text') as HTMLElement;
  const btnLoading = submitBtn.querySelector('.btn-loading') as HTMLElement;

  const name = nameInput.value.trim();
  const managerCode = managerCodeInput.value.trim();

  if (!name || name.length < 2) {
    errorDiv.textContent = 'Please enter your name (at least 2 characters)';
    errorDiv.style.display = 'block';
    return;
  }

  // Show loading state
  submitBtn.disabled = true;
  btnText.style.display = 'none';
  btnLoading.style.display = 'inline';
  errorDiv.style.display = 'none';

  const result = await login(name, managerCode || undefined);

  if (result.success) {
    // Hide login screen and show app
    hideLoginScreen();
    initializeApp();
  } else {
    // Show error
    errorDiv.textContent = result.error || 'Login failed. Please try again.';
    errorDiv.style.display = 'block';
    submitBtn.disabled = false;
    btnText.style.display = 'inline';
    btnLoading.style.display = 'none';
  }
}

function hideLoginScreen(): void {
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.remove();

  const appContainer = document.querySelector('.app-container') as HTMLElement;
  if (appContainer) appContainer.style.display = 'flex';
}

// ============================================================================
// SUPER ADMIN CMS FUNCTIONALITY
// ============================================================================

interface SuperAdmin {
  id: string;
  username: string;
  displayName: string;
}

let superAdminSession: { token: string; admin: SuperAdmin } | null = null;

function getSuperAdminSession(): { token: string; admin: SuperAdmin } | null {
  if (superAdminSession) return superAdminSession;
  const stored = localStorage.getItem('superAdminSession');
  if (stored) {
    try {
      superAdminSession = JSON.parse(stored);
      return superAdminSession;
    } catch { return null; }
  }
  return null;
}

function setSuperAdminSession(token: string, admin: SuperAdmin): void {
  superAdminSession = { token, admin };
  localStorage.setItem('superAdminSession', JSON.stringify(superAdminSession));
}

function clearSuperAdminSession(): void {
  superAdminSession = null;
  localStorage.removeItem('superAdminSession');
}

function isSuperAdmin(): boolean {
  return getSuperAdminSession() !== null;
}

async function superAdminApiCall<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
  const session = getSuperAdminSession();
  if (!session) return null;

  try {
    const response = await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`,
        ...(options?.headers || {})
      }
    });

    if (response.status === 401) {
      clearSuperAdminSession();
      showLoginScreen();
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Super admin API error:', error);
    return null;
  }
}

async function handleAdminLoginSubmit(e: Event): Promise<void> {
  e.preventDefault();

  const usernameInput = document.getElementById('admin-username') as HTMLInputElement;
  const passwordInput = document.getElementById('admin-password') as HTMLInputElement;
  const submitBtn = document.getElementById('admin-submit-btn') as HTMLButtonElement;
  const errorDiv = document.getElementById('admin-login-error') as HTMLElement;
  const btnText = submitBtn.querySelector('.btn-text') as HTMLElement;
  const btnLoading = submitBtn.querySelector('.btn-loading') as HTMLElement;

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    errorDiv.textContent = 'Please enter username and password';
    errorDiv.style.display = 'block';
    return;
  }

  // Show loading state
  submitBtn.disabled = true;
  btnText.style.display = 'none';
  btnLoading.style.display = 'inline';
  errorDiv.style.display = 'none';

  try {
    const response = await fetch('/api/admin-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (response.ok && data.token) {
      setSuperAdminSession(data.token, data.admin);
      hideLoginScreen();
      showSuperAdminDashboard();
    } else {
      errorDiv.textContent = data.error || 'Admin login failed';
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    errorDiv.textContent = 'Connection error. Please try again.';
    errorDiv.style.display = 'block';
  }

  submitBtn.disabled = false;
  btnText.style.display = 'inline';
  btnLoading.style.display = 'none';
}

async function superAdminLogout(): Promise<void> {
  await superAdminApiCall('/admin-auth/logout', { method: 'POST' });
  clearSuperAdminSession();
  showLoginScreen();
}

function showSuperAdminDashboard(): void {
  // Hide regular app container
  const appContainer = document.querySelector('.app-container') as HTMLElement;
  if (appContainer) appContainer.style.display = 'none';

  // Remove any existing admin dashboard
  document.getElementById('super-admin-dashboard')?.remove();

  const session = getSuperAdminSession();
  if (!session) return;

  // Create super admin dashboard
  const dashboard = document.createElement('div');
  dashboard.id = 'super-admin-dashboard';
  dashboard.className = 'super-admin-dashboard';
  dashboard.innerHTML = `
    <div class="sa-sidebar">
      <div class="sa-header">
        <h2>CMS Admin</h2>
        <p>Welcome, ${session.admin.displayName}</p>
      </div>
      <nav class="sa-nav">
        <button class="sa-nav-item active" data-section="dashboard">Dashboard</button>
        <button class="sa-nav-item" data-section="modules">Modules</button>
        <button class="sa-nav-item" data-section="exam">Exam Questions</button>
        <button class="sa-nav-item" data-section="scenarios">Scenarios</button>
        <button class="sa-nav-item" data-section="audit">Audit Log</button>
      </nav>
      <button class="sa-logout-btn" id="sa-logout">Logout</button>
    </div>
    <div class="sa-main" id="sa-main-content">
      <div class="sa-loading">Loading...</div>
    </div>
  `;

  document.body.appendChild(dashboard);

  // Add event listeners
  document.querySelectorAll('.sa-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sa-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const section = (btn as HTMLElement).dataset.section;
      loadSuperAdminSection(section || 'dashboard');
    });
  });

  document.getElementById('sa-logout')?.addEventListener('click', superAdminLogout);

  // Load dashboard
  loadSuperAdminSection('dashboard');
}

async function loadSuperAdminSection(section: string): Promise<void> {
  const mainContent = document.getElementById('sa-main-content');
  if (!mainContent) return;

  mainContent.innerHTML = '<div class="sa-loading">Loading...</div>';

  switch (section) {
    case 'dashboard':
      await loadCMSDashboard();
      break;
    case 'modules':
      await loadCMSModules();
      break;
    case 'exam':
      await loadCMSExamQuestions();
      break;
    case 'scenarios':
      await loadCMSScenarios();
      break;
    case 'audit':
      await loadCMSAuditLog();
      break;
  }
}

async function loadCMSDashboard(): Promise<void> {
  const mainContent = document.getElementById('sa-main-content');
  if (!mainContent) return;

  const modules = await superAdminApiCall<{ modules: any[] }>('/cms/modules');
  const questions = await superAdminApiCall<{ questions: any[] }>('/cms/exam/questions');
  const packs = await superAdminApiCall<{ packs: any[] }>('/cms/scenarios/packs');

  mainContent.innerHTML = `
    <div class="sa-dashboard">
      <h1>CMS Dashboard</h1>
      <div class="sa-stats-grid">
        <div class="sa-stat-card">
          <div class="sa-stat-number">${modules?.modules?.length || 0}</div>
          <div class="sa-stat-label">Modules</div>
        </div>
        <div class="sa-stat-card">
          <div class="sa-stat-number">${questions?.questions?.length || 0}</div>
          <div class="sa-stat-label">Exam Questions</div>
        </div>
        <div class="sa-stat-card">
          <div class="sa-stat-number">${packs?.packs?.reduce((sum, p) => sum + (p.scenarioCount || 0), 0) || 0}</div>
          <div class="sa-stat-label">Scenarios</div>
        </div>
      </div>
      <div class="sa-quick-actions">
        <h2>Quick Actions</h2>
        <button class="sa-action-btn" onclick="document.querySelector('[data-section=modules]').click()">Edit Modules</button>
        <button class="sa-action-btn" onclick="document.querySelector('[data-section=exam]').click()">Manage Exam Questions</button>
        <button class="sa-action-btn" onclick="document.querySelector('[data-section=scenarios]').click()">Edit Scenarios</button>
      </div>
    </div>
  `;
}

async function seedModulesFromTrainingContent(): Promise<void> {
  const importBtn = document.getElementById('import-content-btn') as HTMLButtonElement;
  const btnText = importBtn?.querySelector('.btn-text') as HTMLElement;
  const btnLoading = importBtn?.querySelector('.btn-loading') as HTMLElement;

  if (importBtn) {
    importBtn.disabled = true;
    if (btnText) btnText.style.display = 'none';
    if (btnLoading) btnLoading.style.display = 'inline';
  }

  const moduleNames: Record<string, string> = {
    'welcome': 'Welcome & Company Intro',
    'commitment': 'Your Commitment',
    'general-knowledge': 'General Roofing Knowledge',
    'shingle-types-materials': 'Shingle Types & Materials',
    'initial-pitch': 'The Initial Pitch',
    'handling-initial-pitch-objections': 'Initial Pitch Objections',
    'inspection-process': 'The Inspection Process',
    'post-inspection-pitch': 'Post-Inspection Pitch',
    'post-inspection-objections': 'Post-Inspection Objections',
    'damage-identification': 'Damage Identification',
    'filing-claim-closing': 'Filing the Claim & Contingency + Claim Authorization Script',
    'sales-cycle-job-flow': 'The Sales Cycle & Job Flow',
    'role-play': 'AI Role-Play',
    'final-exam': 'Final Exam'
  };

  const modules = MODULE_ORDER.map((id, index) => ({
    id,
    title: moduleNames[id] || id,
    orderIndex: index,
    htmlContent: trainingContent[id as keyof typeof trainingContent] || ''
  }));

  try {
    const result = await superAdminApiCall<{ success: boolean; seededCount: number; message: string }>('/cms/seed-modules', {
      method: 'POST',
      body: JSON.stringify({ modules })
    });

    if (result?.success) {
      alert(`Success! ${result.seededCount} modules imported to database.`);
      await loadCMSModules(); // Refresh the list
    } else {
      alert('Import failed: ' + (result?.message || 'Unknown error'));
      if (importBtn) {
        importBtn.disabled = false;
        if (btnText) btnText.style.display = 'inline';
        if (btnLoading) btnLoading.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Seed error:', error);
    alert('Import failed. Check console for details.');
    if (importBtn) {
      importBtn.disabled = false;
      if (btnText) btnText.style.display = 'inline';
      if (btnLoading) btnLoading.style.display = 'none';
    }
  }
}

async function loadCMSModules(): Promise<void> {
  const mainContent = document.getElementById('sa-main-content');
  if (!mainContent) return;

  const data = await superAdminApiCall<{ modules: any[] }>('/cms/modules');

  if (!data?.modules?.length) {
    mainContent.innerHTML = `
      <div class="sa-section">
        <h1>Modules</h1>
        <p class="sa-empty">No modules in database yet.</p>
        <div class="sa-import-section">
          <button class="sa-action-btn sa-import-btn" id="import-content-btn">
            <span class="btn-text">📥 Import Existing Training Content</span>
            <span class="btn-loading" style="display: none;">Importing...</span>
          </button>
          <p class="sa-import-hint">This will import all ${MODULE_ORDER.length} training modules from the app into the CMS database.</p>
        </div>
        <button class="sa-action-btn" id="create-module-btn" style="margin-top: 20px;">Or Create New Module</button>
      </div>
    `;

    document.getElementById('import-content-btn')?.addEventListener('click', seedModulesFromTrainingContent);
    return;
  }

  mainContent.innerHTML = `
    <div class="sa-section">
      <div class="sa-section-header">
        <h1>Modules (${data.modules.length})</h1>
        <button class="sa-action-btn" id="create-module-btn">+ New Module</button>
      </div>
      <div class="sa-module-list">
        ${data.modules.map(mod => `
          <div class="sa-module-card" data-id="${mod.id}">
            <div class="sa-module-info">
              <h3>${mod.title}</h3>
              <span class="sa-module-id">${mod.id}</span>
              <span class="sa-module-status ${mod.status}">${mod.status || 'No content'}</span>
            </div>
            <div class="sa-module-actions">
              <button class="sa-edit-btn" data-id="${mod.id}">Edit Content</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Add edit handlers
  document.querySelectorAll('.sa-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id;
      openModuleEditor(id || '');
    });
  });
}

async function openModuleEditor(moduleId: string): Promise<void> {
  const mainContent = document.getElementById('sa-main-content');
  if (!mainContent) return;

  const data = await superAdminApiCall<{ module: any; content: any; versions: any[] }>(`/cms/modules/${moduleId}`);

  if (!data) {
    mainContent.innerHTML = '<div class="sa-error">Failed to load module</div>';
    return;
  }

  mainContent.innerHTML = `
    <div class="sa-editor">
      <div class="sa-editor-header">
        <button class="sa-back-btn" id="back-to-modules">&larr; Back to Modules</button>
        <h1>Editing: ${data.module.title}</h1>
        <div class="sa-editor-controls">
          <div class="sa-editor-mode-toggle">
            <button class="sa-mode-btn active" data-mode="html">HTML</button>
            <button class="sa-mode-btn" data-mode="visual">Visual</button>
          </div>
          <div class="sa-editor-actions">
            <button class="sa-save-btn" id="save-draft">Save Draft</button>
            <button class="sa-publish-btn" id="publish-content">Publish</button>
          </div>
        </div>
      </div>
      <div class="sa-editor-version">
        <label>Version: </label>
        <select id="version-select">
          ${data.versions.map(v => `
            <option value="${v.version}" ${v.version === data.content?.version ? 'selected' : ''}>
              v${v.version} (${v.status})
            </option>
          `).join('')}
          <option value="new">+ New Draft</option>
        </select>
      </div>
      <div class="sa-editor-container">
        <div class="sa-editor-pane">
          <h3 id="editor-mode-label">HTML Content</h3>
          <textarea id="html-editor" class="sa-html-editor">${data.content?.htmlContent || ''}</textarea>
          <div id="visual-editor" class="sa-visual-editor" contenteditable="true" style="display: none;">${data.content?.htmlContent || ''}</div>
        </div>
        <div class="sa-preview-pane">
          <h3>Preview</h3>
          <div id="preview-content" class="sa-preview-content">${data.content?.htmlContent || ''}</div>
        </div>
      </div>
    </div>
  `;

  // Editor elements
  const htmlEditor = document.getElementById('html-editor') as HTMLTextAreaElement;
  const visualEditor = document.getElementById('visual-editor') as HTMLDivElement;
  const preview = document.getElementById('preview-content');
  const editorModeLabel = document.getElementById('editor-mode-label');
  let currentMode: 'html' | 'visual' = 'html';

  // Get current content from active editor
  const getEditorContent = () => {
    return currentMode === 'html' ? htmlEditor.value : visualEditor.innerHTML;
  };

  // Live preview for HTML mode
  htmlEditor?.addEventListener('input', () => {
    if (preview) preview.innerHTML = htmlEditor.value;
  });

  // Live preview for Visual mode
  visualEditor?.addEventListener('input', () => {
    if (preview) preview.innerHTML = visualEditor.innerHTML;
  });

  // Mode toggle buttons
  document.querySelectorAll('.sa-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as 'html' | 'visual';
      if (mode === currentMode) return;

      // Update active button
      document.querySelectorAll('.sa-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (mode === 'visual') {
        // Sync HTML to Visual
        visualEditor.innerHTML = htmlEditor.value;
        htmlEditor.style.display = 'none';
        visualEditor.style.display = 'block';
        if (editorModeLabel) editorModeLabel.textContent = 'Visual Editor';
      } else {
        // Sync Visual to HTML
        htmlEditor.value = visualEditor.innerHTML;
        visualEditor.style.display = 'none';
        htmlEditor.style.display = 'block';
        if (editorModeLabel) editorModeLabel.textContent = 'HTML Content';
      }

      // Update preview
      if (preview) preview.innerHTML = mode === 'visual' ? visualEditor.innerHTML : htmlEditor.value;
      currentMode = mode;
    });
  });

  // Back button
  document.getElementById('back-to-modules')?.addEventListener('click', () => loadCMSModules());

  // Save draft
  document.getElementById('save-draft')?.addEventListener('click', async () => {
    const htmlContent = getEditorContent();
    const versionSelect = document.getElementById('version-select') as HTMLSelectElement;
    const isNewVersion = versionSelect.value === 'new';

    let result;
    if (isNewVersion) {
      result = await superAdminApiCall(`/cms/modules/${moduleId}/content`, {
        method: 'POST',
        body: JSON.stringify({ htmlContent })
      });
    } else {
      result = await superAdminApiCall(`/cms/modules/${moduleId}/content/${versionSelect.value}`, {
        method: 'PUT',
        body: JSON.stringify({ htmlContent })
      });
    }

    if (result) {
      alert('Draft saved successfully!');
      openModuleEditor(moduleId); // Refresh
    }
  });

  // Publish
  document.getElementById('publish-content')?.addEventListener('click', async () => {
    const versionSelect = document.getElementById('version-select') as HTMLSelectElement;
    const version = parseInt(versionSelect.value);

    if (isNaN(version)) {
      alert('Please save as a draft first before publishing');
      return;
    }

    if (confirm('Publish this version? It will become visible to all users.')) {
      const result = await superAdminApiCall(`/cms/modules/${moduleId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ version })
      });

      if (result) {
        alert('Published successfully!');
        openModuleEditor(moduleId); // Refresh
      }
    }
  });
}

async function loadCMSExamQuestions(): Promise<void> {
  const mainContent = document.getElementById('sa-main-content');
  if (!mainContent) return;

  const data = await superAdminApiCall<{ questions: any[] }>('/cms/exam/questions');

  const mcq = data?.questions?.filter(q => q.type === 'mcq') || [];
  const fib = data?.questions?.filter(q => q.type === 'fib') || [];
  const sa = data?.questions?.filter(q => q.type === 'sa') || [];

  mainContent.innerHTML = `
    <div class="sa-section">
      <div class="sa-section-header">
        <h1>Exam Questions</h1>
        <button class="sa-action-btn" id="create-question-btn">+ New Question</button>
      </div>
      <div class="sa-tabs">
        <button class="sa-tab active" data-type="mcq">MCQ (${mcq.length})</button>
        <button class="sa-tab" data-type="fib">Fill-in-Blank (${fib.length})</button>
        <button class="sa-tab" data-type="sa">Short Answer (${sa.length})</button>
      </div>
      <div id="questions-list" class="sa-questions-list">
        ${mcq.length ? mcq.map(q => questionCard(q)).join('') : '<p class="sa-empty">No MCQ questions yet</p>'}
      </div>
    </div>
  `;

  // Tab switching
  document.querySelectorAll('.sa-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sa-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const type = (tab as HTMLElement).dataset.type;
      const list = document.getElementById('questions-list');
      if (list) {
        const qs = type === 'mcq' ? mcq : type === 'fib' ? fib : sa;
        list.innerHTML = qs.length ? qs.map(q => questionCard(q)).join('') : `<p class="sa-empty">No ${type?.toUpperCase()} questions yet</p>`;
        attachQuestionHandlers();
      }
    });
  });

  attachQuestionHandlers();
}

function questionCard(q: any): string {
  return `
    <div class="sa-question-card ${q.isActive ? '' : 'inactive'}" data-id="${q.id}">
      <div class="sa-question-text">${q.questionText?.substring(0, 100)}...</div>
      <div class="sa-question-meta">
        <span class="sa-question-type">${q.type.toUpperCase()}</span>
        <span class="sa-question-points">${q.points} pts</span>
      </div>
      <div class="sa-question-actions">
        <button class="sa-edit-question" data-id="${q.id}" data-type="${q.type}">Edit</button>
        <button class="sa-delete-question" data-id="${q.id}">Delete</button>
      </div>
    </div>
  `;
}

function attachQuestionHandlers(): void {
  document.querySelectorAll('.sa-delete-question').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id;
      if (confirm('Delete this question?')) {
        await superAdminApiCall(`/cms/exam/questions/${id}`, { method: 'DELETE' });
        loadCMSExamQuestions();
      }
    });
  });
}

async function loadCMSScenarios(): Promise<void> {
  const mainContent = document.getElementById('sa-main-content');
  if (!mainContent) return;

  const data = await superAdminApiCall<{ packs: any[] }>('/cms/scenarios/packs');

  mainContent.innerHTML = `
    <div class="sa-section">
      <div class="sa-section-header">
        <h1>Role-Play Scenarios</h1>
        <button class="sa-action-btn" id="create-pack-btn">+ New Pack</button>
      </div>
      <div class="sa-packs-list">
        ${data?.packs?.length ? data.packs.map(pack => `
          <div class="sa-pack-card" data-id="${pack.id}">
            <h3>${pack.title}</h3>
            <span class="sa-scenario-count">${pack.scenarioCount} scenarios</span>
            <button class="sa-view-pack-btn" data-id="${pack.id}">View/Edit</button>
          </div>
        `).join('') : '<p class="sa-empty">No scenario packs yet</p>'}
      </div>
    </div>
  `;

  document.querySelectorAll('.sa-view-pack-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const packId = (btn as HTMLElement).dataset.id;
      await loadPackScenarios(packId || '');
    });
  });
}

async function loadPackScenarios(packId: string): Promise<void> {
  const mainContent = document.getElementById('sa-main-content');
  if (!mainContent) return;

  const data = await superAdminApiCall<{ scenarios: any[] }>(`/cms/scenarios?packId=${packId}`);

  mainContent.innerHTML = `
    <div class="sa-section">
      <div class="sa-section-header">
        <button class="sa-back-btn" id="back-to-packs">&larr; Back</button>
        <h1>Scenarios in Pack: ${packId}</h1>
        <button class="sa-action-btn" id="create-scenario-btn">+ New Scenario</button>
      </div>
      <div class="sa-scenarios-list">
        ${data?.scenarios?.length ? data.scenarios.map(s => `
          <div class="sa-scenario-card ${s.isActive ? '' : 'inactive'}">
            <div class="sa-scenario-role">${s.role}</div>
            <div class="sa-scenario-prompt">${s.prompt.substring(0, 150)}...</div>
            <div class="sa-scenario-actions">
              <button class="sa-edit-scenario" data-id="${s.id}">Edit</button>
              <button class="sa-delete-scenario" data-id="${s.id}">Delete</button>
            </div>
          </div>
        `).join('') : '<p class="sa-empty">No scenarios in this pack</p>'}
      </div>
    </div>
  `;

  document.getElementById('back-to-packs')?.addEventListener('click', () => loadCMSScenarios());

  document.querySelectorAll('.sa-delete-scenario').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id;
      if (confirm('Delete this scenario?')) {
        await superAdminApiCall(`/cms/scenarios/${id}`, { method: 'DELETE' });
        loadPackScenarios(packId);
      }
    });
  });
}

async function loadCMSAuditLog(): Promise<void> {
  const mainContent = document.getElementById('sa-main-content');
  if (!mainContent) return;

  const data = await superAdminApiCall<{ logs: any[] }>('/admin-auth/audit-log?limit=50');

  mainContent.innerHTML = `
    <div class="sa-section">
      <h1>Audit Log</h1>
      <div class="sa-audit-list">
        ${data?.logs?.length ? data.logs.map(log => `
          <div class="sa-audit-item">
            <div class="sa-audit-action">${log.action}</div>
            <div class="sa-audit-entity">${log.entityType}: ${log.entityId || 'N/A'}</div>
            <div class="sa-audit-time">${new Date(log.createdAt).toLocaleString()}</div>
          </div>
        `).join('') : '<p class="sa-empty">No audit logs yet</p>'}
      </div>
    </div>
  `;
}

// Helper function to get user initials
function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function updateUserDisplay(): void {
  const user = getCurrentUser();
  if (!user) return;

  // Add user info to sidebar header
  const sidebarHeader = document.querySelector('.sidebar-header');
  if (!sidebarHeader) return;

  let userInfo = document.getElementById('user-info');
  if (!userInfo) {
    userInfo = document.createElement('div');
    userInfo.id = 'user-info';
    userInfo.className = 'user-info user-card-glass';
    sidebarHeader.appendChild(userInfo);
  }

  // Calculate progress percentage (completed modules / total modules)
  const unlockedModules = getUnlockedModules();
  const totalModules = MODULE_ORDER.length;
  const completedCount = unlockedModules.length - 1; // Subtract 1 for initial unlocked modules
  const progressPct = Math.min(100, Math.round((completedCount / totalModules) * 100));

  userInfo.className = 'user-info user-card-glass';
  userInfo.innerHTML = `
    <div class="user-avatar-ring" style="--progress: ${progressPct}%">
      <div class="user-avatar-inner">${getInitials(user.name)}</div>
    </div>
    <div class="user-details">
      <div class="user-name-glass">${user.name}</div>
      <div class="user-meta">
        ${user.isManager ? '<span class="manager-badge-gradient">Manager</span>' : ''}
      </div>
    </div>
    <button id="logout-btn" class="logout-btn-glass" title="Log out">↪</button>
  `;

  // Add logout handler
  document.getElementById('logout-btn')?.addEventListener('click', logout);
}

// ============================================================================
// ADMIN DASHBOARD FUNCTIONALITY
// ============================================================================

interface AdminUser {
  id: string;
  name: string;
  isManager: boolean;
  registrationDate: string;
  lastLogin: string | null;
  commitmentSigned: boolean;
  modulesCompleted: number;
  examAttempts: number;
  isCertified: boolean;
  totalXP: number;
}

interface AdminAnalytics {
  overview: {
    totalUsers: number;
    newUsersThisWeek: number;
    activeUsers: number;
    certifiedUsers: number;
  };
  exam: {
    totalAttempts: number;
    totalPassed: number;
    passRate: number;
    averageScore: number;
  };
  modules: Array<{
    name: string;
    started: number;
    completed: number;
    completionRate: number;
  }>;
  roleplay: {
    totalSessions: number;
    completedSessions: number;
    averageScore: number;
    totalXPAwarded: number;
  };
}

let adminUsersCache: AdminUser[] = [];
let adminAnalyticsCache: AdminAnalytics | null = null;
let adminTimeTrackerCache: ModuleTimeAnalytics | null = null;
let adminProgressGridCache: ProgressGridData | null = null;

// Types for new admin tabs
interface ModuleTimeAnalytics {
  totalUsers: number;
  modules: {
    name: string;
    usersStarted: number;
    usersCompleted: number;
    usersInProgress: number;
    usersStale: number;
    avgTimeSeconds: number;
    minTimeSeconds: number;
    maxTimeSeconds: number;
    totalTimeSeconds: number;
    completionRate: number;
  }[];
}

interface ProgressGridData {
  totalUsers: number;
  userProgress: {
    userId: string;
    userName: string;
    lastLogin: string | null;
    registrationDate: string;
    moduleStatus: {
      module: string;
      status: string;
      timeSpent: number;
      startedAt: string | null;
      completedAt: string | null;
      lastActivity: string | null;
    }[];
  }[];
}

async function initAdminDashboard(): Promise<void> {
  const user = getCurrentUser();
  if (!user?.isManager && !isManagerMode()) {
    mainContent!.innerHTML = '<div class="content-card"><h1>Access Denied</h1><p>Admin dashboard is only available to managers.</p></div>';
    return;
  }

  // Set up tab switching
  const tabs = document.querySelectorAll('.admin-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = (tab as HTMLElement).dataset.tab;
      switchAdminTab(tabName || 'users');
    });
  });

  // Set up search
  const searchInput = document.getElementById('user-search') as HTMLInputElement;
  searchInput?.addEventListener('input', () => filterUsers(searchInput.value));

  // Set up refresh
  document.getElementById('refresh-users-btn')?.addEventListener('click', () => loadAdminUsers());

  // Set up modal close
  document.getElementById('close-user-modal')?.addEventListener('click', closeUserModal);

  // Set up progress grid search and refresh
  const progressGridSearch = document.getElementById('progress-grid-search') as HTMLInputElement;
  progressGridSearch?.addEventListener('input', debounce(() => {
    loadProgressGrid(progressGridSearch.value);
  }, 300));
  document.getElementById('refresh-progress-grid-btn')?.addEventListener('click', () => {
    const search = (document.getElementById('progress-grid-search') as HTMLInputElement)?.value || '';
    loadProgressGrid(search);
  });

  // Load initial data
  await loadAdminUsers();
}

// Debounce helper for search
function debounce(fn: (...args: any[]) => void, delay: number): (...args: any[]) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

function switchAdminTab(tabName: string): void {
  // Update tab buttons
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.classList.toggle('active', (tab as HTMLElement).dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.admin-tab-content').forEach(content => {
    (content as HTMLElement).style.display = 'none';
  });

  const targetContent = document.getElementById(`admin-${tabName}-tab`);
  if (targetContent) {
    targetContent.style.display = 'block';
  }

  // Load data if needed
  if (tabName === 'analytics' && !adminAnalyticsCache) {
    loadAdminAnalytics();
  }
  if (tabName === 'time-tracker' && !adminTimeTrackerCache) {
    loadTimeTracker();
  }
  if (tabName === 'progress-grid' && !adminProgressGridCache) {
    loadProgressGrid();
  }
}

async function loadAdminUsers(): Promise<void> {
  const container = document.getElementById('users-table-container');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Loading users...</p>';

  const result = await apiCall<{ users: AdminUser[]; totalUsers: number }>('/admin/users');

  if (!result) {
    container.innerHTML = '<p class="error-text">Failed to load users. Server may be unavailable.</p>';
    return;
  }

  adminUsersCache = result.users;
  renderUsersTable(adminUsersCache);
}

function renderUsersTable(users: AdminUser[]): void {
  const container = document.getElementById('users-table-container');
  if (!container) return;

  if (users.length === 0) {
    container.innerHTML = '<p class="empty-text">No users found.</p>';
    return;
  }

  const html = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Role</th>
          <th>Progress</th>
          <th>Certified</th>
          <th>Last Login</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(user => `
          <tr data-user-id="${user.id}">
            <td class="user-name-cell">
              <strong>${escapeHtml(user.name)}</strong>
              ${user.isCertified ? '<span class="cert-icon" title="Certified">🏆</span>' : ''}
            </td>
            <td>${user.isManager ? '<span class="role-badge manager">Manager</span>' : '<span class="role-badge user">User</span>'}</td>
            <td>
              <div class="progress-cell">
                <span class="modules-count">${user.modulesCompleted}/${MODULE_ORDER.length} modules</span>
                <span class="exam-count">${user.examAttempts}/3 attempts</span>
              </div>
            </td>
            <td>${user.isCertified ? '✅ Yes' : '❌ No'}</td>
            <td>${user.lastLogin ? formatRelativeDate(user.lastLogin) : 'Never'}</td>
            <td>
              <button class="btn-view-user" data-user-id="${user.id}">View Details</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = html;

  // Add click handlers for view buttons
  container.querySelectorAll('.btn-view-user').forEach(btn => {
    btn.addEventListener('click', () => {
      const userId = (btn as HTMLElement).dataset.userId;
      if (userId) showUserDetail(userId);
    });
  });
}

function filterUsers(searchTerm: string): void {
  const filtered = adminUsersCache.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase())
  );
  renderUsersTable(filtered);
}

async function showUserDetail(userId: string): Promise<void> {
  const modal = document.getElementById('user-detail-modal');
  const body = document.getElementById('user-detail-body');
  const title = document.getElementById('user-detail-title');

  if (!modal || !body || !title) return;

  body.innerHTML = '<p class="loading-text">Loading user details...</p>';
  modal.style.display = 'flex';

  const result = await apiCall<{
    user: any;
    modules: any[];
    examAttempts: any[];
    roleplaySessions: any[];
    certification: any;
    gamification: any;
    loginHistory: any[];
  }>(`/admin/users/${userId}`);

  if (!result) {
    body.innerHTML = '<p class="error-text">Failed to load user details.</p>';
    return;
  }

  title.textContent = `${result.user.name} - Details`;

  // Module order for transcript
  const moduleOrder = [
    'welcome', 'commitment', 'general-knowledge', 'sales-process', 'storm-types',
    'qualifying', 'roof-101', 'other-trades', 'insurance', 'damage-identification',
    'objection-handling', 'inspection', 'role-play', 'resources', 'agnes-quiz', 'final-exam'
  ];

  // Sort modules by defined order
  const sortedModules = moduleOrder.map(name => {
    const found = result.modules.find(m => m.name === name);
    return found || { name, status: 'not_started', timeSpentSeconds: 0, startedAt: null, completedAt: null };
  });

  // Calculate total time
  const totalTimeSeconds = result.modules.reduce((sum, m) => sum + (m.timeSpentSeconds || 0), 0);
  const completedCount = result.modules.filter(m => m.status === 'completed').length;

  // Format short date
  function formatShortDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  // Get status badge
  function getStatusBadge(status: string): string {
    switch (status) {
      case 'completed': return '<span class="status-badge completed">✅ Done</span>';
      case 'in_progress': return '<span class="status-badge in-progress">🟡 Active</span>';
      case 'unlocked': return '<span class="status-badge unlocked">🔓 Ready</span>';
      default: return '<span class="status-badge locked">⬜ Locked</span>';
    }
  }

  body.innerHTML = `
    <div class="user-detail-sections">
      <div class="detail-section">
        <h3>📋 Overview</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Role:</span>
            <span class="value">${result.user.isManager ? 'Manager' : 'User'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Registered:</span>
            <span class="value">${formatDate(result.user.registrationDate)}</span>
          </div>
          <div class="detail-item">
            <span class="label">Last Login:</span>
            <span class="value">${result.user.lastLogin ? formatRelativeDate(result.user.lastLogin) : 'Never'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Commitment:</span>
            <span class="value">${result.user.commitmentSigned ? '✅ Signed' : '❌ Not signed'}</span>
          </div>
        </div>
      </div>

      <div class="detail-section transcript-section">
        <h3>📚 Training Transcript</h3>
        <div class="transcript-summary">
          <span class="summary-item"><strong>Total Time:</strong> ${formatSeconds(totalTimeSeconds)}</span>
          <span class="summary-item"><strong>Modules:</strong> ${completedCount}/${MODULE_ORDER.length} Complete</span>
          <button class="btn-unlock-all" data-user-id="${userId}">🔓 Unlock All Modules</button>
        </div>
        <table class="transcript-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Module</th>
              <th>Status</th>
              <th>Time</th>
              <th>Completed</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${sortedModules.map((m, i) => `
              <tr class="module-row ${m.status}">
                <td class="module-num">${i + 1}</td>
                <td class="module-name">${formatModuleName(m.name)}</td>
                <td>${getStatusBadge(m.status)}</td>
                <td class="time-cell">${m.timeSpentSeconds ? formatSeconds(m.timeSpentSeconds) : '-'}</td>
                <td class="date-cell">${formatShortDate(m.completedAt)}</td>
                <td class="action-cell">
                  ${m.status === 'locked' || m.status === 'not_started' ?
                    `<button class="btn-unlock-module" data-user-id="${userId}" data-module="${m.name}">🔓 Unlock</button>` :
                    '<span class="already-unlocked">✓</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="detail-section exam-section">
        <h3>📝 Exam Records (${result.examAttempts.length}/3 attempts)</h3>
        ${result.certification ? `<div class="cert-banner">🏆 Certified on ${formatDate(result.certification.certifiedAt)} with score ${result.certification.score}%</div>` : ''}
        ${result.examAttempts.length > 0 ? `
          <div class="exam-attempts-list">
            ${result.examAttempts.map(a => `
              <div class="exam-attempt-card ${a.passed ? 'passed' : 'failed'}">
                <div class="attempt-header">
                  <span class="attempt-num">Attempt ${a.attemptNumber}</span>
                  <span class="attempt-score">${a.totalScore}%</span>
                  <span class="attempt-status">${a.passed ? '✅ Passed' : '❌ Failed'}</span>
                  <span class="attempt-date">${a.completedAt ? formatDate(a.completedAt) : 'In progress'}</span>
                  ${a.completedAt ? `<button class="btn-view-answers" data-user-id="${userId}" data-attempt-id="${a.id}">View Answers</button>` : ''}
                </div>
                <div class="attempt-breakdown">
                  <span>MCQ: ${a.mcqScore || 0}/35</span>
                  <span>Fill-in: ${a.fibScore || 0}/10</span>
                  <span>Short Answer: ${(a.saScore || 0) * 2}/20 pts</span>
                </div>
                <div class="exam-answers-container" id="exam-answers-${a.id}" style="display:none;">
                  <p class="loading-text">Loading answers...</p>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p class="no-data">No exam attempts yet.</p>'}
      </div>

      <div class="detail-section">
        <h3>🎭 Roleplay Sessions (${result.roleplaySessions.length})</h3>
        ${result.roleplaySessions.length > 0 ? `
          <div class="roleplay-stats">
            <div class="stat-box">
              <span class="stat-value">${result.roleplaySessions.length}</span>
              <span class="stat-label">Total</span>
            </div>
            <div class="stat-box">
              <span class="stat-value">${result.roleplaySessions.filter(r => r.completedAt).length}</span>
              <span class="stat-label">Completed</span>
            </div>
            <div class="stat-box highlight">
              <span class="stat-value">${result.roleplaySessions.reduce((sum, r) => sum + (r.xpEarned || 0), 0)}</span>
              <span class="stat-label">Total XP</span>
            </div>
          </div>
        ` : '<p class="no-data">No roleplay sessions yet.</p>'}
      </div>

      <div class="detail-section actions-section">
        <h3>⚙️ Actions</h3>
        <div class="action-buttons">
          <button class="btn-action btn-reset-exam" data-user-id="${userId}">Reset Exam Attempts</button>
          <button class="btn-action btn-reset-progress btn-danger" data-user-id="${userId}">Reset All Progress</button>
        </div>
      </div>
    </div>
  `;

  // Add action handlers
  body.querySelector('.btn-reset-exam')?.addEventListener('click', () => resetUserExam(userId));
  body.querySelector('.btn-reset-progress')?.addEventListener('click', () => resetUserProgress(userId));

  // Add unlock all modules handler
  body.querySelector('.btn-unlock-all')?.addEventListener('click', async () => {
    if (!confirm('Unlock all modules for this user?')) return;
    try {
      const response = await fetch(`/api/admin/users/${userId}/unlock-all-modules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      if (response.ok) {
        alert('All modules unlocked!');
        showUserDetail(userId); // Refresh modal
      } else {
        const error = await response.json();
        alert('Failed to unlock modules: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Unlock all error:', error);
      alert('Failed to unlock modules');
    }
  });

  // Add individual module unlock handlers
  body.querySelectorAll('.btn-unlock-module').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.target as HTMLElement;
      const userId = button.dataset.userId;
      const moduleName = button.dataset.module;
      if (!userId || !moduleName) return;

      try {
        const response = await fetch(`/api/admin/users/${userId}/unlock-module`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
          },
          body: JSON.stringify({ moduleName })
        });
        if (response.ok) {
          button.innerHTML = '✓';
          button.classList.add('unlocked');
          (button as HTMLButtonElement).disabled = true;
        } else {
          const error = await response.json();
          alert('Failed to unlock: ' + (error.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Unlock error:', error);
        alert('Failed to unlock module');
      }
    });
  });

  // Add View Answers handlers
  body.querySelectorAll('.btn-view-answers').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.target as HTMLElement;
      const attemptId = button.dataset.attemptId;
      const userId = button.dataset.userId;
      if (attemptId && userId) {
        await loadExamAnswers(userId, attemptId);
      }
    });
  });
}

// Load and display exam answers
async function loadExamAnswers(userId: string, attemptId: string): Promise<void> {
  const container = document.getElementById(`exam-answers-${attemptId}`);
  if (!container) return;

  // Toggle visibility
  if (container.style.display === 'block') {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = '<p class="loading-text">Loading answers...</p>';

  const result = await apiCall<{
    attemptId: string;
    attemptNumber: number;
    totalScore: number;
    passed: boolean;
    timeTaken: number;
    sections: {
      mcq: { correct: number; total: number; points: number };
      fib: { correct: number; total: number; points: number };
      sa: { correct: number; total: number; points: number };
    };
    answers: {
      questionType: string;
      questionNumber: number;
      questionText: string;
      userAnswer: string;
      correctAnswer: string;
      isCorrect: boolean;
      pointsEarned: number;
    }[];
  }>(`/admin/users/${userId}/exam/${attemptId}/answers`);

  if (!result) {
    container.innerHTML = '<p class="error-text">Failed to load exam answers.</p>';
    return;
  }

  // Group answers by type
  const mcqAnswers = result.answers.filter(a => a.questionType === 'mcq');
  const fibAnswers = result.answers.filter(a => a.questionType === 'fib');
  const saAnswers = result.answers.filter(a => a.questionType === 'sa');

  container.innerHTML = `
    <div class="answers-detail">
      <div class="section-scores">
        <span class="section-score">MCQ: ${result.sections.mcq.correct}/${result.sections.mcq.total}</span>
        <span class="section-score">Fill-in-Blank: ${result.sections.fib.correct}/${result.sections.fib.total}</span>
        <span class="section-score">Short Answer: ${result.sections.sa.points} pts</span>
        ${result.timeTaken ? `<span class="time-taken">Time: ${formatSeconds(result.timeTaken)}</span>` : ''}
      </div>

      ${mcqAnswers.length > 0 ? `
        <div class="answer-section">
          <h4>Multiple Choice (${result.sections.mcq.correct}/${result.sections.mcq.total})</h4>
          <div class="answer-list">
            ${mcqAnswers.map(a => `
              <div class="answer-item ${a.isCorrect ? 'correct' : 'incorrect'}">
                <span class="q-num">Q${a.questionNumber}:</span>
                <span class="answer-icon">${a.isCorrect ? '✅' : '❌'}</span>
                <span class="user-ans">${escapeHtml(a.userAnswer || '-')}</span>
                ${!a.isCorrect && a.correctAnswer ? `<span class="correct-ans">→ ${escapeHtml(a.correctAnswer)}</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${fibAnswers.length > 0 ? `
        <div class="answer-section">
          <h4>Fill-in-the-Blank (${result.sections.fib.correct}/${result.sections.fib.total})</h4>
          <div class="answer-list">
            ${fibAnswers.map(a => `
              <div class="answer-item ${a.isCorrect ? 'correct' : 'incorrect'}">
                <span class="q-num">Q${a.questionNumber}:</span>
                <span class="answer-icon">${a.isCorrect ? '✅' : '❌'}</span>
                <span class="user-ans">"${escapeHtml(a.userAnswer || '-')}"</span>
                ${!a.isCorrect && a.correctAnswer ? `<span class="correct-ans">→ "${escapeHtml(a.correctAnswer)}"</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${saAnswers.length > 0 ? `
        <div class="answer-section">
          <h4>Short Answer (${result.sections.sa.points} pts)</h4>
          <div class="answer-list sa-answers">
            ${saAnswers.map(a => `
              <div class="answer-item sa-item ${a.isCorrect ? 'correct' : 'partial'}">
                <div class="sa-header">
                  <span class="q-num">Q${a.questionNumber}:</span>
                  <span class="points-earned">${a.pointsEarned} pts</span>
                </div>
                <div class="sa-answer">${escapeHtml(a.userAnswer || 'No answer provided')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${result.answers.length === 0 ? '<p class="no-data">No answer details recorded for this attempt.</p>' : ''}
    </div>
  `;
}

function closeUserModal(): void {
  const modal = document.getElementById('user-detail-modal');
  if (modal) modal.style.display = 'none';
}

async function resetUserExam(userId: string): Promise<void> {
  if (!confirm('Are you sure you want to reset this user\'s exam attempts? This will remove all exam history and certification.')) {
    return;
  }

  const result = await apiCall<{ success: boolean }>(`/admin/users/${userId}/reset-exam`, { method: 'POST' });

  if (result?.success) {
    alert('Exam attempts reset successfully.');
    showUserDetail(userId); // Refresh detail view
    loadAdminUsers(); // Refresh users list
  } else {
    alert('Failed to reset exam attempts.');
  }
}

async function resetUserProgress(userId: string): Promise<void> {
  if (!confirm('Are you sure you want to reset ALL progress for this user? This cannot be undone!')) {
    return;
  }

  const result = await apiCall<{ success: boolean }>(`/admin/users/${userId}/reset-progress`, { method: 'POST' });

  if (result?.success) {
    alert('All progress reset successfully.');
    showUserDetail(userId); // Refresh detail view
    loadAdminUsers(); // Refresh users list
  } else {
    alert('Failed to reset progress.');
  }
}

async function loadAdminAnalytics(): Promise<void> {
  const container = document.getElementById('analytics-container');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Loading analytics...</p>';

  const result = await apiCall<AdminAnalytics>('/admin/analytics');

  if (!result) {
    container.innerHTML = '<p class="error-text">Failed to load analytics. Server may be unavailable.</p>';
    return;
  }

  adminAnalyticsCache = result;
  renderAnalytics(result);
}

function renderAnalytics(data: AdminAnalytics): void {
  const container = document.getElementById('analytics-container');
  if (!container) return;

  container.innerHTML = `
    <div class="analytics-grid">
      <div class="analytics-card overview-card">
        <h3>👥 Users Overview</h3>
        <div class="stat-grid">
          <div class="stat-item">
            <span class="stat-value">${data.overview.totalUsers}</span>
            <span class="stat-label">Total Users</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${data.overview.newUsersThisWeek}</span>
            <span class="stat-label">New This Week</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${data.overview.activeUsers}</span>
            <span class="stat-label">Active (7 days)</span>
          </div>
          <div class="stat-item highlight">
            <span class="stat-value">${data.overview.certifiedUsers}</span>
            <span class="stat-label">Certified</span>
          </div>
        </div>
      </div>

      <div class="analytics-card exam-card">
        <h3>📝 Exam Stats</h3>
        <div class="stat-grid">
          <div class="stat-item">
            <span class="stat-value">${data.exam.totalAttempts}</span>
            <span class="stat-label">Total Attempts</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${data.exam.totalPassed}</span>
            <span class="stat-label">Passed</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${data.exam.passRate}%</span>
            <span class="stat-label">Pass Rate</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${data.exam.averageScore || 0}%</span>
            <span class="stat-label">Avg Score</span>
          </div>
        </div>
      </div>

      <div class="analytics-card roleplay-card">
        <h3>🎭 Roleplay Stats</h3>
        <div class="stat-grid">
          <div class="stat-item">
            <span class="stat-value">${data.roleplay.totalSessions}</span>
            <span class="stat-label">Total Sessions</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${data.roleplay.completedSessions}</span>
            <span class="stat-label">Completed</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${data.roleplay.averageScore || 0}</span>
            <span class="stat-label">Avg Score</span>
          </div>
          <div class="stat-item highlight">
            <span class="stat-value">${data.roleplay.totalXPAwarded}</span>
            <span class="stat-label">Total XP</span>
          </div>
        </div>
      </div>

      <div class="analytics-card modules-card">
        <h3>📚 Module Completion Rates</h3>
        <div class="module-bars">
          ${data.modules.map(m => `
            <div class="module-bar-item">
              <span class="module-bar-name">${formatModuleName(m.name)}</span>
              <div class="module-bar-track">
                <div class="module-bar-fill" style="width: ${m.completionRate}%"></div>
              </div>
              <span class="module-bar-rate">${m.completionRate}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// Time Tracker Tab Functions
async function loadTimeTracker(): Promise<void> {
  const container = document.getElementById('time-tracker-container');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Loading time analytics...</p>';

  const result = await apiCall<ModuleTimeAnalytics>('/admin/module-analytics');

  if (!result) {
    container.innerHTML = '<p class="error-text">Failed to load time analytics. Server may be unavailable.</p>';
    return;
  }

  adminTimeTrackerCache = result;
  renderTimeTracker(result);
}

function renderTimeTracker(data: ModuleTimeAnalytics): void {
  const container = document.getElementById('time-tracker-container');
  if (!container) return;

  // Module order for sorting
  const moduleOrder = [
    'welcome', 'commitment', 'general-knowledge', 'sales-process', 'storm-types',
    'qualifying', 'roof-101', 'other-trades', 'insurance', 'damage-identification',
    'objection-handling', 'inspection', 'role-play', 'resources', 'agnes-quiz', 'final-exam'
  ];

  // Sort modules by the defined order
  const sortedModules = [...data.modules].sort((a, b) => {
    const indexA = moduleOrder.indexOf(a.name);
    const indexB = moduleOrder.indexOf(b.name);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  // Calculate difficulty color based on avg time (green = fast, yellow = medium, red = slow)
  function getDifficultyColor(avgSeconds: number): string {
    if (avgSeconds === 0) return '#9ca3af'; // gray for no data
    if (avgSeconds < 120) return '#22c55e'; // green - under 2 min
    if (avgSeconds < 300) return '#84cc16'; // lime - 2-5 min
    if (avgSeconds < 600) return '#eab308'; // yellow - 5-10 min
    if (avgSeconds < 1200) return '#f97316'; // orange - 10-20 min
    return '#ef4444'; // red - over 20 min
  }

  container.innerHTML = `
    <div class="time-tracker-summary">
      <div class="summary-stat">
        <span class="stat-value">${data.totalUsers}</span>
        <span class="stat-label">Total Reps</span>
      </div>
      <div class="summary-stat">
        <span class="stat-value">${sortedModules.filter(m => m.usersInProgress > 0).length}</span>
        <span class="stat-label">Modules In Progress</span>
      </div>
      <div class="summary-stat warning">
        <span class="stat-value">${sortedModules.reduce((sum, m) => sum + m.usersStale, 0)}</span>
        <span class="stat-label">Stale Users (>48hrs)</span>
      </div>
    </div>

    <table class="time-tracker-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Module</th>
          <th>Started</th>
          <th>Completed</th>
          <th>In Progress</th>
          <th>Stale</th>
          <th>Avg Time</th>
          <th>Fastest</th>
          <th>Slowest</th>
          <th>Completion %</th>
        </tr>
      </thead>
      <tbody>
        ${sortedModules.map((m, i) => `
          <tr>
            <td class="module-num">${i + 1}</td>
            <td class="module-name-cell">
              <span class="difficulty-dot" style="background-color: ${getDifficultyColor(m.avgTimeSeconds)}" title="Difficulty based on avg time"></span>
              ${formatModuleName(m.name)}
            </td>
            <td>${m.usersStarted}</td>
            <td>${m.usersCompleted}</td>
            <td>${m.usersInProgress}</td>
            <td class="${m.usersStale > 0 ? 'stale-warning' : ''}">${m.usersStale > 0 ? '⚠️ ' + m.usersStale : '0'}</td>
            <td class="time-cell">${formatSeconds(m.avgTimeSeconds)}</td>
            <td class="time-cell fastest">${formatSeconds(m.minTimeSeconds)}</td>
            <td class="time-cell slowest">${formatSeconds(m.maxTimeSeconds)}</td>
            <td>
              <div class="completion-bar-mini">
                <div class="completion-fill" style="width: ${m.completionRate}%"></div>
                <span class="completion-text">${m.completionRate}%</span>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="time-tracker-legend">
      <h4>Difficulty Legend (based on avg completion time)</h4>
      <div class="legend-items">
        <span><span class="difficulty-dot" style="background-color: #22c55e"></span> Fast (&lt;2 min)</span>
        <span><span class="difficulty-dot" style="background-color: #84cc16"></span> Quick (2-5 min)</span>
        <span><span class="difficulty-dot" style="background-color: #eab308"></span> Medium (5-10 min)</span>
        <span><span class="difficulty-dot" style="background-color: #f97316"></span> Long (10-20 min)</span>
        <span><span class="difficulty-dot" style="background-color: #ef4444"></span> Complex (&gt;20 min)</span>
      </div>
    </div>
  `;
}

// Progress Grid Tab Functions
async function loadProgressGrid(searchTerm: string = ''): Promise<void> {
  const container = document.getElementById('progress-grid-container');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Loading progress grid...</p>';

  const url = searchTerm ? `/admin/progress-grid?search=${encodeURIComponent(searchTerm)}` : '/admin/progress-grid';
  const result = await apiCall<ProgressGridData>(url);

  if (!result) {
    container.innerHTML = '<p class="error-text">Failed to load progress grid. Server may be unavailable.</p>';
    return;
  }

  adminProgressGridCache = result;
  renderProgressGrid(result);
}

function renderProgressGrid(data: ProgressGridData): void {
  const container = document.getElementById('progress-grid-container');
  if (!container) return;

  if (data.userProgress.length === 0) {
    container.innerHTML = '<p class="empty-text">No users found matching your search.</p>';
    return;
  }

  // Module order for grid columns
  const moduleOrder = [
    'welcome', 'commitment', 'general-knowledge', 'sales-process', 'storm-types',
    'qualifying', 'roof-101', 'other-trades', 'insurance', 'damage-identification',
    'objection-handling', 'inspection', 'role-play', 'resources', 'agnes-quiz', 'final-exam'
  ];

  // Short names for header
  const shortNames: Record<string, string> = {
    'welcome': '1',
    'commitment': '2',
    'general-knowledge': '3',
    'sales-process': '4',
    'storm-types': '5',
    'qualifying': '6',
    'roof-101': '7',
    'other-trades': '8',
    'insurance': '9',
    'damage-identification': '10',
    'objection-handling': '11',
    'inspection': '12',
    'role-play': '13',
    'resources': '14',
    'agnes-quiz': '15',
    'final-exam': '16'
  };

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'completed': return '✅';
      case 'in_progress': return '🟡';
      case 'stale': return '🔴';
      case 'unlocked': return '🔓';
      default: return '⬜';
    }
  }

  function getStatusClass(status: string): string {
    switch (status) {
      case 'completed': return 'status-completed';
      case 'in_progress': return 'status-in-progress';
      case 'stale': return 'status-stale';
      case 'unlocked': return 'status-unlocked';
      default: return 'status-not-started';
    }
  }

  container.innerHTML = `
    <div class="progress-grid-stats">
      <span>Showing ${data.userProgress.length} user${data.userProgress.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="progress-grid-wrapper">
      <table class="progress-grid-table">
        <thead>
          <tr>
            <th class="user-col sticky-col">User</th>
            ${moduleOrder.map(m => `<th class="module-col" title="${formatModuleName(m)}">${shortNames[m]}</th>`).join('')}
            <th class="progress-col">Progress</th>
          </tr>
        </thead>
        <tbody>
          ${data.userProgress.map(user => {
            // Create a map for quick lookup
            const statusMap = new Map(user.moduleStatus.map(m => [m.module, m]));
            const completedCount = user.moduleStatus.filter(m => m.status === 'completed').length;
            const progressPct = Math.round((completedCount / moduleOrder.length) * 100);

            return `
              <tr>
                <td class="user-col sticky-col">
                  <div class="user-info">
                    <span class="user-name">${escapeHtml(user.userName)}</span>
                    <span class="user-login">${user.lastLogin ? formatRelativeDate(user.lastLogin) : 'Never'}</span>
                  </div>
                </td>
                ${moduleOrder.map(moduleName => {
                  const moduleData = statusMap.get(moduleName);
                  const status = moduleData?.status || 'not_started';
                  const timeSpent = moduleData?.timeSpent || 0;
                  const tooltip = `${formatModuleName(moduleName)}\\nStatus: ${status}\\nTime: ${formatSeconds(timeSpent)}`;
                  return `<td class="module-cell ${getStatusClass(status)}" title="${tooltip}">${getStatusIcon(status)}</td>`;
                }).join('')}
                <td class="progress-col">
                  <div class="mini-progress-bar">
                    <div class="mini-progress-fill" style="width: ${progressPct}%"></div>
                  </div>
                  <span class="progress-text">${completedCount}/${moduleOrder.length}</span>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Format seconds to human readable time
function formatSeconds(seconds: number): string {
  if (!seconds || seconds === 0) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Helper functions for admin
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatDate(dateStr);
}

function formatModuleName(name: string): string {
  return name
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .slice(0, 20);
}

function initializeApp(): void {
  currentUser = getCurrentUser();

  if (sidebar) {
    sidebar.addEventListener('click', handleNavigation);
  }
  mainContent?.addEventListener('click', handleSpeak);

  // Update user display
  updateUserDisplay();

  // Initialize manager mode UI and sidebar locks
  initManagerModeUI();
  updateSidebarLocks();

  // Check certified status
  const examState = getExamState();
  if (examState.isCertified) {
    updateSidebarCertifiedBadge(true);
  }

  renderModule('my-page');
  document.querySelector('#sidebar li[data-module="my-page"]')?.classList.add('active');
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize theme system immediately (applies saved preference or system default)
  initThemeSystem();

  // Check if user is logged in
  if (isLoggedIn()) {
    // Validate session with server (if available)
    const isValid = await validateSession();
    if (isValid) {
      hideLoginScreen();
      initializeApp();
    } else {
      // Session invalid, show login
      showLoginScreen();
    }
  } else {
    // Not logged in, show login screen
    showLoginScreen();
  }
});

// --- New helpers and initializers ---
const LEADER_BIOS: Record<string, {name: string; title: string; img: string; link: string; summary: string}> = {
  oliver: {
    name: 'Oliver Brown',
    title: 'Owner & Founder',
    img: '/resources/images/oliver-theroofdocs.jpg',
    link: 'https://www.theroofdocs.com/about/',
    summary: 'Owner & Founder focused on integrity, quality, and simplicity with a transparent, customer‑first process.'
  },
  reese: {
    name: 'Reese Samala',
    title: 'Director of Sales',
    img: '/resources/images/reese-theroofdocs.jpg',
    link: 'https://www.theroofdocs.com/about/',
    summary: 'Leads sales with a consultative, education‑forward approach that builds trust and results.'
  },
  ford: {
    name: 'Ford Barsi',
    title: 'General Manager',
    img: '/resources/images/ford-theroofdocs.jpg',
    link: 'https://www.theroofdocs.com/about/',
    summary: 'Oversees operations and execution, aligning teams and process from inspection to completion.'
  }
};

function initWelcomeModals() {
  const container = document.getElementById('main-content');
  if (!container) return;
  let overlay = document.getElementById('bio-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'bio-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="bioTitle">
        <div class="modal-header">
          <h3 id="bioTitle"></h3>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <img id="bioImg" alt="" />
          <div class="bio-text">
            <p id="bioSummary"></p>
            <p><a id="bioLink" href="#" target="_blank" rel="noopener">Read full bio</a></p>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  const close = () => { overlay!.classList.remove('show'); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.modal-close')?.addEventListener('click', close);
  document.addEventListener('keyup', (e) => { if ((e as KeyboardEvent).key === 'Escape') close(); });

  container.querySelectorAll('.bio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = (btn as HTMLElement).getAttribute('data-bio') || '';
      const bio = LEADER_BIOS[key];
      if (!bio) return;
      (overlay!.querySelector('#bioTitle') as HTMLElement).textContent = `${bio.name} — ${bio.title}`;
      const imgEl = overlay!.querySelector('#bioImg') as HTMLImageElement;
      imgEl.src = bio.img; imgEl.alt = bio.name;
      (overlay!.querySelector('#bioSummary') as HTMLElement).textContent = bio.summary;
      const linkEl = overlay!.querySelector('#bioLink') as HTMLAnchorElement;
      linkEl.href = bio.link;
      overlay!.classList.add('show');
    });
  });
}
// Commitment module state
let commitmentVideoWatched = false;
let commitmentInitialsCount = 0;

function initCommitmentGate() {
  const container = document.getElementById('main-content');
  if (!container) return;

  // Check if already completed
  const signed = localStorage.getItem(STORAGE_KEYS.commitmentSigned) === 'true';
  if (signed) {
    // Show completed state
    const signatureSection = document.getElementById('commitment-signature-section');
    const reqNotice = document.getElementById('commitment-requirements-notice');
    const videoNotice = document.getElementById('commitment-video-notice');
    if (signatureSection) {
      signatureSection.innerHTML = `
        <div class="commitment-completed">
          <span class="completed-icon">✓</span> You have already signed this commitment.
          <button class="reset-commitment-btn" id="reset-commitment-btn" style="margin-left: 15px; padding: 8px 16px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Reset (Testing)</button>
        </div>`;
      // Add reset button handler
      const resetBtn = document.getElementById('reset-commitment-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          if (confirm('Are you sure you want to reset this commitment? This will clear your signature and initials.')) {
            localStorage.removeItem(STORAGE_KEYS.commitmentSigned);
            for (let i = 1; i <= 8; i++) {
              localStorage.removeItem('commitment-initial-' + i);
            }
            localStorage.removeItem('video-watched-commitment-video');
            location.reload();
          }
        });
      }
    }
    if (reqNotice) reqNotice.style.display = 'none';
    if (videoNotice) videoNotice.style.display = 'none';
    // Show all checks and restore saved initials
    for (let i = 1; i <= 8; i++) {
      const check = document.getElementById(`check-${i}`);
      const item = document.querySelector(`.commitment-item[data-index="${i}"]`);
      const inputBox = document.getElementById(`initial-${i}`) as HTMLInputElement;
      if (check) check.classList.add('visible');
      if (item) item.classList.add('completed');
      // Restore saved initial and disable input
      if (inputBox) {
        const savedInitial = localStorage.getItem(`commitment-initial-${i}`);
        if (savedInitial) {
          inputBox.value = savedInitial;
        }
        inputBox.disabled = true;
        inputBox.classList.add('completed');
      }
    }
    return;
  }

  // Check if video was previously watched
  const videoWatchedKey = 'video-watched-commitment-video';
  commitmentVideoWatched = localStorage.getItem(videoWatchedKey) === 'true';

  // Initialize state
  commitmentInitialsCount = 0;

  // Set up video progress tracking for commitment video
  setupCommitmentVideoTracking();

  // Set up initial box listeners
  setupInitialBoxListeners();

  // Set up signature form
  setupSignatureForm();

  // Set up navigation links within module content
  setupModuleNavLinks();

  // Initial state check
  updateCommitmentRequirements();
}

// Handle navigation links within module content (e.g., reference links)
function setupModuleNavLinks() {
  const container = document.getElementById('main-content');
  if (!container) return;

  const navLinks = container.querySelectorAll('.nav-module-link');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetModule = (link as HTMLElement).dataset.module;
      const scrollToId = (link as HTMLElement).dataset.scrollTo;

      if (targetModule) {
        // Navigate to the module
        const sidebar = document.getElementById('sidebar');
        const navItem = sidebar?.querySelector(`[data-module="${targetModule}"]`);

        if (navItem) {
          // Simulate a click on the nav item to load the module
          (navItem as HTMLElement).click();

          // After module loads, scroll to the target element if specified
          if (scrollToId) {
            setTimeout(() => {
              const scrollTarget = document.getElementById(scrollToId);
              if (scrollTarget) {
                scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          }
        }
      }
    });
  });
}

function setupCommitmentVideoTracking() {
  const videoContainer = document.querySelector('.video-player-container video') as HTMLVideoElement;
  const progressText = document.getElementById('commitment-video-progress');

  if (videoContainer) {
    videoContainer.addEventListener('timeupdate', () => {
      const percent = Math.round((videoContainer.currentTime / videoContainer.duration) * 100);
      if (progressText) {
        progressText.textContent = `Video progress: ${percent}%`;
      }
      if (percent >= 90 && !commitmentVideoWatched) {
        commitmentVideoWatched = true;
        localStorage.setItem('video-watched-commitment-video', 'true');
        updateCommitmentRequirements();
      }
    });
  }

  // Check if already watched
  if (commitmentVideoWatched) {
    const videoNotice = document.getElementById('commitment-video-notice');
    if (videoNotice) {
      videoNotice.classList.add('completed');
      const progressText = document.getElementById('commitment-video-progress');
      if (progressText) progressText.textContent = 'Video completed ✓';
    }
  }
}

function setupInitialBoxListeners() {
  // Use more specific selector within commitment-initials-section
  const initialsSection = document.getElementById('commitment-initials-section');
  if (!initialsSection) {
    console.warn('Commitment initials section not found');
    return;
  }

  // Select each initial box by ID for reliability
  for (let i = 1; i <= 8; i++) {
    const inputBox = document.getElementById(`initial-${i}`) as HTMLInputElement;
    if (!inputBox) {
      console.warn(`Initial box #${i} not found`);
      continue;
    }

    const itemIndex = i;

    // Check for saved initials and restore
    const savedInitial = localStorage.getItem(`commitment-initial-${itemIndex}`);
    if (savedInitial) {
      inputBox.value = savedInitial;
      markInitialComplete(itemIndex, true);
    }

    // Add input listener
    inputBox.addEventListener('input', () => {
      const value = inputBox.value.trim().toUpperCase();
      // Update input to uppercase
      inputBox.value = value;

      if (value.length >= 2) {
        // Valid initial (at least 2 characters)
        localStorage.setItem(`commitment-initial-${itemIndex}`, value);
        markInitialComplete(itemIndex, true);
      } else {
        localStorage.removeItem(`commitment-initial-${itemIndex}`);
        markInitialComplete(itemIndex, false);
      }

      updateInitialsProgress();
      updateCommitmentRequirements();
    });

    // Also listen for blur (when user leaves the field)
    inputBox.addEventListener('blur', () => {
      const value = inputBox.value.trim().toUpperCase();
      inputBox.value = value;
      if (value.length >= 2) {
        localStorage.setItem(`commitment-initial-${itemIndex}`, value);
        markInitialComplete(itemIndex, true);
      }
      updateInitialsProgress();
      updateCommitmentRequirements();
    });
  }

  // Initial progress update
  updateInitialsProgress();
}

function markInitialComplete(itemIndex: number, isComplete: boolean) {
  const check = document.getElementById(`check-${itemIndex}`);
  const item = document.querySelector(`.commitment-item[data-index="${itemIndex}"]`);
  const inputBox = document.getElementById(`initial-${itemIndex}`) as HTMLInputElement;

  if (isComplete) {
    if (check) check.classList.add('visible');
    if (item) item.classList.add('completed');
    if (inputBox) inputBox.classList.add('completed');
  } else {
    if (check) check.classList.remove('visible');
    if (item) item.classList.remove('completed');
    if (inputBox) inputBox.classList.remove('completed');
  }
}

function updateInitialsProgress() {
  let count = 0;
  for (let i = 1; i <= 8; i++) {
    const saved = localStorage.getItem(`commitment-initial-${i}`);
    if (saved && saved.length >= 2) count++;
  }
  commitmentInitialsCount = count;

  const progressFill = document.getElementById('initials-progress-fill');
  const progressText = document.getElementById('initials-progress-text');

  if (progressFill) {
    progressFill.style.width = `${(count / 8) * 100}%`;
    progressFill.style.backgroundColor = count === 8 ? '#28a745' : '#c62828';
  }
  if (progressText) {
    progressText.textContent = count === 8 ? 'All commitments initialed ✓' : `${count} of 8 commitments initialed`;
  }
}

function updateCommitmentRequirements() {
  const reqVideo = document.getElementById('req-commitment-video');
  const reqInitials = document.getElementById('req-commitment-initials');
  const reqSignature = document.getElementById('req-commitment-signature');
  const signatureSection = document.getElementById('commitment-signature-section');
  const videoNotice = document.getElementById('commitment-video-notice');

  // Update video requirement
  if (reqVideo) {
    if (commitmentVideoWatched) {
      reqVideo.classList.remove('pending');
      reqVideo.classList.add('complete');
      reqVideo.innerHTML = '<span class="req-icon">✓</span> Watch the commitment video (90%+)';
    } else {
      reqVideo.classList.add('pending');
      reqVideo.classList.remove('complete');
      reqVideo.innerHTML = '<span class="req-icon">○</span> Watch the commitment video (90%+)';
    }
  }

  // Update video notice
  if (videoNotice) {
    if (commitmentVideoWatched) {
      videoNotice.classList.add('completed');
    }
  }

  // Update initials requirement
  if (reqInitials) {
    if (commitmentInitialsCount === 8) {
      reqInitials.classList.remove('pending');
      reqInitials.classList.add('complete');
      reqInitials.innerHTML = '<span class="req-icon">✓</span> Initial all 8 commitment statements';
    } else {
      reqInitials.classList.add('pending');
      reqInitials.classList.remove('complete');
      reqInitials.innerHTML = `<span class="req-icon">○</span> Initial all 8 commitment statements (${commitmentInitialsCount}/8)`;
    }
  }

  // Show signature section only when video watched AND all initials done
  if (signatureSection) {
    if (commitmentVideoWatched && commitmentInitialsCount === 8) {
      signatureSection.style.display = 'block';
      signatureSection.classList.add('revealed');
    } else {
      signatureSection.style.display = 'none';
    }
  }
}

function setupSignatureForm() {
  const submitBtn = document.getElementById('commitment-sig-submit');
  const nameInput = document.getElementById('commitment-sig-name') as HTMLInputElement;
  const agreeCheckbox = document.getElementById('commitment-sig-agree') as HTMLInputElement;
  const errorDiv = document.getElementById('commitment-sig-error');
  const reqSignature = document.getElementById('req-commitment-signature');

  if (!submitBtn) return;

  submitBtn.addEventListener('click', () => {
    const name = nameInput?.value?.trim();
    const agree = agreeCheckbox?.checked;

    // Validate
    if (!name || name.length < 3) {
      if (errorDiv) {
        errorDiv.textContent = 'Please enter your full legal name (at least 3 characters).';
        errorDiv.classList.add('visible');
      }
      return;
    }

    if (!agree) {
      if (errorDiv) {
        errorDiv.textContent = 'You must agree to the commitment statement.';
        errorDiv.classList.add('visible');
      }
      return;
    }

    // All validation passed - save and complete
    localStorage.setItem(STORAGE_KEYS.commitmentSigned, 'true');
    localStorage.setItem('commitment-signer-name', name);
    localStorage.setItem('commitment-signed-date', new Date().toISOString());

    // Update UI
    if (errorDiv) {
      errorDiv.classList.remove('visible');
    }

    // Update signature requirement
    if (reqSignature) {
      reqSignature.classList.remove('pending');
      reqSignature.classList.add('complete');
      reqSignature.innerHTML = '<span class="req-icon">✓</span> Provide your digital signature';
    }

    // Show success
    const signatureSection = document.getElementById('commitment-signature-section');
    if (signatureSection) {
      signatureSection.innerHTML = `
        <div class="commitment-completed">
          <span class="completed-icon">✓</span>
          <div class="completed-text">
            <strong>Commitment Signed!</strong>
            <p>Signed by: ${name}</p>
            <p>Date: ${new Date().toLocaleDateString()}</p>
          </div>
        </div>
      `;
    }

    // Complete the module
    completeModule('commitment');
  });
}

function initLeadershipBios() {
  const bioButtons = document.querySelectorAll('.bio-toggle-btn');
  bioButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const bioId = this.getAttribute('data-bio');
      const bioDiv = document.getElementById(bioId!);
      if (bioDiv) {
        if (bioDiv.style.display === 'none' || bioDiv.style.display === '') {
          bioDiv.style.display = 'block';
          this.textContent = 'Hide Bio';
        } else {
          bioDiv.style.display = 'none';
          this.textContent = 'My Bio';
        }
      }
    });
  });
}

function initQuickQuiz2() {
  const startBtn = document.getElementById('startQuickQuiz2');
  const area = document.getElementById('quiz2-area');
  if (!startBtn || !area) return;

  const quiz2Questions = [
    {
      question: "Which component is installed at the eaves to prevent ice dam damage?",
      options: ["Ridge vent", "Ice & Water Shield", "Hip cap shingles", "Starter strip"],
      correct: 1
    },
    {
      question: "What is the horizontal line at the peak of a roof where two planes meet?",
      options: ["Valley", "Ridge", "Eave", "Hip"],
      correct: 1
    },
    {
      question: "Where is flashing typically installed?",
      options: ["Under all shingles", "Around chimneys, vents, and valleys", "Only on flat roofs", "Along the gutter line"],
      correct: 1
    },
    {
      question: "What is a valley on a roof?",
      options: ["The peak where planes meet", "A flat section of roof", "Where two roof planes meet at a downward angle", "The bottom edge of the roof"],
      correct: 2
    },
    {
      question: "What is the purpose of drip edge?",
      options: ["Adds decoration to the roof", "Directs water away from fascia into gutters", "Holds shingles in place", "Provides ventilation"],
      correct: 1
    }
  ];

  let currentQuestion = 0;
  let score = 0;
  let answers: (number | null)[] = new Array(quiz2Questions.length).fill(null);

  function renderQuestion() {
    const q = quiz2Questions[currentQuestion];
    area.innerHTML = `
      <div class="quiz2-container">
        <div class="quiz2-progress">
          <span class="quiz2-progress-text">Question ${currentQuestion + 1} of ${quiz2Questions.length}</span>
          <div class="quiz2-progress-bar">
            <div class="quiz2-progress-fill" style="width: ${((currentQuestion + 1) / quiz2Questions.length) * 100}%"></div>
          </div>
        </div>
        <div class="quiz2-question">
          <h4>${q.question}</h4>
        </div>
        <div class="quiz2-options">
          ${q.options.map((opt, i) => `
            <label class="quiz2-option ${answers[currentQuestion] === i ? 'selected' : ''}">
              <input type="radio" name="quiz2q" value="${i}" ${answers[currentQuestion] === i ? 'checked' : ''}>
              <span class="option-letter">${String.fromCharCode(65 + i)}</span>
              <span class="option-text">${opt}</span>
            </label>
          `).join('')}
        </div>
        <div class="quiz2-nav">
          ${currentQuestion > 0 ? '<button class="quiz2-btn quiz2-prev">Previous</button>' : '<span></span>'}
          ${currentQuestion < quiz2Questions.length - 1
            ? '<button class="quiz2-btn quiz2-next" ' + (answers[currentQuestion] === null ? 'disabled' : '') + '>Next</button>'
            : '<button class="quiz2-btn quiz2-submit" ' + (answers[currentQuestion] === null ? 'disabled' : '') + '>Submit Quiz</button>'
          }
        </div>
      </div>
    `;

    // Add event listeners
    area.querySelectorAll('input[name="quiz2q"]').forEach((input) => {
      input.addEventListener('change', (e) => {
        answers[currentQuestion] = parseInt((e.target as HTMLInputElement).value);
        renderQuestion();
      });
    });

    const prevBtn = area.querySelector('.quiz2-prev');
    const nextBtn = area.querySelector('.quiz2-next');
    const submitBtn = area.querySelector('.quiz2-submit');

    prevBtn?.addEventListener('click', () => {
      currentQuestion--;
      renderQuestion();
    });

    nextBtn?.addEventListener('click', () => {
      currentQuestion++;
      renderQuestion();
    });

    submitBtn?.addEventListener('click', showResults);
  }

  function showResults() {
    score = 0;
    quiz2Questions.forEach((q, i) => {
      if (answers[i] === q.correct) score++;
    });

    const percentage = Math.round((score / quiz2Questions.length) * 100);
    const passed = percentage >= 80;

    area.innerHTML = `
      <div class="quiz2-results">
        <div class="quiz2-result-header ${passed ? 'passed' : 'failed'}">
          <span class="result-icon">${passed ? '🎉' : '📚'}</span>
          <h3>${passed ? 'Great Job!' : 'Keep Learning!'}</h3>
          <p class="result-score">${score}/${quiz2Questions.length} correct (${percentage}%)</p>
        </div>
        <div class="quiz2-result-details">
          ${quiz2Questions.map((q, i) => `
            <div class="result-item ${answers[i] === q.correct ? 'correct' : 'incorrect'}">
              <span class="result-marker">${answers[i] === q.correct ? '✓' : '✗'}</span>
              <div class="result-content">
                <p class="result-question">${q.question}</p>
                <p class="result-answer">
                  ${answers[i] === q.correct
                    ? `<span class="your-answer correct">Your answer: ${q.options[answers[i] ?? 0]}</span>`
                    : `<span class="your-answer incorrect">Your answer: ${answers[i] !== null ? q.options[answers[i]] : 'No answer'}</span>
                       <span class="correct-answer">Correct: ${q.options[q.correct]}</span>`
                  }
                </p>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="quiz2-result-actions">
          <button class="quiz2-btn quiz2-retry">Try Again</button>
        </div>
      </div>
    `;

    area.querySelector('.quiz2-retry')?.addEventListener('click', () => {
      currentQuestion = 0;
      score = 0;
      answers = new Array(quiz2Questions.length).fill(null);
      renderQuestion();
    });
  }

  startBtn.addEventListener('click', () => {
    startBtn.style.display = 'none';
    renderQuestion();
  });
}

// ============================================================================
// FINAL EXAM STATE MANAGEMENT
// ============================================================================

function getExamState(): ExamState {
  return {
    attempts: JSON.parse(localStorage.getItem(STORAGE_KEYS.finalExamHistory) || '[]'),
    isCertified: localStorage.getItem(STORAGE_KEYS.certifiedStatus) === 'true',
    certificationDate: localStorage.getItem(STORAGE_KEYS.certificationDate),
    userName: localStorage.getItem(STORAGE_KEYS.examUserName) || ''
  };
}

// Track current exam attempt ID from API
let currentExamAttemptId: string | null = null;

function saveExamAttempt(attempt: ExamAttempt): void {
  const state = getExamState();
  state.attempts.push(attempt);
  localStorage.setItem(STORAGE_KEYS.finalExamHistory, JSON.stringify(state.attempts));

  if (attempt.passed) {
    localStorage.setItem(STORAGE_KEYS.certifiedStatus, 'true');
    localStorage.setItem(STORAGE_KEYS.certificationDate, new Date().toISOString());
    updateSidebarCertifiedBadge(true);
  }
}

// Submit exam to API
async function submitExamToAPI(
  attemptId: string | null,
  results: { mcqCorrect: number; fibCorrect: number; saPoints: number; totalScore: number; passed: boolean },
  timeTaken: number,
  mcqAnswers?: any[],
  fibAnswers?: any[],
  saAnswers?: any[]
): Promise<void> {
  if (!attemptId) return;

  await apiCall('/exam/submit', {
    method: 'POST',
    body: JSON.stringify({
      attemptId,
      timeTaken,
      results,
      mcqAnswers,
      fibAnswers,
      saAnswers
    }),
    silent: true
  } as any);
}

// Start exam attempt via API
async function startExamAttemptAPI(): Promise<{ attemptId: string | null; remainingAttempts: number }> {
  const result = await apiCall<{ attemptId: string; attemptNumber: number; remainingAttempts: number } | { error: string; lockedOut?: boolean; isCertified?: boolean }>('/exam/start', {
    method: 'POST'
  });

  if (!result) {
    // Offline mode - use local tracking
    return { attemptId: null, remainingAttempts: getRemainingAttempts() };
  }

  if ('error' in result) {
    return { attemptId: null, remainingAttempts: 0 };
  }

  currentExamAttemptId = result.attemptId;
  return { attemptId: result.attemptId, remainingAttempts: result.remainingAttempts };
}

// ============================================================================
// ROLEPLAY SESSION API TRACKING
// ============================================================================

let currentRoleplaySessionId: string | null = null;

// Start roleplay session via API
async function startRoleplaySessionAPI(personality: string, difficulty: string, inputMode: string): Promise<string | null> {
  const result = await apiCall<{ sessionId: string }>('/roleplay/start', {
    method: 'POST',
    body: JSON.stringify({ personality, difficulty, inputMode }),
    silent: true
  } as any);

  if (result?.sessionId) {
    currentRoleplaySessionId = result.sessionId;
    return result.sessionId;
  }
  return null;
}

// End roleplay session via API
async function endRoleplaySessionAPI(sessionId: string | null, score: number, xpEarned: number, doorSlammed: boolean): Promise<void> {
  if (!sessionId) return;

  await apiCall('/roleplay/end', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      finalScore: score,
      xpEarned,
      doorSlammed
    }),
    silent: true
  } as any);

  currentRoleplaySessionId = null;
}

// Update roleplay score during session
async function updateRoleplayScoreAPI(sessionId: string | null, score: number): Promise<void> {
  if (!sessionId) return;

  await apiCall('/roleplay/score', {
    method: 'POST',
    body: JSON.stringify({ sessionId, score }),
    silent: true
  } as any);
}

function getRemainingAttempts(): number {
  const state = getExamState();
  if (state.isCertified) return 0; // Already passed
  return Math.max(0, 3 - state.attempts.length);
}

function isExamLockedOut(): boolean {
  const state = getExamState();
  return !state.isCertified && state.attempts.length >= 3;
}

function updateSidebarCertifiedBadge(isCertified: boolean): void {
  // Add badge to sidebar header
  const sidebarHeader = document.querySelector('.sidebar-header');
  let badge = document.getElementById('cert-badge');

  if (isCertified) {
    if (!badge && sidebarHeader) {
      badge = document.createElement('div');
      badge.id = 'cert-badge';
      badge.className = 'cert-badge certified-badge-glass';
      badge.innerHTML = '<span class="badge-icon">🏆</span><span class="badge-text">Certified</span>';
      sidebarHeader.appendChild(badge);
    }
    if (badge) {
      badge.className = 'cert-badge certified-badge-glass';
      badge.style.display = 'inline-flex';
    }

    // Add trophy to Final Exam module
    const examModule = document.querySelector('li[data-module="final-exam"]');
    if (examModule) examModule.classList.add('certified');
  } else if (badge) {
    badge.style.display = 'none';
  }
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function formatExamDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ============================================================================
// FINAL EXAM UI & LOGIC
// ============================================================================

let currentExamData: { mcq: MCQQuestion[], fib: FIBQuestion[], sa: SAQuestion[] } | null = null;

function initFinalExam() {
  const examArea = document.getElementById('exam-area');
  if (!examArea) return;

  const state = getExamState();

  // Show appropriate screen based on state
  if (state.isCertified) {
    showCertifiedScreen(examArea, state);
  } else if (isExamLockedOut()) {
    showLockoutScreen(examArea, state);
  } else {
    showExamStartScreen(examArea, state);
  }

  // Check certification badge on load
  updateSidebarCertifiedBadge(state.isCertified);
}

function showExamStartScreen(root: HTMLElement, state: ExamState) {
  const remaining = getRemainingAttempts();

  // Build attempts list separately to avoid nested template literal issues
  let attemptsListHtml = '';
  if (state.attempts.length > 0) {
    const attemptItems = state.attempts.map(a => {
      const statusClass = a.passed ? 'passed' : 'failed';
      const statusText = a.passed ? '✓ PASSED' : '✗ Failed';
      return '<li class="' + statusClass + '">Attempt ' + a.attemptNumber + ': ' + a.totalScore + '% on ' + formatExamDate(a.date) + ' - ' + statusText + '</li>';
    }).join('');
    attemptsListHtml = '<div class="exam-history"><h4>Previous Attempts:</h4><ul>' + attemptItems + '</ul></div>';
  }
  const attemptsHtml = attemptsListHtml;

  root.innerHTML = `
    <div class="exam-start-screen">
      <div class="exam-status-panel">
        <div class="attempts-remaining">
          <span class="attempts-number">${remaining}</span>
          <span class="attempts-label">Attempts Remaining</span>
        </div>
        ${attemptsHtml}
      </div>

      <div class="exam-info-panel">
        <h3>📋 Exam Format</h3>
        <ul>
          <li><strong>35 Multiple Choice Questions</strong> (2 points each)</li>
          <li><strong>10 Fill-in-the-Blank Questions</strong> (2 points each)</li>
          <li><strong>10 Short Answer Questions</strong> (2 points each)</li>
          <li><strong>Total: 110 points</strong></li>
          <li><strong>Passing Score: 80% (88 points)</strong></li>
        </ul>
      </div>

      <div class="name-entry-section">
        <label for="exam-user-name">Your Full Name (for certificate):</label>
        <input type="text" id="exam-user-name" placeholder="Enter your full name" value="${state.userName}" />
      </div>

      <button id="startFinalExam" class="exam-start-btn">🎯 Start Final Exam</button>
    </div>
  `;

  document.getElementById('startFinalExam')?.addEventListener('click', () => {
    const nameInput = document.getElementById('exam-user-name') as HTMLInputElement;
    const userName = nameInput?.value?.trim();

    if (!userName) {
      alert('Please enter your name for the certificate.');
      nameInput?.focus();
      return;
    }

    localStorage.setItem(STORAGE_KEYS.examUserName, userName);
    startExam(root);
  });
}

function showLockoutScreen(root: HTMLElement, state: ExamState) {
  // Find weak modules from failed attempts
  const failedAttempts = state.attempts.filter(a => !a.passed);

  root.innerHTML = `
    <div class="exam-lockout-screen">
      <div class="lockout-icon">🔒</div>
      <h2>Exam Locked</h2>
      <p>You have used all 3 attempts without passing.</p>

      <div class="lockout-message">
        <h3>📚 Time to Review</h3>
        <p>Please review the training modules to strengthen your knowledge, then contact your manager to request additional attempts.</p>

        <div class="review-suggestions">
          <h4>Recommended Review Areas:</h4>
          <ul>
            <li>Module 5: Initial Pitch & 5 Non-Negotiables</li>
            <li>Module 6 & 10: Objection Handling</li>
            <li>Module 11: Filing the Claim & Contingency + Claim Authorization Script</li>
          </ul>
        </div>
      </div>

      <div class="lockout-history">
        <h4>Your Attempts:</h4>
        <ul>
          ${state.attempts.map(a => `
            <li>Attempt ${a.attemptNumber}: ${a.totalScore}% on ${formatExamDate(a.date)}</li>
          `).join('')}
        </ul>
      </div>

      <button onclick="renderModule('welcome')" class="btn-secondary">📖 Return to Training</button>
    </div>
  `;
}

function showCertifiedScreen(root: HTMLElement, state: ExamState) {
  const passingAttempt = state.attempts.find(a => a.passed);
  const savedWrongAnswers = localStorage.getItem(STORAGE_KEYS.lastExamWrongAnswers);
  const wrongAnswers: WrongAnswer[] = savedWrongAnswers ? JSON.parse(savedWrongAnswers) : [];

  // Build review HTML
  const buildReviewHTML = () => {
    if (wrongAnswers.length === 0) {
      return '<p class="perfect-score-banner">🎯 Perfect Score! You answered all questions correctly!</p>';
    }

    const mcqWrong = wrongAnswers.filter(w => w.type === 'mcq');
    const fibWrong = wrongAnswers.filter(w => w.type === 'fib');
    const saWrong = wrongAnswers.filter(w => w.type === 'sa');

    let html = '';

    if (mcqWrong.length > 0) {
      html += `
        <div class="review-section">
          <h4>📝 Multiple Choice (${mcqWrong.length} incorrect)</h4>
          ${mcqWrong.map(w => `
            <div class="wrong-answer-item">
              <div class="question-header">
                <span class="q-number">Q${w.questionNumber}</span>
                <span class="q-text">${w.question}</span>
              </div>
              <div class="answer-comparison">
                <div class="your-answer wrong">
                  <span class="label">❌ Your Answer:</span>
                  <span class="value">${w.userAnswer}</span>
                </div>
                <div class="correct-answer">
                  <span class="label">✅ Correct Answer:</span>
                  <span class="value">${w.correctAnswer}</span>
                </div>
              </div>
              <div class="explanation">
                <strong>💡 Explanation:</strong> ${w.explanation}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    if (fibWrong.length > 0) {
      html += `
        <div class="review-section">
          <h4>✏️ Fill-in-the-Blank (${fibWrong.length} incorrect)</h4>
          ${fibWrong.map(w => `
            <div class="wrong-answer-item">
              <div class="question-header">
                <span class="q-number">Q${w.questionNumber}</span>
                <span class="q-text">${w.question}</span>
              </div>
              <div class="answer-comparison">
                <div class="your-answer wrong">
                  <span class="label">❌ Your Answer:</span>
                  <span class="value">${w.userAnswer}</span>
                </div>
                <div class="correct-answer">
                  <span class="label">✅ Correct Answer:</span>
                  <span class="value">${w.correctAnswer}</span>
                </div>
              </div>
              <div class="explanation">
                <strong>💡 Explanation:</strong> ${w.explanation}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    if (saWrong.length > 0) {
      html += `
        <div class="review-section">
          <h4>📄 Short Answer (${saWrong.length} need improvement)</h4>
          ${saWrong.map(w => `
            <div class="wrong-answer-item sa-review">
              <div class="question-header">
                <span class="q-number">Q${w.questionNumber}</span>
                <span class="q-text">${w.question}</span>
              </div>
              <div class="answer-comparison">
                <div class="your-answer partial">
                  <span class="label">📝 Your Answer:</span>
                  <div class="value sa-value">${w.userAnswer}</div>
                </div>
                <div class="correct-answer">
                  <span class="label">✅ Expected Response:</span>
                  <div class="value sa-value">${w.correctAnswer.replace(/\n/g, '<br>')}</div>
                </div>
              </div>
              <div class="explanation">
                <strong>💡 Feedback:</strong> ${w.explanation}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    return html;
  };

  root.innerHTML = `
    <div class="certified-screen">
      <div class="confetti-container" id="confetti"></div>

      <div class="cert-badge-large">🏆</div>
      <h1>Congratulations!</h1>
      <h2>You are a Certified Roof E.R. Sales Representative</h2>

      <div class="cert-details">
        <p><strong>Name:</strong> ${state.userName}</p>
        <p><strong>Certified:</strong> ${state.certificationDate ? formatExamDate(state.certificationDate) : 'N/A'}</p>
        <p><strong>Score:</strong> ${passingAttempt?.totalScore || 0}%</p>
      </div>

      <button id="downloadCert" class="cert-download-btn">📄 Download Certificate</button>

      ${wrongAnswers.length > 0 ? `
        <div class="answer-review-section" style="margin-top: 30px;">
          <button id="toggleCertReview" class="btn-toggle-review">📋 Review My Exam (${wrongAnswers.length} questions to review)</button>
          <div id="certReviewContent" class="answer-review-content hidden">
            <h3>📚 Questions You Missed</h3>
            <p class="review-intro">Even though you passed, here are the questions you can improve on:</p>
            ${buildReviewHTML()}
          </div>
        </div>
      ` : `
        <div class="answer-review-section" style="margin-top: 30px;">
          <div class="perfect-score-banner">🎯 Perfect Score! You answered all questions correctly!</div>
        </div>
      `}

      <div class="cert-actions">
        <button onclick="renderModule('welcome')" class="btn-secondary">Return to Training</button>
      </div>
    </div>
  `;

  document.getElementById('downloadCert')?.addEventListener('click', () => {
    generateCertificatePDF(state.userName, passingAttempt?.totalScore || 80, state.certificationDate || new Date().toISOString());
  });

  document.getElementById('toggleCertReview')?.addEventListener('click', () => {
    const content = document.getElementById('certReviewContent');
    const btn = document.getElementById('toggleCertReview');
    if (content && btn) {
      content.classList.toggle('hidden');
      btn.textContent = content.classList.contains('hidden')
        ? `📋 Review My Exam (${wrongAnswers.length} questions to review)`
        : '📋 Hide Answer Review';
    }
  });

  // Trigger confetti
  setTimeout(() => triggerConfetti(), 300);
}

async function startExam(root: HTMLElement) {
  // Start exam attempt in API to track it
  const { attemptId, remainingAttempts } = await startExamAttemptAPI();
  currentExamAttemptId = attemptId;

  if (remainingAttempts === 0 && !attemptId) {
    // User is locked out - refresh to show lockout screen
    initFinalExam();
    return;
  }

  // Shuffle questions for this attempt
  currentExamData = {
    mcq: shuffleArray(FINAL_EXAM_MCQ),
    fib: shuffleArray(FINAL_EXAM_FIB),
    sa: shuffleArray(FINAL_EXAM_SA)
  };

  renderFinalExam(root);
}

function renderFinalExam(root: HTMLElement) {
  if (!currentExamData) return;

  const { mcq, fib, sa } = currentExamData;

  root.innerHTML = `
    <div class="exam-container">
      <div class="exam-header">
        <h2>🎯 Final Certification Exam</h2>
        <div class="exam-progress">
          <span id="exam-progress-text">Answer all 50 questions</span>
        </div>
      </div>

      <div class="exam-sections">
        <!-- Multiple Choice Section -->
        <div class="exam-section">
          <h3>📝 Section 1: Multiple Choice (35 questions - 2 pts each)</h3>
          <div class="mcq-questions">
            ${mcq.map((q, idx) => `
              <div class="exam-question mcq-question" data-id="${q.id}">
                <p class="question-text"><strong>${idx + 1}.</strong> ${q.question}</p>
                <div class="options-group">
                  ${q.options.map((opt, optIdx) => `
                    <label class="option-label">
                      <input type="radio" name="mcq-${idx}" value="${optIdx}">
                      <span class="option-text">${opt}</span>
                    </label>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Fill in the Blank Section -->
        <div class="exam-section">
          <h3>✏️ Section 2: Fill in the Blank (10 questions - 2 pts each)</h3>
          <div class="fib-questions">
            ${fib.map((q, idx) => `
              <div class="exam-question fib-question" data-id="${q.id}">
                <p class="question-text"><strong>${idx + 1}.</strong> ${q.question}</p>
                <input type="text" name="fib-${idx}" class="fib-input" placeholder="Type your answer..." />
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Short Answer Section -->
        <div class="exam-section">
          <h3>📄 Section 3: Short Answer (5 questions - 2 pts each)</h3>
          <div class="sa-questions">
            ${sa.map((q, idx) => `
              <div class="exam-question sa-question" data-id="${q.id}">
                <p class="question-text"><strong>${idx + 1}.</strong> ${q.prompt}</p>
                <textarea name="sa-${idx}" class="sa-input" rows="4" placeholder="Write your answer..."></textarea>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="exam-submit-section">
        <button id="submitExam" class="exam-submit-btn">✅ Submit Exam</button>
        <p class="submit-warning">⚠️ You cannot change answers after submitting.</p>
      </div>

      <div id="exam-result"></div>
    </div>
  `;

  document.getElementById('submitExam')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to submit your exam? You cannot change answers after submitting.')) {
      // Show loading state
      const submitBtn = document.getElementById('submitExam') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Grading with AI...';
      }
      try {
        await gradeFinalExam(root);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Exam';
        }
      }
    }
  });
}

async function gradeFinalExam(root: HTMLElement) {
  if (!currentExamData) return;

  const { mcq, fib, sa } = currentExamData;
  const wrongAnswers: WrongAnswer[] = [];

  // Grade MCQ (35 questions, 2 pts each = 70 pts max)
  let mcqCorrect = 0;
  mcq.forEach((q, idx) => {
    const selected = root.querySelector(`input[name="mcq-${idx}"]:checked`) as HTMLInputElement;
    const userAnswerIdx = selected ? parseInt(selected.value) : -1;
    if (userAnswerIdx === q.correctAnswer) {
      mcqCorrect++;
    } else {
      wrongAnswers.push({
        type: 'mcq',
        questionNumber: idx + 1,
        question: q.question,
        userAnswer: userAnswerIdx >= 0 ? q.options[userAnswerIdx] : '(No answer selected)',
        correctAnswer: q.options[q.correctAnswer],
        explanation: q.explanation
      });
    }
  });

  // Grade FIB (10 questions, 2 pts each = 20 pts max)
  let fibCorrect = 0;
  fib.forEach((q, idx) => {
    const input = root.querySelector(`input[name="fib-${idx}"]`) as HTMLInputElement;
    const userAnswer = input?.value?.trim() || '';
    const isCorrect = q.acceptableAnswers.some(a => a.toLowerCase() === userAnswer.toLowerCase());
    if (isCorrect) {
      fibCorrect++;
    } else {
      wrongAnswers.push({
        type: 'fib',
        questionNumber: idx + 1,
        question: q.question,
        userAnswer: userAnswer || '(No answer provided)',
        correctAnswer: q.acceptableAnswers[0],
        explanation: q.explanation
      });
    }
  });

  // Grade SA (10 questions, 2 pts each = 20 pts max) - AI scoring with fallback
  let saPoints = 0;
  const saResults: Array<{score: number; feedback: string; strengths: string[]; improvements: string[]; aiScored: boolean}> = [];

  // Score all SA questions (in parallel for speed)
  const saPromises = sa.map(async (q, idx) => {
    const textarea = root.querySelector(`textarea[name="sa-${idx}"]`) as HTMLTextAreaElement;
    const userAnswer = textarea?.value?.trim() || '';

    try {
      // Try AI scoring first
      const response = await fetch('/api/ai/score-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: q.prompt,
          userAnswer,
          sampleAnswer: q.sampleAnswer,
          maxPoints: 2,
          rubric: {
            keywords: q.keywords,
            criteria: [
              'Completeness - addresses all key points',
              'Accuracy - information is correct',
              'Professionalism - appropriate tone',
              'Persuasiveness - would be effective with homeowner'
            ]
          },
          context: 'exam'
        })
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.log('AI scoring failed, using fallback:', err);
    }

    // Fallback to keyword scoring
    const answerLower = userAnswer.toLowerCase();
    const keywordsFound = q.keywords.filter(kw => answerLower.includes(kw.toLowerCase()));
    const scoreRatio = Math.min(keywordsFound.length / q.minKeywords, 1);
    return {
      score: scoreRatio * 2,
      percentage: Math.round(scoreRatio * 100),
      feedback: `Found ${keywordsFound.length}/${q.minKeywords} key concepts.`,
      strengths: keywordsFound.length > 0 ? [`Mentioned: ${keywordsFound.slice(0, 3).join(', ')}`] : [],
      improvements: [],
      keyPointsHit: keywordsFound,
      keyPointsMissed: q.keywords.filter(kw => !answerLower.includes(kw.toLowerCase())),
      aiScored: false
    };
  });

  const aiResults = await Promise.all(saPromises);

  // Process AI results
  sa.forEach((q, idx) => {
    const textarea = root.querySelector(`textarea[name="sa-${idx}"]`) as HTMLTextAreaElement;
    const userAnswer = textarea?.value?.trim() || '';
    const result = aiResults[idx];
    const questionPoints = result.score;
    saPoints += questionPoints;
    saResults.push(result);

    // If didn't get full credit, show feedback
    if (questionPoints < 2) {
      const feedbackParts = [];
      if (result.feedback) feedbackParts.push(result.feedback);
      if (result.improvements?.length) feedbackParts.push(`\n\nSuggestions:\n- ${result.improvements.join('\n- ')}`);
      if (result.keyPointsMissed?.length) feedbackParts.push(`\n\nMissing concepts: ${result.keyPointsMissed.join(', ')}`);

      wrongAnswers.push({
        type: 'sa',
        questionNumber: idx + 1,
        question: q.prompt,
        userAnswer: userAnswer || '(No answer provided)',
        correctAnswer: `Sample: ${q.sampleAnswer}${result.strengths?.length ? `\n\nStrengths: ${result.strengths.join(', ')}` : ''}`,
        explanation: `${result.aiScored ? '🤖 AI Scored' : '📝 Keyword Scored'}: ${Math.round(questionPoints * 10) / 10}/2 points.\n${feedbackParts.join('')}`
      });
    }
  });

  // Calculate total score (out of 110 points, stored as percentage)
  const mcqScore = mcqCorrect * 2;      // 70 pts max
  const fibScore = fibCorrect * 2;      // 20 pts max
  const saScore = Math.round(saPoints); // 20 pts max
  const rawTotal = mcqScore + fibScore + saScore; // Max 110 points
  const totalScore = Math.round((rawTotal / 110) * 100); // Convert to percentage
  const passed = totalScore >= 80; // 80%

  // Save attempt
  const state = getExamState();
  const attempt: ExamAttempt = {
    attemptNumber: state.attempts.length + 1,
    date: new Date().toISOString(),
    mcqScore: mcqCorrect,
    fibScore: fibCorrect,
    saScore: Math.round(saPoints / 2), // Store as question count
    totalScore,
    passed
  };
  saveExamAttempt(attempt);

  // Submit exam results to API
  const mcqAnswerData = mcq.map((q, idx) => {
    const selected = root.querySelector(`input[name="mcq-${idx}"]:checked`) as HTMLInputElement;
    const userAnswerIdx = selected ? parseInt(selected.value) : -1;
    return {
      questionId: q.id,
      questionNumber: idx + 1,
      questionText: q.question,
      userAnswer: userAnswerIdx >= 0 ? q.options[userAnswerIdx] : '',
      correctAnswer: q.options[q.correctAnswer],
      isCorrect: userAnswerIdx === q.correctAnswer
    };
  });

  const fibAnswerData = fib.map((q, idx) => {
    const input = root.querySelector(`input[name="fib-${idx}"]`) as HTMLInputElement;
    const userAnswer = input?.value?.trim() || '';
    const isCorrect = q.acceptableAnswers.some(a => a.toLowerCase() === userAnswer.toLowerCase());
    return {
      questionId: q.id,
      questionNumber: idx + 1,
      questionText: q.question,
      userAnswer,
      correctAnswer: q.acceptableAnswers[0],
      isCorrect
    };
  });

  const saAnswerData = sa.map((q, idx) => {
    const textarea = root.querySelector(`textarea[name="sa-${idx}"]`) as HTMLTextAreaElement;
    const userAnswer = textarea?.value?.trim() || '';
    const result = saResults[idx] || { score: 0 };
    return {
      questionId: q.id,
      questionNumber: idx + 1,
      questionText: q.prompt,
      userAnswer,
      correctAnswer: q.sampleAnswer,
      isCorrect: result.score >= 2,
      pointsEarned: Math.round(result.score * 10) / 10,
      aiFeedback: result.feedback,
      aiScored: result.aiScored
    };
  });

  // Calculate time taken (would need exam start time tracking for accurate value)
  const timeTaken = 0; // Placeholder - could track actual time

  submitExamToAPI(
    currentExamAttemptId,
    { mcqCorrect, fibCorrect, saPoints: Math.round(saPoints), totalScore, passed },
    timeTaken,
    mcqAnswerData,
    fibAnswerData,
    saAnswerData
  );

  // Save wrong answers to localStorage for later review
  localStorage.setItem(STORAGE_KEYS.lastExamWrongAnswers, JSON.stringify(wrongAnswers));

  // Create detailed results
  const detailedResults: ExamDetailedResults = {
    mcqCorrect,
    fibCorrect,
    saPoints,
    totalScore,
    passed,
    wrongAnswers
  };

  // Show results with detailed feedback
  showExamResults(root, attempt, detailedResults);
}

function showExamResults(root: HTMLElement, attempt: ExamAttempt, detailedResults?: ExamDetailedResults) {
  const state = getExamState();
  const remaining = getRemainingAttempts();
  const wrongAnswers = detailedResults?.wrongAnswers || [];

  // Build the answer review HTML
  const buildAnswerReview = () => {
    if (wrongAnswers.length === 0) {
      return '<p class="perfect-score">🎯 Perfect Score! You answered all questions correctly!</p>';
    }

    const mcqWrong = wrongAnswers.filter(w => w.type === 'mcq');
    const fibWrong = wrongAnswers.filter(w => w.type === 'fib');
    const saWrong = wrongAnswers.filter(w => w.type === 'sa');

    let html = '';

    if (mcqWrong.length > 0) {
      html += `
        <div class="review-section">
          <h4>📝 Multiple Choice (${mcqWrong.length} incorrect)</h4>
          ${mcqWrong.map(w => `
            <div class="wrong-answer-item">
              <div class="question-header">
                <span class="q-number">Q${w.questionNumber}</span>
                <span class="q-text">${w.question}</span>
              </div>
              <div class="answer-comparison">
                <div class="your-answer wrong">
                  <span class="label">❌ Your Answer:</span>
                  <span class="value">${w.userAnswer}</span>
                </div>
                <div class="correct-answer">
                  <span class="label">✅ Correct Answer:</span>
                  <span class="value">${w.correctAnswer}</span>
                </div>
              </div>
              <div class="explanation">
                <strong>💡 Explanation:</strong> ${w.explanation}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    if (fibWrong.length > 0) {
      html += `
        <div class="review-section">
          <h4>✏️ Fill-in-the-Blank (${fibWrong.length} incorrect)</h4>
          ${fibWrong.map(w => `
            <div class="wrong-answer-item">
              <div class="question-header">
                <span class="q-number">Q${w.questionNumber}</span>
                <span class="q-text">${w.question}</span>
              </div>
              <div class="answer-comparison">
                <div class="your-answer wrong">
                  <span class="label">❌ Your Answer:</span>
                  <span class="value">${w.userAnswer}</span>
                </div>
                <div class="correct-answer">
                  <span class="label">✅ Correct Answer:</span>
                  <span class="value">${w.correctAnswer}</span>
                </div>
              </div>
              <div class="explanation">
                <strong>💡 Explanation:</strong> ${w.explanation}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    if (saWrong.length > 0) {
      html += `
        <div class="review-section">
          <h4>📄 Short Answer (${saWrong.length} need improvement)</h4>
          ${saWrong.map(w => `
            <div class="wrong-answer-item sa-review">
              <div class="question-header">
                <span class="q-number">Q${w.questionNumber}</span>
                <span class="q-text">${w.question}</span>
              </div>
              <div class="answer-comparison">
                <div class="your-answer partial">
                  <span class="label">📝 Your Answer:</span>
                  <div class="value sa-value">${w.userAnswer}</div>
                </div>
                <div class="correct-answer">
                  <span class="label">✅ Expected Response:</span>
                  <div class="value sa-value">${w.correctAnswer.replace(/\n/g, '<br>')}</div>
                </div>
              </div>
              <div class="explanation">
                <strong>💡 Feedback:</strong> ${w.explanation}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    return html;
  };

  if (attempt.passed) {
    // Show celebration
    root.innerHTML = `
      <div class="exam-results passed">
        <div class="confetti-container" id="confetti"></div>

        <div class="result-badge success">🎉</div>
        <h1>Congratulations!</h1>
        <h2>You Passed!</h2>

        <div class="score-display">
          <div class="score-circle passed">
            <span class="score-number">${attempt.totalScore}</span>
            <span class="score-label">%</span>
          </div>
        </div>

        <div class="score-breakdown">
          <h4>Score Breakdown:</h4>
          <ul>
            <li>Multiple Choice: ${attempt.mcqScore}/35 correct (${attempt.mcqScore * 2}/70 pts)</li>
            <li>Fill-in-the-Blank: ${attempt.fibScore}/10 correct (${attempt.fibScore * 2}/20 pts)</li>
            <li>Short Answer: ${attempt.saScore * 2}/20 pts</li>
          </ul>
        </div>

        <div class="cert-section">
          <h3>🏆 You are now a Certified Roof E.R. Sales Representative!</h3>
          <button id="downloadCertResult" class="cert-download-btn">📄 Download Certificate</button>
        </div>

        ${wrongAnswers.length > 0 ? `
          <div class="answer-review-section">
            <button id="toggleAnswerReview" class="btn-toggle-review">📋 Review Answers (${wrongAnswers.length} to review)</button>
            <div id="answerReviewContent" class="answer-review-content hidden">
              <h3>📚 Answer Review</h3>
              <p class="review-intro">Even though you passed, here are the questions you can improve on:</p>
              ${buildAnswerReview()}
            </div>
          </div>
        ` : `
          <div class="answer-review-section">
            <div class="perfect-score-banner">🎯 Perfect Score! You answered all questions correctly!</div>
          </div>
        `}
      </div>
    `;

    document.getElementById('downloadCertResult')?.addEventListener('click', () => {
      generateCertificatePDF(state.userName, attempt.totalScore, attempt.date);
    });

    document.getElementById('toggleAnswerReview')?.addEventListener('click', () => {
      const content = document.getElementById('answerReviewContent');
      const btn = document.getElementById('toggleAnswerReview');
      if (content && btn) {
        content.classList.toggle('hidden');
        btn.textContent = content.classList.contains('hidden')
          ? `📋 Review Answers (${wrongAnswers.length} to review)`
          : '📋 Hide Answer Review';
      }
    });

    triggerConfetti();

    // Mark quiz as passed in engagement state
    markQuizPassed('final-exam');

    // Mark the final exam module as complete
    completeModule('final-exam');
  } else {
    // Show failure screen
    const locked = remaining === 0;

    root.innerHTML = `
      <div class="exam-results failed">
        <div class="result-badge fail">😔</div>
        <h1>Not Quite There</h1>
        <h2>Score: ${attempt.totalScore}% (Need 80% to pass)</h2>

        <div class="score-display">
          <div class="score-circle failed">
            <span class="score-number">${attempt.totalScore}</span>
            <span class="score-label">%</span>
          </div>
        </div>

        <div class="score-breakdown">
          <h4>Score Breakdown:</h4>
          <ul>
            <li>Multiple Choice: ${attempt.mcqScore}/35 correct</li>
            <li>Fill-in-the-Blank: ${attempt.fibScore}/10 correct</li>
            <li>Short Answer: ${attempt.saScore * 2}/20 pts</li>
          </ul>
        </div>

        ${locked ? `
          <div class="lockout-warning">
            <h3>🔒 Exam Locked</h3>
            <p>You've used all 3 attempts. Please review the training modules and contact your manager for additional attempts.</p>
          </div>
        ` : `
          <div class="retry-section">
            <p><strong>${remaining} attempt${remaining !== 1 ? 's' : ''} remaining</strong></p>
            <p>Review the questions below, study the modules you struggled with, and try again!</p>
          </div>
        `}

        <div class="answer-review-section expanded">
          <h3>📚 Answer Review - See What You Got Wrong</h3>
          <p class="review-intro">Study these carefully before your next attempt:</p>
          <div id="answerReviewContent" class="answer-review-content">
            ${buildAnswerReview()}
          </div>
        </div>

        <div class="review-suggestions">
          <h4>📚 Recommended Modules to Review:</h4>
          <ul>
            <li>Module 5: Initial Pitch & 5 Non-Negotiables</li>
            <li>Module 6 & 10: Handling Objections</li>
            <li>Module 11: Filing the Claim & Contingency + Claim Authorization Script</li>
          </ul>
        </div>

        <div class="result-actions">
          ${!locked ? '<button onclick="initFinalExam()" class="btn-primary">🔄 Try Again</button>' : ''}
          <button onclick="renderModule(\'welcome\')" class="btn-secondary">📖 Review Training</button>
        </div>
      </div>
    `;
  }
}

// ============================================================================
// CERTIFICATE GENERATION (Canvas API)
// ============================================================================

function generateCertificatePDF(userName: string, score: number, dateStr: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1056;  // 11" at 96dpi (landscape)
  canvas.height = 816;  // 8.5" at 96dpi
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer border (Roof-ER red)
  ctx.strokeStyle = '#D90429';
  ctx.lineWidth = 12;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

  // Inner border
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

  // Decorative corners
  ctx.fillStyle = '#D90429';
  [[50, 50], [canvas.width - 70, 50], [50, canvas.height - 70], [canvas.width - 70, canvas.height - 70]].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x + 10, y + 10, 8, 0, Math.PI * 2);
    ctx.fill();
  });

  // Title
  ctx.fillStyle = '#1a1a2e';
  ctx.font = 'bold 42px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('CERTIFICATE OF COMPLETION', canvas.width / 2, 120);

  // Trophy icon (text-based)
  ctx.font = '60px Arial';
  ctx.fillText('🏆', canvas.width / 2, 200);

  // Company name
  ctx.fillStyle = '#D90429';
  ctx.font = 'bold 48px Arial, sans-serif';
  ctx.fillText('ROOF E.R.', canvas.width / 2, 280);

  // "This certifies that"
  ctx.fillStyle = '#1a1a2e';
  ctx.font = '22px Georgia, serif';
  ctx.fillText('This certifies that', canvas.width / 2, 340);

  // User name
  ctx.font = 'bold 44px Georgia, serif';
  ctx.fillText(userName, canvas.width / 2, 400);

  // Line under name
  ctx.strokeStyle = '#D90429';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(250, 420);
  ctx.lineTo(canvas.width - 250, 420);
  ctx.stroke();

  // Certification text
  ctx.font = '20px Georgia, serif';
  ctx.fillStyle = '#1a1a2e';
  ctx.fillText('has successfully completed the', canvas.width / 2, 470);

  ctx.font = 'bold 26px Georgia, serif';
  ctx.fillText('Roof E.R. Sales Representative Training Program', canvas.width / 2, 510);

  ctx.font = '20px Georgia, serif';
  ctx.fillText('and is hereby certified as a', canvas.width / 2, 550);

  // Certification title
  ctx.fillStyle = '#D90429';
  ctx.font = 'bold 32px Georgia, serif';
  ctx.fillText('Certified Sales Representative', canvas.width / 2, 595);

  // Score and date
  ctx.fillStyle = '#666666';
  ctx.font = '16px Arial, sans-serif';
  ctx.fillText(`Score: ${score}%  |  Date: ${formatExamDate(dateStr)}`, canvas.width / 2, 650);

  // Signature lines
  ctx.fillStyle = '#1a1a2e';
  ctx.font = '14px Arial, sans-serif';

  // Left signature
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(180, 730);
  ctx.lineTo(380, 730);
  ctx.stroke();
  ctx.fillText('Oliver Brown, CEO', 280, 755);

  // Right signature
  ctx.beginPath();
  ctx.moveTo(canvas.width - 380, 730);
  ctx.lineTo(canvas.width - 180, 730);
  ctx.stroke();
  ctx.fillText('Reese Samala, Director of Sales', canvas.width - 280, 755);

  // Download
  const link = document.createElement('a');
  link.download = `RoofER_Certificate_${userName.replace(/\s+/g, '_')}.png`;
  link.href = canvas.toDataURL('image/png', 1.0);
  link.click();
}

function initQuickQuiz1() {
  const startBtn = document.getElementById('startQuickQuiz1');
  const area = document.getElementById('quiz1-area');
  if (!startBtn || !area) return;
  startBtn.addEventListener('click', () => {
    area.innerHTML = `
      <div class="quiz-container-enhanced">
        <div class="quiz-question-card">
          <p class="quiz-question-text">1. Who are the key leaders at Roof-ER?</p>
          <div class="quiz-options">
            <button class="quiz-option-btn" data-answer="a" data-question="qa1">
              <span class="option-letter">A</span>
              <span>Oliver Brown (Owner &amp; Founder), Reese Samala (Director of Sales), Ford Barsi (General Manager)</span>
            </button>
            <button class="quiz-option-btn" data-answer="b" data-question="qa1">
              <span class="option-letter">B</span>
              <span>Ford Barsi (Owner), Oliver Brown (Director of Sales), Reese Samala (General Manager)</span>
            </button>
            <button class="quiz-option-btn" data-answer="c" data-question="qa1">
              <span class="option-letter">C</span>
              <span>Reese Samala (Owner), Ford Barsi (Director of Sales), Oliver Brown (General Manager)</span>
            </button>
          </div>
        </div>
        <div class="quiz-question-card">
          <p class="quiz-question-text">2. What are Roof-ER's core values?</p>
          <div class="quiz-options">
            <button class="quiz-option-btn" data-answer="a" data-question="qa2">
              <span class="option-letter">A</span>
              <span>Speed, Price, Volume</span>
            </button>
            <button class="quiz-option-btn" data-answer="b" data-question="qa2">
              <span class="option-letter">B</span>
              <span>Integrity, Quality, Simplicity</span>
            </button>
            <button class="quiz-option-btn" data-answer="c" data-question="qa2">
              <span class="option-letter">C</span>
              <span>Profit, Growth, Expansion</span>
            </button>
          </div>
        </div>
        <div class="quiz-question-card">
          <p class="quiz-question-text">3. What year was Roof-ER founded?</p>
          <div class="quiz-options">
            <button class="quiz-option-btn" data-answer="a" data-question="qa3">
              <span class="option-letter">A</span>
              <span>2017</span>
            </button>
            <button class="quiz-option-btn" data-answer="b" data-question="qa3">
              <span class="option-letter">B</span>
              <span>2018</span>
            </button>
            <button class="quiz-option-btn" data-answer="c" data-question="qa3">
              <span class="option-letter">C</span>
              <span>2019</span>
            </button>
          </div>
        </div>
        <button id="quiz1Submit" class="quiz-submit-btn">Submit Answers</button>
        <div id="quiz1Result" class="quiz-result-area"></div>
      </div>
    `;

    // Track selected answers
    const selectedAnswers: Record<string, string> = {};

    // Add click handlers for option buttons
    area.querySelectorAll('.quiz-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const question = (btn as HTMLElement).dataset.question || '';
        const answer = (btn as HTMLElement).dataset.answer || '';
        selectedAnswers[question] = answer;

        // Update visual selection
        area.querySelectorAll(`.quiz-option-btn[data-question="${question}"]`).forEach(b => {
          b.classList.remove('selected');
        });
        btn.classList.add('selected');
      });
    });

    (document.getElementById('quiz1Submit') as HTMLButtonElement)?.addEventListener('click', () => {
      const q1 = selectedAnswers['qa1'];
      const q2 = selectedAnswers['qa2'];
      const q3 = selectedAnswers['qa3'];
      const pass = q1 === 'a' && q2 === 'b' && q3 === 'c';
      const res = document.getElementById('quiz1Result');
      if (res) {
        if (pass) {
          res.innerHTML = '<div class="quiz-success">&#10003; Perfect! You know the Roof-ER leadership team, core values, and founding year.</div>';
        } else {
          let feedback = '<div class="quiz-error">&#10007; Not quite. ';
          if (q1 !== 'a') feedback += 'Review the leadership team. ';
          if (q2 !== 'b') feedback += 'Check our core values. ';
          if (q3 !== 'c') feedback += 'Roof-ER was founded in 2019. ';
          feedback += '</div>';
          res.innerHTML = feedback;
        }
      }
    });
  });
}
// Build 1769012208
