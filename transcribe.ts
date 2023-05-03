import { input } from '@inquirer/prompts';
import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';

import chalk from 'chalk';
import dayjs from 'dayjs';
import speech from '@google-cloud/speech';

const client = new speech.v1p1beta1.SpeechClient();

const dir = await input({ message: 'Enter directory of minutes' });

const cfg = `./${dir}/minutes.json`;
const ofn = `./${dir}/minutes.txt`;

// 👇 read and parse the config file
const config = JSON.parse(readFileSync(cfg).toString());

// 👇 call Google to begin transcription
const [operation] = await client.longRunningRecognize({
  audio: {
    uri: config.audio.gcsuri
  },
  config: {
    enableAutomaticPunctuation: true,
    enableWordTimeOffsets: true,
    diarizationSpeakerCount: config.speakers.length,
    enableSpeakerDiarization: true,
    encoding: config.audio.encoding,
    languageCode: 'en-US',
    sampleRateHertz: config.audio.sampleRateHertz
  }
});

// 👇 call Google to begin transcription
const transcriber = operation.promise();
const poller = pollOperationProgress();
const [[response]] = await Promise.all([transcriber, poller]);

// 👇 we need only look at the last result
//    https://cloud.google.com/speech-to-text/docs/multiple-voices

let currentSpeakerTag = null;
let currentStartTime = null;
const meetingStartTime = dayjs(config.date);
const currentSpeech: string[] = [];
const transcription: string[] = [];
const wordsInfo =
  response.results[response.results.length - 1].alternatives[0].words;

// 👇 this is how we format a single "speech"
const formatCurrentSpeech = (): string =>
  `[${currentStartTime}] ${currentSpeakerTag}: ${currentSpeech.join(' ')}`;

// 👇 iterate over all the words
wordsInfo.forEach((info) => {
  const speakerTag = config.speakers[Number(info.speakerTag) - 1];
  if (speakerTag !== currentSpeakerTag) {
    if (currentSpeakerTag) transcription.push(formatCurrentSpeech());
    currentSpeakerTag = speakerTag;
    currentStartTime = null;
    currentSpeech.length = 0;
  }
  if (!currentStartTime)
    currentStartTime = meetingStartTime
      .add(parseFloat(info.startTime.seconds as string), 'second')
      .format('hh:mm a');
  currentSpeech.push(info.word);
});

// 👇 don't forget the last one!
transcription.push(formatCurrentSpeech());

// 👇 that's it!
writeFileSync(ofn, transcription.join('\n\n'));

// ////////////////////////////////////////////////////////////////////////////

async function pollOperationProgress(): Promise<void> {
  let doContinue = true;
  do {
    // 👇 how far along are we?
    const response = await client.checkLongRunningRecognizeProgress(
      operation.name
    );
    const { latestResponse, metadata } = response;
    // 👇 1. metadata doesn't seem to be typed properly
    //    2. seems to be 0% all the way to the end, when it jumps to 100%
    console.log(
      chalk.cyan(`... progress: ${(<any>metadata).progressPercent ?? 0}%`)
    );
    // 👇 if we aren't done, well, we should continue polling
    doContinue = !latestResponse.done;
    // 👇 wait before polling again
    await sleep(1000);
  } while (doContinue);
}

function sleep(ms): Promise<any> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
