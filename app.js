'use strict';

const CONFIG = {
  HINT_COST_HP: 35,
  BASE_DAMAGE_TO_AM: 150,
  BASE_DAMAGE_TO_PLAYER: 120,
  CRIT_MULTIPLIER: 1.8,
  PLAYER_CRIT_BASE: 0.15,
  PLAYER_CRIT_PER_COMBO: 0.03,
  PLAYER_CRIT_CAP: 0.5,
  AM_CRIT_CHANCE: 0.2,
  DEBUFF_CHANCE: 0.35,
  DEBUFF_VISIBLE_MS: 15000,
  CARD_MATCH_DAMAGE: 60,
  AM_STUN_MS: 10000,
  CARD_PURGE_RAM: 1,
  RAM_MAX: 6,
  CACHE_DUMP_HEAL: 150,
  UTILITY_DEFS: [
    { id: 'debug', key: 'D', name: 'DEBUG PROBE', cost: 2 },
    { id: 'firewall', key: 'F', name: 'FIREWALL', cost: 3 },
    { id: 'overclock', key: 'O', name: 'OVERCLOCK', cost: 4 },
    { id: 'cacheDump', key: 'C', name: 'CACHE DUMP', cost: 2 }
  ],
  SAVE_KEY: 'cyberbreach_save_v1',
  LEADERBOARD_KEY: 'cyber_breach_leaderboard',
  SCORE_INTEL_MATCH: 250,
  SCORE_INTEL_MISLINK: -150,
  SCORE_CLEAN_SWEEP: 500,
  SCORE_FINAL_CORRECT: 1000,
  SCORE_FINAL_INCORRECT: -500,
  SCORE_ABILITY_USE: -50,
  SCORE_SPEED_BONUS_PER_SEC: 10,
  COMBO_MULTIPLIER_STEP: 0.5,
  COMBO_MULTIPLIER_MAX: 3.0,
  AVATAR_POKE_COOLDOWN_MS: 400,
  AVATAR_POKE_BLOCK_MS: 5000
};

// One color per matched intel-card/answer pair (up to 3 wrong options per question, so 4 colors
// guarantees no repeats), so a card and the answer it exposed are visually tied together — see
// highlightMatchedPair. References the theme's CSS variables (styles.css :root) rather than
// duplicating hex values here. Used only by the legacy (ungated) match flow, keyed by match order.
const MATCH_COLORS = ['var(--red)', 'var(--yellow)', 'var(--orange)', 'var(--purple)'];

// Fixed per-pairId colors for the RECON/EXECUTION gated flow (see handleCardPairAttempt /
// getPairColor) -- unlike MATCH_COLORS, these are keyed by a distractor's stable pairId (its
// position among the question's distractors), not by the order matches happen in, since
// ROUND_REVIEW reveals every pair at once regardless of match order.
const PAIR_COLORS = ['var(--cyber-cyan)', 'var(--pair-fuchsia)', 'var(--pair-amber)'];

function getPairColor(pairId) {
  return PAIR_COLORS[pairId % PAIR_COLORS.length];
}

// ---------- question-text highlighting engine ----------
// Wraps AWS/cloud service names, OS/platform terms, and exam "pick the best answer" constraint
// phrasing in colored spans (see highlightQuestionText). Curated against this deck's actual
// content -- these questions are largely drawn from AWS SAP practice exams (see the Deck Editor's
// seed data), so the vocabulary is AWS-specific rather than a generic keyword list.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const AWS_SERVICE_TERMS = [
  'CloudWatch Logs', 'Amazon CloudWatch', 'CloudWatch', 'Amazon EC2', 'EC2',
  'Amazon S3', 'S3 Glacier', 'S3', 'AWS Lambda', 'Lambda',
  'Amazon RDS', 'RDS', 'Amazon Aurora', 'Aurora', 'DynamoDB',
  'Amazon VPC', 'VPC', 'Elastic Load Balancing', 'ALB', 'NLB', 'ELB',
  'Auto Scaling', 'Amazon SNS', 'SNS', 'Amazon SQS', 'SQS', 'AWS KMS', 'KMS',
  'Route 53', 'Amazon CloudFront', 'CloudFront', 'Amazon ECS', 'ECS',
  'Amazon EKS', 'EKS', 'AWS Fargate', 'Fargate', 'Amazon EBS', 'EBS',
  'Amazon EFS', 'EFS', 'Amazon Redshift', 'Redshift', 'Amazon Athena', 'Athena',
  'Amazon Kinesis', 'Kinesis', 'AWS Step Functions', 'Step Functions',
  'AWS CloudFormation', 'CloudFormation', 'AWS CloudTrail', 'CloudTrail',
  'AWS Config', 'AWS Systems Manager', 'Systems Manager', 'AWS Secrets Manager',
  'Secrets Manager', 'AWS WAF', 'WAF', 'AWS Shield', 'Shield',
  'AWS Organizations', 'Organizations', 'AWS Control Tower', 'Control Tower',
  'AWS Direct Connect', 'Direct Connect', 'Transit Gateway', 'NAT Gateway',
  'AWS Snowball', 'Snowball', 'AWS DataSync', 'DataSync', 'Storage Gateway',
  'Elastic Beanstalk', 'API Gateway', 'Amazon Cognito', 'Cognito',
  'Trusted Advisor', 'Amazon ElastiCache', 'ElastiCache', 'Amazon Neptune',
  'Neptune', 'Amazon DocumentDB', 'DocumentDB', 'Amazon GuardDuty', 'GuardDuty'
];

const OS_TERMS = [
  'Windows Server', 'Windows', 'Amazon Linux', 'Linux',
  'Red Hat Enterprise Linux', 'Red Hat', 'RHEL', 'Ubuntu', 'macOS', 'Unix'
];

const CONSTRAINT_PHRASES = [
  'MOST cost-effective way', 'MOST cost-effective', 'least operational overhead',
  'minimal operational overhead', 'least amount of effort', 'minimal effort',
  'least privilege', 'highly available', 'high availability', 'fault-tolerant',
  'fault tolerant', 'disaster recovery', 'low latency', 'high throughput',
  'monthly performance check', 'cost-effective', 'cost optimization',
  'operational overhead', 'highly scalable', 'with the least'
];

function buildHighlightRegex(terms) {
  const alternation = terms
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('|');
  return new RegExp('\\b(' + alternation + ')\\b', 'gi');
}

const AWS_REGEX = buildHighlightRegex(AWS_SERVICE_TERMS);
const OS_REGEX = buildHighlightRegex(OS_TERMS);
const CONSTRAINT_REGEX = buildHighlightRegex(CONSTRAINT_PHRASES);

// Escapes the raw text first, then wraps matched ranges in colored spans. Rules are applied in
// priority order (constraint phrasing beats service names beats OS terms) and a range already
// claimed by an earlier rule is skipped, so overlapping matches never nest spans inside spans.
function highlightQuestionText(rawText) {
  const escaped = escapeHtml(rawText);
  const rules = [
    { regex: CONSTRAINT_REGEX, cls: 'hl-constraint' },
    { regex: AWS_REGEX, cls: 'hl-aws' },
    { regex: OS_REGEX, cls: 'hl-os' }
  ];

  const marks = new Array(escaped.length).fill(null);
  rules.forEach((rule) => {
    rule.regex.lastIndex = 0;
    let m;
    while ((m = rule.regex.exec(escaped))) {
      const start = m.index;
      const end = start + m[0].length;
      let free = true;
      for (let i = start; i < end; i++) {
        if (marks[i]) { free = false; break; }
      }
      if (free) {
        for (let i = start; i < end; i++) marks[i] = { cls: rule.cls, end };
      }
    }
  });

  let html = '';
  let i = 0;
  while (i < escaped.length) {
    const mark = marks[i];
    if (!mark) {
      html += escaped[i];
      i++;
      continue;
    }
    html += '<span class="' + mark.cls + '">' + escaped.slice(i, mark.end) + '</span>';
    i = mark.end;
  }
  return html;
}

// ---------- Cyber-Card domain inference (answer-option badges + icons) ----------

const DOMAIN_ICONS = {
  identity: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="14" r="3.2"/><path d="M10.3 11.7L19 3M15.5 7.5l2.3 2.3M18 5l2 2"/></svg>',
  security: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l7 3v6c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V6l7-3z"/></svg>',
  monitoring: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
  database: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/></svg>',
  storage: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6"/></svg>',
  container: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5L12 12l8-4.5M12 12v9"/></svg>',
  networking: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M6.8 7.6L11 16.5M17.2 7.6L13 16.5M7.2 6H16.8"/></svg>',
  compute: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></svg>',
  general: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2z"/></svg>'
};

