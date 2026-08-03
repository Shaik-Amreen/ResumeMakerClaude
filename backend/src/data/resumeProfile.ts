/**
 * Base resume profile for Karthik Kovi.
 * Used as source context when tailoring LaTeX resumes to job descriptions.
 */
export const resumeProfile = {
  name: 'Karthik Kovi',
  /** Exact LaTeX header name (pipeline-locked). */
  preferredResumeName: 'KARTHIK KOVI',
  headline:
    'Software Engineer | Full Stack Developer | React, React Native, Node.js, GraphQL, AWS | M.S. Computer Science Candidate, CSULB',
  email: 'karthikkovik@gmail.com',
  phone: '+1 562-284-0297',
  location: 'Long Beach, California',
  linkedin: 'https://www.linkedin.com/in/karthikkovi',
  portfolio: 'https://karthikkovi.com',
  education: [
    {
      degree: 'Master of Science in Computer Science',
      school: 'California State University, Long Beach (CSULB)',
      dates: 'Jan 2025 – Jan 2027 (expected)',
      graduation: 'January 2027',
      gpa: '3.67',
    },
    {
      degree: 'Bachelor of Technology in Computer Science (GPA: 3.60/4.0)',
      school: 'Madanapalle Institute of Technology and Science (JNTU Anantapur)',
      dates: 'Aug 2019 – May 2023',
    },
  ],
  experience: [
    'Software Developer — Associated Students, Inc. (ASI), CSULB (Feb 2025 – Present): FutureU Mobile App and 22WestMedia website for 12,000+ monthly users; WCAG 2.1/2.2 AA; campus SSO and audio streaming SDK; GitHub Actions CI/CD (−40% deploy effort); WordPress publishing (+50% efficiency); AWS LightSail/S3 (−30% page load).',
    'Full Stack Developer — Infobell IT Solutions Pvt Ltd, Bengaluru (Jul 2023 – Jan 2025): Led 4-engineer team on NativeNest (30,000+ users); GraphQL APIs (−30% checkout latency); Origem Next.js/Redis storefront; MirrorMate Windows Miracast app (C#); mentored interns; six Agile releases.',
    'Full Stack Developer Intern — Infobell IT Solutions Pvt Ltd, Bengaluru (Jan 2023 – Jun 2023): Angular dashboards, REST APIs, Jest coverage to 80%, Swagger docs.',
    'Full Stack Developer (Contract & Intern) — Redbee 365 Studio / Vasukam / Yes Real Technologies (Feb 2021 – Dec 2022): 5+ production MEAN/MERN projects; SQL reporting 2x faster.',
  ],
  skills: {
    languages: 'JavaScript, TypeScript, Python, Java, C, C++, C#',
    frontend: 'React, React Native, Angular, Next.js, HTML, CSS, Bootstrap, Tailwind CSS',
    backend: 'Node.js, Express.js, NestJS, Flask, PHP, GraphQL, REST APIs',
    databases: 'MongoDB, PostgreSQL, MySQL, Redis',
    cloud:
      'AWS (EC2, S3, Lambda, LightSail), Docker, GitHub Actions, GitOps, CI/CD',
    practices:
      'Data Structures, Algorithms, OOP, Agile, WCAG Accessibility, JWT, SonarQube, Swagger, Postman, Jest, Jira, WordPress, Elementor, SEO, Performance Optimization',
  },
  projects: [
    'NativeNest — Grocery commerce (30,000+ users): React Native, React, GraphQL, Node.js, MongoDB, AWS — https://nativenest.in',
    'Origem Jewellery — Next.js commerce with Redis/Magento: Next.js, Redis, Node.js, Tailwind, Magento, Razorpay — https://origemindia.com',
    'FutureU — CSULB student engagement: React Native, Node.js, AWS — https://www.asicsulb.org/corporate/discover/futureu',
    'ARIKYA — Training/placement SaaS: Angular, React Native, Node.js, AWS — https://arikya.in',
    'Booking Bee — AI appointment booking: Angular, NestJS, MongoDB, Dasha AI — https://bookingbee.ai',
    'MirrorMate — Windows screen casting: C#, Miracast',
    'AI Based Slum Control — Smart India Hackathon: Angular, Node.js, Twilio',
  ],
  publications: '',
  certifications: [
    'HackerRank JavaScript',
    'HackerRank Python',
    'HackerRank SQL',
    'HackerRank AngularJS',
    'HackerRank Problem Solving',
    'Wipro TalentNext',
    'Coursera AI for Everyone',
    'Coursera HTML',
    'NPTEL Ethical Hacking',
    'NPTEL Soft Skills',
  ],
  awards: [
    'ISTE AP Best Student Innovator Gold Medal',
    'Smart India Hackathon National Finalist',
    'Tech/Web Club Coordinator and Mentor',
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
${r.education
  .map(
    (e) =>
      `- ${e.degree} — ${e.school} (${e.dates})${e.graduation ? ` | Grad: ${e.graduation}` : ''}${
        e.gpa ? ` | GPA: ${e.gpa}` : ''
      }`
  )
  .join('\n')}

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

PUBLICATIONS: ${r.publications || 'None'}

CERTIFICATIONS: ${r.certifications.join('; ')}

AWARDS: ${r.awards.join('; ')}
`.trim();
}
