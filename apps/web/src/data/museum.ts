// The Career Museum's collection: Hasan Hmedeh's CV, one framed picture per job, project or
// achievement, hung in order down the hall and grouped by the year it started. Pictures live in
// public/museum/; an exhibit without one (or whose file fails to load) gets a placeholder print.

export interface Exhibit {
  id: string;
  /** The year it hangs under (see SECTIONS). */
  section: SectionId;
  /** When, as printed on the frame: "Sep 2022 – Feb 2023". */
  when: string;
  title: string;
  /** Who it was for, or where. */
  org: string;
  /** A short line under the org on the frame. */
  kicker?: string;
  /** Picture in the frame, a path under public/; without one the frame shows a placeholder with `icon`. */
  image?: string;
  /** The card behind the picture (dark for a white logo); white by default. */
  bg?: string;
  /** 'cover' fills the card (a photo); a logo is fitted whole. */
  fill?: 'contain' | 'cover';
  icon: string;
  /** The frame's colour accent. */
  accent: string;
  /** What the viewer's card says, one paragraph or bullet each. */
  lines: string[];
  tags: string[];
  links?: { label: string; href: string }[];
  /** Where the picture comes from, credited on the card. */
  credit?: string;
}

export const SECTIONS = {
  '2019': { title: 'University', blurb: 'A bachelor at the Lebanese University' },
  '2021': { title: 'Contests', blurb: 'Competitive programming' },
  '2022': { title: 'First jobs', blurb: 'Backend work on trading products' },
  '2023': { title: 'Poyesis · Junior', blurb: 'Video tools on FFMPEG' },
  '2024': { title: 'Poyesis · Senior', blurb: 'Projects run end to end' },
  '2026': { title: 'Today', blurb: 'You are here' },
} as const;
export type SectionId = keyof typeof SECTIONS;

