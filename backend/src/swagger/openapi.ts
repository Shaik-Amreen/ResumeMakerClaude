/**
 * OpenAPI 3.0 spec for ResumeMaker Claude APIs.
 * Served at /api-docs (Swagger UI) — no authentication.
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'ResumeMaker Claude API',
    version: '1.0.0',
    description: [
      'Job scrape → tailored LaTeX resume pipeline.',
      '',
      '**No authentication required.**',
      '',
      '### Try JD → LaTeX',
      'Use `POST /api/resume/from-jd` — paste a job description and get amazon.pdf-style LaTeX.',
      'Uses the active `RESUME_PROVIDER` (`claude-code`, `openrouter`/OmniRoute, or `ollama`).',
      'Generation can take 1–5 minutes depending on the model.',
    ].join('\n'),
  },
  servers: [{ url: 'http://localhost:5001', description: 'Local backend' }],
  tags: [
    { name: 'Resume', description: 'JD → LaTeX (stateless test endpoint)' },
    { name: 'Jobs', description: 'Job tracker CRUD & resume pipeline' },
    { name: 'Tasks', description: 'Background scrape / generate status' },
    { name: 'Scrape', description: 'Job sources' },
    { name: 'Ollama', description: 'Local Ollama proxy' },
  ],
  paths: {
    '/api/resume/from-jd': {
      post: {
        tags: ['Resume'],
        summary: 'Generate LaTeX resume from a job description',
        description: [
          'Paste a JD and receive tailored amazon.pdf-style LaTeX.',
          '',
          '**Swagger tip:** use `application/x-www-form-urlencoded` (form fields) so you can paste multi-line JDs.',
          'Raw JSON fails if the JD contains unescaped newlines (`Bad control character in string literal`).',
          '',
          'Also accepts `text/plain` (entire body = JD) or JSON with `\\n` escapes.',
          'Generation can take 1–5 minutes (Claude Code / OmniRoute / Ollama).',
        ].join('\n'),
        operationId: 'resumeFromJd',
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: { $ref: '#/components/schemas/FromJdRequest' },
              example: {
                title: 'Full-Stack Web Development Internship',
                company: 'SeatSwap, Inc.',
                jobType: 'internship',
                jobDescription:
                  'SeatSwap is hiring a Full-Stack Web Development Intern (New York, onsite). Responsibilities: work with the team toward Beta launch; hands-on product work. Required: PHP, HTML, CSS, JavaScript. Preferred: third-party APIs, REST.',
              },
            },
            'application/json': {
              schema: { $ref: '#/components/schemas/FromJdRequest' },
              example: {
                title: 'Software Engineering Intern - Summer 2027',
                company: 'Example Corp',
                jobType: 'internship',
                jobDescription:
                  'Requirements: Python, C++, distributed systems, Linux, data structures and algorithms, REST APIs, Git. Preferred: AWS, Docker, Kubernetes, React, TypeScript.',
              },
            },
            'text/plain': {
              schema: {
                type: 'string',
                description: 'Raw job description text (entire body)',
              },
              example:
                'Full-Stack Web Development Intern. Required: PHP, HTML, CSS, JavaScript. Preferred: REST APIs.',
            },
          },
        },
        responses: {
          '200': {
            description: 'LaTeX generated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FromJdResponse' },
              },
            },
          },
          '400': {
            description: 'Missing JD or invalid JSON (use form-urlencoded in Swagger)',
          },
          '500': { description: 'Generation failed' },
        },
      },
    },
    '/api/resume/provider': {
      get: {
        tags: ['Resume'],
        summary: 'Active resume provider label',
        responses: {
          '200': {
            description: 'Provider string',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { provider: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/api/jobs': {
      get: {
        tags: ['Jobs'],
        summary: 'List jobs',
        parameters: [
          {
            name: 'jobType',
            in: 'query',
            schema: { type: 'string', enum: ['internship', 'fulltime'] },
          },
        ],
        responses: { '200': { description: 'Array of jobs' } },
      },
    },
    '/api/jobs/{id}': {
      get: {
        tags: ['Jobs'],
        summary: 'Get job by id',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Job' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Jobs'],
        summary: 'Delete one job (+ resume files)',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/jobs/delete-all': {
      post: {
        tags: ['Jobs'],
        summary: 'Delete all jobs',
        responses: { '200': { description: 'Deleted count' }, '409': { description: 'Busy' } },
      },
    },
    '/api/jobs/reset-all': {
      post: {
        tags: ['Jobs'],
        summary: 'Reset all jobs to scraped',
        responses: { '200': { description: 'Reset count' } },
      },
    },
    '/api/jobs/task/status': {
      get: {
        tags: ['Tasks'],
        summary: 'Background task status',
        responses: { '200': { description: 'TaskStatus' } },
      },
    },
    '/api/jobs/task/stop': {
      post: {
        tags: ['Tasks'],
        summary: 'Stop current scrape/generate task',
        responses: { '200': { description: 'Stop requested' } },
      },
    },
    '/api/jobs/scheduler/status': {
      get: {
        tags: ['Tasks'],
        summary: 'Scheduler status',
        responses: { '200': { description: 'SchedulerStatus' } },
      },
    },
    '/api/jobs/generate-resumes': {
      post: {
        tags: ['Jobs'],
        summary: 'Generate resumes for scraped-status jobs only (queue)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  limit: { type: 'integer', example: 1 },
                  withOutreach: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Started' }, '409': { description: 'Busy' } },
      },
    },
    '/api/jobs/prepare-and-generate-resumes': {
      post: {
        tags: ['Jobs'],
        summary: 'Prepare scraped jobs then generate resumes',
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/run-pipeline': {
      post: {
        tags: ['Jobs'],
        summary: 'Full pipeline (optional wipe + scrape + resumes)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deleteFirst: { type: 'boolean' },
                  perSourceCap: { type: 'integer' },
                  jobType: { type: 'string', enum: ['internship', 'fulltime'] },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Started' }, '409': { description: 'Busy' } },
      },
    },
    '/api/jobs/scrape/jobright': {
      post: {
        tags: ['Scrape'],
        summary: 'Scrape Jobright',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrapeBody' } } } },
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/scrape/linkedin': {
      post: {
        tags: ['Scrape'],
        summary: 'Scrape LinkedIn',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrapeBody' } } } },
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/scrape/indeed': {
      post: {
        tags: ['Scrape'],
        summary: 'Scrape Indeed',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrapeBody' } } } },
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/scrape/ats': {
      post: {
        tags: ['Scrape'],
        summary: 'Scrape ATS boards (Greenhouse/Lever)',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrapeBody' } } } },
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/scrape/career-portals': {
      post: {
        tags: ['Scrape'],
        summary: 'Scrape Google Jobs / career portals',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { limit: { type: 'integer' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/scrape': {
      post: {
        tags: ['Scrape'],
        summary: 'Legacy scrape alias',
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/refresh-jobs': {
      post: {
        tags: ['Jobs'],
        summary: 'Refresh posted dates / applicants',
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/prune-summer-2027': {
      post: {
        tags: ['Jobs'],
        summary: 'Prune non Summer-2027 software intern targets',
        responses: { '200': { description: 'Pruned' } },
      },
    },
    '/api/jobs/{id}/status': {
      patch: {
        tags: ['Jobs'],
        summary: 'Update job status',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated job' } },
      },
    },
    '/api/jobs/{id}/generate-resume': {
      post: {
        tags: ['Jobs'],
        summary: 'Queue resume for one job',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Queued' } },
      },
    },
    '/api/jobs/{id}/generate-resume-ollama': {
      post: {
        tags: ['Jobs'],
        summary: 'Queue resume for one job (agent)',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Queued' } },
      },
    },
    '/api/jobs/{id}/latex': {
      post: {
        tags: ['Jobs'],
        summary: 'Compile submitted LaTeX → PDF for a job',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['latex'],
                properties: { latex: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated job with PDF' } },
      },
    },
    '/api/jobs/{id}/approve-resume': {
      post: {
        tags: ['Jobs'],
        summary: 'Approve resume PDF',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Approved' } },
      },
    },
    '/api/jobs/{id}/approve-resume-and-apply': {
      post: {
        tags: ['Jobs'],
        summary: 'Approve resume and start Easy Apply',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/{id}/upload-pdf': {
      post: {
        tags: ['Jobs'],
        summary: 'Upload resume PDF',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { resume: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Uploaded' } },
      },
    },
    '/api/jobs/{id}/apply': {
      post: {
        tags: ['Jobs'],
        summary: 'Start LinkedIn Easy Apply',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Started' } },
      },
    },
    '/api/jobs/{id}/approve-message': {
      post: {
        tags: ['Jobs'],
        summary: 'Approve recruiter message draft',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { message: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Approved' } },
      },
    },
    '/api/jobs/{id}/approve-submit': {
      post: {
        tags: ['Jobs'],
        summary: 'Approve final Easy Apply submit',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Approved' } },
      },
    },
    '/api/jobs/{id}/reject': {
      post: {
        tags: ['Jobs'],
        summary: 'Reject pending action',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Rejected' } },
      },
    },
    '/api/jobs/rerun-claude': {
      post: {
        tags: ['Jobs'],
        summary: 'Rerun Claude step for jobs with LaTeX',
        responses: { '200': { description: 'Queued' } },
      },
    },
    '/api/jobs/{id}/rerun-claude': {
      post: {
        tags: ['Jobs'],
        summary: 'Rerun Claude step for one job',
        parameters: [{ $ref: '#/components/parameters/JobId' }],
        responses: { '200': { description: 'Queued' } },
      },
    },
    '/api/ollama/models': {
      get: {
        tags: ['Ollama'],
        summary: 'List local Ollama models',
        responses: { '200': { description: 'Ollama tags' } },
      },
    },
    '/api/ollama/chat': {
      post: {
        tags: ['Ollama'],
        summary: 'Proxy chat to local Ollama',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['model', 'messages'],
                properties: {
                  model: { type: 'string' },
                  messages: { type: 'array', items: { type: 'object' } },
                  stream: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Chat response / NDJSON stream' } },
      },
    },
  },
  components: {
    parameters: {
      JobId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    },
    schemas: {
      FromJdRequest: {
        type: 'object',
        required: ['jobDescription'],
        properties: {
          jobDescription: {
            type: 'string',
            description: 'Full job description text',
            minLength: 40,
          },
          jd: { type: 'string', description: 'Alias for jobDescription' },
          title: { type: 'string' },
          company: { type: 'string' },
          jobType: { type: 'string', enum: ['internship', 'fulltime'] },
        },
      },
      FromJdResponse: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          latex: { type: 'string', description: 'Generated LaTeX resume' },
          matchScore: { type: 'number' },
          missingKeywords: { type: 'array', items: { type: 'string' } },
          latexChars: { type: 'integer' },
        },
      },
      ScrapeBody: {
        type: 'object',
        properties: {
          limit: { type: 'integer', example: 50 },
          jobType: { type: 'string', enum: ['internship', 'fulltime'] },
        },
      },
    },
  },
} as const;
