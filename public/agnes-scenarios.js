// Agnes Role-Play Scenarios - Consolidated from all 9 modules
// Extracted from training-leaders-main/src/data/agnes/scenarios.module*.ts

// ========================================
// TYPE DEFINITIONS
// ========================================

// MentorScenario Interface:
// {
//   id: string;
//   role: 'homeowner' | 'rep' | 'adjuster';
//   prompt: string;
//   expectedKeyPoints: string[];
//   rubric: {
//     keywords: string[];
//     weights?: { [key: string]: number };
//     passThreshold?: number; // 0-100
//   };
//   followUps: string[];
// }

// MentorPack Interface:
// {
//   trainerTips: string[];
//   practiceSequences: { id: string; title: string; steps: string[] }[];
//   scenarios: MentorScenario[];
// }

// ========================================
// ALL SCENARIOS CONSOLIDATED
// ========================================

const agnesScenarios = {

  // ========================================
  // MODULE 1: Initial Pitch & Basic Objections
  // ========================================
  module1: {
    trainerTips: [
      "Always acknowledge the homeowner's concern before redirecting.",
      "Use the homeowner's name at least twice during your response.",
      'Frame insurance as value and peace-of-mind, not cost.',
      'Offer two specific times when scheduling – make it easy to say yes.',
      'Keep responses concise: Acknowledge → Ask → Educate → Next step.',
    ],
    practiceSequences: [
      {
        id: 'seq-beginner-1',
        title: 'Beginner – Initial Pitch Core',
        steps: [
          'Deliver initial pitch with 5 non-negotiables',
          'Handle "Not interested"',
          'Handle "Busy – leave info"',
          'Schedule inspection with two options',
        ],
      },
      {
        id: 'seq-objections-1',
        title: 'Objection Handling – Rapid Fire',
        steps: [
          'Money concern / deductible',
          'Already have a roofer',
          'No visible damage',
          'Not now – too busy',
        ],
      },
    ],
    scenarios: [
      {
        id: 'mentor-initial-pitch-advanced-1',
        role: 'homeowner',
        prompt: "We're not interested. We already talked to someone last week.",
        expectedKeyPoints: [
          'Acknowledge respectfully',
          'Clarify value (free, no obligation)',
          'Establish social proof / storm context',
          'Offer specific, short inspection window',
        ],
        rubric: {
          keywords: [
            'understand',
            'free',
            'no obligation',
            'neighbors',
            'storm',
            '15 minutes',
            'today',
            'tomorrow',
          ],
          passThreshold: 70,
        },
        followUps: [
          'What time today or tomorrow is best for a quick 15-minute check?',
          'Would you prefer that I text a confirmation with my company info?',
        ],
      },
      {
        id: 'm1-talk-to-spouse',
        role: 'homeowner',
        prompt: 'I need to talk to my spouse first.',
        expectedKeyPoints: [
          'Acknowledge and respect decision process',
          'Offer brief inspection now for facts',
          'Provide simple summary to share',
          'Give two time options for both present',
        ],
        rubric: { keywords: ['respect', 'summary', 'facts', 'two options'], passThreshold: 70 },
        followUps: ['Would 6:30pm today or 10am tomorrow work for both of you?'],
      },
      {
        id: 'm1-other-contractor-already',
        role: 'homeowner',
        prompt: 'We already had someone look at it.',
        expectedKeyPoints: [
          'Acknowledge prior visit',
          'Offer second opinion with photo evidence',
          'Explain insurance requires documented proof',
          'Short window and no obligation',
        ],
        rubric: { keywords: ['acknowledge', 'second opinion', 'documented proof', 'no obligation'], passThreshold: 70 },
        followUps: ['Want me to show you an example report so you can compare?'],
      },
      {
        id: 'mentor-pricing-concern-1',
        role: 'homeowner',
        prompt: "We're not spending money on this right now.",
        expectedKeyPoints: [
          'Acknowledge money concern',
          'Explain deductible only',
          'Insurance covers replacement if approved',
          'Offer scheduling options',
        ],
        rubric: {
          keywords: [
            'deductible',
            'insurance',
            'covers',
            'approve',
            'peace of mind',
            'schedule',
          ],
          passThreshold: 70,
        },
        followUps: [
          'Would 4pm today or 10am tomorrow work for a 15-minute check?',
        ],
      },
      {
        id: 'm1-roofer-friend',
        role: 'homeowner',
        prompt: "My brother-in-law's a roofer. We'll call him if we need anything.",
        expectedKeyPoints: [
          'Acknowledge and respect the relationship',
          'Clarify storm claim process vs retail work',
          'Value of impartial photo documentation',
          'Offer quick, no-obligation inspection window',
        ],
        rubric: {
          keywords: ['understand', 'storm claim', 'documentation', 'no obligation', '15 minutes', 'today', 'tomorrow'],
          passThreshold: 70,
        },
        followUps: [
          'Would a 15-minute no-obligation photo check help you two decide together?',
          'I can text the report to both of you—want a quick look first?',
        ],
      },
      {
        id: 'm1-no-visible-damage',
        role: 'homeowner',
        prompt: "I don't see damage from the ground—why inspect?",
        expectedKeyPoints: [
          'Acknowledge perception',
          'Explain roof-level evidence (granules, creases, collateral)',
          'Insurance requires documented proof',
          'Offer simple time options',
        ],
        rubric: {
          keywords: ['understand', 'roof-level', 'granules', 'creases', 'collateral', 'insurance', 'schedule'],
          passThreshold: 70,
        },
        followUps: ['Would 5pm today or 10am tomorrow work for a quick look?'],
      },
      {
        id: 'm1-elevator-pitch',
        role: 'rep',
        prompt: 'Deliver your 30-second pitch for a post-storm neighborhood.',
        expectedKeyPoints: [
          'Use name and purpose',
          'Free/no-obligation inspection',
          'Social proof (neighbors, local)',
          'Clear next step/time options',
        ],
        rubric: {
          keywords: ['name', 'free', 'no obligation', 'local', 'neighbors', 'schedule'],
          passThreshold: 70,
        },
        followUps: ['Now shorten it to 20 seconds without losing clarity.'],
      },
      {
        id: 'm1-schedule-two-options',
        role: 'rep',
        prompt: 'Ask for the inspection using two specific time options.',
        expectedKeyPoints: [
          'Offer two choices',
          'Ask for preference',
          'Confirm and set reminder',
        ],
        rubric: {
          keywords: ['two options', 'preference', 'confirm', 'reminder'],
          passThreshold: 70,
        },
        followUps: ['If they refuse both, present a third option or ask best day.'],
      },
      {
        id: 'm1-leave-a-card',
        role: 'homeowner',
        prompt: 'I\'m busy—just leave a card.',
        expectedKeyPoints: [
          'Acknowledge time constraint',
          'Offer 10-second context and value',
          'Give two short time options',
          'Offer to text info and confirm',
        ],
        rubric: { keywords: ['busy', '10 seconds', 'two options', 'text info', 'confirm'], passThreshold: 70 },
        followUps: ['Would 6:10pm today or 9:40am tomorrow work for a 10–15 minute roof-level check?'],
      },
      {
        id: 'm1-scam-worried',
        role: 'homeowner',
        prompt: 'We\'ve had a lot of people knocking—how do we know this isn\'t a scam?',
        expectedKeyPoints: [
          'Empathize and normalize concern',
          'Local presence and references',
          'Transparent photo-report process',
          'No-obligation inspection with clear next step',
        ],
        rubric: { keywords: ['empathize', 'local', 'references', 'transparent', 'no obligation', 'next step'], passThreshold: 70 },
        followUps: ['Would you like to see a sample photo report and two nearby references?'],
      },
      {
        id: 'm1-we-dont-do-claims',
        role: 'homeowner',
        prompt: 'We don\'t like doing insurance claims—sounds like a hassle.',
        expectedKeyPoints: [
          'Acknowledge hesitation',
          'Explain simple steps and your guidance',
          'Only the deductible if approved',
          'Offer quick inspection to verify if it\'s even needed',
        ],
        rubric: { keywords: ['acknowledge', 'simple steps', 'deductible', 'verify first'], passThreshold: 70 },
        followUps: ['If it doesn\'t qualify, at least you\'ll have clarity—want a quick check today or tomorrow?'],
      },
    ],
  },

  // ========================================
  // MODULE 2: Inspection & Photo Documentation
  // ========================================
  module2: {
    trainerTips: [
      "Use photos to teach: show, don't just tell.",
      'Document collateral damage to strengthen claims.',
      'Always gather elevation, slope, and close-ups in order.',
      'Create simple homeowner explanations with visuals.',
    ],
    practiceSequences: [
      {
        id: 'm2-seq-1',
        title: 'Inspection Flow Basics',
        steps: ['Perimeter scan','Ladder safety','Slope overview','Close-ups','Metals and gutters'],
      },
      {
        id: 'm2-seq-2',
        title: 'Photo Report Mastery',
        steps: ['Elevations','Slope overviews','Damage close-ups','Collateral','Labels and upload'],
      },
    ],
    scenarios: [
      {
        id: 'm2-slope-sampling-method',
        role: 'adjuster',
        prompt: 'Describe your slope sampling method across a multi-face roof to ensure representative findings.',
        expectedKeyPoints: ['Cardinal slopes when possible', 'Windward/leeward consideration', 'Similar materials/age', 'Replicate counts'],
        rubric: { keywords: ['sampling', 'windward', 'leeward', 'replicate', 'representative'], passThreshold: 75 },
        followUps: ['How many test squares would you plan for a four-slope roof and where?'],
      },
      {
        id: 'm2-collateral-priority',
        role: 'adjuster',
        prompt: 'List collateral items you prioritize to corroborate hail findings and why.',
        expectedKeyPoints: ['Soft metals (downspouts, gutters)', 'Screens/garage for pitting', 'A/C fins/housings', 'Fence caps/paint'],
        rubric: { keywords: ['soft metals', 'screens', 'garage', 'A/C', 'collateral'], passThreshold: 75 },
        followUps: ['Which two collateral photos do you present first on most claims?'],
      },
      {
        id: 'm2-homeowner-photo-education',
        role: 'homeowner',
        prompt: "Why do you need so many photos? Isn't that overkill?",
        expectedKeyPoints: [
          'Insurance evidence requirements',
          'Order of photos and consistency',
          'Peace of mind and transparency for homeowner',
        ],
        rubric: { keywords: ['evidence','adjuster','consistency','transparency','report'], passThreshold: 70 },
        followUps: ['Would you like me to show you a sample report so you can see exactly what we document?'],
      },
      {
        id: 'm2-test-square-method',
        role: 'adjuster',
        prompt: 'Explain the proper chalk test square method and what constitutes a qualifying hit count.',
        expectedKeyPoints: [
          '10x10 area marked clearly',
          'Consistent chalking technique (no gouging)',
          'Minimum hit count by carrier/market norm',
          'Replicate across slopes for pattern',
        ],
        rubric: { keywords: ['10x10', 'consistent', 'count', 'pattern', 'carrier'], passThreshold: 75 },
        followUps: ['How do you avoid false positives when chalking?'],
      },
      {
        id: 'm2-photo-evidence-criteria',
        role: 'adjuster',
        prompt: 'Define the key criteria that make a close-up photo acceptable for carrier review.',
        expectedKeyPoints: [
          'Scale object present',
          'Sharp focus with angled lighting when needed',
          'Labeling (slope/elevation, damage type)',
          'Context shot + close-up pairing',
        ],
        rubric: { keywords: ['scale', 'focus', 'angled', 'labels', 'context'], passThreshold: 75 },
        followUps: ['Provide a one-line caption you would include under the image.'],
      },
      {
        id: 'm2-damage-clarification',
        role: 'homeowner',
        prompt: "How do you know that's hail and not just wear?",
        expectedKeyPoints: ['Circular divots','Granule loss','Bruising','Pattern across slopes'],
        rubric: { keywords: ['circular','granules','bruise','pattern'], passThreshold: 70 },
        followUps: ['Would you like me to chalk a test square so you can see the pattern clearly?'],
      },
      {
        id: 'm2-storm-date-uncertain',
        role: 'homeowner',
        prompt: "We don't remember the exact storm date. Can we still file?",
        expectedKeyPoints: ['Yes—reps can provide verified date ranges','Carrier verifies against NOAA data','Document current damage thoroughly','File claim to initiate adjuster inspection'],
        rubric: { keywords: ['NOAA','date range','verified','document','adjuster','claim'], passThreshold: 70 },
        followUps: ['I can include local NOAA storm dates in your claim notes—shall we proceed?'],
      },
      {
        id: 'm2-when-in-doubt-sign-it-up',
        role: 'rep',
        prompt: 'Borderline damage scenario—what do you do?',
        expectedKeyPoints: ['Document thoroughly','Present confidently','Let adjuster make final determination',"Don't pre-reject valid claims"],
        rubric: { keywords: ['document','present','adjuster','final','sign it up'], passThreshold: 70 },
        followUps: ['Which three photos would you prioritize for an adjuster to see first?'],
      },
      {
        id: 'm2-ladder-safety-and-sequence',
        role: 'rep',
        prompt: 'Outline your inspection flow with ladder safety and photo sequence.',
        expectedKeyPoints: ['Ladder placement + 3-point contact','Perimeter/elevations first','Slope overview then close-ups','Collateral + labels before upload'],
        rubric: { keywords: ['ladder','perimeter','overview','close-ups','collateral','labels'], passThreshold: 70 },
        followUps: ['What is your preferred order for collateral documentation?'],
      },
      {
        id: 'm2-minor-scuffs-file-or-not',
        role: 'homeowner',
        prompt: 'If it\'s just minor scuffs, should we still file a claim?',
        expectedKeyPoints: [
          'Carrier decision, not homeowner/rep guess',
          'Document current condition thoroughly',
          'Claims create adjuster inspection for determination',
        ],
        rubric: { keywords: ['carrier', 'document', 'adjuster', 'determination'], passThreshold: 70 },
        followUps: ['Would you like us to document thoroughly so you can make an informed decision?'],
      },
      {
        id: 'm2-labels-scale-best-practices',
        role: 'rep',
        prompt: 'Walk through labeling and scale best practices for photo reports.',
        expectedKeyPoints: [
          'Include ruler/coin for scale on close-ups',
          'Label elevation/slope and damage type',
          'Use angled light for shallow dimples',
          'Consistent naming/order improves adjuster review',
        ],
        rubric: { keywords: ['scale', 'label', 'angled light', 'order', 'adjuster'], passThreshold: 70 },
        followUps: ['Name three labels you would add to a hail close-up.'],
      },
      {
        id: 'm2-storm-vs-wear-evidence',
        role: 'adjuster',
        prompt: 'Explain the evidence that separates storm damage from normal wear on 3-tab shingles.',
        expectedKeyPoints: ['Pattern across slopes', 'Granule displacement/bruise', 'No directional crease for hail', 'Collateral confirmation'],
        rubric: { keywords: ['pattern', 'granules', 'bruise', 'directional', 'collateral'], passThreshold: 75 },
        followUps: ['Which two collateral items would you request to corroborate hail?'],
      },
      {
        id: 'm2-sequence-order-quiz',
        role: 'rep',
        prompt: 'State your preferred photo sequence order from street to roof close-ups.',
        expectedKeyPoints: ['Mailbox/house number', 'Front/right/rear/left elevations', 'Slope overviews', 'Damage close-ups', 'Collateral'],
        rubric: { keywords: ['mailbox', 'elevations', 'overviews', 'close-ups', 'collateral'], passThreshold: 70 },
        followUps: ['What happens if you upload out of order—how does it affect review?'],
      },
    ],
  },

  // ========================================
  // MODULE 3: Daily Workflow & Pipeline Management
  // ========================================
  module3: {
    trainerTips: [
      'Tie Field Portal actions to pipeline health.',
      'Upload photos same day to keep claims moving.',
      'Announce wins in GroupMe to build momentum.',
    ],
    practiceSequences: [
      {
        id: 'm3-seq-1',
        title: 'Daily Workflow',
        steps: ['Morning prep', 'Field work', 'Upload photos', 'Evening wrap-up'],
      },
      {
        id: 'm3-seq-2',
        title: 'Metrics Mindset',
        steps: ['Door count', 'Inspections', 'Sign-ups', 'Completions'],
      },
    ],
    scenarios: [
      {
        id: 'm3-time-prioritization',
        role: 'rep',
        prompt: 'You have 45 minutes left today. Do you knock or upload photos?',
        expectedKeyPoints: [
          'Same-day upload best practice',
          'Knock target consideration',
          'Balance immediate vs. pipeline needs',
        ],
        rubric: {
          keywords: ['same-day', 'upload', 'pipeline', 'target'],
          passThreshold: 70,
        },
        followUps: [
          "What's your current door count and do you have urgent tasks on the message board?",
        ],
      },
      {
        id: 'm3-deductible-explain',
        role: 'homeowner',
        prompt: 'How much will this cost me up front?',
        expectedKeyPoints: [
          'Typically only the deductible if claim approved',
          'No obligation inspection',
          'Policy designed for storm events'
        ],
        rubric: { keywords: ['deductible','policy','approved','no obligation'], passThreshold: 70 },
        followUps: ['Would you like me to show a simple cost breakdown after approval?']
      },
      {
        id: 'm3-adjuster-meeting-setup',
        role: 'rep',
        prompt: 'Outline how you prepare and run an adjuster meeting.',
        expectedKeyPoints: [
          'Organized photo report with labels',
          'Test squares/chalk ready',
          'Walk order: elevations, slopes, collateral',
          'Professional cooperation tone'
        ],
        rubric: { keywords: ['report','labels','chalk','order','cooperate'], passThreshold: 70 },
        followUps: ['What are your first two photos to present to the adjuster and why?']
      },
      {
        id: 'm3-groupme-post-template',
        role: 'rep',
        prompt: 'Compose a concise GroupMe post after a sign-up that motivates the team and informs operations.',
        expectedKeyPoints: [
          'Include neighborhood + carrier + next step',
          'Thank homeowner (no private info)',
          'Encourage team momentum',
        ],
        rubric: { keywords: ['neighborhood', 'carrier', 'next step', 'momentum'], passThreshold: 70 },
        followUps: ['Add one photo and a lesson learned as a comment.'],
      },
      {
        id: 'm3-pipeline-stuck-action',
        role: 'rep',
        prompt: 'A job has been in "Estimate Pending" for 10 days. What do you do?',
        expectedKeyPoints: ['Check messages/notes', 'Follow up with desk/adjuster', 'Set reminder', 'Update homeowner with ETA'],
        rubric: { keywords: ['follow up', 'desk', 'adjuster', 'reminder', 'ETA'], passThreshold: 70 },
        followUps: ['Draft a 2-sentence update text to the homeowner.'],
      },
      {
        id: 'm3-evening-upload-discipline',
        role: 'rep',
        prompt: 'Outline your same-day upload routine for photo reports when you\'re behind schedule.',
        expectedKeyPoints: ['Time block at end of day', 'Prioritize organized sets', 'Caption/label as you go', 'Post status to team'],
        rubric: { keywords: ['time block', 'organized', 'labels', 'status'], passThreshold: 70 },
        followUps: ['What\'s your backup plan if Wi‑Fi is slow?'],
      },
      {
        id: 'm3-adjuster-call-prep',
        role: 'rep',
        prompt: 'You need to call an adjuster to clarify scope. What prep do you do?',
        expectedKeyPoints: ['Open report with page references', 'Know test square counts', 'Have dates/NOAA ready', 'Remain professional/cooperative'],
        rubric: { keywords: ['references', 'counts', 'NOAA', 'professional'], passThreshold: 70 },
        followUps: ['List the first three items you will reference on the call.'],
      }
    ],
  },

  // ========================================
  // MODULE 4: L.E.A.R.N. Framework & Objection Handling
  // ========================================
  module4: {
    trainerTips: [
      'Use L.E.A.R.N. (Listen, Empathize, Ask, Respond, Navigate).',
      'Ask clarifying questions before responding.',
      'End with a clear next step.',
    ],
    practiceSequences: [
      {
        id: 'm4-seq-1',
        title: 'LEARN Practice',
        steps: ['Listen', 'Empathize', 'Ask', 'Respond', 'Navigate'],
      },
    ],
    scenarios: [
      {
        id: 'm4-need-other-quotes',
        role: 'homeowner',
        prompt: 'We want to get a few other quotes first.',
        expectedKeyPoints: ['Acknowledge diligence', 'Insurance claim ≠ retail bidding', 'Evidence-driven approval', 'Offer inspection first'],
        rubric: { keywords: ['acknowledge', 'not retail', 'evidence', 'inspection'], passThreshold: 70 },
        followUps: ['Would a quick inspection and photo report help you compare apples to apples?'],
      },
      {
        id: 'm4-dog-barking',
        role: 'homeowner',
        prompt: 'The dog is going crazy—can you just leave info?',
        expectedKeyPoints: ['Empathize', 'Offer quick 10-sec value statement', 'Set short follow-up time window', 'Confirm via text'],
        rubric: { keywords: ['empathize', '10 seconds', 'follow-up', 'text'], passThreshold: 70 },
        followUps: ['I\'ll text you—does tomorrow at 10:30am or 6:15pm work better?'],
      },
      {
        id: 'm4-learn-budget',
        role: 'homeowner',
        prompt: "This seems expensive. We can't afford it.",
        expectedKeyPoints: [
          'Empathy',
          'Deductible focus',
          'Insurance covers replacement',
          'Offer times',
        ],
        rubric: {
          keywords: ['understand', 'deductible', 'insurance', 'schedule'],
          passThreshold: 70,
        },
        followUps: [
          'Would 5pm today or 10am tomorrow work to take a quick look?',
        ],
      },
      {
        id: 'm4-no-leaks-no-problem',
        role: 'homeowner',
        prompt: "We don't have any leaks—so there's no problem, right?",
        expectedKeyPoints: [
          'Acknowledge',
          'Explain hidden roof-level damage vs. leaks',
          'Insurance requires evidence not active leak',
          'Offer quick roof-level check',
        ],
        rubric: { keywords: ['acknowledge', 'roof-level', 'evidence', 'check'], passThreshold: 70 },
        followUps: ['Would 10 minutes on the roof for photos help you decide?'],
      },
      {
        id: 'm4-wait-until-spring',
        role: 'homeowner',
        prompt: 'Let\'s wait until spring—weather will be better.',
        expectedKeyPoints: [
          'Empathize about timing',
          'Explain claim windows/system aging',
          'Document now, schedule later if needed',
          'Offer short inspection window',
        ],
        rubric: { keywords: ['empathize', 'window', 'document', 'schedule'], passThreshold: 70 },
        followUps: ['Would you like a documented baseline now and decide on timing later?'],
      },
      {
        id: 'm4-hoa-restrictions',
        role: 'homeowner',
        prompt: 'Our HOA is strict—this probably isn\'t allowed.',
        expectedKeyPoints: [
          'Acknowledge HOA concern',
          'Clarify inspection/photo documentation allowed',
          'Work with HOA on materials/colors post-approval',
          'Next step: simple inspection first',
        ],
        rubric: { keywords: ['HOA', 'allowed', 'materials', 'colors', 'next step'], passThreshold: 70 },
        followUps: ['If it qualifies, we coordinate approvals; want a quick check now?'],
      },
      {
        id: 'm4-trust-proof-social',
        role: 'homeowner',
        prompt: 'How do I know you\'re legit? We\'ve had a lot of people knocking.',
        expectedKeyPoints: [
          'Empathize with flood of contractors',
          'Local presence and references',
          'Photo-report transparency',
          'No-obligation check with clear next step',
        ],
        rubric: { keywords: ['local', 'references', 'transparency', 'no obligation', 'next step'], passThreshold: 70 },
        followUps: ['Would you like to see a sample photo report from nearby?'],
      },
      {
        id: 'm4-too-busy-come-back',
        role: 'homeowner',
        prompt: 'Today is crazy—come back later sometime.',
        expectedKeyPoints: ['Acknowledge', 'Offer two specific times', '15-minute check promise', 'Set reminder/confirm'],
        rubric: { keywords: ['acknowledge', 'two times', '15 minutes', 'confirm'], passThreshold: 70 },
        followUps: ['Do you prefer after work today or tomorrow morning?'],
      },
      {
        id: 'm4-deductible-cannot-afford',
        role: 'homeowner',
        prompt: 'We can\'t afford the deductible right now.',
        expectedKeyPoints: ['Empathize', 'Only pay if approved', 'Timing aligns with completion', 'No-obligation inspection'],
        rubric: { keywords: ['empathize', 'approved', 'completion', 'no obligation'], passThreshold: 70 },
        followUps: ['Would it help if I showed the timeline of payments?'],
      },
      {
        id: 'mX-referral-ask-soft',
        role: 'rep',
        prompt: 'Politely ask for referrals after installation and certificate of completion.',
        expectedKeyPoints: [
          'Confirm satisfaction',
          'Ask permission for yard sign/review',
          'Soft ask for friends/neighbors',
          'Provide easy link or card'
        ],
        rubric: { keywords: ['satisfaction','yard sign','review','referral','neighbors'], passThreshold: 70 },
        followUps: ['Would you mind if we placed a small sign for a week or two?']
      }
    ],
  },

  // ========================================
  // MODULE 5: ACV/RCV, Xactimate, and Advanced Scoping
  // ========================================
  module5: {
    trainerTips: [
      'Explain ACV vs RCV with simple language.',
      'Use numbers and visuals to make it tangible.',
      'Clarify deductible and timing of payments.',
    ],
    practiceSequences: [
      {
        id: 'm5-seq-1',
        title: 'ACV/RCV Explainer',
        steps: [
          'Define RCV',
          'Define ACV',
          'Show example',
          'Timeline of payments',
        ],
      },
    ],
    scenarios: [
      {
        id: 'm5-supplement-photo-just',
        role: 'adjuster',
        prompt: 'Explain how you justify a supplement using photo sequences and measured quantities.',
        expectedKeyPoints: ['Before/after context', 'Close-ups with scale', 'Measurement math', 'Code references when applicable'],
        rubric: { keywords: ['before/after', 'scale', 'measure', 'code', 'supplement'], passThreshold: 75 },
        followUps: ['Name two photos that are most persuasive for drip edge addition.'],
      },
      {
        id: 'm5-itel-lab-process',
        role: 'adjuster',
        prompt: 'Outline the iTel/discontinued verification process and how it affects scope.',
        expectedKeyPoints: ['Sample collection and chain of custody', 'Manufacturer match result', 'Repairability vs replacement', 'Documentation provided'],
        rubric: { keywords: ['iTel', 'sample', 'manufacturer', 'repairability', 'replacement'], passThreshold: 75 },
        followUps: ['What do you include in your note when submitting the iTel?'],
      },
      {
        id: 'm5-rcv-acv-questions',
        role: 'homeowner',
        prompt:
          'Why do they withhold depreciation? When do I pay the deductible?',
        expectedKeyPoints: [
          'Depreciation release after completion',
          'Deductible is out-of-pocket',
          'Two-payment flow',
        ],
        rubric: {
          keywords: ['depreciation', 'completion', 'deductible', 'two payments'],
          passThreshold: 70,
        },
        followUps: [
          'Would you like to see a quick calculator demo that shows your numbers?',
        ],
      },
      {
        id: 'm5-xactimate-line-items',
        role: 'adjuster',
        prompt: 'Defend three scope line items with Xactimate logic and site evidence.',
        expectedKeyPoints: [
          'Reference line codes and scope rationale',
          'Tie to photos and code requirements',
          'Professional, concise justification',
        ],
        rubric: { keywords: ['line code', 'scope', 'photos', 'code', 'professional'], passThreshold: 75 },
        followUps: ['Choose one line item and provide your one-sentence justification.'],
      },
      {
        id: 'm5-waste-calc-debate',
        role: 'adjuster',
        prompt: 'Explain your waste calculation on a hip/valley roof and respond to a lower adjuster number.',
        expectedKeyPoints: ['Show geometry and pitch impact', 'Explain industry range', 'Offer compromise backed by math'],
        rubric: { keywords: ['waste', 'geometry', 'pitch', 'range', 'compromise'], passThreshold: 75 },
        followUps: ['What documentation will you attach to support your waste percentage?'],
      },
      {
        id: 'm5-code-upgrades',
        role: 'rep',
        prompt: 'Explain how code upgrades are handled in a typical storm claim.',
        expectedKeyPoints: [
          'Carrier pays for required code items when applicable',
          'Provide documentation (local code excerpts)',
          'Add to scope and supplement as needed',
        ],
        rubric: { keywords: ['code', 'required', 'documentation', 'supplement'], passThreshold: 70 },
        followUps: ['Name two common roofing code items in your market.'],
      },
      {
        id: 'm5-overhead-profit',
        role: 'rep',
        prompt: 'When is O&P (overhead and profit) appropriate, and how do you communicate it?',
        expectedKeyPoints: ['Complexity/coordination threshold', 'Industry standards', 'Professional, transparent discussion'],
        rubric: { keywords: ['O&P', 'complexity', 'coordination', 'transparent'], passThreshold: 70 },
        followUps: ['Provide a sentence you would use with an adjuster regarding O&P.'],
      },
      {
        id: 'm5-discontinued-shingles',
        role: 'rep',
        prompt: 'Discuss how you handle discontinued shingles with an adjuster.',
        expectedKeyPoints: ['Manufacturer verification (iTel, etc.)', 'Documentation and photos', 'Match issues—repair vs replace'],
        rubric: { keywords: ['discontinued', 'manufacturer', 'iTel', 'match', 'replace'], passThreshold: 70 },
        followUps: ['What documentation do you submit with the iTel?'],
      },
      {
        id: 'mX-referral-ask-soft',
        role: 'rep',
        prompt: 'Politely ask for referrals after installation and certificate of completion.',
        expectedKeyPoints: [
          'Confirm satisfaction',
          'Ask permission for yard sign/review',
          'Soft ask for friends/neighbors',
          'Provide easy link or card'
        ],
        rubric: { keywords: ['satisfaction','yard sign','review','referral','neighbors'], passThreshold: 70 },
        followUps: ['Would you mind if we placed a small sign for a week or two?']
      }
    ],
  },

  // ========================================
  // MODULE 6: Role-Play Mastery & Script Variations
  // ========================================
  module6: {
    trainerTips: [
      'Break down complex options into simple choices.',
      'Use scenario coaching to reinforce best practices.',
    ],
    practiceSequences: [
      {
        id: 'm6-seq-1',
        title: 'Scenario Drill',
        steps: [
          'Present scenario',
          'Two good options',
          'Two poor options',
          'Explain why',
        ],
      },
    ],
    scenarios: [
      {
        id: 'm6-roleplay-1',
        role: 'rep',
        prompt:
          'Customer says they will "think about it" after you find qualifying damage.',
        expectedKeyPoints: [
          'Acknowledge',
          'Educate urgency and claim window',
          'Offer two times',
        ],
        rubric: {
          keywords: ['understand', 'window', 'schedule', '15 minutes'],
          passThreshold: 70,
        },
        followUps: ['What time today or tomorrow works best?'],
      },
      {
        id: 'm6-knock-script-variations',
        role: 'rep',
        prompt: 'Deliver two different openers for the same street—one for a direct style and one for a friendly style.',
        expectedKeyPoints: ['Tailor tone', 'Keep core value the same', 'Ask short permission question', 'Transition to next step'],
        rubric: { keywords: ['tone', 'value', 'permission', 'transition'], passThreshold: 70 },
        followUps: ['Which opener fits a time-pressed homeowner best and why?'],
      },
      {
        id: 'm6-roleplay-pause-silence',
        role: 'rep',
        prompt: 'Practice using intentional pauses during objection handling without rambling.',
        expectedKeyPoints: ['Acknowledge', 'Pause for processing', 'Concise answer', 'Ask next-step question'],
        rubric: { keywords: ['pause', 'concise', 'acknowledge', 'next step'], passThreshold: 70 },
        followUps: ['Where would you place your two longest pauses and why?'],
      },
      {
        id: 'm6-open-ended-questions',
        role: 'rep',
        prompt: 'List three open-ended questions to surface hidden objections after inspection.',
        expectedKeyPoints: ['Avoid yes/no', 'Invite concerns', 'Prepare for scheduling close'],
        rubric: { keywords: ['open-ended', 'concerns', 'schedule'], passThreshold: 70 },
        followUps: ['Rewrite one question to be shorter but still open-ended.'],
      },
      {
        id: 'mX-referral-ask-soft',
        role: 'rep',
        prompt: 'Politely ask for referrals after installation and certificate of completion.',
        expectedKeyPoints: [
          'Confirm satisfaction',
          'Ask permission for yard sign/review',
          'Soft ask for friends/neighbors',
          'Provide easy link or card'
        ],
        rubric: { keywords: ['satisfaction','yard sign','review','referral','neighbors'], passThreshold: 70 },
        followUps: ['Would you mind if we placed a small sign for a week or two?']
      }
    ],
  },

  // ========================================
  // MODULE 7: Time Management & Daily Simulations
  // ========================================
  module7: {
    trainerTips: [
      'Use simulations to train judgment under time pressure.',
      'Always tie actions to downstream pipeline impact.',
    ],
    practiceSequences: [
      {
        id: 'm7-seq-1',
        title: 'Daily Simulation',
        steps: ['Morning prep', 'Midday decisions', 'Evening wrap-up'],
      },
    ],
    scenarios: [
      {
        id: 'm7-sim-1',
        role: 'rep',
        prompt:
          'You have an adjuster call and two inspections to schedule—what\'s first?',
        expectedKeyPoints: [
          'Urgent tasks first',
          'Protect adjuster meeting',
          'Schedule inspections',
        ],
        rubric: {
          keywords: ['urgent', 'adjuster', 'schedule'],
          passThreshold: 70,
        },
        followUps: [
          'Do you have the Photo Report ready to send to the adjuster?',
        ],
      },
      {
        id: 'm7-time-blocking',
        role: 'rep',
        prompt: 'You have two hours before sunset: 45 minutes of uploads pending and a hot street to knock. How do you time-block?',
        expectedKeyPoints: ['Split block or prioritize uploads same-day', 'Communicate with team', 'Set reminder for remaining task'],
        rubric: { keywords: ['time-block', 'same-day', 'communicate', 'reminder'], passThreshold: 70 },
        followUps: ['What is your exact 120-minute plan by 15-minute blocks?'],
      },
      {
        id: 'm7-weather-adjust-plan',
        role: 'rep',
        prompt: 'A sudden storm cancels your adjuster meeting. How do you adjust your day to still hit targets?',
        expectedKeyPoints: ['Reschedule immediately', 'Knock alternate area', 'Backlog uploads/training'],
        rubric: { keywords: ['reschedule', 'targets', 'uploads', 'training'], passThreshold: 70 },
        followUps: ['Write a two-line text you\'ll send the homeowner.'],
      },
      {
        id: 'm7-prioritize-followups',
        role: 'rep',
        prompt: 'Choose three jobs from your pipeline to follow up today and explain why.',
        expectedKeyPoints: ['Pick by stage impact', 'Oldest first when equal', 'Note clear next step'],
        rubric: { keywords: ['stage', 'oldest', 'next step'], passThreshold: 70 },
        followUps: ['Draft one voicemail and one text for two of them.'],
      },
      {
        id: 'mX-referral-ask-soft',
        role: 'rep',
        prompt: 'Politely ask for referrals after installation and certificate of completion.',
        expectedKeyPoints: [
          'Confirm satisfaction',
          'Ask permission for yard sign/review',
          'Soft ask for friends/neighbors',
          'Provide easy link or card'
        ],
        rubric: { keywords: ['satisfaction','yard sign','review','referral','neighbors'], passThreshold: 70 },
        followUps: ['Would you mind if we placed a small sign for a week or two?']
      }
    ],
  },

  // ========================================
  // MODULE 8: Coaching & Leadership
  // ========================================
  module8: {
    trainerTips: [
      'Reinforce leadership and mentoring to junior reps.',
      'Coach with examples and measured feedback.',
    ],
    practiceSequences: [
      {
        id: 'm8-seq-1',
        title: 'Coaching Cycle',
        steps: ['Observe', 'Coach', 'Practice', 'Feedback'],
      },
    ],
    scenarios: [
      {
        id: 'm8-coach-1',
        role: 'rep',
        prompt: 'Your trainee rushes the pitch. How do you coach them?',
        expectedKeyPoints: [
          'Slow down',
          'Use name',
          'Ask for agreement',
          'Two time options',
        ],
        rubric: {
          keywords: ['slow', 'name', 'agreement', 'options'],
          passThreshold: 70,
        },
        followUps: ['Can you demo the corrected pitch at normal pace?'],
      },
      {
        id: 'm8-ridealong-feedback',
        role: 'rep',
        prompt: 'You just did a ride-along. Deliver feedback that is specific, kind, and actionable.',
        expectedKeyPoints: ['One praise, one focus area', 'Specific example', 'Practice plan with rep', 'Follow-up date'],
        rubric: { keywords: ['specific', 'actionable', 'practice', 'follow-up'], passThreshold: 70 },
        followUps: ['Schedule a 10-minute micro‑practice on the weak spot.'],
      },
      {
        id: 'm8-coach-photo-report-quality',
        role: 'rep',
        prompt: 'Coach a rep whose photo reports are out of order and unlabeled.',
        expectedKeyPoints: ['Explain impact on adjusters', 'Show example of good report', 'Set standard and checklist', 'Audit next 3 uploads'],
        rubric: { keywords: ['impact', 'example', 'standard', 'audit'], passThreshold: 70 },
        followUps: ['Share a simple 5-step checklist you will enforce.'],
      },
      {
        id: 'm8-roleplay-handoff',
        role: 'rep',
        prompt: 'Roleplay a clean handoff from inspection to claim call-in with a trainee observing.',
        expectedKeyPoints: ['Recap findings in plain language', 'Set homeowner expectations', 'Initiate claim calmly', 'Invite trainee to mirror process'],
        rubric: { keywords: ['recap', 'expectations', 'claim', 'mirror'], passThreshold: 70 },
        followUps: ['What one-liner will you use to transition into the call?'],
      },
      {
        id: 'mX-referral-ask-soft',
        role: 'rep',
        prompt: 'Politely ask for referrals after installation and certificate of completion.',
        expectedKeyPoints: [
          'Confirm satisfaction',
          'Ask permission for yard sign/review',
          'Soft ask for friends/neighbors',
          'Provide easy link or card'
        ],
        rubric: { keywords: ['satisfaction','yard sign','review','referral','neighbors'], passThreshold: 70 },
        followUps: ['Would you mind if we placed a small sign for a week or two?']
      }
    ],
  },

  // ========================================
  // MODULE 9: Capstone & Advanced Integration
  // ========================================
  module9: {
    trainerTips: [
      'Capstone: integrate objections, claims, and scheduling into one flow.',
      'Aim for mastery-level concise answers with clear next steps.',
    ],
    practiceSequences: [
      {
        id: 'm9-seq-1',
        title: 'Capstone Flow',
        steps: ['Pitch', 'Inspect', 'Claim', 'Schedule', 'Follow-up'],
      },
    ],
    scenarios: [
      {
        id: 'm9-scope-clarity-meeting',
        role: 'adjuster',
        prompt: 'Lead a scope-clarity discussion with an adjuster who is new to hail claims.',
        expectedKeyPoints: ['Walk order using report', 'Define criteria for hits vs wear', 'Show collateral early', 'Agree on next steps'],
        rubric: { keywords: ['walk order', 'criteria', 'collateral', 'next steps'], passThreshold: 80 },
        followUps: ['What one-page handout would you bring for criteria clarity?'],
      },
      {
        id: 'm9-safety-ladder-meet',
        role: 'adjuster',
        prompt: 'Before the meeting begins, state your ladder and roof safety plan with the adjuster.',
        expectedKeyPoints: ['3-point contact', 'Stabilization and tie-off where needed', 'Weather/wind check', 'Roles and communication'],
        rubric: { keywords: ['3-point', 'stabilization', 'weather', 'communication'], passThreshold: 80 },
        followUps: ['What will you do if wind exceeds your safety threshold mid-meeting?'],
      },
      {
        id: 'm9-capstone-1',
        role: 'homeowner',
        prompt: "We're comparing a few companies—why should we pick you?",
        expectedKeyPoints: [
          'Local specialist',
          'Insurance navigation',
          'Photo documentation',
          'Clear process',
          'Schedule',
        ],
        rubric: {
          keywords: [
            'local',
            'specialize',
            'insurance',
            'photos',
            'process',
            'schedule',
          ],
          passThreshold: 75,
        },
        followUps: ['Would you like references or to see a sample Photo Report?'],
      },
      {
        id: 'm9-partial-slope-coverage',
        role: 'adjuster',
        prompt: 'Adjuster proposes replacing only two slopes. Make the case for full-roof replacement or the best alternative.',
        expectedKeyPoints: [
          'Pattern and test square counts across slopes',
          'Valley/ridge continuity and matching',
          'Collateral and uniform appearance considerations',
          'Alternative: tie-in scope with justification if partial',
        ],
        rubric: { keywords: ['pattern', 'continuity', 'matching', 'collateral', 'tie-in'], passThreshold: 80 },
        followUps: ['What photos do you show first to support full coverage?'],
      },
      {
        id: 'm9-cosmetic-vs-functional',
        role: 'adjuster',
        prompt: 'Address "cosmetic only" pushback on metal components using evidence and policy language.',
        expectedKeyPoints: ['Differentiate cosmetic vs functional criteria', 'Show functional impact (rust/exposed substrate)', 'Policy/endorsement context'],
        rubric: { keywords: ['cosmetic', 'functional', 'evidence', 'policy'], passThreshold: 80 },
        followUps: ['Which two photos best demonstrate functional impact here, and why?'],
      },
      {
        id: 'm9-adjuster-pushback',
        role: 'rep',
        prompt: 'Adjuster says the marks look like wear, not hail. What do you present and how?',
        expectedKeyPoints: ['Test square counts/pattern', 'Collateral confirmation', 'Overviews for context', 'Professional tone'],
        rubric: { keywords: ['pattern', 'collateral', 'context', 'professional'], passThreshold: 75 },
        followUps: ['Quote the single clearest sentence you will use to frame your evidence.'],
      },
      {
        id: 'm9-deductible-objection-close',
        role: 'homeowner',
        prompt: 'We can\'t swing the deductible. Can we delay everything?',
        expectedKeyPoints: ['Empathize', 'Only due if approved and at completion', 'Plan options/timing', 'No-obligation inspection now'],
        rubric: { keywords: ['empathize', 'approved', 'completion', 'options'], passThreshold: 70 },
        followUps: ['Would seeing a basic cost timeline help you decide?'],
      },
      {
        id: 'm9-scope-walkthrough',
        role: 'rep',
        prompt: 'Walk a homeowner through the approved scope using your photo report.',
        expectedKeyPoints: ['Start with overviews', 'Explain close-ups simply', 'Show collateral connection', 'Outline next steps/scheduling'],
        rubric: { keywords: ['overviews', 'close-ups', 'collateral', 'next steps'], passThreshold: 75 },
        followUps: ['What two expectations will you set before installation day?'],
      },
      {
        id: 'mX-referral-ask-soft',
        role: 'rep',
        prompt: 'Politely ask for referrals after installation and certificate of completion.',
        expectedKeyPoints: [
          'Confirm satisfaction',
          'Ask permission for yard sign/review',
          'Soft ask for friends/neighbors',
          'Provide easy link or card'
        ],
        rubric: { keywords: ['satisfaction','yard sign','review','referral','neighbors'], passThreshold: 70 },
        followUps: ['Would you mind if we placed a small sign for a week or two?']
      }
    ],
  },
};

