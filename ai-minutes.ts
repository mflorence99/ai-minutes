import { Configuration } from 'openai';
import { OpenAIApi } from 'openai';

import { appendFileSync } from 'fs';
import { input } from '@inquirer/prompts';
import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';

import chalk from 'chalk';

const configuration = new Configuration({
  apiKey: process.env['OPEN_AI_KEY']
});

const openai = new OpenAIApi(configuration);

// const models = await openai.listModels();
// jsome(models.data.data.map((data: any) => data.root));

const dir = await input({ message: 'Enter directory of minutes' });

const cfg = `./${dir}/minutes.json`;
const chk = `./${dir}/minutes.checkpoint`;
const ifn = `./${dir}/minutes.txt`;
const ofn = `./${dir}/minutes.html`;
const tfn = './template.html';

// 👇 read and parse the config file
const config = JSON.parse(readFileSync(cfg).toString());

// 👇 initialize the checkpoint file
writeFileSync(chk, '');

// 👇 read the raw minutes
const raw = readFileSync(ifn).toString();
const ilines = raw.split('\n');

// 👇 read the template
const template = readFileSync(tfn).toString();

// 👇 these are the edited lines
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
    // 👇 name may be quoted (*) or already edited (+)
    let name = line.substring(0, j).trim();
    let quoted = false,
      alreadyEdited = false;
    if (name.endsWith('*')) {
      name = name.substring(0, name.length - 1);
      quoted = true;
    } else if (name.endsWith('+')) {
      name = name.substring(0, name.length - 1);
      alreadyEdited = true;
    }
    // 👇 edit via GPT
    let text = line.substring(j + 1).trim();
    if (!quoted && !alreadyEdited && i < 9999 /* 👈 limit is for testing */)
      text = (await edit(text)).map((l) => `<p>${l}</p>`).join('\n');
    // 👇 accumulate edited lines
    slines.push(`${name} says: ${text}`);
    appendFileSync(chk, `${name}${quoted ? '*' : '+'}: ${text}\n\n`);
    if (quoted) olines.push(`<tr><td>${name}</td><td>"${text}"</td></tr>`);
    else olines.push(`<tr><td>${name}</td><td>${text}</td></tr>`);
    // 👇 wait for rate limit
    if (!quoted && !alreadyEdited) await sleep(30000);
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
    // 👇 wait for rate limit
    await sleep(30000);
  }
}
// 👇 don't forget the last batch
zlines = zlines.concat((await summarize(temp)).map((l) => `<li>${l}</li>`));
zlines.push('</ul>');

// 👇 substitute derived data into the template
const edited = template
  .replaceAll('{{ TITLE }}', config.title)
  .replaceAll('{{ SUBTITLE }}', config.subtitle)
  .replaceAll('{{ SUBJECT }}', config.subject)
  .replaceAll('{{ SUMMARY }}', zlines.join('\n'))
  .replaceAll('{{ MINUTES }}', olines.join('\n'));

// 👇 that's it!
writeFileSync(ofn, edited);

// ////////////////////////////////////////////////////////////////////

async function edit(text: string): Promise<string[]> {
  console.log(chalk.yellow('openai.createChatCompletion to edit statement'));
  const response = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'user',
        content: `Summarize my statement in the first person:\n\n${text}`
      }
    ],
    temperature: 0.5,
    max_tokens: 2048
  });
  return response.data.choices[0].message.content
    .split('\n')
    .filter((line: string) => line.length > 0);
}

async function summarize(text: string): Promise<string[]> {
  console.log(chalk.blue('openai.createChatCompletion to summarize'));
  const response = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'user',
        content: `Summarize this discussion into a few bullet points:\n\n${text}`
      }
    ],
    temperature: 0.5,
    max_tokens: 2048
  });
  return response.data.choices[0].message.content
    .split('\n')
    .filter((line: string) => line.length > 0)
    .map((line: string) => line.replace(/-[\s*]/, ''))
    .map((line: string) =>
      line.endsWith('.') ? line.substring(0, line.length - 1) : line
    );
}

function sleep(ms: number): Promise<void> {
  console.log(chalk.cyan(`... waiting ${ms / 1000} secs for rate limit`));
  return new Promise((resolve) => setTimeout(resolve, ms));
}
