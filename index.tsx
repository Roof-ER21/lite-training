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
      <div class="commitment-checklist">
        <h3>As a Roof-ER Sales Representative, I commit to:</h3>
        <ul>
          <li>✓ Complete all 16 training modules with focus and dedication</li>
          <li>✓ Pass the final certification exam with a score of 80% or higher</li>
          <li>✓ Uphold Roof-ER's standards in every customer interaction</li>
          <li>✓ Continuously improve my skills and product knowledge</li>
          <li>✓ Represent the company with professionalism and integrity</li>
          <li>✓ Support my teammates and contribute to our collective success</li>
          <li>✓ Always prioritize what's right for the homeowner over quick sales</li>
        </ul>
      </div>

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
        <p>"Hi! I'm [Name] with Roof-ER. We're working in your neighborhood helping homeowners file insurance claims for storm damage. I noticed [specific damage observation - dented gutter, lifted shingles, etc.]. Mind if I take a quick look from the ground? It'll only take 2 minutes and could save you thousands."</p>

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
                <img src="https://images.unsplash.com/photo-1560185127-1eba5c1099a6?w=500" alt="Hail damage circular bruising">
                <p class="image-caption">Circular bruising and divots from hail impact</p>
              </div>
              <div class="damage-image-item">
                <img src="https://images.unsplash.com/photo-1563804249-e51b63aaf831?w=500" alt="Granule loss from hail">
                <p class="image-caption">Granule loss exposing asphalt mat</p>
              </div>
              <div class="damage-image-item">
                <img src="https://images.unsplash.com/photo-1534237710431-e2fc698436d0?w=500" alt="Hail damage with penny reference">
                <p class="image-caption">Damage with size reference (penny)</p>
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
                <img src="https://images.unsplash.com/photo-1588492069485-d05b56688ea0?w=500" alt="Dented gutter from hail">
                <p class="image-caption">Dented gutters and downspouts</p>
              </div>
              <div class="damage-image-item">
                <img src="https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=500" alt="Damaged AC unit">
                <p class="image-caption">Hail damage on AC unit</p>
              </div>
              <div class="damage-image-item">
                <img src="https://images.unsplash.com/photo-1621905252472-178a03c5f0da?w=500" alt="Siding damage">
                <p class="image-caption">Impact damage on siding</p>
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
              <img src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=500" alt="Test square with chalk marks">
              <p class="image-caption">Circled hail damage in test square</p>
            </div>
            <div class="damage-image-item">
              <img src="https://images.unsplash.com/photo-1581094271901-8022df4466f9?w=500" alt="Measuring test square area">
              <p class="image-caption">10x10 ft test square measurement</p>
            </div>
            <div class="damage-image-item">
              <img src="https://images.unsplash.com/photo-1517581177682-a085bb7ffb15?w=500" alt="Penny size reference">
              <p class="image-caption">Size reference with penny/quarter</p>
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
        <h2>⚠️ Storm Damage vs. Non-Storm Damage</h2>
        <p>It's vital to differentiate between actual storm damage and other roof issues.</p>

        <!-- NEW: Non-Qualifying Damage Card with Images -->
        <div class="damage-types" style="margin-top: 20px;">
          <div class="damage-type" style="border-color: #28a745;">
            <h3 style="color: #28a745;">✅ Storm Damage (Qualifying)</h3>
            <div class="damage-gallery">
              <div class="damage-image-item">
                <img src="https://images.unsplash.com/photo-1517581177682-a085bb7ffb15?w=500" alt="Hail impact bruising">
                <p class="image-caption">Hail: Circular bruises with soft feel</p>
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
                <img src="https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=500" alt="Shingle blistering">
                <p class="image-caption">Blistering: Manufacturing defect</p>
              </div>
              <div class="damage-image-item">
                <img src="https://images.unsplash.com/photo-1565008576549-57569a49371d?w=500" alt="Age-related cracking">
                <p class="image-caption">Cracking: Age-related wear</p>
              </div>
              <div class="damage-image-item">
                <img src="https://images.unsplash.com/photo-1590846083693-f23fdede3a7e?w=500" alt="General granule loss">
                <p class="image-caption">Granule Loss: Normal aging</p>
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
            <h3>Challenge 1: Find the Hail Damage</h3>
            <p class="quiz-instruction">Click on all areas showing circular hail impact damage (3 spots)</p>

            <div class="quiz-image-container">
              <img src="https://images.unsplash.com/photo-1560185127-1eba5c1099a6?w=800" alt="Roof with hail damage"
                   class="clickable-quiz-image"
                   data-hotspots="35,45,8;60,55,8;45,70,8"
                   data-total-spots="3">
              <div class="hotspot-markers"></div>
            </div>

            <div class="quiz-feedback">
              <p class="quiz-score">Found: <span class="found-count">0</span> / <span class="total-count">3</span></p>
              <p class="quiz-hint" style="display: none;">💡 Hint: Look for circular divots with missing granules</p>
              <div class="quiz-actions">
                <button class="btn-hint">Show Hint</button>
                <button class="btn-reset">Try Again</button>
                <button class="btn-next" style="display: none;">Next Challenge →</button>
              </div>
            </div>
          </div>

          <!-- Quiz Question 2: Wind Damage -->
          <div class="hotspot-quiz-question" data-question="2" data-damage-type="wind" style="display: none;">
            <h3>Challenge 2: Spot the Wind Damage</h3>
            <p class="quiz-instruction">Click on areas showing wind damage - lifted, torn, or missing shingles (4 spots)</p>

            <div class="quiz-image-container">
              <img src="/assets/damage/wind/Wind.jpg" alt="Roof with wind damage"
                   class="clickable-quiz-image"
                   data-hotspots="25,40,10;70,35,10;50,60,10;40,75,10"
                   data-total-spots="4">
              <div class="hotspot-markers"></div>
            </div>

            <div class="quiz-feedback">
              <p class="quiz-score">Found: <span class="found-count">0</span> / <span class="total-count">4</span></p>
              <p class="quiz-hint" style="display: none;">💡 Hint: Look for lifted tabs and missing shingle sections</p>
              <div class="quiz-actions">
                <button class="btn-hint">Show Hint</button>
                <button class="btn-reset">Try Again</button>
                <button class="btn-next" style="display: none;">Next Challenge →</button>
              </div>
            </div>
          </div>

          <!-- Quiz Question 3: Storm vs Non-Storm -->
          <div class="hotspot-quiz-question" data-question="3" data-damage-type="mixed" style="display: none;">
            <h3>Challenge 3: Identify ONLY Storm Damage</h3>
            <p class="quiz-instruction">Click ONLY on areas with qualifying storm damage, NOT age-related wear (2 spots)</p>

            <div class="quiz-image-container">
              <img src="https://images.unsplash.com/photo-1517581177682-a085bb7ffb15?w=800" alt="Mixed damage types"
                   class="clickable-quiz-image"
                   data-hotspots="30,50,10;65,45,10"
                   data-total-spots="2">
              <div class="hotspot-markers"></div>
            </div>

            <div class="quiz-feedback">
              <p class="quiz-score">Found: <span class="found-count">0</span> / <span class="total-count">2</span></p>
              <p class="quiz-hint" style="display: none;">💡 Hint: Storm damage = circular impacts, not cracks or general wear</p>
              <div class="quiz-actions">
                <button class="btn-hint">Show Hint</button>
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

        <!-- Screen 1.5: Personality Selection -->
        <div id="personality-selector" style="display: none;">
            <h2>Choose Your Agnes AI Coach</h2>
            <p>Select the AI personality that best matches your training goals. Each personality provides different levels of challenge and feedback styles.</p>

            <div class="personality-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin: 30px 0;">
                <button class="personality-card" data-personality="supportive" data-difficulty="1" style="padding: 25px; border: 3px solid #4caf50; border-radius: 12px; background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); cursor: pointer; text-align: left; transition: all 0.3s;">
                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                        <div style="font-size: 42px; margin-right: 15px;">😊</div>
                        <div>
                            <div style="font-weight: bold; font-size: 18px; color: #2e7d32;">Agnes the Supportive Coach</div>
                            <div style="font-size: 14px; color: #1b5e20; margin-top: 5px;">⭐ Easy - Beginner Friendly</div>
                        </div>
                    </div>
                    <p style="margin: 0; font-size: 14px; color: #555;">Encouraging, patient, and positive. Perfect for building confidence and learning fundamentals.</p>
                </button>

                <button class="personality-card" data-personality="realistic" data-difficulty="2" style="padding: 25px; border: 3px solid #2196f3; border-radius: 12px; background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); cursor: pointer; text-align: left; transition: all 0.3s;">
                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                        <div style="font-size: 42px; margin-right: 15px;">🏠</div>
                        <div>
                            <div style="font-weight: bold; font-size: 18px; color: #1565c0;">Agnes the Real Homeowner</div>
                            <div style="font-size: 14px; color: #0d47a1; margin-top: 5px;">⭐⭐ Medium - Realistic Practice</div>
                        </div>
                    </div>
                    <p style="margin: 0; font-size: 14px; color: #555;">Acts like a typical homeowner with real concerns. Balanced feedback and moderate objections.</p>
                </button>

                <button class="personality-card" data-personality="skeptical" data-difficulty="3" style="padding: 25px; border: 3px solid #ff9800; border-radius: 12px; background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); cursor: pointer; text-align: left; transition: all 0.3s;">
                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                        <div style="font-size: 42px; margin-right: 15px;">🤔</div>
                        <div>
                            <div style="font-weight: bold; font-size: 18px; color: #e65100;">Agnes the Skeptical Buyer</div>
                            <div style="font-size: 14px; color: #bf360c; margin-top: 5px;">⭐⭐⭐ Hard - Advanced Practice</div>
                        </div>
                    </div>
                    <p style="margin: 0; font-size: 14px; color: #555;">Questioning, doubtful, and requires strong persuasion. Pushes you to refine your techniques.</p>
                </button>

                <button class="personality-card" data-personality="rushed" data-difficulty="4" style="padding: 25px; border: 3px solid #f44336; border-radius: 12px; background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%); cursor: pointer; text-align: left; transition: all 0.3s;">
                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                        <div style="font-size: 42px; margin-right: 15px;">⏰</div>
                        <div>
                            <div style="font-weight: bold; font-size: 18px; color: #c62828;">Agnes the Rushed Decision-Maker</div>
                            <div style="font-size: 14px; color: #b71c1c; margin-top: 5px;">⭐⭐⭐⭐ Expert - High Pressure</div>
                        </div>
                    </div>
                    <p style="margin: 0; font-size: 14px; color: #555;">Impatient, time-sensitive, and easily distracted. Tests your ability to handle pressure and be concise.</p>
                </button>

                <button class="personality-card" data-personality="final-boss" data-difficulty="5" style="padding: 25px; border: 3px solid #9c27b0; border-radius: 12px; background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%); cursor: pointer; text-align: left; transition: all 0.3s;">
                    <div style="display: flex; align-items: center; margin-bottom: 15px;">
                        <div style="font-size: 42px; margin-right: 15px;">👑</div>
                        <div>
                            <div style="font-weight: bold; font-size: 18px; color: #6a1b9a;">Agnes the Final Boss</div>
                            <div style="font-size: 14px; color: #4a148c; margin-top: 5px;">⭐⭐⭐⭐⭐ Master - Ultimate Challenge</div>
                        </div>
                    </div>
                    <p style="margin: 0; font-size: 14px; color: #555;">Combines all objection types with rapid-fire challenges. Only for certified experts ready to prove mastery.</p>
                </button>
            </div>

            <button id="back-to-roles" style="padding: 12px 24px; background: #f5f5f5; color: #666; border: 2px solid #ddd; border-radius: 5px; font-size: 14px; cursor: pointer; margin-top: 10px;">← Back to Role Selection</button>
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

                    <!-- Conversation Thread Container -->
                    <div style="margin-bottom: 20px;">
                        <h4 style="color: #8b4fbe; margin-bottom: 10px;">Conversation:</h4>
                        <div id="conversation-thread" style="max-height: 400px; overflow-y: auto; background: white; border: 2px solid #e0d4f0; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                            <!-- Conversation messages will be dynamically inserted here -->
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label for="user-response" style="display: block; font-weight: 500; margin-bottom: 10px;">Your Response:</label>
                        <textarea id="user-response" rows="4" style="width: 100%; padding: 15px; border: 2px solid #e0d4f0; border-radius: 5px; font-size: 16px; font-family: inherit;" placeholder="Type your response here..."></textarea>
                    </div>

                    <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                        <button id="submit-response" style="flex: 1; padding: 15px 30px; background: #8b4fbe; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: 500; cursor: pointer;">Submit Response</button>
                        <button id="voice-input-btn" style="padding: 15px 30px; background: #f8f4fc; color: #8b4fbe; border: 2px solid #8b4fbe; border-radius: 5px; font-size: 16px; cursor: pointer;">🎤 Voice Input</button>
                        <button id="hint-btn" style="padding: 15px 30px; background: #f8f4fc; color: #8b4fbe; border: 2px solid #8b4fbe; border-radius: 5px; font-size: 16px; cursor: pointer;">💡 Hint</button>
                    </div>

                    <div id="hint-display" style="display: none; background: #fff9e6; border-left: 4px solid #ffc107; padding: 15px; margin-bottom: 20px; border-radius: 5px;"></div>
                </div>

                <!-- Live Feedback Panel -->
                <div id="live-feedback-panel" class="live-feedback-panel">
                    <div class="panel-header">
                        <h3>Live Feedback</h3>
                        <button class="panel-toggle-btn" id="toggle-feedback-panel" aria-label="Toggle feedback panel">−</button>
                    </div>

                    <div class="panel-content">
                        <div class="live-score-display">
                            <div id="live-score-circle" class="live-score-circle score-low">0</div>
                            <div class="score-label">Current Score</div>
                        </div>

                        <div class="key-points-live">
                            <h4>📋 Key Points</h4>
                            <ul id="live-key-points" class="points-list">
                                <!-- Dynamically populated -->
                            </ul>
                        </div>

                        <div class="tone-indicator">
                            <h4>💬 Tone</h4>
                            <div class="tone-bar-container">
                                <div id="tone-bar" class="tone-bar neutral" style="width: 100%;">Neutral</div>
                            </div>
                        </div>

                        <div class="confidence-meter">
                            <h4>🎯 Confidence Level</h4>
                            <div class="confidence-bar-container">
                                <div id="confidence-bar" class="confidence-bar" style="width: 0%;" data-confidence="0"></div>
                            </div>
                        </div>

                        <div class="word-count-indicator">
                            <div>Word Count: <strong id="live-word-count">0</strong></div>
                            <div style="font-size: 0.75rem; margin-top: 5px; color: #999;">Recommended: 50-150 words</div>
                        </div>
                    </div>
                </div>
            </div>
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
    <h1>Final Exam / Certification</h1>

    <h2>Certification Requirements</h2>
    <div class="cert-requirements">
      <h3>To Earn Your Roof-ER Certification:</h3>
      <ol>
        <li>✓ Complete all 16 training modules</li>
        <li>✓ Watch all 5 training videos to 90% completion</li>
        <li>✓ Complete at least 3 Agnes role-play scenarios</li>
        <li>✓ Pass this final exam with 80% or higher</li>
      </ol>

      <h3>Final Exam Format:</h3>
      <ul>
        <li><strong>Questions:</strong> 50 multiple-choice and scenario-based</li>
        <li><strong>Time Limit:</strong> 60 minutes (untimed practice mode available)</li>
        <li><strong>Topics Covered:</strong> All 16 modules</li>
        <li><strong>Passing Score:</strong> 80% (40/50 correct)</li>
        <li><strong>Retakes:</strong> Unlimited attempts</li>
      </ul>

      <h3>After Passing:</h3>
      <ul>
        <li>🏆 Digital certificate emailed to you</li>
        <li>📋 Added to Roof-ER certified sales team</li>
        <li>💼 Ready for field assignments</li>
        <li>📚 Ongoing training & support</li>
      </ul>
    </div>

    <div class="exam-tips">
      <h3>Exam Tips:</h3>
      <ul>
        <li>Review module summaries before starting</li>
        <li>Focus on scripts, objection handling, and technical terminology</li>
        <li>Take practice mode first to identify weak areas</li>
        <li>Use your notes - open book in practice mode</li>
      </ul>
    </div>

    <h2>Exam Topic Breakdown</h2>
    <ul>
      <li><strong>Door Knocking & Initial Pitch (10 questions):</strong> Opening scripts, objection handling, appointment setting</li>
      <li><strong>Inspection & Documentation (12 questions):</strong> Damage identification, photo techniques, test squares</li>
      <li><strong>Post-Inspection Pitch (8 questions):</strong> Evidence presentation, urgency creation, objection responses</li>
      <li><strong>Filing & Closing (10 questions):</strong> Claim filing process, contingency agreement, authorization forms</li>
      <li><strong>Special Scenarios (5 questions):</strong> Discontinued products, matching law, code compliance</li>
      <li><strong>Sales Cycle & Job Flow (5 questions):</strong> Timeline, milestones, team coordination</li>
    </ul>

    <p>50 questions total: 35 multiple choice, 10 fill‑in‑the‑blank, 5 short answer. Auto‑graded where applicable with retake option.</p>
    <button id="startFinalExam">Start Final Exam</button>
    <div id="exam-area"></div>
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

  // Quiz state management
  const quizState = {
    currentQuestion: 1,
    totalQuestions: 3,
    foundHotspots: new Set(),
    totalScore: 0,
    totalPossible: 9
  };

  // Initialize all quiz images
  const quizImages = document.querySelectorAll('.clickable-quiz-image');
  quizImages.forEach(img => {
    img.addEventListener('click', (e) => handleHotspotClick(e, img));
    img.style.cursor = 'crosshair';
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
  const markersContainer = question.querySelector('.hotspot-markers');

  if (!hotspotsData) return;

  // Parse hotspots: "x,y,radius;x,y,radius;..."
  const hotspots = hotspotsData.split(';').map(spot => {
    const [x, y, radius] = spot.split(',').map(Number);
    return { x, y, radius };
  });

  // Check if click is within any hotspot
  let hitHotspot = null;
  let hotspotIndex = -1;

  for (let i = 0; i < hotspots.length; i++) {
    const hotspot = hotspots[i];
    const distance = calculateDistance(clickX, clickY, hotspot.x, hotspot.y);

    if (distance <= hotspot.radius) {
      hitHotspot = hotspot;
      hotspotIndex = i;
      break;
    }
  }

  // Create hotspot identifier
  const hotspotId = `q${questionNum}-spot${hotspotIndex}`;

  // Check if this specific hotspot was already found
  const foundCount = parseInt(question.querySelector('.found-count').textContent);

  if (hitHotspot && !question.querySelector(`[data-hotspot-id="${hotspotId}"]`)) {
    // Correct hit - add green checkmark
    const marker = document.createElement('div');
    marker.className = 'hotspot-marker correct';
    marker.setAttribute('data-hotspot-id', hotspotId);
    marker.style.position = 'absolute';
    marker.style.left = `${clickX}%`;
    marker.style.top = `${clickY}%`;
    marker.style.transform = 'translate(-50%, -50%)';
    marker.style.color = '#4caf50';
    marker.style.fontSize = '24px';
    marker.style.fontWeight = 'bold';
    marker.style.textShadow = '0 0 3px white, 0 0 5px white';
    marker.innerHTML = '✓';
    markersContainer.appendChild(marker);

    // Update score
    const newFoundCount = foundCount + 1;
    question.querySelector('.found-count').textContent = newFoundCount;

    // Check if all spots found
    if (newFoundCount >= totalSpots) {
      question.querySelector('.btn-next, .btn-complete').style.display = 'inline-block';
      setTimeout(() => {
        alert(`🎉 Excellent! You found all ${totalSpots} damage spots!`);
      }, 300);
    }
  } else if (hitHotspot && question.querySelector(`[data-hotspot-id="${hotspotId}"]`)) {
    // Already found this spot
    const marker = document.createElement('div');
    marker.className = 'hotspot-marker duplicate';
    marker.style.position = 'absolute';
    marker.style.left = `${clickX}%`;
    marker.style.top = `${clickY}%`;
    marker.style.transform = 'translate(-50%, -50%)';
    marker.style.color = '#ff9800';
    marker.style.fontSize = '18px';
    marker.style.opacity = '0.7';
    marker.innerHTML = '⟳';
    markersContainer.appendChild(marker);

    // Fade out and remove after 1 second
    setTimeout(() => marker.remove(), 1000);
  } else {
    // Incorrect - add red X
    const marker = document.createElement('div');
    marker.className = 'hotspot-marker incorrect';
    marker.style.position = 'absolute';
    marker.style.left = `${clickX}%`;
    marker.style.top = `${clickY}%`;
    marker.style.transform = 'translate(-50%, -50%)';
    marker.style.color = '#f44336';
    marker.style.fontSize = '20px';
    marker.style.textShadow = '0 0 3px white, 0 0 5px white';
    marker.innerHTML = '✗';
    markersContainer.appendChild(marker);

    // Fade out and remove after 1.5 seconds
    setTimeout(() => marker.remove(), 1500);
  }
}

// Calculate distance between two points
function calculateDistance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
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
  const markersContainer = questionElement.querySelector('.hotspot-markers');
  const foundCountElement = questionElement.querySelector('.found-count');
  const hintElement = questionElement.querySelector('.quiz-hint');
  const nextButton = questionElement.querySelector('.btn-next, .btn-complete');

  // Clear all markers
  if (markersContainer) markersContainer.innerHTML = '';

  // Reset found count
  if (foundCountElement) foundCountElement.textContent = '0';

  // Hide hint
  if (hintElement) hintElement.style.display = 'none';

  // Hide next button
  if (nextButton) nextButton.style.display = 'none';
}