// ========================================
// SCENARIO CATEGORIES FOR UNIFIED SELECTOR
// ========================================

const scenarioCategories = {
  inspection: {
    id: 'inspection',
    title: 'Inspection Process',
    icon: '🔍',
    description: 'Practice handling homeowner questions during roof inspections',
    color: '#2196f3',
    sourceModule: 'Module 7'
  },
  initialPitch: {
    id: 'initialPitch',
    title: 'Door Knock & Pitch',
    icon: '🚪',
    description: 'Master the door knock and 5 non-negotiables',
    color: '#4caf50',
    sourceModule: 'Module 7'
  },
  postInspection: {
    id: 'postInspection',
    title: 'Post-Inspection Pitch',
    icon: '📋',
    description: 'Present findings and build the evidence story',
    color: '#ff9800',
    sourceModule: 'Module 8'
  },
  initialObjections: {
    id: 'initialObjections',
    title: 'Initial Objections',
    icon: '🛑',
    description: 'Handle objections at the door using L.E.A.R.N.',
    color: '#f44336',
    sourceModule: 'Module 9'
  },
  postInspectionObjections: {
    id: 'postInspectionObjections',
    title: 'Post-Inspection Objections',
    icon: '💬',
    description: '9 common objections after finding damage',
    color: '#9c27b0',
    sourceModule: 'Module 9'
  },
  closingObjections: {
    id: 'closingObjections',
    title: 'Closing Objections',
    icon: '✍️',
    description: '12 final objections before signing',
    color: '#607d8b',
    sourceModule: 'Module 12'
  }
};

