/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type, Chat } from '@google/genai';

// Resolve API key from injected env. Falls back gracefully if missing.
const rawApiKey = (process.env.API_KEY as string | undefined) || (process.env.GEMINI_API_KEY as string | undefined);
let ai: GoogleGenAI | null = null;
if (rawApiKey && rawApiKey.trim()) {
  ai = new GoogleGenAI({ apiKey: rawApiKey });
}

// Local storage keys and gating
const STORAGE_KEYS = {
  commitmentSigned: 'roof-er.commitmentSigned'
};

const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('main-content');
let chat: Chat | null = null; // To hold the chat instance

// Store all training content in an object
const trainingContent = {
  welcome: `
    <div class="content-card">
      <h1>Welcome to Roof-ER!</h1>
      <p>My name is Oliver Brown. I founded this company in 2019, not because I have a passion for roofing, but because I saw an opportunity to change the reputation of roofing companies and contractors as a whole. This is an industry that is known for lack of communication, poor workmanship, and straight up deceit. With a little bit of modern thinking, integrity and hard work we've been able to build a strong brand and reputation in a relatively short amount of time.</p>
      <p>We have ambitions of becoming a national brand. To accomplish this we need to continue to add and develop hungry, competitive team members who are dedicated to the big picture but disciplined to execute on a day to day basis.</p>
      <h3>Our Mission</h3>
      <p>At Roof-ER, our mission is to hold a fiduciary responsibility to our customers - plain and simple. By committing to our core values of <strong>Integrity, Quality, and Simplicity</strong>, we promise to deliver an experience every homeowner wants.</p>
    </div>
  `,
  commitment: `
    <div class="content-card">
      <h1>Your Commitment</h1>
      <p>As a member of the Roof-ER team, your commitment to our values and processes is paramount to our collective success. Here is what we expect:</p>
      <ul>
        <li>I will conduct myself in alignment with the Mission and Core Values.</li>
        <li>I will dedicate myself to Roof-ER's successful sales process.</li>
        <li>I will always show an exceptional level of integrity.</li>
        <li>I will listen to and grow from receiving constructive feedback.</li>
        <li>I will not be involved in gossip or "office drama."</li>
        <li>I will show an intense level of discipline in the work that I conduct.</li>
        <li>I will have pride in my work.</li>
        <li><strong>I will do what it takes to commit to this. I will achieve tremendous levels of success.</strong></li>
      </ul>
      <p><strong>Required:</strong> You must digitally sign these commitments below before accessing other modules.</p>
      <p>Reference: <a href="/resources/Mission,%20Values,%20&%20Commitment.docx" target="_blank">Mission, Values, & Commitment (DOCX)</a></p>
    </div>
  `,
  'initial-pitch': `
    <div class="content-card">
      <h1>The Initial Pitch</h1>
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
        <p>“Hi, how are you? My Name is ______ with Roof-ER we're a local roofing company that specializes in helping homeowners get their roof and/or siding replaced, paid for by their insurance!”</p>
        <p>"We've had a lot of storms here in [Region] over the past few months that have done a lot of damage!</p>
        <p>“We're working with a lot of your neighbors in the area. We've been able to help them get fully approved through their insurance company to have their roof replaced."</p>
      </div>

      <h3>The Inspection Proposal</h3>
       <div class="script" data-text-source="true">
        <button class="speak-btn" aria-label="Listen to script">🔊</button>
        <p>"While I'm here, in the neighborhood, I am conducting a completely free inspection to see if you have similar, qualifiable damage. If you do, I'll take a bunch of photos and walk you through the rest of the process. If you don't, I wouldn't want to waste your time, I wouldn't want to waste mine! I will at least leave giving you peace of mind that you're in good shape."</p>
        <p><strong>(Pause here – Wait for them to respond/agree.)</strong></p>
      </div>
    </div>
  `,
   'inspection-process': `
    <div class="content-card">
        <h1>The Inspection Process</h1>
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
        <p><strong>Key takeaway:</strong> Getting enough clear photos to convince the homeowner is the most important part. Without their belief, you can't file a claim.</p>
    </div>
  `,
  'post-inspection-pitch': `
    <div class="content-card">
        <h1>Post-Inspection Pitch</h1>
        <h3>Build the Story</h3>
        <div class="script" data-text-source="true">
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <p>"Hey ____, so I have a bunch of photos to show you. First I walked around the perimeter of the house to look for collateral damage... While this damage functionally isn't a big deal, it really helps build a story. Think of us like lawyers and this collateral damage is the evidence that builds the case which helps us get the roof approved.”</p>
        </div>
        <h3>Explain the Critical Damage</h3>
        <div class="script" data-text-source="true">
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <p>“Here are the photos of the damage to your shingles. Anything I have circled means it's hail damage. This is exactly what we look for... Even if this damage doesn't look like a big deal, what happens over time, these hail divots fill with water, freeze, expand, and break apart the shingle which will eventually lead to leaks. That is why your insurance company is responsible and your policy covers this type of damage."</p>
        </div>
    </div>
  `,
  'objection-handling': `
    <div class="content-card">
        <h1>Handling Objections</h1>
        <h3>Common Objections</h3>
        <ul>
            <li>"Not interested"</li>
            <li>"I need to talk to my spouse"</li>
            <li>"I don't have enough time"</li>
            <li>"My roof is in good shape"</li>
        </ul>
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
      <h1>Shingle Types Explained</h1>
      <p>Understanding the difference between shingle types is fundamental for accurately assessing roof conditions and communicating effectively with both homeowners and insurance adjusters. Here are the two most common types you will encounter.</p>
      
      <div class="shingle-comparison">
        <div class="shingle-type">
          <h4>3-Tab Shingles</h4>
          <img src="https://i.imgur.com/gYx2V2y.jpeg" alt="3-Tab Shingles">
          <p>3-Tab shingles are a more traditional and basic type of asphalt shingle. They are characterized by their flat, single-layer construction and uniform shape.</p>
          <ul>
            <li><strong>Appearance:</strong> They get their name from the three distinct rectangular "tabs" cut into the lower edge, giving the roof a very repetitive, brick-like pattern.</li>
            <li><strong>Durability:</strong> Generally have a shorter lifespan and lower wind resistance compared to architectural shingles.</li>
            <li><strong>Identification:</strong> Easy to identify due to their flat profile and a consistent cutout pattern.</li>
          </ul>
        </div>
        <div class="shingle-type">
          <h4>Architectural Shingles</h4>
          <img src="https://i.imgur.com/bA5wY4z.jpeg" alt="Architectural Shingles">
          <p>Also known as dimensional or laminate shingles, these are a premium type of asphalt shingle that has become the standard in modern roofing.</p>
          <ul>
            <li><strong>Appearance:</strong> Constructed with a heavier base mat and multiple laminated layers of material, creating a richer, more textured, and three-dimensional look that can mimic the appearance of natural slate or wood shakes.</li>
            <li><strong>Durability:</strong> Significantly more durable, with higher wind resistance and a longer lifespan than 3-tab shingles.</li>
            <li><strong>Identification:</strong> Look for varied tab shapes and sizes, giving the roof a more random, contoured appearance without a repeating pattern.</li>
          </ul>
        </div>
      </div>
    </div>
  `,
  'roofing-damage-id': `
   <div class="content-card">
        <h1>Roofing & Damage Identification</h1>
        <h3>Shingle Types</h3>
        <p>Identifying the type of shingle is crucial for assessing damage and communicating with adjusters.</p>
        <div class="shingle-comparison">
            <div class="shingle-type">
                <h4>3-Tab Shingles</h4>
                <img src="https://i.imgur.com/gYx2V2y.jpeg" alt="3-Tab Shingles">
                <p>Flat, single-layer appearance with distinct rectangular cutouts.</p>
            </div>
            <div class="shingle-type">
                <h4>Architectural Shingles</h4>
                <img src="https://i.imgur.com/bA5wY4z.jpeg" alt="Architectural Shingles">
                <p>Laminated, multi-layer design giving a dimensional, textured look.</p>
            </div>
        </div>
        <hr>
        <h3>Storm Damage vs. Non-Storm Damage</h3>
        <p>It's vital to differentiate between actual storm damage and other roof issues.</p>
        <h4>Storm Damage (Qualifying)</h4>
        <ul>
            <li><strong>Hail Damage:</strong> Circular "bruises" or divots where granules are knocked off, often with a soft or spongy feel.</li>
            <li><strong>Wind Damage:</strong> Lifted, creased, or missing shingles.</li>
        </ul>
        <h4>Non-Storm Damage (Non-Qualifying)</h4>
        <ul>
            <li><strong>Blistering:</strong> Looks like bubbles on the shingle surface, a manufacturing defect.</li>
            <li><strong>Cracking:</strong> Age-related, looks like splintering or straight lines.</li>
            <li><strong>Granule Loss:</strong> General, even loss of granules due to age, not concentrated in spots like hail hits.</li>
        </ul>
    </div>
  `,
  'sales-cycle': `
    <div class="content-card">
        <h1>The Sales Cycle</h1>
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
        <h3>Prepping the Homeowner</h3>
        <p>Before the call to the insurance company, you must prep the homeowner. Use a blank note on your iPad to go over these key points so they know what to say.</p>
        <ul>
            <li><strong>Reason for claim:</strong> "I'd like to file a claim for hail and wind damage." (Never only one type).</li>
            <li><strong>Damaged items:</strong> Roof, Downspouts, Gutters, Siding, etc.</li>
            <li><strong>Selected Contractor:</strong> "Yes, we have selected Roof-ER."</li>
            <li><strong>Have an estimate:</strong> "No."</li>
        </ul>
        <h3>The Contingency & Claim Authorization</h3>
        <p>After the claim is filed, you will present the agreements. This is the close.</p>
        <div class="script" data-text-source="true">
            <button class="speak-btn" aria-label="Listen to script">🔊</button>
            <p><strong>Contingency Agreement:</strong> "This basic agreement backs you as the homeowner by guaranteeing your only cost will be your deductible if we get you fully approved. If it is a partial approval or denial, we will fight for you. But if we are not able to get you fully approved, this contract is null and void and you do not owe us a penny."</p>
            <p><strong>Claim Authorization:</strong> "This next form is our Claim Authorization. Very simple, it allows us to communicate with your insurance company on your behalf. I'll be here for the inspection and will communicate with them, so you don’t have to be the middle-man. Of course, I'll always keep you looped in."</p>
        </div>
    </div>
  `,
  'role-play': `
    <div class="content-card">
        <h1>Agnes 21 Role-Play Training System</h1>
        <div id="roleplay-live-region" class="sr-only" aria-live="polite" aria-atomic="true"></div>

        <!-- Screen 1: Role Selection -->
        <div id="roleplay-setup" style="display: block;">
            <h2>Select Your Training Role</h2>
            <p>Choose a role to practice. Each role has multiple scenarios with AI-powered feedback.</p>
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
        </div>

        <!-- Screen 2: Scenario Display -->
        <div id="scenario-display" style="display: none;">
            <div id="scenario-progress" style="text-align: center; margin-bottom: 20px; font-weight: 500; color: #8b4fbe;"></div>
            <div style="background: #f8f4fc; border-left: 4px solid #8b4fbe; padding: 20px; margin-bottom: 20px; border-radius: 5px;">
                <h3 id="scenario-title" style="margin: 0 0 10px 0; color: #8b4fbe;">Scenario</h3>
                <p id="scenario-context" style="margin: 0 0 15px 0; color: #555;"></p>
                <div style="background: white; padding: 15px; border-radius: 5px; border: 1px solid #e0d4f0;">
                    <strong style="color: #8b4fbe;">Agnes says:</strong>
                    <p id="agnes-prompt" style="margin: 10px 0 0 0; font-style: italic;"></p>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <label for="user-response" style="display: block; font-weight: 500; margin-bottom: 10px;">Your Response:</label>
                <textarea id="user-response" rows="6" style="width: 100%; padding: 15px; border: 2px solid #e0d4f0; border-radius: 5px; font-size: 16px; font-family: inherit;" placeholder="Type your response here..."></textarea>
            </div>

            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button id="submit-response" style="flex: 1; padding: 15px 30px; background: #8b4fbe; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: 500; cursor: pointer;">Submit Response</button>
                <button id="voice-input-btn" style="padding: 15px 30px; background: #f8f4fc; color: #8b4fbe; border: 2px solid #8b4fbe; border-radius: 5px; font-size: 16px; cursor: pointer;">🎤 Voice Input</button>
                <button id="hint-btn" style="padding: 15px 30px; background: #f8f4fc; color: #8b4fbe; border: 2px solid #8b4fbe; border-radius: 5px; font-size: 16px; cursor: pointer;">💡 Hint</button>
            </div>

            <div id="hint-display" style="display: none; background: #fff9e6; border-left: 4px solid #ffc107; padding: 15px; margin-bottom: 20px; border-radius: 5px;"></div>
        </div>

        <!-- Screen 3: Feedback Display -->
        <div id="feedback-area" style="display: none;">
            <h2 style="text-align: center; color: #8b4fbe; margin-bottom: 30px;">Performance Feedback</h2>

            <div style="text-align: center; margin-bottom: 30px;">
                <div id="score-circle" style="display: inline-block; width: 120px; height: 120px; border-radius: 50%; border: 8px solid #8b4fbe; display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: bold; color: #8b4fbe; margin-bottom: 10px;"></div>
                <p id="score-text" style="font-size: 18px; font-weight: 500;"></p>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
                <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; border-left: 4px solid #4caf50;">
                    <h3 style="margin: 0 0 15px 0; color: #2e7d32;">Matched Key Points</h3>
                    <ul id="matched-points-list" style="list-style: none; padding: 0; margin: 0;"></ul>
                </div>
                <div style="background: #fff3e0; padding: 20px; border-radius: 8px; border-left: 4px solid #ff9800;">
                    <h3 style="margin: 0 0 15px 0; color: #e65100;">Areas to Improve</h3>
                    <ul id="missed-points-list" style="list-style: none; padding: 0; margin: 0;"></ul>
                </div>
            </div>

            <div style="background: #f8f4fc; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
                <h3 style="margin: 0 0 15px 0; color: #8b4fbe;">AI Coach Feedback</h3>
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 10px 0; color: #4caf50;">Strengths:</h4>
                    <ul id="strengths-list" style="margin: 0;"></ul>
                </div>
                <div>
                    <h4 style="margin: 0 0 10px 0; color: #ff9800;">Growth Opportunities:</h4>
                    <ul id="improvements-list" style="margin: 0;"></ul>
                </div>
            </div>

            <div style="display: flex; gap: 10px;">
                <button id="next-scenario-btn" style="flex: 1; padding: 15px 30px; background: #8b4fbe; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: 500; cursor: pointer;">Next Scenario →</button>
                <button id="retry-scenario-btn" style="padding: 15px 30px; background: #f8f4fc; color: #8b4fbe; border: 2px solid #8b4fbe; border-radius: 5px; font-size: 16px; cursor: pointer;">🔄 Retry</button>
            </div>
        </div>

        <!-- Screen 4: Session Summary -->
        <div id="session-summary" style="display: none;">
            <!-- Content will be dynamically generated -->
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
    <p>Core terms every rep should know, major components, and how roof systems work.</p>
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
    <h3>Identifying Knockable Doors</h3>
    <p>Target homes in storm-affected areas, HOAs with known patterns, and properties with visible wear.</p>
    <ul>
      <li>Use storm maps and local intel; prioritize recent hail/wind corridors.</li>
      <li>Look for collateral indicators (downspouts, screens, gutters).</li>
      <li>Mind timing, etiquette, safety, and professional approach.</li>
    </ul>
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
    <p>Address hesitations after the inspection: <em>“I need to think about it”</em>, <em>“I’ll call my insurance myself”</em>, and more.</p>
    <ul>
      <li>Use clear recap of findings and next steps</li>
      <li>Offer to handle logistics while keeping homeowner in the loop</li>
      <li>Confirm timeline and set expectations</li>
    </ul>
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
    <p>Common pushbacks when moving from claim filing to the close, with concise responses and next‑step prompts.</p>
    <div class="script" data-text-source="true">
      <button class="speak-btn" aria-label="Listen to script">🔊</button>
      <p><strong>“I need to think about it.”</strong><br>
      Absolutely—totally fair. Would it help if I summarize where we are and what happens next? It’s a simple step: we’ll handle the carrier communication and keep you updated. The only cost to you is the deductible if fully approved.</p>
    </div>
    <div class="script" data-text-source="true">
      <button class="speak-btn" aria-label="Listen to script">🔊</button>
      <p><strong>“I’ll just call my insurance myself.”</strong><br>
      That works too. The benefit of authorizing us is we do the legwork—photos, documentation, and follow‑ups—while keeping you in the loop, so you’re not the middle‑person.</p>
    </div>
    <div class="script" data-text-source="true">
      <button class="speak-btn" aria-label="Listen to script">🔊</button>
      <p><strong>“I’m worried about costs.”</strong><br>
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

// 12. Discontinued Products & Special Scenarios (new)
trainingContent['discontinued-products'] = `
  <div class="content-card">
    <h1>Discontinued Products & Special Scenarios</h1>
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

// 15. Final Exam (new)
trainingContent['final-exam'] = `
  <div class="content-card" id="final-exam">
    <h1>Final Exam / Certification</h1>
    <p>50 questions total: 35 multiple choice, 10 fill‑in‑the‑blank, 5 short answer. Auto‑graded where applicable with retake option.</p>
    <button id="startFinalExam">Start Final Exam</button>
    <div id="exam-area"></div>
  </div>
`;

// Enhance Welcome with leadership profiles and Quick Quiz #1
trainingContent['welcome'] += `
  <hr>
  <h2>STEERING OUR ROOFING REVOLUTION</h2>
  <h3>Leadership Team</h3>
  <div class="profile-cards">
    <div class="profile-card" data-name="Oliver">
      <div class="avatar"><img src="/resources/images/oliver-theroofdocs.jpg" alt="Oliver Brown"></div>
      <div class="info"><strong>Oliver Brown</strong><br><small>Owner & Founder</small></div>
      <button class="bio-btn" data-bio="oliver">My Bio</button>
    </div>
    <div class="profile-card" data-name="Reese">
      <div class="avatar"><img src="/resources/images/reese-theroofdocs.jpg" alt="Reese Samala"></div>
      <div class="info"><strong>Reese Samala</strong><br><small>Director of Sales</small></div>
      <button class="bio-btn" data-bio="reese">My Bio</button>
    </div>
    <div class="profile-card" data-name="Ford">
      <div class="avatar"><img src="/resources/images/ford-theroofdocs.jpg" alt="Ford Barsi"></div>
      <div class="info"><strong>Ford Barsi</strong><br><small>General Manager</small></div>
      <button class="bio-btn" data-bio="ford">My Bio</button>
    </div>
  </div>
  <div class="org-chart">
    <h4>Company Structure</h4>
    <p>Overview chart coming soon. See resources:</p>
    <ul>
      <li><a href="/resources/Roof-ER%20Sales%20Training.pptx" target="_blank">Sales Training (PPTX)</a></li>
      <li><a href="/resources/Training%20Timeline.docx" target="_blank">Training Timeline (DOCX)</a></li>
    </ul>
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


// --- Agnes 21 Role-Play System ---
function initRolePlay() {
  console.log('🎭 Initializing Agnes Role-Play System...');

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
  } = {
    selectedRole: null,
    difficulty: 'beginner',
    scenarios: [],
    currentScenarioIndex: 0,
    currentScenario: null,
    responses: [],
    scores: [],
    hintsUsed: 0,
    startTime: Date.now(),
    recognition: null,
    scenarioStartTime: null
  };

  // Screen management functions
  function showScreen(screenId: string) {
    const screens = ['roleplay-setup', 'scenario-display', 'feedback-area', 'session-summary'];
    screens.forEach(id => {
      const screen = document.getElementById(id);
      if (screen) {
        screen.style.display = (id === screenId) ? 'block' : 'none';
      }
    });
  }

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
      const scoreResult = (window as any).scoreResponse(
        userResponse,
        scenario.expectedKeyPoints || [],
        scenario.rubric?.keywords || [],
        scenario.rubric?.passThreshold || 70
      );

      // Generate AI feedback if available
      let aiFeedback = null;
      if (ai) {
        try {
          aiFeedback = await generateAIFeedback(userResponse, scenario, scoreResult);
        } catch (e) {
          console.warn('AI feedback unavailable:', e);
        }
      }

      sessionState.responses.push({
        scenarioIndex: sessionState.currentScenarioIndex,
        userResponse,
        timestamp: new Date().toISOString()
      });

      sessionState.scores.push({
        ...scoreResult,
        scenarioIndex: sessionState.currentScenarioIndex,
        aiFeedback
      });

      displayFeedback(scoreResult, aiFeedback);

      responseTextarea.disabled = false;
      submitButton.textContent = 'Submit Response';
    } catch (error) {
      console.error('Error submitting response:', error);
      alert('Error processing response. Please try again.');
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

  function showHint() {
    const scenario = sessionState.currentScenario;
    if (!scenario?.followUps || scenario.followUps.length === 0) {
      alert('No hints available for this scenario.');
      return;
    }
    const hint = scenario.followUps[Math.floor(Math.random() * scenario.followUps.length)];
    const hintDisplay = document.getElementById('hint-display');
    if (hintDisplay) {
      hintDisplay.innerHTML = `<strong>💡 Hint:</strong> ${hint}`;
      hintDisplay.style.display = 'block';
      sessionState.hintsUsed++;
      setTimeout(() => { hintDisplay.style.display = 'none'; }, 10000);
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

        try {
          const scenarios = (window as any).getAgnesScenariosByRole(role);
          if (!scenarios || scenarios.length === 0) {
            throw new Error(`No scenarios found for role: ${role}`);
          }
          sessionState.scenarios = scenarios;
          sessionState.currentScenarioIndex = 0;

          setTimeout(() => {
            loadScenario(0);
            showScreen('scenario-display');
          }, 300);
        } catch (error) {
          console.error('Error loading scenarios:', error);
          alert(`Error: ${(error as Error).message}`);
        }
      });
    });
  }

  // Initialize
  try {
    setupRoleSelection();

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

    showRoleSelection();
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

  // Initialize interactive elements for specific modules
  switch (moduleName) {
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
          initRolePlay();
          break;
      case 'welcome':
          initQuickQuiz1();
          initWelcomeModals();
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
  }
}

function handleNavigation(event: Event) {
  const target = event.target as HTMLElement;
  if (target.tagName === 'LI' && target.dataset.module) {
    const moduleName = target.dataset.module;

    // Gate: require commitment signing to proceed beyond core modules
    // DISABLED: Allow access to all modules without commitment signature
    // const requiresCommitment = !['welcome','commitment'].includes(moduleName);
    // const signed = localStorage.getItem(STORAGE_KEYS.commitmentSigned) === 'true';
    // if (requiresCommitment && !signed) {
    //     alert('Please review and digitally sign the commitments before proceeding.');
    //     renderModule('commitment');
    //     sidebar?.querySelectorAll('li').forEach(li => li.classList.remove('active'));
    //     sidebar?.querySelector('li[data-module="commitment"]')?.classList.add('active');
    //     return;
    // }

    sidebar?.querySelectorAll('li').forEach(li => li.classList.remove('active'));
    target.classList.add('active');
    renderModule(moduleName);
  }
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
  if (sidebar) {
    sidebar.addEventListener('click', handleNavigation);
  }
  mainContent?.addEventListener('click', handleSpeak);
  renderModule('welcome');
  document.querySelector('#sidebar li[data-module="welcome"]')?.classList.add('active');
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

function initFinalExam() {
  const start = document.getElementById('startFinalExam');
  const area = document.getElementById('exam-area');
  if (!start || !area) return;
  start.addEventListener('click', async () => {
    if (!ai) {
      area.innerHTML = '<p style="color:red">Final exam generation requires an API key. Set GEMINI_API_KEY in .env.local.</p>';
      return;
    }
    area.innerHTML = '<div id="loader">Preparing your 50‑question exam…</div>';
    try {
      const trainingSummary = Object.values(trainingContent).join(' ');
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Create a final exam for Roof‑ER training with exactly: 35 multiple‑choice (options+answer), 10 fill‑in‑the‑blank (answer string), 5 short‑answer (keywords array for rubric). Return JSON matching the schema.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              multipleChoice: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                answer: { type: Type.STRING }
              }, required: ['question','options','answer'] } },
              fillBlank: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
                question: { type: Type.STRING },
                answer: { type: Type.STRING }
              }, required: ['question','answer'] } },
              shortAnswer: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
                prompt: { type: Type.STRING },
                keywords: { type: Type.ARRAY, items: { type: Type.STRING } }
              }, required: ['prompt','keywords'] } }
            }, required: ['multipleChoice','fillBlank','shortAnswer']
          }
        }
      });
      const exam = JSON.parse(result.text.trim());
      renderFinalExam(area, exam);
    } catch (e) {
      console.error(e);
      area.innerHTML = '<p style="color:red">Failed to generate exam. Please try again.</p>';
    }
  });
}

function renderFinalExam(root: HTMLElement, exam: any) {
  root.innerHTML = '';
  const sections: string[] = [];
  if (Array.isArray(exam.multipleChoice)) sections.push('multipleChoice');
  if (Array.isArray(exam.fillBlank)) sections.push('fillBlank');
  if (Array.isArray(exam.shortAnswer)) sections.push('shortAnswer');
  sections.forEach((sec) => {
    const wrap = document.createElement('div');
    wrap.className = 'exam-section';
    wrap.innerHTML = `<h3>${sec === 'multipleChoice' ? 'Multiple Choice' : sec === 'fillBlank' ? 'Fill in the Blank' : 'Short Answer'}</h3>`;
    const items = exam[sec];
    items.forEach((q: any, idx: number) => {
      const item = document.createElement('div');
      item.className = 'exam-item';
      if (sec === 'multipleChoice') {
        item.innerHTML = `
          <p>${idx + 1}. ${q.question}</p>
          ${q.options.map((opt: string, i: number) => `<label><input type="radio" name="mcq-${idx}" value="${opt}"> ${opt}</label>`).join('')}
        `;
      } else if (sec === 'fillBlank') {
        item.innerHTML = `<p>${idx + 1}. ${q.question}</p><input type="text" name="fib-${idx}" />`;
      } else {
        item.innerHTML = `<p>${idx + 1}. ${q.prompt}</p><textarea name="sa-${idx}" rows="2"></textarea>`;
      }
      wrap.appendChild(item);
    });
    root.appendChild(wrap);
  });
  const submit = document.createElement('button');
  submit.textContent = 'Submit Exam';
  submit.addEventListener('click', () => gradeFinalExam(root, exam));
  root.appendChild(submit);
  root.appendChild(Object.assign(document.createElement('div'), { id: 'examResult' }));
}

function gradeFinalExam(root: HTMLElement, exam: any) {
  let mcqCorrect = 0, mcqTotal = Array.isArray(exam.multipleChoice) ? exam.multipleChoice.length : 0;
  if (exam.multipleChoice) {
    exam.multipleChoice.forEach((q: any, idx: number) => {
      const sel = (root.querySelector(`input[name="mcq-${idx}"]:checked`) as HTMLInputElement)?.value;
      if (sel && sel === q.answer) mcqCorrect++;
    });
  }
  // Fill in the blank: case-insensitive trim compare
  let fibCorrect = 0, fibTotal = Array.isArray(exam.fillBlank) ? exam.fillBlank.length : 0;
  if (exam.fillBlank) {
    exam.fillBlank.forEach((q: any, idx: number) => {
      const val = (root.querySelector(`input[name="fib-${idx}"]`) as HTMLInputElement)?.value?.trim().toLowerCase();
      const ans = String(q.answer || '').trim().toLowerCase();
      if (val && ans && val === ans) fibCorrect++;
    });
  }
  // Short answer: keyword heuristic
  let saScore = 0, saTotal = Array.isArray(exam.shortAnswer) ? exam.shortAnswer.length : 0;
  if (exam.shortAnswer) {
    exam.shortAnswer.forEach((q: any, idx: number) => {
      const text = (root.querySelector(`textarea[name="sa-${idx}"]`) as HTMLTextAreaElement)?.value?.toLowerCase() || '';
      const kws: string[] = Array.isArray(q.keywords) ? q.keywords.map((k: string) => String(k).toLowerCase()) : [];
      const hits = kws.filter(k => text.includes(k)).length;
      saScore += hits / Math.max(kws.length, 1);
    });
  }
  const totalAuto = mcqTotal + fibTotal;
  const autoCorrect = mcqCorrect + fibCorrect;
  const autoPct = totalAuto ? Math.round((autoCorrect / totalAuto) * 100) : 0;
  const saPct = saTotal ? Math.round((saScore / saTotal) * 100) : 0;
  const overall = Math.round((autoPct * 0.8) + (saPct * 0.2));
  const res = root.querySelector('#examResult') as HTMLElement | null;
  if (res) res.textContent = `MCQ: ${mcqCorrect}/${mcqTotal}, FIB: ${fibCorrect}/${fibTotal}, SA Score: ${saPct}%. Overall: ${overall}%.`;
}

function initQuickQuiz1() {
  const startBtn = document.getElementById('startQuickQuiz1');
  const area = document.getElementById('quiz1-area');
  if (!startBtn || !area) return;
  startBtn.addEventListener('click', () => {
    area.innerHTML = `
      <div class="quiz-item">
        <p>1. Roof‑ER’s mission emphasizes which core value set?</p>
        <label><input type="radio" name="qa1" value="a"/> Speed, Secrecy, Sales</label>
        <label><input type="radio" name="qa1" value="b"/> Integrity, Quality, Simplicity</label>
        <label><input type="radio" name="qa1" value="c"/> Price, Pressure, Volume</label>
      </div>
      <div class="quiz-item">
        <p>2. Where can you review the company training materials?</p>
        <label><input type="radio" name="qa2" value="a"/> Only internal email</label>
        <label><input type="radio" name="qa2" value="b"/> The resources linked on this page</label>
        <label><input type="radio" name="qa2" value="c"/> Unverified social posts</label>
      </div>
      <button id="quiz1Submit">Submit</button>
      <div id="quiz1Result"></div>
    `;
    (document.getElementById('quiz1Submit') as HTMLButtonElement)?.addEventListener('click', () => {
      const q1 = (document.querySelector('input[name="qa1"]:checked') as HTMLInputElement)?.value;
      const q2 = (document.querySelector('input[name="qa2"]:checked') as HTMLInputElement)?.value;
      const pass = q1 === 'b' && q2 === 'b';
      const res = document.getElementById('quiz1Result');
      if (res) {
        res.textContent = pass ? 'Pass' : 'Fail';
        res.className = pass ? 'quiz-feedback correct' : 'quiz-feedback incorrect';
      }
    });
  });
}