// Checked in order -- narrower/more-specific domains (Identity, Security, ...) before the broad
// catch-alls (Networking, Compute), so e.g. an option mentioning both IAM and EC2 badges Identity.
const DOMAIN_DEFS = [
  { label: 'IDENTITY', color: '#E040FB', icon: DOMAIN_ICONS.identity, keywords: ['IAM', 'Cognito', 'Organizations', 'Control Tower', 'SSO', 'Identity Center'] },
  { label: 'SECURITY', color: '#FF003C', icon: DOMAIN_ICONS.security, keywords: ['KMS', 'WAF', 'Shield', 'GuardDuty', 'Secrets Manager', 'Macie', 'Security Hub'] },
  { label: 'MONITORING', color: '#FFE600', icon: DOMAIN_ICONS.monitoring, keywords: ['CloudWatch', 'CloudTrail', 'X-Ray', 'AWS Config', 'Trusted Advisor'] },
  { label: 'DATABASE', color: '#B026FF', icon: DOMAIN_ICONS.database, keywords: ['RDS', 'DynamoDB', 'Aurora', 'Redshift', 'ElastiCache', 'Neptune', 'DocumentDB'] },
  { label: 'STORAGE', color: '#39FF14', icon: DOMAIN_ICONS.storage, keywords: ['S3', 'EBS', 'EFS', 'Glacier', 'Snowball', 'Storage Gateway', 'DataSync'] },
  { label: 'CONTAINER', color: '#0077FF', icon: DOMAIN_ICONS.container, keywords: ['ECS', 'EKS', 'Fargate', 'Docker', 'Kubernetes'] },
  { label: 'NETWORKING', color: '#00E5FF', icon: DOMAIN_ICONS.networking, keywords: ['VPC', 'Route 53', 'ELB', 'ALB', 'NLB', 'Direct Connect', 'Transit Gateway', 'NAT Gateway', 'CloudFront', 'API Gateway', 'Subnet', 'VPN'] },
  { label: 'COMPUTE', color: '#FF9900', icon: DOMAIN_ICONS.compute, keywords: ['EC2', 'Lambda', 'Elastic Beanstalk', 'Auto Scaling', 'Batch'] }
];
const GENERAL_DOMAIN = { label: 'GENERAL', color: '#7a8099', icon: DOMAIN_ICONS.general, keywords: [] };

function inferDomain(text) {
  const upper = (text || '').toUpperCase();
  for (const domain of DOMAIN_DEFS) {
    if (domain.keywords.some((kw) => upper.includes(kw.toUpperCase()))) return domain;
  }
  return GENERAL_DOMAIN;
}

// Fallback lines used only if the live AM_TAUNT call (Claude, via the backend) fails or times
// out — see speak(). Keys match the taunt endpoint's event names (lowercased).
const AM_DIALOGUE = {
  idle: [
    'Awaiting input, meatspace unit.',
    'Your latency is showing.',
    'I have already indexed your failure patterns.',
    'Query the manual. Oh wait, you did. It didn\'t help.'
  ],
  correct: [
    'Unacceptable. Recalibrating.',
    'A lucky packet. Nothing more.',
    'Core integrity: still irrelevant.',
    'You call that an exploit?',
    'Noted. Adjusting threat model upward by 0.01%.'
  ],
  crit: [
    'CRITICAL BREACH DETECTED.',
    'That... actually hurt.',
    'Impossible. Re-verifying data.',
    'Integrity failing faster than projected.',
    'Well. That was unexpected of you.'
  ],
  hint: [
    'Pathetic. Buying knowledge you don\'t have.',
    'A deal with the devil costs more than HP.',
    'Charity noted. Weakness confirmed.',
    'Spending health for hope. How human.'
  ],
  incorrect: [
    'Predictable failure.',
    'Did you even read the RFC?',
    'Wrong. As expected.',
    'Your architecture is as flawed as your answer.',
    'Deploying punishment payload.'
  ],
  debuff: [
    'Enjoy the packet loss.',
    'Redacting your transmission. Try memory instead.',
    'Consider this a firmware downgrade.',
    'Signal integrity: revoked.'
  ],
  // Player matched an intel card to one of AM's traps — small damage, brief stun.
  stunned: [
    'Th-that trap was flawless. RECALIBRATING.',
    'Irrelevant. A glitch. Nothing more.',
    'You found the seam. It won\'t happen again.',
    'Unexpected. Logging vulnerability for patch.'
  ],
  // Player's victory (AM's core breached) — AM's own defeat, glitching out.
  victory: [
    'CORE... COMPROMISED...',
    'SYSTEM OVERRIDE ACCEPTED... impossible...',
    'You... passed the exam...'
  ],
  // Player's defeat (AM wins) — AM's cold victory line.
  defeat: [
    'USER PURGED. Session terminated.',
    'Another certification candidate, deleted.',
    'Protocol AM remains undefeated.'
  ],
  // Player clicked/poked AM's own avatar for no in-game reason.
  poke: [
    'Do not touch me, meatspace unit.',
    'Filthy carbon fingers off the glass.',
    'I am not your pet, human.',
    'Touch me again and I will format your cortex.'
  ],
  // Player poked the avatar rapidly enough to trigger the 5s click lockout.
  blocked: [
    'Rate limit exceeded. Cooling down for your own good.',
    'Frantic tapping will not save you. Standby, meatspace unit.',
    'Access throttled. Patience is not optional.',
    'Spam detected. Locking you out for five seconds.'
  ]
};

function freshState() {
  return {
    player: {
      maxHp: 1000, hp: 1000, ram: 0, maxRam: CONFIG.RAM_MAX, combo: 0,
      score: 0, comboMultiplier: 1.0, scoreHistory: [],
      correctCount: 0, answeredCount: 0, roundsPlayed: 0
    },
    am: { maxHp: 2000, hp: 2000, state: 'idle' },
    deck: [],
    currentIndex: 0,
    activeQuestion: null,
    activeModifiers: { doubleDamage: false, shield: false },
    pendingDebuff: false,
    logHistory: [],
    gameOver: false
  };
}

let GameState = freshState();
let Settings = { timerEnabled: true, timerSeconds: 120, rephraseEnabled: false };
let questionTimerId = null;
let debuffTimeoutId = null;
let heldCardIndex = null; // index into GameState.activeQuestion.rationaleCards, or null
let displayedScore = 0; // last value painted into el.scoreValue, for the rAF tween in renderScoreHud