// ========================================
// CATEGORIZED SCENARIOS
// ========================================

// INSPECTION SCENARIOS (Module 7 content)
const inspectionScenarios = [
  {
    id: 'insp-what-looking-for',
    role: 'homeowner',
    category: 'inspection',
    prompt: "What exactly are you looking for up there on my roof?",
    expectedKeyPoints: [
      'Hail/storm damage indicators',
      'Granule loss and bruising on shingles',
      'Flashing and vent condition',
      'Collateral damage for evidence'
    ],
    rubric: {
      keywords: ['hail', 'granules', 'flashing', 'vents', 'damage', 'storm', 'evidence'],
      passThreshold: 70
    },
    followUps: [
      'How long will this inspection take?',
      'Will you need to go inside my house?'
    ]
  },
  {
    id: 'insp-is-that-damage',
    role: 'homeowner',
    category: 'inspection',
    prompt: "Is that actually damage? It looks pretty normal to me.",
    expectedKeyPoints: [
      'Explain hail indicators (circular divots)',
      'Show granule displacement',
      'Compare to undamaged area',
      'Use test square method'
    ],
    rubric: {
      keywords: ['circular', 'divot', 'granule', 'bruise', 'test square', 'chalk', 'pattern'],
      passThreshold: 70
    },
    followUps: [
      'How do you know it was from the recent storm?',
      'My neighbor said their roof was fine.'
    ]
  },
  {
    id: 'insp-photo-purpose',
    role: 'homeowner',
    category: 'inspection',
    prompt: "Why are you taking so many photos? Isn't that overkill?",
    expectedKeyPoints: [
      'Insurance evidence requirements',
      'Building a case for claim approval',
      'Documentation for adjuster review',
      'Your protection and transparency'
    ],
    rubric: {
      keywords: ['insurance', 'evidence', 'adjuster', 'documentation', 'claim', 'approve'],
      passThreshold: 70
    },
    followUps: [
      'Can I see the photos you took?',
      'Will you share these with me?'
    ]
  },
  {
    id: 'insp-safety-concern',
    role: 'homeowner',
    category: 'inspection',
    prompt: "Is it safe to be up there? I don't want anyone getting hurt on my property.",
    expectedKeyPoints: [
      'Safety protocols and training',
      '3-point contact on ladder',
      'Insurance and liability coverage',
      'Weather check before climbing'
    ],
    rubric: {
      keywords: ['safe', 'ladder', 'training', 'insurance', 'liability', 'weather'],
      passThreshold: 70
    },
    followUps: [
      'What happens if you slip or fall?',
      'Do you have liability insurance?'
    ]
  },
  {
    id: 'insp-how-long',
    role: 'homeowner',
    category: 'inspection',
    prompt: "How long is this going to take? I have somewhere to be.",
    expectedKeyPoints: [
      '15-20 minutes typical',
      'Thorough but efficient process',
      'Will show you findings after',
      'Respect their time'
    ],
    rubric: {
      keywords: ['15', '20', 'minutes', 'quick', 'thorough', 'efficient', 'findings'],
      passThreshold: 70
    },
    followUps: [
      'Can you just give me a quick answer?',
      'What if you find something? How long then?'
    ]
  }
];

