import { Configuration } from 'openai';
import { OpenAIApi } from 'openai';

import chalk from 'chalk';

const configuration = new Configuration({
  apiKey: Deno.env.get('OPEN_AI_KEY')
});

const openai = new OpenAIApi(configuration);

const dir = Deno.args[0];

const cfg = `./${dir}/minutes.json`;
const chk = `./${dir}/minutes.checkpoint`;
const ifn = `./${dir}/minutes.txt`;
const ofn = `./${dir}/minutes.html`;
const tfn = './template.html';

// 👇 read and parse the config file
const config = JSON.parse(await Deno.readTextFile(cfg));

// 👇 initialize the checkpoint file
Deno.writeTextFile(chk, '');

// 👇 read the raw minutes
const raw = await Deno.readTextFile(ifn);
const ilines = raw.split('\n');

// 👇 read the template
const template = await Deno.readTextFile(tfn);

// 👇 these are the converted lines
const olines: string[] = [];

// 👇 these ate the summary lines
const slines: string[] = [];

// 👇 process each line in the raw input
for (let i = 0; i < ilines.length; i++) {
  const line = ilines[i];
  if (line.length > 1) {
    // 👇 extract data from input
    const j: number = line.indexOf(':');
    // 🔥 check to see if a reasonable name is found
    if (j === -1 || j > 20) {
      console.log(chalk.red(`No name found on line ${i + 1} ${line}`));
      break;
    }
    // 👇 name may be quoted (*) or already converted (+)
    let name = line.substring(0, j).trim();
    let quoted = false,
      alreadyConverted = false;
    if (name.endsWith('*')) {
      name = name.substring(0, name.length - 1);
      quoted = true;
    } else if (name.endsWith('+')) {
      name = name.substring(0, name.length - 1);
      alreadyConverted = true;
    }
    // 👇 convert via GPT
    let text = line.substring(j + 1).trim();
    if (!quoted && !alreadyConverted && i < 9999 /* 👈 limit is for testing */)
      text = (await convert(text)).map((l) => `<p>${l}</p>`).join('\n');
    // 👇 accumulate converted lines
    slines.push(`${name} says: ${text}`);
    await Deno.writeTextFile(chk, `${name}${quoted ? '*' : '+'}: ${text}\n\n`, {
      append: true
    });
    if (quoted) olines.push(`<tr><td>${name}</td><td>"${text}"</td></tr>`);
    else olines.push(`<tr><td>${name}</td><td>${text}</td></tr>`);
  }
}

// 👇 develop the summary
let temp = '';
let zlines: string[] = ['<ul>'];
for (let i = 0; i < slines.length; i++) {
  temp = `${temp}\n${slines[i]}`;
  const wordCount = temp.split(/\s+/).length;
  if (wordCount > 1400) {
    zlines = zlines.concat((await summarize(temp)).map((l) => `<li>${l}</li>`));
    temp = '';
  }
}
// 👇 don't forget the last batch
zlines = zlines.concat((await summarize(temp)).map((l) => `<li>${l}</li>`));
zlines.push('</ul>');

// 👇 substitute derived data into the template
const converted = template
  .replaceAll('{{ TITLE }}', config.title)
  .replaceAll('{{ SUBTITLE }}', config.subtitle)
  .replaceAll('{{ SUBJECT }}', config.subject)
  .replaceAll('{{ SUMMARY }}', zlines.join('\n'))
  .replaceAll('{{ MINUTES }}', olines.join('\n'));

// 👇 that's it!
await Deno.writeTextFile(ofn, converted);

// ////////////////////////////////////////////////////////////////////

async function convert(text: string): Promise<string[]> {
  console.log(
    chalk.yellow('Calling GPT 3.5 ... waiting 30 secs for rate limit')
  );
  console.log(chalk.green(text));
  console.log();
  await sleep(30000);
  const response = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        content: `Convert the following trancsription of my words into sentences and paragraphs\n\n${text}`,
        role: 'user'
      }
    ],
    temperature: 1,
    max_tokens: 2048
  });
  return response.data.choices[0].message.content
    .split('\n')
    .filter((line: string) => line.length > 0);
}

async function summarize(text: string): Promise<string[]> {
  console.log(chalk.blue('Calling GPT 3.5 ... waiting 30 secs for rate limit'));
  console.log();
  await sleep(30000);
  const response = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        content: `Summarize the following discussion into a few bullet points:\n\n${text}`,
        role: 'user'
      }
    ],
    temperature: 1,
    max_tokens: 2048
  });
  console.log(chalk.cyan(response.data.choices[0].message.content));
  return response.data.choices[0].message.content
    .split('\n')
    .filter((line: string) => line.length > 0)
    .map((line: string) => line.replace(/-[\s*]/, ''))
    .map((line: string) =>
      line.endsWith('.') ? line.substring(0, line.length - 1) : line
    );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
