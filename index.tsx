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
  userIsManager: 'roof-er.userIsManager'
};

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
  // Module 1-4: Basics (6 MCQ)
  { id: 'mcq-1', module: 1, question: 'Who is the CEO and founder of Roof E.R.?', options: ['Reese Samala', 'Ford Barsi', 'Oliver Brown', 'John Smith'], correctAnswer: 2, explanation: 'Oliver Brown founded Roof E.R. in 2019.' },
  { id: 'mcq-2', module: 1, question: 'What year was Roof E.R. founded?', options: ['2015', '2017', '2019', '2021'], correctAnswer: 2, explanation: 'Roof E.R. was founded in 2019.' },
  { id: 'mcq-3', module: 2, question: 'What is Roof E.R.\'s primary mission?', options: ['Maximize profits', 'Hold fiduciary responsibility to customers', 'Sell the most roofs', 'Beat competitors'], correctAnswer: 1, explanation: 'Our mission is to hold fiduciary responsibility to customers - their interests come first.' },
  { id: 'mcq-4', module: 3, question: 'What does "COI" stand for in roofing claims?', options: ['Cost Of Installation', 'Certificate Of Insurance', 'Claim Of Interest', 'Contract Of Intent'], correctAnswer: 1, explanation: 'COI stands for Certificate Of Insurance - proof of contractor insurance coverage.' },
  { id: 'mcq-5', module: 4, question: 'Which shingle type is most commonly used in residential roofing?', options: ['Metal shingles', '3-tab asphalt', 'Clay tiles', 'Slate'], correctAnswer: 1, explanation: '3-tab asphalt shingles are the most common residential roofing material.' },
  { id: 'mcq-6', module: 4, question: 'What is the typical warranty period for architectural shingles?', options: ['10 years', '25-30 years', '50 years', 'Lifetime'], correctAnswer: 1, explanation: 'Most architectural shingles carry a 25-30 year warranty.' },

  // Module 5: Initial Pitch (4 MCQ)
  { id: 'mcq-7', module: 5, question: 'What are the 5 Non-Negotiables of the initial pitch?', options: ['Name, Company, Price, Timeline, Close', 'Who you are, Who we are, Make it relatable, Purpose, Go for the close', 'Greeting, Inspect, Photo, File, Sign', 'Introduction, Benefits, Price, Warranty, Close'], correctAnswer: 1, explanation: 'The 5 Non-Negotiables: Who you are, Who we are, Make it relatable, Purpose (inspection), Go for the close.' },
  { id: 'mcq-8', module: 5, question: 'What should you mention to make your pitch relatable?', options: ['Your personal story', 'Recent storms or helping neighbors', 'Company awards', 'Competitor weaknesses'], correctAnswer: 1, explanation: 'Mention recent storms or that you\'ve been helping their neighbors to create local relevance.' },
  { id: 'mcq-9', module: 5, question: 'What is the primary purpose mentioned in the pitch?', options: ['Selling a roof', 'Getting a signature', 'Offering a free inspection', 'Collecting payment'], correctAnswer: 2, explanation: 'The purpose is offering a FREE inspection - no commitment, no pressure.' },
  { id: 'mcq-10', module: 5, question: 'How long should you say the initial inspection takes?', options: ['5 minutes', '15 minutes', '45 minutes', '2 hours'], correctAnswer: 1, explanation: 'Tell them the inspection takes about 15 minutes - quick and easy.' },

  // Module 6: Handling Initial Objections (4 MCQ)
  { id: 'mcq-11', module: 6, question: 'What is the L.E.A.R.N. framework for handling objections?', options: ['Look, Evaluate, Analyze, Report, Notify', 'Listen, Empathize, Ask, Respond, Navigate', 'Learn, Educate, Assist, Repair, Negotiate', 'List, Examine, Address, Resolve, Note'], correctAnswer: 1, explanation: 'L.E.A.R.N.: Listen, Empathize, Ask clarifying questions, Respond, Navigate to next step.' },
  { id: 'mcq-12', module: 6, question: 'When a homeowner says "I\'m not interested," what should you do first?', options: ['Walk away immediately', 'Offer a discount', 'Ask what specifically concerns them', 'Call your manager'], correctAnswer: 2, explanation: 'First, ask what specifically concerns them to uncover the real objection.' },
  { id: 'mcq-13', module: 6, question: 'What\'s the best response to "I don\'t have time right now"?', options: ['Leave your card', 'Insist on doing it now', 'Offer to schedule a specific time that works for them', 'Say you\'ll only be 5 minutes'], correctAnswer: 2, explanation: 'Offer to schedule a specific time - respect their time while keeping the opportunity alive.' },
  { id: 'mcq-14', module: 6, question: 'How should you handle "We already have a roofer"?', options: ['Criticize their roofer', 'Ask if they\'ve gotten a second opinion from a storm specialist', 'Give up and leave', 'Offer a lower price'], correctAnswer: 1, explanation: 'Ask about getting a second opinion - position yourself as a storm damage specialist.' },

  // Module 7: Inspection Process (4 MCQ)
  { id: 'mcq-15', module: 7, question: 'What is the first thing you should do during a roof inspection?', options: ['Start taking photos', 'Check for safety hazards and proper equipment', 'Knock on the door', 'Call the insurance company'], correctAnswer: 1, explanation: 'Safety first - always check for hazards and ensure you have proper equipment.' },
  { id: 'mcq-16', module: 7, question: 'What size is a standard test square for damage documentation?', options: ['5x5 feet', '10x10 feet', '15x15 feet', '20x20 feet'], correctAnswer: 1, explanation: 'A 10x10 foot test square is the industry standard for counting damage.' },
  { id: 'mcq-17', module: 7, question: 'How many photos should you typically take during an inspection?', options: ['5-10', '10-15', '20-40', '50+'], correctAnswer: 2, explanation: 'Take 20-40 photos to thoroughly document all damage and roof conditions.' },
  { id: 'mcq-18', module: 7, question: 'What are the key areas to inspect for storm damage?', options: ['Only the shingles', 'Shingles, flashing, gutters, vents, and valleys', 'Just the gutters', 'Only visible damage from ground'], correctAnswer: 1, explanation: 'Inspect all components: shingles, flashing, gutters, vents, valleys, and accessories.' },

  // Module 8: Post-Inspection Pitch (4 MCQ)
  { id: 'mcq-19', module: 8, question: 'After finding damage, what should you show the homeowner first?', options: ['Your contract', 'The photos of damage on their roof', 'Your pricing', 'Competitor reviews'], correctAnswer: 1, explanation: 'Show them the actual photos of damage on THEIR roof - visual evidence is powerful.' },
  { id: 'mcq-20', module: 8, question: 'What is the main benefit to emphasize about filing an insurance claim?', options: ['You get paid more', 'They can get their roof replaced with little to no out-of-pocket cost', 'Insurance rates always go down', 'It\'s required by law'], correctAnswer: 1, explanation: 'Emphasize they can get a new roof with often just their deductible out-of-pocket.' },
  { id: 'mcq-21', module: 8, question: 'When explaining the process, what should you emphasize about Roof E.R.\'s role?', options: ['We handle everything with the insurance company', 'They must do all paperwork themselves', 'We only do the installation', 'Insurance handles everything'], correctAnswer: 0, explanation: 'We handle everything - filing, adjusters, supplements, making it easy for homeowners.' },
  { id: 'mcq-22', module: 8, question: 'What document do you need signed to file a claim on their behalf?', options: ['A check', 'Direction to Pay / Assignment of Benefits', 'Their insurance policy', 'A loan application'], correctAnswer: 1, explanation: 'The Direction to Pay / Assignment of Benefits allows us to work directly with their insurance.' },

  // Module 9: Post-Inspection Objections (4 MCQ)
  { id: 'mcq-23', module: 9, question: 'When a homeowner says "My rates will go up," what\'s the best response?', options: ['That\'s probably true', 'Rates increase due to regional claims, not individual claims, and not filing means $20K+ later', 'Don\'t file then', 'I don\'t know about insurance'], correctAnswer: 1, explanation: 'Explain rates increase regionally regardless, and not filing now means huge out-of-pocket costs later.' },
  { id: 'mcq-24', module: 9, question: 'How do you handle "I need to talk to my spouse"?', options: ['Call them yourself', 'Leave and hope they call back', 'Ask when the spouse will be available and schedule a time to meet together', 'Tell them to convince their spouse'], correctAnswer: 2, explanation: 'Schedule a time to meet when both decision-makers are present.' },
  { id: 'mcq-25', module: 9, question: 'What\'s the response to "I don\'t trust insurance claims"?', options: ['You shouldn\'t trust them', 'This is what you PAY insurance for - it\'s your right to file', 'Don\'t file then', 'Insurance is always trustworthy'], correctAnswer: 1, explanation: 'Remind them this is exactly what they pay premiums for - it\'s their right to use it.' },
  { id: 'mcq-26', module: 9, question: 'When they say "I\'ll think about it," you should:', options: ['Accept it and leave', 'Ask what specifically they need to think about, then address that concern', 'Apply heavy pressure', 'Offer 50% off'], correctAnswer: 1, explanation: 'Ask what specific concern needs thinking - usually reveals the real objection to address.' },

  // Module 10-11: Damage ID & Claims (4 MCQ)
  { id: 'mcq-27', module: 10, question: 'What does hail damage look like on asphalt shingles?', options: ['Straight cracks', 'Round bruises with granule loss and soft spots', 'Only missing shingles', 'Color changes only'], correctAnswer: 1, explanation: 'Hail causes round bruises with granule loss and creates soft spots when pressed.' },
  { id: 'mcq-28', module: 10, question: 'What is considered wind damage on a roof?', options: ['Round spots', 'Lifted, creased, or missing shingles', 'Granule loss only', 'Color fading'], correctAnswer: 1, explanation: 'Wind damage shows as lifted edges, creased shingles, or completely missing shingles.' },
  { id: 'mcq-29', module: 11, question: 'What is a supplement in the insurance claim process?', options: ['A vitamin', 'Additional documentation for work not covered in initial estimate', 'The homeowner\'s payment', 'A second insurance policy'], correctAnswer: 1, explanation: 'A supplement requests additional funds for work discovered after the initial estimate.' },
  { id: 'mcq-30', module: 11, question: 'Who typically meets with the insurance adjuster at the property?', options: ['Only the homeowner', 'The Roof E.R. representative', 'The neighbor', 'No one - it\'s done remotely'], correctAnswer: 1, explanation: 'A Roof E.R. representative meets the adjuster to ensure all damage is properly documented.' },

  // Module 12: Closing Objections (4 MCQ)
  { id: 'mcq-31', module: 12, question: 'What is the "Assumptive Close"?', options: ['Assuming they won\'t buy', 'Acting as if they\'ve already agreed and moving to next steps', 'Assuming the insurance will deny', 'Guessing their concerns'], correctAnswer: 1, explanation: 'Assumptive close: proceed as if they\'ve said yes - "I\'ll get that contract texted to you now."' },
  { id: 'mcq-32', module: 12, question: 'When they hesitate to sign, what technique helps?', options: ['Threaten to leave', 'Use urgency and timeline - explain why acting now protects them', 'Offer to do it for free', 'Tell them competitors are worse'], correctAnswer: 1, explanation: 'Create legitimate urgency - time limits on claim filing, weather concerns, etc.' },
  { id: 'mcq-33', module: 12, question: 'The homeowner says "I want to get other quotes." Best response?', options: ['Fine, get 10 quotes', 'Explain you\'re a claims specialist, not just a roofer, and what sets you apart', 'Lower your price immediately', 'Criticize other companies'], correctAnswer: 1, explanation: 'Differentiate by explaining you\'re a claims specialist who handles insurance, not just a roofer.' },
  { id: 'mcq-34', module: 12, question: 'What should you do immediately after getting a signature?', options: ['Leave quickly', 'Set clear next-step expectations and timeline', 'Ask for referrals only', 'Nothing - job is done'], correctAnswer: 1, explanation: 'Set clear expectations: what happens next, when they\'ll hear from you, timeline for process.' },

  // Module 13-14: Products & Sales Cycle (1 MCQ)
  { id: 'mcq-35', module: 14, question: 'What are the main stages of the Roof E.R. sales cycle?', options: ['Call, Sell, Install', 'Knock, Inspect, File claim, Meet adjuster, Install, Collect', 'Email, Quote, Invoice', 'Advertise, Estimate, Build'], correctAnswer: 1, explanation: 'Full cycle: Door knock → Inspection → File claim → Adjuster meeting → Installation → Collection.' }
];

const FINAL_EXAM_FIB: FIBQuestion[] = [
  // Module 1-4: Basics (2 FIB)
  { id: 'fib-1', module: 1, question: 'Roof E.R. was founded by _____ _____ in 2019.', acceptableAnswers: ['Oliver Brown', 'oliver brown', 'OLIVER BROWN'], explanation: 'Oliver Brown founded Roof E.R. in 2019.' },
  { id: 'fib-2', module: 2, question: 'Roof E.R.\'s mission is to hold _____ responsibility to our customers.', acceptableAnswers: ['fiduciary', 'Fiduciary', 'FIDUCIARY'], explanation: 'Fiduciary responsibility means putting customer interests first.' },

  // Module 5: Initial Pitch (1 FIB)
  { id: 'fib-3', module: 5, question: 'The initial pitch should always end with going for the _____.', acceptableAnswers: ['close', 'Close', 'CLOSE'], explanation: 'Always go for the close - getting them to agree to the inspection.' },

  // Module 6: Handling Initial Objections (1 FIB)
  { id: 'fib-4', module: 6, question: 'The L.E.A.R.N. framework stands for Listen, _____, Ask, Respond, Navigate.', acceptableAnswers: ['Empathize', 'empathize', 'EMPATHIZE'], explanation: 'Empathize - show you understand their concerns before responding.' },

  // Module 7: Inspection Process (1 FIB)
  { id: 'fib-5', module: 7, question: 'A test square for damage documentation is _____x_____ feet.', acceptableAnswers: ['10x10', '10 x 10', '10 by 10', '10X10'], explanation: 'A 10x10 foot test square is standard for counting hail hits.' },

  // Module 9: Post-Inspection Objections (1 FIB)
  { id: 'fib-6', module: 9, question: 'When a homeowner needs to talk to their spouse, you should schedule a time when both _____ _____ are present.', acceptableAnswers: ['decision makers', 'decision-makers', 'Decision Makers', 'decisionmakers'], explanation: 'Both decision makers need to be present to avoid delays.' },

  // Module 10-11: Damage ID & Claims (1 FIB)
  { id: 'fib-7', module: 10, question: 'Hail damage on shingles appears as round _____ with granule loss.', acceptableAnswers: ['bruises', 'Bruises', 'BRUISES', 'marks', 'spots'], explanation: 'Hail creates round bruises with exposed mat under the granules.' },

  // Module 12: Closing Objections (1 FIB)
  { id: 'fib-8', module: 12, question: 'The _____ close means acting as if they\'ve already agreed and moving forward.', acceptableAnswers: ['assumptive', 'Assumptive', 'ASSUMPTIVE'], explanation: 'The assumptive close proceeds as if they\'ve already said yes.' },

  // Module 13-14: Products & Sales Cycle (2 FIB)
  { id: 'fib-9', module: 13, question: 'When a shingle is discontinued, insurance must pay for _____ roof replacement.', acceptableAnswers: ['full', 'Full', 'FULL', 'complete', 'Complete'], explanation: 'Discontinued products require full replacement to maintain warranty.' },
  { id: 'fib-10', module: 14, question: 'After installation, the final step is _____ from the insurance company.', acceptableAnswers: ['collection', 'Collection', 'COLLECTION', 'payment', 'Payment'], explanation: 'Collection of the final payment completes the sales cycle.' }
];

