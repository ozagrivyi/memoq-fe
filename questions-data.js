'use strict';

const DEFAULT_QUESTIONS = [
  {
    id: 'q1', category: 'Networking', difficulty: 'easy',
    question: 'Which layer of the OSI model is responsible for routing packets between different networks?',
    code: null,
    options: [
      { text: 'Layer 2 - Data Link', isCorrect: false },
      { text: 'Layer 3 - Network', isCorrect: true },
      { text: 'Layer 4 - Transport', isCorrect: false },
      { text: 'Layer 7 - Application', isCorrect: false }
    ],
    hint: 'This layer uses logical addressing (IP) to determine the best path.'
  },
  {
    id: 'q2', category: 'HTTP', difficulty: 'easy',
    question: 'What does an HTTP 429 status code indicate?',
    code: null,
    options: [
      { text: 'Internal Server Error', isCorrect: false },
      { text: 'Too Many Requests', isCorrect: true },
      { text: 'Forbidden', isCorrect: false },
      { text: 'Gateway Timeout', isCorrect: false }
    ],
    hint: 'The client has hit a rate limit set by the server.'
  },
  {
    id: 'q3', category: 'Docker', difficulty: 'medium',
    question: 'What is the effect of this Dockerfile instruction on layer caching?',
    code: 'COPY package.json .\nRUN npm install\nCOPY . .',
    options: [
      { text: 'Dependencies reinstall on every source change', isCorrect: false },
      { text: 'Dependencies are cached unless package.json changes', isCorrect: true },
      { text: 'This Dockerfile is syntactically invalid', isCorrect: false },
      { text: 'It disables caching entirely', isCorrect: false }
    ],
    hint: 'Docker caches each layer; copying package.json first isolates the install step.'
  },
  {
    id: 'q4', category: 'Linux', difficulty: 'medium',
    question: 'A file has permissions "rwxr-xr--". What is its octal representation?',
    code: null,
    options: [
      { text: '764', isCorrect: false },
      { text: '754', isCorrect: true },
      { text: '744', isCorrect: false },
      { text: '774', isCorrect: false }
    ],
    hint: 'Convert each triad (owner/group/other) separately: rwx=7, r-x=5, r--=4.'
  },
  {
    id: 'q5', category: 'Git', difficulty: 'easy',
    question: 'Which command creates a new branch and switches to it in a single step?',
    code: null,
    options: [
      { text: 'git branch feature-x', isCorrect: false },
      { text: 'git switch feature-x', isCorrect: false },
      { text: 'git checkout -b feature-x', isCorrect: true },
      { text: 'git merge feature-x', isCorrect: false }
    ],
    hint: 'The -b flag tells checkout to create the branch before switching.'
  },
  {
    id: 'q6', category: 'Networking', difficulty: 'hard',
    question: 'During a TCP three-way handshake, what is the correct sequence of flags exchanged?',
    code: null,
    options: [
      { text: 'SYN -> SYN-ACK -> ACK', isCorrect: true },
      { text: 'SYN -> ACK -> SYN-ACK', isCorrect: false },
      { text: 'ACK -> SYN -> FIN', isCorrect: false },
      { text: 'SYN -> FIN -> ACK', isCorrect: false }
    ],
    hint: 'Client initiates with SYN, server responds with SYN-ACK, client confirms with ACK.'
  },
  {
    id: 'q7', category: 'DevOps', difficulty: 'medium',
    question: 'In a CI/CD pipeline, what is the primary purpose of a "canary deployment"?',
    code: null,
    options: [
      { text: 'To roll back all instances instantly', isCorrect: false },
      { text: 'To release a change to a small subset of users before full rollout', isCorrect: true },
      { text: 'To encrypt secrets in the pipeline', isCorrect: false },
      { text: 'To run unit tests in parallel', isCorrect: false }
    ],
    hint: 'Named after canaries in coal mines — an early warning system for problems.'
  },
  {
    id: 'q8', category: 'Networking', difficulty: 'hard',
    question: 'Given the CIDR block 192.168.10.0/26, how many usable host addresses are available?',
    code: null,
    options: [
      { text: '30', isCorrect: false },
      { text: '62', isCorrect: true },
      { text: '64', isCorrect: false },
      { text: '126', isCorrect: false }
    ],
    hint: '/26 leaves 6 host bits: 2^6 = 64 total addresses, minus network and broadcast.'
  },
  {
    id: 'q9', category: 'Kubernetes', difficulty: 'medium',
    question: 'Which Kubernetes object ensures a specified number of identical pod replicas are running at all times?',
    code: null,
    options: [
      { text: 'ConfigMap', isCorrect: false },
      { text: 'Service', isCorrect: false },
      { text: 'ReplicaSet', isCorrect: true },
      { text: 'Ingress', isCorrect: false }
    ],
    hint: 'Deployments manage this object under the hood to maintain replica count.'
  },
  {
    id: 'q10', category: 'Linux', difficulty: 'easy',
    question: 'What does this cron expression schedule?',
    code: '0 3 * * 1',
    options: [
      { text: 'Every day at 3:00 AM', isCorrect: false },
      { text: 'Every Monday at 3:00 AM', isCorrect: true },
      { text: 'Every hour on Monday', isCorrect: false },
      { text: 'Every 3 minutes on Mondays', isCorrect: false }
    ],
    hint: 'Fields are: minute hour day-of-month month day-of-week. 1 = Monday.'
  },
  {
    id: 'q11', category: 'DevOps', difficulty: 'hard',
    question: 'A load balancer uses "least connections" as its algorithm. What does this mean?',
    code: null,
    options: [
      { text: 'Traffic is sent round-robin regardless of load', isCorrect: false },
      { text: 'Traffic is sent to the server with the fewest active connections', isCorrect: true },
      { text: 'Traffic is sent based on geographic proximity only', isCorrect: false },
      { text: 'Traffic is sent to a single fixed server', isCorrect: false }
    ],
    hint: 'The algorithm actively tracks how many open connections each backend currently holds.'
  },
  {
    id: 'q12', category: 'Security', difficulty: 'medium',
    question: 'What is the main risk of storing plaintext secrets in environment variables committed to a repo?',
    code: null,
    options: [
      { text: 'Slower application startup time', isCorrect: false },
      { text: 'Secrets become visible in version history to anyone with repo access', isCorrect: true },
      { text: 'It increases Docker image size significantly', isCorrect: false },
      { text: 'It breaks CI pipeline caching', isCorrect: false }
    ],
    hint: 'Version control history is persistent — deleting a file later does not erase it from git log.'
  }
];
