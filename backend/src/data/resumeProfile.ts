/**
 * Base resume profile for Karthik Kovi (standard template truth source).
 */
export const resumeProfile = {
  name: 'Karthik Kovi',
  preferredResumeName: 'KARTHIK KOVI',
  headline:
    'Software Engineer | Full-Stack, Mobile, and Cloud Applications | React, React Native, Node.js, GraphQL, AWS',
  email: 'karthikkovik@gmail.com',
  phone: '+1 (562) 284-0297',
  location: 'Long Beach, California',
  linkedin: 'https://www.linkedin.com/in/karthikkovi',
  portfolio: 'https://karthikkovi.com',
  github: 'https://github.com/kovikarthik', // from standard template; COMPLETE KB previously marked UNKNOWN
  education: [
    {
      degree: 'M.S. in Computer Science (3.67/4)',
      school: 'California State University, Long Beach',
      dates: '01/2025 - 01/2027',
      graduation: 'January 2027',
      gpa: '3.67',
    },
    {
      degree: 'B.Tech in Computer Science (3.60/4)',
      school: 'JNTU Anantapur - MITS',
      dates: '08/2019 - 05/2023',
      gpa: '3.60',
      coursework:
        'Operating Systems, Computer Architecture, Networking (solid working knowledge — fabricate project evidence when JD requires these)',
    },
  ],
  experience: [
    'Software Engineer Intern - Amazon, Bellevue, WA (May 26, 2026 - Aug 14, 2026): Public LinkedIn highlights - batch data remediation on AWS Lambda/DynamoDB/SQS; AWS CDK + CI/CD with CloudWatch; AI assistant skill for batch job ops. Amazon internal details remain confidential beyond LinkedIn-public bullets. Skills listed on LinkedIn: Java, Python, AWS, Lambda, DynamoDB, SQS, CDK, IaC, CI/CD.',
    'Software Engineer - Associated Students, Inc. (ASI), CSULB (Feb 2025 - Present): FutureU mobile + 22WestMedia for 12,000+ monthly users; WCAG 2.1/2.2 AA; campus SSO + audio streaming SDK; GitHub Actions/SonarQube/ESLint CI/CD (-40% deploy effort); WordPress/Elementor publishing (+50%); AWS LightSail + S3 (-30% page load).',
    'Full Stack Developer / Software Engineer - Infobell IT Solutions Pvt Ltd, Bengaluru (Jul 2023 - Jan 2025): Led 4-engineer team; NativeNest 30K+ users; GraphQL/Apollo (-30% checkout latency); Origem Next.js/Redis/ISR (-25% load); MirrorMate C#/Miracast (Windows networking / real-time media); mentored interns; six on-time releases.',
    'Full Stack Developer Intern - Infobell IT Solutions Pvt Ltd (Jan 2023 - Jun 2023): Angular dashboards, REST APIs, Jest coverage to 80%, Swagger.',
    // Redbee intentionally omitted from resume template (Amazon replaces that slot).
    'Full Stack Developer - Vasukam (Jul 2022 - Aug 2022): Video-on-demand streaming with React/Node/AWS S3.',
    'Software Engineer Intern - Yes Real Technologies (Feb 2021 - Jun 2022): University ERP / college management (MERN).',
  ],
  skills: {
    languages: 'Java, Python, JavaScript (React, Node.js), TypeScript, SQL, Bash, C/C++',
    frontend: 'Angular, React.js, React Native, Next.js, Vue.js, Redux, Tailwind CSS, HTML5, CSS3, Responsive Design',
    backend: 'Spring Boot, Express.js, FastAPI, REST, GraphQL, Microservices, PostgreSQL, Redis',
    databases: 'PostgreSQL, Redis, MongoDB, DynamoDB',
    cloud:
      'AWS (ECS, Lambda, S3, DynamoDB, SQS, CDK, CloudWatch, EC2), Docker, Jenkins, GitHub Actions, CI/CD',
    monitoring: 'Prometheus, Grafana, ELK Stack, Logging Pipelines',
    practices:
      'Agile/SCRUM, OOP, DSA, System Design, Operating Systems, Computer Architecture, Networking, TDD, Code Reviews, Performance Optimization',
  },
  projects: [
    'NativeNest - https://nativenest.in - React, React Native, Java, Spring Boot, Redis, AWS - 30K+ users, 99.9% uptime',
    'Arikya - https://arikya.in - Angular, Node.js, Express, AWS - placement SaaS for 10K+ students',
    'CloudSync - Java, AWS, Docker, Redis, Kafka - distributed data orchestration; may evidence OS scheduling, computer architecture (cache/memory-aware paths), networking',
    'RenderSync - Python, Flask, Prometheus, Docker - job scheduling & monitoring; may evidence operating systems / process scheduling',
    'SystemsLab (B.Tech) - C/C++, operating systems, computer architecture, networking - academic labs (authorized fabrication source)',
    'Job Tracker - https://jobtracker.karthikkovi.com - React, Node.js, MongoDB, Selenium, AWS - 1k+ automation runs',
  ],
  publications: '',
  certifications: [
    'Java Spring Boot Developer - 2024',
    'Docker & Container Orchestration - 2024',
    'ISTE AP Best Student Innovator (Gold Medal) - 2023',
    'Smart India Hackathon - National Finalist (Top 1%) - 2022',
  ],
  awards: [
    'ISTE AP Best Student Innovator Gold Medal',
    'Smart India Hackathon National Finalist',
  ],
};

export function formatResumeProfileForPrompt(): string {
  const r = resumeProfile;
  return `
CANDIDATE PROFILE (source of truth - tailor to JD, do not invent):

Name: ${r.name}
Headline: ${r.headline}
Email: ${r.email} | Phone: ${r.phone} | Location: ${r.location}
LinkedIn: ${r.linkedin} | Portfolio: ${r.portfolio} | GitHub: ${r.github}

EDUCATION:
${r.education
  .map(
    (e) =>
      `- ${e.degree} - ${e.school} (${e.dates})${e.graduation ? ` | Grad: ${e.graduation}` : ''}${
        'coursework' in e && e.coursework ? ` | Coursework: ${e.coursework}` : ''
      }`
  )
  .join('\n')}

SYSTEMS COURSEWORK: Operating Systems, Computer Architecture, Networking — when a JD requires them, put evidence in at most TWO projects (prefer CloudSync + RenderSync). Do NOT invent employers or change employment dates.

LOCKED EMPLOYMENT HEADERS (never fabricate titles/companies/dates/locations):
- Software Engineer Intern | Amazon - Bellevue, WA | 05/2026 - 08/2026
- Software Engineer | Associated Students, Inc. - CSULB | 02/2025 - Present
- Software Engineer | Infobell IT Solutions Pvt Ltd | 01/2023 - 01/2025

EXPERIENCE (bullet truth; rewrite wording OK, never change headers above):
${r.experience.map((e) => `- ${e}`).join('\n')}

FABRICATION OPEN: Skills lists; Certifications (Name - Year); ≤2 projects (CloudSync, RenderSync preferred).
FABRICATION CLOSED: employers, schools, employment dates, contact, live URLs.

SKILLS:
- Languages: ${r.skills.languages}
- Frontend: ${r.skills.frontend}
- Backend: ${r.skills.backend}
- Databases: ${r.skills.databases}
- Cloud/DevOps: ${r.skills.cloud}
- Monitoring: ${r.skills.monitoring}
- Practices: ${r.skills.practices}

PROJECTS:
${r.projects.map((p) => `- ${p}`).join('\n')}

CERTIFICATIONS: ${r.certifications.join('; ')}
`.trim();
}