// Complete quiz
function completeQuiz(quizState) {
  // Calculate final score
  let totalFound = 0;
  const questions = document.querySelectorAll('.hotspot-quiz-question');

  questions.forEach(q => {
    const foundCount = parseInt(q.querySelector('.found-count').textContent);
    totalFound += foundCount;
  });

  quizState.totalScore = totalFound;

  // Hide all questions
  questions.forEach(q => q.style.display = 'none');

  // Show completion message
  const completeMessage = document.getElementById('quiz-complete-message');
  const finalScoreElement = document.getElementById('final-score');
  const totalPossibleElement = document.getElementById('total-possible');

  if (finalScoreElement) finalScoreElement.textContent = totalFound;
  if (totalPossibleElement) totalPossibleElement.textContent = quizState.totalPossible;

  if (completeMessage) {
    completeMessage.style.display = 'block';
    completeMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Add performance feedback
  const percentage = (totalFound / quizState.totalPossible) * 100;
  let feedback = '';

  if (percentage === 100) {
    feedback = '🏆 Perfect score! You have an excellent eye for damage identification!';
  } else if (percentage >= 80) {
    feedback = '🌟 Great job! You identified most of the damage accurately!';
  } else if (percentage >= 60) {
    feedback = '👍 Good effort! Review the images again to improve your damage recognition skills.';
  } else {
    feedback = '📚 Keep practicing! Review the damage type descriptions and try again.';
  }

  const successBanner = completeMessage?.querySelector('.success-banner');
  if (successBanner && !successBanner.querySelector('.performance-feedback')) {
    const feedbackP = document.createElement('p');
    feedbackP.className = 'performance-feedback';
    feedbackP.style.marginTop = '15px';
    feedbackP.style.fontSize = '16px';
    feedbackP.textContent = feedback;
    successBanner.appendChild(feedbackP);
  }
}

// Restart quiz
function restartQuiz(quizState) {
  // Reset state
  quizState.currentQuestion = 1;
  quizState.foundHotspots.clear();
  quizState.totalScore = 0;

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
    selectedPersonality: null,
    difficulty: 'beginner',
    scenarios: [],
    currentScenarioIndex: 0,
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

  // Screen management functions
  function showScreen(screenId: string) {
    const screens = ['roleplay-setup', 'personality-selector', 'scenario-display', 'feedback-area', 'session-summary'];
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
        // Final scoring and feedback
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
          const scenarios = (window as any).getAgnesScenariosByRole(sessionState.selectedRole);
          if (!scenarios || scenarios.length === 0) {
            throw new Error(`No scenarios found for role: ${sessionState.selectedRole}`);
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