// INITIAL PITCH SCENARIOS (Module 7 content)
const initialPitchScenarios = [
  {
    id: 'pitch-30sec-opener',
    role: 'rep',
    category: 'initialPitch',
    prompt: 'Deliver your 30-second door knock pitch for a post-storm neighborhood.',
    expectedKeyPoints: [
      'Who you are (name)',
      'Who we are (Roof-ER, local company)',
      'Make it relatable (storms, neighbors)',
      'What you\'re there to do (free inspection)',
      'Go for the close (agreement to inspect)'
    ],
    rubric: {
      keywords: ['name', 'Roof-ER', 'local', 'neighbors', 'storm', 'free', 'inspection', 'no obligation'],
      passThreshold: 70
    },
    followUps: [
      'Now shorten it to 20 seconds.',
      'How would you adjust for a skeptical homeowner?'
    ]
  },
  {
    id: 'pitch-specific-damage',
    role: 'rep',
    category: 'initialPitch',
    prompt: 'You notice dented gutters from the street. Craft your opening that references this observation.',
    expectedKeyPoints: [
      'Reference specific visible damage',
      'Connect to storm activity',
      'Offer free inspection',
      'Create urgency without pressure'
    ],
    rubric: {
      keywords: ['noticed', 'gutter', 'dent', 'storm', 'damage', 'free', 'inspection', 'quick'],
      passThreshold: 70
    },
    followUps: [
      'What if they say the gutters are old?',
      'How do you transition to the roof inspection?'
    ]
  },
  {
    id: 'pitch-neighbor-reference',
    role: 'rep',
    category: 'initialPitch',
    prompt: "You just finished an inspection at the neighbor's house. How do you use this for your pitch?",
    expectedKeyPoints: [
      'Reference nearby work',
      'Build credibility through proximity',
      'Mention similar findings',
      'Offer convenience'
    ],
    rubric: {
      keywords: ['neighbor', 'just', 'down the street', 'similar', 'damage', 'already here'],
      passThreshold: 70
    },
    followUps: [
      "Can I call that neighbor to verify?",
      "What did you find at their house?"
    ]
  },
  {
    id: 'pitch-permission-ladder',
    role: 'rep',
    category: 'initialPitch',
    prompt: 'The homeowner agrees to a ground inspection. How do you ask permission to use your ladder?',
    expectedKeyPoints: [
      'Confirm ground findings first',
      'Explain need for roof-level photos',
      'Quick 15-minute timeframe',
      'No obligation commitment'
    ],
    rubric: {
      keywords: ['ladder', 'roof', 'photos', '15 minutes', 'no obligation', 'quick', 'evidence'],
      passThreshold: 70
    },
    followUps: [
      "I don't want anyone on my roof.",
      "Can't you see enough from the ground?"
    ]
  }
];

