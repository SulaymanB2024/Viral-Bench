import { hashOperatorPassword } from '../lib/auth.js';

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').trimEnd();
  }
  process.stderr.write('Operator password: ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let password = '';
  return await new Promise<string>((resolve, reject) => {
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeAllListeners('data');
      process.stderr.write('\n');
      resolve(password);
    };
    process.stdin.on('data', (character: string) => {
      if (character === '\u0003') {
        process.stdin.setRawMode(false);
        process.stderr.write('\n');
        reject(new Error('Cancelled.'));
        return;
      }
      if (character === '\r' || character === '\n') {
        finish();
        return;
      }
      if (character === '\u007f' || character === '\b') {
        password = password.slice(0, -1);
        return;
      }
      password += character;
    });
  });
}

try {
  const password = await readPassword();
  process.stdout.write(`${hashOperatorPassword(password)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Could not hash password.'}\n`);
  process.exitCode = 1;
}
