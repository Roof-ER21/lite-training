# Phase 4: Real-Time Feedback Panel - Visual Guide

## Layout Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Scenario Progress: Scenario 1 of 5                    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────┬─────────────────────────────┐
│          MAIN CONTENT AREA              │    LIVE FEEDBACK PANEL      │
│                                         │                             │
│ ┌─────────────────────────────────────┐ │ ┌─────────────────────────┐ │
│ │  Scenario Title                     │ │ │ Live Feedback        [-]│ │
│ │  ─────────────────────────────────  │ │ └─────────────────────────┘ │
│ │  Role: Homeowner | Difficulty: Easy │ │                             │
│ │                                     │ │  ┌─────────────────────┐   │
│ │  ┌───────────────────────────────┐  │ │  │      [  85  ]       │   │
│ │  │ Agnes says:                    │  │ │  │   Current Score     │   │
│ │  │                                │  │ │  └─────────────────────┘   │
│ │  │ "I'm not sure I have storm    │  │ │                             │
│ │  │  damage on my roof..."        │  │ │  📋 Key Points             │
│ │  └───────────────────────────────┘  │ │  ✓ Mention free inspection │
│ │                                     │ │  ✓ Explain insurance process│
│ └─────────────────────────────────────┘ │  ○ Address urgency         │
│                                         │  ○ Build trust/rapport     │
│ Your Response:                          │                             │
│ ┌─────────────────────────────────────┐ │  💬 Tone                   │
│ │ I completely understand! Many       │ │  [████████████████████]    │
│ │ homeowners don't realize they have  │ │   Positive & Professional  │
│ │ storm damage until we inspect. The  │ │                             │
│ │ good news is I can do a completely  │ │  🎯 Confidence Level       │
│ │ free inspection right now...        │ │  [██████████░░░░░░] 65%   │
│ │                                     │ │                             │
│ │                                     │ │  Word Count: 47            │
│ │                                     │ │  Recommended: 50-150 words │
│ └─────────────────────────────────────┘ │                             │
│                                         │                             │
│ [Submit Response] [🎤 Voice] [💡 Hint] │                             │
│                                         │                             │
└─────────────────────────────────────────┴─────────────────────────────┘
```

## Component Details

### 1. Live Score Circle

```
┌─────────────────────┐
│                     │
│        ╭─────╮      │     < 70: Red background
│        │  85 │      │     70-84: Yellow background
│        │  %  │      │     85+: Green background
│        ╰─────╯      │
│   Current Score     │     Animates on change
│                     │     Font size: 2rem, bold
└─────────────────────┘
```

### 2. Key Points List

```
📋 Key Points
┌─────────────────────────────────────┐
│ ✓  Mention free inspection          │ ← Matched (green bg)
│ ✓  Explain insurance process        │ ← Matched (green bg)
│ ○  Address urgency                  │ ← Missing (yellow bg)
│ ○  Build trust/rapport              │ ← Missing (yellow bg)
│ ○  Handle objections professionally │ ← Missing (yellow bg)
└─────────────────────────────────────┘

Animation: Pulse effect when checkmark appears
```

### 3. Tone Indicator

```
💬 Tone
┌─────────────────────────────────────────┐
│ Positive & Professional                 │ ← Green bar, 100% width
└─────────────────────────────────────────┘

Neutral
┌─────────────────────────────────────────┐
│ Neutral                                 │ ← Gray bar, 100% width
└─────────────────────────────────────────┘

Needs Improvement
┌─────────────────────────────────────────┐
│ Needs Improvement                       │ ← Red bar, 100% width
└─────────────────────────────────────────┘
```

### 4. Confidence Meter

```
🎯 Confidence Level
┌─────────────────────────────────────────┐
│ ████████████████░░░░░░░░░░░░░░░░░░ 65% │ ← Purple gradient
└─────────────────────────────────────────┘

0%    = Empty bar (no confidence detected)
50%   = Half bar (neutral language)
75%   = Mostly filled (confident phrases)
100%  = Full bar (very confident, optimal length)
```

### 5. Word Count Indicator

```
┌────────────────────────────┐
│ Word Count: 47             │ ← Large purple number
│ Recommended: 50-150 words  │ ← Small gray text
└────────────────────────────┘
```

## Real-Time Updates Flow

```
User Types          Live Feedback Updates
─────────          ─────────────────────

"I can help"   →   Score: 0 → 15
                   Confidence: 50% → 60%
                   Word Count: 0 → 3
                   Tone: Neutral → Positive