// POST-INSPECTION PITCH SCENARIOS (Module 8 content)
const postInspectionPitchScenarios = [
  {
    id: 'pitch-found-damage',
    role: 'rep',
    category: 'postInspection',
    prompt: 'You found qualifying damage. Walk the homeowner through your photos and explain next steps.',
    expectedKeyPoints: [
      'Set expectations (I found damage)',
      'Walk through photos visually',
      'Explain consequences (UV, leaks)',
      'Present solution (insurance coverage)',
      'Close with next step'
    ],
    rubric: {
      keywords: ['photos', 'damage', 'insurance', 'deductible', 'claim', 'adjuster', 'process'],
      passThreshold: 70
    },
    followUps: [
      'How much will this cost me?',
      'What if my insurance denies the claim?'
    ]
  },
  {
    id: 'pitch-build-story',
    role: 'rep',
    category: 'postInspection',
    prompt: 'Explain how you build the "evidence story" with your photos for the insurance adjuster.',
    expectedKeyPoints: [
      'Start with collateral damage',
      'Progress to roof overview',
      'Show test squares and close-ups',
      'Connect the storm pattern'
    ],
    rubric: {
      keywords: ['collateral', 'evidence', 'story', 'pattern', 'test square', 'adjuster', 'overview'],
      passThreshold: 70
    },
    followUps: [
      'Why does the order matter?',
      'What if the adjuster disagrees?'
    ]
  },
  {
    id: 'pitch-no-damage-found',
    role: 'rep',
    category: 'postInspection',
    prompt: "You completed the inspection but didn't find qualifying damage. How do you handle this professionally?",
    expectedKeyPoints: [
      'Be honest and transparent',
      'Explain what you looked for',
      'Provide peace of mind value',
      'Leave door open for future'
    ],
    rubric: {
      keywords: ['honest', 'good news', 'peace of mind', 'monitor', 'future', 'storm', 'contact'],
      passThreshold: 70
    },
    followUps: [
      'Are you sure you checked everything?',
      'Should I get a second opinion?'
    ]
  }
];