export const PROFILE = {
  name: 'Hasan Hmedeh',
  headline: 'Full-stack Software Developer',
  since: '2019',
  summary:
    'Senior full-stack developer building scalable, high-performance web applications with React and NestJS, and cross-platform mobile apps with Flutter. Modern development practices, API integrations, and projects managed end to end, from the first meeting to delivery.',
  links: [
    { label: 'GitHub', href: 'https://github.com/hasanhmedeh' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/hasanhmedeh' },
  ],
  languages: [
    { name: 'Arabic', level: 'Native or bilingual' },
    { name: 'English', level: 'Full professional' },
  ],
};

const POYESIS = { label: 'poyesis.fr', href: 'https://poyesis.fr' };

export const EXHIBITS: Exhibit[] = [
  {
    id: 'bachelor',
    section: '2019',
    when: '2019 – 2022',
    title: 'Bachelor Degree',
    org: 'Lebanese University',
    kicker: 'and lab instructor for I1101',
    image: 'museum/lebanese-university.png',
    icon: '🎓',
    accent: '#2f6fb3',
    lines: [
      'A bachelor degree at the Lebanese University, from 2019 to 2022.',
      'Lab instructor: helped students in their labs and followed them through course I1101, which teaches the C programming language.',
    ],
    tags: ['C', 'Teaching'],
    credit: 'Logo: Lebanese University',
  },
  {
    id: 'contests',
    section: '2021',
    when: 'Nov 2021',
    title: 'LCPC Certificate',
    org: 'Qualified to the ACPC',
    kicker: 'Collegiate programming contests',
    image: 'museum/acpc.png',
    bg: '#1d1238',
    icon: '🏆',
    accent: '#d9a21b',
    lines: [
      'Earned the LCPC certificate. The LCPC is the yearly ICPC contest in Lebanon, and qualifies teams for the regional contest, the ACPC.',
      'Qualified to the ACPC in November 2021.',
    ],
    tags: ['Algorithms', 'Competitive programming'],
    credit: 'Logo: ACPC (its current branding)',
  },
  {
    id: 'salem',
    section: '2022',
    // as on the CV
    when: 'May 2022 – Sep 2023',
    title: 'Backend Developer · Internship',
    org: 'Salem Group',
    kicker: 'SIGNALS Platform',
    icon: '📶',
    accent: '#1f8a70',
    lines: [
      'SIGNALS: a product that helps traders find the best time to execute a position, efficiently manage their risk and reliably optimize their returns.',
      'React on the front end, NodeJS on the back end.',
    ],
    tags: ['React', 'Node.js'],
  },
  {
    id: 'btb',
    section: '2022',
    when: 'Sep 2022 – Feb 2023',
    title: 'Backend Developer',
    org: 'BTB Markets',
    kicker: 'Investment research platform',
    image: 'museum/btb-markets.png',
    bg: '#000000',
    icon: '💹',
    accent: '#0e5a8a',
    lines: [
      'A next generation of investment research, giving users quality insights and analysis on the current state of the market.',
      'Live market prices, from a Python script reading a MetaTrader 5 server.',
      'React on the front end, NodeJS on the back end.',
    ],
    tags: ['React', 'Node.js', 'Python', 'MetaTrader 5'],
    credit: 'Logo: BTB Markets',
  },
  {
    id: 'poyesis-junior',
    section: '2023',
    when: 'Feb 2023 – Dec 2023',
    title: 'Junior Web Developer',
    org: 'Poyesis',
    kicker: 'Video tools on FFMPEG',
    image: 'museum/poyesis.png',
    bg: '#0e1633',
    icon: '🧑‍💻',
    accent: '#7b5cd6',
    lines: [
      'Joined Poyesis, a studio building custom websites and mobile apps, as a junior web developer.',
      'Built two video tools on FFMPEG: one in the browser, one on the desktop (the next two frames).',
    ],
    tags: ['FFMPEG', 'Electron', 'Web'],
    links: [POYESIS],
    credit: 'Logo: Poyesis',
  },
  {
    id: 'video-editing',
    section: '2023',
    when: '2023',
    title: 'Video Editing Tool',
    org: 'Poyesis',
    kicker: 'Web · FFMPEG',
    image: 'museum/ffmpeg.png',
    icon: '🎬',
    accent: '#c9304f',
    lines: [
      'A web-based video editing tool built on FFMPEG, for efficient video processing and editing.',
      'Advanced video manipulation workflows behind a user-friendly interface, with seamless performance and accessibility.',
    ],
    tags: ['FFMPEG', 'Web'],
    credit: 'Logo: FFmpeg, the library the tool is built on',
  },
  {
    id: 'video-enhancement',
    section: '2023',
    when: '2023',
    title: 'Video Enhancement Tool',
    org: 'Poyesis',
    kicker: 'Electron · FFMPEG · GPU',
    image: 'museum/anaphora.png',
    bg: '#eef1f5',
    icon: '✨',
    accent: '#2ec4b6',
    lines: [
      'A desktop app built with Electron and FFMPEG that improves video quality: it removes dust, stabilizes footage and optimizes granularity.',
      'GPU acceleration for efficient processing and better performance.',
    ],
    tags: ['Electron', 'FFMPEG', 'GPU'],
    credit: 'Picture: the Anaphora app, from Poyesis’s references',
  },
  {
    id: 'poyesis-senior',
    section: '2024',
    when: 'Jan 2024 – today',
    title: 'Senior Software Developer',
    org: 'Poyesis',
    kicker: 'Projects, clients and deployments',
    image: 'museum/poyesis.png',
    bg: '#0e1633',
    icon: '🚀',
    accent: '#7b5cd6',
    lines: [
      'Project management: ran several projects on my own, from inception to delivery, including talking directly with clients.',
      'Task management: ran the Trello boards on my own, creating and organizing the tickets.',
      'DevOps: deployed front ends (web on AWS CloudFront, and mobile) and back ends on AWS EC2, on my own.',
    ],
    tags: ['AWS CloudFront', 'AWS EC2', 'Trello'],
    links: [POYESIS],
    credit: 'Logo: Poyesis',
  },
  {
    id: 'aston-medical',
    section: '2024',
    when: '2024',
    title: 'Aston Medical',
    org: 'Synchronized with Leon',
    kicker: 'Organ transport flights for Clair Group',
    image: 'museum/aston-medical.jpg',
    fill: 'cover',
    icon: '🩺',
    accent: '#155e75',
    lines: [
      'Delivered Aston Medical, synchronized with Leon, from minimal API documentation and under tight deadlines.',
      'The platform manages the private jets chartered to carry organs for transplant for the Paris hospitals (AP-HP), and plugs into Clair Group’s business tools.',
    ],
    tags: ['React', 'Node.js', 'API integration'],
    links: [{ label: 'Project page on poyesis.fr', href: 'https://poyesis.fr/en/reference/clair-group/' }],
    credit: 'Picture: Aston Medical’s logo over Poyesis’s mockup of the platform',
  },
  {
    id: 'clair-billing',
    section: '2024',
    when: 'Poyesis · Senior',
    title: 'Clair Group Billing',
    org: 'Team lead',
    kicker: 'Led with a junior developer',
    image: 'museum/clair-group.png',
    bg: '#101a33',
    icon: '🧾',
    accent: '#ff8a3d',
    lines: [
      'Led Clair Group Billing with a junior developer: guidance, mentoring, and on-time delivery.',
      'Clair Group is one of the European leaders in private aviation.',
    ],
    tags: ['Team leadership', 'Mentoring'],
    links: [{ label: 'Clair Group on poyesis.fr', href: 'https://poyesis.fr/en/reference/clair-group/' }],
    credit: 'Logo: Clair Group, from poyesis.fr',
  },
  {
    id: 'mission-prepare-test',
    section: '2024',
    when: 'Poyesis · Senior',
    title: 'Mission Prepare Test',
    org: 'Flutter app',
    kicker: 'Learned Flutter for it',
    image: 'museum/mission-prepartest.png',
    bg: '#f4f8e8',
    icon: '📱',
    accent: '#027dfd',
    lines: [
      'Learned Flutter and delivered a fully functional app on my own.',
      'Mission Prepar’Test: test your basics in French and maths, then revise only what you need, 15 minutes a day.',
    ],
    tags: ['Flutter', 'Dart'],
    links: [{ label: 'App Store', href: 'https://apps.apple.com/fr/app/mission-prepartest/id6473256547' }],
    credit: 'App icon: Mission Prepar’Test on the App Store',
  },
  {
    id: 'funfair',
    section: '2026',
    when: 'Oct 2026',
    title: 'The Funfair',
    org: "You're standing in it",
    kicker: 'A 3D theme park in the browser',
    image: 'og-image.jpg',
    fill: 'cover',
    icon: '🎡',
    accent: '#ff4d6d',
    lines: [
      'A 3D funfair in the browser: coasters you drive, a kart race, a rally time trial with a daily leaderboard, accounts and tickets, a back office for staff, live updates, and this museum.',
      'Three.js, cannon-es and TypeScript for the game; NestJS, Prisma and PostgreSQL for the accounts; a pnpm + Turborepo monorepo on Vercel.',
    ],
    tags: ['Three.js', 'TypeScript', 'NestJS', 'Prisma', 'PostgreSQL', 'Vercel'],
    links: [{ label: 'Source on GitHub', href: 'https://github.com/hasanhmedeh/my-fun-park' }],
    credit: 'Picture: the fair itself',
  },
];

/** The toolbox on the hall's end wall: the CV's skills, with a logo each (or a monogram without one). Logos: devicon. */
export const SKILLS: { name: string; image?: string; color: string }[] = [
  { name: 'C', image: 'museum/skills/c.png', color: '#5c6bc0' },
  { name: 'C#', image: 'museum/skills/csharp.png', color: '#68217a' },
  { name: 'HTML', image: 'museum/skills/html.png', color: '#e44d26' },
  { name: 'CSS', image: 'museum/skills/css.png', color: '#264de4' },
  { name: 'JavaScript', image: 'museum/skills/javascript.png', color: '#f0db4f' },
  { name: 'TypeScript', image: 'museum/skills/typescript.png', color: '#3178c6' },
  { name: 'Python', image: 'museum/skills/python.png', color: '#3776ab' },
  { name: 'PHP', image: 'museum/skills/php.png', color: '#777bb4' },
  { name: 'Java', image: 'museum/skills/java.png', color: '#e76f00' },
  { name: '.NET Core', image: 'museum/skills/dotnet.png', color: '#512bd4' },
  { name: 'SQL', color: '#336791' },
  { name: 'React', image: 'museum/skills/react.png', color: '#61dafb' },
  { name: 'Next.js', image: 'museum/skills/nextjs.png', color: '#111111' },
  { name: 'NestJS', image: 'museum/skills/nestjs.png', color: '#e0234e' },
  { name: 'Laravel', image: 'museum/skills/laravel.png', color: '#ff2d20' },
  { name: 'Django', image: 'museum/skills/django.png', color: '#092e20' },
  { name: 'Git', image: 'museum/skills/git.png', color: '#f05032' },
  { name: 'MySQL', image: 'museum/skills/mysql.png', color: '#00758f' },
  { name: 'MongoDB', image: 'museum/skills/mongodb.png', color: '#47a248' },
  { name: 'PostgreSQL', image: 'museum/skills/postgresql.png', color: '#336791' },
  { name: 'Flutter', image: 'museum/skills/flutter.png', color: '#02569b' },
  { name: 'Dart', image: 'museum/skills/dart.png', color: '#0175c2' },
];
