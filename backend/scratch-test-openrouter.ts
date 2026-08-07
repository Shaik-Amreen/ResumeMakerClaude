import { config } from './src/config';
import { openRouterChatCompletion } from './src/services/resumeAgent/openRouterProvider';

async function main() {
  console.log('Testing OpenRouter connection...');
  try {
    const res = await openRouterChatCompletion([
      { role: 'user', content: 'Say hello in 1 word.' }
    ]);
    console.log('Success:', res);
  } catch (err) {
    console.error('Failed:', err);
  }
}
main();
