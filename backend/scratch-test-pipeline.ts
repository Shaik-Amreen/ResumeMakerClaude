import mongoose from 'mongoose';
import { config } from './src/config';
import Job from './src/models/Job';
import { runResumePipeline } from './src/services/resumePipeline';

async function main() {
  console.log('Connecting to DB...');
  await mongoose.connect(config.mongoUri);
  console.log('Finding a job that needs a resume...');
  
  const jobs = await Job.find({ 
    $or: [{ status: 'scraped' }, { resumePhase: 'failed' }],
    $and: [{ jobType: 'fulltime' }]
  }).limit(1);

  if (jobs.length === 0) {
    console.log('No jobs found!');
    process.exit(0);
  }

  const job = jobs[0];
  console.log(`Testing pipeline on job: ${job.id} - ${job.title} at ${job.company}`);
  
  try {
    await runResumePipeline(job.id);
    console.log('Pipeline finished successfully!');
  } catch (err) {
    console.error('Pipeline failed:', err);
  }
  process.exit(0);
}
main();