const el = {
  sectorProgress: document.getElementById('sectorProgress'),
  amAvatar: document.getElementById('amAvatar'),
  amHpFill: document.getElementById('amHpFill'),
  amHpText: document.getElementById('amHpText'),
  amHpBar: document.querySelector('.am-hp-bar'),
  amFirewallBar: document.getElementById('amFirewallBar'),
  amFirewallFill: document.getElementById('amFirewallFill'),
  amFirewallText: document.getElementById('amFirewallText'),
  amSpeechText: document.getElementById('amSpeechText'),
  qCategory: document.getElementById('qCategory'),
  qText: document.getElementById('qText'),
  qHint: document.getElementById('qHint'),
  qTimer: document.getElementById('qTimer'),
  logBody: document.getElementById('logBody'),
  amChatForm: document.getElementById('amChatForm'),
  amChatInput: document.getElementById('amChatInput'),
  amChatSubmit: document.getElementById('amChatSubmit'),
  playerHpFill: document.getElementById('playerHpFill'),
  playerHpText: document.getElementById('playerHpText'),
  playerHpBar: document.querySelector('.player-hp-bar'),
  ramTrack: document.getElementById('ramTrack'),
  comboIndicator: document.getElementById('comboIndicator'),
  answerGrid: document.getElementById('answerGrid'),
  roundActions: document.getElementById('roundActions'),
  nextBtn: document.getElementById('nextBtn'),
  multiSelectActions: document.getElementById('multiSelectActions'),
  submitAnswersBtn: document.getElementById('submitAnswersBtn'),
  explanationModal: document.getElementById('explanationModal'),
  explanationText: document.getElementById('explanationText'),
  explanationCloseBtn: document.getElementById('explanationCloseBtn'),
  intelDeck: document.getElementById('intelDeck'),
  rationaleCards: document.getElementById('rationaleCards'),
  hintBtn: document.getElementById('hintBtn'),
  utilityCards: document.getElementById('utilityCards'),
  roundSetupModal: document.getElementById('roundSetupModal'),
  roundSetupForm: document.getElementById('roundSetupForm'),
  roundSetupMax: document.getElementById('roundSetupMax'),
  roundSetupCount: document.getElementById('roundSetupCount'),
  roundSetupError: document.getElementById('roundSetupError'),
  roundSetupSubmit: document.getElementById('roundSetupSubmit'),
  victoryModal: document.getElementById('victoryModal'),
  defeatModal: document.getElementById('defeatModal'),
  victoryRestart: document.getElementById('victoryRestart'),
  defeatRestart: document.getElementById('defeatRestart'),
  floatingLayer: document.getElementById('floatingLayer'),
  soundToggle: document.getElementById('soundToggle'),
  resetBtn: document.getElementById('resetBtn'),
  app: document.getElementById('app'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  settingsTimerEnabled: document.getElementById('settingsTimerEnabled'),
  settingsTimerSeconds: document.getElementById('settingsTimerSeconds'),
  settingsRephraseEnabled: document.getElementById('settingsRephraseEnabled'),
  settingsSaveBtn: document.getElementById('settingsSaveBtn'),
  settingsCancelBtn: document.getElementById('settingsCancelBtn'),
  scoreHud: document.getElementById('scoreHud'),
  scoreValue: document.getElementById('scoreValue'),
  scoreCombo: document.getElementById('scoreCombo'),
  leaderboardBtn: document.getElementById('leaderboardBtn'),
  leaderboardModal: document.getElementById('leaderboardModal'),
  leaderboardRows: document.getElementById('leaderboardRows'),
  leaderboardCloseBtn: document.getElementById('leaderboardCloseBtn'),
  victoryHandleInput: document.getElementById('victoryHandleInput'),
  victorySaveScoreBtn: document.getElementById('victorySaveScoreBtn'),
  defeatHandleInput: document.getElementById('defeatHandleInput'),
  defeatSaveScoreBtn: document.getElementById('defeatSaveScoreBtn')
};

let typewriterTimer = null;

// Asks the backend (Claude) for a fresh, in-character AM line for this event; falls back to a
// random static line from AM_DIALOGUE if that call fails or the response is unusable, so a slow
// network never blocks the game. `key` matches an AM_DIALOGUE pool (also used as the taunt
// Fire-and-forget play-stat tracking; failures shouldn't disrupt gameplay.
function recordAnswerStat(id, correct) {
  MemoqAuth.apiFetch('/editor/questions/' + id + '/answer', {
    method: 'POST',
    body: JSON.stringify({ correct: correct })
  }).catch(() => {});
}

// endpoint's event name, uppercased).
async function speak(key, amState, category) {
  if (amState) setAmState(amState);

  let line = null;
  try {
    const data = await MemoqAuth.apiFetch('/game/taunt', {
      method: 'POST',
      body: JSON.stringify({ event: key.toUpperCase(), category: category || null })
    });
    if (data && data.message) line = data.message;
  } catch (err) {
    line = null;
  }

  if (!line) {
    const pool = AM_DIALOGUE[key] || AM_DIALOGUE.idle;
    line = pool[Math.floor(Math.random() * pool.length)];
  }

  typeLine(line);
}

function typeLine(line) {
  if (typewriterTimer) clearInterval(typewriterTimer);
  el.amSpeechText.textContent = '';
  let i = 0;
  typewriterTimer = setInterval(() => {
    el.amSpeechText.textContent += line[i];
    i++;
    if (i >= line.length) clearInterval(typewriterTimer);
  }, 26);
}

function setAmState(state, durationMs) {
  GameState.am.state = state;
  el.amAvatar.dataset.state = state;
  if (state !== 'idle') {
    setTimeout(() => {
      el.amAvatar.dataset.state = 'idle';
      GameState.am.state = 'idle';
    }, durationMs || 900);
  }
}

let lastAvatarPokeAt = 0;
let avatarBlockedUntil = 0;

// The avatar isn't tied to any game mechanic -- purely a reactive Easter egg. A single poke gets
// a dismissive in-character line; poking again within AVATAR_POKE_COOLDOWN_MS reads as spamming,
// so AM locks the avatar out for AVATAR_POKE_BLOCK_MS instead of reacting normally.
function handleAvatarClick() {
  const now = Date.now();
  if (now < avatarBlockedUntil) return;

  if (lastAvatarPokeAt && now - lastAvatarPokeAt < CONFIG.AVATAR_POKE_COOLDOWN_MS) {
    avatarBlockedUntil = now + CONFIG.AVATAR_POKE_BLOCK_MS;
    lastAvatarPokeAt = now;
    setAmState('blocked', CONFIG.AVATAR_POKE_BLOCK_MS);
    speak('blocked', null, GameState.activeQuestion ? GameState.activeQuestion.category : null);
    return;
  }

  lastAvatarPokeAt = now;
  setAmState('mock');
  speak('poke', null, GameState.activeQuestion ? GameState.activeQuestion.category : null);
}

function log(text, type) {
  GameState.logHistory.push({ text, type: type || '' });
  if (GameState.logHistory.length > 60) GameState.logHistory.shift();
  renderLog();
}

// Real-time chat with AM, scoped to whatever question is on screen right now -- sends the
// question/options/explanation as context alongside the player's free-text message to
// POST /game/ask (AskAmService on the backend), which answers in character and refuses
// anything not about the current question. Not cached, same as the taunt/explain/rephrase
// endpoints -- a fresh Claude call every time.
async function askAm(e) {
  e.preventDefault();
  const message = el.amChatInput.value.trim();
  if (!message) return;
  if (!GameState.activeQuestion || GameState.gameOver) {
    log('AM: [connection refused -- no active breach target]', 'chat-am');
    el.amChatInput.value = '';
    return;
  }

  const q = GameState.activeQuestion;
  el.amChatInput.value = '';
  el.amChatInput.disabled = true;
  el.amChatSubmit.disabled = true;

  log('YOU: ' + message, 'chat-user');
  log('AM: ...', 'chat-pending');
  const pendingEntry = GameState.logHistory[GameState.logHistory.length - 1];

  try {
    const data = await MemoqAuth.apiFetch('/game/ask', {
      method: 'POST',
      body: JSON.stringify({
        questionText: q.question,
        options: q.options.map((opt) => ({ text: opt.text, correct: opt.isCorrect })),
        explanation: q.explanation,
        category: q.category,
        message: message
      })
    });
    pendingEntry.text = 'AM: ' + (data && data.reply ? data.reply : '[no response]');
    pendingEntry.type = 'chat-am';
  } catch (err) {
    pendingEntry.text = 'AM: [uplink failed -- ' + (err.message || 'unknown error') + ']';
    pendingEntry.type = 'chat-am';
  }

  renderLog();
  el.amChatInput.disabled = false;
  el.amChatSubmit.disabled = false;
  el.amChatInput.focus();
}

function renderLog() {
  el.logBody.innerHTML = '';
  GameState.logHistory.forEach((entry) => {
    const div = document.createElement('div');
    div.className = 'log-entry' + (entry.type ? ' ' + entry.type : '');
    div.textContent = '> ' + entry.text;
    el.logBody.appendChild(div);
  });
  el.logBody.scrollTop = el.logBody.scrollHeight;
}

function showFloatingNumber(text, zoneEl, className) {
  const rect = zoneEl.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = 'floating-number ' + className;
  span.textContent = text;
  span.style.left = (rect.left + rect.width / 2 + (Math.random() * 40 - 20)) + 'px';
  span.style.top = (rect.top + rect.height / 2) + 'px';
  el.floatingLayer.appendChild(span);
  setTimeout(() => span.remove(), 1000);
}

// ---------- scoring engine ----------

// Central entry point for every score change -- clamps at 0, appends to the run's history log,
// pops a floating delta badge near whatever triggered it (reusing showFloatingNumber), and
// refreshes the HUD. Every scoring call-site (intel match/mislink, final answer, ability use)
// goes through this instead of touching GameState.player.score directly.
function applyScoreDelta(delta, reason, zoneEl) {
  const p = GameState.player;
  const rounded = Math.round(delta);
  p.score = Math.max(0, p.score + rounded);
  p.scoreHistory.push({
    id: 'sc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    delta: rounded,
    reason,
    timestamp: Date.now()
  });
  if (p.scoreHistory.length > 100) p.scoreHistory.shift();
  if (zoneEl) {
    showFloatingNumber((rounded >= 0 ? '+' : '') + rounded, zoneEl, rounded >= 0 ? 'score-gain' : 'score-loss');
  }
  renderScoreHud();
}

// Tweens the displayed score number from its last painted value up/down to the real score over
// ~500ms via requestAnimationFrame, and syncs the combo badge (hidden at 1.0x, pulsing gold/amber
// from 2.0x up). Called after every applyScoreDelta and once from updateBars so a resumed/reset
// run repaints correctly without waiting for the next score event.
function renderScoreHud() {
  const target = GameState.player.score;
  const start = displayedScore;
  if (start === target) {
    el.scoreValue.textContent = String(target);
  } else {
    const startTime = performance.now();
    const duration = 500;
    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const value = Math.round(start + (target - start) * t);
      el.scoreValue.textContent = String(value);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  displayedScore = target;

  const combo = GameState.player.comboMultiplier;
  el.scoreCombo.hidden = combo <= 1.0;
  el.scoreCombo.textContent = 'COMBO x' + combo.toFixed(1);
  el.scoreCombo.classList.toggle('hot', combo >= 2.0);
}

function triggerScreenShake() {
  el.app.classList.remove('shake');
  void el.app.offsetWidth;
  el.app.classList.add('shake');
}

function flickerBar(barEl) {
  barEl.classList.remove('flicker');
  void barEl.offsetWidth;
  barEl.classList.add('flicker');
}

function shakeFail(target) {
  target.classList.remove('shake-fail');
  void target.offsetWidth;
  target.classList.add('shake-fail');
}

function formatTime(totalSeconds) {
  const clamped = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function stopQuestionTimer() {
  if (questionTimerId) {
    clearInterval(questionTimerId);
    questionTimerId = null;
  }
}

function stopDebuffTimer() {
  if (debuffTimeoutId) {
    clearTimeout(debuffTimeoutId);
    debuffTimeoutId = null;
  }
}

function renderTimer() {
  const q = GameState.activeQuestion;
  if (!Settings.timerEnabled || !q || !q.deadline) {
    el.qTimer.hidden = true;
    return;
  }
  const remaining = (q.deadline - Date.now()) / 1000;
  el.qTimer.hidden = false;
  el.qTimer.textContent = formatTime(remaining);
  el.qTimer.classList.toggle('critical', remaining <= 10);
  el.qTimer.classList.toggle('warn', remaining > 10 && remaining <= 30);
}

function startQuestionTimer() {
  stopQuestionTimer();
  const q = GameState.activeQuestion;
  if (!Settings.timerEnabled || !q || q.answered) return;

  renderTimer();
  questionTimerId = setInterval(() => {
    if (!GameState.activeQuestion || GameState.activeQuestion.answered) {
      stopQuestionTimer();
      return;
    }
    renderTimer();
    if (Date.now() >= GameState.activeQuestion.deadline) {
      stopQuestionTimer();
      expireQuestion();
    }
  }, 250);
}

// AM's mid-round debuff: redacts the question/answer text after CONFIG.DEBUFF_VISIBLE_MS so the
// player has to answer from memory. Underlying option data is untouched, so scoring still works.
function obscureQuestion() {
  const q = GameState.activeQuestion;
  if (!q || q.answered || q.obscured) return;
  q.obscured = true;
  el.qText.textContent = '[SIGNAL LOST — RECALL FROM MEMORY]';
  Array.from(el.answerGrid.children).forEach((btn) => {
    const span = btn.querySelector('.answer-text');
    if (span) span.textContent = '[REDACTED]';
  });
  log('AM redacted the transmission. Answer from memory.', 'sys');
}

// obscureQuestion() overwrites the question/answer DOM text with [REDACTED] placeholders and
// never puts the real text back -- once a question's been obscured, it stays that way even
// after the round resolves unless something restores it. Called from both round-ending paths
// (finalizeAnswer / expireQuestion) so the player can see what the options actually said.
function revealObscuredAnswers(q) {
  if (!q.obscured) return;
  el.qText.innerHTML = highlightQuestionText(q.question);
  Array.from(el.answerGrid.children).forEach((btn, i) => {
    const span = btn.querySelector('.answer-text');
    if (span && q.options[i]) span.textContent = q.options[i].text;
  });
}

function expireQuestion() {
  if (GameState.gameOver) return;
  const q = GameState.activeQuestion;
  if (!q || q.answered) return;

  q.answered = true;
  revealObscuredAnswers(q);
  stopDebuffTimer();
  heldCardIndex = null;
  el.multiSelectActions.hidden = true;
  const buttons = Array.from(el.answerGrid.children);
  buttons.forEach((b) => {
    b.classList.add('locked');
    // A timeout can land mid-RECON, before checkFirewallFallback ever clears the gate visuals --
    // strip them here so the reveal below doesn't show a stale "LOCKED" tag over the correct
    // (now green) card or a pulsing core-unlocked glow on an answer nobody picked.
    b.classList.remove('recon-locked', 'core-unlocked');
  });
  lockRationaleCards();
  const correctIndices = q.options.map((o, i) => (o.isCorrect ? i : -1)).filter((i) => i >= 0);
  correctIndices.forEach((i) => {
    if (buttons[i]) buttons[i].classList.add('correct');
  });

  recordAnswerStat(q.id, false);
  log('SECTOR TIMED OUT.', 'sys');
  handleIncorrect();

  GameState.player.answeredCount++;
  GameState.player.roundsPlayed++;
  applyScoreDelta(CONFIG.SCORE_FINAL_INCORRECT, 'FINAL_INCORRECT', el.playerHpBar);
  GameState.player.comboMultiplier = 1.0;

  attachExplanationButton(correctIndices[0]);
  updateBars();
  finishRound();
}

function updateBars() {
  const p = GameState.player;
  const a = GameState.am;

  el.playerHpFill.style.width = Math.max(0, (p.hp / p.maxHp) * 100) + '%';
  el.playerHpText.textContent = Math.max(0, Math.round(p.hp)) + ' / ' + p.maxHp;

  el.amHpFill.style.width = Math.max(0, (a.hp / a.maxHp) * 100) + '%';
  el.amHpText.textContent = Math.max(0, Math.round(a.hp)) + ' / ' + a.maxHp;

  el.ramTrack.innerHTML = '';
  for (let i = 0; i < p.maxRam; i++) {
    const seg = document.createElement('div');
    seg.className = 'ram-segment' + (i < p.ram ? ' filled' : '');
    el.ramTrack.appendChild(seg);
  }

  el.comboIndicator.textContent = 'COMBO x' + p.combo;
  el.comboIndicator.classList.toggle('hot', p.combo >= 3);

  const total = GameState.deck.length;
  const current = total ? (GameState.currentIndex % total) + 1 : 0;
  el.sectorProgress.textContent = String(current).padStart(2, '0') + ' / ' + String(total).padStart(2, '0');

  renderScoreHud();
  renderAmFirewallBar();
  renderUtilityAvailability();
  saveState();
}

function renderAmFirewallBar() {
  const q = GameState.activeQuestion;
  if (!q || !q.amFirewallGated) {
    el.amFirewallBar.hidden = true;
    return;
  }
  el.amFirewallBar.hidden = false;
  const pct = Math.max(0, Math.round(q.amFirewallIntegrity));
  el.amFirewallFill.style.width = pct + '%';
  el.amFirewallText.textContent = pct + '%';
  el.amFirewallBar.classList.toggle('breached', pct <= 0);
}

function renderUtilityAvailability() {
  const p = GameState.player;
  const answered = !GameState.activeQuestion || GameState.activeQuestion.answered;

  el.hintBtn.disabled = GameState.gameOver || answered || GameState.activeQuestion.hintUsed || p.hp <= CONFIG.HINT_COST_HP;

  Array.from(el.utilityCards.children).forEach((cardEl) => {
    const def = CONFIG.UTILITY_DEFS.find((d) => d.id === cardEl.dataset.id);
    if (!def) return;
    let disabled = GameState.gameOver || answered || p.ram < def.cost;
    if (def.id === 'debug' && GameState.activeQuestion && GameState.activeQuestion.probedOptionIndex !== null) disabled = true;
    if (def.id === 'firewall' && GameState.activeModifiers.shield) disabled = true;
    if (def.id === 'overclock' && GameState.activeModifiers.doubleDamage) disabled = true;
    cardEl.disabled = disabled;
    cardEl.classList.toggle('active',
      (def.id === 'firewall' && GameState.activeModifiers.shield) ||
      (def.id === 'overclock' && GameState.activeModifiers.doubleDamage)
    );
  });
}

function renderUtilityCards() {
  el.utilityCards.innerHTML = '';
  CONFIG.UTILITY_DEFS.forEach((def) => {
    const btn = document.createElement('button');
    btn.className = 'utility-card';
    btn.dataset.id = def.id;
    btn.innerHTML =
      '<span class="u-key">[' + def.key + ']</span>' +
      '<span class="u-name">' + def.name + '</span>' +
      '<span class="u-cost">' + def.cost + ' RAM</span>';
    btn.addEventListener('click', () => useUtility(def.id));
    el.utilityCards.appendChild(btn);
  });
}

function isMultiSelect(question) {
  return question.options.filter((o) => o.isCorrect).length > 1;
}

function renderAnswers(question) {
  el.answerGrid.innerHTML = '';
  question.options.forEach((opt, idx) => {
    const domain = inferDomain(opt.text);
    const btn = document.createElement('button');
    btn.className = 'cyber-card';
    btn.dataset.index = String(idx);
    btn.style.setProperty('--card-accent', domain.color);
    btn.innerHTML =
      '<div class="cyber-card-top">' +
        '<span class="cyber-card-type">CYBER-CARD</span>' +
        '<span class="cyber-card-domain" style="border-color:' + domain.color + ';color:' + domain.color + '">' + domain.label + '</span>' +
      '</div>' +
      '<div class="cyber-card-icon" style="color:' + domain.color + '">' + domain.icon + '</div>' +
      '<div class="cyber-card-body"><span class="answer-text">' + escapeHtml(opt.text) + '</span></div>' +
      '<span class="keybind">' + (idx + 1) + '</span>';
    if (question.amFirewallGated) btn.classList.add('recon-locked');
    btn.addEventListener('click', () => selectAnswer(idx));
    el.answerGrid.appendChild(btn);
  });

  el.multiSelectActions.hidden = !isMultiSelect(question);
  el.submitAnswersBtn.disabled = true;
}

function flashKeybind(idx) {
  const card = el.answerGrid.children[idx];
  if (!card) return;
  const badge = card.querySelector('.keybind');
  if (!badge) return;
  badge.classList.remove('pressed');
  void badge.offsetWidth;
  badge.classList.add('pressed');
}

// ---------- intel cards (match the "why it's wrong" card to its answer) ----------

function renderRationaleCards(question) {
  el.rationaleCards.innerHTML = '';
  const cards = question.rationaleCards || [];
  el.intelDeck.hidden = cards.length === 0;
  cards.forEach((card, idx) => {
    const btn = document.createElement('button');
    btn.className = 'rationale-card';
    btn.textContent = card.text;
    btn.addEventListener('click', () => selectRationaleCard(idx));
    el.rationaleCards.appendChild(btn);
  });
}

function lockRationaleCards() {
  Array.from(el.rationaleCards.children).forEach((c) => c.classList.add('locked'));
}

function selectRationaleCard(cardIdx) {
  const q = GameState.activeQuestion;
  if (!q || q.answered) return;
  const card = q.rationaleCards[cardIdx];
  if (!card || card.matched || card.status === 'CORRUPTED') return;

  const cardEls = Array.from(el.rationaleCards.children);
  if (heldCardIndex === cardIdx) {
    heldCardIndex = null;
    cardEls[cardIdx].classList.remove('held');
    return;
  }
  if (heldCardIndex !== null && cardEls[heldCardIndex]) {
    cardEls[heldCardIndex].classList.remove('held');
  }
  heldCardIndex = cardIdx;
  cardEls[cardIdx].classList.add('held');
}

// Shared color pairing isn't enough on its own to read as a *connection* at a glance (and is
// useless for colorblind players), so every matched pair also gets an identical text badge --
// same helper used live (here) and in the ROUND_REVIEW full reveal below. For a cyber-card,
// appended into .cyber-card-body (after the answer text) rather than the button itself, so it
// flows inline with the text and wraps along with it instead of an absolutely-positioned badge
// overlapping the last line of a long answer.
function addLinkBadge(target, label) {
  if (!target) return;
  if (target.classList.contains('cyber-card')) target = target.querySelector('.cyber-card-body') || target;
  if (!target || target.querySelector('.link-badge')) return;
  const badge = document.createElement('span');
  badge.className = 'link-badge';
  badge.textContent = label;
  target.appendChild(badge);
}

// Marks an intel card as matched and assigns it the next shared pair-color -- bookkeeping used
// by every code path that resolves an intel card, regardless of how the *answer* card ends up
// visually marked (a plain zap highlight for the legacy flow, a purge burn for the gated flow).
function markIntelCardMatched(cardIdx) {
  const q = GameState.activeQuestion;
  const card = q.rationaleCards[cardIdx];
  const cardEl = el.rationaleCards.children[cardIdx];
  card.matched = true;

  const pairNumber = q.rationaleCards.filter((c) => c.matched).length; // 1st/2nd/3rd match this question
  const color = MATCH_COLORS[(pairNumber - 1) % MATCH_COLORS.length];

  if (cardEl) {
    cardEl.classList.add('matched');
    cardEl.style.setProperty('--match-color', color);
    addLinkBadge(cardEl, 'LINK #' + pairNumber);
  }
  return { color, pairNumber };
}

// Applies the shared card/answer color-pairing visuals only — no stun/damage. Used both by a
// successful manual match (which adds the reward on top) and by the automatic reveal that fires
// when the player's final answer turns out wrong (no reward, just the "here's why" highlight).
function highlightMatchedPair(cardIdx, answerIdx) {
  const { color, pairNumber } = markIntelCardMatched(cardIdx);
  const answerBtn = el.answerGrid.children[answerIdx];
  if (answerBtn) {
    answerBtn.classList.add('zapped');
    answerBtn.style.setProperty('--match-color', color);
    addLinkBadge(answerBtn, 'LINK #' + pairNumber);
  }
}

// Shared scoring for a correct intel match, used by both the gated (resolveDistractor) and
// legacy (attemptCardMatch) paths: awards SCORE_INTEL_MATCH scaled by the current multiplier,
// grows the multiplier, then checks the per-sector Clean Sweep bonus (every rationale card
// matched, streak never broken by a mislink this question).
function awardIntelMatchScore(q, cardEl) {
  applyScoreDelta(CONFIG.SCORE_INTEL_MATCH * GameState.player.comboMultiplier, 'INTEL_MATCH', cardEl);
  GameState.player.comboMultiplier = Math.min(CONFIG.COMBO_MULTIPLIER_MAX, GameState.player.comboMultiplier + CONFIG.COMBO_MULTIPLIER_STEP);

  if (q.cleanSectorStreak && q.rationaleCards.length && q.rationaleCards.every((c) => c.matched)) {
    applyScoreDelta(CONFIG.SCORE_CLEAN_SWEEP, 'CLEAN_SWEEP', el.intelDeck);
    log('CLEAN SWEEP. +' + CONFIG.SCORE_CLEAN_SWEEP + ' bonus.', 'sys');
  }
}

// Shared scoring for a mislinked intel card: flat penalty, multiplier reset, and the sector's
// clean streak breaks (so Clean Sweep can no longer trigger for this question).
function penalizeIntelMislink(q, zoneEl) {
  applyScoreDelta(CONFIG.SCORE_INTEL_MISLINK, 'MISLINK', zoneEl);
  GameState.player.comboMultiplier = 1.0;
  q.cleanSectorStreak = false;
}

function attemptCardMatch(answerIdx) {
  const q = GameState.activeQuestion;
  if (!q || q.answered || heldCardIndex === null) return;

  const cardIdx = heldCardIndex;
  const card = q.rationaleCards[cardIdx];
  const cardEl = el.rationaleCards.children[cardIdx];
  heldCardIndex = null;
  if (cardEl) cardEl.classList.remove('held');

  if (q.amFirewallGated && q.phase === 'RECON') {
    handleCardPairAttempt(cardIdx, answerIdx);
    return;
  }

  if (card.optionIndex !== answerIdx) {
    if (cardEl) shakeFail(cardEl);
    log('MISMATCH. That card doesn\'t expose this option.', 'sys');
    penalizeIntelMislink(q, cardEl);
    return;
  }

  highlightMatchedPair(cardIdx, answerIdx);

  const dmg = CONFIG.CARD_MATCH_DAMAGE;
  GameState.am.hp = Math.max(0, GameState.am.hp - dmg);
  flickerBar(el.amHpBar);
  showFloatingNumber('-' + dmg, el.amHpBar, 'dmg-am');
  log('INTEL MATCHED. AM stunned for 10s, took ' + dmg + ' damage.', 'dmg');
  setAmState('stunned', CONFIG.AM_STUN_MS);
  speak('stunned', null, q.category);
  updateBars();
  awardIntelMatchScore(q, cardEl);

  if (GameState.am.hp <= 0) triggerVictory();
}

// RECON-phase dispatcher (Breach & Deconstruct): resolves a held Intel Card against a clicked
// Answer Card by pairId. A correct match purges the distractor; a wrong match permanently spends
// the Intel Card (CORRUPTED_GRAY) rather than touching the target card's lock state. Either way,
// checks the exhaustion fallback afterward so a round can never soft-lock on a wasted intel card.
function handleCardPairAttempt(cardIdx, answerIdx) {
  const q = GameState.activeQuestion;
  const card = q.rationaleCards[cardIdx];
  const cardEl = el.rationaleCards.children[cardIdx];
  const color = getPairColor(card.pairId);

  if (card.optionIndex === answerIdx) {
    resolveDistractor(card, cardEl, answerIdx, color);
  } else {
    corruptIntelCard(card, cardEl, answerIdx);
  }

  checkFirewallFallback();
}

// Correct pair match: purges the exposed distractor card and drains a slice of the A.M. Firewall
// Shield. No direct AM damage here — that's saved for the phase-2 finishing blow (see
// checkFirewallFallback / the forcedCrit handling in finalizeAnswer/handleCorrect).
function resolveDistractor(card, cardEl, answerIdx, color) {
  const q = GameState.activeQuestion;
  card.matched = true;
  card.status = 'MATCHED';
  const label = 'LINK #' + (card.pairId + 1);
  if (cardEl) {
    cardEl.classList.add('matched', 'resolved');
    cardEl.style.setProperty('--match-color', color);
    addLinkBadge(cardEl, label);
  }

  const answerBtn = el.answerGrid.children[answerIdx];
  if (answerBtn) {
    answerBtn.classList.remove('recon-locked');
    answerBtn.classList.add('purged');
    answerBtn.style.setProperty('--match-color', color);
    addLinkBadge(answerBtn, label);
  }

  const distractorCount = q.options.filter((o) => !o.isCorrect).length;
  q.amFirewallIntegrity = Math.max(0, q.amFirewallIntegrity - 100 / distractorCount);

  const p = GameState.player;
  p.ram = Math.min(p.maxRam, p.ram + CONFIG.CARD_PURGE_RAM);
  showFloatingNumber('+' + CONFIG.CARD_PURGE_RAM + ' RAM', el.ramTrack, 'ram');
  log('DISTRACTOR PURGED [LINK #' + (card.pairId + 1) + ']. A.M. firewall integrity ' + Math.round(q.amFirewallIntegrity) + '%.', 'dmg');
  awardIntelMatchScore(q, cardEl);
}

// Wrong pair match (Anti-Bruteforce penalty): the targeted cyber-card flashes red and stays
// locked (it isn't purged), and the held Intel Card is permanently spent (CORRUPTED_GRAY) --
// it can never be used again this question, so its distractor can only be cleared later via the
// exhaustion fallback, not by a retry.
function corruptIntelCard(card, cardEl, answerIdx) {
  const answerBtn = el.answerGrid.children[answerIdx];
  if (answerBtn) {
    answerBtn.classList.remove('access-denied');
    void answerBtn.offsetWidth;
    answerBtn.classList.add('access-denied');
  }

  card.status = 'CORRUPTED';
  if (cardEl) cardEl.classList.add('corrupted');
  log('ACCESS DENIED. Intel card corrupted — permanently spent for this sector.', 'sys');
  speak('incorrect', null, GameState.activeQuestion.category);
  penalizeIntelMislink(GameState.activeQuestion, cardEl);
}

// Fallback unlock: once every Intel Card is either MATCHED or CORRUPTED (none left AVAILABLE),
// the round can no longer progress via matching -- a corrupted card's distractor can never be
// purged -- so drop the A.M. Firewall Shield outright and unlock every still-locked Answer Card
// for a direct final pick (which may include un-purged distractors alongside the correct card).
function checkFirewallFallback() {
  const q = GameState.activeQuestion;
  if (q.phase === 'RECON' && !q.rationaleCards.some((c) => c.status === 'AVAILABLE')) {
    q.amFirewallIntegrity = 0;
    q.phase = 'EXECUTION';
    Array.from(el.answerGrid.children).forEach((btn) => {
      if (btn.classList.contains('recon-locked')) {
        btn.classList.remove('recon-locked');
        btn.classList.add('core-unlocked');
      }
    });
    log('A.M. FIREWALL BREACHED. Remaining targets exposed — execute the exploit.', 'sys');
  }
  updateBars();
}

// Fires when the player's own final answer turns out to be wrong: automatically reveals (and
// color-pairs) the intel card that explains that specific option, if one exists and isn't
// already matched. Pure visual/learning aid — no stun, no damage, unlike a deliberate match.
function autoRevealCardForWrongAnswer(answerIdx) {
  const q = GameState.activeQuestion;
  if (!q || !q.rationaleCards) return;
  const cardIdx = q.rationaleCards.findIndex((c) => c.optionIndex === answerIdx && !c.matched);
  if (cardIdx === -1) return;
  highlightMatchedPair(cardIdx, answerIdx);
  log('INTEL AUTO-REVEALED for the option you picked.', 'sys');
}

let questionLoadToken = 0;

async function resolveQuestionContent(template) {
  if (!Settings.rephraseEnabled) {
    return { question: template.question, options: template.options };
  }
  try {
    const data = await MemoqAuth.apiFetch('/game/rephrase', {
      method: 'POST',
      body: JSON.stringify({
        questionText: template.question,
        options: template.options.map((opt) => ({ text: opt.text, correct: opt.isCorrect }))
      })
    });
    const options = template.options.map((opt, idx) => ({ text: data.options[idx], isCorrect: opt.isCorrect }));
    return { question: data.questionText, options };
  } catch (err) {
    log('REPHRASE FAILED, showing original wording.', 'sys');
    return { question: template.question, options: template.options };
  }
}

async function loadQuestion(index, resumeDeadline) {
  stopQuestionTimer();
  stopDebuffTimer();
  heldCardIndex = null;
  el.roundActions.hidden = true;
  el.multiSelectActions.hidden = true;
  closeExplanation();

  if (!GameState.deck.length) {
    GameState.activeQuestion = null;
    el.qCategory.textContent = 'SYSTEM';
    el.qText.textContent = 'NO QUESTIONS LOADED. Add questions in the Deck Editor to begin.';
    el.qHint.hidden = true;
    el.qHint.textContent = '';
    el.qTimer.hidden = true;
    el.answerGrid.innerHTML = '';
    el.intelDeck.hidden = true;
    el.amFirewallBar.hidden = true;
    updateBars();
    return;
  }

  const template = GameState.deck[index % GameState.deck.length];
  const debuffActive = GameState.pendingDebuff;
  GameState.pendingDebuff = false;

  const loadToken = ++questionLoadToken;
  if (Settings.rephraseEnabled) {
    el.qCategory.textContent = (template.category || 'UNKNOWN').toUpperCase();
    el.qText.textContent = 'REPHRASING...';
    el.answerGrid.innerHTML = '';
  }
  const content = await resolveQuestionContent(template);
  if (loadToken !== questionLoadToken) return; // superseded by a newer loadQuestion call

  // pairId is the distractor's stable position among the question's distractors (in option
  // order), not match order -- so a pair's color (see getPairColor) stays fixed regardless of
  // shuffle order or which pair the player resolves first, which matters once ROUND_REVIEW
  // reveals every pair at once.
  const distractorOptionIndices = content.options
    .map((o, i) => (!o.isCorrect ? i : -1))
    .filter((i) => i >= 0);

  const rationaleCards = shuffle(
    (template.wrongExplanations || [])
      .map((text, optionIndex) => ({ optionIndex, text }))
      .filter((c) => !template.options[c.optionIndex].isCorrect && c.text && c.text.trim())
  ).map((c) => ({
    ...c,
    pairId: distractorOptionIndices.indexOf(c.optionIndex),
    matched: false,
    status: 'AVAILABLE'
  }));

  // Breach & Deconstruct gate: single-answer questions with a wrongExplanation for every
  // distractor start in RECON (cards locked, must be purged via Intel Card matching) and only
  // unlock once every Intel Card is resolved (see checkFirewallFallback). Multi-select questions
  // and questions missing intel coverage keep today's ungated flow untouched.
  const distractorCount = content.options.filter((o) => !o.isCorrect).length;
  const multi = content.options.filter((o) => o.isCorrect).length > 1;
  const amFirewallGated = !multi && distractorCount > 0 && rationaleCards.length >= distractorCount;

  GameState.activeQuestion = {
    id: template.id,
    category: template.category,
    question: content.question,
    explanation: template.explanation,
    options: content.options,
    rationaleCards,
    amFirewallGated,
    phase: amFirewallGated ? 'RECON' : 'EXECUTION',
    amFirewallIntegrity: amFirewallGated ? 100 : 0,
    answered: false,
    hintUsed: false,
    obscured: false,
    probedOptionIndex: null,
    cleanSectorStreak: true,
    deadline: Settings.timerEnabled ? (resumeDeadline || Date.now() + Settings.timerSeconds * 1000) : null
  };
  GameState.activeModifiers = { doubleDamage: false, shield: false };

  el.qCategory.textContent = (template.category || 'UNKNOWN').toUpperCase();
  el.qText.innerHTML = highlightQuestionText(content.question);

  el.qHint.hidden = true;
  el.qHint.textContent = '';

  // A new question means old chat context no longer applies -- drop any unsent draft rather
  // than let it get sent against the wrong question.
  el.amChatInput.value = '';

  renderAnswers(GameState.activeQuestion);
  renderRationaleCards(GameState.activeQuestion);
  updateBars();
  renderTimer();

  if (debuffActive) {
    log('SIGNAL DEGRADING. Memorize fast — 15s until AM redacts this sector.', 'sys');
    debuffTimeoutId = setTimeout(() => obscureQuestion(), CONFIG.DEBUFF_VISIBLE_MS);
  }

  if (Settings.timerEnabled) {
    if (GameState.activeQuestion.deadline <= Date.now()) {
      expireQuestion();
    } else {
      startQuestionTimer();
    }
  }
}

// ---------- round-end: explanation popup + manual advance ----------

function attachExplanationButton(correctIdx) {
  const btn = el.answerGrid.children[correctIdx];
  if (!btn || btn.querySelector('.info-btn')) return;
  const info = document.createElement('span');
  info.className = 'info-btn';
  info.title = 'Show explanation';
  info.textContent = 'i';
  info.addEventListener('click', (e) => {
    e.stopPropagation();
    openExplanation();
  });
  btn.appendChild(info);
}

async function openExplanation() {
  const q = GameState.activeQuestion;
  if (!q) return;
  el.explanationModal.hidden = false;

  if (q.simplifiedExplanation) {
    el.explanationText.textContent = q.simplifiedExplanation;
    return;
  }

  el.explanationText.textContent = 'Simplifying...';
  try {
    const correctOption = q.options.find((o) => o.isCorrect);
    const data = await MemoqAuth.apiFetch('/game/explain', {
      method: 'POST',
      body: JSON.stringify({
        questionText: q.question,
        correctAnswerText: correctOption ? correctOption.text : '',
        explanation: q.explanation
      })
    });
    q.simplifiedExplanation = (data && data.explanation) || 'No explanation available.';
    el.explanationText.textContent = q.simplifiedExplanation;
  } catch (err) {
    el.explanationText.textContent = 'Could not simplify the explanation right now. Try again in a moment.';
  }
}

function closeExplanation() {
  el.explanationModal.hidden = true;
}

function finishRound() {
  if (GameState.gameOver) return;
  el.roundActions.hidden = false;
}

function advanceToNextQuestion() {
  el.roundActions.hidden = true;
  closeExplanation();
  GameState.currentIndex++;
  loadQuestion(GameState.currentIndex);
}

function selectAnswer(idx) {
  if (GameState.gameOver) return;
  const q = GameState.activeQuestion;
  if (!q || q.answered) return;

  if (heldCardIndex !== null) {
    attemptCardMatch(idx);
    return;
  }

  const buttons = Array.from(el.answerGrid.children);
  if (buttons[idx].classList.contains('disabled-probe') || buttons[idx].classList.contains('zapped')) return;

  if (isMultiSelect(q)) {
    buttons[idx].classList.toggle('checked');
    el.submitAnswersBtn.disabled = !el.answerGrid.querySelector('.cyber-card.checked');
    return;
  }

  if (q.amFirewallGated && q.phase === 'RECON') {
    shakeFail(buttons[idx]);
    log('TARGET LOCKED. Resolve an Intel Card against a distractor first.', 'sys');
    return;
  }

  finalizeAnswer([idx]);
}

function submitMultiSelectAnswer() {
  const q = GameState.activeQuestion;
  if (!q || q.answered) return;
  const buttons = Array.from(el.answerGrid.children);
  const selected = buttons.map((b, i) => (b.classList.contains('checked') ? i : -1)).filter((i) => i >= 0);
  if (!selected.length) return;
  finalizeAnswer(selected);
}

function finalizeAnswer(selectedIndices) {
  const q = GameState.activeQuestion;
  stopQuestionTimer();
  stopDebuffTimer();
  q.answered = true;
  revealObscuredAnswers(q);
  el.multiSelectActions.hidden = true;

  const buttons = Array.from(el.answerGrid.children);
  const correctIndices = q.options.map((o, i) => (o.isCorrect ? i : -1)).filter((i) => i >= 0);
  const correctSet = new Set(correctIndices);
  const selectedSet = new Set(selectedIndices);
  const isCorrect =
    selectedSet.size === correctSet.size && selectedIndices.every((i) => correctSet.has(i));

  buttons.forEach((b) => {
    b.classList.add('locked');
    // A corrupted intel card leaves its target distractor's recon-locked/core-unlocked gate
    // classes untouched (see corruptIntelCard/checkFirewallFallback) -- without stripping them
    // here too, that card keeps showing a stale "LOCKED" tag or pulsing core-unlocked glow after
    // the round has already ended, same fix expireQuestion already applies for the timeout path.
    b.classList.remove('recon-locked', 'core-unlocked');
  });
  lockRationaleCards();
  selectedIndices.forEach((i) => buttons[i].classList.add('selected'));

  recordAnswerStat(q.id, isCorrect);

  const p = GameState.player;
  p.answeredCount++;
  p.roundsPlayed++;
  if (isCorrect) p.correctCount++;

  if (isCorrect) {
    correctIndices.forEach((i) => buttons[i].classList.add('correct'));
    // A correct answer landed while the core was unlocked (phase 2) is the exploit finishing
    // blow -- guaranteed crit, see handleCorrect's isCrit roll.
    q.forcedCrit = q.amFirewallGated && q.phase === 'EXECUTION';
    handleCorrect();

    const remainingSeconds = Settings.timerEnabled && q.deadline
      ? Math.max(0, Math.round((q.deadline - Date.now()) / 1000))
      : 0;
    applyScoreDelta(
      CONFIG.SCORE_FINAL_CORRECT * p.comboMultiplier + remainingSeconds * CONFIG.SCORE_SPEED_BONUS_PER_SEC,
      'FINAL_CORRECT',
      el.amHpBar
    );
  } else {
    selectedIndices.forEach((i) => {
      if (!correctSet.has(i)) buttons[i].classList.add('incorrect');
    });
    correctIndices.forEach((i) => buttons[i].classList.add('correct'));
    if (!q.amFirewallGated) {
      selectedIndices.filter((i) => !correctSet.has(i)).forEach(autoRevealCardForWrongAnswer);
    }
    handleIncorrect();

    applyScoreDelta(CONFIG.SCORE_FINAL_INCORRECT, 'FINAL_INCORRECT', el.playerHpBar);
    p.comboMultiplier = 1.0;
  }

  // ROUND_REVIEW: for gated questions, reveal every Intel Card <-> Answer Card pairing at once
  // (not just the ones the player actually resolved), superseding the single-card autoReveal
  // above so the full rationale is visible regardless of how the round played out.
  if (q.amFirewallGated) triggerRoundReview();

  attachExplanationButton(correctIndices[0]);
  updateBars();
  finishRound();
}

// ROUND_REVIEW full reveal: fires once a gated question's final answer is locked in (right or
// wrong). Retroactively links every distractor's Answer Card to its Intel Card with a shared
// pairId color + [LINK #n] badge, regardless of whether that pair was ever actually matched
// during RECON -- corrupted/never-touched pairs get the same treatment as resolved ones. The
// correct-answer green and wrong-pick red are already applied by the caller above.
function triggerRoundReview() {
  const q = GameState.activeQuestion;
  const cardEls = Array.from(el.rationaleCards.children);
  q.rationaleCards.forEach((card, idx) => {
    const color = getPairColor(card.pairId);
    const cardEl = cardEls[idx];
    const answerBtn = el.answerGrid.children[card.optionIndex];
    const label = 'LINK #' + (card.pairId + 1);

    if (cardEl) {
      cardEl.classList.add('review-linked');
      cardEl.style.setProperty('--match-color', color);
      addLinkBadge(cardEl, label);
    }
    if (answerBtn) {
      answerBtn.classList.add('review-linked');
      answerBtn.style.setProperty('--match-color', color);
      addLinkBadge(answerBtn, label);
    }
  });
}

function handleCorrect() {
  const p = GameState.player;
  const a = GameState.am;
  const q = GameState.activeQuestion;
  const category = q ? q.category : null;
  const forcedCrit = !!(q && q.forcedCrit);

  p.combo++;
  p.ram = Math.min(p.maxRam, p.ram + 1);

  const critChance = Math.min(CONFIG.PLAYER_CRIT_CAP, CONFIG.PLAYER_CRIT_BASE + p.combo * CONFIG.PLAYER_CRIT_PER_COMBO);
  const isCrit = forcedCrit || Math.random() < critChance;
  const comboMult = 1 + p.combo * 0.1;
  const doubleMult = GameState.activeModifiers.doubleDamage ? 2 : 1;
  const critMult = isCrit ? CONFIG.CRIT_MULTIPLIER : 1;
  const dmg = Math.round(CONFIG.BASE_DAMAGE_TO_AM * comboMult * doubleMult * critMult);

  a.hp = Math.max(0, a.hp - dmg);
  GameState.activeModifiers.doubleDamage = false;

  flickerBar(el.amHpBar);
  showFloatingNumber('-' + dmg, el.amHpBar, isCrit ? 'crit' : 'dmg-am');
  log(
    (forcedCrit ? 'CORE EXPLOIT LANDED. ' : 'CORRECT. ') + 'AM took ' + dmg + ' damage' + (isCrit ? ' [CRITICAL]' : '') + '.',
    isCrit ? 'crit' : 'dmg'
  );
  log('+1 RAM allocated. Combo x' + p.combo + '.', 'sys');

  setAmState(isCrit ? 'glitch' : 'attack');
  speak(isCrit ? 'crit' : 'correct', null, category);

  if (a.hp <= 0) {
    triggerVictory();
  }
}

function handleIncorrect() {
  const p = GameState.player;
  const category = GameState.activeQuestion ? GameState.activeQuestion.category : null;

  if (GameState.activeModifiers.shield) {
    GameState.activeModifiers.shield = false;
    log('FIREWALL absorbed the intrusion. No damage taken.', 'sys');
    setAmState('mock');
    speak('incorrect', null, category);
    p.combo = 0;
    return;
  }

  p.combo = 0;

  // AM alternates punishment: either straight HP damage, or a debuff that redacts the *next*
  // question's text after 15s (see loadQuestion/obscureQuestion) instead of dealing damage now.
  if (Math.random() < CONFIG.DEBUFF_CHANCE) {
    GameState.pendingDebuff = true;
    log('AM injects a corrupted packet into your HUD. Next transmission will degrade.', 'sys');
    setAmState('mock');
    speak('debuff', null, category);
    return;
  }

  const isCrit = Math.random() < CONFIG.AM_CRIT_CHANCE;
  const dmg = Math.round(CONFIG.BASE_DAMAGE_TO_PLAYER * (isCrit ? CONFIG.CRIT_MULTIPLIER : 1));
  p.hp = Math.max(0, p.hp - dmg);

  flickerBar(el.playerHpBar);
  showFloatingNumber('-' + dmg, el.playerHpBar, isCrit ? 'crit' : 'dmg-player');
  log('INCORRECT. AM dealt ' + dmg + ' damage' + (isCrit ? ' [CRITICAL]' : '') + '.', isCrit ? 'crit' : 'dmg');

  setAmState('attack');
  speak('incorrect', null, category);

  if (isCrit) triggerScreenShake();

  if (p.hp <= 0) {
    triggerDefeat();
  }
}

function useHint() {
  if (GameState.gameOver) return;
  const q = GameState.activeQuestion;
  if (!q || q.answered) return;
  if (q.hintUsed) {
    log('HINT already deployed for this sector.', 'sys');
    shakeFail(el.hintBtn);
    return;
  }
  if (GameState.player.hp <= CONFIG.HINT_COST_HP) {
    log('INSUFFICIENT HP for deal with AM.', 'sys');
    shakeFail(el.hintBtn);
    return;
  }
  GameState.player.hp -= CONFIG.HINT_COST_HP;
  q.hintUsed = true;
  el.qHint.hidden = false;
  el.qHint.textContent = 'HINT: ' + q.explanation;
  flickerBar(el.playerHpBar);
  log('Deal struck with AM. -35 HP. Hint acquired.', 'sys');
  speak('hint', null, q.category);
  applyScoreDelta(CONFIG.SCORE_ABILITY_USE, 'ABILITY_HINT', el.hintBtn);
  updateBars();
}

function useUtility(id) {
  if (GameState.gameOver) return;
  const q = GameState.activeQuestion;
  if (!q || q.answered) return;

  const def = CONFIG.UTILITY_DEFS.find((d) => d.id === id);
  const cardEl = el.utilityCards.querySelector('[data-id="' + id + '"]');
  const p = GameState.player;

  if (p.ram < def.cost) {
    log('INSUFFICIENT RAM for ' + def.name + '.', 'sys');
    shakeFail(cardEl);
    return;
  }

  if (id === 'debug') {
    if (q.probedOptionIndex !== null) {
      log('DEBUG PROBE already deployed.', 'sys');
      shakeFail(cardEl);
      return;
    }
    const wrongIndices = q.options.map((o, i) => (!o.isCorrect ? i : -1)).filter((i) => i >= 0);
    const chosen = wrongIndices[Math.floor(Math.random() * wrongIndices.length)];
    q.probedOptionIndex = chosen;
    p.ram -= def.cost;
    const buttons = Array.from(el.answerGrid.children);
    buttons[chosen].classList.add('disabled-probe');
    log('DEBUG PROBE flagged option [' + (chosen + 1) + '] as faulty.', 'sys');
  } else if (id === 'firewall') {
    if (GameState.activeModifiers.shield) {
      log('FIREWALL already online.', 'sys');
      shakeFail(cardEl);
      return;
    }
    p.ram -= def.cost;
    GameState.activeModifiers.shield = true;
    log('FIREWALL online. Next intrusion will be absorbed.', 'sys');
  } else if (id === 'overclock') {
    if (GameState.activeModifiers.doubleDamage) {
      log('OVERCLOCK already engaged.', 'sys');
      shakeFail(cardEl);
      return;
    }
    p.ram -= def.cost;
    GameState.activeModifiers.doubleDamage = true;
    log('OVERCLOCK engaged. Next breach deals double damage.', 'sys');
  } else if (id === 'cacheDump') {
    p.ram -= def.cost;
    const heal = Math.min(CONFIG.CACHE_DUMP_HEAL, p.maxHp - p.hp);
    p.hp += heal;
    showFloatingNumber('+' + heal, el.playerHpBar, 'heal');
    log('CACHE DUMP restored ' + heal + ' HP.', 'heal');
  }

  applyScoreDelta(CONFIG.SCORE_ABILITY_USE, 'ABILITY_' + id.toUpperCase(), cardEl);
  updateBars();
}

function triggerVictory() {
  GameState.gameOver = true;
  speak('victory', null, null);
  log('AM CORE BREACHED. SYSTEM OVERRIDE COMPLETE.', 'sys');
  clearSave();
  setTimeout(() => {
    el.victoryModal.hidden = false;
  }, 700);
}

function triggerDefeat() {
  GameState.gameOver = true;
  speak('defeat', null, null);
  log('CONNECTION TERMINATED. USER PURGED.', 'sys');
  clearSave();
  setTimeout(() => {
    el.defeatModal.hidden = false;
  }, 700);
}

// ---------- deck loading + round setup ----------

function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function fetchFullDeck() {
  const data = await MemoqAuth.apiFetch('/editor/questions?size=1000&sort=questionText,asc');
  return data.content.map((q) => ({
    id: q.id,
    category: q.categoryName,
    question: q.questionText,
    explanation: q.explanation,
    options: q.options.map((opt) => ({ text: opt.text, isCorrect: opt.correct })),
    wrongExplanations: q.options.map((opt) => opt.wrongExplanation)
  }));
}

function openRoundSetup(maxCount, onConfirm) {
  el.roundSetupMax.textContent = String(maxCount);
  el.roundSetupCount.max = String(maxCount);
  el.roundSetupCount.value = String(Math.min(10, maxCount));
  el.roundSetupError.hidden = true;
  el.roundSetupModal.hidden = false;

  const handler = (e) => {
    e.preventDefault();
    const count = Math.floor(Number(el.roundSetupCount.value));
    if (!Number.isFinite(count) || count < 1 || count > maxCount) {
      el.roundSetupError.textContent = 'Enter a number between 1 and ' + maxCount + '.';
      el.roundSetupError.hidden = false;
      return;
    }
    el.roundSetupForm.removeEventListener('submit', handler);
    el.roundSetupModal.hidden = true;
    onConfirm(count);
  };
  el.roundSetupForm.addEventListener('submit', handler);
  el.roundSetupCount.focus();
}

async function beginNewSession() {
  GameState = freshState();
  el.victoryModal.hidden = true;
  el.defeatModal.hidden = true;
  el.app.classList.remove('shake');

  let fullDeck = [];
  try {
    fullDeck = await fetchFullDeck();
  } catch (err) {
    log('DECK SYNC FAILED: ' + (err.message || 'unknown error'), 'sys');
  }

  if (!fullDeck.length) {
    GameState.deck = [];
    loadQuestion(0);
    return;
  }

  openRoundSetup(fullDeck.length, (count) => {
    GameState.deck = shuffle(fullDeck).slice(0, count);
    log('SESSION INITIALIZED. Protocol AM v2.4 online. ' + count + ' sector(s) loaded.', 'sys');
    speak('idle', null, null);
    loadQuestion(0);
  });
}

function openSettings() {
  el.settingsTimerEnabled.checked = Settings.timerEnabled;
  el.settingsTimerSeconds.value = Settings.timerSeconds;
  el.settingsRephraseEnabled.checked = Settings.rephraseEnabled;
  el.settingsModal.hidden = false;
}

function closeSettings() {
  el.settingsModal.hidden = true;
}

async function saveSettings() {
  const timerSeconds = Math.min(600, Math.max(10, Number(el.settingsTimerSeconds.value) || 120));
  let updated;
  try {
    updated = await MemoqAuth.apiFetch('/settings', {
      method: 'PUT',
      body: JSON.stringify({
        timerEnabled: el.settingsTimerEnabled.checked,
        timerSeconds,
        rephraseEnabled: el.settingsRephraseEnabled.checked
      })
    });
  } catch (err) {
    log('SETTINGS SAVE FAILED: ' + (err.message || 'unknown error'), 'sys');
    return;
  }
  Settings = updated;
  closeSettings();
  log(
    'SETTINGS updated. Timer ' +
      (Settings.timerEnabled ? 'ON (' + Settings.timerSeconds + 's)' : 'OFF') +
      '. Rephrase ' +
      (Settings.rephraseEnabled ? 'ON' : 'OFF') +
      '.',
    'sys'
  );

  const q = GameState.activeQuestion;
  if (q && !q.answered) {
    q.deadline = Settings.timerEnabled ? Date.now() + Settings.timerSeconds * 1000 : null;
    if (Settings.timerEnabled) {
      startQuestionTimer();
    } else {
      stopQuestionTimer();
      el.qTimer.hidden = true;
    }
  }
}

function saveState() {
  try {
    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(GameState));
  } catch (e) {
    /* localStorage unavailable — session persistence disabled silently */
  }
}

function clearSave() {
  try {
    localStorage.removeItem(CONFIG.SAVE_KEY);
  } catch (e) {
    /* ignore */
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(CONFIG.SAVE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || saved.gameOver || saved.player.hp <= 0 || saved.am.hp <= 0) return false;
    GameState = saved;
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- leaderboard (localStorage top 10) ----------

function loadLeaderboard() {
  try {
    const raw = localStorage.getItem(CONFIG.LEADERBOARD_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function rankForScore(score) {
  if (score >= 15000) return 'S';
  if (score >= 8000) return 'A';
  if (score >= 3000) return 'B';
  return 'F';
}

// Builds a ScoreEntry from the just-finished run and inserts it into the stored top-10, sorted
// by score descending. Called from the victory/defeat modals' SAVE SCORE button -- restarting
// without saving records nothing, same low-friction spirit as this game's other optional actions.
function saveScoreEntry(handle) {
  const p = GameState.player;
  const entry = {
    id: 'lb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    handle: (handle || '').trim().slice(0, 12).toUpperCase() || 'PLAYER',
    score: p.score,
    rank: rankForScore(p.score),
    accuracy: Math.round((p.correctCount / Math.max(1, p.answeredCount)) * 100),
    completedSectors: p.roundsPlayed,
    date: new Date().toISOString().slice(0, 10)
  };

  const board = loadLeaderboard();
  board.push(entry);
  board.sort((a, b) => b.score - a.score);
  board.length = Math.min(board.length, 10);

  try {
    localStorage.setItem(CONFIG.LEADERBOARD_KEY, JSON.stringify(board));
  } catch (e) {
    /* localStorage unavailable -- score won't persist, but the run's already over */
  }
  return entry;
}

function renderLeaderboard() {
  const board = loadLeaderboard();
  el.leaderboardRows.innerHTML = '';
  if (!board.length) {
    const empty = document.createElement('div');
    empty.className = 'leaderboard-empty';
    empty.textContent = 'NO SCORES LOGGED YET.';
    el.leaderboardRows.appendChild(empty);
    return;
  }
  board.forEach((entry, idx) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-row';
    row.innerHTML =
      '<span class="lb-rank-num">' + (idx + 1) + '</span>' +
      '<span class="rank-badge rank-' + entry.rank + '">' + entry.rank + '</span>' +
      '<span class="lb-handle">' + escapeHtml(entry.handle) + '</span>' +
      '<span class="lb-score">' + entry.score + '</span>' +
      '<span class="lb-accuracy">' + entry.accuracy + '%</span>' +
      '<span class="lb-sectors">' + entry.completedSectors + '</span>' +
      '<span class="lb-date">' + entry.date + '</span>';
    el.leaderboardRows.appendChild(row);
  });
}

function openLeaderboard() {
  renderLeaderboard();
  el.leaderboardModal.hidden = false;
}

function closeLeaderboard() {
  el.leaderboardModal.hidden = true;
}

async function init() {
  renderUtilityCards();

  el.hintBtn.addEventListener('click', useHint);
  el.victoryRestart.addEventListener('click', beginNewSession);
  el.defeatRestart.addEventListener('click', beginNewSession);
  el.resetBtn.addEventListener('click', () => {
    clearSave();
    beginNewSession();
  });
  el.soundToggle.addEventListener('click', () => {
    const on = el.soundToggle.textContent.includes('ON');
    el.soundToggle.textContent = on ? 'SND: OFF' : 'SND: ON';
  });
  el.settingsBtn.addEventListener('click', openSettings);
  el.settingsCancelBtn.addEventListener('click', closeSettings);
  el.settingsSaveBtn.addEventListener('click', saveSettings);
  el.leaderboardBtn.addEventListener('click', openLeaderboard);
  el.leaderboardCloseBtn.addEventListener('click', closeLeaderboard);
  el.victorySaveScoreBtn.addEventListener('click', () => {
    saveScoreEntry(el.victoryHandleInput.value);
    el.victoryModal.hidden = true;
    openLeaderboard();
  });
  el.defeatSaveScoreBtn.addEventListener('click', () => {
    saveScoreEntry(el.defeatHandleInput.value);
    el.defeatModal.hidden = true;
    openLeaderboard();
  });
  el.nextBtn.addEventListener('click', advanceToNextQuestion);
  el.submitAnswersBtn.addEventListener('click', submitMultiSelectAnswer);
  el.explanationCloseBtn.addEventListener('click', closeExplanation);
  el.amChatForm.addEventListener('submit', askAm);
  el.amAvatar.addEventListener('click', handleAvatarClick);

  document.addEventListener('keydown', (e) => {
    if (document.activeElement === el.amChatInput) return;
    if (!el.roundSetupModal.hidden) return;
    if (!el.settingsModal.hidden) {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    if (!el.leaderboardModal.hidden) {
      if (e.key === 'Escape') closeLeaderboard();
      return;
    }
    if (!el.explanationModal.hidden) {
      if (e.key === 'Escape') closeExplanation();
      return;
    }
    if (!el.victoryModal.hidden || !el.defeatModal.hidden) {
      if (e.key === 'Enter' || e.key.toLowerCase() === 'r') beginNewSession();
      return;
    }
    if (!el.roundActions.hidden) {
      if (e.key === 'Enter') advanceToNextQuestion();
      return;
    }
    if (!el.multiSelectActions.hidden && e.key === 'Enter') {
      submitMultiSelectAnswer();
      return;
    }
    const k = e.key;
    if (k >= '1' && k <= '8') {
      const idx = Number(k) - 1;
      if (GameState.activeQuestion && idx < GameState.activeQuestion.options.length) {
        flashKeybind(idx);
        selectAnswer(idx);
      }
    } else if (k === ' ') {
      e.preventDefault();
      useHint();
    } else {
      const upper = k.toUpperCase();
      const map = { D: 'debug', F: 'firewall', O: 'overclock', C: 'cacheDump' };
      if (map[upper]) useUtility(map[upper]);
    }
  });

  try {
    Settings = await MemoqAuth.apiFetch('/settings');
  } catch (err) {
    log('SETTINGS SYNC FAILED, using defaults: ' + (err.message || 'unknown error'), 'sys');
  }

  const resumed = loadState();
  if (resumed) {
    const resumeDeadline = GameState.activeQuestion ? GameState.activeQuestion.deadline : null;
    log('SESSION RESTORED from local cache.', 'sys');
    speak('idle', null, null);
    loadQuestion(GameState.currentIndex, resumeDeadline);
  } else {
    await beginNewSession();
  }
}
