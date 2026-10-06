// Single source of truth for the CV.
// It is rendered to static, crawlable HTML at build time (see vite.config.ts)
// and also feeds every attraction in the 3D funfair.


export interface Role {
  id: string;
  title: string;
  company: string;
  context?: string;
  start: string; // YYYY-MM
  end: string | null; // null = present
  highlights: { label: string; text: string }[];
  stack?: string;
}

export interface Project {
  name: string;
  where: string;
  text: string;
  tags: string[];
}

export const cv = {
  name: 'Hasan Hmedeh',
  firstName: 'Hasan',
  lastName: 'Hmedeh',
  title: 'Senior Full-Stack Software Developer',
  shortTitle: 'Full-stack Software Developer',
  location: 'Lebanon',
  email: 'hassanhmedeh@gmail.com',
  github: 'https://github.com/hasanhmedeh',
  linkedin: 'https://www.linkedin.com/in/hasanhmedeh',
  cvPdf: '/hasan-hmedeh-cv.pdf',
  summary:
    'Senior Full Stack Developer with 3 years of expertise in building scalable, high-performance web applications using React and NestJS. Proficient in crafting cross-platform mobile solutions with Flutter, delivering seamless user experiences. Skilled in modern development practices, API integrations, and end-to-end project lifecycle management, ensuring high-quality and efficient software solutions.',

  experience: [
    {
      id: 'poyesis-senior',
      title: 'Senior Software Developer',
      company: 'Poyesis',
      start: '2024-01',
      end: null,
      highlights: [
        { label: 'Project Management', text: 'Successfully managed multiple projects independently, from inception to delivery, including direct communication with clients.' },
        { label: 'Task Management', text: 'Managed Trello boards autonomously, including creating and organizing tickets.' },
        { label: 'Complex Problem-Solving', text: 'Delivered challenging projects like Aston Medical synchronized with Leon using minimal API documentation under tight deadlines.' },
        { label: 'Team Leadership', text: 'Successfully led Clair Group Billing with a Junior Developer, providing guidance, mentoring, and ensuring timely delivery.' },
        { label: 'Learning and Adapting', text: 'Learned Flutter and delivered a fully functional project independently (Mission Prepare Test).' },
        { label: 'DevOps', text: 'Deployed frontend (web on AWS CloudFront, and mobile) and backend projects (AWS EC2) independently.' },
      ],
    },
    {
      id: 'poyesis-junior',
      title: 'Junior Web Developer',
      company: 'Poyesis',
      start: '2023-02',
      end: '2023-12',
      highlights: [
        { label: 'Video Editing Tool', text: 'Created a web-based Video Editing Tool using FFMPEG, enabling efficient video processing and editing. Integrated advanced video manipulation workflows into a user-friendly interface, ensuring seamless performance and accessibility.' },
        { label: 'Video Enhancement Tool', text: 'Developed a Video Enhancement Tool using Electron and FFMPEG, designed to improve video quality by removing dust, stabilizing footage, and optimizing granularity. Leveraged GPU acceleration for efficient processing and enhanced performance.' },
      ],
    },
    {
      id: 'btb',
      title: 'Backend Developer',
      company: 'BTB Markets',
      context: 'Investment Research Platform',
      start: '2022-09',
      end: '2023-02',
      highlights: [
        { label: 'Platform', text: 'A next generation of investment research that provides users with quality insights and analysis on the current market state.' },
        { label: 'Live Market Prices', text: 'Python script to access a MetaTrader 5 server for live market prices.' },
      ],
      stack: 'React on the front-end, NodeJS on the back-end',
    },
    {
      id: 'salem',
      title: 'Internship Backend Developer',
      company: 'Salem Group',
      context: 'SIGNALS Platform',
      start: '2022-05',
      end: '2023-09',
      highlights: [
        { label: 'Signals', text: 'Signals product made to help traders identify the best time to execute a position, efficiently manage their risk, and reliably optimize their returns.' },
      ],
      stack: 'React on the front-end, NodeJS on the back-end',
    },
  ] satisfies Role[],

  education: {
    degree: 'Bachelor Degree',
    school: 'Lebanese University',
    start: '2019',
    end: '2022',
    highlights: [
      { label: 'Achievements', text: 'LCPC Certificate and got qualified to ACPC (11/2021).' },
      { label: 'Instructor', text: 'Helped students in their labs and followed them in course I1101, which teaches the C programming language.' },
    ],
  },

  skills: {
    Languages: ['C', 'C#', 'Java', 'Python', 'PHP', 'JavaScript', 'TypeScript', 'SQL', 'Dart', 'HTML', 'CSS'],
    Frameworks: ['React', 'Next.js', 'NestJS', 'Laravel', 'Django', '.NET Core', 'Flutter'],
    'Data & Tools': ['MySQL', 'PostgreSQL', 'MongoDB', 'Git'],
  } as Record<string, string[]>,

  languages: [
    { name: 'Arabic', level: 'Native or Bilingual Proficiency' },
    { name: 'English', level: 'Full Professional Proficiency' },
  ],
};