// INITIAL OBJECTIONS SCENARIOS (Module 9 content)
const initialObjectionsScenarios = [
  {
    id: 'obj-busy-right-now',
    role: 'homeowner',
    category: 'initialObjections',
    prompt: "I'm really busy right now. Can you just leave a card?",
    expectedKeyPoints: [
      'Acknowledge time constraint',
      'Offer 10-second value statement',
      'Provide two specific time options',
      'Offer to text confirmation'
    ],
    rubric: {
      keywords: ['understand', 'busy', '10 seconds', 'two options', 'text', 'tomorrow', 'today'],
      passThreshold: 70
    },
    followUps: [
      'I really can\'t talk right now.',
      'Fine, what time tomorrow?'
    ]
  },
  {
    id: 'obj-have-roofer',
    role: 'homeowner',
    category: 'initialObjections',
    prompt: "We already have a roofer we use. We'll call him if we need anything.",
    expectedKeyPoints: [
      'Acknowledge and respect relationship',
      'Clarify storm claim vs retail work',
      'Offer second opinion value',
      'No obligation inspection'
    ],
    rubric: {
      keywords: ['understand', 'storm claim', 'insurance', 'second opinion', 'no obligation', 'free'],
      passThreshold: 70
    },
    followUps: [
      'He\'s my brother-in-law actually.',
      'Why should I trust you over him?'
    ]
  },
  {
    id: 'obj-not-interested',
    role: 'homeowner',
    category: 'initialObjections',
    prompt: "Not interested. Have a good day.",
    expectedKeyPoints: [
      'Acknowledge respectfully',
      'Quick pivot to value',
      'Social proof (neighbors)',
      'Risk reversal (2 minutes)'
    ],
    rubric: {
      keywords: ['understand', 'neighbors', 'quick', '2 minutes', 'peace of mind', 'free'],
      passThreshold: 70
    },
    followUps: [
      '*Starts closing door*',
      'Fine, you have 30 seconds.'
    ]
  },
  {
    id: 'obj-no-damage-visible',
    role: 'homeowner',
    category: 'initialObjections',
    prompt: "I looked at my roof from the ground and don't see any damage. Why would I need an inspection?",
    expectedKeyPoints: [
      'Acknowledge their observation',
      'Explain roof-level vs ground view',
      'Reference hidden damage types',
      'Offer quick verification'
    ],
    rubric: {
      keywords: ['understand', 'roof-level', 'granules', 'hidden', 'close-up', 'verify', 'peace of mind'],
      passThreshold: 70
    },
    followUps: [
      'If I can\'t see it, why would insurance cover it?',
      '8 out of 10 neighbors had damage? Really?'
    ]
  },
  {
    id: 'obj-scam-concern',
    role: 'homeowner',
    category: 'initialObjections',
    prompt: "We've had a lot of people knocking lately. How do I know this isn't a scam?",
    expectedKeyPoints: [
      'Empathize with concern',
      'Local presence and references',
      'Transparent photo process',
      'No money upfront'
    ],
    rubric: {
      keywords: ['understand', 'local', 'references', 'transparent', 'photos', 'no money', 'no obligation'],
      passThreshold: 70
    },
    followUps: [
      'Can I verify your company online?',
      'Do you have ID or a business card?'
    ]
  }
];