"with your     →   Score: 15 → 25
roof..."           Confidence: 60% → 65%
                   Word Count: 3 → 6
                   Tone: Positive

"Let me do a   →   Score: 25 → 55
free              ✓ Key Point: "free inspection"
inspection"        Confidence: 65% → 70%
                   Word Count: 6 → 12

"I'll explain  →   Score: 55 → 75
how the           ✓ Key Point: "insurance process"
insurance          Confidence: 70% → 75%
works..."          Word Count: 12 → 18
                   Tone: Positive & Professional
```

## Color Scheme

### Score Circle
- **Red**: `linear-gradient(135deg, #ef4444 0%, #dc2626 100%)`
- **Yellow**: `linear-gradient(135deg, #f59e0b 0%, #d97706 100%)`
- **Green**: `linear-gradient(135deg, #10b981 0%, #059669 100%)`

### Key Points
- **Matched**: Background `#d4edda`, Border `#10b981`
- **Missing**: Background `#fff3cd`, Border `#f59e0b`

### Tone Bar
- **Positive**: `linear-gradient(90deg, #10b981 0%, #059669 100%)`
- **Neutral**: `linear-gradient(90deg, #6c757d 0%, #495057 100%)`
- **Negative**: `linear-gradient(90deg, #ef4444 0%, #dc2626 100%)`

### Confidence Meter
- **Bar**: `linear-gradient(90deg, #9333ea 0%, #c084fc 100%)`

### Panel
- **Border**: `#9333ea` (Agnes purple)
- **Background**: White with subtle shadow

## Mobile Layout (< 1024px)

```
┌───────────────────────────────────────┐
│     LIVE FEEDBACK PANEL (Top)         │
│  ┌─────────┐  📋  💬  🎯  Words: 47  │
│  │   85    │  Key  Tone  Conf.       │
│  └─────────┘  Points                  │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│        MAIN CONTENT AREA              │
│  Scenario                             │
│  Agnes prompt                         │
│  Response textarea                    │
│  Submit buttons                       │
└───────────────────────────────────────┘
```

## Toggle States

### Expanded (Default)
```
┌─────────────────────────────┐
│ Live Feedback            [-]│ ← Click to collapse
│                             │
│    [Score, Points, etc.]    │
│                             │
└─────────────────────────────┘
Width: 350px
```

### Collapsed
```
┌──┐
│ L│ ← Click to expand
│ i│
│ v│
│ e│
│  │
│ F│
│ e│
│ e│
│ d│
│  │
│[+]│
└──┘
Width: 60px
```

## Animations

### 1. Checkmark Appear
```
Point Status Change:
○ → ✓

Animation: pointMatchedPulse
- Scale: 1.0 → 1.05 → 1.0
- Shadow: Expands outward and fades
Duration: 0.5s
```

### 2. Score Update
```
Number Change:
65 → 75

Animation: Smooth transition
- Color change with gradient
- Number counts up/down
Duration: 0.5s cubic-bezier
```

### 3. Panel Toggle
```
Collapse/Expand:
350px ⇄ 60px

Animation: Width transition
- Content fades in/out
Duration: 0.3s ease
```

## Interaction Flow

```
1. User starts typing
   ↓
2. handleLiveFeedbackUpdate() fires
   ↓
3. Calculate metrics:
   - Score (scoreResponse function)
   - Matched key points
   - Tone (analyzeTone)
   - Confidence (analyzeConfidence)
   - Word count
   ↓
4. Update UI:
   - updateLiveScore()
   - updateKeyPointsLive()
   - updateToneIndicator()
   - updateConfidenceLevel()
   - updateWordCount()
   ↓
5. Visual feedback appears instantly
   - Checkmarks pulse
   - Score circle changes color
   - Bars animate to new values
```

## Accessibility Features

```
┌─────────────────────────────────────┐
│ Live Feedback                    [-]│ ← ARIA label on toggle
│                                     │
│ [85] Current Score                  │ ← Readable by screen readers
│ Role: status                        │
│ aria-live: polite                   │
│                                     │
│ Key Points                          │
│ ✓ Matched item                      │ ← aria-checked="true"
│ ○ Missing item                      │ ← aria-checked="false"
│                                     │
│ All elements keyboard accessible    │
│ Focus indicators visible            │
└─────────────────────────────────────┘
```

---

**Visual Guide Version:** 1.0
**Last Updated:** November 7, 2025
