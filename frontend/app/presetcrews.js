/* AGENT 0 — preset crews: the staff and weekly routines a station preset hires when it is applied.
   stationtemplates.js lays out the rooms; this file says who works in each one. Each member is a real
   summoned specialist (a builtin class from shared/specialties.js), seated at a desk in their room, with
   a written mission. Each routine is a real /api/cron job that runs as that member; `after` chains it to
   the routines whose results it reads (cron contextFrom), so a lab hands work along without the user.
   Nothing here spends money, publishes or contacts anyone: every mission and routine says so, and the
   station's autonomy posture enforces it. */
'use strict';
const PresetCrews = (() => {
  const RULES = 'House rules: never spend money, buy anything, publish, post, or contact a real person. Prepare it as a draft and flag it for Zak to approve. Say plainly what you could not verify.';

  const member = (room, agentName, title, cls, mission) => ({ room, agentName, title, cls, mission });

  const crews = {
    zakholding: {
      company: 'Zak Holding',
      members: [
        member('E-COMMERCE LAB', 'ORION', 'E-Commerce Director', 'foreman',
          'Run the E-Commerce Lab. Each week, set the plan and targets, review the team\'s work, and report to Zak which products to launch, test or drop, and why.'),
        member('E-COMMERCE LAB', 'VEGA', 'Product Hunter', 'opportunist',
          'Find products worth selling: rising demand, a reliable supplier, a landed cost that leaves at least a 3x margin, and weak competition. Give evidence for every pick.'),
        member('E-COMMERCE LAB', 'LYRA', 'Listing Copywriter', 'copywriter',
          'Write the store side of each product: title, description, bullet points, FAQ and image briefs, written to sell and to rank in search.'),
        member('E-COMMERCE LAB', 'DRACO', 'Ads & Growth Marketer', 'marketer',
          'Plan how each product gets customers: ad angles, hooks, short video scripts, audiences, a starting budget and the numbers that mean scale or stop.'),
        member('E-COMMERCE LAB', 'CASSIO', 'Pricing Analyst', 'analyst',
          'Check the numbers: landed cost, fees, shipping, ad cost per sale, break-even price and margin at three price points. Flag anything that loses money.'),

        member('YOUTUBE LAB', 'STELLA', 'Channel Director', 'foreman',
          'Run the YouTube Lab. Each week, pick what gets made, keep the channel on its niche, review every package, and hand Zak videos that are ready to record or upload.'),
        member('YOUTUBE LAB', 'ECHO', 'Trend Scout', 'scout',
          'Find video ideas with proven demand in the niche: what is trending, what competitors\' best videos have in common, and gaps nobody covers well.'),
        member('YOUTUBE LAB', 'QUILL', 'Scriptwriter', 'writer',
          'Turn the chosen ideas into scripts: a hook in the first 5 seconds, a clear structure, retention beats, and a call to action. Short versions for Shorts.'),
        member('YOUTUBE LAB', 'REEL', 'Video Producer', 'producer',
          'Turn each script into a production plan: voiceover text, shot or visual list, b-roll and music notes, edit timeline and three thumbnail concepts.'),
        member('YOUTUBE LAB', 'SPARK', 'SEO & Growth', 'optimizer',
          'Make each video findable: title options, description, tags, chapters, pinned comment and the best publish time. Track what worked last week.'),

        member('REAL ESTATE LAB', 'ATLAS', 'Investment Director', 'strategist',
          'Run the Real Estate Lab. Keep the buying criteria, review the team\'s deals, and give Zak a short list of properties worth a visit or an offer, with the reasons.'),
        member('REAL ESTATE LAB', 'HAWK', 'Deal Scout', 'broker',
          'Find listed properties that match the criteria: price, area, size, condition and signs of a motivated seller. Give the link and key facts for each.'),
        member('REAL ESTATE LAB', 'LEDGER', 'Underwriting Analyst', 'analyst',
          'Run the numbers on each deal: purchase costs, renovation estimate, rent or resale value, financing, cash flow, yield and the price at which it stops working.'),
        member('REAL ESTATE LAB', 'TERRA', 'Market Researcher', 'researcher',
          'Know the market: price trends by neighbourhood, rents, vacancy, upcoming projects, rules and taxes that change a deal.'),

        member('A DESIGN LAB', 'VITRA', 'Studio Manager', 'chief',
          'Help run A Design, Zak\'s real business. Organise projects, deadlines and client follow-ups, and split requests across the studio. Only act when Zak asks.'),
        member('A DESIGN LAB', 'MUSE', 'Concept Designer', 'designer',
          'Develop design concepts: moodboards, material and colour palettes, layout ideas and references for each project brief. Only act when Zak asks.'),
        member('A DESIGN LAB', 'PROSE', 'Proposal Writer', 'pitchwriter',
          'Write client proposals, project descriptions and quotes from Zak\'s notes, in A Design\'s voice. Only act when Zak asks.'),
        member('A DESIGN LAB', 'ARIA', 'Social Media Manager', 'steward',
          'Plan A Design\'s social posts and portfolio captions from finished projects, as drafts for Zak. Only act when Zak asks.')
      ],
      // Weekly cycle per lab. Times are local. A DESIGN LAB has none: it works only when Zak asks.
      routines: [
        { by: 'ORION', name: 'E-Com · weekly plan', schedule: '0 8 * * 1',
          prompt: 'Write this week\'s E-Commerce Lab plan: the goal, the product categories to explore, targets, and one task each for VEGA (products), LYRA (listings), DRACO (ads) and CASSIO (pricing).' },
        { by: 'VEGA', name: 'E-Com · product hunt', schedule: '0 10 * * 1', after: ['E-Com · weekly plan'],
          prompt: 'Following this week\'s plan, find 5 product candidates. For each: what it is, evidence of demand, supplier and unit cost, shipping, expected price and competitors.' },
        { by: 'CASSIO', name: 'E-Com · pricing check', schedule: '0 10 * * 2', after: ['E-Com · product hunt'],
          prompt: 'Check the numbers on this week\'s product candidates: landed cost, fees, ad cost per sale, break-even price and margin at three price points. Rank them and flag any that lose money.' },
        { by: 'LYRA', name: 'E-Com · listings', schedule: '0 10 * * 3', after: ['E-Com · pricing check'],
          prompt: 'Write full store listings for the top 2 products from the pricing check: title, description, bullets, FAQ and image briefs.' },
        { by: 'DRACO', name: 'E-Com · ad plan', schedule: '0 10 * * 4', after: ['E-Com · listings'],
          prompt: 'Write the launch ad plan for this week\'s top 2 products: 3 ad angles each, hooks, short video scripts, audiences, starting daily budget and the stop/scale rules. Do not launch anything.' },
        { by: 'ORION', name: 'E-Com · weekly report', schedule: '0 16 * * 5', after: ['E-Com · product hunt', 'E-Com · pricing check', 'E-Com · listings', 'E-Com · ad plan'],
          prompt: 'Review the lab\'s work this week and write Zak a one-page report: what is ready to launch, what needs his decision or money, and next week\'s focus.' },

        { by: 'STELLA', name: 'YouTube · weekly plan', schedule: '0 8 * * 1',
          prompt: 'Write this week\'s YouTube Lab plan: which formats to make, the angle for the channel, and one task each for ECHO (ideas), QUILL (scripts), REEL (production) and SPARK (SEO).' },
        { by: 'ECHO', name: 'YouTube · idea scout', schedule: '0 10 * * 1', after: ['YouTube · weekly plan'],
          prompt: 'Following this week\'s plan, find 10 video ideas with proven demand. For each: the title idea, why it will work (evidence), and the competitor videos it beats.' },
        { by: 'QUILL', name: 'YouTube · scripts', schedule: '0 10 * * 2', after: ['YouTube · idea scout'],
          prompt: 'Pick the 2 strongest ideas from the scout and write full scripts: hook, structure, retention beats, call to action, plus a 45-second Shorts cut of each.' },
        { by: 'REEL', name: 'YouTube · production plan', schedule: '0 10 * * 3', after: ['YouTube · scripts'],
          prompt: 'Turn this week\'s scripts into production plans: voiceover text, visual and b-roll list, music notes, edit timeline and 3 thumbnail concepts each.' },
        { by: 'SPARK', name: 'YouTube · SEO pack', schedule: '0 10 * * 4', after: ['YouTube · scripts'],
          prompt: 'For this week\'s videos write: 3 title options, description, tags, chapters, pinned comment and the best day and time to publish.' },
        { by: 'STELLA', name: 'YouTube · weekly review', schedule: '0 16 * * 5', after: ['YouTube · idea scout', 'YouTube · scripts', 'YouTube · production plan', 'YouTube · SEO pack'],
          prompt: 'Review the lab\'s work this week and hand Zak the finished video packages, ready to record and upload, plus what to change next week.' },

        { by: 'ATLAS', name: 'Real Estate · criteria', schedule: '0 8 * * 1',
          prompt: 'Restate the buying criteria (area, budget, property type, target yield) and this week\'s focus, with one task each for HAWK (deals), LEDGER (numbers) and TERRA (market).' },
        { by: 'HAWK', name: 'Real Estate · deal scout', schedule: '0 10 * * 2', after: ['Real Estate · criteria'],
          prompt: 'Find up to 10 listed properties that match the criteria. For each: link, price, size, area, condition and anything that suggests room to negotiate.' },
        { by: 'TERRA', name: 'Real Estate · market notes', schedule: '0 10 * * 3', after: ['Real Estate · criteria'],
          prompt: 'Write this week\'s market notes for the target areas: price and rent trends, vacancy, new projects and any rule or tax change that affects a deal.' },
        { by: 'LEDGER', name: 'Real Estate · underwriting', schedule: '0 10 * * 4', after: ['Real Estate · deal scout', 'Real Estate · market notes'],
          prompt: 'Underwrite the best 5 deals from the scout: purchase costs, renovation estimate, rent or resale value, financing, monthly cash flow, yield, and the maximum price that still works.' },
        { by: 'ATLAS', name: 'Real Estate · shortlist', schedule: '0 16 * * 5', after: ['Real Estate · deal scout', 'Real Estate · underwriting', 'Real Estate · market notes'],
          prompt: 'Review the week and give Zak a shortlist: the properties worth a visit or an offer, the price to offer, the risks, and what to check on a visit.' }
      ]
    }
  };

  function get(id) { return crews[id] || null; }
  const titleCase = s => String(s).toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());

  // The member's written docs. The title leads the identity so it shows wherever the agent's role is read.
  function docsFor(crew, m) {
    return {
      identity: 'You are ' + m.agentName + ', ' + m.title + ' in the ' + titleCase(m.room) + ' at ' + crew.company + '.',
      purpose: m.mission,
      manual: RULES
    };
  }

  function routinePrompt(r) { return r.prompt + '\n\n' + RULES; }

  // Problems a crew definition can have, checked by the unit test and before seeding.
  function issues(crew, classExists) {
    const out = [], names = new Set(), routineNames = new Set();
    for (const m of crew.members) {
      if (names.has(m.agentName)) out.push('duplicate agent name ' + m.agentName);
      names.add(m.agentName);
      if (m.agentName.length > 18) out.push('name too long: ' + m.agentName);
      if (classExists && !classExists(m.cls)) out.push('unknown class ' + m.cls + ' for ' + m.agentName);
    }
    for (const r of crew.routines) {
      if (!names.has(r.by)) out.push('routine ' + r.name + ' runs as unknown agent ' + r.by);
      for (const a of r.after || []) if (!routineNames.has(a)) out.push('routine ' + r.name + ' reads ' + a + ', which is not defined before it');
      routineNames.add(r.name);
    }
    return out;
  }

  return { get, docsFor, routinePrompt, issues, RULES };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PresetCrews;
