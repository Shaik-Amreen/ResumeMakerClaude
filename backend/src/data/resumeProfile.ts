/**
 * Base resume profile extracted from Shaik_Amreen_Kousar_Resume (6).pdf and (7).pdf.
 * Used as source context when tailoring LaTeX resumes to job descriptions.
 */
export const resumeProfile = {
  name: 'Shaik Amreen Kousar',
  headline: 'Full Stack Engineer — Web Applications & Cloud — MS Computer Science, CSULB',
  email: 'AmreenKousar.Shaik01@student.csulb.edu',
  phone: '+1 562-269-6008',
  location: 'Long Beach, California',
  linkedin: 'https://linkedin.com/in/shaikamreenkousar',
  portfolio: 'https://shaik-amreen-kousar.onrender.com',
  education: [
    {
      degree: 'Master of Science in Computer Science',
      school: 'California State University, Long Beach (CSULB)',
      dates: 'Jan 2026 – May 2027 (expected)',
      graduation: 'May 2027 (full-time) / Jan 2028 (internship eligibility)',
      coursework:
        'Software Engineering, Algorithms, Distributed Systems, Programming Languages, Data Structures, OOP, Operating Systems, Database Systems, Computer Networks',
    },
    {
      degree: 'B.Tech in Computer Science (GPA: 3.69/4.0)',
      school: 'JNTU Anantapur – MITS',
      dates: 'Aug 2019 – May 2023',
    },
  ],
  experience: [
    'Web Developer — Associated Students Inc. (ASI), CSULB (Apr 2026 – Present): responsive web apps, reusable interfaces, backend integrations, cross-functional delivery.',
    'Senior Software Engineer — AMD / Infobell IT Solutions (Mar 2024 – Dec 2025): full-stack apps for 100K+ users, React.js, Node.js, REST APIs, CI/CD (GitLab/AWS), 35% faster APIs, 40% faster deploys, Cloudflare CDN, Agile/Jira.',
    'Full Stack Web & Mobile Developer — Infobell IT Solutions (Jan 2023 – Mar 2024): React.js, Redux, React Native, Node.js, Firebase, MongoDB, App Store/Play Store deployments.',
    'MEAN Stack Developer Intern — Redbee 365 Studio (Sep – Dec 2022): Angular, Node.js, Express, MongoDB, 25% API improvement.',
    'React Native Developer Intern — Earthetic (Jul – Oct 2022): React Native CLI, iOS/Android.',
    'MERN Stack Developer Intern — Yes Real Technologies (Jan – Jun 2022): college ERP system.',
    'Backend Developer Intern — Hirecraft (Jul – Aug 2020): Node.js, MongoDB, multi-language support.',
  ],
  skills: {
    languages: 'JavaScript, TypeScript, Python, Java, SQL, Go, PHP, C++, HTML5, CSS3',
    frontend:
      'React.js, Next.js, Angular, Vue.js, Redux, React Native, Tailwind CSS, Bootstrap, Material-UI, WCAG, performance optimization, SEO',
    backend: 'Node.js, Express.js, Nest.js, Spring Boot, REST APIs, GraphQL, Microservices',
    databases: 'MongoDB, PostgreSQL, MySQL, Redis, Firebase',
    cloud: 'AWS (EC2, S3, CloudFront), Docker, Kubernetes, GitHub Actions, GitLab CI/CD, Cloudflare CDN',
    practices:
      'Software architecture, system design, SDLC, Agile/SCRUM, Git, code reviews, testing, debugging, security, performance optimization',
  },
  projects: [
    'NativeNest — E-commerce platform (30K+ users): React, React Native, Node.js, PostgreSQL, Redis, AWS, Docker, K8s, 99.9% uptime.',
    'B4IGO — Digital legacy platform: React, React Native, Node.js, MongoDB, blockchain, AWS, secure vaults.',
    'Origem India — Next.js commerce: Node.js, MongoDB, Stripe/Razorpay, AWS, Cloudflare.',
    'Benchmark Automation — AMD: Vue.js, Node.js, GitLab, Jira automation workflows.',
    'ASI ADP Job Alerts — React, Python, MongoDB, GitHub Actions, Vercel.',
    'Upturn — AI stock advisory: React Native, Angular, Firebase, Python.',
  ],
  publications:
    'Accurate Fake News Detection Using KNN, LSTM, MLP and CNN — ICCTDC 2025, IEEE Xplore (98% accuracy hybrid model).',
  certifications: [
    'Frontend Developer – React (HackerRank, Jan 2025)',
    'JavaScript Intermediate (HackerRank, Jul 2022)',
    'SQL Intermediate (HackerRank, Feb 2022)',
    'Problem Solving, Python, SQL Basic (HackerRank)',
  ],
};

export function formatResumeProfileForPrompt(): string {
  const r = resumeProfile;
  return `
CANDIDATE PROFILE (use this as the source of truth — tailor emphasis to the JD, do not invent experience):

Name: ${r.name}
Headline: ${r.headline}
Email: ${r.email} | Phone: ${r.phone} | Location: ${r.location}
LinkedIn: ${r.linkedin} | Portfolio: ${r.portfolio}

EDUCATION:
${r.education.map((e) => `- ${e.degree} — ${e.school} (${e.dates})${e.graduation ? ` | Grad: ${e.graduation}` : ''}`).join('\n')}

EXPERIENCE:
${r.experience.map((e) => `- ${e}`).join('\n')}

SKILLS:
- Languages: ${r.skills.languages}
- Frontend: ${r.skills.frontend}
- Backend: ${r.skills.backend}
- Databases: ${r.skills.databases}
- Cloud/DevOps: ${r.skills.cloud}
- Practices: ${r.skills.practices}

PROJECTS:
${r.projects.map((p) => `- ${p}`).join('\n')}

PUBLICATIONS: ${r.publications}

CERTIFICATIONS: ${r.certifications.join('; ')}
`.trim();
}
