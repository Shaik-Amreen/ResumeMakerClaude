import { evaluateJobWithAI } from './src/services/aiJobFilter';
import { config } from './src/config';

// Ensure env vars are loaded if config doesn't do it automatically
// (Assuming config.ts does it)

async function testFilter() {
  console.log('Testing eligible job...');
  const res1 = await evaluateJobWithAI(
    'Software Engineer II',
    'TechCorp',
    'We are looking for a Software Engineer with 2 years of experience. Must be authorized to work in the US.'
  );
  console.log(res1);

  console.log('\\nTesting ineligible job (Clearance)...');
  const res2 = await evaluateJobWithAI(
    'Software Engineer',
    'DefenseInc',
    'We are looking for a SWE. Active TS/SCI clearance is strictly required.'
  );
  console.log(res2);

  console.log('\\nTesting ineligible job (Senior/YOE)...');
  const res3 = await evaluateJobWithAI(
    'Senior Software Engineer',
    'BigCo',
    'Looking for a staff level engineer with 7+ years of experience.'
  );
  console.log(res3);
  
  process.exit(0);
}

testFilter().catch(console.error);
