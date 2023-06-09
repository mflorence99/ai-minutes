import { Configuration } from 'openai';
import { OpenAIApi } from 'openai';

import { input } from '@inquirer/prompts';
import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';

import chalk from 'chalk';
import dayjs from 'dayjs';

const configuration = new Configuration({
  apiKey: process.env['OPEN_AI_KEY']
});

const openai = new OpenAIApi(configuration);

const dir = await input({ message: 'Enter directory of minutes' });

const cfg = `./${dir}/minutes.json`;
const ifn = `./${dir}/minutes.txt`;
const ofn = `./${dir}/minutes.html`;
const tfn = './template.html';

// 👇 read and parse the config file
const config = JSON.parse(readFileSync(cfg).toString());

// 👇 read the raw minutes
const raw = readFileSync(ifn).toString();
const ilines = raw.split('\n');

// 👇 read the template
const template = readFileSync(tfn).toString();

// 👇 these are the edited lines
const olines: string[] = [];

// 👇 these are the summary lines
const slines: string[] = [];

// 👇 process each line in the raw input
for (let i = 0; i < ilines.length; i++) {
  const line = ilines[i];
  if (line.length > 0) {
    // 👇 source has timestamps
    if (config.timestamps) {
      const match = line.match(/^\[(.*)\] ([^*+:]*)([*+]?): (.*)$/im);
      const ts = match[1];
      const name = match[2];
      const alreadyEdited = match[3] === '+';
      const quoted = match[3] === '*';
      let text = match[4];
      // 👇 edit via GPT
      if (!quoted && !alreadyEdited && i < 9999 /* 👈 limit is for testing */)
        text = (await edit(text)).map((l) => `<p>${l}</p>`).join('\n');
      // 👇 accumulate edited lines
      slines.push(`${name} says: ${text}`);
      olines.push(
        `<tr><td class="speaker">${name}</td><td class="timestamp">${ts}</td><td>${
          quoted ? '"' : ''
        }${text}${quoted ? '"' : ''}</td></tr>`
      );
      // 👇 wait for rate limit
      if (!quoted && !alreadyEdited) await sleep(1000);
    }

    // 👇 no timestamps in source
    else {
      const match = line.match(/^([^*+:]*)([*+]?): (.*)$/im);
      const name = match[1];
      const alreadyEdited = match[2] === '+';
      const quoted = match[2] === '*';
      let text = match[3];
      // 👇 edit via GPT
      if (!quoted && !alreadyEdited && i < 9999 /* 👈 limit is for testing */)
        text = (await edit(text)).map((l) => `<p>${l}</p>`).join('\n');
      // 👇 accumulate edited lines
      slines.push(`${name} says: ${text}`);
      olines.push(
        `<tr><td class="speaker">${name}</td><td>${quoted ? '"' : ''}${text}${
          quoted ? '"' : ''
        }</td></tr>`
      );
      // 👇 wait for rate limit
      if (!quoted && !alreadyEdited) await sleep(10000);
    }
  }
}

// 👇 develop the summary
let temp = '';
let zlines: string[] = ['<ul>'];
for (let i = 0; i < slines.length; i++) {
  temp = `${temp}\n${slines[i]}`;
  const wordCount = temp.split(/\s+/).length;
  if (wordCount > 700) {
    zlines = zlines.concat((await summarize(temp)).map((l) => `<li>${l}</li>`));
    temp = '';
    // 👇 wait for rate limit (no need on last one)
    if (i < slines.length - 1) await sleep(10000);
  }
}
// 👇 don't forget the last batch
zlines = zlines.concat((await summarize(temp)).map((l) => `<li>${l}</li>`));
zlines.push('</ul>');

// 👇 substitute derived data into the template
const edited = template
  .replaceAll('{{ TITLE }}', config.title)
  .replaceAll('{{ SUBTITLE }}', config.subtitle)
  .replaceAll('{{ DATE }}', dayjs(config.date).format('MMMM D, YYYY'))
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
    .map((line: string) => line.replace(/^-[\s*]/, ''))
    .map((line: string) =>
      line.endsWith('.') ? line.substring(0, line.length - 1) : line
    );
}

function sleep(ms: number): Promise<void> {
  console.log(chalk.cyan(`... waiting ${ms / 1000} secs for rate limit`));
  return new Promise((resolve) => setTimeout(resolve, ms));
}