/** Projects shown on the rollercoaster ride. */
export const projects: Project[] = [
  { name: 'Aston Medical × Leon', where: 'Poyesis', text: 'Synchronized Aston Medical with Leon using minimal API documentation, under tight deadlines.', tags: ['Integration', 'APIs', 'Deadlines'] },
  { name: 'Clair Group Billing', where: 'Poyesis', text: 'Led the billing project with a junior developer — guidance, mentoring and on-time delivery.', tags: ['Leadership', 'Mentoring'] },
  { name: 'Mission Prepare Test', where: 'Poyesis', text: 'Learned Flutter and shipped a fully functional mobile app independently.', tags: ['Flutter', 'Dart', 'Mobile'] },
  { name: 'Cloud Deployments', where: 'Poyesis', text: 'Deployed web frontends on AWS CloudFront, mobile apps, and backends on AWS EC2 — solo.', tags: ['AWS', 'CloudFront', 'EC2'] },
  { name: 'Video Editing Tool', where: 'Poyesis', text: 'A web-based video editor powered by FFMPEG with advanced manipulation workflows in a friendly UI.', tags: ['FFMPEG', 'Web'] },
  { name: 'Video Enhancement Tool', where: 'Poyesis', text: 'Electron + FFMPEG desktop tool removing dust, stabilizing footage and optimizing grain — GPU accelerated.', tags: ['Electron', 'FFMPEG', 'GPU'] },
  { name: 'BTB Markets', where: 'BTB Markets', text: 'Next-gen investment research platform, with live market prices streamed from a MetaTrader 5 server via Python.', tags: ['Python', 'NodeJS', 'React'] },
  { name: 'SIGNALS Platform', where: 'Salem Group', text: 'Helps traders find the best time to execute a position, manage risk and optimize returns.', tags: ['NodeJS', 'React', 'Trading'] },
];

/** Rocket timeline, from the launch pad to the current orbit. */
export const timeline = [
  { year: '2019', title: 'Lift-off', sub: 'Bachelor Degree — Lebanese University', text: 'Started my Bachelor Degree at the Lebanese University (2019 – 2022).' },
  { year: '2021', title: 'First booster', sub: 'LCPC certificate → ACPC qualifier', text: 'Earned the LCPC certificate and qualified to the ACPC (11/2021). Also helped fellow students as a lab instructor for I1101 (C programming).' },
  { year: '2022', title: 'Stage separation', sub: 'Internship Backend Developer — Salem Group', text: 'Built the SIGNALS platform backend (React + NodeJS), helping traders time positions and manage risk.' },
  { year: '2022', title: 'Climbing', sub: 'Backend Developer — BTB Markets', text: 'Investment research platform with live market prices pulled from a MetaTrader 5 server through Python.' },
  { year: '2023', title: 'Breaking the atmosphere', sub: 'Junior Web Developer — Poyesis', text: 'Shipped a web Video Editing Tool and an Electron + FFMPEG Video Enhancement Tool with GPU acceleration.' },
  { year: '2024', title: 'Orbit reached', sub: 'Senior Software Developer — Poyesis', text: 'Leading projects end-to-end: client communication, team leadership, Flutter apps and AWS deployments. Still climbing…' },
];

/** Achievements shown on the high striker. */
export const achievements = [
  { tier: 'Contender', text: 'LCPC Certificate holder' },
  { tier: 'Qualifier', text: 'Qualified to the ACPC (11/2021)' },
  { tier: 'Mentor', text: 'Lab instructor for I1101 (C programming) & mentor to a junior developer' },
  { tier: 'Champion', text: 'Delivered Aston Medical ↔ Leon sync with minimal API docs under tight deadlines' },
];

export function formatMonth(ym: string | null): string {
  if (!ym) return 'Present';
  const [y, m] = ym.split('-');
  if (!m) return y;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m) - 1]} ${y}`;
}