const FINAL_EXAM_SA: SAQuestion[] = [
  // Module 5: Initial Pitch (1 SA)
  { id: 'sa-1', module: 5, prompt: 'Write a complete initial door knock pitch introducing yourself as a Roof E.R. representative. Include all 5 non-negotiables.', keywords: ['name', 'Roof E.R.', 'storm', 'neighbors', 'free', 'inspection', '15 minutes', 'insurance', 'damage', 'schedule', 'today', 'tomorrow'], minKeywords: 6, sampleAnswer: 'Hi, my name is [Name] with Roof E.R. We\'re a local roofing company helping homeowners get their roofs replaced using their insurance. We\'ve had some big storms recently and we\'ve been helping a lot of your neighbors file claims. I\'d like to offer you a completely free inspection - takes about 15 minutes. If there\'s damage, I can help you file a claim. If not, at least you\'ll have peace of mind. Would today or tomorrow work better for you?' },

  // Module 8: Post-Inspection Pitch (1 SA)
  { id: 'sa-2', module: 8, prompt: 'After finding storm damage, explain to the homeowner why they should file an insurance claim and how Roof E.R. helps.', keywords: ['damage', 'insurance', 'claim', 'deductible', 'out-of-pocket', 'free', 'handle', 'adjuster', 'file', 'replacement', 'cost', 'leak'], minKeywords: 5, sampleAnswer: 'I found clear storm damage on your roof. The good news is your insurance should cover the replacement - you\'d typically only pay your deductible. If you don\'t file now, you could be looking at $15-20K out of pocket when it starts leaking in a year or two. We handle everything with the insurance company - we file the claim, meet with the adjuster, and fight for you to get the full coverage you deserve.' },

  // Module 9: Post-Inspection Objections (1 SA)
  { id: 'sa-3', module: 9, prompt: 'A homeowner says: "I don\'t want to file a claim because my rates will go up." How do you respond?', keywords: ['rates', 'regional', 'claims', 'area', 'increase', 'regardless', 'pay', 'insurance', 'purpose', 'deductible', 'out-of-pocket', 'leak', 'thousands'], minKeywords: 4, sampleAnswer: 'I understand that concern. Here\'s what most people don\'t realize: rates are based on regional claims, not just your individual claim. Your rates may increase whether you file or not because of all the claims in your area. The real question is: would you rather pay your $1,000 deductible now, or $20,000 out of pocket when the roof fails? You pay premiums specifically for situations like this - it\'s your right to use your coverage.' },

  // Module 12: Closing Objections (1 SA)
  { id: 'sa-4', module: 12, prompt: 'The homeowner says: "I need to think about it." How do you handle this objection?', keywords: ['think', 'specifically', 'concern', 'address', 'timeline', 'claim', 'deadline', 'help', 'question', 'worry', 'understand'], minKeywords: 4, sampleAnswer: 'I completely understand wanting to think it over. To make sure I can help address any concerns, can you tell me specifically what you need to think about? Is it the process, the timing, or something else? I ask because storm claims have time limits for filing, and I want to make sure you don\'t miss that window. What questions can I answer right now?' },

  // Module 13-14: Products & Sales Cycle (1 SA)
  { id: 'sa-5', module: 14, prompt: 'Describe the complete Roof E.R. sales cycle from initial contact to final payment.', keywords: ['knock', 'door', 'inspect', 'inspection', 'damage', 'claim', 'file', 'adjuster', 'supplement', 'install', 'installation', 'collect', 'payment'], minKeywords: 5, sampleAnswer: 'The Roof E.R. sales cycle: 1) Door knock - introduce yourself and offer free inspection. 2) Roof inspection - document all damage with photos and test square. 3) File claim - submit paperwork to insurance with all documentation. 4) Adjuster meeting - meet on-site to ensure all damage is noted. 5) Supplements - request additional funds for any missed items. 6) Installation - complete the roof replacement. 7) Collection - receive final payment from insurance.' }
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
  'inspection-process',
  'post-inspection-pitch',
  'post-inspection-objections',
  'damage-identification',
  'filing-claim-closing',
  'closing-objections',
  'discontinued-products',
  'sales-cycle-job-flow',
  'role-play',
  'final-exam'
];

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
  items?.forEach(item => {
    const moduleName = (item as HTMLElement).dataset.module || '';
    // My Page and admin-dashboard are never locked
    if (moduleName === 'my-page' || moduleName === 'admin-dashboard') {
      item.classList.remove('locked');
      item.classList.add('unlocked');
    } else if (unlocked.includes(moduleName)) {
      item.classList.remove('locked');
      item.classList.add('unlocked');
    } else {
      item.classList.add('locked');
      item.classList.remove('unlocked');
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
    'filing-claim-closing': 'Filing the Claim & Closing',
    'closing-objections': 'Closing Objections',
    'discontinued-products': 'Discontinued Products',
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

  // Get user stats from localStorage/API
  const completedModules = JSON.parse(localStorage.getItem('roof-er.completedModules') || '[]');
  const totalXp = parseInt(localStorage.getItem('roof-er.totalXp') || '0');
  const streak = parseInt(localStorage.getItem('roof-er.currentStreak') || '0');
  const trainingMinutes = parseInt(localStorage.getItem('roof-er.trainingMinutes') || '0');
  const quizScores = JSON.parse(localStorage.getItem('roof-er.quizScores') || '[]');
  const avgScore = quizScores.length > 0
    ? Math.round(quizScores.reduce((a: number, b: number) => a + b, 0) / quizScores.length)
    : 0;

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
  if (modulesEl) modulesEl.textContent = `${completedModules.length}/16`;

  const streakEl = document.getElementById('stat-streak');
  if (streakEl) streakEl.textContent = streak.toString();

  const timeEl = document.getElementById('stat-time');
  if (timeEl) timeEl.textContent = formatTrainingTime(trainingMinutes);

  const avgScoreEl = document.getElementById('stat-avg-score');
  if (avgScoreEl) avgScoreEl.textContent = quizScores.length > 0 ? `${avgScore}%` : '--%';

  const totalXpEl = document.getElementById('stat-total-xp');
  if (totalXpEl) totalXpEl.textContent = totalXp.toLocaleString();

  // Determine next milestone
  const milestoneEl = document.getElementById('stat-milestone');
  if (milestoneEl) {
    if (completedModules.length < 16) {
      const remaining = 16 - completedModules.length;
      milestoneEl.textContent = `${remaining} modules`;
    } else {
      milestoneEl.textContent = 'Complete!';
    }
  }

  // Setup continue training button
  const nextModule = getNextTrainingModule();
  const continueBtnText = document.getElementById('continue-btn-text');
  if (continueBtnText) {
    if (completedModules.length === 0) {
      continueBtnText.textContent = 'Start Training';
    } else if (completedModules.length >= 16) {
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

## TRANSCRIPT SUMMARY (IMPORTANT):
Before EVERY response, start with a brief summary of what the rep just said in square brackets:
[Rep: introduced themselves as ___, mentioned ___, asked about ___]
Then provide your in-character response on a new line. This helps track the conversation in the transcript.

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
      "L.E.A.R.N. Framework: Listen, Empathize, Ask, Respond, Navigate",
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
    framework: "L.E.A.R.N."
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
          <div class="stat-value" id="stat-modules">0/16</div>
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
      ${renderVideoPlayer('/assets/training/videos/welcome-intro.mp4', 'welcome-video', '📹 Welcome Introduction')}
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

      <h2>Our Mission & Values</h2>
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
    </div>
  `,
  commitment: `
    <div class="content-card">
      <h1>Your Commitment</h1>
      ${renderVideoPlayer('/assets/training/videos/module2-commitment.mp4', 'commitment-video', '📹 Your Commitment to Excellence')}

      <h2>The Roof-ER Promise</h2>
      <div class="promise-section">
        <p><strong>We promise to:</strong></p>
        <ul>
          <li>Treat every homeowner's property as if it were our own</li>
          <li>Provide honest assessments, even if it means no sale</li>
          <li>Fight for maximum coverage on every claim</li>
          <li>Complete every project with excellence and professionalism</li>
          <li>Stand behind our work for the lifetime of the roof</li>
          <li>Communicate clearly and promptly throughout the process</li>
        </ul>
      </div>

      <h2>Your Commitment as a Roof-ER Representative</h2>

      <p>As a member of the Roof-ER team, your commitment to our values and processes is paramount to our collective success. Here is what we expect:</p>

      <div class="commitment-initials-section">
        <div class="commitment-item">
          <input type="text" class="initial-box" maxlength="3" placeholder="Init." aria-label="Initial for first commitment" />
          <span>I will conduct myself in alignment with the Mission and Core Values.</span>
        </div>
        <div class="commitment-item">
          <input type="text" class="initial-box" maxlength="3" placeholder="Init." aria-label="Initial for second commitment" />
          <span>I will dedicate myself to Roof-ER's successful sales process.</span>
        </div>
        <div class="commitment-item">
          <input type="text" class="initial-box" maxlength="3" placeholder="Init." aria-label="Initial for third commitment" />
          <span>I will always show an exceptional level of integrity.</span>
        </div>
        <div class="commitment-item">
          <input type="text" class="initial-box" maxlength="3" placeholder="Init." aria-label="Initial for fourth commitment" />
          <span>I will listen to and grow from receiving constructive feedback.</span>
        </div>
        <div class="commitment-item">
          <input type="text" class="initial-box" maxlength="3" placeholder="Init." aria-label="Initial for fifth commitment" />
          <span>I will not be involved in gossip or "office drama."</span>
        </div>
        <div class="commitment-item">
          <input type="text" class="initial-box" maxlength="3" placeholder="Init." aria-label="Initial for sixth commitment" />
          <span>I will show an intense level of discipline in the work that I conduct.</span>
        </div>
        <div class="commitment-item">
          <input type="text" class="initial-box" maxlength="3" placeholder="Init." aria-label="Initial for seventh commitment" />
          <span>I will have pride in my work.</span>
        </div>
        <div class="commitment-item">
          <input type="text" class="initial-box" maxlength="3" placeholder="Init." aria-label="Initial for eighth commitment" />
          <span><strong>I will do what it takes to commit to this. I will achieve tremendous levels of success.</strong></span>
        </div>
      </div>

      <p><strong>Required:</strong> You must initial each commitment above and digitally sign below before accessing other modules.</p>
      <p>Reference: <a href="/resources/Mission,%20Values,%20&%20Commitment.docx" target="_blank">Mission, Values, & Commitment (DOCX)</a></p>
    </div>
  `,
  'initial-pitch': `
    <div class="content-card">
      <h1>The Initial Pitch</h1>
      ${renderVideoPlayer('/assets/training/module5-initial-pitch.mp4', 'initial-pitch-video', '📹 Mastering the Roof-ER Pitch')}

      <h3>5 Non-Negotiables</h3>
      <ol>
        <li>Who you are</li>
        <li>Who we are and what we do (Roof-ER)</li>
        <li>Make it relatable</li>
        <li>What you're there to do (an inspection)</li>
        <li>Go for the close (them agreeing to the inspection)</li>
      </ol>

      <h3>Generic Script</h3>
      <div class="script" data-text-source="true">
        <button class="speak-btn" aria-label="Listen to script">🔊</button>
        <p>"Hi, how are you? My Name is ______ with Roof-ER we're a local roofing company that specializes in helping homeowners get their roof and/or siding replaced, paid for by their insurance!"</p>
        <p>"We've had a lot of storms here in [Region] over the past few months that have done a lot of damage!</p>
        <p>"We're working with a lot of your neighbors in the area. We've been able to help them get fully approved through their insurance company to have their roof replaced."</p>
      </div>

      <h3>The Inspection Proposal</h3>
      <div class="script" data-text-source="true">
        <button class="speak-btn" aria-label="Listen to script">🔊</button>
        <p>"While I'm here, in the neighborhood, I am conducting a completely free inspection to see if you have similar, qualifiable damage. If you do, I'll take a bunch of photos and walk you through the rest of the process. If you don't, I wouldn't want to waste your time, I wouldn't want to waste mine! I will at least leave giving you peace of mind that you're in good shape."</p>
        <p><strong>(Pause here – Wait for them to respond/agree.)</strong></p>
      </div>

      <h2>The Initial Pitch Script - Detailed</h2>
      <div class="pitch-script">
        <p><strong>Opening (30 seconds):</strong></p>
        <p>"Hi! I'm [Name] with Roof E.R. We're working in your neighborhood helping homeowners file insurance claims for storm damage. I noticed [specific damage observation - dented gutter, lifted shingles, etc.]. Mind if I take a quick look from the ground? It'll only take 2 minutes and could save you thousands."</p>

        <p><strong>Permission Secured:</strong></p>
        <p>"Great! Let me grab my ladder. I'll do a thorough inspection - check shingles, flashing, vents, everything. Takes about 15 minutes. If I find damage, I'll show you photos and explain your options. Sound good?"</p>
      </div>

      <h2>Building Rapport Tips</h2>
      <ul>
        <li><strong>Mirror their energy level</strong> - Match their enthusiasm or calmness</li>
        <li><strong>Ask about their experience with storms</strong> - Get them talking about past events</li>
        <li><strong>Compliment their home/yard authentically</strong> - Be genuine, not salesy</li>
        <li><strong>Use their name 2-3 times in conversation</strong> - Creates personal connection</li>
        <li><strong>Share brief relevant stories</strong> - "I helped your neighbor two streets over last week..."</li>
        <li><strong>Be professional but personable</strong> - You're a trusted advisor, not a pushy salesperson</li>
      </ul>

      <h2>Key Phrases That Work</h2>
      <ul>
        <li>"I'm working in your neighborhood today..."</li>
        <li>"Your neighbors at [address] just got approved for a full roof replacement..."</li>
        <li>"This will only take 2 minutes from the ground..."</li>
        <li>"Worst case, I give you peace of mind..."</li>
        <li>"I noticed [specific visible damage]..."</li>
      </ul>
    </div>
  `,
   'inspection-process': `
    <div class="content-card">
        <h1>The Inspection Process</h1>
        ${renderVideoPlayer('/assets/training/videos/module7-inspection-process.mp4', 'inspection-process-video', '📹 Complete Inspection Process Walkthrough')}

        <h2>The 10-Step Inspection Process</h2>
        <div class="inspection-steps">
          <ol>
            <li><strong>Safety First:</strong> Check ladder stability, wear harness if needed, assess roof walkability. Never compromise safety for speed.</li>
            <li><strong>360° Walk:</strong> Walk entire perimeter, check all slopes and facets. Document the whole structure before focusing on damage.</li>
            <li><strong>Shingle Inspection:</strong> Look for missing granules, cracks, lifting, bruising. Use chalk or test square to mark hail strikes.</li>
            <li><strong>Flashing Check:</strong> Inspect all flashing around chimneys, vents, valleys. Flashing failures are common leak sources.</li>
            <li><strong>Vent Inspection:</strong> Check boot seals, housing damage, proper installation. Damaged vents mean water intrusion.</li>
            <li><strong>Ridge/Hip Inspection:</strong> Look for lifted caps, damage to ridge venting. Critical for structural integrity.</li>
            <li><strong>Valley Inspection:</strong> Check for debris, damage, proper water flow. Valleys handle high water volume - must be intact.</li>
            <li><strong>Gutter Check:</strong> Look for hail dents, granule accumulation. Granules in gutters prove recent shingle damage.</li>
            <li><strong>Photo Documentation:</strong> Take 20-40 photos covering all findings. Photos are your evidence - be thorough.</li>
            <li><strong>Ground Cleanup:</strong> Pick up debris, leave property better than found. Professionalism builds trust.</li>
          </ol>
        </div>

        <h3>Ideal Photo Progression</h3>
        <p>A thorough inspection tells a story. Follow this order to capture all necessary evidence for the insurance claim. This process should take 15-20 minutes.</p>
        <ol>
            <li><strong>Mailbox/House Number/Overview of House:</strong> Set the scene.</li>
            <li><strong>Front Elevation Collateral:</strong> Damage to screens, gutters, downspouts, siding.</li>
            <li><strong>Right Elevation Collateral:</strong> Same as above.</li>
            <li><strong>Rear Elevation Collateral:</strong> Same as above.</li>
            <li><strong>Left Elevation Collateral:</strong> Same as above.</li>
            <li><strong>Roof Overview Collateral:</strong> Damage to roof metals and other items on the roof.</li>
            <li><strong>Circle Hail Hits & Slash Wind Damage:</strong> Close-up photos of each instance of damage.</li>
            <li><strong>Overview of Majority of Damage:</strong> Photos showing the chalked-up damage areas.</li>
            <li><strong>Granules in Gutters:</strong> Pictures of granules in gutters or at the bottom of downspouts.</li>
            <li><strong>Flashlight:</strong> Use a flashlight to illuminate damage if needed.</li>
        </ol>

        <h2>Photo Documentation Strategy</h2>
        <p><strong>Take photos of:</strong></p>
        <ul>
          <li><strong>Overall roof:</strong> 4 corners showing full house context</li>
          <li><strong>Each area of damage:</strong> Close-up + context shot (show location on roof)</li>
          <li><strong>Serial numbers on equipment:</strong> HVAC units, water heaters visible from roof</li>
          <li><strong>Test square with penny for size reference:</strong> Proves hail size to adjuster</li>
          <li><strong>Gutters showing granule loss:</strong> Evidence of recent shingle deterioration</li>
          <li><strong>Any matching damage:</strong> Fence, AC unit, siding - builds collateral story</li>
        </ul>

        <p><strong>Key takeaway:</strong> Getting enough clear photos to convince the homeowner is the most important part. Without their belief, you can't file a claim.</p>
    </div>
  `,
  'post-inspection-pitch': `
    <div class="content-card">
        <h1>Post-Inspection Pitch</h1>
        ${renderVideoPlayer('/assets/training/videos/module5-post-inspection.mp4', 'post-inspection-video', '📹 Post-Inspection Pitch Strategy')}

        <h2>Building the Evidence Story</h2>
        <div class="evidence-story">
          <h3>Step 1: Set Expectations</h3>
          <p>"I found some damage up there. Let me show you the photos on my tablet and explain what this means for your insurance claim..."</p>

          <h3>Step 2: Walk Through Photos</h3>
          <p>"Here's your south-facing slope - see these dark spots? That's where the protective granules are gone. This shingle is 18 years old, and these hail strikes have exposed the asphalt underneath..."</p>

          <h3>Step 3: Explain Consequences</h3>
          <p>"Without these granules, UV rays deteriorate the shingle rapidly. You'll get leaks within 2-3 years. That's $10,000+ in interior damage - water damage, mold, ceiling replacement..."</p>

          <h3>Step 4: Present Solution</h3>
          <p>"The good news? Your insurance will cover this. We file the claim, they send an adjuster, we handle everything. Your only cost is the deductible, which is typically around $1,000-$2,000 for a $20,000+ roof replacement..."</p>
        </div>

        <h3>Build the Story</h3>
        <div class="script" data-text-source="true">
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <p>"Hey ____, so I have a bunch of photos to show you. First I walked around the perimeter of the house to look for collateral damage... While this damage functionally isn't a big deal, it really helps build a story. Think of us like lawyers and this collateral damage is the evidence that builds the case which helps us get the roof approved."</p>
        </div>

        <h3>Explain the Critical Damage</h3>
        <div class="script" data-text-source="true">
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <p>"Here are the photos of the damage to your shingles. Anything I have circled means it's hail damage. This is exactly what we look for... Even if this damage doesn't look like a big deal, what happens over time, these hail divots fill with water, freeze, expand, and break apart the shingle which will eventually lead to leaks. That is why your insurance company is responsible and your policy covers this type of damage."</p>
        </div>

        <h2>Critical Damage Points to Emphasize</h2>
        <ul>
          <li><strong>Matching Law:</strong> Insurance must replace entire roof if >25% damaged (varies by state). This protects homeowners from patchwork roofs that look mismatched.</li>
          <li><strong>Urgency:</strong> Statute of limitations (1-2 years in most states). File claims promptly after storm damage or lose coverage.</li>
          <li><strong>No Cost:</strong> Free inspection, we work with insurance, you only pay deductible. No out-of-pocket expense beyond deductible.</li>
          <li><strong>Warranty:</strong> New roof comes with 30-50 year warranty vs. current aging roof with no remaining warranty coverage.</li>
          <li><strong>Home Value:</strong> New roof adds $15-20k to property value. Increases curb appeal and marketability if selling.</li>
          <li><strong>Energy Efficiency:</strong> Modern shingles reflect more heat, reducing cooling costs by 10-15% in summer.</li>
        </ul>
    </div>
  `,
  'objection-handling': `
    <div class="content-card">
        <h1>Handling Initial Pitch Objections</h1>

        <h2>The L.E.A.R.N. Framework for Objections</h2>
        <div class="learn-framework">
          <div class="learn-step">
            <h3>L - Listen</h3>
            <p>Let them finish. Don't interrupt. Show you care about their concern by giving them space to fully express it.</p>
          </div>
          <div class="learn-step">
            <h3>E - Empathize</h3>
            <p>"I completely understand..." Validate their feeling without agreeing with the objection. Make them feel heard.</p>
          </div>
          <div class="learn-step">
            <h3>A - Ask</h3>
            <p>Clarifying questions to understand the root concern. "What specifically worries you about that?" Dig deeper to find the real issue.</p>
          </div>
          <div class="learn-step">
            <h3>R - Respond</h3>
            <p>Address the actual concern with facts, benefits, or social proof. Don't just recite a script - tailor your response to their specific worry.</p>
          </div>
          <div class="learn-step">
            <h3>N - Next Step</h3>
            <p>Move forward with confidence. "So let's schedule that inspection for tomorrow at 2pm?" Always close with a clear next action.</p>
          </div>
        </div>

        <h2>Common Initial Objections & Responses</h2>
        <div class="objections-list">
          <div class="objection">
            <h3>"I'm busy right now"</h3>
            <p><strong>Response:</strong> "I understand! This will only take 2 minutes from the ground. I can come back at [time] if that works better, or we can schedule a full inspection for [tomorrow]?"</p>
            <p><strong>Why it works:</strong> Acknowledges their time constraint, offers flexibility, provides specific alternatives.</p>
          </div>
          <div class="objection">
            <h3>"We already have a roofer"</h3>
            <p><strong>Response:</strong> "That's great! When was your last inspection? Storm damage can happen without you knowing. A second opinion never hurts - it's free and takes 15 minutes."</p>
            <p><strong>Why it works:</strong> Doesn't attack their existing relationship, positions as additional value, emphasizes no-cost benefit.</p>
          </div>
          <div class="objection">
            <h3>"I don't think I have damage"</h3>
            <p><strong>Response:</strong> "You might be right! But I've been on 10 roofs in this neighborhood today, and 8 had damage the owner didn't know about. Let me check - worst case, I give you peace of mind."</p>
            <p><strong>Why it works:</strong> Uses social proof, creates urgency with neighborhood activity, emphasizes peace of mind.</p>
          </div>
          <div class="objection">
            <h3>"Not interested"</h3>
            <p><strong>Response:</strong> "I get it, a lot of your neighbors said the same thing at first. Then I showed them photos of hail damage they couldn't see from the ground. Can I at least take a quick look? If there's nothing, you lose 2 minutes. If there is damage, you save thousands."</p>
            <p><strong>Why it works:</strong> Social proof, risk-reversal, emphasizes low time investment vs high potential gain.</p>
          </div>
          <div class="objection">
            <h3>"I need to talk to my spouse"</h3>
            <p><strong>Response:</strong> "That's great, the inspection is free and I can leave info for both of you. Or I can wait a few minutes if they'll be home soon. This way you have the facts when you talk."</p>
            <p><strong>Why it works:</strong> Respects decision-making process, offers to wait or leave materials, positions inspection as information-gathering.</p>
          </div>
        </div>

        <h3>Objection Matcher Game</h3>
        <div class="game-container">
            <p class="game-instructions">Drag the homeowner's objection to the correct sales strategy.</p>
            <div id="objection-game-board" class="game-board">
                <div class="game-column">
                    <h4>Objections</h4>
                    <div id="objections-list">
                        <div class="draggable-item" draggable="true" data-match="1">"I don't have enough time."</div>
                        <div class="draggable-item" draggable="true" data-match="2">"My roof is in good shape."</div>
                        <div class="draggable-item" draggable="true" data-match="3">"Not interested."</div>
                        <div class="draggable-item" draggable="true" data-match="4">"I need to talk to my spouse."</div>
                    </div>
                </div>
                <div class="game-column">
                    <h4>Responses</h4>
                    <div class="drop-zone" data-match="3"><p class="response-text">"I get it, a lot of your neighbors said the same thing at first..."</p></div>
                    <div class="drop-zone" data-match="4"><p class="response-text">"That's great, the inspection is free and I can leave info for both of you..."</p></div>
                    <div class="drop-zone" data-match="1"><p class="response-text">"This will only take about 10-15 minutes, I'll be quick and efficient."</p></div>
                    <div class="drop-zone" data-match="2"><p class="response-text">"I understand, we're experts and can spot things from the ground that others miss..."</p></div>
                </div>
            </div>
             <div id="objection-feedback" class="feedback-message" style="display: none;"></div>
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
            <span class="shingle-badge basic">Basic Option</span>
          </div>

          <div class="shingle-photo-container">
            <div class="photo-placeholder">
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
                  <span class="spec-label">Cost</span>
                  <span class="spec-value">$80-100/square</span>
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
            <span class="shingle-badge premium">Premium Option</span>
          </div>

          <div class="shingle-photo-container">
            <img src="https://www.theroofdocs.com/wp-content/uploads/2025/03/Asphalt-Shingles-GAF-Timberline-HDZ-01-300x237.jpg"
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
                  <span class="spec-label">Cost</span>
                  <span class="spec-value">$110-150/square</span>
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
                <li><span class="star-icon">★</span> Enhanced curb appeal increases home value by 1-5%</li>
                <li><span class="star-icon">★</span> Superior wind resistance (130 mph vs 70 mph)</li>
                <li><span class="star-icon">★</span> Longer warranty coverage (typically 30-50 years)</li>
                <li><span class="star-icon">★</span> Better ROI over lifetime despite higher initial cost</li>
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
            <li>Industry-leading warranties up to Lifetime Limited</li>
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
            <li>Limited warranty compared to premium brands</li>
          </ul>
          <div class="manufacturer-note">Commonly seen on cost-conscious projects and rentals</div>
        </div>
      </div>

      <h2>Why This Knowledge Matters</h2>
      <div class="application-section">
        <div class="application-card">
          <h4>For Homeowner Communication</h4>
          <p>Understanding shingle construction helps you explain why architectural shingles cost more but deliver better value:</p>
          <ul>
            <li><strong>ROI Conversation:</strong> "The $3,000 upgrade pays for itself in 10-15 years through increased home value and avoided premature replacement"</li>
            <li><strong>Wind Resistance:</strong> "130 mph rating means your roof survives storms that would destroy 3-tab shingles"</li>
            <li><strong>Warranty Value:</strong> "30-year warranty vs. 20-year means peace of mind and transferability if you sell"</li>
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
    </div>
  `,
  'roofing-damage-id': `
   <div class="content-card">
        <h1>Roofing & Damage Identification</h1>
        ${renderVideoPlayer('/assets/training/videos/module10-damage-id.mp4', 'damage-id-video', '📹 Identifying Storm Damage')}

        <h2>Understanding Storm Damage Types</h2>

        <div class="damage-types">
          <div class="damage-type">
            <h3>🌨️ Hail Damage</h3>

            <!-- Image Gallery -->
            <div class="damage-gallery">
              <div class="damage-image-item">
                <img src="/assets/damage/wind/Wind.jpg" alt="Example roof damage">
                <p class="image-caption">Example roof damage - impact patterns</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind1.jpg" alt="Example roof damage">
                <p class="image-caption">Example roof damage - shingle surface</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind2.jpg" alt="Example roof damage">
                <p class="image-caption">Example roof damage - close-up detail</p>
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
                <img src="/assets/damage/wind/Wind.jpg" alt="Wind damage missing shingles">
                <p class="image-caption">Missing shingles blown off by wind</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind1.jpg" alt="Lifted and creased shingles">
                <p class="image-caption">Lifted and creased shingles</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind2.jpg" alt="Torn shingle edges">
                <p class="image-caption">Torn shingles at edges and ridges</p>
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

          <!-- NEW: Collateral Damage Card -->
          <div class="damage-type">
            <h3>🎯 Collateral Damage</h3>

            <div class="damage-gallery">
              <div class="damage-image-item">
                <img src="/assets/damage/wind/Wind.jpg" alt="Example collateral damage">
                <p class="image-caption">Example collateral damage on exterior surfaces</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind1.jpg" alt="Example collateral damage">
                <p class="image-caption">Example impact damage on property</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind2.jpg" alt="Example collateral damage">
                <p class="image-caption">Example secondary storm damage</p>
              </div>
            </div>

            <h4>Why Collateral Damage Matters:</h4>
            <p>Collateral damage strengthens your claim by proving storm impact across multiple surfaces.</p>
            <ul>
              <li><strong>Metal Items:</strong> Dented gutters, downspouts, vents, flashing, AC units</li>
              <li><strong>Soft Items:</strong> Window screens with pitting, vinyl siding damage</li>
              <li><strong>Ground Items:</strong> Damaged deck railings, mailboxes, outdoor furniture</li>
              <li><strong>Key Point:</strong> Insurance can't argue "normal wear" when brand-new items show obvious impact damage</li>
            </ul>
          </div>
        </div>

        <h2>📐 The "Test Square" Method</h2>
        <div class="test-square">
          <p>Insurance companies require a <strong>test square</strong> - a 10x10 ft area with minimum damage counts:</p>

          <!-- Test Square Visual Examples -->
          <div class="damage-gallery" style="margin: 20px 0;">
            <div class="damage-image-item">
              <img src="/assets/damage/wind/Wind.jpg" alt="Example test square documentation">
              <p class="image-caption">Example damage documentation method</p>
            </div>
            <div class="damage-image-item">
              <img src="/assets/damage/wind/wind1.jpg" alt="Example test square area">
              <p class="image-caption">Example test square area measurement</p>
            </div>
            <div class="damage-image-item">
              <img src="/assets/damage/wind/wind2.jpg" alt="Example damage reference">
              <p class="image-caption">Example damage reference documentation</p>
            </div>
          </div>

          <ul>
            <li><strong>Hail:</strong> Minimum 8-10 hits per 100 sq ft (varies by carrier)</li>
            <li><strong>Location:</strong> Choose south or west-facing slope (most sun exposure = most damage)</li>
            <li><strong>Documentation:</strong> Circle damage with chalk, photograph from multiple angles</li>
            <li><strong>Why it matters:</strong> This determines if they'll approve full replacement vs. repair</li>
          </ul>
        </div>

        <h3>Shingle Types</h3>
        <p>Identifying the type of shingle is crucial for assessing damage and communicating with adjusters.</p>
        <div class="shingle-comparison">
            <div class="shingle-type">
                <h4>3-Tab Shingles</h4>
                <div style="padding: 40px; background: #f5f5f5; border: 2px solid #ddd; border-radius: 8px; text-align: center;">
                  <p><strong>3-Tab Shingle Reference</strong></p>
                  <p style="margin-top: 10px; color: #666;">Flat, single-layer appearance with distinct rectangular cutouts</p>
                </div>
                <p>Flat, single-layer appearance with distinct rectangular cutouts.</p>
            </div>
            <div class="shingle-type">
                <h4>Architectural Shingles</h4>
                <div style="padding: 40px; background: #f5f5f5; border: 2px solid #ddd; border-radius: 8px; text-align: center;">
                  <p><strong>Architectural Shingle Reference</strong></p>
                  <p style="margin-top: 10px; color: #666;">Laminated, multi-layer design giving a dimensional, textured look</p>
                </div>
                <p>Laminated, multi-layer design giving a dimensional, textured look.</p>
            </div>
        </div>
        <hr>
        <h2>⚠️ Storm Damage vs. Non-Storm Damage</h2>
        <p>It's vital to differentiate between actual storm damage and other roof issues.</p>

        <!-- NEW: Non-Qualifying Damage Card with Images -->
        <div class="damage-types" style="margin-top: 20px;">
          <div class="damage-type" style="border-color: #28a745;">
            <h3 style="color: #28a745;">✅ Storm Damage (Qualifying)</h3>
            <div class="damage-gallery">
              <div class="damage-image-item">
                <img src="/assets/damage/wind/Wind.jpg" alt="Example storm damage">
                <p class="image-caption">Example storm damage - qualifying impacts</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind1.jpg" alt="Wind lifted shingles">
                <p class="image-caption">Wind: Lifted/creased shingles</p>
              </div>
            </div>
            <ul>
              <li><strong>Hail Damage:</strong> Circular "bruises" or divots where granules are knocked off, often with a soft or spongy feel</li>
              <li><strong>Wind Damage:</strong> Lifted, creased, or missing shingles from strong winds</li>
              <li><strong>Why Qualifying:</strong> These are direct results of weather events covered by insurance</li>
            </ul>
          </div>

          <div class="damage-type" style="border-color: #dc3545;">
            <h3 style="color: #dc3545;">❌ Non-Storm Damage (Non-Qualifying)</h3>
            <div class="damage-gallery">
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind2.jpg" alt="Example non-qualifying damage">
                <p class="image-caption">Example non-qualifying damage reference</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/Wind.jpg" alt="Example age-related wear">
                <p class="image-caption">Example wear pattern reference</p>
              </div>
              <div class="damage-image-item">
                <img src="/assets/damage/wind/wind1.jpg" alt="Example general deterioration">
                <p class="image-caption">Example deterioration reference</p>
              </div>
            </div>
            <ul>
              <li><strong>Blistering:</strong> Looks like bubbles on shingle surface - a manufacturing defect, not storm damage</li>
              <li><strong>Cracking:</strong> Age-related deterioration appearing as splintering or straight lines</li>
              <li><strong>Granule Loss:</strong> General, even loss of granules due to age, not concentrated spots like hail hits</li>
              <li><strong>Why Non-Qualifying:</strong> These are wear-and-tear issues, not covered by storm damage insurance</li>
            </ul>
          </div>
        </div>

        <!-- NEW: Interactive Hotspot Quiz -->
        <h2>📸 Damage Identification Challenge</h2>
        <p>Test your knowledge! Click on the damaged areas in the photos below. Find all the damage spots to complete each challenge.</p>

        <div id="hotspot-quiz-container">
          <!-- Quiz Question 1: Hail Damage -->
          <div class="hotspot-quiz-question" data-question="1" data-damage-type="hail">
            <h3>Challenge 1: Identify Clear Hail Impact Sites</h3>
            <p class="quiz-instruction">Click on all areas showing obvious hail damage (3 spots)</p>

            <div class="quiz-image-container">
              <img src="/assets/damage/hail/hail-damage-1.jpg" alt="Roof with clear hail damage"
                   class="clickable-quiz-image"
                   data-hotspots="28.6,30.0,4;57.1,45.0,4;75.0,60.0,4"
                   data-total-spots="3">
              <div class="hotspot-markers"></div>
              <div class="hotspot-guides"></div>
            </div>

            <div class="quiz-feedback">
              <p class="quiz-score">Found: <span class="found-count">0</span> / <span class="total-count">3</span></p>
              <p class="quiz-hint" style="display: none;">💡 Hint: Look for circular impact craters with inspection markers</p>
              <div class="quiz-actions">
                <button class="btn-hint">Show Hint</button>
                <button class="btn-toggle-guides" data-question="1">Show Hotspot Zones</button>
                <button class="btn-reset">Try Again</button>
                <button class="btn-next" style="display: none;">Next Challenge →</button>
              </div>
            </div>
          </div>

          <!-- Quiz Question 2: Mixed Damage -->
          <div class="hotspot-quiz-question" data-question="2" data-damage-type="mixed" style="display: none;">
            <h3>Challenge 2: Distinguish Impact vs. Normal Wear</h3>
            <p class="quiz-instruction">Click ONLY on actual hail impacts, not general weathering (3 spots)</p>

            <div class="quiz-image-container">
              <img src="/assets/damage/hail/hail-damage-2.jpg" alt="Roof with mixed damage and wear"
                   class="clickable-quiz-image"
                   data-hotspots="25.0,40.0,4;50.0,35.0,4;67.9,55.0,4"
                   data-total-spots="3">
              <div class="hotspot-markers"></div>
              <div class="hotspot-guides"></div>
            </div>

            <div class="quiz-feedback">
              <p class="quiz-score">Found: <span class="found-count">0</span> / <span class="total-count">3</span></p>
              <p class="quiz-hint" style="display: none;">💡 Hint: Impact damage shows distinct circular patterns, not random wear marks</p>
              <div class="quiz-actions">
                <button class="btn-hint">Show Hint</button>
                <button class="btn-toggle-guides" data-question="2">Show Hotspot Zones</button>
                <button class="btn-reset">Try Again</button>
                <button class="btn-next" style="display: none;">Next Challenge →</button>
              </div>
            </div>
          </div>

          <!-- Quiz Question 3: Qualifying vs Non-Qualifying -->
          <div class="hotspot-quiz-question" data-question="3" data-damage-type="subtle" style="display: none;">
            <h3>Challenge 3: Find Qualifying Damage Among Weathering</h3>
            <p class="quiz-instruction">Advanced: Identify subtle hail impacts among heavy weathering (3 spots)</p>

            <div class="quiz-image-container">
              <img src="/assets/damage/hail/hail-damage-3.jpg" alt="Weathered roof with subtle damage"
                   class="clickable-quiz-image"
                   data-hotspots="39.3,45.0,4;60.7,55.0,4;32.1,65.0,4"
                   data-total-spots="3">
              <div class="hotspot-markers"></div>
              <div class="hotspot-guides"></div>
            </div>

            <div class="quiz-feedback">
              <p class="quiz-score">Found: <span class="found-count">0</span> / <span class="total-count">3</span></p>
              <p class="quiz-hint" style="display: none;">💡 Hint: Look for the few inspection markers showing actual impacts vs. general aging</p>
              <div class="quiz-actions">
                <button class="btn-hint">Show Hint</button>
                <button class="btn-toggle-guides" data-question="3">Show Hotspot Zones</button>
                <button class="btn-reset">Try Again</button>
                <button class="btn-complete" style="display: none;">Complete Quiz 🎉</button>
              </div>
            </div>
          </div>

          <!-- Quiz Complete Message -->
          <div id="quiz-complete-message" style="display: none;">
            <div class="success-banner">
              <h3>🎉 Congratulations!</h3>
              <p>You've completed the Damage Identification Challenge!</p>
              <p class="final-score">Your Score: <span id="final-score">0</span> / <span id="total-possible">9</span></p>
              <button class="btn-restart-quiz">Restart Quiz</button>
            </div>
          </div>
        </div>

        <h2>Documentation Strategy Sequence</h2>
        <p>Follow this exact order for professional, adjuster-ready documentation:</p>
        <ol>
          <li><strong>Property ID:</strong> House number, full front view</li>
          <li><strong>Overview Shots:</strong> All four elevations of the home</li>
          <li><strong>Elevation Collateral:</strong> Gutters, siding, windows from each side</li>
          <li><strong>Roof Overview:</strong> Wide shots of each slope</li>
          <li><strong>Damage Markup:</strong> Circle hail hits with chalk, slash wind damage</li>
          <li><strong>Close-ups:</strong> Individual damage photos with size reference (penny/quarter)</li>
          <li><strong>Granule Loss:</strong> Gutters and downspouts filled with granules</li>
        </ol>
    </div>
  `,
  'sales-cycle': `
    <div class="content-card">
        <h1>The Sales Cycle</h1>

        <h2>The Complete Roof-ER Sales Cycle</h2>
        <div class="sales-cycle">
          <div class="cycle-phase">
            <h3>Phase 1: Lead Generation (Days 1-2)</h3>
            <ul>
              <li>Storm tracking & mapping</li>
              <li>Door knocking targeted neighborhoods</li>
              <li>Initial pitch & permission</li>
              <li><strong>Goal:</strong> Book inspection</li>
            </ul>
          </div>

          <div class="cycle-phase">
            <h3>Phase 2: Inspection & Sale (Day 2-3)</h3>
            <ul>
              <li>Thorough roof inspection (15 min)</li>
              <li>Photo documentation (20-40 photos)</li>
              <li>Post-inspection pitch</li>
              <li>File insurance claim</li>
              <li><strong>Goal:</strong> Signed contract</li>
            </ul>
          </div>

          <div class="cycle-phase">
            <h3>Phase 3: Adjuster Meeting (Day 7-14)</h3>
            <ul>
              <li>Insurance assigns adjuster</li>
              <li>Meet adjuster on site</li>
              <li>Walk through all damage</li>
              <li>Negotiate scope if needed</li>
              <li><strong>Goal:</strong> Full approval</li>
            </ul>
          </div>

          <div class="cycle-phase">
            <h3>Phase 4: Materials & Scheduling (Day 15-21)</h3>
            <ul>
              <li>Order materials</li>
              <li>Schedule production crew</li>
              <li>Confirm homeowner availability</li>
              <li><strong>Goal:</strong> Install date set</li>
            </ul>
          </div>

          <div class="cycle-phase">
            <h3>Phase 5: Installation (Day 22-23)</h3>
            <ul>
              <li>Crew arrives 7-8am</li>
              <li>Full tear-off and install (1-2 days)</li>
              <li>Final inspection</li>
              <li>Collect payment</li>
              <li><strong>Goal:</strong> Happy customer</li>
            </ul>
          </div>

          <div class="cycle-phase">
            <h3>Phase 6: Follow-Up (Day 30+)</h3>
            <ul>
              <li>Post-install call</li>
              <li>Request Google review</li>
              <li>Ask for referrals</li>
              <li><strong>Goal:</strong> Repeat business</li>
            </ul>
          </div>
        </div>

        <h2>Average Timeline: 21-28 Days</h2>
        <p>From initial knock to completed roof, expect 3-4 weeks for a smooth job.</p>

        <h2>Key Milestones & Commissions</h2>
        <ul>
          <li><strong>Contract Signed:</strong> Initial commission ($500-1,000 depending on job size)</li>
          <li><strong>Adjuster Meeting:</strong> Track approval status</li>
          <li><strong>Project Meeting:</strong> Collect ACV/downpayment ($1,000 commission)</li>
          <li><strong>Install Complete:</strong> Final payment & residual commission</li>
        </ul>

        <h3>Sales Cycle Sorter Game</h3>
        <div class="game-container">
            <p class="game-instructions">Drag and drop the sales cycle stages into the correct order from start to finish.</p>
            <div id="sales-cycle-game" class="game-board">
                <div class="game-column">
                    <h4>Stages</h4>
                    <div id="items-pool">
                        <div class="draggable-item" draggable="true" data-order="3">Adjuster Meeting</div>
                        <div class="draggable-item" draggable="true" data-order="1">Generating New Business</div>
                        <div class="draggable-item" draggable="true" data-order="5">Install & Final Payment</div>
                        <div class="draggable-item" draggable="true" data-order="2">Inspection & Pitch</div>
                        <div class="draggable-item" draggable="true" data-order="4">Project Meeting & Downpayment</div>
                    </div>
                </div>
                <div class="game-column">
                    <h4>Correct Order</h4>
                    <div id="sorted-list" class="drop-zone-sort"></div>
                </div>
            </div>
            <div id="sales-cycle-feedback" class="feedback-message" style="display: none;"></div>
        </div>
    </div>
  `,
  'claim-closing': `
     <div class="content-card">
        <h1>Filing a Claim & Closing</h1>

        <h2>When to File the Claim</h2>
        <div class="filing-timeline">
          <div class="timeline-step">
            <h3>✓ Immediately (Same Day):</h3>
            <p>If homeowner is ready, file the claim before you leave. Strike while the iron is hot. You'll need:</p>
            <ul>
              <li>Policy number (on insurance card)</li>
              <li>Date of loss (storm date - check weather reports)</li>
              <li>Contact information</li>
              <li>Brief description: "Hail/wind damage to roof"</li>
            </ul>
          </div>

          <div class="timeline-step">
            <h3>⏰ Within 24 Hours:</h3>
            <p>If they need to "think about it," follow up next morning. Send them:</p>
            <ul>
              <li>Photo gallery link</li>
              <li>Written summary of damage</li>
              <li>Text: "Hi [Name]! Following up on your roof. Ready to file that claim? I can do it over the phone in 2 minutes."</li>
            </ul>
          </div>

          <div class="timeline-step">
            <h3>🚫 Never Wait More Than 48 Hours:</h3>
            <p>After 48 hours, they'll cool off, get other opinions, forget urgency. File ASAP or risk losing the deal.</p>
          </div>
        </div>

        <h2>The Filing Call Script</h2>
        <div class="filing-script">
          <p><strong>"I'm calling to file a claim for storm damage to the roof at [address]."</strong></p>

          <p><strong>Carrier will ask:</strong></p>
          <ol>
            <li>Policy number → [Read from card]</li>
            <li>Date of loss → "[Storm date] - we had [hail/wind] in the area"</li>
            <li>Description → "Inspector found damage to roof shingles from recent storm"</li>
            <li>Anyone injured? → "No"</li>
            <li>Is the property secured? → "Yes, no immediate leaks"</li>
            <li>Have repairs been made? → "No, waiting for adjuster"</li>
          </ol>

          <p><strong>You'll get:</strong></p>
          <ul>
            <li>Claim number (write it down!)</li>
            <li>Adjuster assignment (usually 3-5 business days)</li>
            <li>Next steps explanation</li>
          </ul>
        </div>

        <h3>Prepping the Homeowner</h3>
        <p>Before the call to the insurance company, you must prep the homeowner. Use a blank note on your iPad to go over these key points so they know what to say.</p>
        <ul>
            <li><strong>Reason for claim:</strong> "I'd like to file a claim for hail and wind damage." (Never only one type).</li>
            <li><strong>Damaged items:</strong> Roof, Downspouts, Gutters, Siding, etc.</li>
            <li><strong>Selected Contractor:</strong> "Yes, we have selected Roof-ER."</li>
            <li><strong>Have an estimate:</strong> "No."</li>
        </ul>

        <h2>After Filing: The Close</h2>
        <div class="closing-steps">
          <p><strong>"Great! Claim #[number] is filed. Here's what happens next:"</strong></p>

          <ol>
            <li><strong>Adjuster Contact:</strong> "They'll call you in 3-5 days to schedule inspection."</li>
            <li><strong>Our Role:</strong> "I'll meet the adjuster here, show them everything, make sure they see all damage."</li>
            <li><strong>Authorization:</strong> "I'll text you a contract now. E-sign it so I'm authorized to work with the adjuster."</li>
            <li><strong>Timeline:</strong> "Once approved, 3-4 weeks to completion. I'll update you every step."</li>
            <li><strong>Reassurance:</strong> "You did the right thing. This protects your biggest investment."</li>
          </ol>
        </div>

        <h3>The Contingency & Claim Authorization</h3>
        <p>After the claim is filed, you will present the agreements. This is the close.</p>
        <div class="script" data-text-source="true">
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <p><strong>Contingency Agreement:</strong> "This basic agreement backs you as the homeowner by guaranteeing your only cost will be your deductible if we get you fully approved. If it is a partial approval or denial, we will fight for you. But if we are not able to get you fully approved, this contract is null and void and you do not owe us a penny."</p>
            <p><strong>Claim Authorization:</strong> "This next form is our Claim Authorization. Very simple, it allows us to communicate with your insurance company on your behalf. I'll be here for the inspection and will communicate with them, so you don't have to be the middle-man. Of course, I'll always keep you looped in."</p>
        </div>

        <h2>Common Filing Mistakes to Avoid</h2>
        <ul>
          <li><strong>❌ Filing without homeowner present:</strong> Always file WITH them on speakerphone</li>
          <li><strong>❌ Saying "full roof replacement":</strong> Say "damage to roof" - let adjuster determine scope</li>
          <li><strong>❌ Not getting claim number:</strong> Write it down immediately, text it to homeowner</li>
          <li><strong>❌ Forgetting to ask about inspection timeline:</strong> Ask when adjuster will contact them</li>
        </ul>
    </div>
  `,
  'role-play': `
    <div class="content-card agnes-roleplay-container">
        <h1>🎙️ Agnes 21 AI Role-Play Training</h1>
        <p class="agnes-subtitle">Practice your sales pitch with real-time AI feedback. Choose your training mode below.</p>

        <!-- Error Display -->
        <div id="agnes-error" class="agnes-error" style="display: none;"></div>

        <!-- Step 1: Training Type Selector -->
        <div id="agnes-mode-selector" style="display: block;">
            <div id="agnes-xp-bar" class="agnes-xp-bar"></div>

            <h2>How Do You Want to Train?</h2>
            <div class="agnes-mode-grid">
                <button id="agnes-roleplay-btn" class="agnes-mode-card voice-mode">
                    <div class="mode-icon">🎭</div>
                    <div class="mode-title">Role Play</div>
                    <div class="mode-subtitle">Free Practice</div>
                    <div class="mode-desc">
                        <ul>
                            <li>🗣️ Jump right into conversation</li>
                            <li>🎯 Real-time AI feedback</li>
                            <li>📊 Scoring after each response</li>
                            <li>💪 Build confidence fast</li>
                        </ul>
                    </div>
                    <div class="mode-badge">RECOMMENDED</div>
                </button>

                <button id="agnes-walkthrough-btn" class="agnes-mode-card text-mode">
                    <div class="mode-icon">📚</div>
                    <div class="mode-title">Walk Through</div>
                    <div class="mode-subtitle">Guided Practice</div>
                    <div class="mode-desc">
                        <ul>
                            <li>📝 See example responses first</li>
                            <li>🎓 Learn the ideal approach</li>
                            <li>🔄 Then practice yourself</li>
                            <li>✅ Compare your response</li>
                        </ul>
                    </div>
                </button>
            </div>
        </div>

        <!-- Step 2: Input Mode Selector (Role Play only) -->
        <div id="agnes-input-mode-selector" style="display: none;">
            <h2>Choose Your Input Method</h2>
            <p>How would you like to practice?</p>
            <div class="agnes-mode-grid">
                <button id="agnes-voice-mode-btn" class="agnes-mode-card voice-mode">
                    <div class="mode-icon">🎤</div>
                    <div class="mode-title">Voice Mode</div>
                    <div class="mode-subtitle">Speak with Agnes</div>
                    <div class="mode-desc">
                        <ul>
                            <li>🗣️ Real conversation practice</li>
                            <li>📹 Optional video recording</li>
                            <li>⚡ Instant audio feedback</li>
                        </ul>
                    </div>
                    <div class="mode-badge">BEST FOR REALISM</div>
                </button>

                <button id="agnes-text-mode-btn" class="agnes-mode-card text-mode">
                    <div class="mode-icon">⌨️</div>
                    <div class="mode-title">Text Mode</div>
                    <div class="mode-subtitle">Type Your Responses</div>
                    <div class="mode-desc">
                        <ul>
                            <li>✍️ Think at your own pace</li>
                            <li>📝 Review before submitting</li>
                            <li>📊 Detailed scoring</li>
                        </ul>
                    </div>
                </button>
            </div>
            <button onclick="showAgnesScreen('agnes-mode-selector')" class="btn-secondary" style="margin-top: 20px;">← Back</button>
        </div>

        <!-- Step 3: Module Selector -->
        <div id="agnes-module-selector" style="display: none;">
            <h2>What Do You Want to Practice?</h2>
            <p>Agnes will auto-select scenarios from your chosen module.</p>
            <div class="agnes-module-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 25px 0;">
                <button class="agnes-module-card" data-module="7" style="padding: 25px; border: 2px solid #e5e7eb; border-radius: 12px; background: white; cursor: pointer; text-align: left; transition: all 0.3s;">
                    <div style="font-size: 36px; margin-bottom: 10px;">🚪</div>
                    <div style="font-weight: 700; font-size: 16px; color: #1f2937;">Module 7</div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 5px;">Door Knock & Inspection</div>
                    <div style="font-size: 12px; color: #8b4fbe; margin-top: 8px;">9 scenarios</div>
                </button>
                <button class="agnes-module-card" data-module="8" style="padding: 25px; border: 2px solid #e5e7eb; border-radius: 12px; background: white; cursor: pointer; text-align: left; transition: all 0.3s;">
                    <div style="font-size: 36px; margin-bottom: 10px;">📋</div>
                    <div style="font-weight: 700; font-size: 16px; color: #1f2937;">Module 8</div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 5px;">Post-Inspection Pitch</div>
                    <div style="font-size: 12px; color: #8b4fbe; margin-top: 8px;">3 scenarios</div>
                </button>
                <button class="agnes-module-card" data-module="9" style="padding: 25px; border: 2px solid #e5e7eb; border-radius: 12px; background: white; cursor: pointer; text-align: left; transition: all 0.3s;">
                    <div style="font-size: 36px; margin-bottom: 10px;">🛑</div>
                    <div style="font-weight: 700; font-size: 16px; color: #1f2937;">Module 9</div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 5px;">Objection Handling</div>
                    <div style="font-size: 12px; color: #8b4fbe; margin-top: 8px;">14 scenarios</div>
                </button>
                <button class="agnes-module-card" data-module="12" style="padding: 25px; border: 2px solid #e5e7eb; border-radius: 12px; background: white; cursor: pointer; text-align: left; transition: all 0.3s;">
                    <div style="font-size: 36px; margin-bottom: 10px;">✍️</div>
                    <div style="font-weight: 700; font-size: 16px; color: #1f2937;">Module 12</div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 5px;">Closing the Deal</div>
                    <div style="font-size: 12px; color: #8b4fbe; margin-top: 8px;">12 scenarios</div>
                </button>
            </div>
            <button id="agnes-module-back-btn" class="btn-secondary">← Back</button>
        </div>

        <!-- Step 4: Personality/Difficulty Selector -->
        <div id="agnes-difficulty-selector" style="display: none;">
            <h2>Choose Your Agnes</h2>
            <p>Each personality has different difficulty. Higher difficulty = more XP!</p>
            <div id="agnes-difficulty-grid" class="agnes-difficulty-grid">
                <!-- Dynamically populated -->
            </div>
            <button onclick="showAgnesScreen('agnes-module-selector')" class="btn-secondary">← Back to Module Selection</button>
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
                            <p class="hint">Say "Hi, my name is..." to start your pitch</p>
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
                    <li>Speak clearly and at a natural pace</li>
                    <li>Cover the 5 non-negotiables in your pitch</li>
                    <li>Say "Score me" when ready for feedback</li>
                </ul>
            </div>
        </div>

        <!-- Text UI Screen (wraps original content) -->
        <div id="agnes-text-ui" style="display: none;">
            <div id="roleplay-live-region" class="sr-only" aria-live="polite" aria-atomic="true"></div>

            <!-- Screen 1: Category Selection -->
            <div id="category-selector" style="display: block;">
                <h2>Choose Your Training Focus</h2>
                <p>Select a scenario category to practice. Each has AI-powered feedback and multiple difficulty levels.</p>
                <div class="category-grid">
                    <button class="category-card" data-category="inspection">
                        <div class="category-icon">🔍</div>
                        <div class="category-title">Inspection Process</div>
                        <div class="category-source">From Module 7</div>
                        <div class="category-count">5 scenarios</div>
                    </button>
                    <button class="category-card" data-category="initialPitch">
                        <div class="category-icon">🚪</div>
                        <div class="category-title">Door Knock & Pitch</div>
                        <div class="category-source">From Module 7</div>
                        <div class="category-count">4 scenarios</div>
                    </button>
                    <button class="category-card" data-category="postInspection">
                        <div class="category-icon">📋</div>
                        <div class="category-title">Post-Inspection Pitch</div>
                        <div class="category-source">From Module 8</div>
                        <div class="category-count">3 scenarios</div>
                    </button>
                    <button class="category-card" data-category="initialObjections">
                        <div class="category-icon">🛑</div>
                        <div class="category-title">Initial Objections</div>
                        <div class="category-source">From Module 9</div>
                        <div class="category-count">5 scenarios</div>
                    </button>
                    <button class="category-card" data-category="postInspectionObjections">
                        <div class="category-icon">💬</div>
                        <div class="category-title">Post-Inspection Objections</div>
                        <div class="category-source">From Module 9</div>
                        <div class="category-count">9 scenarios</div>
                    </button>
                    <button class="category-card" data-category="closingObjections">
                        <div class="category-icon">✍️</div>
                        <div class="category-title">Closing Objections</div>
                        <div class="category-source">From Module 12</div>
                        <div class="category-count">12 scenarios</div>
                    </button>
                </div>
                <div class="quick-actions" style="margin-top: 25px; display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
                    <button id="random-scenario-btn" class="btn-secondary">🎲 Random Scenario</button>
                    <button id="legacy-role-btn" class="btn-secondary">👥 Browse by Role</button>
                </div>
                <button onclick="showAgnesScreen('agnes-mode-selector')" class="btn-secondary" style="margin-top: 20px;">← Back to Mode Selection</button>
            </div>

            <!-- Screen 1.5: Scenario List for Selected Category -->
            <div id="scenario-list" style="display: none;">
                <div class="scenario-list-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 15px;">
                    <button id="back-to-categories" class="btn-back" style="background: #f0f0f0; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">← Back</button>
                    <h2 id="category-title-display" style="margin: 0; flex: 1; text-align: center;">Scenarios</h2>
                    <div class="filter-controls">
                        <select id="role-filter" style="padding: 8px 15px; border-radius: 6px; border: 1px solid #ddd;">
                            <option value="all">All Roles</option>
                            <option value="homeowner">Homeowner</option>
                            <option value="rep">Sales Rep</option>
                            <option value="adjuster">Adjuster</option>
                        </select>
                    </div>
                </div>
                <div id="scenario-cards" class="scenario-cards-grid"></div>
            </div>

            <!-- Screen 1.75: Legacy Role Selection -->
            <div id="roleplay-setup" style="display: none;">
                <h2>Browse by Role</h2>
                <p>Choose a role to see all scenarios for that perspective.</p>
                <div class="role-selection-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0;">
                    <button class="role-btn" data-role="homeowner" style="padding: 30px; border: 2px solid #8b4fbe; border-radius: 10px; background: linear-gradient(135deg, #8b4fbe 0%, #a370d1 100%); color: white; font-size: 18px; cursor: pointer; transition: all 0.3s;">
                        <div style="font-size: 48px; margin-bottom: 10px;">🏠</div>
                        <div style="font-weight: bold; margin-bottom: 10px;">Homeowner</div>
                        <div style="font-size: 14px; opacity: 0.9;">Practice handling common objections and concerns</div>
                    </button>
                    <button class="role-btn" data-role="rep" style="padding: 30px; border: 2px solid #8b4fbe; border-radius: 10px; background: linear-gradient(135deg, #8b4fbe 0%, #a370d1 100%); color: white; font-size: 18px; cursor: pointer; transition: all 0.3s;">
                        <div style="font-size: 48px; margin-bottom: 10px;">💼</div>
                        <div style="font-weight: bold; margin-bottom: 10px;">Sales Rep</div>
                        <div style="font-size: 14px; opacity: 0.9;">Refine your pitch and closing techniques</div>
                    </button>
                    <button class="role-btn" data-role="adjuster" style="padding: 30px; border: 2px solid #8b4fbe; border-radius: 10px; background: linear-gradient(135deg, #8b4fbe 0%, #a370d1 100%); color: white; font-size: 18px; cursor: pointer; transition: all 0.3s;">
                        <div style="font-size: 48px; margin-bottom: 10px;">📋</div>
                        <div style="font-weight: bold; margin-bottom: 10px;">Adjuster</div>
                        <div style="font-size: 14px; opacity: 0.9;">Master technical documentation and negotiation</div>
                    </button>
                </div>
                <button onclick="showAgnesTextScreen('category-selector')" class="btn-secondary">← Back to Categories</button>
            </div>

            <!-- Screen 1.5: Personality Selection -->
            <div id="personality-selector" style="display: none;">
                <h2>Choose Your Agnes AI Coach</h2>
                <p>Select the AI personality that best matches your training goals.</p>
                <div class="personality-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin: 30px 0;">
                    <button class="personality-card" data-personality="supportive" data-difficulty="1" style="padding: 25px; border: 3px solid #4caf50; border-radius: 12px; background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); cursor: pointer; text-align: left;">
                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                            <div style="font-size: 42px; margin-right: 15px;">😊</div>
                            <div>
                                <div style="font-weight: bold; font-size: 18px; color: #2e7d32;">Agnes the Supportive Coach</div>
                                <div style="font-size: 14px; color: #1b5e20; margin-top: 5px;">⭐ Easy</div>
                            </div>
                        </div>
                        <p style="margin: 0; font-size: 14px; color: #555;">Encouraging and patient. Perfect for beginners.</p>
                    </button>
                    <button class="personality-card" data-personality="realistic" data-difficulty="2" style="padding: 25px; border: 3px solid #2196f3; border-radius: 12px; background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); cursor: pointer; text-align: left;">
                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                            <div style="font-size: 42px; margin-right: 15px;">🏠</div>
                            <div>
                                <div style="font-weight: bold; font-size: 18px; color: #1565c0;">Agnes the Real Homeowner</div>
                                <div style="font-size: 14px; color: #0d47a1; margin-top: 5px;">⭐⭐ Medium</div>
                            </div>
                        </div>
                        <p style="margin: 0; font-size: 14px; color: #555;">Realistic homeowner with real concerns.</p>
                    </button>
                    <button class="personality-card" data-personality="skeptical" data-difficulty="3" style="padding: 25px; border: 3px solid #ff9800; border-radius: 12px; background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); cursor: pointer; text-align: left;">
                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                            <div style="font-size: 42px; margin-right: 15px;">🤔</div>
                            <div>
                                <div style="font-weight: bold; font-size: 18px; color: #e65100;">Agnes the Skeptical Buyer</div>
                                <div style="font-size: 14px; color: #bf360c; margin-top: 5px;">⭐⭐⭐ Hard</div>
                            </div>
                        </div>
                        <p style="margin: 0; font-size: 14px; color: #555;">Questioning and doubtful. Requires strong persuasion.</p>
                    </button>
                    <button class="personality-card" data-personality="rushed" data-difficulty="4" style="padding: 25px; border: 3px solid #f44336; border-radius: 12px; background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%); cursor: pointer; text-align: left;">
                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                            <div style="font-size: 42px; margin-right: 15px;">⏰</div>
                            <div>
                                <div style="font-weight: bold; font-size: 18px; color: #c62828;">Agnes the Rushed</div>
                                <div style="font-size: 14px; color: #b71c1c; margin-top: 5px;">⭐⭐⭐⭐ Expert</div>
                            </div>
                        </div>
                        <p style="margin: 0; font-size: 14px; color: #555;">Impatient and time-sensitive. Be concise!</p>
                    </button>
                    <button class="personality-card" data-personality="final-boss" data-difficulty="5" style="padding: 25px; border: 3px solid #9c27b0; border-radius: 12px; background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%); cursor: pointer; text-align: left;">
                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                            <div style="font-size: 42px; margin-right: 15px;">👑</div>
                            <div>
                                <div style="font-weight: bold; font-size: 18px; color: #6a1b9a;">Agnes the Final Boss</div>
                                <div style="font-size: 14px; color: #4a148c; margin-top: 5px;">⭐⭐⭐⭐⭐ Master</div>
                            </div>
                        </div>
                        <p style="margin: 0; font-size: 14px; color: #555;">Ultimate challenge. All objection types combined.</p>
                    </button>
                </div>
                <button id="back-to-roles" class="btn-secondary">← Back to Role Selection</button>
            </div>

            <!-- Screen 2: Scenario Display -->
            <div id="scenario-display" style="display: none;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <div id="scenario-progress" style="font-weight: 500; color: #8b4fbe;"></div>
                    <div id="turn-counter" style="font-weight: 600; color: #8b4fbe; background: #f8f4fc; padding: 8px 16px; border-radius: 20px; border: 2px solid #8b4fbe;">Turn 1 of 5</div>
                </div>
                <div class="roleplay-container-with-feedback">
                    <div class="roleplay-main-content">
                        <div style="background: #f8f4fc; border-left: 4px solid #8b4fbe; padding: 20px; margin-bottom: 20px; border-radius: 5px;">
                            <h3 id="scenario-title" style="margin: 0 0 10px 0; color: #8b4fbe;">Scenario</h3>
                            <p id="scenario-context" style="margin: 0 0 15px 0; color: #555;"></p>
                        </div>
                        <div style="margin-bottom: 20px;">
                            <h4 style="color: #8b4fbe; margin-bottom: 10px;">Conversation:</h4>
                            <div id="conversation-thread" style="max-height: 400px; overflow-y: auto; background: white; border: 2px solid #e0d4f0; border-radius: 8px; padding: 15px;"></div>
                        </div>
                        <div style="margin-bottom: 20px;">
                            <label for="user-response" style="display: block; font-weight: 500; margin-bottom: 10px;">Your Response:</label>
                            <textarea id="user-response" rows="4" style="width: 100%; padding: 15px; border: 2px solid #e0d4f0; border-radius: 5px; font-size: 16px;" placeholder="Type your response here..."></textarea>
                        </div>
                        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                            <button id="submit-response" class="btn-primary" style="flex: 1;">Submit Response</button>
                            <button id="voice-input-btn" class="btn-secondary">🎤 Voice</button>
                            <button id="hint-btn" class="btn-secondary">💡 Hint</button>
                        </div>
                        <div id="hint-display" style="display: none; background: #fff9e6; border-left: 4px solid #ffc107; padding: 15px; border-radius: 5px;"></div>

                        <!-- Contextual AI Hint Panel -->
                        <div id="contextual-hint-panel" class="contextual-hint-panel" style="display: none;">
                            <div class="hint-header">
                                <span class="hint-icon">💡</span>
                                <span class="hint-title">AI Coach Suggestion</span>
                                <button class="hint-close" onclick="document.getElementById('contextual-hint-panel').style.display='none'">×</button>
                            </div>
                            <div class="hint-content">
                                <div class="suggested-response">
                                    <h4>Try saying:</h4>
                                    <p id="hint-suggestion-text"></p>
                                </div>
                                <div class="key-points-reminder">
                                    <h4>Remember to include:</h4>
                                    <ul id="hint-key-points"></ul>
                                </div>
                                <div class="tone-guidance">
                                    <h4>Tone tip:</h4>
                                    <p id="hint-tone-text"></p>
                                </div>
                                <div class="script-reference">
                                    <h4>From training:</h4>
                                    <blockquote id="hint-script-reference"></blockquote>
                                </div>
                            </div>
                            <div class="hint-footer">
                                <button id="regenerate-hint" class="btn-secondary" onclick="showHint()">Different Suggestion</button>
                            </div>
                        </div>
                    </div>
                    <div id="live-feedback-panel" class="live-feedback-panel">
                        <div class="panel-header"><h3>Live Feedback</h3><button class="panel-toggle-btn" id="toggle-feedback-panel">−</button></div>
                        <div class="panel-content">
                            <div class="live-score-display"><div id="live-score-circle" class="live-score-circle score-low">0</div><div class="score-label">Score</div></div>
                            <div class="key-points-live"><h4>📋 Key Points</h4><ul id="live-key-points" class="points-list"></ul></div>
                            <div class="tone-indicator"><h4>💬 Tone</h4><div class="tone-bar-container"><div id="tone-bar" class="tone-bar neutral">Neutral</div></div></div>
                            <div class="word-count-indicator"><div>Words: <strong id="live-word-count">0</strong></div></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Screen 3: Feedback Display -->
            <div id="feedback-area" style="display: none;">
                <h2 style="text-align: center; color: #8b4fbe;">Performance Feedback</h2>
                <div style="text-align: center; margin-bottom: 30px;">
                    <div id="score-circle" class="score-circle-large"></div>
                    <p id="score-text" style="font-size: 18px; font-weight: 500;"></p>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
                    <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; border-left: 4px solid #4caf50;">
                        <h3 style="color: #2e7d32;">✅ Matched Points</h3>
                        <ul id="matched-points-list" style="list-style: none; padding: 0;"></ul>
                    </div>
                    <div style="background: #fff3e0; padding: 20px; border-radius: 8px; border-left: 4px solid #ff9800;">
                        <h3 style="color: #e65100;">📈 Areas to Improve</h3>
                        <ul id="missed-points-list" style="list-style: none; padding: 0;"></ul>
                    </div>
                </div>
                <div style="background: #f8f4fc; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
                    <h3 style="color: #8b4fbe;">AI Coach Feedback</h3>
                    <div><h4 style="color: #4caf50;">Strengths:</h4><ul id="strengths-list"></ul></div>
                    <div><h4 style="color: #ff9800;">Growth Areas:</h4><ul id="improvements-list"></ul></div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button id="next-scenario-btn" class="btn-primary" style="flex: 1;">Next Scenario →</button>
                    <button id="retry-scenario-btn" class="btn-secondary">🔄 Retry</button>
                </div>
            </div>

            <!-- Screen 4: Session Summary -->
            <div id="session-summary" style="display: none;"></div>
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
// 3. General Roofing Knowledge & Terminology (includes Identifying Knockable Doors)
trainingContent['general-knowledge'] = `
  <div class="content-card">
    <h1>General Roofing Knowledge & Terminology</h1>
    ${renderVideoPlayer('/assets/training/videos/module3-roofing101.mp4', 'roofing101-video', '📹 Roofing 101: Essential Knowledge')}

    <h2>Essential Roofing Terminology</h2>
    <div class="terminology-grid">
      <div class="term-card">
        <h3>Ridge</h3>
        <p>The horizontal line at the peak where two roof planes meet. Critical for ventilation and caps. The ridge is the highest point on the roof where opposing slopes connect.</p>
      </div>
      <div class="term-card">
        <h3>Underlayment</h3>
        <p>Water-resistant barrier installed beneath shingles. Protects against ice dams and leaks. Typically felt paper or synthetic material that provides secondary water protection.</p>
      </div>
      <div class="term-card">
        <h3>Flashing</h3>
        <p>Metal strips around chimneys, vents, valleys to prevent water intrusion. Common damage point. Flashing directs water away from vulnerable areas where roof planes meet structures.</p>
      </div>
      <div class="term-card">
        <h3>Vents</h3>
        <p>Roof penetrations for exhaust (bath, kitchen) and intake/exhaust ventilation systems. Proper ventilation extends roof life and prevents moisture buildup in the attic.</p>
      </div>
      <div class="term-card">
        <h3>Valley</h3>
        <p>Where two roof planes meet at an angle. High water flow area - check for debris and damage. Valleys are particularly susceptible to leaks and require special installation techniques.</p>
      </div>
      <div class="term-card">
        <h3>Drip Edge</h3>
        <p>Metal edge along eaves and rakes. Directs water away from fascia and protects underlayment. Code-required in most jurisdictions to protect the roof deck edges.</p>
      </div>
      <div class="term-card">
        <h3>Ice & Water Shield</h3>
        <p>Self-adhering waterproof membrane installed in vulnerable areas like eaves, valleys, and around penetrations. Provides superior protection against ice dams and wind-driven rain.</p>
      </div>
      <div class="term-card">
        <h3>Fascia</h3>
        <p>Vertical board running along the roof edge. Provides mounting surface for gutters and protects roof deck from weather exposure.</p>
      </div>
    </div>

    <h3>Parts of a Roof</h3>
    <div class="roof-visuals">
      <figure>
        <img src="/resources/3droof2.avif" alt="Roof system layers">
        <figcaption>Example roof system layers and components.</figcaption>
      </figure>
    </div>
    <ul>
      <li>Ridge, Ridge Vent, Hip & Ridge Shingles</li>
      <li>Felt/Underlayment, Ice & Water Barrier</li>
      <li>Flashing, Drip Edge, Starter Shingles</li>
      <li>Intake/Exhaust Vents, Baffles, Insulation</li>
    </ul>

    <hr>
    <h2>Knockable Doors: Ethical Canvassing</h2>
    <div class="knockable-section">
      <h3>✅ DO Knock:</h3>
      <ul>
        <li><strong>Homes with visible storm damage</strong> - Missing shingles, dented gutters, damaged siding</li>
        <li><strong>Neighborhoods with recent storm activity</strong> - Use storm maps and local intel; prioritize recent hail/wind corridors</li>
        <li><strong>Properties with neighbors getting work done</strong> - Social proof makes homeowners more receptive</li>
        <li><strong>Homes with older roofs (15+ years)</strong> - Higher likelihood of qualifying damage</li>
        <li><strong>Look for collateral indicators</strong> - Dented downspouts, damaged screens, hail-marked gutters</li>
      </ul>

      <h3>❌ DON'T Knock:</h3>
      <ul>
        <li><strong>Homes with "No Soliciting" signs</strong> - Respect posted wishes</li>
        <li><strong>Properties with aggressive dogs unleashed</strong> - Safety first</li>
        <li><strong>Late evening or very early morning</strong> - Mind timing and etiquette (10am-7pm ideal)</li>
        <li><strong>Homes with brand new roofs (< 5 years)</strong> - Low probability of qualifying damage</li>
        <li><strong>During severe weather or family emergencies</strong> - Use professional judgment</li>
      </ul>
    </div>

    <div class="examples">
      <p>See sample photo reports for good vs. bad examples:</p>
      <ul>
        <li><a href="/resources/Sample%20Photo%20Report%201.pdf" target="_blank">Sample Photo Report 1</a></li>
        <li><a href="/resources/Sample%20Photo%20Report%204.pdf" target="_blank">Sample Photo Report 4</a></li>
        <li><a href="/resources/Sample%20Ashpahlt%20Report%20NEW.pdf" target="_blank">Sample Asphalt Report</a></li>
        <li><a href="/resources/Sample%20Cedar%20Report.pdf" target="_blank">Sample Cedar Report</a></li>
      </ul>
    </div>
    <hr>
    <div id="quiz2">
      <h3>Quick Quiz #2</h3>
      <p>Pass/Fail mini‑quiz on general roofing concepts.</p>
      <button id="startQuickQuiz2">Start Quiz</button>
      <div id="quiz2-area"></div>
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

// 9. Post-Inspection Objections (new)
trainingContent['post-inspection-objections'] = `
  <div class="content-card">
    <h1>Post‑Inspection Objections</h1>

    <h2>9 Common Post-Inspection Objections</h2>
    <div class="objections-grid">
      <div class="objection-card">
        <h3>1. "I need to get other estimates"</h3>
        <p><strong>Response:</strong> "That's smart! Here's what I recommend: Get those estimates, but know that insurance pays the same regardless of contractor. The difference is in service, speed, and warranty. We file the claim for you today - that starts your timeline. Other estimates can take weeks."</p>
        <p><strong>Why it works:</strong> Validates their concern while emphasizing our value-add and urgency.</p>
        <button class="practice-agnes-btn" data-scenario="m9-capstone-1">🎭 Practice with Agnes</button>

        <!-- Inline Practice Container -->
        <div class="inline-practice-container" style="display: none;" data-scenario="m9-capstone-1">
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
        <h3>2. "This seems expensive"</h3>
        <p><strong>Response:</strong> "I hear you! But remember - insurance covers this. Your only out-of-pocket is the deductible ($1,000-2,500 typically). A new $18,000 roof for $1,500? That's the best deal you'll ever get."</p>
        <p><strong>Why it works:</strong> Reframes the cost through the insurance lens.</p>
        <button class="practice-agnes-btn" data-scenario="m9-deductible-objection-close">🎭 Practice with Agnes</button>

        <!-- Inline Practice Container -->
        <div class="inline-practice-container" style="display: none;" data-scenario="m9-deductible-objection-close">
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
        <h3>3. "I don't want to file a claim"</h3>
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
        <h3>4. "My roof is fine"</h3>
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
        <h3>5. "I need to talk to my spouse"</h3>
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
        <h3>6. "I'll just handle this myself"</h3>
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
        <h3>7. "I've never filed a claim before"</h3>
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
        <h3>8. "What if my claim gets denied?"</h3>
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
        <h3>9. "I'm going to wait and see if it gets worse"</h3>
        <p><strong>Response:</strong> "I understand the hesitation, but here's the problem: Insurance only covers storm damage within your policy's statute of limitations - usually 1-2 years. Wait too long, and you lose coverage entirely. Plus, every day UV light and weather degrade the damaged shingles more. File now while you're protected."</p>
        <p><strong>Why it works:</strong> Creates urgency with real consequences.</p>
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

    <h2>Creating Urgency (Without Being Pushy)</h2>
    <ul>
      <li><strong>Weather Window:</strong> "We're 3 weeks out on scheduling. If we file today, we can get you on the schedule before winter."</li>
      <li><strong>Statute of Limitations:</strong> "Storm was [date]. You have [X] months to file. After that, insurance won't cover it."</li>
      <li><strong>Deterioration:</strong> "Every day without protection, UV damages the shingles more. In 6 months, this could be a leak."</li>
      <li><strong>Matching Availability:</strong> "We can only guarantee color match if we order within 30 days. After that, discontinued colors become a problem."</li>
    </ul>

    <h2>The Empathy Framework</h2>
    <p>For every objection, use this 4-step framework:</p>
    <ol>
      <li><strong>Acknowledge:</strong> "I completely understand..."</li>
      <li><strong>Educate:</strong> "Here's what most people don't know..."</li>
      <li><strong>Evidence:</strong> "Let me show you the photos/data..."</li>
      <li><strong>Ask:</strong> "Does that make sense? Should we move forward?"</li>
    </ol>
  </div>
`;

// 10. Damage Identification (remap existing)
trainingContent['damage-identification'] = trainingContent['roofing-damage-id'] || `
  <div class="content-card"><h1>Damage Identification</h1><p>Content coming soon.</p></div>
`;

// 11. Filing the Claim & Closing (remap existing)
trainingContent['filing-claim-closing'] = trainingContent['claim-closing'] || `
  <div class="content-card"><h1>Filing the Claim & Closing</h1><p>Content coming soon.</p></div>
`;

// 12. Closing Objections (new) — ties into Filing the Claim & Closing
trainingContent['closing-objections'] = `
  <div class="content-card">
    <h1>Closing Objections</h1>

    <h2>12 Final Closing Objections & Responses</h2>
    <div class="closing-objections">
      <div class="closing-objection">
        <h3>"I want to wait for more bids"</h3>
        <p><strong>Response:</strong> "I respect that. But here's what happens: We file TODAY, start your timeline. Other contractors will bid the same - insurance sets the price. Difference is, we're the fastest in the area. Every week you wait is a week later you get your new roof. File now, get other bids while we wait for the adjuster?"</p>
      </div>

      <div class="closing-objection">
        <h3>"I need to think about it"</h3>
        <p><strong>Response:</strong> "Absolutely. What specifically do you need to think about? [Listen] ... Most people say that when they're unsure about [objection]. Let me address that: [handle objection]. Does that help?"</p>
      </div>

      <div class="closing-objection">
        <h3>"Call me next week"</h3>
        <p><strong>Response:</strong> "I can do that. But can I ask - what changes between now and next week? [Listen] ... Here's my concern: your statute of limitations is ticking, weather window is closing. Can we at least file the claim today? That reserves your rights. You can still decide on the contractor later."</p>
      </div>

      <div class="closing-objection">
        <h3>"I'm not sure about the deductible"</h3>
        <p><strong>Response:</strong> "I get it - deductibles can sting. But let's look at the math: Your deductible is probably $1,000-2,500. A new roof costs $15,000-25,000. You're paying 5-10% for a brand new roof. Where else can you get that return? Plus, not fixing it means leaks in 6 months - then you pay the full $20k yourself."</p>
      </div>

      <div class="closing-objection">
        <h3>"My spouse handles this stuff"</h3>
        <p><strong>Response:</strong> "Perfect! Are they home? I can wait. Or we can do a quick 3-way call - takes 5 minutes to walk through the photos. I'm here now, roof's already documented, let's get them on the same page so you can make the best decision together."</p>
      </div>

      <div class="closing-objection">
        <h3>"I don't trust contractors"</h3>
        <p><strong>Response:</strong> "I totally understand - this industry has a bad reputation. That's exactly why we do things differently. Contingency agreement means you only pay if we deliver. No money upfront, no risk to you. We're the only company in the area that offers this protection. Give me a shot to prove we're different."</p>
      </div>
    </div>

    <h2>The Assumptive Close</h2>
    <p>After handling objections, assume the sale:</p>
    <ul>
      <li>"Let me text you that contract now - what's your cell?"</li>
      <li>"I'll mark you down for [color]. Any preference on shingle style?"</li>
      <li>"Perfect! I'll get with my scheduling team and text you a date this week."</li>
      <li>"Great! Let me pull up the contract - I'll walk you through it real quick."</li>
    </ul>

    <p>Common pushbacks when moving from claim filing to the close, with concise responses and next‑step prompts.</p>
    <div class="script" data-text-source="true">
      <button class="speak-btn" aria-label="Listen to script">🔊</button>
      <p><strong>"I need to think about it."</strong><br>
      Absolutely—totally fair. Would it help if I summarize where we are and what happens next? It's a simple step: we'll handle the carrier communication and keep you updated. The only cost to you is the deductible if fully approved.</p>
    </div>
    <div class="script" data-text-source="true">
      <button class="speak-btn" aria-label="Listen to script">🔊</button>
      <p><strong>"I'll just call my insurance myself."</strong><br>
      That works too. The benefit of authorizing us is we do the legwork—photos, documentation, and follow‑ups—while keeping you in the loop, so you're not the middle‑person.</p>
    </div>
    <div class="script" data-text-source="true">
      <button class="speak-btn" aria-label="Listen to script">🔊</button>
      <p><strong>"I'm worried about costs."</strong><br>
      Understandable. If approved, your only out‑of‑pocket is the deductible. No surprises—everything is documented and reviewed with you before work begins.</p>
    </div>
    <h3>Flow to Close</h3>
    <ol>
      <li>Recap inspection results and insurance path</li>
      <li>Clarify deductible and timeline</li>
      <li>Present authorization/contingency forms</li>
      <li>Set expectations for adjuster meeting</li>
      <li>Schedule next touchpoint</li>
    </ol>
    <p>Review the prior section <em>Filing the Claim & Closing</em> for scripts and carrier variations.</p>
  </div>
`;

// 13. Discontinued Products & Special Scenarios (new)
trainingContent['discontinued-products'] = `
  <div class="content-card">
    <h1>Discontinued Products & Special Scenarios</h1>

    <h2>Why Discontinued Products Matter</h2>
    <div class="discontinued-explainer">
      <p><strong>Insurance "Matching Law":</strong> In many states, if your shingle is discontinued and they can't match it, insurance MUST replace the entire roof (not just damaged sections).</p>

      <h3>How to Use This:</h3>
      <ol>
        <li><strong>Check the shingle:</strong> Look for brand/model on packaging or check attic</li>
        <li><strong>Google "[brand] [model] discontinued"</strong></li>
        <li><strong>If discontinued:</strong> "Great news! Your shingle is discontinued. State law says insurance must replace the whole roof since they can't match. You're getting a full new roof!"</li>
      </ol>
    </div>

    <h2>Common Discontinued Shingles (2020-2024)</h2>
    <ul>
      <li><strong>GAF Timberline HD</strong> (replaced by HDZ in 2019)</li>
      <li><strong>Owens Corning Duration</strong> (older versions discontinued)</li>
      <li><strong>CertainTeed Landmark</strong> (certain colors discontinued)</li>
      <li><strong>IKO Cambridge</strong> (many colors discontinued)</li>
      <li><strong>GAF Royal Sovereign</strong> (3-tab, fully discontinued)</li>
      <li><strong>CertainTeed XT 25</strong> (3-tab, fully discontinued)</li>
    </ul>

    <h2>English vs. Metric Dimensions</h2>
    <div class="dimensions-explainer">
      <p>Older shingles used <strong>English dimensions</strong> (different exposure measurements). Newer shingles use <strong>Metric dimensions</strong>. They CANNOT be mixed because:</p>
      <ul>
        <li>Different exposure sizes don't align properly</li>
        <li>Sealant strips won't line up correctly</li>
        <li>Creates visible mismatch and sealing failures</li>
        <li><strong>Result:</strong> Must replace entire slope or roof to maintain integrity</li>
      </ul>
    </div>

    <h2>Using iTel Reports</h2>
    <p><strong>iTel</strong> is a third-party service that verifies product discontinuation. Use it to:</p>
    <ol>
      <li>Identify the exact shingle brand and model</li>
      <li>Research manufacturer databases</li>
      <li>Generate official discontinuation report</li>
      <li>Attach report to insurance estimate</li>
      <li>Prove to adjuster that matching is impossible</li>
    </ol>

    <h2>Matching Law Arguments</h2>
    <p>Key legal and policy language to reference:</p>
    <ul>
      <li><strong>"Like kind and quality":</strong> Policy language requiring matching materials</li>
      <li><strong>Maryland Bulletin 18-23:</strong> State guidance on matching requirements</li>
      <li><strong>Aesthetic mismatch:</strong> When no true match exists, full replacement required to avoid visible differences</li>
    </ul>

    <h2>Code Compliance Scenarios</h2>
    <div class="code-scenarios">
      <h3>Virginia R905.2.2 - Low Slope Restriction</h3>
      <p>Asphalt shingles are NOT allowed on slopes below 2:12 pitch. If existing roof violates code, full replacement with proper materials required.</p>

      <h3>Maryland IRC R703.2 - Water-Resistive Barrier</h3>
      <p>Code requires water-resistive barrier (WRB) behind all exterior siding. If missing, must be installed during repairs - often requires full siding replacement.</p>
    </div>

    <h2>Failed Repair Attempts</h2>
    <p>If adjuster initially approves only partial repairs, document why repairs won't work:</p>
    <ul>
      <li><strong>Brittle Test:</strong> Video of old shingles breaking/cracking when you try to lift them</li>
      <li><strong>Non-Bonding:</strong> Photos showing adhesive strips no longer functional</li>
      <li><strong>Color Fade:</strong> Side-by-side showing severe mismatch between old and new</li>
      <li><strong>Result:</strong> Send documentation proving repairs are impossible, request full replacement</li>
    </ul>

    <h2>Reference Resources</h2>
    <p>Handling discontinued shingles and product mismatches. Reference manufacturer resources and real‑world examples.</p>
    <ul>
      <li><a href="/resources/Training%20Manual.docx" target="_blank">Training Manual</a></li>
      <li><a href="/resources/Sales%20Operations%20and%20Tasks.docx" target="_blank">Sales Operations & Tasks</a></li>
    </ul>
  </div>
`;

// 13. Sales Cycle & Job Flow (remap existing)
trainingContent['sales-cycle-job-flow'] = trainingContent['sales-cycle'] || `
  <div class="content-card"><h1>Sales Cycle & Job Flow</h1><p>Content coming soon.</p></div>
`;

// 16. Final Exam (new)
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
      <div class="video-progress" style="margin-top: 10px; font-size: 14px; color: #666;">
        Progress: <span id="${videoId}-progress">0</span>%
      </div>
    </div>
    <script>
      (function() {
        const video = document.getElementById('${videoId}');
        const startTime = video.getAttribute('data-start');
        if (startTime) video.currentTime = parseFloat(startTime);

        video.addEventListener('timeupdate', function() {
          const progress = (video.currentTime / video.duration) * 100;
          document.getElementById('${videoId}-progress').textContent = Math.round(progress);
          localStorage.setItem('${progressKey}', video.currentTime.toString());

          if (progress >= 90) {
            localStorage.setItem('${watchedKey}', 'true');
          }
        });
      })();
    </script>
  `;
}

// --- Speech Synthesis ---
const synth = window.speechSynthesis;
let currentUtterance: SpeechSynthesisUtterance | null = null;

function handleSpeak(event: MouseEvent) {
    const target = (event.target as HTMLElement).closest('.speak-btn');
    if (!target) return;

    const scriptContainer = target.closest('[data-text-source="true"]');
    if (!scriptContainer) return;

    const textToSpeak = (scriptContainer as HTMLElement).innerText.trim();

    if (synth.speaking && currentUtterance) {
        synth.cancel();
        // If the same button is clicked again, just stop the speech.
        if (currentUtterance.text === textToSpeak) {
            currentUtterance = null;
            return;
        }
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    currentUtterance = utterance;
    utterance.onerror = (e) => console.error("SpeechSynthesis Error", e);
    synth.speak(utterance);
}

// --- Game Logic ---
function initSalesCycleSorter() {
    const pool = document.getElementById('items-pool');
    const dropZone = document.getElementById('sorted-list');
    const feedbackEl = document.getElementById('sales-cycle-feedback');
    if (!pool || !dropZone || !feedbackEl) return;

    let draggedItem: HTMLElement | null = null;
    const correctOrder = ['1', '2', '3', '4', '5'];

    pool.addEventListener('dragstart', (e) => {
        draggedItem = e.target as HTMLElement;
        setTimeout(() => {
            if (draggedItem) draggedItem.style.display = 'none';
        }, 0);
    });

    pool.addEventListener('dragend', () => {
        setTimeout(() => {
            if (draggedItem) {
                draggedItem.style.display = 'block';
                draggedItem = null;
            }
        }, 0);
    });

    dropZone.addEventListener('dragover', e => e.preventDefault());

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        if (draggedItem) {
            dropZone.appendChild(draggedItem);
            checkOrder();
        }
    });

    function checkOrder() {
        const items = dropZone.querySelectorAll('.draggable-item');
        if (items.length !== correctOrder.length) return;

        const currentOrder = Array.from(items).map(item => (item as HTMLElement).dataset.order);
        
        if (JSON.stringify(currentOrder) === JSON.stringify(correctOrder)) {
            feedbackEl.textContent = 'Correct! That is the right order.';
            feedbackEl.className = 'feedback-message correct';
        } else {
            feedbackEl.textContent = 'Not quite right. Try again!';
            feedbackEl.className = 'feedback-message incorrect';
        }
        feedbackEl.style.display = 'block';
    }
}

function initObjectionMatcher() {
    const draggables = document.querySelectorAll('#objections-list .draggable-item');
    const dropZones = document.querySelectorAll('.drop-zone');
    const feedbackEl = document.getElementById('objection-feedback');
    let correctMatches = 0;
    const totalMatches = draggables.length;
    
    let draggedItem: HTMLElement | null = null;

    draggables.forEach(draggable => {
        draggable.addEventListener('dragstart', (e) => {
            draggedItem = e.target as HTMLElement;
            setTimeout(() => {
                if(draggedItem) draggedItem.classList.add('dragging');
            }, 0)
        });

        draggable.addEventListener('dragend', () => {
            if(draggedItem) draggedItem.classList.remove('dragging');
        });
    });

    dropZones.forEach(zone => {
        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            if (!draggedItem || zone.children.length > 1) return; // Allow one item (the <p>)

            const zoneMatch = (zone as HTMLElement).dataset.match;
            const itemMatch = draggedItem.dataset.match;

            if (zoneMatch === itemMatch) {
                // Hide the placeholder text and append the item
                const placeholder = zone.querySelector('.response-text') as HTMLElement;
                if(placeholder) placeholder.style.display = 'none';
                
                zone.appendChild(draggedItem);
                (draggedItem as HTMLElement).setAttribute('draggable', 'false');
                zone.classList.add('correctly-matched');
                correctMatches++;
                
                if (correctMatches === totalMatches && feedbackEl) {
                    feedbackEl.textContent = 'Great job! All objections matched correctly.';
                    feedbackEl.className = 'feedback-message correct';
                    feedbackEl.style.display = 'block';
                }
            }
        });
    });
}


// --- Module 9: Practice with Agnes Buttons ---
function initModule9RoleplayButtons() {
  console.log('🎭 Initializing Module 9 inline practice system...');

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

// --- Module 10: Damage Identification Hotspot Quiz ---
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

  // Update final score display
  document.getElementById('final-score').textContent = totalFound;
  document.getElementById('total-possible').textContent = quizState.totalPossible;

  // Add accuracy information
  const finalScoreEl = document.querySelector('.final-score');
  let accuracyInfo = document.getElementById('accuracy-info');
  if (!accuracyInfo) {
    accuracyInfo = document.createElement('p');
    accuracyInfo.id = 'accuracy-info';
    accuracyInfo.className = 'accuracy-info';
    finalScoreEl.after(accuracyInfo);
  }

  accuracyInfo.innerHTML = `
    <strong>Overall Accuracy:</strong> ${overallAccuracy}%<br>
    <small>(${totalCorrect} correct clicks, ${totalIncorrect} incorrect clicks)</small>
  `;

  // Show completion message with performance feedback
  const banner = document.querySelector('.success-banner');
  let feedbackMsg = banner.querySelector('.performance-feedback');
  if (!feedbackMsg) {
    feedbackMsg = document.createElement('p');
    feedbackMsg.className = 'performance-feedback';
    banner.appendChild(feedbackMsg);
  }

  // Performance feedback based on completion AND accuracy
  if (completionRate === 100 && overallAccuracy >= 80) {
    feedbackMsg.innerHTML = '🏆 <strong>Perfect performance!</strong> You have excellent damage identification skills with great accuracy.';
  } else if (completionRate >= 80 && overallAccuracy >= 70) {
    feedbackMsg.innerHTML = '🌟 <strong>Great job!</strong> You identified most damage with good accuracy. Review any missed spots.';
  } else if (completionRate >= 60 && overallAccuracy >= 60) {
    feedbackMsg.innerHTML = '👍 <strong>Good effort!</strong> Review the images again to improve precision and coverage.';
  } else {
    feedbackMsg.innerHTML = '📚 <strong>Keep practicing!</strong> Review the damage types and practice identifying key patterns.';
  }

  document.getElementById('quiz-complete-message').style.display = 'block';
  document.getElementById('quiz-complete-message').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const apiKey = rawApiKey;
    if (!apiKey) {
      showAgnesError('API key not configured. Please add GEMINI_API_KEY to environment.');
      return;
    }

    agnesAiClient = new GoogleGenAI({ apiKey });
    agnesLiveState.sessionActive = true;
    agnesLiveState.sessionStartTime = Date.now();
    agnesLiveState.transcript = [];
    agnesLiveState.currentScore = null;
    agnesLiveState.mistakeCount = 0;

    // Track roleplay session in API (async, don't await to avoid blocking)
    startRoleplaySessionAPI(
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

    // Build system instruction
    const script = AGNES_TRAINING_SCRIPTS[agnesLiveState.selectedRole || 'door-knock'] || AGNES_TRAINING_SCRIPTS['door-knock'];
    const systemInstruction = buildAgnesSystemInstruction(agnesLiveState.difficulty, script);

    // Connect to Gemini Live
    agnesSessionPromise = agnesAiClient.live.connect({
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
    });

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
    // Parse score if present
    const scoreMatch = textContent.match(/AGNES SCORE:?\s*(\d+)/i);
    if (scoreMatch) {
      agnesLiveState.currentScore = parseInt(scoreMatch[1]);
      // Show score UI
      const scoreDisplay = document.getElementById('agnes-score-display');
      if (scoreDisplay) {
        scoreDisplay.innerHTML = `<div class="final-score">${agnesLiveState.currentScore}/100</div>`;
        scoreDisplay.style.display = 'block';
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

    // Track session end in API
    endRoleplaySessionAPI(
      currentRoleplaySessionId,
      agnesLiveState.currentScore || 0,
      xpEarned,
      false // Not a door slam if we're saving session
    );

    // Show success modal
    showAgnesSessionComplete(xpEarned, xpResult, streakResult);
  } else if (!saveSession) {
    // Track door slam or aborted session in API
    endRoleplaySessionAPI(
      currentRoleplaySessionId,
      agnesLiveState.currentScore || 0,
      0,
      true // Door slammed or aborted
    );
  }

  // Cleanup resources
  cleanupAgnesLive();
}

// Show session complete modal
function showAgnesSessionComplete(xpEarned: number, xpResult: any, streakResult: any) {
  const modal = document.getElementById('agnes-success-modal');
  if (!modal) return;

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

// Module to categories mapping
const moduleToCategories: Record<string, string[]> = {
  '7': ['inspection', 'initialPitch'],
  '8': ['postInspection'],
  '9': ['initialObjections', 'postInspectionObjections'],
  '12': ['closingObjections']
};

// Session state for the new simplified flow
let agnesSessionConfig = {
  trainingType: 'roleplay' as 'roleplay' | 'walkthrough',
  inputMode: 'text' as 'voice' | 'text',
  selectedModule: '' as string,
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

  // Step 1: Training Type selector handlers
  const roleplayBtn = document.getElementById('agnes-roleplay-btn');
  const walkthroughBtn = document.getElementById('agnes-walkthrough-btn');

  roleplayBtn?.addEventListener('click', () => {
    agnesSessionConfig.trainingType = 'roleplay';
    showAgnesScreen('agnes-input-mode-selector');
  });

  walkthroughBtn?.addEventListener('click', () => {
    agnesSessionConfig.trainingType = 'walkthrough';
    agnesSessionConfig.inputMode = 'text'; // Walk through is always text mode
    showAgnesScreen('agnes-module-selector');
  });

  // Step 2: Input Mode selector handlers
  const voiceModeBtn = document.getElementById('agnes-voice-mode-btn');
  const textModeBtn = document.getElementById('agnes-text-mode-btn');

  voiceModeBtn?.addEventListener('click', () => {
    localStorage.setItem('agnes_input_mode', 'voice');
    agnesLiveState.inputMode = 'voice';
    agnesSessionConfig.inputMode = 'voice';
    showAgnesScreen('agnes-module-selector');
  });

  textModeBtn?.addEventListener('click', () => {
    localStorage.setItem('agnes_input_mode', 'text');
    agnesLiveState.inputMode = 'text';
    agnesSessionConfig.inputMode = 'text';
    showAgnesScreen('agnes-module-selector');
  });

  // Step 3: Module selector handlers
  const moduleCards = document.querySelectorAll('.agnes-module-card');
  moduleCards.forEach(card => {
    card.addEventListener('click', () => {
      const moduleId = (card as HTMLElement).dataset.module;
      if (!moduleId) return;

      agnesSessionConfig.selectedModule = moduleId;
      agnesSessionConfig.selectedScenarios = getScenariosForModule(moduleId);

      console.log(`📚 Selected Module ${moduleId} with ${agnesSessionConfig.selectedScenarios.length} scenarios`);

      showAgnesScreen('agnes-difficulty-selector');
      renderAgnesDifficultyCards();
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

  // Module back button
  const moduleBackBtn = document.getElementById('agnes-module-back-btn');
  moduleBackBtn?.addEventListener('click', () => {
    if (agnesSessionConfig.trainingType === 'walkthrough') {
      showAgnesScreen('agnes-mode-selector');
    } else {
      showAgnesScreen('agnes-input-mode-selector');
    }
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
          // Wait for response then end session
          setTimeout(() => endAgnesSession(true), 3000);
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
      scriptReference: trainingContent.keyPhrases?.[0] || 'Use the L.E.A.R.N. framework'
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
        const allScenarios = (window as any).getAllCategorizedScenarios?.() || [];
        if (allScenarios.length > 0) {
          const randomIndex = Math.floor(Math.random() * allScenarios.length);
          const randomScenario = allScenarios[randomIndex];
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

function renderModule(moduleName: string) {
  if (!mainContent) return;
  mainContent.innerHTML = trainingContent[moduleName] || '<div>Content not found.</div>';

  // Cancel any ongoing speech when changing modules
  if (synth.speaking) {
      synth.cancel();
      currentUtterance = null;
  }

  // Track module start and activity
  trackModuleStart(moduleName);
  startActivityTracking(moduleName);

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
          initDamageHotspotQuiz();
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
      case 'commitment':
          initCommitmentGate();
          break;
      case 'admin-dashboard':
          initAdminDashboard();
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

// Mark module as complete and unlock next
function completeModule(moduleName: string) {
  unlockNextModule(moduleName);

  // Track module completion via API (silent - don't spam console)
  apiCall('/progress/module', {
    method: 'POST',
    body: JSON.stringify({ moduleName, action: 'complete' }),
    silent: true
  } as any);

  // Trigger confetti celebration
  triggerConfetti('module');

  // Check for new badges
  checkAndAwardBadges();

  const currentIndex = MODULE_ORDER.indexOf(moduleName);
  if (currentIndex < MODULE_ORDER.length - 1) {
    const nextModule = MODULE_ORDER[currentIndex + 1];
    // Show unlock notification
    const notification = document.createElement('div');
    notification.className = 'unlock-notification';
    notification.innerHTML = `<strong>Next module unlocked!</strong> You can now access: Module ${currentIndex + 2}`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }
}

// Track module start
function trackModuleStart(moduleName: string) {
  apiCall('/progress/module', {
    method: 'POST',
    body: JSON.stringify({ moduleName, action: 'start' }),
    silent: true
  } as any);
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

  // Send heartbeat every 30 seconds (silent - don't spam console)
  activityHeartbeatInterval = window.setInterval(() => {
    if (currentModuleForTracking) {
      apiCall('/progress/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ moduleName: currentModuleForTracking, timeSpent: 30 }),
        silent: true
      } as any);
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
        <div class="login-logo">🏠</div>
        <h1>Roof-ER Training Hub</h1>
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

      <div class="login-footer">
        <p>First time here? Just enter your name to get started!</p>
      </div>
    </div>
  `;

  document.body.appendChild(loginScreen);

  // Add form submit handler
  const form = document.getElementById('login-form') as HTMLFormElement;
  form?.addEventListener('submit', handleLoginSubmit);

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
    userInfo.className = 'user-info';
    sidebarHeader.appendChild(userInfo);
  }

  userInfo.innerHTML = `
    <span class="user-name">👤 ${user.name}</span>
    ${user.isManager ? '<span class="manager-badge-small">Manager</span>' : ''}
    <button id="logout-btn" class="logout-btn" title="Log out">↪</button>
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
                <span class="modules-count">${user.modulesCompleted}/16 modules</span>
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
          <span class="summary-item"><strong>Modules:</strong> ${completedCount}/16 Complete</span>
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
                  <span>MCQ: ${a.mcqScore || 0}/20</span>
                  <span>Fill-in: ${a.fibScore || 0}/10</span>
                  <span>Short Answer: ${a.saScore || 0}/15 pts</span>
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
            const progressPct = Math.round((completedCount / 16) * 100);

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
                  <span class="progress-text">${completedCount}/16</span>
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
function initCommitmentGate() {
  const container = document.getElementById('main-content');
  if (!container) return;
  // Inject a simple signature form if not present
  const signed = localStorage.getItem(STORAGE_KEYS.commitmentSigned) === 'true';
  if (signed) return;
  const gate = document.createElement('div');
  gate.innerHTML = `
    <div class="commitment-gate">
      <h3>Digital Signature</h3>
      <p>You must acknowledge and sign before accessing the training.</p>
      <label>Full Name: <input id="sigName" type="text" placeholder="Your full name"/></label>
      <label><input id="sigAgree" type="checkbox"/> I agree to uphold Roof‑ER standards and ethics.</label>
      <button id="sigSubmit">Sign & Continue</button>
      <div id="sigMsg" class="sig-message"></div>
    </div>`;
  container.appendChild(gate);
  const btn = gate.querySelector('#sigSubmit') as HTMLButtonElement | null;
  btn?.addEventListener('click', () => {
    const name = (gate.querySelector('#sigName') as HTMLInputElement)?.value?.trim();
    const agree = (gate.querySelector('#sigAgree') as HTMLInputElement)?.checked;
    const msg = gate.querySelector('#sigMsg') as HTMLElement | null;
    if (!name || !agree) {
      if (msg) msg.textContent = 'Please enter your name and agree to proceed.';
      return;
    }
    localStorage.setItem(STORAGE_KEYS.commitmentSigned, 'true');
    if (msg) msg.textContent = 'Signed. You may continue to other sections.';
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
  startBtn.addEventListener('click', () => {
    area.innerHTML = `
      <div class="quiz-item">
        <p>1. Which component helps prevent water intrusion at eaves?</p>
        <label><input type="radio" name="q1" value="a"/> Ridge vent</label>
        <label><input type="radio" name="q1" value="b"/> Ice & Water Barrier</label>
        <label><input type="radio" name="q1" value="c"/> Hip shingles</label>
      </div>
      <div class="quiz-item">
        <p>2. Knock timing should be…</p>
        <label><input type="radio" name="q2" value="a"/> As late as possible</label>
        <label><input type="radio" name="q2" value="b"/> Respectful of local norms and daylight</label>
        <label><input type="radio" name="q2" value="c"/> Only during lunch</label>
      </div>
      <button id="quiz2Submit">Submit</button>
      <div id="quiz2Result"></div>
    `;
    (document.getElementById('quiz2Submit') as HTMLButtonElement)?.addEventListener('click', () => {
      const q1 = (document.querySelector('input[name="q1"]:checked') as HTMLInputElement)?.value;
      const q2 = (document.querySelector('input[name="q2"]:checked') as HTMLInputElement)?.value;
      const pass = q1 === 'b' && q2 === 'b';
      const res = document.getElementById('quiz2Result');
      if (res) {
        res.textContent = pass ? 'Pass' : 'Fail';
        res.className = pass ? 'quiz-feedback correct' : 'quiz-feedback incorrect';
      }
    });
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
      badge.className = 'cert-badge';
      badge.innerHTML = '<span class="badge-icon">🏆</span><span class="badge-text">Certified</span>';
      sidebarHeader.appendChild(badge);
    }
    if (badge) badge.style.display = 'inline-flex';

    // Add trophy to Module 16
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
  const attemptsHtml = state.attempts.length > 0 ? `
    <div class="exam-history">
      <h4>Previous Attempts:</h4>
      <ul>
        ${state.attempts.map(a => `
          <li class="${a.passed ? 'passed' : 'failed'}">
            Attempt ${a.attemptNumber}: ${a.totalScore}% on ${formatExamDate(a.date)} - ${a.passed ? '✓ PASSED' : '✗ Failed'}
          </li>
        `).join('')}
      </ul>
    </div>
  ` : '';

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
          <li><strong>5 Short Answer Questions</strong> (2 points each)</li>
          <li><strong>Total: 100 points</strong></li>
          <li><strong>Passing Score: 80%</strong></li>
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
            <li>Module 6-9: Objection Handling</li>
            <li>Module 12: Closing Objections</li>
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

  // Grade SA (5 questions, 2 pts each = 10 pts max) - AI scoring with fallback
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

  // Calculate total score (out of 100)
  const mcqScore = mcqCorrect * 2;      // 70 pts max
  const fibScore = fibCorrect * 2;      // 20 pts max
  const saScore = Math.round(saPoints); // 10 pts max
  const totalScore = mcqScore + fibScore + saScore;
  const passed = totalScore >= 80;

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
            <li>Short Answer: ${attempt.saScore * 2}/10 pts</li>
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
            <li>Short Answer: ${attempt.saScore * 2}/10 pts</li>
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
            <li>Module 6-9: Handling Objections</li>
            <li>Module 12: Closing Techniques</li>
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
      <div class="quiz-item">
        <p>1. Who is the Owner, Director of Sales, and General Manager of Roof-ER?</p>
        <label><input type="radio" name="qa1" value="a"/> Oliver Brown (Owner), Reese Samala (Director of Sales), Ford Barsi (General Manager)</label>
        <label><input type="radio" name="qa1" value="b"/> Ford Barsi (Owner), Oliver Brown (Director of Sales), Reese Samala (General Manager)</label>
        <label><input type="radio" name="qa1" value="c"/> Reese Samala (Owner), Ford Barsi (Director of Sales), Oliver Brown (General Manager)</label>
      </div>
      <div class="quiz-item">
        <p>2. What are Roof-ER's core values?</p>
        <label><input type="radio" name="qa2" value="a"/> Speed, Price, Volume</label>
        <label><input type="radio" name="qa2" value="b"/> Integrity, Quality, Simplicity</label>
        <label><input type="radio" name="qa2" value="c"/> Profit, Growth, Expansion</label>
      </div>
      <div class="quiz-item">
        <p>3. What year was Roof-ER founded?</p>
        <label><input type="radio" name="qa3" value="a"/> 2017</label>
        <label><input type="radio" name="qa3" value="b"/> 2018</label>
        <label><input type="radio" name="qa3" value="c"/> 2019</label>
      </div>
      <button id="quiz1Submit">Submit</button>
      <div id="quiz1Result"></div>
    `;
    (document.getElementById('quiz1Submit') as HTMLButtonElement)?.addEventListener('click', () => {
      const q1 = (document.querySelector('input[name="qa1"]:checked') as HTMLInputElement)?.value;
      const q2 = (document.querySelector('input[name="qa2"]:checked') as HTMLInputElement)?.value;
      const q3 = (document.querySelector('input[name="qa3"]:checked') as HTMLInputElement)?.value;
      const pass = q1 === 'a' && q2 === 'b' && q3 === 'c';
      const res = document.getElementById('quiz1Result');
      if (res) {
        if (pass) {
          res.textContent = '✓ Perfect! You know the Roof-ER leadership team, core values, and founding year.';
          res.className = 'quiz-feedback correct';
        } else {
          let feedback = '✗ Not quite. ';
          if (q1 !== 'a') feedback += 'Review the leadership team. ';
          if (q2 !== 'b') feedback += 'Check our core values. ';
          if (q3 !== 'c') feedback += 'Roof-ER was founded in 2019. ';
          res.textContent = feedback;
          res.className = 'quiz-feedback incorrect';
        }
      }
    });
  });
}