// CLOSING OBJECTIONS SCENARIOS (Module 12 content)
const closingObjectionsScenarios = [
  {
    id: 'close-more-bids',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "I want to wait and get a few more bids before deciding.",
    expectedKeyPoints: [
      'Acknowledge due diligence',
      'Explain insurance claim vs retail bidding',
      'Timeline and statute concerns',
      'Position as starting the process'
    ],
    rubric: {
      keywords: ['understand', 'insurance', 'not retail', 'timeline', 'statute', 'process', 'adjuster'],
      passThreshold: 70
    },
    followUps: [
      'What makes your company different?',
      'How do I know I\'m getting a fair deal?'
    ]
  },
  {
    id: 'close-think-about-it',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "I need to think about it. Can you call me next week?",
    expectedKeyPoints: [
      'Acknowledge need for consideration',
      'Ask what specific concern to address',
      'Explain what changes in a week',
      'Offer to answer questions now'
    ],
    rubric: {
      keywords: ['understand', 'concern', 'questions', 'help', 'decide', 'timeline'],
      passThreshold: 70
    },
    followUps: [
      'I just need time to process.',
      'What if I decide not to move forward?'
    ]
  },
  {
    id: 'close-deductible-concern',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "I'm not sure about paying the deductible. That's a lot of money right now.",
    expectedKeyPoints: [
      'Empathize with financial concern',
      'Explain deductible timing (at completion)',
      'Math comparison ($1,500 vs $20,000 roof)',
      'Payment options if available'
    ],
    rubric: {
      keywords: ['understand', 'deductible', 'completion', 'value', 'new roof', 'worth it'],
      passThreshold: 70
    },
    followUps: [
      'When exactly would I have to pay?',
      'What if I can\'t afford it when the time comes?'
    ]
  },
  {
    id: 'close-spouse-decision',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "My spouse handles all the home improvement decisions. I can't sign anything without them.",
    expectedKeyPoints: [
      'Respect the decision-making process',
      'Offer to schedule when both present',
      'Provide summary materials',
      'Three-way call option'
    ],
    rubric: {
      keywords: ['understand', 'both', 'schedule', 'summary', 'together', 'call'],
      passThreshold: 70
    },
    followUps: [
      'They work late every night.',
      'Can you just email them the information?'
    ]
  },
  {
    id: 'close-dont-trust-contractors',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "I've been burned by contractors before. How do I know you won't disappear after I sign?",
    expectedKeyPoints: [
      'Acknowledge past experience',
      'Explain contingency agreement',
      'Local presence and track record',
      'Process transparency'
    ],
    rubric: {
      keywords: ['understand', 'contingency', 'local', 'track record', 'references', 'process'],
      passThreshold: 70
    },
    followUps: [
      'What happens if I\'m not satisfied with the work?',
      'Can I talk to some of your past customers?'
    ]
  },
  {
    id: 'close-rates-increase',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "Won't filing a claim make my insurance rates go up?",
    expectedKeyPoints: [
      'Address common misconception',
      'Storm claims vs at-fault claims',
      'Policy protections',
      'Cost comparison math'
    ],
    rubric: {
      keywords: ['storm', 'act of God', 'not at-fault', 'policy', 'rates', 'value'],
      passThreshold: 70
    },
    followUps: [
      'Are you 100% sure about that?',
      'What if my insurance drops me?'
    ]
  },
  {
    id: 'close-wait-and-see',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "I think I'll just wait and see if we get any leaks first.",
    expectedKeyPoints: [
      'Explain damage progression',
      'Statute of limitations urgency',
      'Interior damage costs',
      'Proactive vs reactive approach'
    ],
    rubric: {
      keywords: ['deteriorate', 'statute', 'leak', 'interior damage', 'mold', 'time', 'now'],
      passThreshold: 70
    },
    followUps: [
      'How long do I actually have?',
      'What\'s the worst that could happen?'
    ]
  },
  {
    id: 'close-claim-denied',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "What if my insurance claim gets denied? Then I've wasted everyone's time.",
    expectedKeyPoints: [
      'Explain contingency agreement',
      'No cost if denied',
      'High approval rate',
      'Worth trying given the upside'
    ],
    rubric: {
      keywords: ['contingency', 'no cost', 'denied', 'approval', 'risk', 'free'],
      passThreshold: 70
    },
    followUps: [
      'What\'s your approval rate?',
      'Have you ever had a claim denied?'
    ]
  },
  {
    id: 'close-handle-myself',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "I think I can handle the insurance claim process myself. I don't need a contractor involved.",
    expectedKeyPoints: [
      'Acknowledge their capability',
      'Explain adjuster tactics',
      'Scope reduction risks',
      'Your advocacy value'
    ],
    rubric: {
      keywords: ['understand', 'adjuster', 'scope', 'negotiate', 'advocate', 'experience'],
      passThreshold: 70
    },
    followUps: [
      'What specifically do you do that I can\'t?',
      'How much more would I get with your help?'
    ]
  },
  {
    id: 'close-just-patch',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "Can't we just patch the damaged areas instead of replacing the whole roof?",
    expectedKeyPoints: [
      'Explain matching law',
      'Color and material matching issues',
      'Insurance coverage for full replacement',
      'Long-term value'
    ],
    rubric: {
      keywords: ['matching', 'law', 'insurance', 'color', 'replace', 'value', 'warranty'],
      passThreshold: 70
    },
    followUps: [
      'Why can\'t they just match the shingles?',
      'What is matching law exactly?'
    ]
  },
  {
    id: 'close-spring-better',
    role: 'homeowner',
    category: 'closingObjections',
    prompt: "Let's wait until spring when the weather is better for roof work.",
    expectedKeyPoints: [
      'Empathize with timing concern',
      'Statute of limitations',
      'Document now, schedule later',
      'Spring crew availability'
    ],
    rubric: {
      keywords: ['understand', 'statute', 'document', 'schedule', 'spring', 'busy', 'claim'],
      passThreshold: 70
    },
    followUps: [
      'Can we really install in winter?',
      'What\'s the deadline to file?'
    ]
  },
  {
    id: 'close-assumptive',
    role: 'rep',
    category: 'closingObjections',
    prompt: 'Demonstrate an assumptive close after the homeowner seems ready but hasn\'t committed.',
    expectedKeyPoints: [
      'Transition naturally from presentation',
      'Ask preference questions (color, style)',
      'Set next step as given',
      'Remove friction from decision'
    ],
    rubric: {
      keywords: ['color', 'preference', 'schedule', 'text', 'contract', 'next step'],
      passThreshold: 70
    },
    followUps: [
      'Wait, I didn\'t say yes yet.',
      'What if I change my mind?'
    ]
  }
];

// ========================================
// UTILITY FUNCTIONS FOR FILTERING
// ========================================

// Get all scenarios from all modules
function getAllScenarios() {
  const allScenarios = [];
  Object.keys(agnesScenarios).forEach(moduleKey => {
    const module = agnesScenarios[moduleKey];
    module.scenarios.forEach(scenario => {
      allScenarios.push({
        ...scenario,
        module: moduleKey
      });
    });
  });
  return allScenarios;
}

// Get scenarios by role
function getScenariosByRole(role) {
  const allScenarios = getAllScenarios();
  return allScenarios.filter(scenario => scenario.role === role);
}

// Get scenarios by module
function getScenariosByModule(moduleKey) {
  return agnesScenarios[moduleKey] ? agnesScenarios[moduleKey].scenarios : [];
}

// Get scenarios by category
function getScenariosByCategory(categoryId) {
  switch (categoryId) {
    case 'inspection':
      return inspectionScenarios;
    case 'initialPitch':
      return initialPitchScenarios;
    case 'postInspection':
      return postInspectionPitchScenarios;
    case 'initialObjections':
      return initialObjectionsScenarios;
    case 'postInspectionObjections':
      // Return existing module9 homeowner scenarios
      return agnesScenarios.module9.scenarios.filter(s => s.role === 'homeowner');
    case 'closingObjections':
      return closingObjectionsScenarios;
    default:
      return [];
  }
}

// Get all categorized scenarios with counts
function getAllCategorizedScenarios() {
  return {
    inspection: inspectionScenarios,
    initialPitch: initialPitchScenarios,
    postInspection: postInspectionPitchScenarios,
    initialObjections: initialObjectionsScenarios,
    postInspectionObjections: agnesScenarios.module9.scenarios.filter(s => s.role === 'homeowner'),
    closingObjections: closingObjectionsScenarios
  };
}

// Get category info - single category by ID or all categories
function getCategoryInfo(categoryId) {
  if (categoryId) {
    // Return single category info
    const category = scenarioCategories[categoryId];
    if (category) {
      const scenarios = getScenariosByCategory(categoryId);
      return {
        ...category,
        count: scenarios.length
      };
    }
    return null;
  }

  // Return all categories
  const categories = Object.keys(scenarioCategories).map(key => {
    const category = scenarioCategories[key];
    const scenarios = getScenariosByCategory(key);
    return {
      ...category,
      count: scenarios.length
    };
  });
  return categories;
}

// Get all trainer tips from all modules
function getAllTrainerTips() {
  const tips = [];
  Object.keys(agnesScenarios).forEach(moduleKey => {
    tips.push(...agnesScenarios[moduleKey].trainerTips);
  });
  return tips;
}

// Get all practice sequences from all modules
function getAllPracticeSequences() {
  const sequences = [];
  Object.keys(agnesScenarios).forEach(moduleKey => {
    sequences.push(...agnesScenarios[moduleKey].practiceSequences);
  });
  return sequences;
}

// ========================================
// SUMMARY STATISTICS
// ========================================

function getScenarioStatistics() {
  const allScenarios = getAllScenarios();

  const stats = {
    totalScenarios: allScenarios.length,
    byRole: {
      homeowner: allScenarios.filter(s => s.role === 'homeowner').length,
      rep: allScenarios.filter(s => s.role === 'rep').length,
      adjuster: allScenarios.filter(s => s.role === 'adjuster').length,
    },
    byModule: {},
    totalTrainerTips: getAllTrainerTips().length,
    totalPracticeSequences: getAllPracticeSequences().length,
  };

  Object.keys(agnesScenarios).forEach(moduleKey => {
    stats.byModule[moduleKey] = agnesScenarios[moduleKey].scenarios.length;
  });

  return stats;
}

// ========================================
// SCORING FUNCTION
// ========================================

/**
 * Score a user response against expected key points
 * @param {string} userResponse - The user's response text
 * @param {string[]} expectedKeyPoints - Array of expected key points
 * @param {string[]} rubricKeywords - Array of keywords to check for
 * @param {number} passThreshold - Minimum score to pass (0-100)
 * @returns {Object} - Scoring result with score, matched/missed points
 */
function scoreResponse(userResponse, expectedKeyPoints, rubricKeywords, passThreshold = 70) {
  const response = userResponse.toLowerCase();
  const matchedPoints = [];
  const missedPoints = [];

  // Check expected key points (case-insensitive partial match)
  expectedKeyPoints.forEach(point => {
    const pointWords = point.toLowerCase().split(/\s+/);
    const matchedWords = pointWords.filter(word =>
      response.includes(word.replace(/[.,!?]/g, ''))
    );

    // If at least 40% of words in the key point are present, count as matched
    if (matchedWords.length / pointWords.length >= 0.4) {
      matchedPoints.push(point);
    } else {
      missedPoints.push(point);
    }
  });

  // Check rubric keywords
  const matchedKeywords = rubricKeywords.filter(keyword =>
    response.includes(keyword.toLowerCase())
  );

  // Calculate score
  const keyPointScore = expectedKeyPoints.length > 0
    ? (matchedPoints.length / expectedKeyPoints.length) * 70
    : 0;

  const keywordScore = rubricKeywords.length > 0
    ? (matchedKeywords.length / rubricKeywords.length) * 30
    : 0;

  const score = Math.round(keyPointScore + keywordScore);

  return {
    score,
    matchedPoints,
    missedPoints,
    matchedKeywords,
    passed: score >= passThreshold
  };
}

// ========================================
// AGNES-SPECIFIC HELPER FUNCTIONS
// ========================================

/**
 * Get all Agnes scenarios (alias for getAllScenarios)
 * Used by the roleplay function for consistency
 */
function getAllAgnesScenarios() {
  return getAllScenarios();
}

/**
 * Get Agnes scenarios by role (alias for getScenariosByRole)
 * Used by the roleplay function for consistency
 */
function getAgnesScenariosByRole(role) {
  return getScenariosByRole(role);
}

// ========================================
// EXPORTS
// ========================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    agnesScenarios,
    getAllScenarios,
    getScenariosByRole,
    getScenariosByModule,
    getAllTrainerTips,
    getAllPracticeSequences,
    getScenarioStatistics,
    scoreResponse,
    getAllAgnesScenarios,
    getAgnesScenariosByRole,
  };
}

// For browser usage
if (typeof window !== 'undefined') {
  window.agnesScenarios = agnesScenarios;
  window.getAllScenarios = getAllScenarios;
  window.getScenariosByRole = getScenariosByRole;
  window.getScenariosByModule = getScenariosByModule;
  window.getAllTrainerTips = getAllTrainerTips;
  window.getAllPracticeSequences = getAllPracticeSequences;
  window.getScenarioStatistics = getScenarioStatistics;
  window.scoreResponse = scoreResponse;
  window.getAllAgnesScenarios = getAllAgnesScenarios;
  window.getAgnesScenariosByRole = getAgnesScenariosByRole;
  // New categorized scenario functions
  window.scenarioCategories = scenarioCategories;
  window.getScenariosByCategory = getScenariosByCategory;
  window.getAllCategorizedScenarios = getAllCategorizedScenarios;
  window.getCategoryInfo = getCategoryInfo;
  window.inspectionScenarios = inspectionScenarios;
  window.initialPitchScenarios = initialPitchScenarios;
  window.postInspectionPitchScenarios = postInspectionPitchScenarios;
  window.initialObjectionsScenarios = initialObjectionsScenarios;
  window.closingObjectionsScenarios = closingObjectionsScenarios;
}

// ========================================
// USAGE EXAMPLES
// ========================================

/*
// Example 1: Get all homeowner scenarios
const homeownerScenarios = getScenariosByRole('homeowner');
console.log(`Found ${homeownerScenarios.length} homeowner scenarios`);

// Example 2: Get all scenarios from module 1
const module1Scenarios = getScenariosByModule('module1');
console.log(`Module 1 has ${module1Scenarios.length} scenarios`);

// Example 3: Get all adjuster scenarios
const adjusterScenarios = getScenariosByRole('adjuster');
console.log(`Found ${adjusterScenarios.length} adjuster scenarios`);

// Example 4: Get statistics
const stats = getScenarioStatistics();
console.log('Scenario Statistics:', stats);

// Example 5: Get all trainer tips
const tips = getAllTrainerTips();
console.log(`Total trainer tips: ${tips.length}`);

// Example 6: Access a specific module
const module5 = agnesScenarios.module5;
console.log('Module 5 trainer tips:', module5.trainerTips);
console.log('Module 5 practice sequences:', module5.practiceSequences);
console.log('Module 5 scenarios:', module5.scenarios);
*/
